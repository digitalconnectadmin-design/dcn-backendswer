import { getSiteUrl } from "@/lib/site";
import { generateCodeVerifier, codeChallengeFromVerifier } from "@/lib/social/oauth/pkce";

const X_SCOPES = "tweet.read tweet.write users.read offline.access media.write";

function requireEnv() {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isXOAuthConfigured() {
  return requireEnv() !== null;
}

function callbackUrl() {
  return `${getSiteUrl()}/api/social/oauth/x/callback`;
}

/**
 * X is the only platform here that uses PKCE.
 *
 * `existingVerifier` is the one change this file needed for the split. In the
 * monolith the verifier was generated here and stashed in an httpOnly cookie
 * for the callback to read. That no longer works: the `/start` call is now a
 * cross-origin POST (the frontend's browser code reaches this service through
 * its own BFF), and a cookie a browser receives in a cross-origin response
 * isn't stored without `SameSite=None`. So the verifier has to travel in the
 * signed `state` instead — and the caller has to be able to make it *before*
 * minting the state it passes in here.
 *
 * Hence the optional parameter: pass a verifier and this uses it, or pass
 * nothing and it generates one as before. The state/verifier cookie pair is
 * gone; see lib/api/oauth-state.ts.
 */
export async function beginXAuthorize(state: string, existingVerifier?: string) {
  const env = requireEnv();
  if (!env) throw new Error("X_CLIENT_ID / X_CLIENT_SECRET are not set.");

  const codeVerifier = existingVerifier ?? generateCodeVerifier();
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: callbackUrl(),
    scope: X_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    authorizeUrl: `https://twitter.com/i/oauth2/authorize?${params.toString()}`,
    codeVerifier,
  };
}

export async function exchangeXCode(code: string, codeVerifier: string) {
  const env = requireEnv();
  if (!env) throw new Error("X OAuth is not configured.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    code_verifier: codeVerifier,
    client_id: env.clientId,
  });

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // X requires confidential clients to authenticate with HTTP Basic
      // auth on the token endpoint, on top of the PKCE verifier.
      Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description ?? "X token exchange failed.");
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number,
  };
}

export async function fetchXUser(accessToken: string): Promise<{ id: string; username: string }> {
  const res = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail ?? "Couldn't fetch the X account.");
  return { id: data.data.id, username: data.data.username };
}
