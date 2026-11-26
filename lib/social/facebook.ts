import { GRAPH_API_VERSION } from "@/lib/social/oauth/meta";
import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { captionWithLink, readJson, sleep } from "@/lib/social/http";
import { GRAPH, GRAPH_VIDEO, absoluteFacebookUrl, graphGet, graphPost, metaError } from "@/lib/social/meta-graph";

/**
 * Facebook Page publishing, one code path per content type:
 *
 *   post  → /feed (text/link), /photos (one photo), /feed + attached_media
 *           (several photos), or /videos (a regular video post)
 *   reel  → /video_reels start → hosted upload → finish, then verified
 *   story → /video_stories (video) or /photos (unpublished) + /photo_stories
 *
 * The three never fall through to one another. The reported bug — a Reel
 * showing up in the Stories tray — can't come from this code choosing the
 * wrong endpoint, because Reels only ever call /video_reels. What Meta does
 * with the upload afterwards is outside our control, which is why every
 * Reel is read back after publishing and its permalink checked: if Facebook
 * files it under /stories/ the result says so plainly (with the two known
 * causes) instead of reporting a clean success.
 */

function ruploadUrl(videoId: string) {
  return `https://rupload.facebook.com/video-upload/${GRAPH_API_VERSION}/${videoId}`;
}

/** Tells Facebook to pull the file from our public URL (UploadThing) rather than streaming bytes through a serverless function. */
async function uploadHostedFile(uploadUrl: string, accessToken: string, fileUrl: string, what: string) {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, file_url: fileUrl },
  });
  const data = await readJson(res);
  if (!res.ok || data?.success === false || (data && "error" in data)) {
    throw metaError(data, res.status, what);
  }
}

type VideoStatus = {
  video_status?: string;
  processing_phase?: { status?: string; errors?: { message?: string }[] };
  publishing_phase?: { status?: string };
};

/**
 * Reads a just-published video back from Graph until Facebook finishes
 * processing it (or ~2 minutes pass), returning where it actually landed.
 */
async function verifyVideo(
  videoId: string,
  accessToken: string,
  expected: "reel" | "video"
): Promise<{ permalink: string | null; warning: string | null }> {
  let permalink: string | null = null;
  let ready = false;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${GRAPH}/${videoId}?${new URLSearchParams({ fields: "status,permalink_url", access_token: accessToken })}`
    );
    const data = await readJson(res);
    if (res.ok && data && !("error" in data)) {
      permalink = absoluteFacebookUrl(data.permalink_url) ?? permalink;
      const status = data.status as VideoStatus | undefined;
      if (status?.video_status === "error" || status?.processing_phase?.status === "error") {
        const reason = status.processing_phase?.errors?.[0]?.message;
        throw new SocialApiError(`Facebook couldn't process the video${reason ? `: ${reason}` : "."}`);
      }
      if (status?.video_status === "ready" || status?.publishing_phase?.status === "complete") {
        ready = true;
        break;
      }
    }
    await sleep(5000);
  }

  let warning: string | null = null;
  if (permalink && /\/stories\//.test(permalink)) {
    warning =
      "Facebook filed this under Stories, not Reels. The usual causes are the Page's “Share reels to your story” setting in Meta Business Suite, or a video that isn't 9:16 and 3–90 seconds.";
  } else if (expected === "reel" && permalink && !/\/reel/.test(permalink)) {
    warning = `Facebook returned a non-Reel link — open it to confirm where it landed.`;
  } else if (expected === "video" && permalink && /\/reel/.test(permalink)) {
    warning = "Facebook now shows most uploaded videos in the Reels format; this was sent as a regular video post.";
  } else if (!ready) {
    warning = "Facebook accepted the upload and is still processing it — it can take a few minutes to appear.";
  }
  return { permalink, warning };
}

function requireVideo(request: PublishRequest, what: string) {
  const video = request.media.find((m) => m.kind === "video");
  if (!video) throw new SocialApiError(`${what} needs a video — none was selected.`);
  return video;
}

async function publishReel(pageId: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const video = requireVideo(request, "A Facebook Reel");

  const start = await graphPost(
    `${GRAPH}/${pageId}/video_reels`,
    { upload_phase: "start", access_token: token },
    "Facebook couldn't start the Reel upload"
  );
  const videoId = String(start.video_id);
  const uploadUrl = typeof start.upload_url === "string" ? start.upload_url : ruploadUrl(videoId);

  await uploadHostedFile(uploadUrl, token, video.url, "Facebook couldn't fetch the Reel's video");

  const finish = await graphPost(
    `${GRAPH}/${pageId}/video_reels`,
    {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      description: request.caption,
      ...(request.title ? { title: request.title } : {}),
      access_token: token,
    },
    "Facebook didn't accept the Reel"
  );
  if (finish.success === false) throw new SocialApiError("Facebook didn't accept the Reel.");

  const { permalink, warning } = await verifyVideo(videoId, token, "reel");
  return { externalPostId: videoId, permalink, warning };
}

