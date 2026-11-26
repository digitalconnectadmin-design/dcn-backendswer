/**
 * News Management Desk — server reads.
 *
 * A plain server module, **never** passed to a client component: its functions
 * can be called from a server component, but handing one to the browser fails
 * at serialisation and the page 500s with an `E{...}` placeholder in the RSC
 * payload (the same trap documented for Kanban and the Web Studio in
 * CLAUDE.md). `loadDeskDetail` in the desk's actions.ts is the real action that
 * wraps `getDeskDetail`, and it carries the access check.
 *
 * The desk reads the *same* `story` rows the Story Pipeline board reads — there
 * is no second table and nothing is copied. That is what the brief means by
 * "when a story reaches the News Management Desk, its information should
 * already exist. Do not create duplicate stories."
 */

import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db/drizzle";
import { category, siteSetting, story, storyComment, storyMedia, storyPitch, user } from "@/db/schema";
import {
  DESK_ACTIVE_STATUSES,
  DESK_PAGE_CAP,
  DESK_STATUSES,
  type DeskStatus,
  type Placement,
} from "@/lib/nm-desk";
import { getStoryDetail, listAssignableEditors, listAssignableReporters } from "@/lib/pipeline/queries";
import type { QcChecklist } from "@/lib/pipeline";

/** `site_setting` keys the desk owns. */
export const DESK_DEMO_SETTING_KEY = "nm_desk_demo";
export const DESK_SETTING_KEY = "nm_desk";

// `DESK_PAGE_CAP` lives in the pure `lib/nm-desk.ts`, so the client console can
// read it without importing this module and dragging `db` into the browser
// bundle. It is imported above and applied in `loadDeskStories`.

/**
 * How much of the article body travels to the browser.
 *
 * §15 wants search to match the story body and §11 wants a content preview,
 * but a desk of 400 full articles is megabytes of payload. The first 2,000
 * characters cover both honestly; the detail panel loads the real document.
 */
const BODY_SNIPPET_CHARS = 2000;

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * The desk's active statuses as a parameterised SQL list, for the ordering in
 * `loadDeskStories`. Built by folding the tagged template rather than with
 * `sql.join` — one plain, already-proven API instead of a second one — and each
 * status travels as a bound parameter, not as interpolated text.
 */
const ACTIVE_SQL: SQL =
  DESK_ACTIVE_STATUSES.length === 0
    ? // `in ()` is a syntax error, so an empty list degrades to "nothing is
      // active" rather than breaking every desk read.
      sql`null`
    : DESK_ACTIVE_STATUSES.reduce<SQL>(
        (acc, status, i) => (i === 0 ? sql`${status}` : sql`${acc}, ${status}`),
        sql``
      );

export type DeskStoryRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  bodySnippet: string;
  hasBody: boolean;
  category: string;
  categoryId: string | null;
  tags: string[];
  featuredImageUrl: string | null;
  /** The desk's own status vocabulary — `story.pipelineStatus`, relabelled. */
  status: DeskStatus;
  /** The site-wide lifecycle, so the row can say whether it is publicly visible. */
  liveStatus: string;
  stage: string | null;
  placement: Placement;
  priority: string;
  storyType: string;
  reporterId: string | null;
  reporterName: string | null;
  reporterImage: string | null;
  editorId: string | null;
  editorName: string | null;
  deadline: string | null;
  /** When it reached the desk, falling back to creation for rows filed before this column existed. */
  arrivedAt: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  holdReason: string | null;
  heldByName: string | null;
  heldAt: string | null;
  isDemo: boolean;
  qcChecklist: QcChecklist | null;
  pitchId: string | null;
  commentCount: number;
  mediaCount: number;
};

export type DeskCounts = Record<DeskStatus, number> & {
  total: number;
  demo: number;
  lead: number;
  secondLead: number;
};

export type DeskFacets = {
  reporters: { id: string; name: string | null; image: string | null }[];
  editors: { id: string; name: string | null; image: string | null }[];
  /** Every top-level desk category, for the filter and for "Change category". */
  categories: { id: string; name: string }[];
};

