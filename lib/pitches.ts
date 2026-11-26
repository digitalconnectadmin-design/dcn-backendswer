/**
 * Story Pitches — vocabulary, status machine and permission rules.
 *
 * Pure module: no database, no `next/headers`, no server-only imports, so the
 * client console and the server actions import the exact same rules and can't
 * disagree about what a status means or who may do what. Same split as
 * `lib/pipeline.ts` (which this deliberately reuses for priority, story type
 * and the deadline helper rather than defining a parallel vocabulary that
 * would then have to be mapped at the pitch → assignment hand-off).
 */

import {
  PRIORITIES,
  PRIORITY_DOT,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STORY_TYPES,
  STORY_TYPE_LABELS,
  deadlineState,
  type StoryPriority,
  type StoryType,
} from "@/lib/pipeline";

export {
  PRIORITY_DOT,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STORY_TYPES,
  STORY_TYPE_LABELS,
  deadlineState,
  type StoryPriority,
  type StoryType,
};

/**
 * Priorities offered on a pitch. The pipeline's own list has a fifth value,
 * `breaking`, which is a *desk* judgement about a running story rather than
 * something a reporter claims for an idea — so it isn't offered here. The
 * column is still `story_priority`, so an approved pitch's priority lands on
 * `story.priority` verbatim with no translation table to get wrong.
 */
export const PITCH_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type PitchPriority = (typeof PITCH_PRIORITIES)[number];

export function isPitchPriority(value: unknown): value is PitchPriority {
  return typeof value === "string" && (PITCH_PRIORITIES as readonly string[]).includes(value);
}

export function isStoryType(value: unknown): value is StoryType {
  return typeof value === "string" && (STORY_TYPES as readonly string[]).includes(value);
}

export function isStoryPriority(value: unknown): value is StoryPriority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The stored lifecycle.
 *
 *   draft → pending_review → approved → assigned → in_progress → submitted
 *                                                                    ↓
 *                                                                completed
 *   pending_review → needs_changes → (reporter edits) → pending_review
 *   pending_review → rejected
 *
 * **"Resubmitted" is not a stored status.** The spec's flow has it passing
 * straight through into Pending Review, and neither the spec's own badge list
 * nor its filter list includes it — so a stored `resubmitted` value would be a
 * status no filter could ever select. Instead `resubmitCount` is incremented
 * and the badge reads "Resubmitted" while the count is above zero and the
 * pitch is awaiting review (see `pitchStatusLabel`). The activity timeline
 * records the resubmission as its own entry either way.
 *
 * The four post-approval values (`assigned` … `completed`) are **mirrors of the
 * linked Story Pipeline row**, not independently edited: `pitchStatusForStage`
 * derives them, and the server reconciles any pitch whose stored value has
 * fallen behind its story. Without that the pitch desk would keep saying
 * "Assigned" for a story that has already been published.
 */
export const PITCH_STATUSES = [
  "draft",
  "pending_review",
  "needs_changes",
  "approved",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
  "rejected",
] as const;
export type PitchStatus = (typeof PITCH_STATUSES)[number];

export function isPitchStatus(value: unknown): value is PitchStatus {
  return typeof value === "string" && (PITCH_STATUSES as readonly string[]).includes(value);
}

type StatusMeta = {
  label: string;
  /** Badge variant from components/ui/badge.tsx — no new variants invented. */
  variant: "default" | "secondary" | "accent" | "outline" | "destructive";
  /** Dot colour, matching the spec's 🟡 / 🟢 / 🔵 / 🔴 key. */
  dot: string;
  /** One line of plain English for the detail panel. */
  hint: string;
};