async function publishStory(pageId: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const item = request.media[0];
  if (!item) throw new SocialApiError("A Facebook Story needs a photo or a video — none was selected.");

  if (item.kind === "video") {
    const start = await graphPost(
      `${GRAPH}/${pageId}/video_stories`,
      { upload_phase: "start", access_token: token },
      "Facebook couldn't start the Story upload"
    );
    const videoId = String(start.video_id);
    const uploadUrl = typeof start.upload_url === "string" ? start.upload_url : ruploadUrl(videoId);
    await uploadHostedFile(uploadUrl, token, item.url, "Facebook couldn't fetch the Story's video");
    const finish = await graphPost(
      `${GRAPH}/${pageId}/video_stories`,
      { upload_phase: "finish", video_id: videoId, access_token: token },
      "Facebook didn't accept the Story"
    );
    return { externalPostId: String(finish.post_id ?? videoId), permalink: null };
  }

  // Photo Stories take an already-uploaded, unpublished photo — uploading it
  // unpublished is what keeps it out of the feed.
  const photo = await graphPost(
    `${GRAPH}/${pageId}/photos`,
    { url: item.url, published: "false", access_token: token },
    "Facebook couldn't upload the Story photo"
  );
  const story = await graphPost(
    `${GRAPH}/${pageId}/photo_stories`,
    { photo_id: String(photo.id), access_token: token },
    "Facebook didn't accept the Story"
  );
  return { externalPostId: String(story.post_id ?? photo.id), permalink: null };
}

function postPermalink(id: unknown): string | null {
  return typeof id === "string" && id ? `https://www.facebook.com/${id}` : null;
}

async function publishPost(pageId: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const video = request.media.find((m) => m.kind === "video");
  const images = request.media.filter((m) => m.kind === "image");

  if (video) {
    const data = await graphPost(
      `${GRAPH_VIDEO}/${pageId}/videos`,
      {
        file_url: video.url,
        description: captionWithLink(request.caption, request.linkUrl),
        ...(request.title ? { title: request.title } : {}),
        access_token: token,
      },
      "Facebook couldn't post the video"
    );
    const id = String(data.id);
    const { permalink, warning } = await verifyVideo(id, token, "video");
    return { externalPostId: id, permalink, warning };
  }

  if (images.length === 1) {
    // A photo post can't also carry a link-preview card, so the story link
    // goes into the caption instead.
    const data = await graphPost(
      `${GRAPH}/${pageId}/photos`,
      { url: images[0].url, message: captionWithLink(request.caption, request.linkUrl), access_token: token },
      "Facebook couldn't post the photo"
    );
    const id = String(data.post_id ?? data.id);
    return { externalPostId: id, permalink: postPermalink(data.post_id) };
  }

  if (images.length > 1) {
    const photoIds: string[] = [];
    for (const image of images.slice(0, 10)) {
      const photo = await graphPost(
        `${GRAPH}/${pageId}/photos`,
        { url: image.url, published: "false", access_token: token },
        "Facebook couldn't upload one of the photos"
      );
      photoIds.push(String(photo.id));
    }
    const params: Record<string, string> = {
      message: captionWithLink(request.caption, request.linkUrl),
      access_token: token,
    };
    photoIds.forEach((id, i) => {
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    const data = await graphPost(`${GRAPH}/${pageId}/feed`, params, "Facebook couldn't create the photo post");
    return { externalPostId: String(data.id), permalink: postPermalink(data.id) };
  }

  const data = await graphPost(
    `${GRAPH}/${pageId}/feed`,
    {
      message: request.caption,
      ...(request.linkUrl ? { link: request.linkUrl } : {}),
      access_token: token,
    },
    "Facebook couldn't create the post"
  );
  return { externalPostId: String(data.id), permalink: postPermalink(data.id) };
}

export const facebookPublisher: SocialPublisher = {
  platform: "facebook",
  contentTypes: ["post", "reel", "story"],

  async publish(request: PublishRequest, connection: SocialConnectionRecord) {
    const pageId = connection.externalAccountId;
    switch (request.contentType) {
      case "reel":
        return publishReel(pageId, connection.accessToken, request);
      case "story":
        return publishStory(pageId, connection.accessToken, request);
      case "post":
        return publishPost(pageId, connection.accessToken, request);
      default:
        throw new SocialApiError(`Facebook can't publish a ${request.contentType} — choose Post, Reel or Story.`);
    }
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const data = await graphGet(
      `${GRAPH}/${connection.externalAccountId}`,
      {
        fields: "name,username,category,followers_count,fan_count,picture.type(large)",
        access_token: connection.accessToken,
      },
      "Couldn't read the Facebook Page"
    );
    const picture = data.picture as { data?: { url?: string } } | undefined;
    const followers =
      typeof data.followers_count === "number"
        ? data.followers_count
        : typeof data.fan_count === "number"
          ? data.fan_count
          : null;
    return {
      label: typeof data.name === "string" ? data.name : null,
      username: typeof data.username === "string" ? data.username : null,
      avatarUrl: picture?.data?.url ?? null,
      followerCount: followers,
      accountType: typeof data.category === "string" ? `Facebook Page · ${data.category}` : "Facebook Page",
    };
  },
};
