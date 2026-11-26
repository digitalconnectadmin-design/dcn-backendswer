import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { reel, socialConnection, socialPost, socialPublication, story } from "@/db/schema";
import { socialRegistry } from "@/lib/social/registry";
import { defaultContent } from "@/lib/social/templates";
import { getSiteUrl } from "@/lib/site";
import {
  SocialApiError,
  type PublishRequest,
  type RefreshedToken,
  type SocialConnectionRecord,
  type SocialPlatform,
} from "@/lib/social/types";
import type { SocialContentType, SocialMediaItem, SocialPostOptions } from "@/lib/social/content";
import { PLATFORM_LABELS } from "@/lib/social/platforms";

/**
 * The social publishing engine. Every path that publishes to a social
 * account — the composer, the Story Pipeline's Publish tab, the scheduled
 * cron, retries — goes through the same three steps:
 *
 *   1. write one `social_post` row per account, carrying the complete
 *      request (content type, caption, media, options) — status `queued`,
 *      or `scheduled` with its own `scheduledFor`
 *   2. `runSocialPosts(ids)` — usually inside `after()`, so the editor's
 *      request returns immediately — atomically claims each row
 *      (`queued`/`scheduled` → `publishing`) and calls the platform
 *   3. the row ends `posted` (with permalink and any warning) or `failed`
 *      (with the platform's own reason); one account failing never touches
 *      another
 *
 * The claim in step 2 is what makes it safe for the cron and an in-request
 * run to race for the same row: exactly one UPDATE can move it out of
 * `queued`, and only that caller publishes.
 */

type ConnectionRow = typeof socialConnection.$inferSelect;
type PostRow = typeof socialPost.$inferSelect;

