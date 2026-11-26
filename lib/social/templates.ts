import { xCharacterCount, type SocialContentType, type SocialPlatformName } from "@/lib/social/content";

/**
 * Starting text for each platform, generated from the website item. The
 * composer shows these in editable boxes — they're a first draft, never
 * forced on anyone (spec §7). Pure, so the composer can regenerate them
 * client-side when the content type changes.
 *
 * No language-specific boilerplate ("Read more", "Link in bio") is added:
 * the site publishes in Bangla and English, and an English phrase stuck on
 * a Bangla caption would be worse than nothing. The link is added bare.
 */

export type SourceContent = {
  title: string;
  excerpt: string | null;
  url: string | null;
  tags: string[];
};

function hashtags(tags: string[], max = 5): string {
  return tags
    .map((t) => t.replace(/[\s#]+/g, ""))
    .filter(Boolean)
    .slice(0, max)
    .map((t) => `#${t}`)
    .join(" ");
}

function join(...parts: (string | null | undefined)[]) {
  return parts.map((p) => p?.trim()).filter(Boolean).join("\n\n");
}

/** Fits a title + link into 280 characters, trimming the title if it must. */
function fitForX(title: string, url: string | null): string {
  const full = join(title, url);
  if (xCharacterCount(full) <= 280) return full;
  const budget = 280 - (url ? 23 + 2 : 0) - 1;
  return join(`${title.slice(0, Math.max(0, budget)).trimEnd()}…`, url);
}

export function defaultContent(
  platform: SocialPlatformName,
  contentType: SocialContentType,
  src: SourceContent
): { caption: string; title: string | null } {
  const tags = hashtags(src.tags);
  switch (platform) {
    case "facebook":
      // Link posts carry the URL as a preview card, so it isn't repeated in
      // the text; Reels/Stories have no card, so the link goes in the text.
      return {
        caption: contentType === "post" ? join(src.title, src.excerpt) : join(src.title, src.url, tags),
        title: null,
      };
    case "instagram":
      // Links aren't clickable in Instagram captions — left out.
      return { caption: contentType === "story" ? "" : join(src.title, src.excerpt, tags), title: null };
    case "x":
      return { caption: fitForX(src.title, src.url), title: null };
    case "linkedin":
      return { caption: join(src.title, src.excerpt), title: null };
    case "youtube":
      return {
        title: src.title.slice(0, 100),
        caption: join(src.excerpt, src.url, contentType === "short" ? join(tags, "#Shorts") : tags),
      };
    case "tiktok":
      return { caption: join(src.title, tags), title: null };
  }
}
