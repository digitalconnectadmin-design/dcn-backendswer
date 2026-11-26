import { query, readFields } from "@/lib/api/body";
import { requireNewsroomManager } from "@/lib/api/guard";
import { handler, ok, preflight } from "@/lib/api/http";
import { createCategory, listCategoriesPage } from "@/lib/services/categories";

export const dynamic = "force-dynamic";

/**
 * The category collection.
 *
 *   GET  /api/v1/categories?q=&page=&per=   → paginated admin list
 *   POST /api/v1/categories                → create
 *
 * This is the shape every ported admin resource follows: the permission check
 * sits at the top of the method it guards, the request is turned into a
 * `Fields` bag, and the service does the work. The route handler itself stays
 * short enough to audit at a glance, which is the point — in the monolith the
 * permission check was the first line of a 200-line action and easy to lose.
 *
 * `GET` is newsroom-manager-gated to match the monolith: the admin list shows
 * draft categories and per-category story counts, which aren't public. The
 * public site reads categories through /api/v1/public/* instead.
 */

export const GET = handler(async (request: Request) => {
  await requireNewsroomManager(request);

  const q = query(request);
  const list = await listCategoriesPage({
    search: q.str("q"),
    page: q.num("page", 1),
    perPage: q.num("per", 10),
  });

  return ok(request, list);
});

export const POST = handler(async (request: Request) => {
  await requireNewsroomManager(request);

  const created = await createCategory(await readFields(request));

  return ok(
    request,
    {
      ...created,
      message: `"${created.name}" was created.`,
      /**
       * Paths the frontend should drop from its render cache now that this
       * write has landed.
       *
       * In the monolith the action called `revalidatePath` for each of these
       * itself. It can't any more — the render cache belongs to the other
       * project — so the API names them and the frontend's API client calls
       * its own `revalidatePath` on receipt. Returning them keeps the
       * knowledge of "what a category change affects" next to the code that
       * changes a category, rather than duplicating it in every caller.
       */
      revalidate: ["/admin/categories", "/admin/stories", "/"],
    },
    { status: 201 }
  );
});

export const OPTIONS = preflight;
