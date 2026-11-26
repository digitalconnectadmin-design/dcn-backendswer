/**
 * Builds an iframe src from a pasted video URL.
 *
 * An editor-supplied URL is untrusted input that ends up in an iframe `src`,
 * so this parses the URL and rebuilds the embed from known-good hosts rather
 * than passing the original string through. A `javascript:` or attacker-owned
 * URL therefore can't reach the iframe — anything unrecognised returns null
 * and the caller renders a plain link instead.
 */
export function toEmbedUrl(
  source: "youtube" | "facebook" | "upload",
  rawUrl: string | null
): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (source === "youtube") {
    let videoId: string | null = null;

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.slice("/embed/".length);
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.slice("/shorts/".length);
      }
    } else if (host === "youtu.be") {
      videoId = url.pathname.slice(1);
    }

    if (!videoId) return null;
    // YouTube ids are 11 chars of [A-Za-z0-9_-]; reject anything else so a
    // crafted path can't smuggle extra URL segments into the embed.
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

    return `https://www.youtube.com/embed/${videoId}`;
  }

  if (source === "facebook") {
    if (host !== "facebook.com" && host !== "fb.watch") return null;
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
      url.toString()
    )}&show_text=false`;
  }

  return null;
}

/**
 * A public poster image for a pasted URL, without fetching anything.
 *
 * Used when an editor hasn't set an explicit thumbnail. Only YouTube exposes
 * a thumbnail this cheaply — `img.youtube.com` is YouTube's own public CDN,
 * the same one youtube.com itself uses, so this is a plain unauthenticated
 * GET, not a credential or an API call. Facebook has no equivalent public
 * pattern, so a Facebook link falls through to null and the caller shows the
 * play-icon placeholder instead of a broken image request.
 */
export function derivedThumbnail(
  source: "youtube" | "facebook" | "upload",
  rawUrl: string | null
): string | null {
  if (source !== "youtube" || !rawUrl) return null;
  const embed = toEmbedUrl("youtube", rawUrl);
  if (!embed) return null;
  const id = embed.split("/embed/")[1];
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
