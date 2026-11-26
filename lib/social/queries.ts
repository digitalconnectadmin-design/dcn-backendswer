import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db/drizzle";
import {
  reel,
  socialAccountGroup,
  socialAccountGroupMember,
  socialAuditLog,
  socialConnection,
  socialPost,
  socialPublication,
  story,
  user,
} from "@/db/schema";
import { NEWSROOM_TIMEZONE, type SocialContentType } from "@/lib/social/content";
import type { SocialPlatform } from "@/lib/social/types";

/**
 * Read models for the social pages. Tokens never leave this file: every
 * select names its columns, and none of them is `accessToken` or
 * `refreshToken` — the spec's "never display full access credentials".
 */

/** Midnight "today" in the newsroom's timezone, as a UTC instant. */
export function startOfNewsroomDay(now = new Date(), timeZone = NEWSROOM_TIMEZONE): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day);
  const localAsUtc = Date.UTC(y, m, d, Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = Math.round((localAsUtc - now.getTime()) / 60_000) * 60_000;
  return new Date(Date.UTC(y, m, d) - offset);
}

export type AccountSummary = {
  id: string;
  platform: SocialPlatform;
  label: string;
  username: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  accountType: string | null;
  isActive: boolean;
  needsAttention: boolean;
  healthMessage: string | null;
  lastCheckedAt: Date | null;
  lastPostedAt: Date | null;
  createdAt: Date;
  deactivatedAt: Date | null;
  connectedByName: string | null;
  scheduledCount: number;
  groups: { id: string; name: string }[];
};

export async function listAccounts(): Promise<AccountSummary[]> {
  const connector = alias(user, "connector");
  const rows = await db
    .select({
      id: socialConnection.id,
      platform: socialConnection.platform,
      label: socialConnection.label,
      username: socialConnection.username,
      avatarUrl: socialConnection.avatarUrl,
      followerCount: socialConnection.followerCount,
      accountType: socialConnection.accountType,
      isActive: socialConnection.isActive,
      needsAttention: socialConnection.needsAttention,
      healthMessage: socialConnection.healthMessage,
      lastCheckedAt: socialConnection.lastCheckedAt,
      lastPostedAt: socialConnection.lastPostedAt,
      createdAt: socialConnection.createdAt,
      deactivatedAt: socialConnection.deactivatedAt,
      connectedByName: connector.name,
    })
    .from(socialConnection)
    .leftJoin(connector, eq(connector.id, socialConnection.connectedById))
    .orderBy(socialConnection.platform, socialConnection.label);

  const ids = rows.map((r) => r.id);
  const [scheduled, memberships] = await Promise.all([
    ids.length
      ? db
          .select({ connectionId: socialPost.connectionId, n: count() })
          .from(socialPost)
          .where(and(inArray(socialPost.connectionId, ids), eq(socialPost.status, "scheduled")))
          .groupBy(socialPost.connectionId)
      : [],
    ids.length
      ? db
          .select({
            connectionId: socialAccountGroupMember.connectionId,
            id: socialAccountGroup.id,
            name: socialAccountGroup.name,
          })
          .from(socialAccountGroupMember)
          .innerJoin(socialAccountGroup, eq(socialAccountGroup.id, socialAccountGroupMember.groupId))
          .where(inArray(socialAccountGroupMember.connectionId, ids))
      : [],
  ]);

  return rows.map((r) => ({
    ...r,
    scheduledCount: scheduled.find((s) => s.connectionId === r.id)?.n ?? 0,
    groups: memberships.filter((m) => m.connectionId === r.id).map((m) => ({ id: m.id, name: m.name })),
  }));
}

export async function listGroups() {
  const [groups, members] = await Promise.all([
    db.select({ id: socialAccountGroup.id, name: socialAccountGroup.name }).from(socialAccountGroup).orderBy(socialAccountGroup.name),
    db.select().from(socialAccountGroupMember),
  ]);
  return groups.map((g) => ({
    ...g,
    connectionIds: members.filter((m) => m.groupId === g.id).map((m) => m.connectionId),
  }));
}

/** Active accounts in the shape the account picker needs. */
export async function listPickerAccounts() {
  const accounts = await listAccounts();
  return accounts
    .filter((a) => a.isActive)
    .map((a) => ({
      id: a.id,
      platform: a.platform,
      label: a.label,
      username: a.username,
      avatarUrl: a.avatarUrl,
      needsAttention: a.needsAttention,
      healthMessage: a.healthMessage,
      groups: a.groups,
    }));
}

