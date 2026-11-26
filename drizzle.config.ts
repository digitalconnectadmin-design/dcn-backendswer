import { defineConfig } from "drizzle-kit";
import "./envConfig";

/**
 * Migrations connect differently from the running app, in two ways that both
 * matter. Getting either wrong produces a timeout rather than a useful error.
 *
 * 1. **A different driver.** drizzle-kit picks whichever Postgres driver it
 *    finds installed, in this order: `pg`, `postgres`, `@vercel/postgres`,
 *    `@neondatabase/serverless`. With only the Neon driver present it falls
 *    through to that one and connects over a **WebSocket** —
 *    `wss://…neon.tech/v2` — which is a transport nothing else in this project
 *    uses and which plenty of networks drop.
 *
 *    So `pg` is a devDependency, which makes drizzle-kit use node-postgres
 *    over ordinary TCP. It also prints `Using 'pg' driver for database
 *    querying` on startup, which is the line to check if this ever misbehaves.
 *
 *    There is a second, harder reason: the migrator wraps every migration in
 *    `db.transaction(...)`, and `drizzle-orm/neon-http` cannot open a
 *    transaction at all. The HTTP driver the app uses at runtime is therefore
 *    not a candidate for migrations even in principle.
 *
 * 2. **A different endpoint.** `DATABASE_URL` is the *pooled* Neon host (the
 *    one with `-pooler`), which is right for the app: many short-lived
 *    queries, no long-held sockets. It is the wrong host for DDL. The pooler
 *    is PgBouncer in transaction mode, where session state and long
 *    transactions aren't reliable — and a migration is one long transaction
 *    full of DDL.
 *
 *    So `MIGRATION_DATABASE_URL` holds the **direct** host: the same string
 *    with `-pooler` removed. It falls back to `DATABASE_URL` so a fresh
 *    checkout still runs, but set it.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
