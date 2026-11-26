import { getSiteUrl } from "@/lib/site";

// w_organization_social (Company Page posting) needs LinkedIn's Marketing
// Developer Platform approval — a manual review, not something this app can
// grant itself. Requesting a scope the app doesn't have approved makes
// LinkedIn reject the *entire* authorize request before showing a login
// screen at all, so this list only requests what's actually available on a
// freshly-created app. Add "w_organization_social" back here once MDP
// approval comes through, and see lib/social/linkedin.ts for what else that
// unlocks.
const LINKEDIN_SCOPES = "openid profile email w_member_social";

function requireEnv() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isLinkedInOAuthConfigured() {
  return requireEnv() !== null;
}

function callbackUrl() {
  return `${getSiteUrl()}/api/social/oauth/linkedin/callback`;
}

export function getLinkedInAuthorizeUrl(state: string): string {
  const env = requireEnv();
  if (!env) throw new Error("LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET are not set.");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: callbackUrl(),
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export async function exchangeLinkedInCode(code: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const env = requireEnv();
  if (!env) throw new Error("LinkedIn OAuth is not configured.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description ?? "LinkedIn token exchange failed.");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * The signed-in member's identity, via the standard OpenID Connect
 * `/userinfo` endpoint. `sub` is LinkedIn's member id — combined with
 * "urn:li:person:" it's the exact `author` value LinkedIn's Posts API wants
 * for posting to a personal profile, which is what `w_member_social` (the
 * scope this app actually has) grants. There's no page/org to pick here —
 * unlike Facebook, a personal LinkedIn profile has only one identity.
 */
export async function fetchLinkedInIdentity(
  accessToken: string
): Promise<{ personUrn: string; name: string }> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.sub) {
    throw new Error(data?.message ?? "Couldn't read the LinkedIn account's identity.");
  }
  return { personUrn: `urn:li:person:${data.sub}`, name: data.name ?? "LinkedIn account" };
}
