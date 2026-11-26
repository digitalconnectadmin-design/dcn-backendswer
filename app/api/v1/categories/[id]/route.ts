import { readFields } from "@/lib/api/body";
import { requireNewsroomManager } from "@/lib/api/guard";
import { handler, ok, preflight } from "@/lib/api/http";
import { deleteCategory, getCategory, updateCategory } from "@/lib/services/categories";

export const dynamic = "force-dynamic";

/**
 *   GET    /api/v1/categories/:id   → one row, for an edit form
 *   PATCH  /api/v1/categories/:id   → update
 *   DELETE /api/v1/categories/:id   → delete
 *
 * Note `params` is a Promise — that's Next 15+/16, and forgetting to await it
 * gives you a `[object Promise]` where an id should be, which surfaces as a
 * puzzling "category no longer exists" rather than a type error.
 */

type Ctx = { params: Promise<{ id: string }> };

const AFFECTED = ["/admin/categories", "/admin/stories", "/"];

export const GET = handler<Ctx>(async (request, { params }) => {
  await requireNewsroomManager(request);
  const { id } = await params;
  return ok(request, await getCategory(id));
});

export const PATCH = handler<Ctx>(async (request, { params }) => {
  await requireNewsroomManager(request);
  const { id } = await params;

  const updated = await updateCategory(id, await readFields(request));

  return ok(request, {
    ...updated,
    message: `"${updated.name}" was updated.`,
    revalidate: AFFECTED,
  });
});

export const DELETE = handler<Ctx>(async (request, { params }) => {
  await requireNewsroomManager(request);
  const { id } = await params;

  const { name } = await deleteCategory(id);

  return ok(request, {
    message: `"${name}" was deleted.`,
    revalidate: AFFECTED,
  });
});

export const OPTIONS = preflight;