export const PITCH_STATUS_META: Record<PitchStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    variant: "outline",
    dot: "bg-muted-foreground/50",
    hint: "Only the reporter can see this. It hasn't been sent for review yet.",
  },
  pending_review: {
    label: "Pending review",
    variant: "accent",
    dot: "bg-marigold",
    hint: "Waiting for an editor to approve, request changes or reject it.",
  },
  needs_changes: {
    label: "Needs changes",
    variant: "accent",
    dot: "bg-marigold",
    hint: "An editor asked for changes. The reporter can edit and resubmit.",
  },
  approved: {
    label: "Approved",
    variant: "secondary",
    dot: "bg-emerald-500",
    hint: "Approved but not yet turned into a Story Pipeline assignment.",
  },
  assigned: {
    label: "Assigned",
    variant: "default",
    dot: "bg-skyline",
    hint: "Live in the Story Pipeline at the Assignment stage.",
  },
  in_progress: {
    label: "In progress",
    variant: "default",
    dot: "bg-skyline",
    hint: "The reporter is writing the story in the pipeline's Draft & Submit stage.",
  },
  submitted: {
    label: "Submitted",
    variant: "default",
    dot: "bg-skyline",
    hint: "Filed and sitting with the NM Desk or QC.",
  },
  completed: {
    label: "Completed",
    variant: "secondary",
    dot: "bg-emerald-500",
    hint: "The story from this pitch has been published.",
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    dot: "bg-signal",
    hint: "Not going ahead. The reason is recorded on the pitch.",
  },
};

/** The badge text, which is the one place "Resubmitted" appears. */
export function pitchStatusLabel(status: PitchStatus, resubmitCount = 0): string {
  if (status === "pending_review" && resubmitCount > 0) return "Resubmitted";
  return PITCH_STATUS_META[status].label;
}

/** Everything from `pending_review` onwards has left the reporter's hands. */
export const PITCH_OPEN_STATUSES: readonly PitchStatus[] = ["pending_review", "needs_changes"];

/** Statuses an editor is being asked to act on. Drives the "Awaiting review" inbox. */
export const PITCH_REVIEW_STATUSES: readonly PitchStatus[] = ["pending_review"];

/** Statuses that already live in the Story Pipeline. */
export const PITCH_PIPELINE_STATUSES: readonly PitchStatus[] = [
  "assigned",
  "in_progress",
  "submitted",
  "completed",
];

/**
 * Maps a linked story's pipeline stage onto the pitch status shown here.
 * `published` is passed separately because `publish` is the stage a story sits
 * in both just before and just after going live.
 */
