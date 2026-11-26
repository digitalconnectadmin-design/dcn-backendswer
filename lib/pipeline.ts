/**
 * Shared types and constants for the Story Pipeline (`/admin/pipeline`).
 *
 * Kept separate from db/schema.ts (which imports the snapshot type from
 * here, the same way it imports PhotocardDocument from lib/photocard.ts)
 * so the workflow's vocabulary lives in one place instead of being
 * re-typed in every component and action that touches it.
 */

// ---------------------------------------------------------------------------
// Stages — the five columns on the board. Deliberately a *separate* concept
// from `story.status` (draft/in_review/qc/published): status is the coarse,
// site-wide lifecycle every other page already reads (the home page query,
// the classic Stories admin list), while stage is which column a card sits
// in. "Assignment" and "Draft & Submit" are both `status: draft`, so status
// alone can't tell them apart — stage is what does.
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES = ["assignment", "draft", "nm_desk", "qc", "publish"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  assignment: "Assignment",
  draft: "Draft & Submit",
  nm_desk: "NM Desk",
  qc: "QC / Proofreading",
  publish: "Publish",
};

export const STAGE_CAPTIONS: Record<PipelineStage, string> = {
  assignment: "Desk assigns a reporter",
  draft: "Reporter writes and submits",
  nm_desk: "Headline, tags, placement",
  qc: "Spelling, grammar, policy check",
  publish: "Live on site + auto cross-post",
};

// ---------------------------------------------------------------------------
// Workflow status — the fine-grained state shown on the story itself.
// Several statuses can map to one stage (e.g. both "submitted" and
// "changes_requested" sit in the Draft & Submit column).
// ---------------------------------------------------------------------------

export const PIPELINE_STATUSES = [
  "assigned",
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  // Added for the News Management Desk — see lib/nm-desk.ts.
  "ready",
  "held",
  "in_qc",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "archived",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  assigned: "Assigned",
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Editing",
  changes_requested: "Changes requested",
  ready: "Ready",
  held: "Held",
  in_qc: "In QC",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
  archived: "Archived",
};

/** Which stage a status belongs to, for the odd case a story needs re-deriving. */
export const STATUS_STAGE: Record<PipelineStatus, PipelineStage> = {
  assigned: "assignment",
  draft: "draft",
  submitted: "nm_desk",
  under_review: "nm_desk",
  changes_requested: "draft",
  ready: "nm_desk",
  held: "nm_desk",
  in_qc: "qc",
  approved: "publish",
  scheduled: "publish",
  published: "publish",
  rejected: "draft",
  archived: "draft",
};

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const PRIORITIES = ["low", "normal", "high", "urgent", "breaking"] as const;
export type StoryPriority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<StoryPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  breaking: "Breaking",
};

/** Tailwind classes for the priority dot/badge — breaking and urgent must read as obviously hot. */
export const PRIORITY_STYLES: Record<StoryPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-skyline/15 text-ink",
  high: "bg-marigold/40 text-ink",
  urgent: "bg-orange-500/15 text-orange-700",
  breaking: "bg-signal/15 text-signal",
};

export const PRIORITY_DOT: Record<StoryPriority, string> = {
  low: "bg-muted-foreground/50",
  normal: "bg-skyline",
  high: "bg-marigold",
  urgent: "bg-orange-500",
  breaking: "bg-signal",
};

// ---------------------------------------------------------------------------
// Story type
// ---------------------------------------------------------------------------

export const STORY_TYPES = ["news", "feature", "opinion", "investigation", "interview", "analysis"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const STORY_TYPE_LABELS: Record<StoryType, string> = {
  news: "News",
  feature: "Feature",
  opinion: "Opinion",
  investigation: "Investigation",
  interview: "Interview",
  analysis: "Analysis",
};

// ---------------------------------------------------------------------------
// QC checklist — a fixed set of items, stored as a jsonb Record<key, boolean>
// on the story row (one row per story, never queried across stories, so a
// join table would only add cost for no benefit).
// ---------------------------------------------------------------------------

export const QC_CHECKLIST_ITEMS = [
  { key: "headline", label: "Headline checked" },
  { key: "grammar", label: "Grammar checked" },
  { key: "spelling", label: "Spelling checked" },
  { key: "facts", label: "Facts verified" },
  { key: "image", label: "Image checked" },
  { key: "caption", label: "Caption checked" },
  { key: "category", label: "Category checked" },
  { key: "links", label: "Links checked" },
  { key: "final", label: "Final review" },
] as const;

export type QcChecklist = Record<string, boolean>;

export function defaultQcChecklist(): QcChecklist {
  return Object.fromEntries(QC_CHECKLIST_ITEMS.map((i) => [i.key, false]));
}

export function qcChecklistComplete(checklist: QcChecklist | null | undefined): boolean {
  if (!checklist) return false;
  return QC_CHECKLIST_ITEMS.every((i) => checklist[i.key] === true);
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export type StoryRevisionSnapshot = {
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  body: string;
  bodyJson: unknown;
  category: string;
  tags: string[];
  featuredImageUrl: string | null;
};

// ---------------------------------------------------------------------------
// Publish validation — what "Ready to Publish" actually checks.
// ---------------------------------------------------------------------------

export type PublishReadiness = {
  ready: boolean;
  missing: string[];
};

export function checkPublishReadiness(story: {
  title: string;
  body: string;
  category: string;
  featuredImageUrl: string | null;
}): PublishReadiness {
  const missing: string[] = [];
  if (!story.title?.trim()) missing.push("Headline");
  if (!story.body?.trim()) missing.push("Article body");
  if (!story.category?.trim()) missing.push("Category");
  if (!story.featuredImageUrl) missing.push("Featured image");
  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

export function deadlineState(deadline: Date | string | null | undefined, now: Date = new Date()) {
  if (!deadline) return null;
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  const diffMs = d.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const minutes = Math.round(Math.abs(diffMs) / 60000);
  const label =
    minutes < 60
      ? `${minutes} min`
      : minutes < 60 * 24
        ? `${Math.round(minutes / 60)} hr`
        : `${Math.round(minutes / (60 * 24))} d`;
  return { overdue, label };
}
