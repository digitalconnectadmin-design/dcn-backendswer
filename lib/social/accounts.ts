import { and, eq } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { socialAuditLog, socialConnection } from "@/db/schema";
import { socialRegistry } from "@/lib/social/registry";
import { connectionRecord } from "@/lib/social/publish";
import { SocialApiError, type SocialPlatform } from "@/lib/social/types";

/**
 * Connected-account bookkeeping shared by every OAuth callback and the
 * accounts page: connect-or-reconnect, profile refresh, and the audit log.
 */

export async function audit(entry: {
  connectionId: string | null;
  platform: SocialPlatform | null;
  accountLabel: string | null;
  actorId: string | null;
  action: string;
  detail?: string | null;
}) {
  try {
    await db.insert(socialAuditLog).values({ ...entry, detail: entry.detail ?? null });
  } catch {
    // The audit trail must never block the action it records.
  }
}

/**
 * Refreshes the card details (name, avatar, followers) and doubles as the
 * connection health check: a failure the platform attributes to the token
 * or a permission flags the account "Action required".
 */
export async function refreshConnectionProfile(connectionId: string): Promise<{ ok: boolean; message: string }> {
  const [row] = await db.select().from(socialConnection).where(eq(socialConnection.id, connectionId)).limit(1);
  if (!row) return { ok: false, message: "That account no longer exists." };

  try {
    const profile = await socialRegistry[row.platform].fetchProfile(connectionRecord(row));
    await db
      .update(socialConnection)
      .set({
        ...(profile.label ? { label: profile.label } : {}),
        username: profile.username ?? row.username,
        avatarUrl: profile.avatarUrl ?? row.avatarUrl,
        followerCount: profile.followerCount ?? row.followerCount,
        accountType: profile.accountType ?? row.accountType,
        needsAttention: false,
        healthMessage: null,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialConnection.id, connectionId));
    return { ok: true, message: "Connection is working." };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't reach the platform.";
    const auth = e instanceof SocialApiError && e.authProblem;
    await db
      .update(socialConnection)
      .set({
        needsAttention: auth ? true : row.needsAttention,
        healthMessage: auth ? message : row.healthMessage,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialConnection.id, connectionId));
    return {
      ok: false,
      message: auth ? `${message} Reconnect this account to fix it.` : `Couldn't check the account: ${message}`,
    };
  }
}

/**
 * Every OAuth callback lands here. Connecting an account that's already on
 * file (same platform + platform account id) *reconnects* it — fresh token,
 * reactivated, "Action required" cleared — instead of inserting a duplicate
 * card. That is also what the Reconnect button relies on.
 */
export async function upsertConnection(input: {
  platform: SocialPlatform;
  externalAccountId: string;
  label: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  actorId: string;
}): Promise<{ id: string; reconnected: boolean }> {
  const [existing] = await db
    .select()
    .from(socialConnection)
    .where(
      and(eq(socialConnection.platform, input.platform), eq(socialConnection.externalAccountId, input.externalAccountId))
    )
    .limit(1);

  let id: string;
  if (existing) {
    await db
      .update(socialConnection)
      .set({
        label: input.label,
        accessToken: input.accessToken,
        // Keep the old refresh token if the platform didn't issue a new one.
        refreshToken: input.refreshToken ?? existing.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        isActive: true,
        needsAttention: false,
        healthMessage: null,
        deactivatedAt: null,
        deactivatedById: null,
        updatedAt: new Date(),
      })
      .where(eq(socialConnection.id, existing.id));
    id = existing.id;
  } else {
    const [created] = await db
      .insert(socialConnection)
      .values({
        platform: input.platform,
        label: input.label,
        externalAccountId: input.externalAccountId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        connectedById: input.actorId,
        updatedAt: new Date(),
      })
      .returning({ id: socialConnection.id });
    id = created.id;
  }

  await audit({
    connectionId: id,
    platform: input.platform,
    accountLabel: input.label,
    actorId: input.actorId,
    action: existing ? "reconnected" : "connected",
  });

  // Best-effort: a card without an avatar is fine; a failed connect isn't.
  await refreshConnectionProfile(id).catch(() => undefined);

  return { id, reconnected: !!existing };
}
