/**
 * Story Pipeline permissions.
 *
 * The classic Stories/Reels admin (`canManageNewsroom` in lib/roles.ts) is
 * deliberately admin/chief_editor only — reporters, news editors and digital
 * executives were locked out of it "by request" (see lib/roles.ts). The
 * pipeline is a *different, narrower* door: reporters need to reach their own
 * assigned stories to do their job, so this module scopes that access per
 * story rather than reopening the classic Stories admin. Same philosophy as
 * board membership in lib/kanban/permissions.ts — a role here doesn't grant
 * newsroom-wide power, only pipeline-shaped power.
 *
 * Role mapping (no dedicated "QC" or "Publisher" role exists on `user.role`,
 * so this is where that spec vocabulary is translated onto the six real
 * roles):
 *   - admin, chief_editor  — full pipeline access, same as they already have
 *                            everywhere else in the CMS.
 *   - news_editor          — the "Editor / NM Desk" persona: create/assign,
 *                            review at NM Desk, send to QC, request changes,
 *                            publish.
 *   - digital_executive    — the "QC" persona: proofreading checklist,
 *                            comments, approve/request changes at QC.
 *   - reporter, graphics   — the "Reporter" persona: only stories where they
 *                            are the assigned reporter or editor. No board-wide
 *                            visibility, no assign/QC/publish actions.
 */

export const PIPELINE_MANAGER_ROLES = ["admin", "chief_editor", "news_editor"] as const;
export const PIPELINE_QC_ROLES = ["admin", "chief_editor", "digital_executive"] as const;

function inList(role: string | null | undefined, list: readonly string[]): boolean {
  return !!role && list.includes(role);
}

/** Create assignments, run the NM Desk, publish. The "Editor / NM Desk" persona. */
export function isPipelineManager(role: string | null | undefined): boolean {
  return inList(role, PIPELINE_MANAGER_ROLES);
}

/** Run the QC checklist and approve/reject at the QC stage. */
export function isQcReviewer(role: string | null | undefined): boolean {
  return inList(role, PIPELINE_QC_ROLES);
}

/** Sees every story on the board, not just their own. Managers and QC both need the full picture. */
export function canViewFullBoard(role: string | null | undefined): boolean {
  return isPipelineManager(role) || isQcReviewer(role);
}

export function canCreateStory(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

export function canAssign(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

/** Send to QC, request changes, reassign, edit any story from the NM Desk. */
export function canActAtNmDesk(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

export function canPublish(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

export function canBulkAct(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}

/** What a specific person is to a specific story — every finer check below takes this. */
export type StoryAccess = {
  role: string | null | undefined;
  userId: string;
  reporterId: string | null;
  assignedEditorId: string | null;
};

export function isReporterOn(a: StoryAccess): boolean {
  return !!a.reporterId && a.reporterId === a.userId;
}

export function isEditorOn(a: StoryAccess): boolean {
  return !!a.assignedEditorId && a.assignedEditorId === a.userId;
}

/** Can open this specific story at all. */
export function canViewStory(a: StoryAccess): boolean {
  return canViewFullBoard(a.role) || isReporterOn(a) || isEditorOn(a);
}

/**
 * Can write the article body, headline, media etc. Reporters may edit their
 * own assigned story; managers may edit anything (a story sent back for
 * changes, a story that needs a fix at NM Desk).
 */
export function canEditContent(a: StoryAccess): boolean {
  return isPipelineManager(a.role) || isReporterOn(a) || isEditorOn(a);
}

/** Submitting to NM Desk is the reporter's own action (or a manager acting on their behalf). */
export function canSubmit(a: StoryAccess): boolean {
  return isPipelineManager(a.role) || isReporterOn(a);
}

export function canComment(a: StoryAccess): boolean {
  return canViewStory(a);
}

export function canRunQc(a: StoryAccess): boolean {
  return isQcReviewer(a.role);
}

export function canDeleteStory(role: string | null | undefined): boolean {
  return isPipelineManager(role);
}
