/**
 * Live Studio — server reads.
 *
 * A plain server module. Its functions can be *called* from a server
 * component, but handing one to a client component fails at serialisation and
 * 500s the page (the trap documented for Kanban, the Web Studio and the NM
 * Desk in CLAUDE.md). `loadLiveEvent` in the actions file is the real action
 * that wraps `getLiveEvent`, and it carries the access check.
 *
 * Nothing here selects a stream key, because none is stored — see the
 * `live_event` comment in db/schema.ts.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import {
  liveComment,
  liveDestination,
  liveEvent,
  liveEventLog,
  liveViewerSample,
  socialConnection,
  story,
  user,
} from "@/db/schema";
import { LIVE_PLATFORMS } from "@/lib/live/types";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export type LiveRelayStats = {
  state: string;
  uptimeSec: number;
  bitrate: string | null;
  fps: number;
  droppedFrames: number;
  /** Times the encoder fell so far behind that the stream had to be restarted. */
  overruns: number;
  speed: string | null;
  restarts: number;
  error: string | null;
  log: string[];
};

export type LiveDestinationRow = {
  id: string;
  connectionId: string;
  platform: string;
  accountLabel: string;
  status: string;
  externalVideoId: string | null;
  permalink: string | null;
  viewers: number;
  errorMessage: string | null;
};

export type LiveEventRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  source: "program" | "camera";
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  relaySessionId: string | null;
  errorMessage: string | null;
  peakViewers: number;
  storyId: string | null;
  storyTitle: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  destinations: LiveDestinationRow[];
};

export type LiveCommentRow = {
  id: string;
  platform: string;
  accountLabel: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  message: string;
  postedAt: string;
};

/**
 * Accounts a broadcast can go to.
 *
 * Only Facebook Pages and YouTube channels — see `LIVE_UNSUPPORTED` in
 * lib/live/types.ts for why the other four connected platforms can't be live
 * destinations. Inactive accounts and ones flagged "Action required" are
 * listed but marked, because an operator about to go live needs to know the
 * token is stale *before* the countdown rather than after.
 */
export async function listLiveAccounts() {
  const rows = await db
    .select({
      id: socialConnection.id,
      platform: socialConnection.platform,
      label: socialConnection.label,
      username: socialConnection.username,
      avatarUrl: socialConnection.avatarUrl,
      isActive: socialConnection.isActive,
      needsAttention: socialConnection.needsAttention,
      healthMessage: socialConnection.healthMessage,
    })
    .from(socialConnection)
    .where(inArray(socialConnection.platform, [...LIVE_PLATFORMS]))
    .orderBy(socialConnection.platform, socialConnection.label);

  return rows;
}

function destinationShape() {
  return {
    id: liveDestination.id,
    connectionId: liveDestination.connectionId,
    platform: liveDestination.platform,
    accountLabel: liveDestination.accountLabel,
    status: liveDestination.status,
    externalVideoId: liveDestination.externalVideoId,
    permalink: liveDestination.permalink,
    viewers: liveDestination.viewers,
    errorMessage: liveDestination.errorMessage,
  };
}

async function attachDestinations(eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, LiveDestinationRow[]>();
  const rows = await db
    .select({ eventId: liveDestination.eventId, ...destinationShape() })
    .from(liveDestination)
    .where(inArray(liveDestination.eventId, eventIds))
    .orderBy(liveDestination.platform);

  const map = new Map<string, LiveDestinationRow[]>();
  for (const row of rows) {
    const { eventId, ...rest } = row;
    const list = map.get(eventId) ?? [];
    list.push(rest as LiveDestinationRow);
    map.set(eventId, list);
  }
  return map;
}

const EVENT_COLUMNS = {
  id: liveEvent.id,
  title: liveEvent.title,
  description: liveEvent.description,
  status: liveEvent.status,
  source: liveEvent.source,
  width: liveEvent.width,
  height: liveEvent.height,
  fps: liveEvent.fps,
  videoBitrateKbps: liveEvent.videoBitrateKbps,
  audioBitrateKbps: liveEvent.audioBitrateKbps,
  scheduledFor: liveEvent.scheduledFor,
  startedAt: liveEvent.startedAt,
  endedAt: liveEvent.endedAt,
  relaySessionId: liveEvent.relaySessionId,
  errorMessage: liveEvent.errorMessage,
  peakViewers: liveEvent.peakViewers,
  storyId: liveEvent.storyId,
  createdAt: liveEvent.createdAt,
  updatedAt: liveEvent.updatedAt,
};

function toEventRow(
  row: Record<string, unknown> & { storyTitle?: string | null; createdByName?: string | null },
  destinations: LiveDestinationRow[]
): LiveEventRow {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    status: row.status as string,
    source: (row.source as "program" | "camera") ?? "program",
    width: Number(row.width) || 1920,
    height: Number(row.height) || 1080,
    fps: Number(row.fps) || 30,
    videoBitrateKbps: Number(row.videoBitrateKbps) || 4500,
    audioBitrateKbps: Number(row.audioBitrateKbps) || 128,
    scheduledFor: iso(row.scheduledFor as Date | null),
    startedAt: iso(row.startedAt as Date | null),
    endedAt: iso(row.endedAt as Date | null),
    relaySessionId: (row.relaySessionId as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    peakViewers: Number(row.peakViewers) || 0,
    storyId: (row.storyId as string | null) ?? null,
    storyTitle: row.storyTitle ?? null,
    createdByName: row.createdByName ?? null,
    createdAt: iso(row.createdAt as Date)!,
    updatedAt: iso(row.updatedAt as Date)!,
    destinations,
  };
}

