import { query } from "@/lib/api/body";
import { requireNewsroomManager } from "@/lib/api/guard";
import { handler, ok, preflight } from "@/lib/api/http";
import { listParentCandidates } from "@/lib/services/categories";

export const dynamic = "force-dynamic";

/**
 * Options for the parent-category picker.
 *
 *   GET /api/v1/categories/parents?exclude=<id>
 *
 * A static segment under the same collection as `[id]`, which Next resolves
 * ahead of the dynamic one — so this does not collide with
 * /api/v1/categories/:id.
 *
 * `exclude` keeps the category being edited out of its own parent list. The
 * deeper case (a descendant being offered as a parent, which would make a
 * cycle) is caught server-side in `updateCategory`; this just avoids rendering
 * the obviously invalid choice, same as the monolith did.
 */
export const GET = handler(async (request: Request) => {
  await requireNewsroomManager(request);

  const exclude = query(request).str("exclude") || undefined;

  return ok(request, await listParentCandidates(exclude));
});

export const OPTIONS = preflight;
