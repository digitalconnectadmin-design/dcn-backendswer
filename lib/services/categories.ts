import { asc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { category, story } from "@/db/schema";
import { HttpError } from "@/lib/api/http";
import { optionalStr, str, type Fields } from "@/lib/api/body";
import { paged, readPaging, uniqueSlug, type Paged } from "@/lib/services/shared";

/**
 * Categories, ported from `app/(cms)/admin/categories/actions.ts`.
 *
 * This file is the reference for how the other 33 action files get ported, so
 * the three changes are called out explicitly:
 *
 * 1. **No auth check in here.** The action opened with
 *    `await requireNewsroomManager(LIST)`. That moved up to the route handler
 *    (`app/api/v1/categories/route.ts`) so the permission is visible next to
 *    the HTTP method it guards, and so a service function can be reused by
 *    another endpoint with a different permission without smuggling one in.
 *
 * 2. **No `revalidatePath`.** The action ended with three of them
 *    (`/admin/categories`, `/admin/stories`, `/`). Those invalidated *this*
 *    project's render cache, and there is no longer a render cache here to
 *    invalidate — the pages live in the other project. Cache invalidation is
 *    now the frontend's business; see `revalidate` in the route handler and
 *    the note in PORTING.md.
 *
 * 3. **Failures throw instead of returning `{ ok: false }`.** `handler()` in
 *    `lib/api/http.ts` turns an `HttpError` into the same envelope the action
 *    used to return, so the frontend still sees `{ ok: false, error }` — but
 *    a service can now be composed into another service without each caller
 *    having to re-check a result object.
 *
 * Everything else — the slug collision handling, the parent-cycle check, the
 * denormalised `story.category` push-down — is the original logic unchanged.
 */

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  permission: "public" | "admin";
  iconClass: string | null;
  status: "draft" | "published";
  position: number;
  stories: number;
};

function readCategoryFields(fields: Fields) {
  const permissionRaw = str(fields, "permission");
  const statusRaw = str(fields, "status");
  return {
    description: optionalStr(fields, "description"),
    parentId: optionalStr(fields, "parentId"),
    permission: permissionRaw === "admin" ? ("admin" as const) : ("public" as const),
    iconClass: optionalStr(fields, "iconClass"),
    status: statusRaw === "draft" ? ("draft" as const) : ("published" as const),
  };
}

/**
 * Paginated + searchable category list backing the admin table. Search and
 * paging run in SQL — the browser only ever receives the rows it's about to
 * show.
 */
export async function listCategoriesPage(input: {
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<Paged<CategoryRow>> {
  const { page, perPage } = readPaging(input.page ?? 1, input.perPage ?? 10, PER_PAGE_OPTIONS);

  const term = (input.search ?? "").trim();
  const where = term
    ? or(ilike(category.name, `%${term}%`), ilike(category.slug, `%${term}%`))
    : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        parentId: category.parentId,
        permission: category.permission,
        iconClass: category.iconClass,
        status: category.status,
        position: category.position,
        stories: sql<number>`count(${story.id})::int`,
      })
      .from(category)
      .leftJoin(story, eq(story.categoryId, category.id))
      .where(where)
      .groupBy(category.id)
      .orderBy(asc(category.position), asc(category.name))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: sql<number>`count(*)::int` }).from(category).where(where),
  ]);

  return paged(rows as CategoryRow[], total, page, perPage, PER_PAGE_OPTIONS);
}

/** Parent-category picker: top-level categories, minus the one being edited. */
export async function listParentCandidates(excludeId?: string) {
  const rows = await db
    .select({ id: category.id, name: category.name, parentId: category.parentId })
    .from(category)
    .where(isNull(category.parentId))
    .orderBy(asc(category.position), asc(category.name));

  if (!excludeId) return rows;
  return rows.filter((r) => r.id !== excludeId);
}

