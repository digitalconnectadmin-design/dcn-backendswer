import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { fetchBytes } from "@/lib/social/http";

function requireEnv() {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new SocialApiError("X OAuth is not configured.");
  return { clientId, clientSecret };
}

/**
 * Every X API response gets parsed through here rather than `res.json()`
 * directly. `res.json()` throws an opaque "Unexpected end of JSON input"
 * when the body is empty or isn't JSON at all — which is exactly what
 * happens against a wrong/dead endpoint, an edge-proxy error page, or some
 * X error responses that come back as plain text.
 */
async function parseXResponse(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text();
  if (!raw) {
    throw new SocialApiError(`X returned an empty response (status ${res.status}).`, res.status === 401);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new SocialApiError(`X returned a non-JSON response (status ${res.status}): ${raw.slice(0, 200)}`);
  }
}

/**
 * X's v2 "invalid-request" problem type nests the specific reason inside
 * `errors[].message`, while the top-level `detail` is the same generic
 * sentence regardless of cause — so the specific message is checked first.
 */
function xError(data: Record<string, unknown> | null, status: number, fallback: string) {
  const errors = data?.errors as { message?: string }[] | undefined;
  const specific = errors?.[0]?.message;
  const detail = typeof data?.detail === "string" ? data.detail : undefined;
  const title = typeof data?.title === "string" ? data.title : undefined;
  const message = specific ?? detail ?? title;
  return new SocialApiError(message ? `${fallback}: ${message}` : `${fallback} (status ${status}).`, status === 401);
}

/**
 * X access tokens live ~2 hours. Refreshes ahead of expiry and hands the new
 * tokens back so the orchestrator can persist them.
 */
async function ensureFreshToken(connection: SocialConnectionRecord) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;
  if (!needsRefresh || !connection.refreshToken) {
    return { accessToken: connection.accessToken, refreshed: undefined };
  }

  const env = requireEnv();
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: env.clientId,
    }),
  });
  const data = await parseXResponse(res);
  if (!res.ok) {
    throw new SocialApiError(
      (data.error_description as string) ?? "Couldn't refresh the X access token — reconnect the account.",
      true
    );
  }
  const refreshed = {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? connection.refreshToken ?? undefined,
    expiresAt: new Date(Date.now() + (data.expires_in as number) * 1000),
  };
  // Persist immediately: X has just invalidated the old refresh token.
  await connection.onTokenRefresh?.(refreshed);
  return { accessToken: refreshed.accessToken, refreshed };
}

const UPLOAD_URL = "https://api.x.com/2/media/upload";

/**
 * Chunked upload against the v2 media endpoint (the v1.1 endpoint was
 * retired in 2025 — see CLAUDE.md). Used for both images (tweet_image) and
 * videos (tweet_video); each APPEND part carries an explicit content type
 * because X rejects a part with an empty one as "missing media field".
 */
