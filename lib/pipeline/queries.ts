import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db/drizzle";
import {
  media,
  notification,
  story,
  storyActivity,
  storyComment,
  storyMedia,
  storyRevision,
  user,
} from "@/db/schema";
import { canViewFullBoard } from "@/lib/pipeline/permissions";
import { listPickerAccounts } from "@/lib/social/queries";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline";

export type PipelineFilters = {
  search?: string;
  stage?: PipelineStage | "";
  status?: string;
  reporterId?: string;
  editorId?: string;
  category?: string;
  priority?: string;
  due?: "overdue" | "today" | "week" | "";
  includeArchived?: boolean;
};

const STORY_COLUMNS = {
  id: story.id,
  slug: story.slug,
  title: story.title,
  excerpt: story.excerpt,
  category: story.category,
  tags: story.tags,
  featuredImageUrl: story.featuredImageUrl,
  status: story.status,
  pipelineStage: story.pipelineStage,
  pipelineStatus: story.pipelineStatus,
  priority: story.priority,
  storyType: story.storyType,
  deadline: story.deadline,
  instructions: story.instructions,
  division: story.division,
  district: story.district,
  upazila: story.upazila,
  writerId: story.writerId,
  assignedEditorId: story.assignedEditorId,
  assignedById: story.assignedById,
  assignedAt: story.assignedAt,
  lastSavedAt: story.lastSavedAt,
  qcChecklist: story.qcChecklist,
  scheduledFor: story.scheduledFor,
  publishedAt: story.publishedAt,
  createdAt: story.createdAt,
  updatedAt: story.updatedAt,
};

/**
 * Every story on the board this person may see, one query plus a handful of
 * batched follow-ups (comment/media counts) — never a per-card query, the
 * same discipline as lib/kanban/queries.ts's getBoardData.
 *
 * Visibility: managers and QC reviewers see every pipeline story; everyone
 * else sees only stories where they are the assigned reporter or editor (see
 * lib/pipeline/permissions.ts for why this is scoped rather than reusing the
 * classic Stories admin's admin/chief_editor-only gate).
 */
export async function listPipelineStories(
  userId: string,
  role: string | null | undefined,
  filters: PipelineFilters = {}
) {
  const reporterUser = alias(user, "reporter_user");
  const editorUser = alias(user, "editor_user");

  const conditions = [
    isNotNull(story.pipelineStage),
    /*
     * Sample stories belong to the News Management Desk's demo toggle, which
     * badges them and refuses to publish them. The board has no such badge, and
     * its coarse bulk "Move to…" can push a card into the Publish stage, so the
     * samples are kept off this screen entirely rather than relying on every
     * downstream action to recognise them.
     */
    eq(story.isDemo, false),
  ];

  if (!canViewFullBoard(role)) {
    conditions.push(
      or(eq(story.writerId, userId), eq(story.assignedEditorId, userId))!
    );
  }

  if (!filters.includeArchived) {
    conditions.push(sql`${story.pipelineStatus} is distinct from 'archived'`);
  }

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        sql`${story.title} ilike ${term}`,
        sql`${story.category} ilike ${term}`,
        sql`${story.id}::text ilike ${term}`,
        sql`${reporterUser.name} ilike ${term}`,
        sql`${editorUser.name} ilike ${term}`
      )!
    );
  }
  if (filters.stage) conditions.push(eq(story.pipelineStage, filters.stage as PipelineStage));
  if (filters.status) conditions.push(sql`${story.pipelineStatus} = ${filters.status}`);
  if (filters.reporterId) conditions.push(eq(story.writerId, filters.reporterId));
  if (filters.editorId) conditions.push(eq(story.assignedEditorId, filters.editorId));
  if (filters.category) conditions.push(eq(story.category, filters.category));
  if (filters.priority) conditions.push(sql`${story.priority} = ${filters.priority}`);

  const now = new Date();
  if (filters.due === "overdue") {
    conditions.push(sql`${story.deadline} < ${now} and ${story.pipelineStatus} not in ('published','archived','rejected')`);
  } else if (filters.due === "today") {
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    conditions.push(sql`${story.deadline} between ${start} and ${end}`);
  } else if (filters.due === "week") {
    const end = new Date(now); end.setDate(end.getDate() + 7);
    conditions.push(sql`${story.deadline} between ${now} and ${end}`);
  }

  const rows = await db
    .select({
      ...STORY_COLUMNS,
      reporterName: reporterUser.name,
      reporterImage: reporterUser.image,
      editorName: editorUser.name,
    })
    .from(story)
    .leftJoin(reporterUser, eq(reporterUser.id, story.writerId))
    .leftJoin(editorUser, eq(editorUser.id, story.assignedEditorId))
    .where(and(...conditions))
    .orderBy(desc(story.priority), asc(story.deadline), desc(story.updatedAt));

  const ids = rows.map((r) => r.id);
  const [commentCounts, mediaCounts] = await Promise.all([
    ids.length
      ? db.select({ storyId: storyComment.storyId, n: sql<number>`count(*)::int` })
          .from(storyComment).where(inArray(storyComment.storyId, ids)).groupBy(storyComment.storyId)
      : [],
    ids.length
      ? db.select({ storyId: storyMedia.storyId, n: sql<number>`count(*)::int` })
          .from(storyMedia).where(inArray(storyMedia.storyId, ids)).groupBy(storyMedia.storyId)
      : [],
  ]);

  const cards = rows.map((r) => ({
    ...r,
    commentCount: commentCounts.find((c) => c.storyId === r.id)?.n ?? 0,
    mediaCount: mediaCounts.find((c) => c.storyId === r.id)?.n ?? 0,
  }));

  const byStage = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s, cards.filter((c) => c.pipelineStage === s)])
  ) as Record<PipelineStage, typeof cards>;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const stats = {
    total: cards.length,
    inProgress: cards.filter((c) => c.pipelineStatus !== "published" && c.pipelineStatus !== "archived" && c.pipelineStatus !== "rejected").length,
    overdue: cards.filter((c) => c.deadline && new Date(c.deadline) < now && !["published", "archived", "rejected"].includes(c.pipelineStatus ?? "")).length,
    publishedToday: cards.filter((c) => c.publishedAt && new Date(c.publishedAt) >= today && new Date(c.publishedAt) < tomorrow).length,
  };

  return { cards, byStage, stats };
}