/** Plain ordered list for `<select>` pickers. */
export async function listCategories() {
  return db
    .select({ id: category.id, name: category.name, slug: category.slug })
    .from(category)
    .orderBy(asc(category.position), asc(category.name));
}

/** Every category, parents and children, for the article form's pickers. */
export async function listAllCategories() {
  return db
    .select({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
    })
    .from(category)
    .orderBy(asc(category.position), asc(category.name));
}

export async function getCategory(categoryId: string) {
  const [row] = await db
    .select()
    .from(category)
    .where(eq(category.id, categoryId))
    .limit(1);
  if (!row) throw new HttpError(404, "That category no longer exists.");
  return row;
}

export async function createCategory(fields: Fields): Promise<{ id: string; name: string }> {
  const name = str(fields, "name");
  if (!name) {
    throw new HttpError(422, "Category name is required.", { fields: { name: "Required." } });
  }

  const attrs = readCategoryFields(fields);

  // A category can't be its own parent, and can't be a child of one of its
  // own descendants either — but on create there are no descendants yet, so
  // the only check that applies is "not itself", which is moot until the row
  // exists. Real enforcement lives in updateCategory.
  const slug = await uniqueSlug(
    category,
    category.slug,
    optionalStr(fields, "slug") ?? name,
    undefined,
    category.id
  );

  const [created] = await db
    .insert(category)
    .values({ name, slug, ...attrs, position: 0 })
    .returning({ id: category.id });

  return { id: created.id, name };
}

/** Every id in categoryId's subtree, including itself — used to block a cycle. */
async function descendantIds(categoryId: string): Promise<Set<string>> {
  const all = await db
    .select({ id: category.id, parentId: category.parentId })
    .from(category);

  const ids = new Set<string>([categoryId]);
  // Fixed-point over a small table (newsroom category counts are in the tens,
  // not thousands) rather than a recursive CTE — simpler to read and fast
  // enough at this scale.
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
        ids.add(row.id);
        grew = true;
      }
    }
  }
  return ids;
}

export async function updateCategory(
  categoryId: string,
  fields: Fields
): Promise<{ id: string; name: string }> {
  const name = str(fields, "name");
  if (!name) {
    throw new HttpError(422, "Category name is required.", { fields: { name: "Required." } });
  }

  const attrs = readCategoryFields(fields);

  if (attrs.parentId) {
    if (attrs.parentId === categoryId) {
      throw new HttpError(422, "A category can't be its own parent.", {
        fields: { parentId: "Can't be itself." },
      });
    }
    const blocked = await descendantIds(categoryId);
    if (blocked.has(attrs.parentId)) {
      throw new HttpError(
        422,
        "Can't set a sub-category of this one as its parent — that would create a loop.",
        { fields: { parentId: "That would create a loop." } }
      );
    }
  }

  const slug = await uniqueSlug(
    category,
    category.slug,
    optionalStr(fields, "slug") ?? name,
    categoryId,
    category.id
  );

  const [updated] = await db
    .update(category)
    .set({ name, slug, ...attrs, updatedAt: new Date() })
    .where(eq(category.id, categoryId))
    .returning({ id: category.id });

  if (!updated) throw new HttpError(404, "That category no longer exists.");

  // `story.category` denormalises the name for display, so a rename has to be
  // pushed down or existing stories would keep showing the old label.
  await db.update(story).set({ category: name }).where(eq(story.categoryId, categoryId));

  return { id: updated.id, name };
}

export async function deleteCategory(categoryId: string): Promise<{ name: string }> {
  const [existing] = await db
    .select({ name: category.name })
    .from(category)
    .where(eq(category.id, categoryId))
    .limit(1);
  if (!existing) throw new HttpError(404, "That category no longer exists.");

  // FK is ON DELETE SET NULL on story, ON DELETE CASCADE on child categories
  // — stories survive with their label intact, sub-categories go with their
  // parent.
  await db.delete(category).where(eq(category.id, categoryId));

  return { name: existing.name };
}
