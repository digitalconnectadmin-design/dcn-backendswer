import {
  CAPTION_LIMITS,
  PLATFORM_CONTENT_OPTIONS,
  captionLength,
  type SocialContentType,
  type SocialMediaItem,
  type SocialPlatformName,
} from "@/lib/social/content";
import { PLATFORM_LABELS } from "@/lib/social/platforms";

/**
 * Pre-publish checks, shared by the composer (live "Reel check" panel) and
 * the server action (which re-runs them and refuses hard errors). Pure — no
 * DB, no fetch — so it's safe in client components.
 *
 * "error" blocks publishing to that platform. "warn" is the spec's
 * "⚠ This video may not be suitable…" — the editor can Continue Anyway.
 *
 * The numbers below are each platform's published API requirements at the
 * time of writing, kept in one table so they're easy to adjust when a
 * platform changes them.
 */

export type CheckStatus = "ok" | "warn" | "error";
export type Check = { label: string; status: CheckStatus; hint?: string };

type VideoRule = {
  minSec?: number;
  maxSec?: number;
  /** "vertical" = roughly 9:16; "vertical-or-square" also accepts 1:1. */
  shape?: "vertical" | "vertical-or-square";
  minWidth?: number;
  minHeight?: number;
  /** Exceeding maxSec is a hard error rather than a warning. */
  strictDuration?: boolean;
};

const VIDEO_RULES: Partial<Record<`${SocialPlatformName}:${SocialContentType}`, VideoRule>> = {
  "facebook:reel": { minSec: 3, maxSec: 90, shape: "vertical", minWidth: 540, minHeight: 960 },
  "facebook:story": { minSec: 3, maxSec: 60, shape: "vertical" },
  "instagram:reel": { minSec: 3, maxSec: 900, shape: "vertical" },
  "instagram:story": { minSec: 3, maxSec: 60, shape: "vertical" },
  "instagram:post": { minSec: 3, maxSec: 900 },
  "youtube:short": { maxSec: 180, shape: "vertical-or-square" },
  "tiktok:video": { minSec: 3, maxSec: 600 },
  "x:post": { maxSec: 140 },
};

const SUPPORTED_VIDEO = /\.(mp4|mov|m4v)(\?|$)/i;

function describeShape(v: SocialMediaItem) {
  if (!v.width || !v.height) return null;
  const ratio = v.width / v.height;
  if (ratio < 0.66) return "vertical";
  if (ratio <= 1.05 && ratio >= 0.95) return "square";
  if (ratio < 0.95) return "portrait";
  return "horizontal";
}

export type CheckInput = {
  platform: SocialPlatformName;
  contentType: SocialContentType;
  caption: string;
  title?: string | null;
  media: SocialMediaItem[];
  thumbnailUrl?: string | null;
};

export function checkPost(input: CheckInput): Check[] {
  const { platform, contentType, caption, media } = input;
  const name = PLATFORM_LABELS[platform];
  const option = PLATFORM_CONTENT_OPTIONS[platform].find((o) => o.type === contentType);
  const checks: Check[] = [];

  if (!option) {
    return [{ label: `${name} can't publish a ${contentType}`, status: "error" }];
  }

  const video = media.find((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");

  // --- media presence ---
  if (option.need === "video") {
    checks.push(
      video
        ? { label: "Video selected", status: "ok" }
        : { label: "A video is required", status: "error", hint: `Select or upload a video for this ${contentType}.` }
    );
  } else if (option.need === "image-or-video-required") {
    checks.push(
      media.length
        ? { label: video ? "Video selected" : "Image selected", status: "ok" }
        : { label: "A photo or video is required", status: "error" }
    );
  }
  if (platform === "linkedin" && video) {
    checks.push({ label: "LinkedIn video isn't supported yet", status: "error", hint: "Untick “Attach media” for LinkedIn or choose an image." });
  }
  if (platform === "x" && images.length > 4) {
    checks.push({ label: `X takes 4 images — ${images.length - 4} will be left out`, status: "warn" });
  }

  // --- video shape/duration ---
  const ruleKey = `${platform}:${contentType}` as const;
  const rule = VIDEO_RULES[ruleKey];
  if (video && rule) {
    const known = video.durationSec != null && video.width != null && video.height != null;
    if (!known) {
      checks.push({
        label: "Couldn't read the video's length and dimensions",
        status: "warn",
        hint: "Check it meets the requirements before publishing.",
      });
    } else {
      const d = video.durationSec!;
      if (rule.minSec != null && d < rule.minSec) {
        checks.push({ label: `Video is ${d.toFixed(1)}s — ${name} needs at least ${rule.minSec}s`, status: "error" });
      } else if (rule.maxSec != null && d > rule.maxSec) {
        checks.push({
          label: `Video is ${Math.round(d)}s — ${name} ${contentType}s allow up to ${rule.maxSec}s`,
          status: rule.strictDuration ? "error" : "warn",
          hint:
            platform === "youtube"
              ? "Over 3 minutes, YouTube treats it as a regular video, not a Short."
              : "Trim the video or choose a different content type.",
        });
      } else {
        checks.push({ label: `Duration supported (${Math.round(d)}s)`, status: "ok" });
      }

      const shape = describeShape(video);
      if (rule.shape) {
        const fits = shape === "vertical" || (rule.shape === "vertical-or-square" && shape === "square");
        checks.push(
          fits
            ? { label: `${shape === "square" ? "Square" : "Vertical"} format detected`, status: "ok" }
            : {
                label: `${shape ? shape[0].toUpperCase() + shape.slice(1) : "Unknown"} video (${video.width}×${video.height})`,
                status: "warn",
                hint: `${name} ${contentType}s should be vertical 9:16.`,
              }
        );
      }
      if (rule.minWidth && rule.minHeight && video.width && video.height) {
        const small = Math.min(video.width, video.height) < rule.minWidth || Math.max(video.width, video.height) < rule.minHeight;
        if (small) {
          checks.push({ label: `Resolution ${video.width}×${video.height} is below ${rule.minWidth}×${rule.minHeight}`, status: "warn" });
        }
      }
    }
    const typedOk = (video.mimeType && /mp4|quicktime/.test(video.mimeType)) || SUPPORTED_VIDEO.test(video.url);
    checks.push(
      typedOk
        ? { label: "Video format supported", status: "ok" }
        : { label: "Video format may not be supported", status: "warn", hint: "MP4 (H.264/AAC) is the safest choice." }
    );
  }

  // --- thumbnail ---
  if (video && (contentType === "reel" || contentType === "video" || contentType === "short")) {
    const usesThumb = platform === "youtube" || (platform === "instagram" && contentType === "reel");
    if (usesThumb) {
      checks.push(
        input.thumbnailUrl
          ? { label: "Thumbnail available", status: "ok" }
          : { label: "No thumbnail — the platform will pick a frame", status: "warn" }
      );
    }
  }

  // --- text ---
  const limit = CAPTION_LIMITS[platform];
  const len = captionLength(platform, caption);
  if (len > limit) {
    checks.push({ label: `Text is ${len} characters — ${name} allows ${limit}`, status: "error" });
  } else if (!caption.trim() && contentType !== "story") {
    checks.push({ label: "No caption", status: platform === "x" && media.length === 0 ? "error" : "warn" });
  }
  if (platform === "youtube") {
    const title = (input.title ?? "").trim();
    if (!title) checks.push({ label: "YouTube needs a title", status: "error" });
    else if (title.length > 100) checks.push({ label: `Title is ${title.length} characters — YouTube allows 100`, status: "error" });
  }

  return checks;
}

export function worstStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "error")) return "error";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
