import { sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { handler, ok, preflight } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Liveness + database reachability.
 *
 * Render pings a health path to decide whether a deploy succeeded, and this is
 * also the first thing to curl when the frontend reports it can't reach the
 * API — it separates "the service is down" from "the service is up and CORS
 * is wrong", which look identical from the browser.
 *
 * The `select 1` matters on Render specifically: a missing or wrong
 * `DATABASE_URL` lets the process boot fine and fails on the first real
 * request, so a health check that doesn't touch Postgres would report green on
 * a deployment that can't serve anything.
 */
export const GET = handler(async (request: Request) => {
  let database = false;
  let databaseError: string | null = null;

  try {
    await db.execute(sql`select 1`);
    database = true;
  } catch (e) {
    databaseError = e instanceof Error ? e.message : "unknown error";
  }

  return ok(
    request,
    {
      service: "dcn-backend",
      status: database ? "ok" : "degraded",
      database,
      databaseError,
      uptimeSec: Math.round(process.uptime()),
      commit: process.env.RENDER_GIT_COMMIT ?? null,
      now: new Date().toISOString(),
    },
    { status: database ? 200 : 503 }
  );
});

export const OPTIONS = preflight;
