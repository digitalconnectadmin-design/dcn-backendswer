import "../envConfig";

import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";

/**
 * Works out which route to Neon your network actually allows.
 *
 * Run this when `npm run db:migrate` times out, before changing anything else.
 * Neon is reachable three different ways and they fail independently, so a
 * single ETIMEDOUT tells you almost nothing on its own:
 *
 *   HTTPS  :443   `drizzle-orm/neon-http`  ← what the app uses at runtime
 *   WSS    :443   `@neondatabase/serverless` over WebSocket  ← what drizzle-kit
 *                 falls back to when `pg` isn't installed
 *   TCP    :5432  `pg` / node-postgres  ← what migrations should use
 *
 * `npm run db:check`
 */

const TIMEOUT_MS = 8000;

type Result = { label: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(label: string, ok: boolean, detail: string) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

function parse(url: string | undefined, which: string) {
  if (!url) {
    console.log(`\n${which} is not set.`);
    return null;
  }
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database: u.pathname.replace(/^\//, "") || "(none)",
      user: u.username || "(none)",
      hasPassword: !!u.password,
      pooled: u.hostname.includes("-pooler"),
    };
  } catch {
    console.log(`\n${which} is not a valid URL.`);
    return null;
  }
}

/** Can we open a plain TCP socket to host:port? */
function tcp(host: string, port: number): Promise<Result> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ label: `TCP ${host}:${port}`, ok, detail });
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => done(true, "connected"));
    socket.once("timeout", () => done(false, `no response in ${TIMEOUT_MS}ms`));
    socket.once("error", (e) => done(false, (e as NodeJS.ErrnoException).code ?? e.message));
    socket.connect(port, host);
  });
}

/** Can we complete a TLS handshake on :443? Both HTTPS and WSS need this. */
function tls443(host: string): Promise<Result> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      socket.destroy();
      resolve({ label: `TLS ${host}:443`, ok: true, detail: "handshake ok" });
    });
    socket.setTimeout(TIMEOUT_MS);
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ label: `TLS ${host}:443`, ok: false, detail: `no response in ${TIMEOUT_MS}ms` });
    });
    socket.once("error", (e) => {
      socket.destroy();
      resolve({
        label: `TLS ${host}:443`,
        ok: false,
        detail: (e as NodeJS.ErrnoException).code ?? e.message,
      });
    });
  });
}

async function main() {
  console.log("Neon connectivity check\n" + "=".repeat(60));

  const appUrl = process.env.DATABASE_URL;
  const migUrl = process.env.MIGRATION_DATABASE_URL ?? appUrl;

  const app = parse(appUrl, "DATABASE_URL");
  const mig = parse(migUrl, "MIGRATION_DATABASE_URL");
  if (!app || !mig) process.exit(1);

  console.log(`\nDATABASE_URL            host=${app.host}`);
  console.log(`                        db=${app.database} user=${app.user} password=${app.hasPassword ? "set" : "MISSING"} pooled=${app.pooled}`);
  console.log(`MIGRATION_DATABASE_URL  host=${mig.host}  pooled=${mig.pooled}`);

  if (mig.pooled) {
    console.log(
      "\n  note: the migration URL is the POOLED host. Migrations should use the\n" +
        "        direct host — the same string with '-pooler' removed."
    );
  }

  // ---- DNS -------------------------------------------------------------
  console.log("\nDNS");
  for (const host of new Set([app.host, mig.host])) {
    try {
      const addrs = await dns.lookup(host, { all: true });
      record(`resolve ${host}`, true, addrs.map((a) => a.address).join(", "));
    } catch (e) {
      record(`resolve ${host}`, false, e instanceof Error ? e.message : "failed");
    }
  }

  // ---- transports ------------------------------------------------------
  console.log("\nTransports");
  for (const r of await Promise.all([
    tls443(app.host),
    tcp(mig.host, mig.port),
  ])) {
    record(r.label, r.ok, r.detail);
  }

  // ---- real queries ----------------------------------------------------
  console.log("\nQueries");

  // HTTP — what the app uses.
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(appUrl!);
    const rows = (await sql`select version()`) as { version: string }[];
    record("neon-http (the app's driver)", true, rows[0].version.split(",")[0]);
  } catch (e) {
    record("neon-http (the app's driver)", false, e instanceof Error ? e.message : "failed");
  }

  // pg — what migrations use.
  try {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: migUrl, max: 1, connectionTimeoutMillis: TIMEOUT_MS });
    const { rows } = await pool.query("select current_database() as db");
    await pool.end();
    record("pg over TCP (the migration driver)", true, `connected to ${rows[0].db}`);
  } catch (e) {
    record("pg over TCP (the migration driver)", false, e instanceof Error ? e.message : "failed");
  }

  // ---- verdict ---------------------------------------------------------
  const http = results.find((r) => r.label.startsWith("neon-http"))?.ok;
  const tcpq = results.find((r) => r.label.startsWith("pg over TCP"))?.ok;

  console.log("\n" + "=".repeat(60));
  if (http && tcpq) {
    console.log("Both routes work. `npm run db:migrate` should succeed.");
  } else if (http && !tcpq) {
    console.log(
      "HTTPS works, TCP 5432 does not — your network blocks the Postgres port.\n" +
        "The app will run fine. For migrations, use the Neon SQL Editor in your\n" +
        "browser: see TROUBLESHOOTING.md, 'Applying migrations without a direct\n" +
        "connection'."
    );
  } else if (!http && tcpq) {
    console.log(
      "TCP works but HTTPS to Neon does not, which is unusual. Migrations will\n" +
        "run; the app won't. Re-check DATABASE_URL against the Neon console."
    );
  } else {
    console.log(
      "Neither route reached Neon. That points at the connection string or the\n" +
        "project rather than at a blocked port — the same credentials are failing\n" +
        "over two independent transports.\n\n" +
        "  - Copy the string again from the Neon console (Connection Details).\n" +
        "  - Check the project still exists and isn't past its limits.\n" +
        "  - If DNS resolved above but nothing connected, try another network;\n" +
        "    a VPN or corporate filter is the usual cause."
    );
  }
  process.exit(http && tcpq ? 0 : 1);
}

main();
