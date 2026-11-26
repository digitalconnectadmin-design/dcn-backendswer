import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { readJson, sleep } from "@/lib/social/http";
import { GRAPH, graphGet, graphPost } from "@/lib/social/meta-graph";

/**
 * Instagram publishing is always a two-step container flow: create a media
 * container, wait until Meta finishes processing it, then publish it. The
 * content type decides the container:
 *
 *   post  → IMAGE (one photo), CAROUSEL (several), or REELS shared to the
 *           feed for a video — Instagram's API has no plain "video post"
 *           any more, so a video Post is honestly reported as a Reel.
 *   reel  → REELS, shared to the feed, with an optional cover image
 *   story → STORIES (photo or video; Instagram Stories take no caption)
 */

async function createContainer(igId: string, token: string, params: Record<string, string>, what: string) {
  const data = await graphPost(`${GRAPH}/${igId}/media`, { ...params, access_token: token }, what);
  return String(data.id);
}

async function waitForContainer(containerId: string, token: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${GRAPH}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`
    );
    const data = await readJson(res);
    const code = data?.status_code;
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      const detail = typeof data?.status === "string" ? data.status : "";
      throw new SocialApiError(`Instagram couldn't process the media${detail ? `: ${detail}` : "."}`);
    }
    await sleep(4000);
  }
  throw new SocialApiError("Instagram took too long to process the media. Retry in a few minutes.");
}

async function publishContainer(igId: string, token: string, containerId: string): Promise<PublishResult> {
  const data = await graphPost(
    `${GRAPH}/${igId}/media_publish`,
    { creation_id: containerId, access_token: token },
    "Instagram didn't publish the media"
  );
  const mediaId = String(data.id);
  let permalink: string | null = null;
  try {
    const info = await graphGet(`${GRAPH}/${mediaId}`, { fields: "permalink", access_token: token }, "permalink");
    permalink = typeof info.permalink === "string" ? info.permalink : null;
  } catch {
    // Stories have no permalink; a failed lookup never fails a published post.
  }
  return { externalPostId: mediaId, permalink };
}

const VIDEO_TIMEOUT = 5 * 60_000;
const IMAGE_TIMEOUT = 60_000;

async function publishReel(
  igId: string,
  token: string,
  request: PublishRequest,
  what: string
): Promise<PublishResult> {
  const video = request.media.find((m) => m.kind === "video");
  if (!video) throw new SocialApiError(`${what} needs a video — none was selected.`);
  const container = await createContainer(
    igId,
    token,
    {
      media_type: "REELS",
      video_url: video.url,
      caption: request.caption,
      share_to_feed: "true",
      ...(request.thumbnailUrl ? { cover_url: request.thumbnailUrl } : {}),
    },
    "Instagram couldn't create the Reel"
  );
  await waitForContainer(container, token, VIDEO_TIMEOUT);
  return publishContainer(igId, token, container);
}

async function publishPost(igId: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const images = request.media.filter((m) => m.kind === "image");
  const hasVideo = request.media.some((m) => m.kind === "video");

  if (hasVideo) {
    const result = await publishReel(igId, token, request, "An Instagram video post");
    return {
      ...result,
      warning: "Instagram's API publishes feed videos as Reels (shared to the feed) — there's no separate video post type.",
    };
  }
  if (images.length === 0) {
    throw new SocialApiError("An Instagram post needs a photo or a video — Instagram has no text-only posts.");
  }

  if (images.length === 1) {
    const container = await createContainer(
      igId,
      token,
      { image_url: images[0].url, caption: request.caption },
      "Instagram couldn't create the photo post"
    );
    await waitForContainer(container, token, IMAGE_TIMEOUT);
    return publishContainer(igId, token, container);
  }

  const children: string[] = [];
  for (const image of images.slice(0, 10)) {
    children.push(
      await createContainer(
        igId,
        token,
        { image_url: image.url, is_carousel_item: "true" },
        "Instagram couldn't add a photo to the carousel"
      )
    );
  }
  for (const child of children) await waitForContainer(child, token, IMAGE_TIMEOUT);
  const carousel = await createContainer(
    igId,
    token,
    { media_type: "CAROUSEL", children: children.join(","), caption: request.caption },
    "Instagram couldn't create the carousel"
  );
  await waitForContainer(carousel, token, IMAGE_TIMEOUT);
  return publishContainer(igId, token, carousel);
}

async function publishStory(igId: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const item = request.media[0];
  if (!item) throw new SocialApiError("An Instagram Story needs a photo or a video — none was selected.");
  const container = await createContainer(
    igId,
    token,
    item.kind === "video"
      ? { media_type: "STORIES", video_url: item.url }
      : { media_type: "STORIES", image_url: item.url },
    "Instagram couldn't create the Story"
  );
  await waitForContainer(container, token, item.kind === "video" ? VIDEO_TIMEOUT : IMAGE_TIMEOUT);
  const result = await publishContainer(igId, token, container);
  return request.caption.trim()
    ? { ...result, warning: "Instagram Stories don't show captions — the text wasn't included." }
    : result;
}

export const instagramPublisher: SocialPublisher = {
  platform: "instagram",
  contentTypes: ["post", "reel", "story"],

  async publish(request: PublishRequest, connection: SocialConnectionRecord) {
    const igId = connection.externalAccountId;
    const token = connection.accessToken;
    switch (request.contentType) {
      case "reel":
        return publishReel(igId, token, request, "An Instagram Reel");
      case "story":
        return publishStory(igId, token, request);
      case "post":
        return publishPost(igId, token, request);
      default:
        throw new SocialApiError(`Instagram can't publish a ${request.contentType} — choose Post, Reel or Story.`);
    }
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const data = await graphGet(
      `${GRAPH}/${connection.externalAccountId}`,
      { fields: "username,name,profile_picture_url,followers_count", access_token: connection.accessToken },
      "Couldn't read the Instagram account"
    );
    const username = typeof data.username === "string" ? data.username : null;
    return {
      label: username ? `@${username}` : null,
      username,
      avatarUrl: typeof data.profile_picture_url === "string" ? data.profile_picture_url : null,
      followerCount: typeof data.followers_count === "number" ? data.followers_count : null,
      accountType: "Instagram professional account",
    };
  },
};