async function uploadMedia(accessToken: string, url: string, kind: "image" | "video"): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url, kind === "video" ? "video" : "image");
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const initForm = new FormData();
  initForm.append("command", "INIT");
  initForm.append("media_type", contentType);
  initForm.append("total_bytes", String(bytes.byteLength));
  initForm.append("media_category", kind === "video" ? "tweet_video" : "tweet_image");
  const initRes = await fetch(UPLOAD_URL, { method: "POST", headers: authHeader, body: initForm });
  const init = await parseXResponse(initRes);
  if (!initRes.ok) throw xError(init, initRes.status, "X media upload couldn't start");
  const mediaId = (init.data as { id?: string } | undefined)?.id;
  if (!mediaId) throw new SocialApiError("X media upload didn't return a media id.");

  const CHUNK_SIZE = 4 * 1024 * 1024;
  for (let offset = 0, segment = 0; offset < bytes.byteLength; offset += CHUNK_SIZE, segment += 1) {
    const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", mediaId);
    form.append("segment_index", String(segment));
    form.append("media", new Blob([chunk], { type: contentType }), `chunk-${segment}`);
    const appendRes = await fetch(UPLOAD_URL, { method: "POST", headers: authHeader, body: form });
    if (!appendRes.ok) {
      const err = await parseXResponse(appendRes).catch(() => null);
      throw xError(err, appendRes.status, "X media upload failed");
    }
  }

  const finalizeForm = new FormData();
  finalizeForm.append("command", "FINALIZE");
  finalizeForm.append("media_id", mediaId);
  const finalizeRes = await fetch(UPLOAD_URL, { method: "POST", headers: authHeader, body: finalizeForm });
  const finalize = await parseXResponse(finalizeRes);
  if (!finalizeRes.ok) throw xError(finalize, finalizeRes.status, "X media upload couldn't finish");

  type Processing = { state: string; check_after_secs?: number; error?: { message?: string } };
  let processing = (finalize.data as { processing_info?: Processing } | undefined)?.processing_info;
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new SocialApiError(`X couldn't process the ${kind}${processing.error?.message ? `: ${processing.error.message}` : "."}`);
    }
    await new Promise((r) => setTimeout(r, (processing!.check_after_secs ?? 1) * 1000));
    const statusRes = await fetch(
      `${UPLOAD_URL}?${new URLSearchParams({ command: "STATUS", media_id: mediaId })}`,
      { headers: authHeader }
    );
    const status = await parseXResponse(statusRes);
    if (!statusRes.ok) throw xError(status, statusRes.status, "X media status check failed");
    processing = (status.data as { processing_info?: Processing } | undefined)?.processing_info;
  }
  return mediaId;
}

async function postTweet(accessToken: string, text: string, mediaIds: string[]): Promise<string> {
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  const data = await parseXResponse(res);
  if (!res.ok) throw xError(data, res.status, "X post failed");
  return (data.data as { id: string }).id;
}

export const xPublisher: SocialPublisher = {
  platform: "x",
  contentTypes: ["post"],

  /**
   * Text, a link (inside the text — X builds the card itself), up to four
   * images, or one video. X charges per post, and posts containing a URL
   * cost more under its 2026 pay-per-use pricing.
   */
  async publish(request: PublishRequest, connection: SocialConnectionRecord): Promise<PublishResult> {
    if (request.contentType !== "post") {
      throw new SocialApiError(`X can't publish a ${request.contentType} — X only has posts.`);
    }
    const { accessToken, refreshed } = await ensureFreshToken(connection);

    const video = request.media.find((m) => m.kind === "video");
    const images = request.media.filter((m) => m.kind === "image").slice(0, 4);
    const mediaIds: string[] = [];
    if (video) {
      mediaIds.push(await uploadMedia(accessToken, video.url, "video"));
    } else {
      for (const image of images) mediaIds.push(await uploadMedia(accessToken, image.url, "image"));
    }

    const id = await postTweet(accessToken, request.caption, mediaIds);
    const skipped = request.media.filter((m) => m.kind === "image").length - images.length;
    return {
      externalPostId: id,
      permalink: `https://x.com/i/web/status/${id}`,
      warning:
        video && images.length
          ? "X allows either one video or images in a post — only the video was attached."
          : skipped > 0
            ? `X allows 4 images per post — ${skipped} extra image(s) were left out.`
            : null,
      refreshedToken: refreshed,
    };
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const { accessToken, refreshed } = await ensureFreshToken(connection);
    const res = await fetch(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics,name,username",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await parseXResponse(res);
    if (!res.ok) throw xError(data, res.status, "Couldn't read the X account");
    const u = data.data as {
      username?: string;
      name?: string;
      profile_image_url?: string;
      public_metrics?: { followers_count?: number };
    };
    return {
      label: u.username ? `@${u.username}` : null,
      username: u.username ?? null,
      avatarUrl: u.profile_image_url ?? null,
      followerCount: u.public_metrics?.followers_count ?? null,
      accountType: "X account",
      refreshedToken: refreshed,
    };
  },
};
