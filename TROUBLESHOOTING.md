# Troubleshooting

## `db:migrate` times out (ETIMEDOUT)

```
Warning  '@neondatabase/serverless' can only connect to remote Neon/Vercel
         Postgres/Supabase instances through a websocket
[⣯] applying migrations...
AggregateError [ETIMEDOUT]
  _url: 'wss://ep-….c-9.us-east-2.aws.neon.tech/v2'
[✗] Error during migration: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
```

Two separate problems, stacked. The warning is the clue — note the `wss://`.

### Problem 1: the wrong driver (fixed in this version)

drizzle-kit picks whichever Postgres driver it finds installed, in this order:

```
pg  →  postgres  →  @vercel/postgres  →  @neondatabase/serverless
```

The first version of this project shipped only `@neondatabase/serverless`, so
drizzle-kit fell through to the last entry and connected over a **WebSocket** —
a transport nothing else in this project uses and which plenty of networks
drop.

`pg` is now a devDependency, so drizzle-kit uses node-postgres over ordinary
TCP. Confirm it on the next run; the line should read:

```
Using 'pg' driver for database querying        ← right
Using '@neondatabase/serverless' driver …      ← wrong, pg isn't installed
```

If you still see the second, run `npm install`.

There is a second reason the Neon driver can never do this job: the migrator
wraps each migration in `db.transaction(...)`, and `drizzle-orm/neon-http`
cannot open a transaction at all. The HTTP driver the app uses at runtime is
not a candidate for migrations even in principle.

### Problem 2: the wrong endpoint (also fixed)

`DATABASE_URL` is the **pooled** host — right for the app, wrong for DDL. The
pooler is PgBouncer in transaction mode, where session state and long
transactions aren't reliable, and a migration is one long transaction full of
DDL.

So set `MIGRATION_DATABASE_URL` to the **direct** host: the same string with
`-pooler` removed.

```
pooled (app):        ep-lively-silence-becr0ixp-pooler.c-9.us-east-2.aws.neon.tech
direct (migrations): ep-lively-silence-becr0ixp.c-9.us-east-2.aws.neon.tech
```

### Then: find out what your network allows

```bash
npm run db:check
```

It tests DNS, TLS on :443, TCP on :5432, and runs a real query through both
drivers. Neon is reachable three ways and they fail independently, so one
ETIMEDOUT on its own tells you almost nothing.

| What it says | What it means | What to do |
|---|---|---|
| both routes work | nothing left to fix | `npm run db:migrate` |
| HTTPS works, TCP 5432 doesn't | your network blocks the Postgres port — common on home ISPs and most corporate networks | the app runs fine; apply migrations in the browser (below) |
| neither works | the connection string or the project, not a blocked port — the same credentials failed over two independent transports | re-copy the string from the Neon console; check the project exists and isn't suspended; try another network |
| DNS resolves but nothing connects | a filter or VPN in the path | try tethering to a phone to confirm |

A quick independent check that the database itself is healthy — this uses
HTTPS, so it works even when 5432 is blocked:

```bash
npm run dev
curl localhost:4000/api/v1/health
```

`{"database": true}` means the credentials and the project are fine and only
the TCP path is the problem.

---

## Applying migrations without a direct connection

When port 5432 is blocked, the Neon SQL Editor works — it's a web page, so it
only needs HTTPS. The catch is that drizzle tracks what it has applied in a
table, and running the SQL by hand leaves that table empty; the next
`db:migrate` would then try to re-apply everything and fail on
`already exists`.

So do both halves.

### 1. The schema

Neon console → your project → **SQL Editor**. Paste the contents of each file
in this order, running each one fully before the next:

```
migrations/20260812191002_ancient_eternity/migration.sql      (70 statements)
migrations/20261008125519_worthless_sugar_man/migration.sql   (246 statements)
```

The `--> statement-breakpoint` comments are drizzle's own separators. Postgres
ignores them, so paste each file whole rather than splitting on them.

