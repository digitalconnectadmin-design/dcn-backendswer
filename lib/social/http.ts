import { SocialApiError } from "@/lib/social/types";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads a response body without ever throwing an opaque "Unexpected end of
 * JSON input": empty bodies become null, non-JSON bodies become an error
 * object carrying the first 200 characters of whatever came back.
 */
export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

/** Downloads a media file for platforms that need raw bytes (YouTube, X, LinkedIn). */
// `Uint8Array<ArrayBuffer>` rather than bare `Uint8Array` (which defaults to
// ArrayBufferLike): TS 5.7+ refuses the latter as a fetch/Blob body because
// it could be backed by a SharedArrayBuffer.
export async function fetchBytes(
  url: string,
  what: string
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new SocialApiError(`Couldn't download the ${what} from ${new URL(url).host} (HTTP ${res.status}).`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // `||` not `??`: a present-but-empty header must still fall back.
  const contentType = res.headers.get("content-type") || (what.includes("video") ? "video/mp4" : "image/jpeg");
  return { bytes, contentType };
}

/** Appends the story link to a caption unless it's already in there. */
export function captionWithLink(caption: string, linkUrl: string | null): string {
  if (!linkUrl || caption.includes(linkUrl)) return caption;
  return caption ? `${caption}\n\n${linkUrl}` : linkUrl;
}