/** The broadcast currently up, if there is one. At most one is allowed at a time. */
export async function getActiveLiveEvent(): Promise<LiveEventRow | null> {
  const [row] = await db
    .select({ ...EVENT_COLUMNS, storyTitle: story.title, createdByName: user.name })
    .from(liveEvent)
    .leftJoin(story, eq(story.id, liveEvent.storyId))
    .leftJoin(user, eq(user.id, liveEvent.createdById))
    .where(inArray(liveEvent.status, ["ready", "live"]))
    .orderBy(desc(liveEvent.updatedAt))
    .limit(1);

  if (!row) return null;
  const destinations = await attachDestinations([row.id]);
  return toEventRow(row, destinations.get(row.id) ?? []);
}

/** Planned broadcasts that haven't happened yet. */
export async function listScheduledLiveEvents(limit = 20): Promise<LiveEventRow[]> {
  const rows = await db
    .select({ ...EVENT_COLUMNS, storyTitle: story.title, createdByName: user.name })
    .from(liveEvent)
    .leftJoin(story, eq(story.id, liveEvent.storyId))
    .leftJoin(user, eq(user.id, liveEvent.createdById))
    .where(inArray(liveEvent.status, ["draft", "scheduled"]))
    .orderBy(sql`coalesce(${liveEvent.scheduledFor}, ${liveEvent.createdAt})`)
    .limit(limit);

  const destinations = await attachDestinations(rows.map((r) => r.id));
  return rows.map((r) => toEventRow(r, destinations.get(r.id) ?? []));
}

/** Finished broadcasts, newest first. */
export async function listPastLiveEvents(limit = 25): Promise<LiveEventRow[]> {
  const rows = await db
    .select({ ...EVENT_COLUMNS, storyTitle: story.title, createdByName: user.name })
    .from(liveEvent)
    .leftJoin(story, eq(story.id, liveEvent.storyId))
    .leftJoin(user, eq(user.id, liveEvent.createdById))
    .where(inArray(liveEvent.status, ["ended", "failed", "cancelled"]))
    .orderBy(desc(sql`coalesce(${liveEvent.endedAt}, ${liveEvent.updatedAt})`))
    .limit(limit);

  const destinations = await attachDestinations(rows.map((r) => r.id));
  return rows.map((r) => toEventRow(r, destinations.get(r.id) ?? []));
}

export async function getLiveEvent(eventId: string): Promise<LiveEventRow | null> {
  const [row] = await db
    .select({ ...EVENT_COLUMNS, storyTitle: story.title, createdByName: user.name })
    .from(liveEvent)
    .leftJoin(story, eq(story.id, liveEvent.storyId))
    .leftJoin(user, eq(user.id, liveEvent.createdById))
    .where(eq(liveEvent.id, eventId))
    .limit(1);

  if (!row) return null;
  const destinations = await attachDestinations([row.id]);
  return toEventRow(row, destinations.get(row.id) ?? []);
}

/** The merged comment thread, newest last so the control room can append. */
export async function listLiveComments(eventId: string, limit = 200): Promise<LiveCommentRow[]> {
  const rows = await db
    .select({
      id: liveComment.id,
      platform: liveComment.platform,
      accountLabel: liveDestination.accountLabel,
      authorName: liveComment.authorName,
      authorAvatarUrl: liveComment.authorAvatarUrl,
      message: liveComment.message,
      postedAt: liveComment.postedAt,
    })
    .from(liveComment)
    .innerJoin(liveDestination, eq(liveDestination.id, liveComment.destinationId))
    .where(eq(liveComment.eventId, eventId))
    .orderBy(desc(liveComment.postedAt))
    .limit(limit);

  return rows
    .map((r) => ({ ...r, postedAt: iso(r.postedAt)! }))
    .reverse();
}

export async function listLiveLog(eventId: string, limit = 60) {
  const rows = await db
    .select({
      id: liveEventLog.id,
      message: liveEventLog.message,
      level: liveEventLog.level,
      actorName: user.name,
      at: liveEventLog.at,
    })
    .from(liveEventLog)
    .leftJoin(user, eq(user.id, liveEventLog.actorId))
    .where(eq(liveEventLog.eventId, eventId))
    .orderBy(desc(liveEventLog.at))
    .limit(limit);

  return rows.map((r) => ({ ...r, at: iso(r.at)! }));
}

export async function listViewerSamples(eventId: string, limit = 120) {
  const rows = await db
    .select({ viewers: liveViewerSample.viewers, at: liveViewerSample.at })
    .from(liveViewerSample)
    .where(eq(liveViewerSample.eventId, eventId))
    .orderBy(desc(liveViewerSample.at))
    .limit(limit);
  return rows.map((r) => ({ viewers: r.viewers, at: iso(r.at)! })).reverse();
}

/** Headline numbers for the dashboard strip. */
export async function liveStats() {
  const [[broadcasts], [minutes]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(liveEvent)
      .where(eq(liveEvent.status, "ended")),
    db
      .select({
        // `epoch` on the interval, so a broadcast that crossed midnight counts
        // its real length rather than a negative or a day's worth.
        mins: sql<number>`coalesce(sum(extract(epoch from (${liveEvent.endedAt} - ${liveEvent.startedAt})) / 60), 0)::int`,
      })
      .from(liveEvent)
      .where(and(eq(liveEvent.status, "ended"), isNotNull(liveEvent.startedAt), isNotNull(liveEvent.endedAt))),
  ]);

  return {
    broadcasts: broadcasts?.n ?? 0,
    minutes: minutes?.mins ?? 0,
  };
}

/** Stories a broadcast can be attached to — recent pipeline and published work. */
export async function listLiveStoryOptions(limit = 30) {
  const rows = await db
    .select({ id: story.id, title: story.title })
    .from(story)
    .orderBy(desc(story.updatedAt))
    .limit(limit);
  return rows;
}
