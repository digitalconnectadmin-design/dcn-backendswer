/**
 * News Management Desk — vocabulary, permissions and the publish gate.
 *
 * Pure module: the client console and the server actions import the same
 * functions, so a button can never appear for something the server will
 * refuse.
 *
 * The desk is **a view onto the Story Pipeline, not a second workflow.** It
 * reads and writes `story.pipelineStage` / `pipelineStatus` like every other
 * pipeline screen, which is what the brief means by "do not create duplicate
 * stories". The desk's own vocabulary ("Submitted / Editing / Ready / Held")
 * is a relabelling of pipeline statuses, defined here in one place.
 */

import {
  PRIORITIES,
  PRIORITY_DOT,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_LABELS,
  deadlineState,
  qcChecklistComplete,
  type PipelineStatus,
  type QcChecklist,
  type StoryPriority,
} from "@/lib/pipeline";
import { isPipelineManager, canPublish as pipelineCanPublish } from "@/lib/pipeline/permissions";

export {
  PRIORITIES,
  PRIORITY_DOT,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  deadlineState,
  type StoryPriority,
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The statuses a story can hold while the desk is responsible for it, plus the
 * ones it passes into afterwards. This is the full set the desk lists and
 * filters by — it is deliberately the pipeline's own enum, not a parallel one.
 */
export const DESK_STATUSES = [
  "submitted",
  "under_review",
  "ready",
  "held",
  "in_qc",
  "approved",
  "scheduled",
  "published",
  "changes_requested",
  "draft",
  "archived",
] as const;
export type DeskStatus = (typeof DESK_STATUSES)[number];

export function isDeskStatus(v: unknown): v is DeskStatus {
  return typeof v === "string" && (DESK_STATUSES as readonly string[]).includes(v);
}

type StatusMeta = {
  label: string;
  /** Badge variant from components/ui/badge.tsx — no new variants invented. */
  variant: "default" | "secondary" | "accent" | "outline" | "destructive";
  dot: string;
  /** One line of plain English, shown in the detail panel. */
  hint: string;
};

/**
 * `STATUS_LABELS` in lib/pipeline.ts already names these for the board; the
 * desk reuses those names so the two screens can't call the same state
 * different things. Only the tone and the hint are desk-specific.
 */
export const DESK_STATUS_META: Record<DeskStatus, StatusMeta> = {
  submitted: {
    label: STATUS_LABELS.submitted,
    variant: "outline",
    dot: "bg-skyline",
    hint: "The reporter has filed it. Nobody on the desk has picked it up yet.",
  },
  under_review: {
    label: STATUS_LABELS.under_review,
    variant: "accent",
    dot: "bg-marigold",
    hint: "Someone on the desk is working on the headline, tags and placement.",
  },
  ready: {
    label: STATUS_LABELS.ready,
    variant: "secondary",
    dot: "bg-emerald-500",
    hint: "The desk has finished with it. It can go to proofreading, or straight out if your newsroom allows it.",
  },
  held: {
    label: STATUS_LABELS.held,
    variant: "destructive",
    dot: "bg-signal",
    hint: "On editorial hold. It will not publish, in bulk or otherwise, until the hold is released.",
  },
  in_qc: {
    label: STATUS_LABELS.in_qc,
    variant: "accent",
    dot: "bg-marigold",
    hint: "With proofreading. The checklist has to be complete before it can be approved.",
  },
  approved: {
    label: STATUS_LABELS.approved,
    variant: "secondary",
    dot: "bg-emerald-500",
    hint: "Proofreading has signed it off. Ready to publish or schedule.",
  },
  scheduled: {
    label: STATUS_LABELS.scheduled,
    variant: "default",
    dot: "bg-skyline",
    hint: "Waiting for its own publish time. It goes live on its own.",
  },
  published: {
    label: STATUS_LABELS.published,
    variant: "secondary",
    dot: "bg-emerald-500",
    hint: "Live on the website.",
  },
  changes_requested: {
    label: STATUS_LABELS.changes_requested,
    variant: "accent",
    dot: "bg-marigold",
    hint: "Sent back to the reporter with a note. It will return to the desk when they resubmit.",
  },
  draft: {
    label: STATUS_LABELS.draft,
    variant: "outline",
    dot: "bg-muted-foreground/50",
    hint: "Back with the reporter as a draft.",
  },
  archived: {
    label: STATUS_LABELS.archived,
    variant: "outline",
    dot: "bg-muted-foreground/50",
    hint: "Out of the running. Kept for the record.",
  },
};

/**
 * How many rows the desk's console loads at once.
 *
 * Lives in this pure module rather than beside the query that applies it: the
 * client console shows "newest N" in its toolbar, and importing that number
 * from `lib/nm-desk/queries.ts` would pull `db` — and its top-level
 * `DATABASE_URL` check — into the browser bundle, where it throws on load.
 */
export const DESK_PAGE_CAP = 400;

/** Statuses the desk is actively responsible for — its default view. */
export const DESK_ACTIVE_STATUSES: readonly DeskStatus[] = [
  "submitted",
  "under_review",
  "ready",
  "held",
];

/** A story the desk has finished with, but still manages (§26). */
export const DESK_DONE_STATUSES: readonly DeskStatus[] = ["published", "scheduled"];

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export const PLACEMENTS = ["normal", "lead", "second_lead"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<Placement, string> = {
  normal: "Normal",
  lead: "Lead",
  second_lead: "Second lead",
};

export function isPlacement(v: unknown): v is Placement {
  return typeof v === "string" && (PLACEMENTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const DESK_SORTS = [
  "newest",
  "oldest",
  "updated",
  "priority",
  "headline",
  "reporter",
  "status",
] as const;
export type DeskSort = (typeof DESK_SORTS)[number];

export const DESK_SORT_LABELS: Record<DeskSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently updated",
  priority: "Priority",
  headline: "Headline",
  reporter: "Reporter",
  status: "Status",
};

const PRIORITY_RANK: Record<string, number> = { breaking: 5, urgent: 4, high: 3, normal: 2, low: 1 };

/** What an editor most needs to look at comes first. */
const STATUS_RANK: Record<DeskStatus, number> = {
  held: 1,
  submitted: 2,
  under_review: 3,
  ready: 4,
  in_qc: 5,
  approved: 6,
  scheduled: 7,
  changes_requested: 8,
  published: 9,
  draft: 10,
  archived: 11,
};

/** The shape the comparator needs — narrower than the full row on purpose. */
export type SortableStory = {
  status: DeskStatus;
  priority: string;
  placement: Placement;
  title: string;
  reporterName: string | null;
  arrivedAt: string;
  updatedAt: string;
};

export function compareStories(sort: DeskSort) {
  return (a: SortableStory, b: SortableStory): number => {
    // The lead and second lead always sit at the top of the desk, whatever the
    // sort. An editor looking for the lead should never have to find it.
    const rank = (s: SortableStory) => (s.placement === "lead" ? 0 : s.placement === "second_lead" ? 1 : 2);
    const byPlacement = rank(a) - rank(b);
    if (byPlacement !== 0) return byPlacement;

    switch (sort) {
      case "oldest":
        return Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt);
      case "updated":
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      case "priority":
        return (
          (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) ||
          Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt)
        );
      case "headline":
        return a.title.localeCompare(b.title);
      case "reporter":
        return (a.reporterName ?? "￿").localeCompare(b.reporterName ?? "￿");
      case "status":
        return (
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt)
        );
      case "newest":
      default:
        return Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt);
    }
  };
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

