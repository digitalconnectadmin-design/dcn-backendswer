import { derivedThumbnail } from "@/lib/video-embed";

/**
 * The one place that decides which picture represents a story. Every
 * surface — homepage cards, category and search lists, the story page,
 * related stories, the social/OG preview — asks this function, so a story
 * can't show one image on the homepage and a different (or no) image on
 * its own page. Pure; safe on server and client.
 *
 * Order of preference:
 *   1. the featured image the editor set
 *   2. the photocard graphic generated from it (exists even when the plain
 *      photo URL has since died)
 *   3. the first image attached to the story (Story Pipeline uploads)
 *   4. the YouTube thumbnail, for a story built around a video
 *
 * Every candidate is normalised first, which is where a lot of "missing"
 * images actually came from: stored values like "", " ", "null",
 * "undefined", protocol-relative "//host/x.jpg", or "http://" wire images
 * that a browser on an https page silently refuses (mixed content).
 */

export type ImageSourceFields = {
  featuredImageUrl?: string | null;
  photocardImageUrl?: string | null;
  attachedImageUrl?: string | null;
  youtubeUrl?: string | null;
};

export function cleanImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url = value.trim();
  if (!url || url === "null" || url === "undefined" || url === "#") return null;
  if (url.startsWith("//")) url = `https:${url}`;
  // Mixed content: an http image on the https site is blocked or silently
  // upgraded by the browser. Ask for https up front; the image component's
  // fallback chain (proxy → next candidate → placeholder) covers hosts that
  // genuinely don't serve https.
  if (url.startsWith("http://")) url = `https://${url.slice(7)}`;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(url) && !url.startsWith("/")) return null;
  return url;
}

export function storyImageCandidates(s: ImageSourceFields): string[] {
  const list = [
    cleanImageUrl(s.featuredImageUrl),
    cleanImageUrl(s.photocardImageUrl),
    cleanImageUrl(s.attachedImageUrl),
    cleanImageUrl(derivedThumbnail("youtube", s.youtubeUrl ?? null)),
  ].filter((u): u is string => !!u);
  return Array.from(new Set(list));
}

/** The single best image for a story, or null — for OG tags and anything that takes one URL. */
export function primaryStoryImage(s: ImageSourceFields): string | null {
  return storyImageCandidates(s)[0] ?? null;
}

/** Hosts we serve images from ourselves (UploadThing) — never routed through the proxy. */
export function isOwnImageHost(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".ufs.sh") || host === "utfs.io" || host.endsWith(".utfs.io");
  } catch {
    return false;
  }
}

/**
 * Our server-side fetch of an external image — used only as a retry after
 * the browser failed to load it directly (hotlink protection that rejects
 * foreign Referers, an http-only host). See app/api/image-proxy.
 */
export function proxiedImageUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/** Candidates expanded into the order the browser should try them. */
export function imageAttempts(candidates: string[]): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    out.push(c);
    if (!isOwnImageHost(c)) out.push(proxiedImageUrl(c));
  }
  return out;
}
