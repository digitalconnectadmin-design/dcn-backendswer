import {
  SocialApiError,
  type AccountProfile,
  type PublishRequest,
  type PublishResult,
  type SocialConnectionRecord,
  type SocialPublisher,
} from "@/lib/social/types";
import { fetchBytes, readJson } from "@/lib/social/http";

// LinkedIn's Community Management API version header, format YYYYMM —
// bump periodically; each version is supported for roughly a year.
const LINKEDIN_API_VERSION = "202602";

function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function linkedinError(data: Record<string, unknown> | null, status: number, what: string) {
  const message = typeof data?.message === "string" ? data.message : null;
  return new SocialApiError(message ? `${what}: ${message}` : `${what} (HTTP ${status}).`, status === 401);
}

/** Registers an image with LinkedIn and uploads its bytes; returns the image URN. */
async function uploadImage(token: string, owner: string, url: string): Promise<string> {
  const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const data = await readJson(init);
  if (!init.ok) throw linkedinError(data, init.status, "LinkedIn couldn't start the image upload");
  const value = data?.value as { uploadUrl?: string; image?: string } | undefined;
  if (!value?.uploadUrl || !value.image) throw new SocialApiError("LinkedIn didn't return an image upload URL.");

  const { bytes, contentType } = await fetchBytes(url, "image");
  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new SocialApiError(`LinkedIn rejected the image upload (HTTP ${put.status}).`, put.status === 401);
  return value.image;
}

/**
 * Posts to the connected LinkedIn account. `externalAccountId` is a complete
 * URN (`urn:li:person:...` today; `urn:li:organization:...` once Company Page
 * posting is approved), so this never needs to know which kind it is.
 *
 * Text, a link preview card, or one image. LinkedIn video needs a separate
 * multi-part upload flow that isn't built yet — the composer doesn't offer
 * video for LinkedIn, and this refuses it plainly if it ever arrives here.
 */
export const linkedinPublisher: SocialPublisher = {
  platform: "linkedin",
  contentTypes: ["post"],

  async publish(request: PublishRequest, connection: SocialConnectionRecord): Promise<PublishResult> {
    if (request.contentType !== "post") {
      throw new SocialApiError(`LinkedIn can't publish a ${request.contentType} — LinkedIn only has posts here.`);
    }
    if (request.media.some((m) => m.kind === "video")) {
      throw new SocialApiError("LinkedIn video posting isn't supported yet — post it without the video, or with an image.");
    }
    const token = connection.accessToken;
    const author = connection.externalAccountId;
    const image = request.media.find((m) => m.kind === "image");

    let content: Record<string, unknown> | undefined;
    let commentary = request.caption;
    if (image) {
      content = { media: { id: await uploadImage(token, author, image.url) } };
      // An image post can't also carry a link card, so the link rides in the text.
      if (request.linkUrl && !commentary.includes(request.linkUrl)) commentary = `${commentary}\n\n${request.linkUrl}`;
    } else if (request.linkUrl) {
      content = { article: { source: request.linkUrl, title: request.title ?? request.caption.split("\n")[0] } };
    }

    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        author,
        commentary,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) throw linkedinError(await readJson(res), res.status, "LinkedIn post failed");

    // The created post's URN comes back in a header, not the body.
    const urn = res.headers.get("x-restli-id") ?? "unknown";
    return {
      externalPostId: urn,
      permalink: urn !== "unknown" ? `https://www.linkedin.com/feed/update/${urn}` : null,
    };
  },

  async fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile> {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    });
    const data = await readJson(res);
    if (!res.ok) throw linkedinError(data, res.status, "Couldn't read the LinkedIn account");
    return {
      label: typeof data?.name === "string" ? data.name : null,
      avatarUrl: typeof data?.picture === "string" ? data.picture : null,
      // Follower counts for a personal profile aren't available to this app's scopes.
      followerCount: null,
      accountType: connection.externalAccountId.startsWith("urn:li:organization")
        ? "LinkedIn Company Page"
        : "LinkedIn personal profile",
    };
  },
};
