import { getSiteUrl } from "@/lib/site";

const TIKTOK_SCOPES = "user.info.basic,video.publish";

function requireEnv() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret };
}

export function isTikTokOAuthConfigured() {
  return requireEnv() !== null;
}

function callbackUrl() {
  return `${getSiteUrl()}/api/social/oauth/tiktok/callback`;
}

export function getTikTokAuthorizeUrl(state: string): string {
  const env = requireEnv();
  if (!env) throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set.");

  const params = new URLSearchParams({
    client_key: env.clientKey,
    scope: TIKTOK_SCOPES,
    response_type: "code",
    redirect_uri: callbackUrl(),
    state,
    // Show TikTok's confirm screen instead of silently re-authorising the
    // signed-in account, so "Connect another account" can switch accounts.
    disable_auto_auth: "1",
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export async function exchangeTikTokCode(code: string) {
  const env = requireEnv();
  if (!env) throw new Error("TikTok OAuth is not configured.");

  const body = new URLSearchParams({
    client_key: env.clientKey,
    client_secret: env.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(),
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.error_description ?? "TikTok token exchange failed.");
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
    openId: data.open_id as string,
  };
}

export async function refreshTikTokToken(refreshToken: string) {
  const env = requireEnv();
  if (!env) throw new Error("TikTok OAuth is not configured.");

  const body = new URLSearchParams({
    client_key: env.clientKey,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.error_description ?? "Couldn't refresh the TikTok token.");
  }
  return { accessToken: data.access_token as string, expiresIn: data.expires_in as number };
}

export async function fetchTikTokUser(accessToken: string): Promise<{ displayName: string }> {
  const params = new URLSearchParams({ fields: "display_name" });
  const res = await fetch(`https://open.tiktokapis.com/v2/user/info/?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(data?.error?.message ?? "Couldn't fetch the TikTok account.");
  }
  return { displayName: data.data.user.display_name };
}
