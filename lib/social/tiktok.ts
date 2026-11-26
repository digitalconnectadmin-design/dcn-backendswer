import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { readJson, sleep } from "@/lib/social/http";
import { refreshTikTokToken } from "@/lib/social/oauth/tiktok";

async function ensureFreshToken(connection: SocialConnectionRecord) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;
  if (!needsRefresh || !connection.refreshToken) {
    return { accessToken: connection.accessToken, refreshed: undefined };
  }
  try {
    const refreshed = await refreshTikTokToken(connection.refreshToken);
    const tokens = {
      accessToken: refreshed.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    };
    await connection.onTokenRefresh?.(tokens);
    return { accessToken: tokens.accessToken, refreshed: tokens };
  } catch (e) {
    throw new SocialApiError(e instanceof Error ? e.message : "Couldn't refresh the TikTok token.", true);
  }
}

type TikTokError = { code?: string; message?: string };

function tiktokError(data: Record<string, unknown> | null, status: number, what: string) {
  const err = data?.error as TikTokError | undefined;
  const auth = status === 401 || err?.code === "access_token_invalid" || err?.code === "scope_not_authorized";
  return new SocialApiError(err?.message ? `${what}: ${err.message}` : `${what} (HTTP ${status}).`, auth);
}

/**
 * TikTok publishes asynchronously: `init` returns a publish id and TikTok
 * pulls the video itself. We poll the status for up to a minute so a
 * rejected video (wrong format, too long) is reported as a failure with
 * TikTok's reason instead of a false "posted".
 */
async function waitForPublish(accessToken: string, publishId: string): Promise<string | null> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = await readJson(res);
    const status = (data?.data as { status?: string; fail_reason?: string } | undefined) ?? {};
    if (status.status === "FAILED") {
      throw new SocialApiError(`TikTok rejected the video${status.fail_reason ? `: ${status.fail_reason}` : "."}`);
    }
    if (status.status === "PUBLISH_COMPLETE" || status.status === "SEND_TO_USER_INBOX") return null;
  }
  return "TikTok is still processing the video — it can take a few minutes to appear.";
}

export const tiktokPublisher: SocialPublisher = {
  platform: "tiktok",
  contentTypes: ["video"],

  async publish(request: PublishRequest, connection: SocialConnectionRecord): Promise<PublishResult> {
    if (request.contentType !== "video") {
      throw new SocialApiError(`TikTok can't publish a ${request.contentType} — TikTok takes videos only.`);
    }
    const video = request.media.find((m) => m.kind === "video");
    if (!video) throw new SocialApiError("TikTok needs a video — none was selected.");
    const { accessToken, refreshed } = await ensureFreshToken(connection);

    // PULL_FROM_URL requires the video's domain to be verified in the
    // TikTok developer portal. SELF_ONLY is forced by TikTok until this app
    // passes its audit — posts are private to the account until then.
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: request.caption.slice(0, 2200),
          privacy_level: "SELF_ONLY",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: { source: "PULL_FROM_URL", video_url: video.url },
      }),
    });
    const init = await readJson(initRes);
    const code = (init?.error as TikTokError | undefined)?.code;
    if (!initRes.ok || (code && code !== "ok")) throw tiktokError(init, initRes.status, "TikTok publish couldn't start");

    const publishId = String((init?.data as { publish_id?: string } | undefined)?.publish_id);
    const pending = await waitForPublish(accessToken, publishId);
    return {
      externalPostId: publishId,
      permalink: null,
      warning: [
        pending,
        "Posted as private (SELF_ONLY) — TikTok requires an app audit before public posting.",
      ]
        .filter(Boolean)
        .join(" "),
      refreshedToken: refreshed,
    };
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const { accessToken, refreshed } = await ensureFreshToken(connection);
    const res = await fetch(
      `https://open.tiktokapis.com/v2/user/info/?${new URLSearchParams({ fields: "display_name,avatar_url" })}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await readJson(res);
    const code = (data?.error as TikTokError | undefined)?.code;
    if (!res.ok || (code && code !== "ok")) throw tiktokError(data, res.status, "Couldn't read the TikTok account");
    const user = (data?.data as { user?: { display_name?: string; avatar_url?: string } } | undefined)?.user;
    return {
      label: user?.display_name ?? null,
      avatarUrl: user?.avatar_url ?? null,
      // Follower counts need TikTok's user.info.stats scope, which this app doesn't request.
      followerCount: null,
      accountType: "TikTok account",
      refreshedToken: refreshed,
    };
  },
};
