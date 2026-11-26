import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { HttpError } from "@/lib/api/http";

/**
 * Signed OAuth state, and why the split needed it.
 *
 * The problem
 * -----------
 * In the monolith, connecting a social account was:
 *
 *   1. browser navigates to /api/social/oauth/facebook/start
 *   2. the route reads the session cookie, checks the role, sets a random
 *      `state` in an httpOnly cookie, redirects to Facebook
 *   3. Facebook redirects back to /api/social/oauth/facebook/callback
 *   4. the route reads the session cookie *again* to know who is connecting,
 *      compares the state cookie, stores the connection
 *
 * Steps 2 and 4 both depend on a session cookie arriving on a **top-level
 * browser navigation**. Split apart, that breaks: the frontend authenticates
 * with an `Authorization` header, and a header cannot be attached to a
 * navigation — there is no fetch involved, the browser is just following a
 * redirect. So the backend would see an anonymous request and bounce the user
 * back to the settings page with `error=unauthorized`, which is exactly the
 * failure a reader of the old code would not expect.
 *
 * The fix
 * -------
 * Move the identity *into the state parameter*, signed. The flow becomes:
 *
 *   1. frontend calls POST /api/v1/social/oauth/:platform/start **with its
 *      bearer token** — an ordinary authenticated API call, so the role check
 *      happens exactly as before — and gets back an authorize URL
 *   2. frontend does `window.location.assign(authorizeUrl)`
 *   3. the platform redirects to the callback with our `state` echoed back
 *   4. the callback verifies the signature and reads the user id out of it —
 *      no session cookie needed, because the state *is* the proof
 *
 * Why this is not weaker than before
 * ----------------------------------
 * The state is HMAC-SHA256'd with `BETTER_AUTH_SECRET`, so it can't be forged
 * without the server secret. It carries an expiry (10 minutes, matching the
 * old cookie's `maxAge`) and a random nonce. CSRF protection is unchanged in
 * kind: the old version proved "the browser that started this flow is the one
 * finishing it" by comparing a cookie; this proves "this server started this
 * flow, for this user, recently" by verifying a signature. The second is the
 * stronger claim — a state value stolen in transit still can't be replayed
 * past its expiry, and can't be pointed at a different user.
 *
 * The one thing it does not do is bind the flow to a browser, so a state value
 * leaked within its 10-minute window could be completed by someone else — and
 * completing it only ever writes a connection for the user named inside it.
 * The platform's own redirect-URI allowlist is what keeps the code from being
 * delivered anywhere but this callback.
 *
 * PKCE verifiers ride along in the same envelope (see `extra`), which is what
 * X and TikTok need and what the old code kept in a second cookie.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes, as the old state cookie had

type StatePayload = {
  /** Who is connecting. Read by the callback in place of a session. */
  userId: string;
  /** Which platform, so a state minted for one can't be replayed at another. */
  platform: string;
  /** Expiry, epoch ms. */
  exp: number;
  /** Random, so two flows started in the same millisecond differ. */
  nonce: string;
  /** PKCE verifier and anything else a specific platform's flow needs. */
  extra?: Record<string, string>;
};

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) {
    // Failing loudly here beats minting states nobody can verify after a
    // restart with a different (or absent) secret.
    throw new HttpError(500, "BETTER_AUTH_SECRET is not set — OAuth state can't be signed.");
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(body: string): string {
  return b64url(createHmac("sha256", secret()).update(body).digest());
}

/** Mints a state value to hand to the platform's authorize URL. */
export function createOAuthState(input: {
  userId: string;
  platform: string;
  extra?: Record<string, string>;
}): string {
  const payload: StatePayload = {
    userId: input.userId,
    platform: input.platform,
    exp: Date.now() + TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
    ...(input.extra ? { extra: input.extra } : {}),
  };

  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export type VerifiedState = {
  userId: string;
  platform: string;
  extra: Record<string, string>;
};

/**
 * Verifies a state value echoed back by a platform.
 *
 * Throws rather than returning null so a callback route can't accidentally
 * carry on with an unverified user id — the thrown message is the thing the
 * user sees in `?error=` on the settings page, so each case is named.
 */
export function verifyOAuthState(state: string | null, platform: string): VerifiedState {
  if (!state) throw new HttpError(400, "oauth_state_missing");

  const dot = state.lastIndexOf(".");
  if (dot <= 0) throw new HttpError(400, "oauth_state_malformed");

  const body = state.slice(0, dot);
  const given = state.slice(dot + 1);
  const expected = sign(body);

  // Constant-time compare. Lengths must match first — timingSafeEqual throws
  // on a length mismatch rather than returning false.
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(400, "oauth_state_mismatch");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    throw new HttpError(400, "oauth_state_malformed");
  }

  if (payload.platform !== platform) throw new HttpError(400, "oauth_state_platform_mismatch");
  if (!payload.exp || payload.exp < Date.now()) throw new HttpError(400, "oauth_state_expired");
  if (!payload.userId) throw new HttpError(400, "oauth_state_no_user");

  return {
    userId: payload.userId,
    platform: payload.platform,
    extra: payload.extra ?? {},
  };
}
