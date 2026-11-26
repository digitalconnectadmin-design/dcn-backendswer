// Stories, Reels, and social publishing/connections are restricted to
// these two roles — reporters, news editors, and digital executives can't
// view or act on any of it, by request.
export const NEWSROOM_MANAGEMENT_ROLES = ["admin", "chief_editor"] as const;

export function canManageNewsroom(role: string | undefined | null): boolean {
  return !!role && (NEWSROOM_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

// Publishing is the same permission as managing the newsroom area at all —
// kept as a separate export so call sites read clearly at the point of use.
export const canPublish = canManageNewsroom;

// User management (assigning roles, banning, deleting accounts) is
// narrower than newsroom management — admin only.
export function isAdmin(role: string | undefined | null): boolean {
  return role === "admin";
}

export const ALL_ROLES = [
  "admin",
  "chief_editor",
  "news_editor",
  "reporter",
  "digital_executive",
  "graphics",
] as const;

/**
 * Roles an admin can assign when creating a staff account.
 *
 * `admin` and `chief_editor` are deliberately excluded: those carry
 * newsroom-wide and user-management authority, so they're granted by
 * changing an existing account's role (a separate, deliberate action) rather
 * than handed out on the create-employee form.
 */
export const EMPLOYEE_ROLES = [
  "reporter",
  "news_editor",
  "digital_executive",
  "graphics",
] as const;

/** Roles expected to file stories — the only ones a daily target applies to. */
export const TARGET_BEARING_ROLES = ["reporter", "news_editor"] as const;

export function hasNewsTarget(role: string | undefined | null): boolean {
  return !!role && (TARGET_BEARING_ROLES as readonly string[]).includes(role);
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  chief_editor: "Chief Editor",
  news_editor: "News Editor",
  reporter: "Reporter",
  digital_executive: "Digital Executive",
  graphics: "Graphics",
};
