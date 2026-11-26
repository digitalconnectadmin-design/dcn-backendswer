/**
 * Minimal RSS 2.0 / Atom parser.
 *
 * Written by hand rather than pulling in a dependency: the project has no XML
 * parser, and wire feeds use a small, stable subset of both formats. It is
 * deliberately forgiving — a field it can't find becomes null and the item is
 * still ingested, because losing an article because its <description> was
 * malformed is worse than ingesting it with a missing summary.
 *
 * It is NOT a general-purpose XML parser and shouldn't be reused as one.
 */

export type ParsedFeedItem = {
  guid: string;
  title: string;
  body: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: Date | null;
};

/** Undoes the five XML entities plus numeric escapes. */
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Ampersand last, or it would re-break the entities decoded above.
    .replace(/&amp;/g, "&");
}

/** Strips CDATA wrappers and any embedded markup, returning plain text. */
function clean(raw: string | null): string | null {
  if (raw === null) return null;
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
  return text || null;
}

function tagContent(block: string, ...names: string[]): string | null {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (m) return m[1];
  }
  return null;
}

function attr(block: string, tag: string, attribute: string): string | null {
  const m = block.match(new RegExp(`<${tag}\\s[^>]*${attribute}=["']([^"']+)["']`, "i"));
  return m ? m[1] : null;
}

/** Atom puts the article URL in <link href="..."/> rather than as tag content. */
function extractUrl(block: string): string | null {
  const plain = clean(tagContent(block, "link"));
  if (plain && /^https?:\/\//i.test(plain)) return plain;
  const href =
    block.match(/<link[^>]*\srel=["']alternate["'][^>]*\shref=["']([^"']+)["']/i) ??
    block.match(/<link[^>]*\shref=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : null;
}

/**
 * Feeds advertise images in at least four different ways; try each in the
 * order of how reliably it means "the article's lead image".
 */
function extractImage(block: string): string | null {
  const mediaContent = attr(block, "media:content", "url");
  if (mediaContent) return decodeEntities(mediaContent);
  const mediaThumb = attr(block, "media:thumbnail", "url");
  if (mediaThumb) return decodeEntities(mediaThumb);
  const enclosure =
    block.match(/<enclosure[^>]*type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["']/i) ??
    block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']*["']/i);
  if (enclosure) return decodeEntities(enclosure[1]);
  // Last resort: the first <img> inside the description HTML.
  const inline = block.match(/<img[^>]*src=["']([^"']+)["']/i);
  return inline ? decodeEntities(inline[1]) : null;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeed(xml: string): ParsedFeedItem[] {
  // <item> is RSS, <entry> is Atom.
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items: ParsedFeedItem[] = [];
  for (const block of blocks) {
    const title = clean(tagContent(block, "title"));
    const url = extractUrl(block);
    // Without a title or a link there's nothing an editor could act on.
    if (!title || !url) continue;

    const body =
      clean(tagContent(block, "content:encoded")) ??
      clean(tagContent(block, "description", "summary", "content"));

    items.push({
      // Fall back to the URL when a feed omits <guid>/<id>; the URL is stable
      // per article, which is all the duplicate check needs.
      guid: clean(tagContent(block, "guid", "id")) ?? url,
      title,
      body,
      url,
      imageUrl: extractImage(block),
      publishedAt: parseDate(clean(tagContent(block, "pubDate", "published", "updated"))),
    });
  }
  return items;
}

/**
 * Normalised fingerprint of a headline, used to spot the same event across
 * wires. Stopwords go because "Markets respond to latest economic figures" and
 * "Global markets react to new economic data" should collide on their content
 * words; the result is sorted so word order doesn't matter.
 */
const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","to","in","on","at","for","with","as","by",
  "from","is","are","was","were","be","been","its","it","that","this","after","over",
  "new","latest","says","say","said","amid","up","down","more","than","into",
]);

export function storyFingerprint(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].sort().slice(0, 6).join("-");
}

/** Common conventional feed paths, tried in rough order of likelihood. */
const COMMON_FEED_PATHS = [
  "/feed/", "/feed", "/rss/", "/rss", "/rss.xml", "/feed.xml",
  "/atom.xml", "/index.xml", "/feeds/posts/default",
];

/** Does this text look like a feed rather than a web page? */
export function looksLikeFeed(text: string): boolean {
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:rdf");
}

/**
 * Feed URLs a page advertises in its <head>, absolute-ised against the page.
 *
 * Nearly every CMS emits `<link rel="alternate" type="application/rss+xml">`,
 * so asking the page itself is far more reliable than guessing paths — the
 * guesses below are only the fallback for sites that don't.
 */
export function discoverFeedLinks(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'](application\/(rss\+xml|atom\+xml|feed\+json))["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      found.push(new URL(decodeEntities(href), pageUrl).toString());
    } catch {
      // Malformed href — skip rather than fail discovery.
    }
  }
  return [...new Set(found)];
}

/** Candidate URLs to try for a site that advertises nothing. */
export function guessFeedUrls(pageUrl: string): string[] {
  try {
    const base = new URL(pageUrl);
    return COMMON_FEED_PATHS.map((p) => new URL(p, base.origin).toString());
  } catch {
    return [];
  }
}
