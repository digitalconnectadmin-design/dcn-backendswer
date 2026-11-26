# dcn-backend

The Digital Connect News API. Route handlers only — no pages, no React
components, no UI. Deploys to Render, talks to Neon Postgres.

Its counterpart is `dcn-frontend`. The migration plan for both is in
`../PORTING.md`.

---

## Running it

```bash
cp .env.example .env     # DATABASE_URL, BETTER_AUTH_SECRET, CORS_ORIGINS at minimum
npm install
npm run dev              # :4000
```

```bash
curl localhost:4000/api/v1/health
```

That checks the database too, so it distinguishes "the service is down" from
"the service is up and misconfigured" — which look identical from a browser.

### Scripts

| | |
|---|---|
| `npm run dev` | dev server on :4000 |
| `npm run build` / `start` | production |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | generate a migration from schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed` | seed data (`scripts/seed.ts`) |

---

## Layout

```
app/
  route.ts                     GET / — service identity, so the Render URL
                                 answers something useful in a browser
  api/
    auth/[...all]/             better-auth: sign in/out, sessions, admin plugin
    v1/
      health/                  liveness + database reachability
      me/                      who the bearer token belongs to, and what they can do
      categories/              the worked example (see ../PORTING.md §3)
      public/                  unauthenticated reads for the public site
      cron/publish-scheduled/  hit by Render Cron every 5 minutes
      image-proxy/             hotlink-protected news photos
      social/oauth/[platform]/start/
    social/oauth/*/callback/   platform redirect targets — NOT under /v1, see below
    broadcast/                 CG state + studio signalling, ported verbatim
    uploadthing/               upload authorisation and recording

lib/
  api/        the split's own plumbing: http, cors, guard, body, oauth-state, frontend
  services/   business logic lifted out of the old action files
  <the rest>  copied unchanged from the monolith — see below

db/           schema.ts, drizzle.ts — unchanged
migrations/   unchanged
proxy.ts      CORS safety net (Next 16's renamed middleware.ts)
```

### What `lib/` is

Most of it came across **byte-identical** from the monolith:
`lib/social/` (6 platforms + OAuth), `lib/pipeline/`, `lib/kanban/`,
`lib/nm-desk/`, `lib/pitches/`, `lib/broadcast/`, `lib/live/`, `lib/ai-feed/`,
and the homepage and ticker query modules.

That was the pleasant surprise of this migration. None of it imports
`next/headers`, calls `revalidatePath`, or carries a `"use server"` directive —
it is plain TypeScript over Drizzle. So the ~16,000 lines of business logic
that make this a newsroom CMS rather than a CRUD app did not have to be
rewritten. They just moved.

Three files were changed deliberately, and each is commented at the top saying
why:

- **`lib/site.ts`** — now returns *this service's* URL rather than the public
  site's. Every `lib/social/oauth/*` module builds its `redirect_uri` from it,
  so redefining this one file carries all seven flows across.
- **`lib/auth.ts`** — gained better-auth's `bearer()` plugin and
  `trustedOrigins`.
- **`lib/social/oauth/x.ts`** — one optional parameter, so X's PKCE verifier
  can be created before the signed state that carries it.

`lib/content-actions.ts` is gone, split three ways: the auth guard to
`lib/api/guard.ts`, the FormData helpers to `lib/api/body.ts`, `uniqueSlug` to
`lib/services/shared.ts`.

---

## Conventions

### Every response is an envelope

```jsonc
{ "ok": true,  "data": { … } }
{ "ok": false, "error": { "message": "…", "code": "…", "fields": { … } } }
```

Deliberately the same shape the server actions returned
(`{ ok: true, message } | { ok: false, message }`), so porting a component is
mostly changing where the result comes from and not how it's checked.

Codes the frontend branches on: `unauthenticated`, `forbidden`, `not_found`,
`validation`, `must_change_password`, `internal`, plus `<platform>_not_configured`.

### Every method is wrapped in `handler()`

```ts
export const GET = handler(async (request) => { … });
```

Without it a thrown error becomes Next's HTML error page, which the frontend's
`fetch` tries to parse as JSON — so the real problem surfaces as a parse error.
`handler()` turns an `HttpError` into the envelope above and anything else into
a 500 with the message hidden in production.

### The guard goes inside the method

```ts
export const POST = handler(async (request) => {
  await requireNewsroomManager(request);
  …
});
```

Not in middleware. `proxy.ts` handles CORS and nothing else — a middleware that
looked like an auth gate would invite someone to skip the real check.

Guards available: `requireSession`, `requireActiveSession`,
`requireNewsroomManager`, `requireAdmin`, `requireCronSecret`.

One behavioural difference from the monolith worth knowing: these **throw 401**
where `requireNewsroomManager` used to `redirect("/login")`. A 302 to an HTML
login page arrives at a `fetch` as an opaque success with unparseable content.
The frontend decides where to send the reader; routing is its job.

`requireActiveSession` is new. The monolith's `(cms)` layout redirected
users holding a temporary password to `/change-password`, which also meant no
action could run for them. That layout is on the frontend now, so the check has
to be enforced here too or it would be advisory.

### Mutations name the paths they invalidate

```ts
return ok(request, { message: "…", revalidate: ["/admin/categories", "/"] });
```

Replaces `revalidatePath`, which has nothing to invalidate here. See
`../PORTING.md` §2.3.

### Request bodies take JSON or multipart

`readFields(request)` returns a `Fields` bag either way, and
`str` / `optionalStr` / `bool` / `num` / `parseDoc` / `strList` work on it with
the same signatures the `FormData` versions had — so a ported action body
usually needs no edits beyond its parameter type.

---

## CORS

The thing most likely to go wrong, so: origins come from `CORS_ORIGINS`
(comma-separated, no trailing slashes). Localhost ports are allowed
automatically in development only.

`Access-Control-Allow-Origin` echoes the request's origin rather than using
`*`, because `*` is incompatible with `Allow-Credentials`. `set-auth-token` is
in `Expose-Headers` — that is how the frontend receives the session token, and
without it sign-in appears to succeed while leaving the frontend with nothing
to store.

Set in two places, both reading `lib/api/cors.ts`: per response via
`lib/api/http.ts`, and as a blanket safety net in `proxy.ts` (which also
answers preflights, and adds the headers to the broadcast routes that were
ported verbatim and build their own responses).

---

## OAuth

Six platforms. The flow was redesigned for the split — a browser navigation
can't carry an `Authorization` header, so the identity moved into a signed
`state` parameter. `lib/api/oauth-state.ts` explains it in full;
`../PORTING.md` §5 has the short version and the porting notes for the five
platforms still to do.

**Callback paths stay at `/api/social/oauth/<platform>/callback`** — not under
`/v1` — because they're registered in six platform developer consoles.

`BETTER_AUTH_URL` (or `API_BASE_URL`) must exactly match the redirect URI
registered in each console, including scheme and no trailing slash. A mismatch
is the usual cause of `redirect_uri_mismatch`.

---

## Deploying to Render

`render.yaml` is a complete blueprint — web service plus the publishing cron.
Dashboard → New → Blueprint, point it at the repo.

- **Use `starter`, not free.** The free instance type sleeps after 15 minutes
  and the next request takes ~50 seconds. For a news site that's a bounce.
- **Region** should match the Neon project's. `singapore` is closest to Dhaka.
- **`healthCheckPath` is `/api/v1/health`**, which touches the database — so a
  deploy with a bad `DATABASE_URL` fails the check instead of going live and
  erroring on first use.
- **`CRON_SECRET`** is generated on the web service; copy it onto the cron job.
  Render doesn't share generated values between services.

The `output: "standalone"` option is deliberately *not* set — it's incompatible
with `next start`, which is what the blueprint's start command uses.
`next.config.ts` says what to change if you switch to Docker.

### Neon

Use the **pooled** endpoint — the hostname containing `-pooler`. The HTTP
driver opens no long-lived socket, so Render's instance count doesn't affect
your connection budget.

The driver can't do interactive transactions, and the app uses none (verified:
zero `db.transaction` calls). If a future change needs one, move that file to
`drizzle-orm/node-postgres` with a `pg` Pool — Render's persistent instances
can hold a real pool.

### Not deployed here

`relay/` from the original repo — the live-streaming relay — still needs its
own VPS. It runs ffmpeg and holds sockets open for hours. Its `setup.sh` and
README are unchanged and still apply.
