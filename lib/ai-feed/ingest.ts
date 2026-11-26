import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { feedEvent, feedItem, feedSource } from "@/db/schema";
import {
  discoverFeedLinks,
  guessFeedUrls,
  looksLikeFeed,
  parseFeed,
  storyFingerprint,
} from "@/lib/ai-feed/rss";
import { isAccountLevelFailure, summariseForNewsroom, translateToBangla } from "@/lib/ai-feed/ai";

const FETCH_HEADERS = {
  "user-agent": "DigitalConnectNews/1.0 (+newsroom feed reader)",
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
};

async function getText(url: string, timeoutMs = 20000): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export type ResolvedFeed = { url: string; xml: string; discovered: boolean };

/**
 * Turns whatever URL a person pasted into a URL that actually parses.
 *
 * Nobody knows or should have to know a site's feed path — pasting
 * "techcrunch.com" is the natural thing to do, and failing with "that isn't a
 * feed" pushes work onto the user that the server can just do. So: if the URL
 * is already a feed, use it; if it's an HTML page, read the <link rel=alternate>
 * tags it advertises; and only if it advertises none, try the conventional
 * paths. Whatever finally parses is stored, so discovery happens once rather
 * than on every poll.
 */
export async function resolveFeedUrl(input: string): Promise<ResolvedFeed> {
  const direct = await getText(input);
  if (looksLikeFeed(direct) && parseFeed(direct).length > 0) {
    return { url: input, xml: direct, discovered: false };
  }

  const candidates = [
    ...discoverFeedLinks(direct, input),
    ...guessFeedUrls(input),
  ].filter((c) => c !== input);

  const tried = new Set<string>();
  for (const candidate of candidates.slice(0, 12)) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      // Shorter timeout per guess: several may 404 and we don't want a slow
      // site to burn the whole request budget on dead paths.
      const xml = await getText(candidate, 10000);
      if (looksLikeFeed(xml) && parseFeed(xml).length > 0) {
        return { url: candidate, xml, discovered: true };
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "Couldn't find an RSS or Atom feed at that address, or at the usual feed paths for it. " +
      "Open the site and look for its RSS link, then paste that URL instead."
  );
}

/** Append-only processing log. Never throws — logging must not break ingest. */
export async function logEvent(itemId: string, label: string, detail?: string) {
  try {
    await db.insert(feedEvent).values({ itemId, label, detail: detail ?? null });
  } catch {
    // A failed log line is not worth failing an ingest run over.
  }
}

/**
 * Pulls one source and stores any articles not seen before.
 *
 * Returns rather than throws on failure: a broken source records its error on
 * its own row and the caller moves on, so one dead feed can never stop the
 * others. That's the whole reason this is per-source rather than one batch.
 */
