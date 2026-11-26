import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { media, storyMedia } from "@/db/schema";

/**
 * Adds `attachedImageUrl` — the first image uploaded to the story through
 * the Story Pipeline — for stories that have no featured or photocard image.
 * One batched query for a whole list, never one per card (see the Drizzle
 * correlated-subquery note in CLAUDE.md for why this is a second flat query
 * rather than a subselect).
 */
export async function withAttachedImages<
  T extends { id: string; featuredImageUrl: string | null; photocardImageUrl?: string | null },
>(rows: T[]): Promise<(T & { attachedImageUrl: string | null })[]> {
  const need = rows.filter((r) => !r.featuredImageUrl?.trim() && !r.photocardImageUrl?.trim()).map((r) => r.id);
  if (need.length === 0) return rows.map((r) => ({ ...r, attachedImageUrl: null }));

  const attached = await db
    .select({ storyId: storyMedia.storyId, url: media.url })
    .from(storyMedia)
    .innerJoin(media, eq(media.id, storyMedia.mediaId))
    .where(and(inArray(storyMedia.storyId, need), eq(media.kind, "image")))
    .orderBy(asc(storyMedia.position));

  const first = new Map<string, string>();
  for (const a of attached) if (!first.has(a.storyId)) first.set(a.storyId, a.url);
  return rows.map((r) => ({ ...r, attachedImageUrl: first.get(r.id) ?? null }));
}