### 2. The bookkeeping

Then run this. The hashes are SHA-256 of each `migration.sql` exactly as
shipped — if you edit a migration file, they no longer match and you'd need to
recompute (`node scripts/_hashes.cjs`).

```sql
CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint,
  name text,
  applied_at timestamp with time zone DEFAULT now()
);

insert into drizzle.__drizzle_migrations ("hash", "created_at", "name")
  values ('65216fe25d60a8e32cdebd5aaabc4f995715255fd9056266c7b19ab5976ecb18',
          1786561802000, '20260812191002_ancient_eternity');

insert into drizzle.__drizzle_migrations ("hash", "created_at", "name")
  values ('5c3d0ef602f0af754acaa826ca1133a1ead23d28bdb15d2e47271a0f62925eef',
          1791464119000, '20261008125519_worthless_sugar_man');
```

### 3. Check it took

```sql
select name, applied_at from drizzle.__drizzle_migrations order by id;
select count(*) from information_schema.tables where table_schema = 'public';
```

74 tables, two migration rows. After that `npm run db:migrate` reports nothing
to do, which is how you know the bookkeeping is right.

### Then seed, if this is a fresh database

`npm run seed` goes over HTTPS (it uses the app's driver), so it works with
5432 blocked.

---

## A note on where this matters

The blocked port only affects **your laptop**. Render's network has no such
restriction, so migrations run normally from there:

```bash
# Render dashboard → your service → Shell
npm run db:migrate
```

That's the better long-term answer if your ISP blocks 5432 — the migration
runs next to the database rather than from Dhaka, and the Shell tab is on the
starter plan.

---

## Other things that go wrong

### Frontend says "couldn't reach the API"

Is the backend up? Is `API_BASE_URL` right, with no trailing slash? Try
`curl localhost:4000/api/v1/health` directly to tell the two apart.

### CORS error in the browser console

`CORS_ORIGINS` on the backend must list the frontend's origin exactly. Localhost
ports are allowed automatically in development only.

A client component calling the backend directly instead of going through
`/api/bff` produces the same error — check the import is from
`*.browser.ts`.

### Login fails with 403 "Missing or null Origin"

```
POST http://localhost:3000/api/session 403 (Forbidden)
{"ok":false,"error":{"message":"Missing or null Origin"}}
```

better-auth runs a CSRF middleware on its POST endpoints. Simplified:

```
if (request has a Cookie header)        → validate Origin
if (any Sec-Fetch-* header present)     → validate Origin, forced
if (Origin or Referer present)          → validate Origin, forced
```

A forced validation with no `Origin` and no `Referer` throws
`MISSING_OR_NULL_ORIGIN`.

The trap is the second branch: **Node's own `fetch` adds
`sec-fetch-mode: cors` to every request.** Undici sets it internally — it
isn't something the calling code asked for and it can't be removed. So a
server-to-server call that looks header-free actually trips the check, and a
perfectly valid sign-in is rejected. Browsers never hit this, because a
browser that sends `Sec-Fetch-*` also sends `Origin`.

Fixed in the frontend's `/api/session` and `/api/register`, which now send an
`Origin` header. If you write any other server-side call to a `/api/auth/*`
endpoint, it needs one too:

```ts
headers: {
  "content-type": "application/json",
  origin: request.headers.get("origin") ?? siteUrl(),
}
```

Forwarding the browser's own `Origin` is the secure choice, not the lax one:
a cross-site POST arrives with that site's origin, gets forwarded, and
better-auth rejects it against `trustedOrigins`. Hard-coding your own origin
would launder it into a trusted-looking request.

Whatever value you send must be in the backend's `CORS_ORIGINS`, or the answer
becomes `INVALID_ORIGIN` instead.

### Sign-in succeeds, then bounces back to /login

Either `set-auth-token` is missing from the backend's
`access-control-expose-headers` (the frontend's `/api/session` names this case
explicitly in its error message), or `router.refresh()` is missing after
`router.replace()` on the login page.

### Login crashes with `SyntaxError: Unexpected token '<', "<!DOCTYPE "...`

```
⨯ SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
    at POST (app/api/session/route.ts)
 POST /api/session 500
```

The backend answered with an **HTML page** where JSON was expected, and the
first version of `/api/session` called `JSON.parse` on it unguarded, so the
route threw and returned an opaque 500.

Fixed: both `/api/session` and `/api/register` now go through
`lib/api/auth-upstream.ts`, which reports the problem instead of throwing and
logs the first 120 characters of the body to this app's console. The HTML is
the diagnosis — it means the request reached something that wasn't this API.
Usually one of:

| HTML from | Tell-tale | Fix |
|---|---|---|
| the frontend itself | the response is a 404 and the HTML is your own 404 page | `API_BASE_URL` is pointing at this app — point it at the backend |
| the backend's dev error overlay | the backend's own terminal shows a stack trace | fix that error; it is the real one |
| a proxy, tunnel or captive portal | the HTML is nobody's you recognise | check `API_BASE_URL` and any VPN |

The message you now get names `API_BASE_URL` and its current value, so the
first row diagnoses itself.

### Login hangs, or /admin bounces back and forth with /login

Two separate faults, both fixed, both worth knowing about.

**The hang** was a missing timeout. A backend that accepted the connection and
then stalled — a sleeping Render instance, a Neon compute waking up — left the
login button spinning with nothing to report. There is now a 20-second timeout
and a distinct message for it.

**The bounce** was a redirect loop between two rules that each looked
reasonable alone:

```
/admin  →(layout: /api/v1/me returned no user)→  /login
/login  →(proxy.ts: a session cookie exists)→    /admin
```

With a stale token, or with the API unreachable, that ran until the browser
gave up. From the outside it looks like a hang, and like being unable to reach
any page.

The fix has two halves:

- `viewer()` now reports whether the API was **reachable** at all, so the
  layout can tell "not signed in" from "couldn't ask". An unreachable API
  renders an explanation (`components/admin/api-unreachable.tsx`) instead of
  redirecting — an honest dead end beats a cycle.
- When it *is* a genuine "not signed in", the layout redirects to
  `/login?session=expired`, and `proxy.ts` treats that marker as "the cookie
  you hold is no good": it clears the cookie and lets the form render rather
  than bouncing back. One redirect, then a normal login page.

If you add another `/admin/*` page, redirect to `/login?session=expired&next=…`
rather than plain `/login`, or you reintroduce the loop for that page.

### Console warning about hydration and `data-dashlane-rid`

```
A tree hydrated but some attributes of the server rendered HTML didn't match…
-   data-dashlane-rid="3486aae4e3e86fea"
```

A password manager extension — Dashlane here, but 1Password and LastPass do
the same — injecting attributes into the login form before React hydrates.
It comes from the extension, not from this code, and nothing is broken.

The login form carries `suppressHydrationWarning` to keep it out of the
console, because the noise hides real warnings. If you see it on another form,
add the same attribute there.

### "The API returned something that isn't JSON"

A wrong path — you're getting an HTML 404 page. Check the URL against `API.md`.

### OAuth: 404 after approving on the platform

`BETTER_AUTH_URL` / `API_BASE_URL` on the backend must match the redirect URI
registered in that platform's developer console, exactly — scheme included, no
trailing slash.

### `oauth_state_expired`

More than 10 minutes between clicking Connect and finishing on the platform.
Start again.

### A write succeeds but the table doesn't update

`afterWrite()` wasn't called. `router.refresh()` is what re-renders the current
page; dropping a cached path doesn't.

### First request of the day takes ~50 seconds

Render's free instance type waking up. `render.yaml` specifies `starter` for
this reason.
