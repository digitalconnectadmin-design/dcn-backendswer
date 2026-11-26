import { eq, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { pollOption, pollVote } from "@/db/schema";

/**
 * Poll reads, ported out of `app/(cms)/admin/polls/actions.ts`.
 *
 * Only `getPollResults` is here so far, because the public homepage needs it:
 * `lib/homepage-data.ts` imported it straight from the admin action file,
 * which is a dependency from the public site into the CMS that only worked
 * because they shared a process. Pulling it into a service breaks that and is
 * where the rest of the polls actions will land when polls get ported.
 */
export async function getPollResults(pollId: string) {
  return db
    .select({
      optionId: pollOption.id,
      label: pollOption.label,
      position: pollOption.position,
      votes: sql<number>`count(${pollVote.id})::int`,
    })
    .from(pollOption)
    .leftJoin(pollVote, eq(pollVote.pollOptionId, pollOption.id))
    .where(eq(pollOption.pollId, pollId))
    .groupBy(pollOption.id, pollOption.label, pollOption.position)
    .orderBy(pollOption.position);
}