/** Full detail for the story drawer: the row plus comments/activity/revisions/media. */
export async function getStoryDetail(storyId: string) {
  const reporterUser = alias(user, "reporter_user");
  const editorUser = alias(user, "editor_user");
  const assignerUser = alias(user, "assigner_user");

  const [row] = await db
    .select({
      ...STORY_COLUMNS,
      bodyJson: story.bodyJson,
      body: story.body,
      subtitle: story.subtitle,
      categoryId: story.categoryId,
      imageCaption: story.imageCaption,
      imageCredit: story.imageCredit,
      reporterName: reporterUser.name,
      reporterImage: reporterUser.image,
      editorName: editorUser.name,
      assignedByName: assignerUser.name,
    })
    .from(story)
    .leftJoin(reporterUser, eq(reporterUser.id, story.writerId))
    .leftJoin(editorUser, eq(editorUser.id, story.assignedEditorId))
    .leftJoin(assignerUser, eq(assignerUser.id, story.assignedById))
    .where(eq(story.id, storyId))
    .limit(1);
  if (!row) return null;

  const [comments, activity, revisions, mediaItems] = await Promise.all([
    db.select({
        id: storyComment.id, body: storyComment.body, parentId: storyComment.parentId,
        context: storyComment.context,
        resolved: storyComment.resolved, createdAt: storyComment.createdAt, editedAt: storyComment.editedAt,
        authorId: storyComment.authorId, authorName: user.name,
      })
      .from(storyComment).leftJoin(user, eq(user.id, storyComment.authorId))
      .where(eq(storyComment.storyId, storyId)).orderBy(asc(storyComment.createdAt)),
    db.select({ id: storyActivity.id, message: storyActivity.message, createdAt: storyActivity.createdAt })
      .from(storyActivity).where(eq(storyActivity.storyId, storyId)).orderBy(desc(storyActivity.createdAt)).limit(80),
    db.select({ id: storyRevision.id, label: storyRevision.label, createdAt: storyRevision.createdAt, createdById: storyRevision.createdById, authorName: user.name })
      .from(storyRevision).leftJoin(user, eq(user.id, storyRevision.createdById))
      .where(eq(storyRevision.storyId, storyId)).orderBy(desc(storyRevision.createdAt)),
    db.select({
        id: storyMedia.id, caption: storyMedia.caption, credit: storyMedia.credit, position: storyMedia.position,
        mediaId: media.id, url: media.url, kind: media.kind, altText: media.altText,
      })
      .from(storyMedia).innerJoin(media, eq(media.id, storyMedia.mediaId))
      .where(eq(storyMedia.storyId, storyId)).orderBy(asc(storyMedia.position)),
  ]);

  return { ...row, comments, activity, revisions, media: mediaItems };
}

/** One revision's full snapshot, for "view previous version" / restore. */
export async function getRevision(revisionId: string) {
  const [row] = await db.select().from(storyRevision).where(eq(storyRevision.id, revisionId)).limit(1);
  return row ?? null;
}

/** Candidates for "Reporter" — anyone with a real newsroom account. */
export async function listAssignableReporters() {
  return db
    .select({ id: user.id, name: user.name, image: user.image, role: user.role })
    .from(user)
    .where(eq(user.banned, false))
    .orderBy(asc(user.name));
}

/** Candidates for "Assigned editor" — the NM Desk / QC tier. */
export async function listAssignableEditors() {
  return db
    .select({ id: user.id, name: user.name, image: user.image, role: user.role })
    .from(user)
    .where(and(eq(user.banned, false), inArray(user.role, ["admin", "chief_editor", "news_editor", "digital_executive"])))
    .orderBy(asc(user.name));
}

export async function getPipelineNotifications(userId: string) {
  return db
    .select({
      id: notification.id, message: notification.message, readAt: notification.readAt,
      createdAt: notification.createdAt, storyId: notification.storyId,
    })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNotNull(notification.storyId)))
    .orderBy(desc(notification.createdAt))
    .limit(30);
}

/**
 * Active social accounts for the Publish tab's account picker — the same
 * shape (and the same picker) the social composer uses. Never includes
 * tokens; see lib/social/queries.ts.
 */
export async function listPublishDestinations() {
  return listPickerAccounts();
}

/** Distinct categories already in use on pipeline stories, for the filter bar. */
export async function listPipelineCategories() {
  const rows = await db
    .selectDistinct({ category: story.category })
    .from(story)
    .where(isNotNull(story.pipelineStage))
    .orderBy(asc(story.category));
  return rows.map((r) => r.category).filter(Boolean);
}