export type DeskSettings = {
  /** §24: publishing is blocked until proofreading has signed off. */
  requireQc: boolean;
  demo: boolean;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getDeskSettings(): Promise<DeskSettings> {
  const rows = await db
    .select({ key: siteSetting.key, value: siteSetting.value })
    .from(siteSetting)
    .where(inArray(siteSetting.key, [DESK_SETTING_KEY, DESK_DEMO_SETTING_KEY]));

  const main = rows.find((r) => r.key === DESK_SETTING_KEY)?.value as { requireQc?: unknown } | undefined;
  const demo = rows.find((r) => r.key === DESK_DEMO_SETTING_KEY)?.value as { enabled?: unknown } | undefined;

  return {
    // Default off: a newsroom that hasn't configured a proofreading step should
    // not find publishing silently disabled on its first visit.
    requireQc: main?.requireQc === true,
    demo: demo?.enabled === true,
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Which stories the desk is responsible for: anything on the pipeline whose
 * status is part of the desk's vocabulary. That deliberately leaves out
 * `assigned` (still with the assignment desk, nothing has been written) and
 * `rejected` (killed before it ever reached here).
 */
function deskScope(includeDemo: boolean) {
  const conditions = [
    isNotNull(story.pipelineStage),
    inArray(story.pipelineStatus, [...DESK_STATUSES]),
  ];
  // The flag is only ever *removed* from the scope — a demo row is never
  // forced into it, so turning the toggle off hides the samples everywhere
  // without deleting them.
  if (!includeDemo) conditions.push(eq(story.isDemo, false));
  return and(...conditions);
}

export async function loadDeskStories(includeDemo: boolean): Promise<DeskStoryRow[]> {
  const reporterUser = alias(user, "desk_reporter");
  const editorUser = alias(user, "desk_editor");
  const holderUser = alias(user, "desk_holder");

  const rows = await db
    .select({
      id: story.id,
      slug: story.slug,
      title: story.title,
      subtitle: story.subtitle,
      excerpt: story.excerpt,
      bodySnippet: sql<string>`left(coalesce(${story.body}, ''), ${BODY_SNIPPET_CHARS})`,
      bodyLength: sql<number>`length(coalesce(${story.body}, ''))`,
      category: story.category,
      categoryId: story.categoryId,
      tags: story.tags,
      featuredImageUrl: story.featuredImageUrl,
      pipelineStatus: story.pipelineStatus,
      liveStatus: story.status,
      stage: story.pipelineStage,
      placement: story.deskPlacement,
      priority: story.priority,
      storyType: story.storyType,
      reporterId: story.writerId,
      reporterName: reporterUser.name,
      reporterImage: reporterUser.image,
      editorId: story.assignedEditorId,
      editorName: editorUser.name,
      deadline: story.deadline,
      submittedAt: story.submittedAt,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
      publishedAt: story.publishedAt,
      scheduledFor: story.scheduledFor,
      holdReason: story.holdReason,
      heldByName: holderUser.name,
      heldAt: story.heldAt,
      isDemo: story.isDemo,
      qcChecklist: story.qcChecklist,
      pitchId: story.pitchId,
    })
    .from(story)
    .leftJoin(reporterUser, eq(reporterUser.id, story.writerId))
    .leftJoin(editorUser, eq(editorUser.id, story.assignedEditorId))
    .leftJoin(holderUser, eq(holderUser.id, story.heldById))
    .where(deskScope(includeDemo))
    /*
     * Stories the desk still has to do something about come first, then newest
     * arrival. Ordering by date alone meant that once a newsroom passed
     * `DESK_PAGE_CAP` lifetime stories, the window filled with published rows and
     * a held story from three months ago dropped off the list while still being
     * counted in the "Held" tile — a tile that opens an incomplete list is worse
     * than no tile. With this ordering the cap only ever trims finished work.
     */
    .orderBy(
      // `::text` on the enum column, because the statuses travel as untyped
      // parameters and comparing a pg enum against those directly is the kind of
      // "operator does not exist" surprise that only shows up at runtime.
      sql`case when ${story.pipelineStatus}::text in (${ACTIVE_SQL}) then 0 else 1 end`,
      desc(sql`coalesce(${story.submittedAt}, ${story.createdAt})`)
    )
    .limit(DESK_PAGE_CAP);

  const ids = rows.map((r) => r.id);
  const [commentCounts, mediaCounts] = await Promise.all([
    ids.length
      ? db
          .select({ storyId: storyComment.storyId, n: sql<number>`count(*)::int` })
          .from(storyComment)
          .where(inArray(storyComment.storyId, ids))
          .groupBy(storyComment.storyId)
      : [],
    ids.length
      ? db
          .select({ storyId: storyMedia.storyId, n: sql<number>`count(*)::int` })
          .from(storyMedia)
          .where(inArray(storyMedia.storyId, ids))
          .groupBy(storyMedia.storyId)
      : [],
  ]);

  const comments = new Map(commentCounts.map((c) => [c.storyId, c.n]));
  const mediaN = new Map(mediaCounts.map((c) => [c.storyId, c.n]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    excerpt: r.excerpt,
    bodySnippet: r.bodySnippet ?? "",
    hasBody: Number(r.bodyLength ?? 0) > 0,
    category: r.category,
    categoryId: r.categoryId,
    tags: r.tags ?? [],
    featuredImageUrl: r.featuredImageUrl,
    // Every row in scope has a status in the desk's set — the cast reflects
    // the `inArray` above rather than a hope.
    status: (r.pipelineStatus ?? "draft") as DeskStatus,
    liveStatus: r.liveStatus,
    stage: r.stage,
    placement: r.placement as Placement,
    priority: r.priority,
    storyType: r.storyType,
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    reporterImage: r.reporterImage,
    editorId: r.editorId,
    editorName: r.editorName,
    deadline: iso(r.deadline),
    arrivedAt: iso(r.submittedAt) ?? iso(r.createdAt)!,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
    publishedAt: iso(r.publishedAt),
    scheduledFor: iso(r.scheduledFor),
    holdReason: r.holdReason,
    heldByName: r.heldByName,
    heldAt: iso(r.heldAt),
    isDemo: r.isDemo,
    qcChecklist: r.qcChecklist ?? null,
    pitchId: r.pitchId,
    commentCount: comments.get(r.id) ?? 0,
    mediaCount: mediaN.get(r.id) ?? 0,
  }));
}

/**
 * Tile and filter counts, in SQL over the whole desk rather than over the
 * loaded page — past `DESK_PAGE_CAP` the two would otherwise disagree and the
 * hold queue's "Held (6)" would quietly start lying.
 */
export async function loadDeskCounts(includeDemo: boolean): Promise<DeskCounts> {
  const [byStatus, byPlacement, demoRow] = await Promise.all([
    db
      .select({ status: story.pipelineStatus, n: sql<number>`count(*)::int` })
      .from(story)
      .where(deskScope(includeDemo))
      .groupBy(story.pipelineStatus),
    db
      .select({ placement: story.deskPlacement, n: sql<number>`count(*)::int` })
      .from(story)
      .where(deskScope(includeDemo))
      .groupBy(story.deskPlacement),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(story)
      .where(and(deskScope(true), eq(story.isDemo, true))),
  ]);

  const counts = Object.fromEntries(DESK_STATUSES.map((s) => [s, 0])) as Record<DeskStatus, number>;
  let total = 0;
  for (const row of byStatus) {
    const key = row.status as DeskStatus | null;
    if (key && key in counts) counts[key] = row.n;
    total += row.n;
  }

  return {
    ...counts,
    total,
    demo: demoRow[0]?.n ?? 0,
    lead: byPlacement.find((p) => p.placement === "lead")?.n ?? 0,
    secondLead: byPlacement.find((p) => p.placement === "second_lead")?.n ?? 0,
  };
}

/**
 * Filter options. Reporters come from the desk's own rows (a filter listing
 * people with nothing on the desk is noise); editors and categories come from
 * the newsroom, because the bulk actions assign to them.
 */
export async function loadDeskFacets(includeDemo: boolean): Promise<DeskFacets> {
  const reporterUser = alias(user, "facet_reporter");

  const [reporters, editors, categories] = await Promise.all([
    db
      .selectDistinct({ id: reporterUser.id, name: reporterUser.name, image: reporterUser.image })
      .from(story)
      .innerJoin(reporterUser, eq(reporterUser.id, story.writerId))
      .where(deskScope(includeDemo))
      .orderBy(asc(reporterUser.name)),
    listAssignableEditors(),
    db
      .select({ id: category.id, name: category.name })
      .from(category)
      .where(and(eq(category.status, "published"), sql`${category.parentId} is null`))
      .orderBy(asc(category.position), asc(category.name)),
  ]);

  return {
    reporters,
    editors: editors.map((e) => ({ id: e.id, name: e.name, image: e.image })),
    categories,
  };
}

/** Candidates for "Reporter" in the assignment modal — the pipeline's own list. */
export async function loadDeskReporters() {
  const rows = await listAssignableReporters();
  return rows.map((r) => ({ id: r.id, name: r.name, image: r.image, role: r.role }));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

type StoryDetailRow = NonNullable<Awaited<ReturnType<typeof getStoryDetail>>>;

/** The timestamps the panel renders. Every one of them arrives as a `Date` from Drizzle. */
type DetailDates =
  | "deadline"
  | "assignedAt"
  | "lastSavedAt"
  | "scheduledFor"
  | "publishedAt"
  | "createdAt"
  | "updatedAt";

/**
 * Detail as the browser receives it: **every timestamp is an ISO string**.
 *
 * Drizzle hands back `Date` objects, and the panel's helpers (`timeAgo`,
 * `longDateTime`, `clockTime`, `toLocalInput`) all take strings. Passing a
 * `Date` to `Date.parse` happens to work in V8 — it re-parses
 * `Date.prototype.toString()` — but it is not guaranteed, it loses
 * milliseconds, and it is a type error. The conversion happens once here, the
 * way `lib/pitches/queries.ts` does it, rather than at each of a dozen call
 * sites.
 */
export type DeskDetail = Omit<StoryDetailRow, DetailDates | "comments" | "activity" | "revisions"> & {
  deadline: string | null;
  assignedAt: string | null;
  lastSavedAt: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: (Omit<StoryDetailRow["comments"][number], "createdAt" | "editedAt"> & {
    createdAt: string;
    editedAt: string | null;
  })[];
  activity: (Omit<StoryDetailRow["activity"][number], "createdAt"> & { createdAt: string })[];
  revisions: (Omit<StoryDetailRow["revisions"][number], "createdAt"> & { createdAt: string })[];
  placement: Placement;
  holdReason: string | null;
  heldByName: string | null;
  heldAt: string | null;
  isDemo: boolean;
  submittedAt: string | null;
  tags: string[];
  /** §23 — where the idea came from, so the desk can open the original pitch. */
  pitch: { id: string; title: string; status: string } | null;
};

/**
 * The detail panel's data. Reuses the pipeline's `getStoryDetail` — comments,
 * activity (§28), revisions and media all come from there — and adds only the
 * desk's own columns and the pitch link.
 */
export async function getDeskDetail(storyId: string): Promise<DeskDetail | null> {
  const base = await getStoryDetail(storyId);
  if (!base) return null;

  const holderUser = alias(user, "detail_holder");

  const [extra] = await db
    .select({
      placement: story.deskPlacement,
      holdReason: story.holdReason,
      heldByName: holderUser.name,
      heldAt: story.heldAt,
      isDemo: story.isDemo,
      submittedAt: story.submittedAt,
      tags: story.tags,
      pitchId: story.pitchId,
      pitchTitle: storyPitch.title,
      pitchStatus: storyPitch.status,
    })
    .from(story)
    .leftJoin(holderUser, eq(holderUser.id, story.heldById))
    .leftJoin(storyPitch, eq(storyPitch.id, story.pitchId))
    .where(eq(story.id, storyId))
    .limit(1);

  return {
    ...base,
    deadline: iso(base.deadline),
    assignedAt: iso(base.assignedAt),
    lastSavedAt: iso(base.lastSavedAt),
    scheduledFor: iso(base.scheduledFor),
    publishedAt: iso(base.publishedAt),
    createdAt: iso(base.createdAt)!,
    updatedAt: iso(base.updatedAt)!,
    comments: base.comments.map((c) => ({
      ...c,
      createdAt: iso(c.createdAt)!,
      editedAt: iso(c.editedAt),
    })),
    activity: base.activity.map((a) => ({ ...a, createdAt: iso(a.createdAt)! })),
    revisions: base.revisions.map((r) => ({ ...r, createdAt: iso(r.createdAt)! })),
    placement: (extra?.placement ?? "normal") as Placement,
    holdReason: extra?.holdReason ?? null,
    heldByName: extra?.heldByName ?? null,
    heldAt: iso(extra?.heldAt),
    isDemo: extra?.isDemo ?? false,
    submittedAt: iso(extra?.submittedAt),
    tags: extra?.tags ?? [],
    pitch:
      extra?.pitchId && extra.pitchTitle
        ? { id: extra.pitchId, title: extra.pitchTitle, status: extra.pitchStatus as string }
        : null,
  };
}
