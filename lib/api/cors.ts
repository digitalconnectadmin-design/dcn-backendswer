/**
 * CORS for the split deployment.
 *
 * The frontend is a different origin now, so every response this API sends has
 * to say so explicitly or the browser throws the body away before any of our
 * code sees it. The usual symptom of getting this wrong is a request that
 * clearly succeeded in the Render logs and a frontend that reports a network
 * error — so this is worth reading once rather than debugging twice.
 *
 * Origins are read from `CORS_ORIGINS` (comma-separated). Localhost ports are
 * allowed in development only, so a production deployment can't be called from
 * someone's laptop build.
 */

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
];

function configured(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Every origin allowed to call this API.
 *
 * Shared with better-auth's own `trustedOrigins` (see lib/auth.ts) so the two
 * can't disagree — a mismatch there produces a sign-in that fails with a bare
 * 403 and no explanation.
 */
export const trustedOrigins: string[] = [
  ...configured(),
  ...(process.env.NODE_ENV === "development" ? DEV_ORIGINS : []),
];

/** Is this Origin header one we answer to? */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return trustedOrigins.includes(origin.replace(/\/+$/, ""));
}

/**
 * CORS headers for a response.
 *
 * `Access-Control-Allow-Origin` is echoed back rather than set to `*` on
 * purpose: `*` is incompatible with `Allow-Credentials`, and we still want
 * cookies to work for same-site debugging and OAuth.
 *
 * `set-auth-token` is in `Expose-Headers` because that is how the frontend
 * receives the session token after sign-in. Without it the header is present
 * on the wire and invisible to JavaScript, and login appears to succeed while
 * leaving the frontend with nothing to store.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin as string,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-requested-with",
    "access-control-expose-headers": "set-auth-token",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
