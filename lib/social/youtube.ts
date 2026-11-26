import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { fetchBytes, readJson } from "@/lib/social/http";
import { refreshYouTubeToken } from "@/lib/social/oauth/youtube";

async function ensureFreshToken(connection: SocialConnectionRecord) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;
  if (!needsRefresh || !connection.refreshToken) {
    return { accessToken: connection.accessToken, refreshed: undefined };
  }
  try {
    const refreshed = await refreshYouTubeToken(connection.refreshToken);
    const tokens = {
      accessToken: refreshed.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    };
    await connection.onTokenRefresh?.(tokens);
    return { accessToken: tokens.accessToken, refreshed: tokens };
  } catch (e) {
    // A refresh token Google won't honour (revoked access, password change)
    // is exactly the "reconnect this channel" case.
    throw new SocialApiError(e instanceof Error ? e.message : "Couldn't refresh the YouTube token.", true);
  }
}

function googleError(data: Record<string, unknown> | null, status: number, what: string) {
  const err = data?.error as { message?: string } | undefined;
  return new SocialApiError(
    err?.message ? `${what}: ${err.message}` : `${what} (HTTP ${status}).`,
    status === 401
  );
}

/**
 * YouTube publishes videos only — its public Data API has no endpoint for a
 * Community (text/photo) post. Shorts aren't a separate upload type either:
 * YouTube classifies a vertical or square video of 3 minutes or less as a
 * Short on its own. Publishing as "Short" therefore means: validated to be
 * Short-shaped in the composer, and tagged #Shorts here.
 */
async function uploadVideo(request: PublishRequest, accessToken: string): Promise<PublishResult> {
  const video = request.media.find((m) => m.kind === "video");
  if (!video) throw new SocialApiError("YouTube needs a video — none was selected.");

  const yt = request.options.youtube;
  let title = (request.title || request.caption.split("\n")[0] || "Untitled").slice(0, 100);
  let description = request.caption;
  if (request.contentType === "short" && !/#shorts/i.test(`${title} ${description}`)) {
    description = `${description}\n\n#Shorts`.trim();
    if (title.length <= 92) title = `${title} #Shorts`;
  }

  const { bytes, contentType } = await fetchBytes(video.url, "video");

  const metadata = {
    snippet: {
      title,
      description: description.slice(0, 5000),
      tags: yt?.tags?.slice(0, 30) ?? [],
      categoryId: yt?.categoryId || "25",
    },
    status: {
      privacyStatus: yt?.visibility ?? "public",
      selfDeclaredMadeForKids: false,
    },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": String(bytes.byteLength),
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!initRes.ok) throw googleError(await readJson(initRes), initRes.status, "YouTube couldn't start the upload");
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new SocialApiError("YouTube didn't return an upload URL.");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      // Required by Google's resumable protocol even for a single PUT —
      // without it YouTube can show "Processing abandoned" on a video our
      // side recorded as posted. See the note in CLAUDE.md.
      "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
    },
    body: bytes,
  });
  const uploaded = await readJson(uploadRes);
  if (!uploadRes.ok) throw googleError(uploaded, uploadRes.status, "YouTube video upload failed");
  const videoId = String(uploaded?.id);

  const warnings: string[] = [];

  if (request.thumbnailUrl) {
    try {
      const thumb = await fetchBytes(request.thumbnailUrl, "thumbnail");
      const res = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": thumb.contentType },
          body: thumb.bytes,
        }
      );
      if (!res.ok) {
        const err = (await readJson(res))?.error as { message?: string } | undefined;
        warnings.push(
          `Custom thumbnail not applied${err?.message ? ` (${err.message})` : ""} — custom thumbnails need a verified channel.`
        );
      }
    } catch (e) {
      warnings.push(`Custom thumbnail not applied: ${e instanceof Error ? e.message : "download failed"}.`);
    }
  }

  if (yt?.playlistId) {
    const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: { playlistId: yt.playlistId, resourceId: { kind: "youtube#video", videoId } },
      }),
    });
    if (!res.ok) {
      warnings.push(
        res.status === 403
          ? "Not added to the playlist — reconnect this channel to grant playlist access."
          : "Not added to the playlist — YouTube rejected the request."
      );
    }
  }

  return {
    externalPostId: videoId,
    permalink:
      request.contentType === "short"
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://www.youtube.com/watch?v=${videoId}`,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

export const youtubePublisher: SocialPublisher = {
  platform: "youtube",
  contentTypes: ["video", "short"],

  async publish(request: PublishRequest, connection: SocialConnectionRecord) {
    if (request.contentType !== "video" && request.contentType !== "short") {
      throw new SocialApiError(`YouTube can't publish a ${request.contentType} — choose Video or Short.`);
    }
    const { accessToken, refreshed } = await ensureFreshToken(connection);
    const result = await uploadVideo(request, accessToken);
    return { ...result, refreshedToken: refreshed };
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const { accessToken, refreshed } = await ensureFreshToken(connection);
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await readJson(res);
    if (!res.ok) throw googleError(data, res.status, "Couldn't read the YouTube channel");
    const item = (data?.items as Record<string, unknown>[] | undefined)?.[0];
    if (!item) throw new SocialApiError("This Google account no longer has a YouTube channel.", true);
    const snippet = item.snippet as {
      title?: string;
      customUrl?: string;
      thumbnails?: { default?: { url?: string } };
    };
    const stats = item.statistics as { subscriberCount?: string; hiddenSubscriberCount?: boolean } | undefined;
    return {
      label: snippet.title ?? null,
      username: snippet.customUrl ?? null,
      avatarUrl: snippet.thumbnails?.default?.url ?? null,
      followerCount: stats && !stats.hiddenSubscriberCount && stats.subscriberCount ? Number(stats.subscriberCount) : null,
      accountType: "YouTube channel",
      refreshedToken: refreshed,
    };
  },
};

/** The channel's own playlists, for the composer's playlist picker. */
export async function listYouTubePlaylists(connection: SocialConnectionRecord) {
  const { accessToken, refreshed } = await ensureFreshToken(connection);
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await readJson(res);
  if (!res.ok) throw googleError(data, res.status, "Couldn't load playlists");
  const items = (data?.items as { id: string; snippet?: { title?: string } }[] | undefined) ?? [];
  return {
    playlists: items.map((p) => ({ id: p.id, title: p.snippet?.title ?? "Untitled playlist" })),
    refreshed,
  };
}
