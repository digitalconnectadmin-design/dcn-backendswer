# API reference

Base URL: `http://localhost:4000` in development, the Render URL in production.

Every response is an envelope:

```jsonc
{ "ok": true,  "data": { … } }
{ "ok": false, "error": { "message": "…", "code": "…", "fields": { "name": "Required." } } }
```

Authentication is `Authorization: Bearer <token>`, where the token comes from
better-auth's `set-auth-token` response header on sign-in.

**Auth column:** — none · **S** any signed-in staff · **N** newsroom manager
(admin or chief_editor) · **A** admin only · **C** cron secret

---

## Auth — `/api/auth/*`

better-auth's own handler. Not an envelope — these are better-auth's shapes.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/sign-in/email` | — | Returns the token in `set-auth-token`. The frontend's `/api/session` wraps this |
| POST | `/api/auth/sign-out` | S | Revokes the session |
| GET | `/api/auth/get-session` | S | Prefer `/api/v1/me` — it includes the permission flags |
| POST | `/api/auth/change-password` | S | `{ currentPassword, newPassword, revokeOtherSessions }` |
| * | `/api/auth/admin/*` | A | better-auth admin plugin: set role, ban, list users |

---

## Service

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/` | — | Service identity |
| GET | `/api/v1/health` | — | `{ status, database, databaseError, uptimeSec, commit, now }`. 503 when the database is unreachable |

## Session

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/v1/me` | — | `{ user, can, session }`, or `{ user: null, can: null }` with a **200** |

`can` is `{ manageNewsroom, publish, manageUsers }`, computed from
`lib/roles.ts` server-side so the frontend needs no copy of the role table.

"Nobody is signed in" is a valid answer to "who am I", hence the 200 — the
frontend's layout doesn't have to treat its first render as an error.

## Categories

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/categories?q=&page=&per=` | N | Paginated. `per` ∈ {10,25,50,100} |
| POST | `/api/v1/categories` | N | 201 |
| GET | `/api/v1/categories/parents?exclude=<id>` | N | Parent-picker options |
| GET | `/api/v1/categories/:id` | N | |
| PATCH | `/api/v1/categories/:id` | N | |
| DELETE | `/api/v1/categories/:id` | N | |

Write fields: `name` (required), `slug`, `description`, `parentId`,
`permission` (`public`\|`admin`), `iconClass`, `status` (`published`\|`draft`).

Slug collisions resolve to `-2`, `-3`… rather than throwing a constraint error.
Setting a descendant as a parent is refused with a 422 — `fields.parentId`
carries the reason.

Writes return `{ message, revalidate: ["/admin/categories", "/admin/stories", "/"] }`.

## Public reads

No auth. Cached — `s-maxage` as noted.

| Method | Path | Cache | Returns |
|---|---|---|---|
| GET | `/api/v1/public/chrome` | 60s | `{ navCategories, categoryTree, footerPages, ticker }` |
| GET | `/api/v1/public/homepage` | 30s | `{ sections, publishedAt, draftUpdatedAt, hasPublished }` |
| GET | `/api/v1/public/homepage?layout=draft` | — | **Requires N.** An unpublished layout isn't public |
| GET | `/api/v1/public/stories/:slug` | 60s | `{ story, related }`. 404 for unpublished or missing |

`chrome` bundles four queries because `(home)/layout.tsx` renders on every
public page — as separate endpoints that would add four round trips to every
story view. Group read endpoints by *what renders together*; a faithful
one-endpoint-per-query translation is the main way a split ends up slower than
the monolith it replaced.

`stories/:slug` includes the related list for the same reason, and increments
the view count in `after()` — so the count follows cache misses rather than
page views, which is why its window is short.

**Dates are ISO strings.** The frontend revives them at the boundary
(`lib/api/revive.ts` there).

## Social OAuth

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/social/oauth/:platform/start` | N | → `{ platform, authorizeUrl }`. Navigate the browser to it |
| GET | `/api/social/oauth/facebook/callback` | state | Redirects to the **frontend** |

`:platform` ∈ `facebook` · `instagram` · `linkedin` · `youtube` · `x` · `tiktok`.
400 `<platform>_not_configured` when its credentials are absent.

`start` is a POST returning a URL rather than a redirect because the role check
needs an authenticated call, and a browser navigation can't carry a header. The
callback authenticates from the signed `state` — see
`lib/api/oauth-state.ts`.

Callback error slugs, arriving as `?error=` on the frontend's settings page:
`facebook_denied`, `facebook_no_code`, `facebook_no_pages`, `unauthorized`,
`oauth_state_missing`, `oauth_state_malformed`, `oauth_state_mismatch`,
`oauth_state_expired`, `oauth_state_platform_mismatch`.

Only Facebook's callback is ported. The other five are in `../PORTING.md` §5.

## Scheduled publishing

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/cron/publish-scheduled` | C | → `{ storiesPublished, socialPostsRun, revalidate }` |

Publishes due pipeline stories, runs due social posts, and picks up queued
posts a previous run didn't finish. Safe to call concurrently — the promotion
is the claim, so of two overlapping runs exactly one enqueues each story's
cross-posts.

## Media

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET POST | `/api/uploadthing` | S | UploadThing handler. The browser uploads directly to UploadThing; this authorises and records |
| GET | `/api/v1/image-proxy?url=` | — | Not an open proxy: only URLs already stored as a story image or in the media library |

## Broadcast

Ported verbatim from the monolith, including their polling contracts.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/broadcast/cg/state` | N or `?key=` | What's on air. `?mode=version` returns just a change counter, for cheap polling |
| POST | `/api/broadcast/cg/state` | N or `?key=` | Times a due graphic off air |
| GET POST | `/api/broadcast/studio/signal` | N or `?token=` | WebRTC signalling over the database. Long-polls; media stays peer-to-peer |

The `key` and `token` query parameters exist because an OBS browser source and
a remote guest can't sign in. Treat both URLs as secrets; the CG output key is
rotatable from the graphics page.

---

## Not yet ported

253 of 260 actions. Full inventory and suggested order in `../PORTING.md` §4.
Expected paths follow the categories pattern: `/api/v1/<resource>` for the
collection, `/api/v1/<resource>/:id` for an item.
