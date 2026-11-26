/**
 * Server reads for the pitch desk.
 *
 * A plain server module, NOT `"use server"`: these functions can be called
 * from a server component but must never be handed to a client component as a
 * prop. Passing one across that boundary serialises to an error placeholder
 * and 500s the page — the trap documented against Kanban and the Web Studio in
 * CLAUDE.md. `loadPitchDetail` in the actions file is the real action wrapper.
 */

import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db/drizzle";
import {
  category as categoryTable,
  media,
  pitchAttachment,
  pitchEvent,
  pitchNote,
  siteSetting,
  story,
  storyPitch,
  user,
} from "@/db/schema";
import {
  canReviewPitches,
  pitchStatusForStage,
  type PitchStatus,
} from "@/lib/pitches";

/** How many pitches the console holds at once. See `loadPitchDesk`. */
export const PITCH_PAGE_CAP = 400;

export const PITCH_DEMO_SETTING_KEY = "pitch_demo";

export type PitchViewer = { id: string; name: string; role: string | null | undefined };

export type PitchListRow = {
  id: string;
  title: string;
  category: string | null;
  categoryId: string | null;
  storyType: string;
  priority: string;
  status: PitchStatus;
  description: string | null;
  plan: string | null;
  sources: string | null;
  estimatedCompletion: string | null;
  estimatedDate: string | null;
  reporterId: string | null;
  reporterName: string | null;
  reporterImage: string | null;
  createdById: string | null;
  assignedEditorId: string | null;
  editorName: string | null;
  deadline: string | null;
  editorNote: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  rejectedAt: string | null;
  approvedAt: string | null;
  storyId: string | null;
  storyStage: string | null;
  storyPublished: boolean;
  reopened: boolean;
  submittedAt: string | null;
  resubmitCount: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  commentCount: number;
};

export type PitchNoteRow = {
  id: string;
  body: string;
  visibility: "internal" | "shared";
  kind: string | null;
  authorId: string | null;
  authorName: string | null;
  authorRole: string | null;
  createdAt: string;
  editedAt: string | null;
};

export type PitchAttachmentRow = {
  id: string;
  mediaId: string;
  url: string;
  kind: "image" | "video" | "audio" | "document";
  mimeType: string;
  sizeBytes: number;
  label: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

export type PitchEventRow = {
  id: string;
  message: string;
  actorName: string | null;
  createdAt: string;
};

export type PitchDetail = {
  pitch: PitchListRow;
  notes: PitchNoteRow[];
  attachments: PitchAttachmentRow[];
  events: PitchEventRow[];
};

export type PitchCounts = Record<PitchStatus, number> & { total: number; demo: number };

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

// ---------------------------------------------------------------------------
// Demo toggle
// ---------------------------------------------------------------------------

export async function isPitchDemoEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, PITCH_DEMO_SETTING_KEY))
    .limit(1);
  if (!row) return false;
  const v = row.value as { enabled?: unknown } | null;
  return !!v && v.enabled === true;
}

// ---------------------------------------------------------------------------
// Status reconciliation
// ---------------------------------------------------------------------------

/**
 * Brings every linked pitch's status back in line with the story it became.
 *
 * The four post-approval statuses are a *view* of the pipeline, so they can't
 * be maintained by the pitch desk's own actions — a reporter filing the story
 * in `/admin/pipeline` never touches this table. Rather than deriving the
 * status on every read (which would leave the SQL counts disagreeing with the
 * cards, and would make status filtering impossible in SQL), the derived value
 * is written back whenever it has drifted. Normally that's zero updates.
 *
 * Runs before every desk read. Deliberately cheap: one join, and an UPDATE
 * only for rows that actually differ.
 */
