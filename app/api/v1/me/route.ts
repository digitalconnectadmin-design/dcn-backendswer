import { getSession } from "@/lib/api/guard";
import { handler, ok, preflight } from "@/lib/api/http";
import { canManageNewsroom, isAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Who the bearer token belongs to, and what they're allowed to do.
 *
 * This is what replaces the `auth.api.getSession()` call that opened every
 * page in the `(cms)` route group. The frontend's admin layout calls it once
 * per render and uses the answer to decide between the shell, a redirect to
 * /login, and a redirect to /change-password.
 *
 * It deliberately returns `{ user: null }` with a 200 rather than a 401 for an
 * absent or expired token. "Nobody is signed in" is a perfectly good answer to
 * "who am I", and making it a 200 means the frontend layout doesn't have to
 * treat its own first render as an error case.
 *
 * The permission booleans are computed here rather than on the frontend so
 * `lib/roles.ts` has exactly one home. If the frontend recomputed them it
 * would need its own copy of the role table, and the two would drift the first
 * time a role was added.
 */
export const GET = handler(async (request: Request) => {
  const session = await getSession(request);

  if (!session) {
    return ok(request, { user: null, can: null });
  }

  const user = session.user as typeof session.user & {
    mustChangePassword?: boolean;
    role?: string | null;
    banned?: boolean | null;
    banReason?: string | null;
  };

  return ok(request, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      role: user.role ?? null,
      banned: user.banned ?? false,
      banReason: user.banReason ?? null,
      mustChangePassword: user.mustChangePassword ?? false,
      createdAt: user.createdAt,
    },
    can: {
      manageNewsroom: canManageNewsroom(user.role),
      publish: canManageNewsroom(user.role),
      manageUsers: isAdmin(user.role),
    },
    session: {
      expiresAt: session.session.expiresAt,
    },
  });
});

export const OPTIONS = preflight;