export async function fetchSource(sourceId: string): Promise<{
  ok: boolean;
  inserted: number;
  message: string;
}> {
  const [source] = await db.select().from(feedSource).where(eq(feedSource.id, sourceId)).limit(1);
  if (!source) return { ok: false, inserted: 0, message: "That source no longer exists." };

  await db
    .update(feedSource)
    .set({ status: "fetching", updatedAt: new Date() })
    .where(eq(feedSource.id, sourceId));

  try {
    const resolved = await resolveFeedUrl(source.url);
    const parsed = parseFeed(resolved.xml);
    if (parsed.length === 0) {
      throw new Error("The feed parsed but contained no articles.");
    }
    // Discovery is sticky: store what actually worked so later polls skip it.
    if (resolved.discovered) {
      await db
        .update(feedSource)
        .set({ url: resolved.url, updatedAt: new Date() })
        .where(eq(feedSource.id, sourceId));
    }

    // One query for everything already stored from this source, rather than a
    // lookup per article: a feed page is ~20-100 items and most are repeats.
    const guids = parsed.map((p) => p.guid);
    const existing = await db
      .select({ guid: feedItem.guid })
      .from(feedItem)
      .where(and(eq(feedItem.sourceId, sourceId), inArray(feedItem.guid, guids)));
    const seen = new Set(existing.map((e) => e.guid));

    const fresh = parsed.filter((p) => !seen.has(p.guid));
    let inserted = 0;

    for (const item of fresh) {
      try {
        const [created] = await db
          .insert(feedItem)
          .values({
            sourceId,
            guid: item.guid,
            originalTitle: item.title,
            originalBody: item.body,
            originalUrl: item.url,
            originalLanguage: source.language,
            imageUrl: item.imageUrl,
            publishedAt: item.publishedAt,
            storyKey: storyFingerprint(item.title),
            aiCategory: source.defaultCategory,
            status: "new",
          })
          // The (sourceId, guid) unique index is the real duplicate guard —
          // this also covers two concurrent runs racing on the same article.
          .onConflictDoNothing()
          .returning({ id: feedItem.id });
        if (created) {
          inserted += 1;
          await logEvent(created.id, "Article collected", `From ${source.name}`);
        }
      } catch {
        // A single malformed article shouldn't abort the whole source.
      }
    }

    await db
      .update(feedSource)
      .set({ status: "healthy", lastError: null, lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(feedSource.id, sourceId));

    return {
      ok: true,
      inserted,
      message: inserted > 0 ? `${inserted} new article${inserted === 1 ? "" : "s"}.` : "No new articles.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(feedSource)
      .set({ status: "error", lastError: message, lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(feedSource.id, sourceId));
    return { ok: false, inserted: 0, message };
  }
}

/** Pulls every enabled source. Each is independent; failures are collected. */
export async function fetchAllSources() {
  const sources = await db.select({ id: feedSource.id }).from(feedSource).where(eq(feedSource.enabled, true));
  const results = [];
  for (const s of sources) {
    results.push({ id: s.id, ...(await fetchSource(s.id)) });
  }
  return results;
}

/**
 * Runs translation then summarisation for one item, recording each stage.
 *
 * Status moves new → translating → summarising → ready so the dashboard shows
 * real progress, and any failure parks the item at `failed` with the message
 * intact so Retry is possible without re-ingesting.
 */
export async function processItem(itemId: string): Promise<{ ok: boolean; message: string }> {
  const [item] = await db.select().from(feedItem).where(eq(feedItem.id, itemId)).limit(1);
  if (!item) return { ok: false, message: "That article no longer exists." };

  try {
    await db
      .update(feedItem)
      .set({ status: "translating", lastError: null, updatedAt: new Date() })
      .where(eq(feedItem.id, itemId));
    await logEvent(itemId, "Translation started");

    const translation = await translateToBangla(item.originalTitle, item.originalBody);

    await db
      .update(feedItem)
      .set({
        banglaTitle: translation.banglaTitle,
        banglaBody: translation.banglaBody,
        translationRuns: sql`${feedItem.translationRuns} + 1`,
        status: "summarising",
        updatedAt: new Date(),
      })
      .where(eq(feedItem.id, itemId));
    await logEvent(itemId, "Translation completed");
    await logEvent(itemId, "Summary started");

    const summary = await summariseForNewsroom(item.originalTitle, item.originalBody);

    await db
      .update(feedItem)
      .set({
        banglaSummary: summary.banglaSummary,
        keyPoints: summary.keyPoints,
        // A source's default category is only a fallback; the AI read the
        // actual article, so its judgement wins unless an editor overrides.
        aiCategory: summary.category,
        aiLocation: summary.location,
        aiEntities: summary.entities,
        summaryRuns: sql`${feedItem.summaryRuns} + 1`,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(feedItem.id, itemId));
    await logEvent(itemId, "Ready for review");

    return { ok: true, message: "Processed." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await db
      .update(feedItem)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(feedItem.id, itemId));
    await logEvent(itemId, "Processing failed", message);
    return { ok: false, message };
  }
}

/**
 * Processes queued items, oldest first, with a hard cap.
 *
 * The cap exists because each item is two LLM calls: an unbounded backlog
 * would blow a serverless function's timeout and the API budget in one run.
 * Whatever's left is simply picked up by the next run.
 */
export async function processPending(limit = 5) {
  const pending = await db
    .select({ id: feedItem.id })
    .from(feedItem)
    .where(eq(feedItem.status, "new"))
    .orderBy(feedItem.createdAt)
    .limit(limit);

  const results = [];
  for (const p of pending) {
    const result = await processItem(p.id);
    results.push({ id: p.id, ...result });
    // No credit / bad key / rate limited will fail identically for every
    // remaining item, so stop rather than marking the whole queue failed.
    if (!result.ok && isAccountLevelFailure(result.message)) break;
  }
  return results;
}