export async function getSocialStats() {
  const today = startOfNewsroomDay();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [[connected], [attention], [publishedToday], [scheduled], [failed]] = await Promise.all([
    db.select({ n: count() }).from(socialConnection).where(eq(socialConnection.isActive, true)),
    db
      .select({ n: count() })
      .from(socialConnection)
      .where(and(eq(socialConnection.isActive, true), eq(socialConnection.needsAttention, true))),
    db.select({ n: count() }).from(socialPost).where(and(eq(socialPost.status, "posted"), gte(socialPost.postedAt, today))),
    db.select({ n: count() }).from(socialPost).where(eq(socialPost.status, "scheduled")),
    db.select({ n: count() }).from(socialPost).where(and(eq(socialPost.status, "failed"), gte(socialPost.createdAt, weekAgo))),
  ]);
  return {
    connected: connected.n,
    needsAttention: attention.n,
    publishedToday: publishedToday.n,
    scheduled: scheduled.n,
    failed: failed.n,
  };
}

export type PublicationPost = {
  id: string;
  platform: SocialPlatform;
  connectionId: string | null;
  accountLabel: string | null;
  currentLabel: string | null;
  avatarUrl: string | null;
  contentType: SocialContentType | null;
  status: "queued" | "posted" | "failed" | "scheduled" | "publishing" | "cancelled";
  caption: string | null;
  errorMessage: string | null;
  warning: string | null;
  permalink: string | null;
  scheduledFor: Date | null;
  postedAt: Date | null;
  lastAttemptAt: Date | null;
  attemptCount: number;
  createdAt: Date;
};

const POST_FIELDS = {
  id: socialPost.id,
  platform: socialPost.platform,
  connectionId: socialPost.connectionId,
  accountLabel: socialPost.accountLabel,
  currentLabel: socialConnection.label,
  avatarUrl: socialConnection.avatarUrl,
  contentType: socialPost.contentType,
  status: socialPost.status,
  caption: socialPost.caption,
  errorMessage: socialPost.errorMessage,
  warning: socialPost.warning,
  permalink: socialPost.permalink,
  scheduledFor: socialPost.scheduledFor,
  postedAt: socialPost.postedAt,
  lastAttemptAt: socialPost.lastAttemptAt,
  attemptCount: socialPost.attemptCount,
  createdAt: socialPost.createdAt,
};

export async function getPublication(id: string) {
  const author = alias(user, "author");
  const [pub] = await db
    .select({
      id: socialPublication.id,
      title: socialPublication.title,
      sourceKind: socialPublication.sourceKind,
      storyId: socialPublication.storyId,
      reelId: socialPublication.reelId,
      createdAt: socialPublication.createdAt,
      createdByName: author.name,
    })
    .from(socialPublication)
    .leftJoin(author, eq(author.id, socialPublication.createdById))
    .where(eq(socialPublication.id, id))
    .limit(1);
  if (!pub) return null;
  const posts: PublicationPost[] = await db
    .select(POST_FIELDS)
    .from(socialPost)
    .leftJoin(socialConnection, eq(socialConnection.id, socialPost.connectionId))
    .where(eq(socialPost.publicationId, id))
    .orderBy(socialPost.platform, socialPost.createdAt);
  return { ...pub, posts };
}

export type PublicationSummary = {
  id: string;
  title: string;
  sourceKind: "story" | "reel" | "custom";
  createdAt: Date;
  createdByName: string | null;
  total: number;
  posted: number;
  failed: number;
  scheduled: number;
  pending: number;
  nextScheduledFor: Date | null;
};

