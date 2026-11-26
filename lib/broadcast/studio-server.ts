import { and, asc, desc, eq, gt } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { cgTemplate, media, siteSetting, studioEvent, studioParticipant, studioSource, user, video } from "@/db/schema";
import { DEFAULT_STUDIO_SETTINGS, sanitizeStudioSettings, type StudioSettings } from "@/lib/studio";

/**
 * Server reads for the Web Studio. Plain server module (not "use server"):
 * called from the page and the actions file, never handed to a client
 * component — see the Kanban note in CLAUDE.md about serialising functions.
 */

const SETTING_KEY = "studio";

export async function getStudioSettings(): Promise<StudioSettings> {
  const [row] = await db.select().from(siteSetting).where(eq(siteSetting.key, SETTING_KEY)).limit(1);
  return row ? sanitizeStudioSettings(row.value) : { ...DEFAULT_STUDIO_SETTINGS };
}

export type SourceRow = typeof studioSource.$inferSelect & {
  participant: {
    id: string;
    name: string;
    role: string;
    location: string | null;
    state: string;
    videoQuality: string | null;
    audioQuality: string | null;
    networkQuality: string | null;
    lastSeenAt: Date | null;
    expiresAt: Date | null;
    /** Only ever sent to the operator's own console. */
    token: string;
  } | null;
};

export async function getSources(): Promise<SourceRow[]> {
  const rows = await db
    .select({ source: studioSource, participant: studioParticipant })
    .from(studioSource)
    .leftJoin(studioParticipant, eq(studioParticipant.id, studioSource.participantId))
    .orderBy(asc(studioSource.position), asc(studioSource.createdAt));

  return rows.map((r) => ({
    ...r.source,
    participant: r.participant
      ? {
          id: r.participant.id,
          name: r.participant.name,
          role: r.participant.role,
          location: r.participant.location,
          state: r.participant.state,
          videoQuality: r.participant.videoQuality,
          audioQuality: r.participant.audioQuality,
          networkQuality: r.participant.networkQuality,
          lastSeenAt: r.participant.lastSeenAt,
          expiresAt: r.participant.expiresAt,
          token: r.participant.token,
        }
      : null,
  }));
}

export async function getStudioHistory(limit = 40) {
  return db
    .select({
      id: studioEvent.id,
      action: studioEvent.action,
      fromLabel: studioEvent.fromLabel,
      toLabel: studioEvent.toLabel,
      detail: studioEvent.detail,
      at: studioEvent.at,
      operatorName: user.name,
    })
    .from(studioEvent)
    .leftJoin(user, eq(user.id, studioEvent.operatorId))
    .orderBy(desc(studioEvent.at))
    .limit(limit);
}

/**
 * Video files the studio can play as VTR packages: the media library's own
 * uploads plus the video desk's entries that point at a real file. A YouTube
 * or Facebook link is deliberately excluded — an iframe embed can't be
 * composited into program or have its audio mixed, so offering it would be a
 * button that looks like it works and doesn't.
 */
export async function getVtrLibrary() {
  const [uploads, desk] = await Promise.all([
    db
      // `media` has no title column — caption, then alt text, then the file
      // name is what the library actually knows about a clip.
      .select({ id: media.id, caption: media.caption, altText: media.altText, url: media.url })
      .from(media)
      .where(eq(media.kind, "video"))
      .orderBy(desc(media.createdAt))
      .limit(60),
    db
      .select({ id: video.id, title: video.title, url: video.videoLink, thumb: video.thumbnailUrl })
      .from(video)
      .orderBy(desc(video.createdAt))
      .limit(60),
  ]);

  const isPlayableFile = (u: string | null) => !!u && /^https?:\/\/\S+\.(mp4|webm|ogg|mov|m3u8)(\?\S*)?$/i.test(u);

  return [
    ...uploads.map((m) => ({
      id: `media:${m.id}`,
      title: m.caption || m.altText || decodeURIComponent(m.url.split("/").pop() ?? "Clip"),
      url: m.url,
      poster: null as string | null,
    })),
    ...desk
      .filter((v) => isPlayableFile(v.url))
      .map((v) => ({ id: `video:${v.id}`, title: v.title, url: v.url as string, poster: v.thumb ?? null })),
  ];
}

/** CG templates the graphics bus offers, newest-used first. */
export async function getGraphicsForStudio() {
  return db
    .select({
      id: cgTemplate.id,
      name: cgTemplate.name,
      type: cgTemplate.type,
      category: cgTemplate.category,
      document: cgTemplate.document,
      fields: cgTemplate.fields,
      values: cgTemplate.values,
      layer: cgTemplate.layer,
      durationSec: cgTemplate.durationSec,
      needsCheck: cgTemplate.needsCheck,
    })
    .from(cgTemplate)
    .where(eq(cgTemplate.status, "active"))
    .orderBy(desc(cgTemplate.lastUsedAt), asc(cgTemplate.name))
    .limit(40);
}

/**
 * Resolves a join token to its participant. Expired or revoked links resolve
 * to null — the token is the only credential a remote guest has, so it has to
 * be checked here rather than trusted from the page's query string.
 */
export async function participantByToken(token: string) {
  if (!token || token.length < 16) return null;
  // Expiry is absolute. An earlier version also accepted an already-connected
  // participant, which a contributor could keep true forever by reporting
  // their own state — a 12-hour link that never expires. Reissuing is instant,
  // so strictness costs nothing.
  const [row] = await db
    .select()
    .from(studioParticipant)
    .where(and(eq(studioParticipant.token, token), gt(studioParticipant.expiresAt, new Date())))
    .limit(1);
  if (!row || row.state === "left") return null;
  return row;
}

