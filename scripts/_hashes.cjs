/**
 * Prints the bookkeeping rows drizzle would write for each migration.
 *
 * Needed only when applying migrations by hand — through the Neon SQL Editor,
 * say, because your network blocks port 5432. Running the SQL yourself leaves
 * drizzle's tracking table empty, so the next `db:migrate` would try to
 * re-apply everything and fail on "already exists".
 *
 * The hashes in TROUBLESHOOTING.md came from this script. Re-run it if you
 * ever edit a migration file, since the hash is over the file's exact bytes.
 *
 *   node scripts/_hashes.cjs
 *
 * This mirrors `readMigrationFiles` and `migrate` in drizzle-orm 1.0.0-rc.4:
 * the hash is SHA-256 of the whole migration.sql, and created_at is the
 * folder's leading 14-digit timestamp read as UTC.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FOLDER = path.join(__dirname, "..", "migrations");

const toMillis = (d) =>
  Date.UTC(
    +d.slice(0, 4),
    +d.slice(4, 6) - 1,
    +d.slice(6, 8),
    +d.slice(8, 10),
    +d.slice(10, 12),
    +d.slice(12, 14)
  );

const migrations = fs
  .readdirSync(FOLDER)
  .map((name) => ({ name, file: path.join(FOLDER, name, "migration.sql") }))
  .filter((m) => fs.existsSync(m.file))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log(`CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint,
  name text,
  applied_at timestamp with time zone DEFAULT now()
);
`);

for (const m of migrations) {
  const sql = fs.readFileSync(m.file).toString();
  const hash = crypto.createHash("sha256").update(sql).digest("hex");
  console.log(`insert into drizzle.__drizzle_migrations ("hash", "created_at", "name")`);
  console.log(`  values ('${hash}', ${toMillis(m.name.slice(0, 14))}, '${m.name}');\n`);
}

console.error("-- apply the migration.sql files first, in this order:");
for (const m of migrations) {
  const sql = fs.readFileSync(m.file).toString();
  const statements = sql.split("--> statement-breakpoint").length;
  console.error(`--   migrations/${m.name}/migration.sql  (${statements} statements)`);
}
