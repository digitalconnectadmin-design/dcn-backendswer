/**
 * The newsroom's write-side bookkeeping: activity entries, notifications and
 * revision snapshots.
 *
 * Extracted from `app/(cms)/admin/pipeline/actions.ts` when the News
 * Management Desk needed the same four helpers. Two copies of "log what
 * happened and tell the reporter" would drift — one desk would stop writing
 * activity, or would phrase a notification differently — and the activity
 * timeline is the one surface that has to be complete to be worth anything
 * (§28 of the desk brief: "every editorial action should be recorded").
 *
 * Every function here swallows its own failures on purpose. A missed activity
 * line or notification must never fail the publish it was describing.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { notification, story, storyActivity, storyRevision, user } from "@/db/schema";
import type { StoryRevisionSnapshot } from "@/lib/pipeline";

export async function logActivity(storyId: string, actorId: string, message: string) {
  try {
    await db.insert(storyActivity).values({ storyId, actorId, message });
  } catch {
    // Activity logging must never break the operation it describes.
  }
}

export async function notify(
  userIds: (string | null | undefined)[],
  message: string,
  storyId: string,
  exclude?: string
) {
  const targets = [...new Set(userIds)].filter((id): id is string => !!id && id !== exclude);
  if (targets.length === 0) return;
  try {
    await db.insert(notification).values(targets.map((userId) => ({ userId, message, storyId })));
  } catch {
    // Same reasoning as logActivity.
  }
}

// `user.role` is a pg enum, so inArray wants its literal union, not string[].
export type UserRole = (typeof user.$inferSelect)["role"];

export async function userIdsByRole(roles: readonly UserRole[]): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.banned, false), inArray(user.role, roles)));
  return rows.map((r) => r.id);
}

export async function saveRevision(storyId: string, label: string, actorId: string) {
  const [row] = await db.select().from(story).where(eq(story.id, storyId)).limit(1);
  if (!row) return;
  const snapshot: StoryRevisionSnapshot = {
    title: row.title,
    subtitle: row.subtitle,
    excerpt: row.excerpt,
    body: row.body,
    bodyJson: row.bodyJson,
    category: row.category,
    tags: row.tags,
    featuredImageUrl: row.featuredImageUrl,
  };
  try {
    await db.insert(storyRevision).values({ storyId, label, snapshot, createdById: actorId });
  } catch {
    // A missed snapshot shouldn't block the transition it's documenting.
  }
}