async function persistToken(connectionId: string, tokens: RefreshedToken) {
  try {
    await db
      .update(socialConnection)
      .set({
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(socialConnection.id, connectionId));
  } catch {
    // Never let a bookkeeping write fail the publish that triggered it.
  }
}

export function connectionRecord(c: ConnectionRow): SocialConnectionRecord {
  return {
    id: c.id,
    platform: c.platform,
    externalAccountId: c.externalAccountId,
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    tokenExpiresAt: c.tokenExpiresAt,
    onTokenRefresh: (tokens) => persistToken(c.id, tokens),
  };
}

// ---------------------------------------------------------------------------
// Writing posts
// ---------------------------------------------------------------------------

export type NewSocialPost = {
  connectionId: string;
  platform: SocialPlatform;
  accountLabel: string;
  contentType: SocialContentType;
  caption: string;
  title: string | null;
  linkUrl: string | null;
  media: SocialMediaItem[];
  thumbnailUrl: string | null;
  options: SocialPostOptions;
  /** Null = publish now. */
  scheduledFor: Date | null;
};

/**
 * Creates the publication and its per-account rows. Returns the ids that
 * should run right now (everything not scheduled for later).
 */
export async function createPublication(input: {
  title: string;
  sourceKind: "story" | "reel" | "custom";
  storyId: string | null;
  reelId: string | null;
  actorId: string | null;
  posts: NewSocialPost[];
}): Promise<{ publicationId: string; runNow: string[] }> {
  const [publication] = await db
    .insert(socialPublication)
    .values({
      title: input.title.slice(0, 300) || "Untitled post",
      sourceKind: input.sourceKind,
      storyId: input.storyId,
      reelId: input.reelId,
      createdById: input.actorId,
    })
    .returning({ id: socialPublication.id });

  if (input.posts.length === 0) return { publicationId: publication.id, runNow: [] };

  const now = Date.now();
  const rows = await db
    .insert(socialPost)
    .values(
      input.posts.map((p) => {
        const later = p.scheduledFor && p.scheduledFor.getTime() > now + 30_000;
        return {
          publicationId: publication.id,
          storyId: input.storyId,
          reelId: input.reelId,
          platform: p.platform,
          connectionId: p.connectionId,
          accountLabel: p.accountLabel,
          contentType: p.contentType,
          caption: p.caption,
          title: p.title,
          linkUrl: p.linkUrl,
          media: p.media,
          thumbnailUrl: p.thumbnailUrl,
          options: p.options,
          scheduledFor: later ? p.scheduledFor : null,
          status: later ? ("scheduled" as const) : ("queued" as const),
          createdById: input.actorId,
        };
      })
    )
    .returning({ id: socialPost.id, status: socialPost.status });

  return {
    publicationId: publication.id,
    runNow: rows.filter((r) => r.status === "queued").map((r) => r.id),
  };
}

// ---------------------------------------------------------------------------
// Website content → default social posts (Story Pipeline, scheduled cron)
// ---------------------------------------------------------------------------

export type CrossPostTarget = { kind: "article"; storyId: string } | { kind: "reel"; reelId: string };

type SourceItem = {
  title: string;
  excerpt: string | null;
  url: string | null;
  tags: string[];
  image: string | null;
  video: string | null;
  thumbnail: string | null;
};

async function loadSource(target: CrossPostTarget): Promise<SourceItem | null> {
  if (target.kind === "article") {
    const [row] = await db.select().from(story).where(eq(story.id, target.storyId)).limit(1);
    if (!row) return null;
    return {
      title: row.title,
      excerpt: row.excerpt,
      url: `${getSiteUrl()}/story/${row.slug}`,
      tags: row.tags,
      image: row.photocardImageUrl ?? row.featuredImageUrl,
      video: null,
      thumbnail: null,
    };
  }
  const [row] = await db.select().from(reel).where(eq(reel.id, target.reelId)).limit(1);
  if (!row) return null;
  return {
    title: row.caption.split("\n")[0].slice(0, 100),
    excerpt: row.caption,
    url: null,
    tags: [],
    image: null,
    video: row.videoUrl,
    thumbnail: row.thumbnailUrl,
  };
}

/**
 * The content type each platform gets when nobody chose one — website
 * articles become link/photo posts, reels become each platform's native
 * short-video type. Null = the platform can't take this kind at all.
 */
export function autoContentType(platform: SocialPlatform, kind: CrossPostTarget["kind"]): SocialContentType | null {
  if (kind === "article") {
    return platform === "youtube" || platform === "tiktok" ? null : "post";
  }
  switch (platform) {
    case "facebook":
    case "instagram":
      return "reel";
    case "youtube":
      return "short";
    case "tiktok":
      return "video";
    case "x":
      return "post";
    default:
      // LinkedIn video isn't supported yet.
      return null;
  }
}

function autoRequest(platform: SocialPlatform, type: SocialContentType, src: SourceItem) {
  const { caption, title } = defaultContent(platform, type, {
    title: src.title,
    excerpt: src.excerpt,
    url: src.url,
    tags: src.tags,
  });
  let media: SocialMediaItem[] = [];
  if (src.video) media = [{ url: src.video, kind: "video" }];
  // Instagram can't post text or links, so an article goes as its photo.
  else if (platform === "instagram" && src.image) media = [{ url: src.image, kind: "image" }];
  return {
    caption,
    title: title ?? (platform === "youtube" ? src.title.slice(0, 100) : null),
    media,
    linkUrl: src.url,
    thumbnailUrl: src.thumbnail,
  };
}

/**
 * Queues the website item for the given accounts with each platform's
 * default content. `connectionIds === undefined` means every active account
 * (the historical behaviour the scheduled-publish cron still relies on for
 * rows written before explicit selection existed); an empty array means
 * none — website only.
 */
export async function enqueueCrossPost(
  target: CrossPostTarget,
  connectionIds?: string[],
  actorId: string | null = null
): Promise<string[]> {
  if (connectionIds && connectionIds.length === 0) return [];
  const src = await loadSource(target);
  if (!src) return [];

  let connections = await db.select().from(socialConnection).where(eq(socialConnection.isActive, true));
  if (connectionIds) {
    const allowed = new Set(connectionIds);
    connections = connections.filter((c) => allowed.has(c.id));
  }
  if (connections.length === 0) return [];

  const posts: NewSocialPost[] = [];
  const unsupported: ConnectionRow[] = [];
  for (const c of connections) {
    const type = autoContentType(c.platform, target.kind);
    if (!type || (type === "post" && c.platform === "instagram" && !src.image && !src.video)) {
      unsupported.push(c);
      continue;
    }
    posts.push({
      connectionId: c.id,
      platform: c.platform,
      accountLabel: c.label,
      contentType: type,
      options: type === "short" || type === "video"
        ? { youtube: { visibility: "public", tags: src.tags.slice(0, 15), categoryId: "25" } }
        : {},
      scheduledFor: null,
      ...autoRequest(c.platform, type, src),
    });
  }

  const { publicationId, runNow } = await createPublication({
    title: src.title,
    sourceKind: target.kind === "article" ? "story" : "reel",
    storyId: target.kind === "article" ? target.storyId : null,
    reelId: target.kind === "reel" ? target.reelId : null,
    actorId,
    posts,
  });

  // Recorded, not silently dropped, so the result screen explains why an
  // account the editor ticked got nothing.
  if (unsupported.length > 0) {
    await db.insert(socialPost).values(
      unsupported.map((c) => ({
        publicationId,
        storyId: target.kind === "article" ? target.storyId : null,
        reelId: target.kind === "reel" ? target.reelId : null,
        platform: c.platform,
        connectionId: c.id,
        accountLabel: c.label,
        status: "failed" as const,
        createdById: actorId,
        errorMessage:
          target.kind === "article"
            ? `${PLATFORM_LABELS[c.platform]} only publishes video — this story has no video. Use the social composer to attach one.`
            : `${PLATFORM_LABELS[c.platform]} video posting isn't supported yet.`,
      }))
    );
  }
  return runNow;
}

// ---------------------------------------------------------------------------
// Retry / schedule controls
// ---------------------------------------------------------------------------

/** Moves failed rows back to `queued`. Returns the ids that were actually re-queued. */
export async function queueRetry(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(socialPost)
    .set({ status: "queued", errorMessage: null, warning: null, scheduledFor: null })
    .where(and(inArray(socialPost.id, ids), eq(socialPost.status, "failed")))
    .returning({ id: socialPost.id });
  return rows.map((r) => r.id);
}

/** Every failed attempt for a website item — the classic desks' "Retry failed posts". */
export async function requeueUnfinishedCrossPost(target: CrossPostTarget): Promise<string[]> {
  const match = target.kind === "article" ? eq(socialPost.storyId, target.storyId) : eq(socialPost.reelId, target.reelId);
  const failed = await db
    .select({ id: socialPost.id })
    .from(socialPost)
    .where(and(match, eq(socialPost.status, "failed")));
  return queueRetry(failed.map((r) => r.id));
}

export async function cancelScheduled(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(socialPost)
    .set({ status: "cancelled" })
    .where(and(inArray(socialPost.id, ids), eq(socialPost.status, "scheduled")))
    .returning({ id: socialPost.id });
  return rows.length;
}

export async function publishScheduledNow(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(socialPost)
    .set({ status: "queued", scheduledFor: null })
    .where(and(inArray(socialPost.id, ids), eq(socialPost.status, "scheduled")))
    .returning({ id: socialPost.id });
  return rows.map((r) => r.id);
}

/**
 * For the cron: marks runs that died mid-publish as failed (a serverless
 * function killed at its time limit leaves the row in `publishing`
 * forever), then returns rows that are due — scheduled ones whose time has
 * come, and queued ones nobody picked up.
 */
export async function claimDueIds(limit = 8): Promise<string[]> {
  const now = new Date();
  await db
    .update(socialPost)
    .set({
      status: "failed",
      errorMessage:
        "Interrupted before it finished. The platform may or may not have received it — check the account before retrying.",
    })
    .where(and(eq(socialPost.status, "publishing"), lt(socialPost.lastAttemptAt, new Date(now.getTime() - 20 * 60_000))));

  const due = await db
    .select({ id: socialPost.id })
    .from(socialPost)
    .where(
      or(
        and(eq(socialPost.status, "scheduled"), lte(socialPost.scheduledFor, now)),
        and(eq(socialPost.status, "queued"), lt(socialPost.createdAt, new Date(now.getTime() - 10 * 60_000)))
      )
    )
    .orderBy(asc(socialPost.createdAt))
    .limit(limit);
  return due.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Rows written before content types existed — rebuild their request from the story/reel. */
async function legacyRequest(row: PostRow): Promise<PublishRequest> {
  const target: CrossPostTarget | null = row.storyId
    ? { kind: "article", storyId: row.storyId }
    : row.reelId
      ? { kind: "reel", reelId: row.reelId }
      : null;
  const src = target ? await loadSource(target) : null;
  const type = target ? autoContentType(row.platform, target.kind) : null;
  if (!src || !target || !type) {
    throw new SocialApiError("This older post can't be rebuilt — publish it again from the social composer.");
  }
  return {
    contentType: type,
    options: {},
    ...autoRequest(row.platform, type, src),
  };
}

function requestFromRow(row: PostRow): PublishRequest {
  return {
    contentType: row.contentType!,
    caption: row.caption ?? "",
    title: row.title,
    linkUrl: row.linkUrl,
    media: row.media ?? [],
    thumbnailUrl: row.thumbnailUrl,
    options: row.options ?? {},
  };
}

async function runOne(id: string) {
  const [row] = await db
    .update(socialPost)
    .set({
      status: "publishing",
      lastAttemptAt: new Date(),
      attemptCount: sql`${socialPost.attemptCount} + 1`,
      errorMessage: null,
    })
    .where(and(eq(socialPost.id, id), inArray(socialPost.status, ["queued", "scheduled"])))
    .returning();
  if (!row) return; // someone else claimed it, or it was cancelled

  let connectionId: string | null = row.connectionId;
  try {
    const [connection] = connectionId
      ? await db.select().from(socialConnection).where(eq(socialConnection.id, connectionId)).limit(1)
      : [];
    if (!connection) {
      connectionId = null;
      throw new SocialApiError("This account was removed before the post went out.");
    }
    if (!connection.isActive) {
      throw new SocialApiError("This account was deactivated before the post went out. Reactivate it and retry.");
    }

    const request = row.contentType ? requestFromRow(row) : await legacyRequest(row);
    const result = await socialRegistry[connection.platform].publish(request, connectionRecord(connection));

    await db
      .update(socialPost)
      .set({
        status: "posted",
        externalPostId: result.externalPostId,
        permalink: result.permalink ?? null,
        warning: result.warning || null,
        errorMessage: null,
        postedAt: new Date(),
        ...(row.contentType ? {} : { contentType: request.contentType }),
      })
      .where(eq(socialPost.id, id));

    await db
      .update(socialConnection)
      .set({
        lastPostedAt: new Date(),
        needsAttention: false,
        healthMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(socialConnection.id, connection.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.update(socialPost).set({ status: "failed", errorMessage: message }).where(eq(socialPost.id, id));
    if (err instanceof SocialApiError && err.authProblem && connectionId) {
      await db
        .update(socialConnection)
        .set({ needsAttention: true, healthMessage: message, lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(socialConnection.id, connectionId));
    }
  }
}

/**
 * Runs the given rows. Text/photo posts go concurrently; anything with a
 * video goes one at a time, because YouTube/X/LinkedIn download the whole
 * file into memory before uploading it — six at once risks running a
 * serverless instance out of memory.
 */
export async function runSocialPosts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: socialPost.id, media: socialPost.media, reelId: socialPost.reelId, contentType: socialPost.contentType })
    .from(socialPost)
    .where(inArray(socialPost.id, ids));

  const heavy = (r: (typeof rows)[number]) =>
    (r.media ?? []).some((m) => m.kind === "video") || (r.contentType === null && r.reelId !== null);

  await Promise.all(rows.filter((r) => !heavy(r)).map((r) => runOne(r.id)));
  for (const r of rows.filter(heavy)) await runOne(r.id);
}
