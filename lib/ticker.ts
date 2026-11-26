import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { siteSetting, story, tickerItem } from "@/db/schema";
import { sanitizeTickerSettings, type TickerPriority, type TickerSettings } from "@/lib/homepage";

/** Server-side reads for the breaking-news ticker. */

export async function getTickerSettings(): Promise<TickerSettings> {
  const [row] = await db.select().from(siteSetting).where(eq(siteSetting.key, "ticker")).limit(1);
  return sanitizeTickerSettings(row?.value);
}

export type LiveTickerItem = { id: string; text: string; href: string | null; priority: TickerPriority };

/**
 * What the public ticker shows right now: active items inside their
 * start/expiry window, in the editors' order, then (if enabled) published
 * stories ticked "News ticker" in the article desk from the last two days —
 * capped at the configured maximum. Scheduling needs no job: the time
 * window is part of the query, so an item appears and expires on its own.
 */
export async function getLiveTicker(): Promise<{ settings: TickerSettings; items: LiveTickerItem[] }> {
  const settings = await getTickerSettings();
  if (!settings.enabled) return { settings, items: [] };
  const now = new Date();

  const manual = await db
    .select({
      id: tickerItem.id,
      text: tickerItem.text,
      priority: tickerItem.priority,
      slug: story.slug,
      storyStatus: story.status,
    })
    .from(tickerItem)
    .leftJoin(story, eq(story.id, tickerItem.storyId))
    .where(
      and(
        eq(tickerItem.isActive, true),
        or(isNull(tickerItem.startsAt), lte(tickerItem.startsAt, now)),
        or(isNull(tickerItem.expiresAt), gt(tickerItem.expiresAt, now))
      )
    )
    .orderBy(asc(tickerItem.position), asc(tickerItem.createdAt))
    .limit(settings.maxItems);

  const items: LiveTickerItem[] = manual.map((m) => ({
    id: m.id,
    text: m.text,
    // Only link to a story readers can actually open.
    href: m.slug && m.storyStatus === "published" ? `/story/${m.slug}` : null,
    priority: m.priority,
  }));

  if (settings.includeFlaggedStories && items.length < settings.maxItems) {
    const flagged = await db
      .select({ id: story.id, title: story.title, slug: story.slug })
      .from(story)
      .where(
        and(
          eq(story.status, "published"),
          eq(story.isNewsTicker, true),
          gt(story.publishedAt, new Date(now.getTime() - 48 * 60 * 60_000))
        )
      )
      .orderBy(desc(story.publishedAt))
      .limit(settings.maxItems - items.length);
    for (const f of flagged) items.push({ id: `story-${f.id}`, text: f.title, href: `/story/${f.slug}`, priority: "normal" });
  }

  return { settings, items };
}
