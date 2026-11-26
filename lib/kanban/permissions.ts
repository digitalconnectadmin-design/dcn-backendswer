/**
 * Board permissions.
 *
 * Two independent axes, deliberately: the site-wide `user.role` (admin,
 * chief_editor, reporter…) and the per-board `boardRole` (owner, manager,
 * member). A reporter can manage a board without gaining newsroom-wide
 * powers, and an admin can administer any board without being a member of it.
 * Every check below takes both.
 */

export type BoardRole = "owner" | "manager" | "member";

export type Access = {
  /** Site-wide admin — sees and administers everything. */
  isAdmin: boolean;
  /** This user's role on this board, or null if not a member. */
  boardRole: BoardRole | null;
};

export function canViewBoard(a: Access): boolean {
  return a.isAdmin || a.boardRole !== null;
}

/** Board settings: columns, members, labels, rename, archive. */
export function canManageBoard(a: Access): boolean {
  return a.isAdmin || a.boardRole === "owner" || a.boardRole === "manager";
}

export function canDeleteBoard(a: Access): boolean {
  return a.isAdmin || a.boardRole === "owner";
}

/** Any member can create tasks and move them — that's the daily workflow. */
export function canCreateTask(a: Access): boolean {
  return canViewBoard(a);
}

export function canMoveTask(a: Access): boolean {
  return canViewBoard(a);
}

/**
 * Editing a task's substance. Members may edit tasks they created or are
 * assigned to; managers may edit anything on the board. Passed explicitly
 * rather than inferred so callers can't forget the ownership part.
 */
export function canEditTask(
  a: Access,
  opts: { isCreator: boolean; isAssignee: boolean }
): boolean {
  if (canManageBoard(a)) return true;
  return a.boardRole !== null && (opts.isCreator || opts.isAssignee);
}

/** Deleting is narrower than editing: managers, or the person who created it. */
export function canDeleteTask(a: Access, opts: { isCreator: boolean }): boolean {
  return canManageBoard(a) || (a.boardRole !== null && opts.isCreator);
}

/** People may edit and remove their own comments; managers may remove any. */
export function canModifyComment(a: Access, opts: { isAuthor: boolean }): boolean {
  return opts.isAuthor || canManageBoard(a);
}

/** Only site admins and board managers may assign work to other people. */
export function canAssignOthers(a: Access): boolean {
  return canManageBoard(a);
}
