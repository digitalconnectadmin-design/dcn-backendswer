import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { canManageNewsroom } from "@/lib/roles";
import { db } from "@/db/drizzle";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { upsertConnection } from "@/lib/social/accounts";
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchManagedPages,
} from "@/lib/social/oauth/facebook";
import { frontendRedirect } from "@/lib/api/frontend";
import { verifyOAuthState } from "@/lib/api/oauth-state";
import { HttpError } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Facebook's redirect target. **Stays at this path** — `/api/social/oauth/...`,
 * not under /v1 — because the path is registered in the Meta developer console
 * as an allowed redirect URI, and changing it means editing six platform
 * consoles for no gain.
 *
 * This is the reference implementation for the other five callbacks. What
 * changed from the monolith:
 *
 *   - **No session read.** The old route called `auth.api.getSession()` twice
 *     and bounced to `?error=unauthorized` without one. A browser arriving
 *     here from Facebook carries no bearer token, so that check could only
 *     ever fail now. The user's identity comes out of the signed `state`
 *     instead (lib/api/oauth-state.ts).
 *
 *   - **No state cookie.** `FB_OAUTH_STATE_COOKIE` is gone; the state verifies
 *     itself. One less cross-origin cookie to reason about.
 *
 *   - **Role is re-checked from the database**, not from a session object.
 *     The state proves *who*; it does not prove they are still allowed. A user
 *     demoted or banned between starting the flow and finishing it must not
 *     get a connection written, so the role is read fresh. This check did not
 *     exist in the monolith — the session object carried the role and the
 *     10-minute window made it moot — and it is cheap insurance now that the
 *     state is a bearer of identity on its own.
 *
 *   - **Redirects land on the frontend**, via `frontendRedirect`, because
 *     /admin/settings/social is not a path this service serves.
 *
 * The pending-pages cookie is kept: it's set and read on *this* origin (the
 * callback sets it, the choose-page endpoint reads it on the next request to
 * this same service), so it is same-site and unaffected by the split.
 */
export const FB_OAUTH_PENDING_PAGES_COOKIE = "dcn_fb_oauth_pending_pages";

const SETTINGS = "/admin/settings/social";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // The user declined on Facebook's own consent screen.
  if (searchParams.get("error")) {
    return NextResponse.redirect(frontendRedirect(SETTINGS, { error: "facebook_denied" }));
  }

  let userId: string;
  try {
    ({ userId } = verifyOAuthState(searchParams.get("state"), "facebook"));
  } catch (e) {
    // verifyOAuthState throws HttpError whose message is already a stable
    // error slug (oauth_state_expired, oauth_state_mismatch, …).
    const slug = e instanceof HttpError ? e.message : "oauth_state_invalid";
    return NextResponse.redirect(frontendRedirect(SETTINGS, { error: slug }));
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(frontendRedirect(SETTINGS, { error: "facebook_no_code" }));
  }

  // Still allowed? See the note above — the state proves identity, not
  // standing.
  const [actor] = await db
    .select({ role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!actor || actor.banned || !canManageNewsroom(actor.role)) {
    return NextResponse.redirect(frontendRedirect(SETTINGS, { error: "unauthorized" }));
  }

  try {
    const shortLivedToken = await exchangeCodeForUserToken(code);
    const longLivedToken = await exchangeForLongLivedUserToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedToken);

    if (pages.length === 0) {
      return NextResponse.redirect(frontendRedirect(SETTINGS, { error: "facebook_no_pages" }));
    }

    if (pages.length === 1) {
      const page = pages[0];
      const { reconnected } = await upsertConnection({
        platform: "facebook",
        label: page.name,
        externalAccountId: page.id,
        accessToken: page.access_token,
        actorId: userId,
      });
      return NextResponse.redirect(
        frontendRedirect(SETTINGS, reconnected ? { reconnected: "facebook" } : { connected: "facebook" })
      );
    }

    // Multiple Pages managed by this account — let the admin tick which ones
    // to connect. Held briefly in an httpOnly cookie on this origin rather
    // than the DB, since it's a transient selection step and not a stored
    // connection yet.
    //
    // `sameSite: "lax"` is enough: the next request that reads it is a
    // same-origin API call from the choose-page screen, carrying a bearer
    // token. It does *not* need SameSite=None, because it is never sent on a
    // cross-site request.
    const cookieStore = await cookies();
    cookieStore.set(
      FB_OAUTH_PENDING_PAGES_COOKIE,
      JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token }))),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      }
    );

    return NextResponse.redirect(frontendRedirect("/admin/settings/social/facebook/choose-page"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "facebook_oauth_failed";
    return NextResponse.redirect(frontendRedirect(SETTINGS, { error: message }));
  }
}