export async function reconcilePitchStatuses(): Promise<void> {
  try {
    /* ------------------------------------------------------------------ 1 */
    /**
     * **Finish an interrupted hand-off.** `approveAndAssign` inserts the story
     * (carrying `story.pitchId`) and then writes `storyId` back onto the pitch.
     * A request that dies between those two steps used to leave an orphan: a
     * real assignment in the pipeline, a pitch that doesn't know about it, and
     * — because `story.pitchId` carries a unique index — no way to ever assign
     * that pitch again, with the raw constraint error as the only feedback.
     *
     * So the link is completed from the story's side instead of being thrown
     * away: the work already exists and a reporter may already be writing it.
     */
    const orphans = await db
      .select({
        pitchId: storyPitch.id,
        pitchStatus: storyPitch.status,
        storyRowId: story.id,
        stage: story.pipelineStage,
        storyStatus: story.status,
        pipelineStatus: story.pipelineStatus,
      })
      .from(story)
      .innerJoin(storyPitch, eq(story.pitchId, storyPitch.id))
      .where(and(isNotNull(story.pitchId), isNull(storyPitch.storyId)));

    for (const row of orphans) {
      const published = row.storyStatus === "published";
      const abandoned =
        row.pitchStatus === "rejected" ||
        (!published && (row.pipelineStatus === "rejected" || row.pipelineStatus === "archived"));
      if (abandoned) {
        // Nothing to reconnect to — drop the back-reference so the unique index
        // stops blocking a fresh assignment of the same idea.
        await db.update(story).set({ pitchId: null }).where(eq(story.id, row.storyRowId));
        continue;
      }
      const derived = pitchStatusForStage(row.stage, published, row.pipelineStatus) ?? "assigned";
      await db
        .update(storyPitch)
        .set({ storyId: row.storyRowId, status: derived, assigningAt: null, updatedAt: new Date() })
        .where(and(eq(storyPitch.id, row.pitchId), isNull(storyPitch.storyId)));
    }

    /* ------------------------------------------------------------------ 2 */
    const rows = await db
      .select({
        id: storyPitch.id,
        status: storyPitch.status,
        storyRowId: story.id,
        stage: story.pipelineStage,
        storyStatus: story.status,
        pipelineStatus: story.pipelineStatus,
      })
      .from(storyPitch)
      .innerJoin(story, eq(storyPitch.storyId, story.id))
      .where(isNotNull(storyPitch.storyId));

    const byStatus = new Map<PitchStatus, string[]>();
    /**
     * Pitches whose story the pipeline killed. They go back to `approved` and
     * are unlinked, which is what makes them actionable again — an editor can
     * assign the idea to someone else.
     */
    const dead: { pitchId: string; storyId: string }[] = [];

    for (const row of rows) {
      // A rejected pitch stays rejected even if a story somehow still points at
      // it — the editorial decision outranks the derived view.
      if (row.status === "rejected") continue;
      const published = row.storyStatus === "published";
      /**
       * `published` wins over `archived`. Archiving a story that already went
       * out is ordinary housekeeping on the pipeline board, and treating it as
       * "the story was killed" would rewrite a `completed` pitch back to
       * `approved` and offer the idea for assignment a second time — for a
       * story that is live on the site.
       */
      const storyDead =
        !published && (row.pipelineStatus === "rejected" || row.pipelineStatus === "archived");
      if (storyDead) {
        dead.push({ pitchId: row.id, storyId: row.storyRowId });
        continue;
      }
      const expected = pitchStatusForStage(row.stage, published, row.pipelineStatus);
      if (!expected || expected === row.status) continue;
      const list = byStatus.get(expected) ?? [];
      list.push(row.id);
      byStatus.set(expected, list);
    }

    for (const [status, ids] of byStatus) {
      // inArray throws on an empty array in this Drizzle build; the map can only
      // hold non-empty lists, but the guard costs nothing.
      if (ids.length === 0) continue;
      // `updatedAt` moves too, or the "Recently updated" sort would never show
      // a pitch that has just been published.
      await db.update(storyPitch).set({ status, updatedAt: new Date() }).where(inArray(storyPitch.id, ids));
    }

    /* ------------------------------------------------------------------ 3 */
    if (dead.length > 0) {
      /**
       * Order matters, because `neon-http` has no transactions. Clearing
       * `story.pitchId` **first** means a failure between the two statements
       * leaves the pitch still pointing at the dead story — which step 2 finds
       * again on the next read and retries. Doing it the other way round would
       * leave `story.pitchId` set with nothing linking back to it, and step 1's
       * orphan sweep would then have to undo it.
       */
      await db
        .update(story)
        .set({ pitchId: null })
        .where(
          inArray(
            story.id,
            dead.map((d) => d.storyId)
          )
        );
      await db
        .update(storyPitch)
        .set({ status: "approved", storyId: null, assigningAt: null, updatedAt: new Date() })
        .where(
          inArray(
            storyPitch.id,
            dead.map((d) => d.pitchId)
          )
        );
    }

    /* ------------------------------------------------------------------ 4 */
    /**
     * A pitch left at a pipeline status with no story behind it — which happens
     * when a manager deletes the assignment, since `story.pitchId`'s
     * `ON DELETE SET NULL` clears the link. Without this the pitch reads
     * "Assigned" forever with nothing to open and no action available.
     *
     * This runs after step 1, so a pitch whose story does still exist has
     * already been re-linked and won't be caught here. And because the assign
     * claim lives in its own `assigningAt` column rather than in `status`, this
     * can't release an assignment that is still mid-flight.
     */
    await db
      .update(storyPitch)
      .set({ status: "approved", updatedAt: new Date() })
      .where(
        and(
          isNull(storyPitch.storyId),
          inArray(storyPitch.status, ["assigned", "in_progress", "submitted", "completed"])
        )
      );
  } catch {
    /**
     * Reconciliation is a convenience, not a correctness requirement — a
     * transient failure should leave a slightly stale badge, not a 500 on the
     * whole desk for everyone including reporters.
     */
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * What this viewer may see. Reviewers see the whole desk; everyone else sees
 * only pitches they own or filed. Scoped **in SQL** — a reporter's browser
 * never receives another reporter's idea, rather than receiving it and being
 * asked not to render it.
 */
function scopeFor(viewer: PitchViewer, demoEnabled: boolean) {
  const hideDemo = demoEnabled ? undefined : eq(storyPitch.isDemo, false);
  const ownOnly = canReviewPitches(viewer.role)
    ? undefined
    : or(eq(storyPitch.reporterId, viewer.id), eq(storyPitch.createdById, viewer.id));
  if (hideDemo && ownOnly) return and(hideDemo, ownOnly);
  // `undefined` is a valid `.where()` argument in Drizzle and means "no filter".
  return hideDemo ?? ownOnly;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * The reporter and the assigned editor are both rows of `user`, so the table
 * is joined twice under two aliases. Declared once at module scope — building
 * an alias per call would work but allocates a new table object on every read.
 */
const listReporter = alias(user, "pitch_list_reporter");
const listEditor = alias(user, "pitch_list_editor");
const detailReporter = alias(user, "pitch_detail_reporter");
const detailEditor = alias(user, "pitch_detail_editor");

export async function loadPitches(viewer: PitchViewer, demoEnabled: boolean): Promise<PitchListRow[]> {
  const rep = listReporter;
  const ed = listEditor;

  const rows = await db
    .select({
      id: storyPitch.id,
      title: storyPitch.title,
      category: storyPitch.category,
      categoryId: storyPitch.categoryId,
      storyType: storyPitch.storyType,
      priority: storyPitch.priority,
      status: storyPitch.status,
      description: storyPitch.description,
      plan: storyPitch.plan,
      sources: storyPitch.sources,
      estimatedCompletion: storyPitch.estimatedCompletion,
      estimatedDate: storyPitch.estimatedDate,
      reporterId: storyPitch.reporterId,
      reporterName: rep.name,
      reporterImage: rep.image,
      createdById: storyPitch.createdById,
      assignedEditorId: storyPitch.assignedEditorId,
      editorName: ed.name,
      deadline: storyPitch.deadline,
      editorNote: storyPitch.editorNote,
      rejectionReason: storyPitch.rejectionReason,
      rejectionNote: storyPitch.rejectionNote,
      rejectedAt: storyPitch.rejectedAt,
      approvedAt: storyPitch.approvedAt,
      storyId: storyPitch.storyId,
      storyStage: story.pipelineStage,
      storyStatus: story.status,
      reopened: storyPitch.reopened,
      submittedAt: storyPitch.submittedAt,
      resubmitCount: storyPitch.resubmitCount,
      isDemo: storyPitch.isDemo,
      createdAt: storyPitch.createdAt,
      updatedAt: storyPitch.updatedAt,
    })
    .from(storyPitch)
    .leftJoin(rep, eq(storyPitch.reporterId, rep.id))
    .leftJoin(ed, eq(storyPitch.assignedEditorId, ed.id))
    .leftJoin(story, eq(storyPitch.storyId, story.id))
    .where(scopeFor(viewer, demoEnabled))
    .orderBy(desc(storyPitch.createdAt))
    .limit(PITCH_PAGE_CAP);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Attachment and shared-comment counts as two flat grouped queries rather
  // than a correlated subquery — see the Drizzle gotcha in CLAUDE.md, where an
  // unqualified column in a subquery on a single-table select is ambiguous.
  const [attachRows, noteRows] = await Promise.all([
    db
      .select({ pitchId: pitchAttachment.pitchId, n: count() })
      .from(pitchAttachment)
      .where(inArray(pitchAttachment.pitchId, ids))
      .groupBy(pitchAttachment.pitchId),
    db
      // `shared` only. An internal editor note must not so much as increment a
      // counter on a reporter's card — that would leak the fact that the desk
      // has been talking about their pitch, which is the one thing the
      // visibility split exists to prevent.
      .select({ pitchId: pitchNote.pitchId, n: count() })
      .from(pitchNote)
      .where(and(inArray(pitchNote.pitchId, ids), eq(pitchNote.visibility, "shared")))
      .groupBy(pitchNote.pitchId),
  ]);
  const attachBy = new Map(attachRows.map((r) => [r.pitchId, Number(r.n)]));
  const noteBy = new Map(noteRows.map((r) => [r.pitchId, Number(r.n)]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    categoryId: r.categoryId,
    storyType: r.storyType,
    priority: r.priority,
    status: r.status as PitchStatus,
    description: r.description,
    plan: r.plan,
    sources: r.sources,
    estimatedCompletion: r.estimatedCompletion,
    estimatedDate: iso(r.estimatedDate),
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    reporterImage: r.reporterImage,
    createdById: r.createdById,
    assignedEditorId: r.assignedEditorId,
    editorName: r.editorName,
    deadline: iso(r.deadline),
    editorNote: r.editorNote,
    rejectionReason: r.rejectionReason,
    rejectionNote: r.rejectionNote,
    rejectedAt: iso(r.rejectedAt),
    approvedAt: iso(r.approvedAt),
    storyId: r.storyId,
    storyStage: r.storyStage,
    storyPublished: r.storyStatus === "published",
    reopened: r.reopened,
    submittedAt: iso(r.submittedAt),
    resubmitCount: r.resubmitCount,
    isDemo: r.isDemo,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    attachmentCount: attachBy.get(r.id) ?? 0,
    commentCount: noteBy.get(r.id) ?? 0,
  }));
}

/**
 * Counts for the dashboard tiles. Computed in SQL over the viewer's whole
 * scope, not over the loaded page, so they stay correct past `PITCH_PAGE_CAP`.
 */
export async function loadPitchCounts(viewer: PitchViewer, demoEnabled: boolean): Promise<PitchCounts> {
  const scope = scopeFor(viewer, demoEnabled);
  const rows = await db
    .select({ status: storyPitch.status, n: count() })
    .from(storyPitch)
    .where(scope)
    .groupBy(storyPitch.status);

  const counts = {
    draft: 0,
    pending_review: 0,
    needs_changes: 0,
    approved: 0,
    assigned: 0,
    in_progress: 0,
    submitted: 0,
    completed: 0,
    rejected: 0,
    total: 0,
    demo: 0,
  } as PitchCounts;

  for (const row of rows) {
    counts[row.status as PitchStatus] = Number(row.n);
    counts.total += Number(row.n);
  }

  if (demoEnabled) {
    const demoScope = canReviewPitches(viewer.role)
      ? eq(storyPitch.isDemo, true)
      : and(
          eq(storyPitch.isDemo, true),
          or(eq(storyPitch.reporterId, viewer.id), eq(storyPitch.createdById, viewer.id))!
        );
    const [row] = await db.select({ n: count() }).from(storyPitch).where(demoScope);
    counts.demo = Number(row?.n ?? 0);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * One pitch with its notes, attachments and timeline.
 *
 * Takes the viewer because the access check has to happen here, not in the
 * caller: fetching by id would otherwise let any signed-in person read any
 * pitch by guessing one. Internal notes are excluded in SQL for non-reviewers.
 */
export async function getPitchDetail(pitchId: string, viewer: PitchViewer): Promise<PitchDetail | null> {
  const rep = detailReporter;
  const ed = detailEditor;

  const [row] = await db
    .select({
      id: storyPitch.id,
      title: storyPitch.title,
      category: storyPitch.category,
      categoryId: storyPitch.categoryId,
      storyType: storyPitch.storyType,
      priority: storyPitch.priority,
      status: storyPitch.status,
      description: storyPitch.description,
      plan: storyPitch.plan,
      sources: storyPitch.sources,
      estimatedCompletion: storyPitch.estimatedCompletion,
      estimatedDate: storyPitch.estimatedDate,
      reporterId: storyPitch.reporterId,
      reporterName: rep.name,
      reporterImage: rep.image,
      createdById: storyPitch.createdById,
      assignedEditorId: storyPitch.assignedEditorId,
      editorName: ed.name,
      deadline: storyPitch.deadline,
      editorNote: storyPitch.editorNote,
      rejectionReason: storyPitch.rejectionReason,
      rejectionNote: storyPitch.rejectionNote,
      rejectedAt: storyPitch.rejectedAt,
      approvedAt: storyPitch.approvedAt,
      storyId: storyPitch.storyId,
      storyStage: story.pipelineStage,
      storyStatus: story.status,
      reopened: storyPitch.reopened,
      submittedAt: storyPitch.submittedAt,
      resubmitCount: storyPitch.resubmitCount,
      isDemo: storyPitch.isDemo,
      createdAt: storyPitch.createdAt,
      updatedAt: storyPitch.updatedAt,
    })
    .from(storyPitch)
    .leftJoin(rep, eq(storyPitch.reporterId, rep.id))
    .leftJoin(ed, eq(storyPitch.assignedEditorId, ed.id))
    .leftJoin(story, eq(storyPitch.storyId, story.id))
    .where(eq(storyPitch.id, pitchId))
    .limit(1);

  if (!row) return null;

  const reviewer = canReviewPitches(viewer.role);
  const owns = row.reporterId === viewer.id || row.createdById === viewer.id;
  if (!reviewer && !owns) return null;

  const noteWhere = reviewer
    ? eq(pitchNote.pitchId, pitchId)
    : and(eq(pitchNote.pitchId, pitchId), eq(pitchNote.visibility, "shared"));

  const [notes, attachments, events, counts] = await Promise.all([
    db
      .select({
        id: pitchNote.id,
        body: pitchNote.body,
        visibility: pitchNote.visibility,
        kind: pitchNote.kind,
        authorId: pitchNote.authorId,
        authorName: user.name,
        authorRole: user.role,
        createdAt: pitchNote.createdAt,
        editedAt: pitchNote.editedAt,
      })
      .from(pitchNote)
      .leftJoin(user, eq(pitchNote.authorId, user.id))
      .where(noteWhere)
      .orderBy(pitchNote.createdAt),
    db
      .select({
        id: pitchAttachment.id,
        mediaId: pitchAttachment.mediaId,
        url: media.url,
        kind: media.kind,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        label: pitchAttachment.label,
        uploadedByName: user.name,
        createdAt: pitchAttachment.createdAt,
      })
      .from(pitchAttachment)
      .innerJoin(media, eq(pitchAttachment.mediaId, media.id))
      .leftJoin(user, eq(pitchAttachment.uploadedById, user.id))
      .where(eq(pitchAttachment.pitchId, pitchId))
      .orderBy(pitchAttachment.position, pitchAttachment.createdAt),
    db
      .select({
        id: pitchEvent.id,
        message: pitchEvent.message,
        actorName: user.name,
        createdAt: pitchEvent.createdAt,
      })
      .from(pitchEvent)
      .leftJoin(user, eq(pitchEvent.actorId, user.id))
      .where(eq(pitchEvent.pitchId, pitchId))
      .orderBy(pitchEvent.createdAt),
    db
      .select({ n: count() })
      .from(pitchAttachment)
      .where(eq(pitchAttachment.pitchId, pitchId)),
  ]);

  return {
    pitch: {
      id: row.id,
      title: row.title,
      category: row.category,
      categoryId: row.categoryId,
      storyType: row.storyType,
      priority: row.priority,
      status: row.status as PitchStatus,
      description: row.description,
      plan: row.plan,
      sources: row.sources,
      estimatedCompletion: row.estimatedCompletion,
      estimatedDate: iso(row.estimatedDate),
      reporterId: row.reporterId,
      reporterName: row.reporterName,
      reporterImage: row.reporterImage,
      createdById: row.createdById,
      assignedEditorId: row.assignedEditorId,
      editorName: row.editorName,
      deadline: iso(row.deadline),
      editorNote: row.editorNote,
      rejectionReason: row.rejectionReason,
      rejectionNote: row.rejectionNote,
      rejectedAt: iso(row.rejectedAt),
      approvedAt: iso(row.approvedAt),
      storyId: row.storyId,
      storyStage: row.storyStage,
      storyPublished: row.storyStatus === "published",
      reopened: row.reopened,
      submittedAt: iso(row.submittedAt),
      resubmitCount: row.resubmitCount,
      isDemo: row.isDemo,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      attachmentCount: Number(counts[0]?.n ?? 0),
      commentCount: notes.filter((n) => n.visibility === "shared").length,
    },
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      visibility: n.visibility as "internal" | "shared",
      kind: n.kind,
      authorId: n.authorId,
      authorName: n.authorName,
      authorRole: n.authorRole,
      createdAt: new Date(n.createdAt).toISOString(),
      editedAt: iso(n.editedAt),
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      mediaId: a.mediaId,
      url: a.url,
      kind: a.kind as PitchAttachmentRow["kind"],
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      label: a.label,
      uploadedByName: a.uploadedByName,
      createdAt: new Date(a.createdAt).toISOString(),
    })),
    events: events.map((e) => ({
      id: e.id,
      message: e.message,
      actorName: e.actorName,
      createdAt: new Date(e.createdAt).toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Supporting lists
// ---------------------------------------------------------------------------

export type PitchPerson = { id: string; name: string; role: string };

/**
 * Who a pitch can be assigned to. Reporters, graphics staff and editors — the
 * same set the pipeline's assignment modal offers, minus banned accounts.
 */
export async function loadPitchPeople(): Promise<{ reporters: PitchPerson[]; editors: PitchPerson[] }> {
  const rows = await db
    .select({ id: user.id, name: user.name, role: user.role })
    .from(user)
    .where(eq(user.banned, false))
    .orderBy(user.name);

  const reporters = rows.filter((r) =>
    ["reporter", "graphics", "news_editor", "digital_executive", "chief_editor", "admin"].includes(r.role)
  );
  const editors = rows.filter((r) => ["admin", "chief_editor", "news_editor"].includes(r.role));
  return { reporters, editors };
}

export type PitchCategory = { id: string; name: string };

/**
 * Newsroom categories for the pitch form. Parents only — a pitch is an idea
 * for a desk, and picking a sub-category at pitch stage is a level of
 * precision that only becomes useful once the story is being written.
 */
export async function loadPitchCategories(): Promise<PitchCategory[]> {
  const rows = await db
    .select({ id: categoryTable.id, name: categoryTable.name, parentId: categoryTable.parentId })
    .from(categoryTable)
    .orderBy(categoryTable.position, categoryTable.name);
  return rows.filter((r) => !r.parentId).map((r) => ({ id: r.id, name: r.name }));
}

/**
 * Titles used for duplicate detection — id, title, status and reporter only.
 *
 * Scoped, because this list is shown to the person submitting. A *submitted*
 * pitch is desk business and any member of staff comparing their idea against it
 * is the whole point; a **draft** is the reporter's private workspace, so
 * someone else's unsent draft is excluded for anyone who isn't a reviewer.
 * Without that, typing an overlapping headline would print a colleague's
 * unfinished idea, their name and a "Draft" badge — defeating the SQL scoping
 * the rest of the desk is careful about.
 */
export async function loadPitchTitles(
  viewer: PitchViewer
): Promise<{ id: string; title: string; status: PitchStatus; reporterName: string | null }[]> {
  const notSomeoneElsesDraft = canReviewPitches(viewer.role)
    ? undefined
    : or(
        ne(storyPitch.status, "draft"),
        eq(storyPitch.reporterId, viewer.id),
        eq(storyPitch.createdById, viewer.id)
      );

  const rows = await db
    .select({
      id: storyPitch.id,
      title: storyPitch.title,
      status: storyPitch.status,
      reporterName: user.name,
    })
    .from(storyPitch)
    .leftJoin(user, eq(storyPitch.reporterId, user.id))
    .where(
      notSomeoneElsesDraft
        ? and(eq(storyPitch.isDemo, false), notSomeoneElsesDraft)
        : eq(storyPitch.isDemo, false)
    )
    .orderBy(desc(storyPitch.createdAt))
    .limit(600);
  return rows.map((r) => ({ ...r, status: r.status as PitchStatus }));
}

// ---------------------------------------------------------------------------
// Page payload
// ---------------------------------------------------------------------------

export type PitchDeskData = {
  pitches: PitchListRow[];
  counts: PitchCounts;
  people: { reporters: PitchPerson[]; editors: PitchPerson[] };
  categories: PitchCategory[];
  demoEnabled: boolean;
  capped: boolean;
};

export async function loadPitchDesk(viewer: PitchViewer): Promise<PitchDeskData> {
  await reconcilePitchStatuses();
  const demoEnabled = await isPitchDemoEnabled();
  const [pitches, counts, people, categories] = await Promise.all([
    loadPitches(viewer, demoEnabled),
    loadPitchCounts(viewer, demoEnabled),
    loadPitchPeople(),
    loadPitchCategories(),
  ]);
  return {
    pitches,
    counts,
    people,
    categories,
    demoEnabled,
    capped: counts.total > pitches.length,
  };
}
