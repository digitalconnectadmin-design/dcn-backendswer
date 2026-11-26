import { cache, handler, ok, preflight } from "@/lib/api/http";
import { getCategoryTree, getFooterPages, getNavCategories } from "@/lib/site-nav";
import { getLiveTicker } from "@/lib/ticker";

export const dynamic = "force-dynamic";

/**
 *   GET /api/v1/public/chrome
 *
 * Everything the public site's header and footer need: the nav category tree,
 * the footer's page links, and the live breaking-news ticker.
 *
 * Why these three are one endpoint
 * --------------------------------
 * They're rendered by `(home)/layout.tsx`, which runs on **every** public
 * page. In the monolith that layout made three in-process queries and nobody
 * noticed. Split apart, three separate endpoints would mean three HTTP round
 * trips added to every story, category and gallery view — the layout is the
 * single hottest data path on the site, so it gets one call.
 *
 * This is the general rule for porting read paths: group by *what renders
 * together*, not by what the tables are. A faithful one-endpoint-per-query
 * translation is the main way a split like this ends up slower than the
 * monolith it replaced.
 *
 * Cached for 60s. Nav and footer pages change rarely; the ticker is the one
 * thing here that is time-sensitive, and a minute's lag on a ticker item is
 * acceptable — if it isn't, the frontend can revalidate this tag when an
 * editor publishes a ticker item.
 */
export const GET = handler(async (request: Request) => {
  const [navCategories, categoryTree, footerPages, ticker] = await Promise.all([
    getNavCategories(),
    getCategoryTree(),
    getFooterPages(),
    getLiveTicker(),
  ]);

  return ok(
    request,
    { navCategories, categoryTree, footerPages, ticker },
    { headers: cache(60) }
  );
});

export const OPTIONS = preflight;
