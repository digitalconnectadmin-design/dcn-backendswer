export function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const bn = (n: number) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/**
 * Compact Bangla timestamp for feed meta lines — "২৭ মি.", "৩ ঘ.", "২ দিন".
 *
 * Separate from `relativeTime` because that one is English long-form and is
 * still used in the admin, where staff read timestamps alongside English UI.
 */
export function compactBanglaTime(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "এইমাত্র";
  if (minutes < 60) return `${bn(minutes)} মি.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${bn(hours)} ঘ.`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${bn(days)} দিন`;

  const BN_MONTHS = [
    "জানু", "ফেব", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে",
  ];
  return `${bn(date.getDate())} ${BN_MONTHS[date.getMonth()]}`;
}

/**
 * Compact timestamp in the reader's interface language — "3h ago" / "৩ ঘ.".
 *
 * The homepage mosaic gives each card one short meta line, so the English
 * form here is tighter than `relativeTime`'s "3 hr ago": at this size the
 * space matters more than the abbreviation being spelled out.
 */
export function compactTime(date: Date, locale: "bn" | "en"): string {
  if (locale === "bn") return compactBanglaTime(date);

  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
