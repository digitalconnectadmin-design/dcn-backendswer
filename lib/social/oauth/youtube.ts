import { getSiteUrl } from "@/lib/site";

/*
 * `youtube.force-ssl` is what authorises both playlist placement and every
 * Live Streaming API call (liveBroadcasts, liveStreams, liveChatMessages) —
 * no extra scope is needed for Live Studio. Channels connected before it was
 * added keep publishing fine; they need a reconnect before playlists or going
 * live work, because Google does not grant a new scope to an existing token.
 */
const YOUTUBE_SCOPES =
  "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl";

function requireEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isYouTubeOAuthConfigured() {
  return requireEnv() !== null;
}

function callbackUrl() {
  return `${getSiteUrl()}/api/social/oauth/youtube/callback`;
}

export function getYouTubeAuthorizeUrl(state: string): string {
  const env = requireEnv();
  if (!env) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");

  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    // select_account: always show Google's account/Brand Account picker so
    // "Connect another channel" can reach a different channel.
    // consent: forces a refresh token even for an account that granted before.
    prompt: "select_account consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeYouTubeCode(code: string) {
  const env = requireEnv();
  if (!env) throw new Error("YouTube OAuth is not configured.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description ?? "YouTube token exchange failed.");
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number,
  };
}

export async function refreshYouTubeToken(refreshToken: string) {
  const env = requireEnv();
  if (!env) throw new Error("YouTube OAuth is not configured.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description ?? "Couldn't refresh the YouTube token.");
  return { accessToken: data.access_token as string, expiresIn: data.expires_in as number };
}

export async function fetchYouTubeChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const params = new URLSearchParams({ part: "id,snippet", mine: "true" });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.items?.[0]) {
    throw new Error(data?.error?.message ?? "Couldn't find a YouTube channel for this account.");
  }
  return { id: data.items[0].id, title: data.items[0].snippet.title };
}
