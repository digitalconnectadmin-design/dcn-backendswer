import { auth } from "@/lib/auth";
import { corsHeaders, isAllowedOrigin } from "@/lib/api/cors";

/**
 * better-auth's own handler — sign-in, sign-up, sign-out, session reads, the
 * admin plugin's user-management endpoints, and every OAuth callback.
 *
 * Unlike the monolith this can't just be `toNextJsHandler(auth)`: the caller
 * is on another origin, so each response needs CORS headers. In particular
 * `set-auth-token` has to be in `Access-Control-Expose-Headers` or the
 * frontend can't read the token better-auth issues, and sign-in looks like it
 * succeeded while leaving the frontend with nothing to store. That list lives
 * in lib/api/cors.ts.
 *
 * Note the path is `/api/auth/*`, not `/api/v1/auth/*` — better-auth builds
 * its own URLs from `basePath` and the client SDK expects the default. Moving
 * it under /v1 means configuring both ends and gains nothing.
 */

function withCors(response: Response, origin: string | null): Response {
  if (!isAllowedOrigin(origin)) return response;

  // Headers are copied rather than mutated: a Response returned by
  // better-auth may have immutable headers depending on how it was built.
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request) {
  return withCors(await auth.handler(request), request.headers.get("origin"));
}

export async function POST(request: Request) {
  return withCors(await auth.handler(request), request.headers.get("origin"));
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}
