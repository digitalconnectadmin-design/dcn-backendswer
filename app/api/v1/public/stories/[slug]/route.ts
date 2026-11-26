import { after } from "next/server";

import { cache, handler, ok, preflight } from "@/lib/api/http";
import { countStoryView, getPublicStory } from "@/lib/services/public-stories";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 *   GET /api/v1/public/stories/:slug
 *
 * No auth: this is the public article endpoint. Only `status = 'published'`
 * rows are ever returned (enforced in the service, not here), so a draft slug
 * answers 404 exactly as the public page did.
 *
 * The view count is incremented in `after()`, so the increment happens once
 * the response has been sent rather than in front of it. That's the same
 * arrangement the page component used; what's new is that it's now counting a
 * *frontend server* read rather than a browser read, because the frontend
 * renders this page server-side. Two consequences worth knowing:
 *
 *   - a reader who hard-refreshes still counts once, as before;
 *   - if the frontend ever caches this response (see `cache` below), the count
 *     stops tracking views and starts tracking cache misses.
 *
 * The cache window is therefore deliberately short. 60 seconds is long enough
 * to absorb a traffic spike on a breaking story and short enough that
 * "most read" stays roughly honest.
 */
export const GET = handler<Ctx>(async (request, { params }) => {
  const { slug } = await params;

  const { story, related } = await getPublicStory(slug);

  after(() => countStoryView(story.id));

  return ok(request, { story, related }, { headers: cache(60) });
});

export const OPTIONS = preflight;
