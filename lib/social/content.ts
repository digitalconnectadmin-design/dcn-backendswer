/**
 * Shared vocabulary for social publishing — content types, per-post media
 * and options. Pure types/constants with no runtime dependency on the DB,
 * so client components (the composer, previews, the Reel check) and the
 * schema can both import it. Same pattern as lib/pipeline.ts.
 */

// `SocialPlatform` is re-declared here as a literal union (not imported
// from db/schema) so this module stays safe to import from the schema
// itself without a circular runtime import.
export const SOCIAL_PLATFORMS = ["facebook", "instagram", "youtube", "x", "linkedin", "tiktok"] as const;
export type SocialPlatformName = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Where a post lands on the platform. Deliberately explicit: a Reel, a
 * Story and a feed Post are different API endpoints on Facebook and
 * Instagram, and the orchestrator never infers one from another — the
 * reported "Reel showed up as a Story" bug is exactly what happens when
 * that line gets blurry.
 */
export const SOCIAL_CONTENT_TYPES = ["post", "reel", "story", "video", "short"] as const;
export type SocialContentType = (typeof SOCIAL_CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<SocialContentType, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
  video: "Video",
  short: "Short",
};

/** What a content type needs from the selected media. */
export type MediaNeed = "none-or-any" | "video" | "image-or-video" | "image-or-video-required";

export type PlatformContentOption = {
  type: SocialContentType;
  need: MediaNeed;
  /** One line shown under the option so nobody has to guess where it lands. */
  where: string;
};

/**
 * The content types each platform can actually publish through its API
 * today. Live (Facebook, YouTube) is not a publish type — it's Live
 * Studio's job and is shown separately in the composer as "coming next".
 */
export const PLATFORM_CONTENT_OPTIONS: Record<SocialPlatformName, PlatformContentOption[]> = {
  facebook: [
    { type: "post", need: "none-or-any", where: "Page feed — text, link preview, photos or a video" },
    { type: "reel", need: "video", where: "Page's Reels tab and the Reels feed — never Stories" },
    { type: "story", need: "image-or-video-required", where: "Page Stories tray — disappears after 24 hours" },
  ],
  instagram: [
    { type: "post", need: "image-or-video-required", where: "Profile grid and followers' feed" },
    { type: "reel", need: "video", where: "Reels tab, and shared to the feed" },
    { type: "story", need: "image-or-video-required", where: "Stories tray — 24 hours, no caption" },
  ],
  youtube: [
    { type: "video", need: "video", where: "Channel's Videos tab" },
    { type: "short", need: "video", where: "Channel's Shorts tab — vertical, 3 minutes or less" },
  ],
  x: [{ type: "post", need: "none-or-any", where: "Timeline — text, up to 4 images, or one video" }],
  linkedin: [{ type: "post", need: "none-or-any", where: "Feed — text, link preview, or one image" }],
  tiktok: [{ type: "video", need: "video", where: "Profile videos" }],
};

export function allowedContentTypes(platform: SocialPlatformName): SocialContentType[] {
  return PLATFORM_CONTENT_OPTIONS[platform].map((o) => o.type);
}

export type SocialMediaItem = {
  url: string;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  mimeType?: string | null;
};

export type YouTubeVisibility = "public" | "unlisted" | "private";

export type SocialPostOptions = {
  youtube?: {
    visibility: YouTubeVisibility;
    tags: string[];
    categoryId: string;
    playlistId?: string | null;
  };
  /** The editor saw the Reel/video warnings and chose "Continue anyway". */
  acknowledgedWarnings?: boolean;
};

/** YouTube's standard video categories most relevant to a newsroom. */
export const YOUTUBE_CATEGORIES: { id: string; label: string }[] = [
  { id: "25", label: "News & Politics" },
  { id: "17", label: "Sports" },
  { id: "24", label: "Entertainment" },
  { id: "22", label: "People & Blogs" },
  { id: "27", label: "Education" },
  { id: "28", label: "Science & Technology" },
];

/** Upper bounds each platform enforces on the text we send. */
export const CAPTION_LIMITS: Record<SocialPlatformName, number> = {
  facebook: 63206,
  instagram: 2200,
  youtube: 5000,
  x: 280,
  linkedin: 3000,
  tiktok: 2200,
};

/**
 * X counts every URL as 23 characters regardless of its real length (t.co
 * wrapping), so a raw `.length` over-counts story links badly.
 */
export function xCharacterCount(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}

export function captionLength(platform: SocialPlatformName, text: string): number {
  return platform === "x" ? xCharacterCount(text) : text.length;
}

/** "Published as Reel" — used in every result line so nobody has to guess. */
export function publishedAsLabel(type: SocialContentType | null): string {
  return type ? `as ${CONTENT_TYPE_LABELS[type]}` : "";
}

/** Newsroom timezone for "today" in stats — the spec's schedules are in Asia/Dhaka. */
export const NEWSROOM_TIMEZONE = "Asia/Dhaka";
