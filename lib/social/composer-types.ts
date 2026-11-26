import type {
  SocialContentType,
  SocialMediaItem,
  SocialPlatformName,
  YouTubeVisibility,
} from "@/lib/social/content";

/** Pure types shared by the composer (client) and createSocialPublication (server). */

export type MediaOption = {
  url: string;
  kind: "image" | "video";
  label: string;
  mimeType?: string | null;
};

export type ComposerSource = {
  kind: "story" | "reel" | "custom";
  id: string | null;
  title: string;
  excerpt: string | null;
  /** Public link to the item on the website, when it has one. */
  url: string | null;
  tags: string[];
  websiteStatus: "published" | "draft" | null;
  /** Why the website item can't be published from here, if it can't. */
  websiteBlocked: string | null;
};

export type PlatformDraft = {
  contentType: SocialContentType;
  caption: string;
  /** YouTube title; unused elsewhere. */
  title: string;
  /** Attach the selected media, or post text/link only. */
  useMedia: boolean;
  /** Edited by hand — stop regenerating it when the content type changes. */
  touched: boolean;
};

export type YouTubeDraft = {
  visibility: YouTubeVisibility;
  tags: string;
  categoryId: string;
  playlistByConnection: Record<string, string>;
};

export type ComposerSubmission = {
  source: { kind: ComposerSource["kind"]; id: string | null };
  title: string;
  publishWebsite: boolean;
  media: SocialMediaItem[];
  thumbnailUrl: string | null;
  linkUrl: string | null;
  platforms: Partial<Record<SocialPlatformName, Omit<PlatformDraft, "touched">>>;
  youtube: YouTubeDraft;
  /** ISO time per account, or null to publish that account now. */
  accounts: { connectionId: string; scheduledFor: string | null }[];
  acknowledgedWarnings: boolean;
};
