/**
 * Slugifies a title while keeping Unicode letters intact.
 *
 * The earlier ASCII-only version stripped every Bangla character, so a title
 * like "রাজধানীতে অগ্নিকাণ্ড" collapsed to an empty string and every Bangla
 * article ended up fighting over the slug "untitled". Bangla slugs are normal
 * on BD news sites — browsers percent-encode them in the URL bar and display
 * them decoded.
 *
 * \p{L} = any Unicode letter, \p{N} = any Unicode number, \p{M} = combining
 * marks (essential for Bangla, where vowel signs are separate code points).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFC")
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
