import { query } from "@/lib/api/body";
import { requireNewsroomManager } from "@/lib/api/guard";
import { cache, handler, ok, preflight } from "@/lib/api/http";
import { buildHomepage, getHomepageSections } from "@/lib/homepage-data";

export const dynamic = "force-dynamic";

/**
 *   GET /api/v1/public/homepage              → the live front page
 *   GET /api/v1/public/homepage?layout=draft → the builder's preview
 *
 * Returns the homepage layout *already resolved* — every section with its
 * stories, galleries, reels and poll results attached. `buildHomepage` runs a
 * dozen-odd queries depending on how the editor arranged the page, and doing
 * that over HTTP section by section would be a dozen round trips per front
 * page load.
 *
 * The `layout=draft` variant is how /preview/homepage works, and it is the one
 * exception to this route group being public: an unpublished layout is not
 * public content, so that variant requires a newsroom manager. The live
 * variant stays open.
 */
export const GET = handler(async (request: Request) => {
  const which = query(request).str("layout") === "draft" ? "draft" : "published";

  if (which === "draft") {
    await requireNewsroomManager(request);
  }

  const layout = await getHomepageSections(which);
  const sections = await buildHomepage(layout.sections);

  return ok(
    request,
    {
      sections,
      publishedAt: layout.publishedAt,
      draftUpdatedAt: layout.draftUpdatedAt,
      hasPublished: layout.hasPublished,
    },
    // A draft preview must always be the current draft — the editor is
    // looking at it to decide whether to publish.
    { headers: which === "draft" ? {} : cache(30) }
  );
});

export const OPTIONS = preflight;
