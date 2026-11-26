import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { corsHeaders, isAllowedOrigin } from "@/lib/api/cors";

/**
 * Next 16's renamed `middleware.ts`. In the monolith this file gated
 * `/admin/*` on a session cookie; there are no pages here, so its job is
 * entirely different now: it is the CORS safety net.
 *
 * Two things happen here that are awkward to do per-route:
 *
 * 1. **Preflight.** A browser sends `OPTIONS` before any request carrying an
 *    `Authorization` header or a JSON content type — which is every write this
 *    API serves. Answering it here means a route that forgets to export
 *    `OPTIONS` still works, instead of failing with a CORS error that looks
 *    nothing like a missing export.
 *
 * 2. **Headers on responses from routes ported verbatim.** The broadcast
 *    routes (`/api/broadcast/cg/state`, `/api/broadcast/studio/signal`) came
 *    across from the monolith unchanged — they're polled hard by the CG output
 *    page and the studio, their logic is subtle, and rewriting their twelve
 *    return statements to thread CORS headers through would be a lot of risk
 *    for no behavioural gain. Adding the headers on the way out costs nothing
 *    and leaves those files diffable against the originals.
 *
 * Routes that build their responses through `lib/api/http.ts` already set
 * these headers themselves; setting them again here is harmless (same values)
 * and keeps the rule in one place.
 *
 * What this does NOT do is authenticate anything. Every route checks the
 * session itself — see the note at the top of lib/api/guard.ts. A middleware
 * that looked like a gate would invite someone to skip the real check.
 */
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  // Preflight: answer and stop.
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  const response = NextResponse.next();

  if (isAllowedOrigin(origin)) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  // Everything this service serves is under /api. Matching only that keeps
  // Next's own internals out of the middleware path.
  matcher: ["/api/:path*"],
};
