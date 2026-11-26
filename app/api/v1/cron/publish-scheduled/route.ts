import { and, eq, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { story } from "@/db/schema";
import { claimDueIds, enqueueCrossPost, runSocialPosts } from "@/lib/social/publish";
import { requireCronSecret } from "@/lib/api/guard";
import { handler, ok, preflight } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Scheduled publishing. Ported from `app/api/cron/publish-scheduled/route.ts`
 * with the logic untouched — only the guard and the response shape changed.
 *
 * Runs everything that's due:
 *   1. Story Pipeline stories whose scheduled website publish time has come
 *      (promoted to published, then queued to the accounts chosen for them)
 *   2. social posts scheduled for a specific time (the composer's "Schedule",
 *      including per-account times)
 *   3. queued social posts nobody picked up (a run cut short by a timeout)
 *
 * Nothing here runs on its own — this route exists to be hit by an external
 * scheduler. `render.yaml` points a Render Cron Job at it every 5 minutes.
 *
 * `maxDuration` is gone from this file on purpose. On Vercel it capped the
 * function at the plan's limit (300s on Hobby) and the comment in the original
 * explained what happened to work left over. Render runs a persistent Node
 * process with no per-request ceiling, so a long video upload now simply
 * finishes. The idempotency that made the timeout survivable — the claim-then-
 * enqueue ordering below — is kept anyway: it is what stops two overlapping
 * runs double-posting, which is a hazard regardless of timeouts.
 */
export const GET = handler(async (request: Request) => {
  requireCronSecret(request);

  const dueStories = await db
    .select()
    .from(story)
    .where(
      and(
        eq(story.pipelineStatus, "scheduled"),
        isNotNull(story.scheduledFor),
        lte(story.scheduledFor, new Date()),
        // A sample story from the News Management Desk's demo toggle can never
        // go live, scheduled or otherwise. Holding a story also moves it off
        // `scheduled`, so a held story is already excluded by the first clause.
        eq(story.isDemo, false)
      )
    );

  const published: string[] = [];
  const socialIds: string[] = [];

  for (const row of dueStories) {
    /*
     * The promotion **is** the claim. Postgres re-evaluates the predicate
     * under the row lock, so of two overlapping runs exactly one gets a row
     * back and goes on to enqueue the cross-posts. Without this both runs
     * would create their own `social_post` rows: `runSocialPosts` stops a row
     * being *run* twice, but not a second set of rows being written, so the
     * story would go out twice on every platform.
     *
     * The claim comes before the enqueue on purpose: a failure in between
     * leaves a published story with no social posts, which someone can retry,
     * rather than posts for a story that is not live.
     */
    const [claimed] = await db
      .update(story)
      .set({
        status: "published",
        pipelineStatus: "published",
        // The same fields `publishNow` writes, so a story published by the
        // cron is indistinguishable from one published by hand. Leaving a past
        // `scheduledFor` on the row is a trap for the next query that reads it
        // without also checking the status.
        pipelineStage: "publish",
        scheduledFor: null,
        publishedAt: row.scheduledFor ?? new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(story.id, row.id), eq(story.pipelineStatus, "scheduled")))
      .returning({ id: story.id });
    if (!claimed) continue;

    // null = chosen before explicit selection existed → every active account;
    // [] = the editor deliberately chose none (website only).
    socialIds.push(
      ...(await enqueueCrossPost(
        { kind: "article", storyId: row.id },
        row.publishConnectionIds ?? undefined
      ))
    );
    published.push(row.id);
  }

  socialIds.push(...(await claimDueIds()));
  const uniqueIds = Array.from(new Set(socialIds));
  await runSocialPosts(uniqueIds);

  return ok(request, {
    storiesPublished: published,
    socialPostsRun: uniqueIds.length,
    /**
     * Front-page and story pages are stale the moment a scheduled story goes
     * live. The monolith didn't need to say so — `publishNow` and friends
     * called `revalidatePath` in-process, and the cron relied on the public
     * pages being `force-dynamic`.
     *
     * They're still dynamic on the frontend, so nothing here is strictly
     * required; it's reported so a scheduler (or a human reading the run
     * output) can purge a CDN in front of the frontend if one is ever added.
     */
    revalidate: published.length > 0 ? ["/", "/admin/stories", "/admin/pipeline"] : [],
  });
});

export const OPTIONS = preflight;
