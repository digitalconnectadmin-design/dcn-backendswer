import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { media, story } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Last-resort image fetch for the public site. NewsImage only calls this
 * after the browser failed to load an image directly — typically a news
 * host whose hotlink protection rejects our pages as the Referer, or one
 * that only serves plain http (which an https page may not load).
 *
 * This is deliberately NOT an open proxy:
 *   - only URLs that are actually stored as a story's featured/photocard
 *     image or in the media library are fetched — anything else is 404;
 *   - private, loopback and link-local hosts are refused;
 *   - only raster images come back (no SVG: served from our origin, an SVG
 *     could run script), capped at 12 MB;
 *   - responses are cached, so a popular image is fetched once, not per view.
 * Known limit: the host check is on the URL's name, not its resolved IP, so
 * it doesn't defend against DNS rebinding — acceptable because the URL must
 * already be one an editor saved.
 */

const MAX_BYTES = 12 * 1024 * 1024;

function blockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  // IPv6 literals only — a hostname like "fdn.example.com" must not match.
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80"))) return true;
  return false;
}

async function isKnownImage(url: string): Promise<boolean> {
  // cleanImageUrl upgrades http→https, so the stored value may be either.
  const variants = [url, url.replace(/^https:\/\//, "http://")];
  for (const v of variants) {
    const [s] = await db
      .select({ id: story.id })
      .from(story)
      .where(or(eq(story.featuredImageUrl, v), eq(story.photocardImageUrl, v)))
      .limit(1);
    if (s) return true;
    const [m] = await db.select({ id: media.id }).from(media).where(eq(media.url, v)).limit(1);
    if (m) return true;
  }
  return false;
}

async function fetchImage(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; DigitalConnectImageFetcher/1.0)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return new NextResponse("Bad image URL", { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol) || blockedHost(target.hostname)) {
    return new NextResponse("Not allowed", { status: 400 });
  }
  // Compare the string exactly as sent — URL() normalisation (encoding,
  // trailing slashes) could make a stored URL fail to match itself.
  const requested = raw as string;
  if (!(await isKnownImage(requested))) {
    return new NextResponse("Unknown image", { status: 404 });
  }

  let res = await fetchImage(requested);
  // The URL may have been upgraded to https by cleanImageUrl for a host that
  // only serves http — try the original scheme before giving up.
  if ((!res || !res.ok) && target.protocol === "https:") {
    res = await fetchImage(requested.replace(/^https:\/\//, "http://"));
  }
  if (!res || !res.ok) return new NextResponse("Image unavailable", { status: 502 });

  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") || type.includes("svg")) {
    return new NextResponse("Not an image", { status: 415 });
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return new NextResponse("Image too large", { status: 413 });
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return new NextResponse("Image too large", { status: 413 });

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
