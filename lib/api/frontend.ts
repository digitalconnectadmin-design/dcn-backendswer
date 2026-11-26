/**
 * Where the frontend lives.
 *
 * The monolith's `lib/site.ts` read `NEXT_PUBLIC_SITE_URL` and used it for two
 * different jobs that have now come apart:
 *
 *   - building absolute URLs in page metadata (OG tags, canonical links) —
 *     that is the frontend's job now and stays there;
 *   - deciding where to send the browser after an OAuth redirect — that is
 *     this file.
 *
 * Keeping them separate matters because the backend has no idea what the
 * public site's hostname is unless it's told, and an OAuth callback that
 * redirects to the backend's own origin lands the user on a bare JSON 404
 * after a successful connection.
 */

/** The frontend's origin, no trailing slash. */
export function frontendUrl(): string {
  const raw = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * An absolute URL on the frontend, with query params.
 *
 * Replaces the `settingsUrl({ ... })` helpers that each OAuth callback
 * defined for itself.
 */
export function frontendRedirect(path: string, params: Record<string, string> = {}): URL {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, frontendUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}