export async function listRecentPublications(limit = 12): Promise<PublicationSummary[]> {
  const author = alias(user, "author");
  const pubs = await db
    .select({
      id: socialPublication.id,
      title: socialPublication.title,
      sourceKind: socialPublication.sourceKind,
      createdAt: socialPublication.createdAt,
      createdByName: author.name,
    })
    .from(socialPublication)
    .leftJoin(author, eq(author.id, socialPublication.createdById))
    .orderBy(desc(socialPublication.createdAt))
    .limit(limit);
  if (pubs.length === 0) return [];

  const counts = await db
    .select({
      publicationId: socialPost.publicationId,
      status: socialPost.status,
      n: count(),
      next: sql<Date | null>`min(${socialPost.scheduledFor})`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(socialPost)
    .where(inArray(socialPost.publicationId, pubs.map((p) => p.id)))
    .groupBy(socialPost.publicationId, socialPost.status);

  return pubs.map((p) => {
    const mine = counts.filter((c) => c.publicationId === p.id);
    const of = (s: string) => mine.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0);
    return {
      ...p,
      total: mine.reduce((a, c) => a + c.n, 0),
      posted: of("posted"),
      failed: of("failed"),
      scheduled: of("scheduled"),
      pending: of("queued") + of("publishing"),
      nextScheduledFor: mine.find((c) => c.status === "scheduled")?.next ?? null,
    };
  });
}

export async function listUpcomingScheduled(limit = 8) {
  return db
    .select({ ...POST_FIELDS, publicationId: socialPost.publicationId, publicationTitle: socialPublication.title })
    .from(socialPost)
    .leftJoin(socialConnection, eq(socialConnection.id, socialPost.connectionId))
    .leftJoin(socialPublication, eq(socialPublication.id, socialPost.publicationId))
    .where(eq(socialPost.status, "scheduled"))
    .orderBy(socialPost.scheduledFor)
    .limit(limit);
}

export type HistoryFilters = {
  platform?: string;
  account?: string;
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
};

export const HISTORY_PAGE_SIZE = 25;

/**
 * Every per-account attempt, newest first, filtered and paged in SQL. Rows
 * from before publications existed are titled from their story or reel.
 */
export async function listHistory(filters: HistoryFilters) {
  const titleExpr = sql<string>`coalesce(${socialPublication.title}, ${story.title}, left(${reel.caption}, 120), 'Untitled')`;
  const conditions: SQL[] = [];
  if (filters.platform) conditions.push(sql`${socialPost.platform} = ${filters.platform}`);
  if (filters.account) conditions.push(eq(socialPost.connectionId, filters.account));
  if (filters.status) conditions.push(sql`${socialPost.status} = ${filters.status}`);
  if (filters.type) conditions.push(sql`${socialPost.contentType} = ${filters.type}`);
  if (filters.from) {
    const d = new Date(filters.from);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(socialPost.createdAt, d));
  }
  if (filters.to) {
    const d = new Date(filters.to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(socialPost.createdAt, d));
    }
  }
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(
      or(
        ilike(socialPublication.title, term),
        ilike(story.title, term),
        ilike(socialPost.accountLabel, term),
        ilike(socialPost.caption, term)
      )!
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page ?? 1);
  const author = alias(user, "author");

  const base = db
    .select({
      ...POST_FIELDS,
      publicationId: socialPost.publicationId,
      storyId: socialPost.storyId,
      reelId: socialPost.reelId,
      title: titleExpr,
      createdByName: author.name,
    })
    .from(socialPost)
    .leftJoin(socialConnection, eq(socialConnection.id, socialPost.connectionId))
    .leftJoin(socialPublication, eq(socialPublication.id, socialPost.publicationId))
    .leftJoin(story, eq(story.id, socialPost.storyId))
    .leftJoin(reel, eq(reel.id, socialPost.reelId))
    .leftJoin(author, eq(author.id, socialPost.createdById));

  const [rows, [{ n }]] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(sql`coalesce(${socialPost.postedAt}, ${socialPost.scheduledFor}, ${socialPost.createdAt})`))
      .limit(HISTORY_PAGE_SIZE)
      .offset((page - 1) * HISTORY_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(socialPost)
      .leftJoin(socialPublication, eq(socialPublication.id, socialPost.publicationId))
      .leftJoin(story, eq(story.id, socialPost.storyId))
      .where(where),
  ]);
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / HISTORY_PAGE_SIZE)) };
}

export async function listRecentAudit(limit = 15) {
  const actor = alias(user, "actor");
  return db
    .select({
      id: socialAuditLog.id,
      platform: socialAuditLog.platform,
      accountLabel: socialAuditLog.accountLabel,
      action: socialAuditLog.action,
      detail: socialAuditLog.detail,
      createdAt: socialAuditLog.createdAt,
      actorName: actor.name,
    })
    .from(socialAuditLog)
    .leftJoin(actor, eq(actor.id, socialAuditLog.actorId))
    .orderBy(desc(socialAuditLog.createdAt))
    .limit(limit);
}

/** Posts for one website item, newest first — the story/reel detail pages' social card. */
export async function listPostsForItem(target: { storyId?: string; reelId?: string }) {
  const match = target.storyId ? eq(socialPost.storyId, target.storyId) : eq(socialPost.reelId, target.reelId ?? "");
  return db
    .select({ ...POST_FIELDS, publicationId: socialPost.publicationId })
    .from(socialPost)
    .leftJoin(socialConnection, eq(socialConnection.id, socialPost.connectionId))
    .where(match)
    .orderBy(desc(socialPost.createdAt))
    .limit(40);
}