export const DATE_WINDOWS = ["", "today", "yesterday", "7", "30", "custom"] as const;
export type DateWindow = (typeof DATE_WINDOWS)[number];

export const DATE_WINDOW_LABELS: Record<DateWindow, string> = {
  "": "Any date",
  today: "Today",
  yesterday: "Yesterday",
  "7": "Last 7 days",
  "30": "Last 30 days",
  custom: "Custom range",
};

/**
 * Resolves a window to an inclusive [from, to) pair in milliseconds, or null
 * for "any date". Computed from a `now` the caller passes, so the list and any
 * count derived from it agree on where today starts.
 */
export function dateWindowRange(
  window: DateWindow,
  now: Date,
  custom?: { from?: string; to?: string }
): { from: number; to: number } | null {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 86_400_000;
  const today = startOfDay(now);

  switch (window) {
    case "today":
      return { from: today, to: today + DAY };
    case "yesterday":
      return { from: today - DAY, to: today };
    case "7":
      return { from: today - 6 * DAY, to: today + DAY };
    case "30":
      return { from: today - 29 * DAY, to: today + DAY };
    case "custom": {
      if (!custom?.from && !custom?.to) return null;
      const from = custom.from ? startOfDay(new Date(custom.from)) : Number.NEGATIVE_INFINITY;
      // `to` is inclusive of the whole day the editor picked.
      const to = custom.to ? startOfDay(new Date(custom.to)) + DAY : Number.POSITIVE_INFINITY;
      if (Number.isNaN(from) || Number.isNaN(to)) return null;
      return { from, to };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Who works the desk. The same three roles the pipeline calls managers —
 * admin, chief editor, news editor — because the News Management Desk *is*
 * the news editor's screen. `canManageNewsroom` (admin/chief_editor only)
 * would lock the person the page exists for out of it.
 */
export function canWorkDesk(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

/** Publishing to the live website. */
export function canPublishFromDesk(role: string | null | undefined): boolean {
  return pipelineCanPublish(role);
}

/** Unpublishing, archiving and clearing demo rows are heavier than a publish. */
export function canAdministerDesk(role: string | null | undefined): boolean {
  return role === "admin" || role === "chief_editor";
}

// ---------------------------------------------------------------------------
// The publish gate
// ---------------------------------------------------------------------------

export type PublishBlock = { code: string; message: string };

/**
 * Everything that would stop a story going live, in one place, so the bulk
 * action and the single-story button refuse for identical reasons and the UI
 * can explain *why* a row is excluded before anyone clicks.
 *
 * `requireQc` reflects the newsroom's own policy (§24): with it on, a story has
 * to have been through proofreading. It is a setting rather than a constant
 * because the brief says "if that is the newsroom's configured workflow".
 */
export function publishBlockers(
  s: {
    title: string;
    /**
     * Whether the article has a body at all — a boolean rather than the text,
     * so the desk list can run this gate for 400 rows without shipping 400
     * articles to the browser. The server passes the same boolean, computed
     * from the row it is about to publish.
     */
    hasBody: boolean;
    category: string | null;
    featuredImageUrl: string | null;
    status: DeskStatus;
    /**
     * `story.status` — the site-wide lifecycle. Checked as well as the desk
     * status because the classic Stories admin publishes by writing this column
     * alone, leaving `pipelineStatus` at whatever the desk last set. Reading
     * only the desk status would let the desk publish a story that is already
     * live, resetting its publish time and cross-posting it a second time.
     */
    liveStatus: string;
    qcChecklist: QcChecklist | null;
    isDemo: boolean;
    holdReason: string | null;
  },
  opts: { requireQc: boolean }
): PublishBlock[] {
  const out: PublishBlock[] = [];

  if (s.isDemo) {
    out.push({
      code: "demo",
      message: "This is a sample story. Sample stories can never be published to the live website.",
    });
  }
  if (s.status === "held") {
    out.push({
      code: "held",
      message: s.holdReason ? `On hold: ${s.holdReason}` : "On editorial hold. Release the hold first.",
    });
  }
  if (s.status === "published" || s.liveStatus === "published") {
    out.push({ code: "already", message: "Already published." });
  }
  if (!s.title?.trim()) out.push({ code: "title", message: "No headline." });
  if (!s.hasBody) out.push({ code: "body", message: "No article body." });
  if (!s.category?.trim()) out.push({ code: "category", message: "No section." });
  if (!s.featuredImageUrl) out.push({ code: "image", message: "No featured image." });

  if (opts.requireQc && !qcChecklistComplete(s.qcChecklist)) {
    out.push({
      code: "qc",
      message: "Proofreading isn't finished — the checklist is incomplete.",
    });
  }

  return out;
}

/** True when the story could be published right now. */
export function canPublishStory(
  s: Parameters<typeof publishBlockers>[0],
  opts: { requireQc: boolean }
): boolean {
  return publishBlockers(s, opts).length === 0;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Field caps for the free text an editor types on this screen. */
export const DESK_LIMITS = { holdReason: 500, note: 2000 } as const;

export function trimTo(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return isDeskStatus(v);
}

/** Initials for the reporter chip. Works on Bangla names too. */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
