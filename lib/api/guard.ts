import { auth, type Session } from "@/lib/auth";
import { canManageNewsroom, isAdmin } from "@/lib/roles";
import { CODES, HttpError } from "@/lib/api/http";

/**
 * The API's replacement for `lib/content-actions.ts`'s
 * `requireNewsroomManager`.
 *
 * One behavioural difference worth being explicit about: the original called
 * `redirect("/login?next=…")` when there was no session. A redirect is the
 * right answer for a page render and the wrong one for an API — a 302 to an
 * HTML login page would arrive at the frontend's `fetch` as an opaque success
 * with unparseable content. So this throws a 401 and the **frontend** decides
 * to redirect. That keeps the decision about where to send the reader in the
 * half of the system that owns routing.
 *
 * The session is still verified on every single call, exactly as before.
 * Nothing trusts the frontend's word about who is signed in.
 */

/**
 * Reads the caller's session from the `Authorization: Bearer <token>` header,
 * or from a cookie if one happens to be present (same-origin debugging, OAuth
 * callbacks). better-auth's bearer plugin accepts either, so this just hands
 * it the incoming headers.
 */
export async function getSession(request: Request): Promise<Session | null> {
  // `auth.api.getSession` wants a Headers object; the incoming request's is
  // passed straight through so Authorization and Cookie both reach it.
  return (await auth.api.getSession({ headers: request.headers })) as Session | null;
}

/** Any signed-in staff account. Throws 401 otherwise. */
export async function requireSession(request: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) {
    throw new HttpError(401, "You need to sign in.", { code: CODES.UNAUTHENTICATED });
  }
  return session;
}

/**
 * Signed in *and* holding a temporary password they haven't changed yet.
 *
 * In the monolith the `(cms)` layout redirected these users to
 * /change-password, which also meant no action could run for them. The layout
 * is on the frontend now, so the check has to be enforced here too or the
 * gate would be advisory — a user could call the API directly and skip it.
 */
export async function requireActiveSession(request: Request): Promise<Session> {
  const session = await requireSession(request);
  const mustChange = (session.user as { mustChangePassword?: boolean }).mustChangePassword;
  if (mustChange) {
    throw new HttpError(403, "Change your temporary password before continuing.", {
      code: CODES.MUST_CHANGE_PASSWORD,
    });
  }
  return session;
}

/** admin or chief_editor — the newsroom-management privilege. */
export async function requireNewsroomManager(request: Request): Promise<Session> {
  const session = await requireActiveSession(request);
  if (!canManageNewsroom(session.user.role)) {
    throw new HttpError(403, "Your role can't manage this content.", { code: CODES.FORBIDDEN });
  }
  return session;
}

/** admin only — user management, role assignment, bans. */
export async function requireAdmin(request: Request): Promise<Session> {
  const session = await requireActiveSession(request);
  if (!isAdmin(session.user.role)) {
    throw new HttpError(403, "Only an admin can do that.", { code: CODES.FORBIDDEN });
  }
  return session;
}

/**
 * Shared-secret guard for the scheduler endpoint, unchanged in meaning from
 * the monolith's `CRON_SECRET` check.
 */
export function requireCronSecret(request: Request): void {
  const configured = process.env.CRON_SECRET;
  if (!configured) return; // not configured = open, same as before
  if (request.headers.get("authorization") !== `Bearer ${configured}`) {
    throw new HttpError(401, "Unauthorized.", { code: CODES.UNAUTHENTICATED });
  }
}