export function pitchStatusForStage(
  stage: string | null | undefined,
  published: boolean,
  pipelineStatus?: string | null
): PitchStatus | null {
  if (published) return "completed";
  /**
   * A story the pipeline has rejected or archived keeps its stage — `qc`, say —
   * so stage alone would leave the pitch reading "Submitted, sitting with QC"
   * for a story that is dead, with no action available to anyone. The idea
   * itself was approved, so the pitch drops back to `approved`, where an editor
   * can assign it to someone else or reject it outright. `reconcilePitchStatuses`
   * unlinks the dead story when it applies this.
   */
  if (pipelineStatus === "rejected" || pipelineStatus === "archived") return "approved";
  switch (stage) {
    case "assignment":
      return "assigned";
    case "draft":
      return "in_progress";
    case "nm_desk":
    case "qc":
      return "submitted";
    case "publish":
      return "submitted";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

export const PITCH_REJECTION_REASONS = [
  "duplicate",
  "not_suitable",
  "insufficient_information",
  "outside_scope",
  "already_covered",
  "timing",
  "other",
] as const;
export type PitchRejectionReason = (typeof PITCH_REJECTION_REASONS)[number];

export const PITCH_REJECTION_LABELS: Record<PitchRejectionReason, string> = {
  duplicate: "Duplicate story already assigned",
  not_suitable: "Not suitable",
  insufficient_information: "Insufficient information",
  outside_scope: "Outside editorial scope",
  already_covered: "Already covered",
  timing: "Timing",
  other: "Other",
};

export function isRejectionReason(value: unknown): value is PitchRejectionReason {
  return typeof value === "string" && (PITCH_REJECTION_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Estimated completion
// ---------------------------------------------------------------------------

/**
 * "Estimated completion" is the reporter's own estimate, kept as a coarse
 * token plus the concrete date it resolved to at submit time. Storing only the
 * token would mean "this week" silently meaning a different week a fortnight
 * later; storing only the date would lose the fact that the reporter said
 * "today" rather than picking a date.
 */
export const PITCH_ETA_OPTIONS = [
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "two_weeks",
  "this_month",
  "unsure",
] as const;
export type PitchEta = (typeof PITCH_ETA_OPTIONS)[number];

export const PITCH_ETA_LABELS: Record<PitchEta, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  next_week: "Next week",
  two_weeks: "Within two weeks",
  this_month: "This month",
  unsure: "Not sure yet",
};

export function isPitchEta(value: unknown): value is PitchEta {
  return typeof value === "string" && (PITCH_ETA_OPTIONS as readonly string[]).includes(value);
}

/** Resolves a token to a concrete date, so the estimate is comparable later. */
export function etaToDate(eta: PitchEta, from: Date = new Date()): Date | null {
  const d = new Date(from);
  d.setHours(18, 0, 0, 0);
  switch (eta) {
    case "today":
      return d;
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      return d;
    case "this_week": {
      // Friday of the current week — the Bangladeshi work week runs Sun–Thu,
      // so "this week" lands at the end of Thursday rather than a Sunday.
      const day = d.getDay(); // 0 Sun … 4 Thu
      const toThursday = (4 - day + 7) % 7;
      d.setDate(d.getDate() + toThursday);
      return d;
    }
    case "next_week": {
      const day = d.getDay();
      const toThursday = (4 - day + 7) % 7;
      d.setDate(d.getDate() + toThursday + 7);
      return d;
    }
    case "two_weeks":
      d.setDate(d.getDate() + 14);
      return d;
    case "this_month":
      return new Date(d.getFullYear(), d.getMonth() + 1, 0, 18, 0, 0, 0);
    case "unsure":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Two kinds of written comment live in one table, separated by visibility:
 *
 *   - `internal` — the editors' own notes about the idea. **Never sent to a
 *     reporter**: the read layer filters these out in SQL rather than hiding
 *     them in the UI, so a reporter's browser never receives the text.
 *   - `shared`   — the discussion thread the reporter takes part in, plus the
 *     editor note attached to a Request Changes or a rejection.
 */
export const PITCH_NOTE_VISIBILITIES = ["internal", "shared"] as const;
export type PitchNoteVisibility = (typeof PITCH_NOTE_VISIBILITIES)[number];

export function isNoteVisibility(value: unknown): value is PitchNoteVisibility {
  return value === "internal" || value === "shared";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const PITCH_SORTS = [
  "newest",
  "oldest",
  "priority",
  "deadline",
  "reporter",
  "status",
  "updated",
] as const;
export type PitchSort = (typeof PITCH_SORTS)[number];

export const PITCH_SORT_LABELS: Record<PitchSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  priority: "Priority",
  deadline: "Deadline",
  reporter: "Reporter",
  status: "Status",
  updated: "Recently updated",
};

/** Sort weight for priority, highest first. */
const PRIORITY_RANK: Record<string, number> = { breaking: 5, urgent: 4, high: 3, normal: 2, low: 1 };

/** Sort weight for status — what an editor most needs to look at comes first. */
const STATUS_RANK: Record<PitchStatus, number> = {
  pending_review: 1,
  needs_changes: 2,
  approved: 3,
  assigned: 4,
  in_progress: 5,
  submitted: 6,
  draft: 7,
  completed: 8,
  rejected: 9,
};

/** Shape the comparator needs — deliberately narrower than the full row. */
export type SortablePitch = {
  status: PitchStatus;
  priority: string;
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  reporterName: string | null;
};

export function comparePitches(sort: PitchSort) {
  return (a: SortablePitch, b: SortablePitch): number => {
    switch (sort) {
      case "oldest":
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      case "priority":
        return (
          (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt)
        );
      case "deadline": {
        // A pitch with no deadline sorts last rather than first — an empty
        // date is "not scheduled", not "due at the epoch".
        const av = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
        const bv = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
        return av - bv || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }
      case "reporter":
        return (a.reporterName ?? "￿").localeCompare(b.reporterName ?? "￿");
      case "status":
        return (
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt)
        );
      case "updated":
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      case "newest":
      default:
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    }
  };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Who reviews pitches. Same three roles as the pipeline's manager set
 * (admin, chief_editor, news_editor) — an editor who can create and assign a
 * story in the pipeline is exactly the person who should be approving the idea
 * that becomes one. Deliberately **not** `canManageNewsroom`, which is
 * admin/chief_editor only and would lock news editors out of their own inbox.
 */
export const PITCH_REVIEWER_ROLES = ["admin", "chief_editor", "news_editor"] as const;

export function canReviewPitches(role: string | null | undefined): boolean {
  return !!role && (PITCH_REVIEWER_ROLES as readonly string[]).includes(role);
}

/**
 * The desk-wide powers: hard delete, and flipping demo data on or off. Admin
 * and chief editor, not news editors — turning demo data on changes what the
 * whole newsroom sees, which is a different kind of decision from approving one
 * idea.
 */
export function canAdministerPitches(role: string | null | undefined): boolean {
  return role === "admin" || role === "chief_editor";
}

/** Any signed-in staff account may pitch an idea. That's the point of the desk. */
export function canSubmitPitch(role: string | null | undefined): boolean {
  return !!role;
}

export type PitchAccess = {
  role: string | null | undefined;
  userId: string;
  /** Who the pitch belongs to editorially. */
  reporterId: string | null;
  /** Who typed it in — an editor can pitch on a reporter's behalf. */
  createdById: string | null;
  status: PitchStatus;
  /** Set once an editor has explicitly reopened an approved pitch for editing. */
  reopened?: boolean;
  /**
   * True once the pitch has become a Story Pipeline assignment. Several rules
   * change at that point: the pitch record stops being editable (the story is
   * the live document now, and rewriting the pitch's headline underneath it
   * would leave the reporter working from a brief that no longer matches), and
   * it can no longer be rejected or deleted.
   */
  hasStory?: boolean;
};

export function isPitchOwner(a: PitchAccess): boolean {
  return (!!a.reporterId && a.reporterId === a.userId) || (!!a.createdById && a.createdById === a.userId);
}

export function canViewPitch(a: PitchAccess): boolean {
  return canReviewPitches(a.role) || isPitchOwner(a);
}

/**
 * Editing rules (spec §22). The owner edits while the pitch is theirs — Draft
 * or Needs changes — and a reviewer may edit at any point before rejection.
 * After approval the owner needs the pitch reopened first, which is what stops
 * the headline changing under an assignment that already exists.
 */
export function canEditPitch(a: PitchAccess): boolean {
  // Once the assignment exists, the story is the live document. Editing the
  // pitch here would silently diverge from the brief the reporter is writing
  // against; priority, deadline and who is on it still change through
  // `updatePitchMeta`, which mirrors them onto the story.
  if (a.hasStory) return false;
  if (a.status === "rejected") return canReviewPitches(a.role);
  if (canReviewPitches(a.role)) return true;
  if (!isPitchOwner(a)) return false;
  if (a.status === "draft" || a.status === "needs_changes") return true;
  return !!a.reopened && a.status === "approved";
}

/** Send a draft, or a changes-requested pitch, back for review. */
export function canSubmitForReview(a: PitchAccess): boolean {
  if (!(a.status === "draft" || a.status === "needs_changes")) return false;
  return isPitchOwner(a) || canReviewPitches(a.role);
}

/**
 * The content requirement for a submission, checked by the form, the one-click
 * "Submit for review" button and the server action — one function so the button
 * is never enabled for something the server will refuse.
 */
export function pitchReadyToSubmit(p: { title: string; description: string | null }): boolean {
  return !!p.title.trim() && !!p.description?.trim();
}

/**
 * Approve / request changes / reject are only live while a decision is pending.
 *
 * A `draft` is deliberately excluded: it is the reporter's private workspace
 * until they send it, and an editor rejecting an unsubmitted draft would
 * destroy work that was never offered for review.
 */
export function canDecidePitch(a: PitchAccess): boolean {
  if (!canReviewPitches(a.role)) return false;
  if (a.hasStory) return false;
  return a.status === "pending_review" || a.status === "needs_changes" || a.status === "approved";
}

/** Turning an approved (or pending) pitch into a real assignment. */
export function canAssignPitch(a: PitchAccess): boolean {
  if (!canReviewPitches(a.role)) return false;
  if (a.hasStory) return false;
  return a.status === "pending_review" || a.status === "approved" || a.status === "needs_changes";
}

/** Rejecting is a decision, so it follows the same window — never on a draft. */
export function canRejectPitch(a: PitchAccess): boolean {
  return canDecidePitch(a) && a.status !== "rejected";
}

/**
 * Handing a pitch back for editing. A rejected pitch goes back to the reporter
 * as "needs changes" so they can actually act on it; an approved one stays
 * approved and merely becomes editable again.
 */
export function canReopenPitch(a: PitchAccess): boolean {
  if (!canReviewPitches(a.role)) return false;
  if (a.hasStory) return false;
  return a.status === "approved" || a.status === "rejected";
}

/** Anyone who can see it can join the shared discussion. Internal notes are reviewer-only. */
export function canCommentOnPitch(a: PitchAccess): boolean {
  return canViewPitch(a);
}

export function canAddInternalNote(a: PitchAccess): boolean {
  return canReviewPitches(a.role);
}

/** Uploading supporting material: the owner while it's editable, reviewers always. */
export function canAttachToPitch(a: PitchAccess): boolean {
  return canEditPitch(a);
}

export function canDeletePitch(a: PitchAccess): boolean {
  // A pitch that already has a story is the story's provenance record; deleting
  // it would orphan the assignment.
  if (a.hasStory) return false;
  if (canAdministerPitches(a.role)) return true;
  return isPitchOwner(a) && a.status === "draft";
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * Stopwords stripped before fingerprinting a headline. Bangla and English
 * both, because the newsroom pitches in both and a Bangla-only or
 * English-only list would make half the comparisons useless.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with", "at", "by", "from",
  "is", "are", "was", "were", "be", "been", "as", "that", "this", "it", "its", "into", "about",
  "new", "next", "how", "why", "what", "who", "when", "will", "can", "more", "than", "after",
  "bangladesh", "bangladeshi",
  "এবং", "ও", "এর", "এই", "সেই", "যে", "একটি", "একটা", "থেকে", "করে", "করা", "হয়", "হবে",
  "জন্য", "সাথে", "মধ্যে", "নিয়ে", "কী", "কি", "কেন", "কিভাবে", "বাংলাদেশ", "বাংলাদেশের",
]);

/**
 * Significant tokens of a headline. Unicode-aware for the same reason
 * `slugify` is (see CLAUDE.md) — an ASCII-only split returns an empty set for
 * every Bangla title, which would silently switch duplicate detection off for
 * most of what this newsroom writes.
 */
export function pitchTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  return [...new Set(matches.filter((t) => t.length > 2 && !STOPWORDS.has(t)))];
}

/**
 * Jaccard overlap of two headlines' significant tokens, 0–1. Deliberately
 * crude: this is a "have a look at these two first" prompt, not a decision.
 * It never blocks a submission — see `similarPitches`.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = pitchTokens(a);
  const tb = pitchTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  if (shared === 0) return 0;
  return shared / (ta.length + tb.length - shared);
}

export type DuplicateCandidate = { id: string; title: string; status: PitchStatus; reporterName: string | null; score: number };

/**
 * Candidates to show the reporter before a submission goes in. Two significant
 * tokens in common is the floor, because a single shared word ("startups")
 * would flag half the desk.
 */
export function similarPitches(
  title: string,
  existing: readonly { id: string; title: string; status: PitchStatus; reporterName: string | null }[],
  options: { exclude?: string | null; limit?: number } = {}
): DuplicateCandidate[] {
  const own = pitchTokens(title);
  if (own.length === 0) return [];
  const ownSet = new Set(own);
  const out: DuplicateCandidate[] = [];
  for (const row of existing) {
    if (options.exclude && row.id === options.exclude) continue;
    if (row.status === "rejected") continue;
    const other = pitchTokens(row.title);
    const shared = other.filter((t) => ownSet.has(t)).length;
    if (shared < 2) continue;
    out.push({ ...row, score: titleSimilarity(title, row.title) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, options.limit ?? 5);
}

// ---------------------------------------------------------------------------
// Input sanitising
// ---------------------------------------------------------------------------

/** Field caps. Pitch text is free-form staff input landing in a text column. */
export const PITCH_LIMITS = {
  title: 220,
  description: 6000,
  plan: 6000,
  sources: 2000,
  note: 4000,
  attachmentLabel: 160,
} as const;

export function trimTo(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+$/u, "").replace(/^\s+/u, "").slice(0, max);
}

/** Deadline warning text for a card, using the pipeline's own helper. */
export function deadlineChip(deadline: Date | string | null | undefined, now: Date = new Date()) {
  const state = deadlineState(deadline, now);
  if (!state) return null;
  const d = typeof deadline === "string" ? new Date(deadline!) : deadline!;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (state.overdue) return { tone: "overdue" as const, text: `Overdue by ${state.label}` };
  if (sameDay) return { tone: "today" as const, text: "Due today" };
  return { tone: "ahead" as const, text: `Due in ${state.label}` };
}

/** Initials for the reporter avatar. Works on Bangla names too. */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
