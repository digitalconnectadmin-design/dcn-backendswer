/**
 * Bangla digits and dates.
 *
 * Its own module, free of any database import, because `lib/site-nav.ts` —
 * where these used to live — imports `db`, and `db/drizzle.ts` throws at module
 * scope when `DATABASE_URL` is unset. The privacy policy page needs a date
 * formatter and nothing else; it should not acquire a database dependency (or
 * the whole content schema) to get one.
 *
 * `lib/site-nav.ts` re-exports these, so existing callers are unaffected.
 *
 * Intl's `bn` output isn't consistent across runtimes — Node, the Edge runtime
 * and browsers disagree on month names and digit shaping — so the names are
 * hardcoded rather than formatted.
 */

const BN_DAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

export function banglaDate(d: Date): string {
  return `${BN_DAYS[d.getDay()]}, ${toBanglaDigits(d.getDate())} ${BN_MONTHS[d.getMonth()]} ${toBanglaDigits(d.getFullYear())}`;
}

/**
 * Day, month and year with no weekday — for a date where the day of the week is
 * noise, such as "last updated" on the privacy policy. Read in UTC so the
 * stated date is the one in the source, not a day either side of it depending
 * on where the server is.
 */
export function banglaShortDate(d: Date): string {
  return `${toBanglaDigits(d.getUTCDate())} ${BN_MONTHS[d.getUTCMonth()]} ${toBanglaDigits(d.getUTCFullYear())}`;
}
