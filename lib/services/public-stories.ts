import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { story } from "@/db/schema";
import { withAttachedImages } from "@/lib/story-image-server";
import { HttpError } from "@/lib/api/http";

/**
 * Public story reads, ported out of `app/(home)/story/[slug]/page.tsx`.
 *
 * In the monolith the page component *was* the data layer — `getStory` and
 * `getRelated` were local functions inside the page file. They're pulled out
 * here so the frontend page can stay purely presentational.
 */

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function findPublished(slug: string) {
  const [item] = await db
    .select()
    .from(story)
    // decodeURIComponent: Bangla slugs arrive percent-encoded in the route
    // param. Matching the raw encoded form against the stored slug is how a
    // card could open "not found" for a story that plainly exists.
    .where(and(eq(story.slug, safeDecode(slug)), eq(story.status, "published")))
    .limit(1);
  if (!item) return null;
  const [withImage] = await withAttachedImages([item]);
  return withImage;
}

async function findRelated(item: { id: string; categoryId: string | null; category: string }) {
  const rows = await db
    .select()
    .from(story)
    .where(
      and(
        eq(story.status, "published"),
        ne(story.id, item.id),
        item.categoryId
          ? or(
              eq(story.categoryId, item.categoryId),
              and(isNull(story.categoryId), eq(story.category, item.category))
            )
          : eq(story.category, item.category)
      )
    )
    .orderBy(desc(story.publishedAt))
    .limit(4);
  return withAttachedImages(rows);
}

/**
 * One published story plus its related list — everything
 * /story/[slug] renders, in a single round trip.
 *
 * Bundling the two deliberately: the frontend is a network hop away now, so
 * two sequential requests would add two round trips to every article view. The
 * monolith could afford separate queries because they were in-process.
 */
export async function getPublicStory(slug: string) {
  const item = await findPublished(slug);
  if (!item) throw new HttpError(404, "Story not found.");

  const related = await findRelated(item);

  return { story: item, related };
}

/**
 * Increments a story's view counter. Feeds the homepage "Most read" section.
 *
 * Separate from the read, and called from `after()` in the route handler so a
 * slow write never delays the response — the same arrangement the page used,
 * just moved. A missed count must never break reading, hence the swallow.
 */
export async function countStoryView(storyId: string): Promise<void> {
  try {
    await db
      .update(story)
      .set({ viewCount: sql`${story.viewCount} + 1` })
      .where(eq(story.id, storyId));
  } catch {
    // Deliberately ignored.
  }
}
