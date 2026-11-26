/**
 * This service's own public URL.
 *
 * In the monolith `getSiteUrl()` returned `NEXT_PUBLIC_SITE_URL` and served
 * two unrelated purposes, because one origin did both jobs:
 *
 *   1. the base for OAuth **redirect_uri** values sent to Facebook, X,
 *      LinkedIn, Google, TikTok — i.e. "where the platform should send the
 *      browser back to", which is wherever the callback route is hosted;
 *   2. the base for page metadata (canonical URLs, OG image URLs) — i.e.
 *      "where the public site is".
 *
 * Split apart those are two different hosts, and conflating them is a
 * particularly annoying bug: the OAuth consent screen appears normally, the
 * user approves, and the platform then redirects the browser to the
 * *frontend* at a path that only exists on the backend. The user lands on a
 * 404 after a successful authorisation, and the only clue is a redirect_uri in
 * the request log.
 *
 * So the split is:
 *
 *   - `getSiteUrl()` — **this file, this service's URL.** Every
 *     `lib/social/oauth/*` module builds its `redirect_uri` from it, which is
 *     why redefining this one file carries all seven OAuth flows over without
 *     touching them.
 *   - `frontendUrl()` — `lib/api/frontend.ts`, where to send the *user* once a
 *     flow finishes.
 *   - page metadata — gone from this project entirely; it's the frontend's.
 *
 * Whatever this returns must match the redirect URI registered in each
 * platform's developer console, exactly, including scheme and absence of a
 * trailing slash. That is the single most common reason a connect button fails
 * with `redirect_uri_mismatch`.
 */
export function getSiteUrl(): string {
  // BETTER_AUTH_URL is already required and already means "this service's
  // public URL", so it is reused rather than adding a second variable that
  // could drift from it. API_BASE_URL overrides it if a deployment ever needs
  // the two to differ (a custom domain in front of Render, say).
  const raw = process.env.API_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:4000";
  return raw.replace(/\/+$/, "");
}

/** Explicit alias, for call sites where "the API's own URL" reads better. */
export const getApiUrl = getSiteUrl;
