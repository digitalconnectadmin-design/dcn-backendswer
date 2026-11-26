import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/drizzle";
import { user, session, account, verification } from "@/db/schema";
import { trustedOrigins } from "@/lib/api/cors";

/**
 * Backend-side auth. Same configuration as the original monolith with one
 * structural change: the **bearer plugin**.
 *
 * Why bearer instead of cookies
 * -----------------------------
 * In the monolith the browser and the auth handler shared an origin, so a
 * `SameSite=Lax` session cookie was sent automatically and nothing had to be
 * arranged. Split apart, the frontend runs on `http://localhost:3000` (or the
 * newsroom's own domain later) and this API runs on `*.onrender.com`. That is
 * a cross-site request, so the cookie would need `SameSite=None; Secure` —
 * which Chrome treats as a third-party cookie and is in the middle of phasing
 * out. A deployment that works today and silently stops working after a
 * browser update is not a deployment.
 *
 * With `bearer()` the token travels in an `Authorization` header instead, so
 * no cookie policy applies to it at all. Sign-in still goes through the usual
 * better-auth endpoints; the token comes back in the `set-auth-token`
 * response header, and the frontend sends it back on every call.
 *
 * Cookies are deliberately left enabled as well. They cost nothing here, they
 * keep better-auth's own flows (OAuth callbacks, which land on *this* origin
 * and so are same-site) working untouched, and they make it possible to hit
 * this API from a browser tab for debugging.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  // Where this API answers. better-auth builds absolute URLs (OAuth redirects,
  // email links) from this, so it has to be the public Render URL in
  // production, not localhost.
  baseURL: process.env.BETTER_AUTH_URL,

  // Browsers are told which origins may talk to this API by the CORS layer in
  // lib/api/cors.ts; better-auth keeps its own list for the same reason
  // (it rejects sign-in attempts whose Origin isn't trusted), so both read
  // from one place rather than drifting apart.
  trustedOrigins,

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },

  user: {
    additionalFields: {
      // Surfaces the column on `session.user` so the frontend's admin shell
      // can gate on it. `input: false` keeps it out of client-supplied
      // payloads — only server code can set it, so a user can't clear their
      // own forced-password-change flag by posting to an endpoint.
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },

  plugins: [
    admin({
      defaultRole: "reporter",
      adminRoles: ["admin"],
      bannedUserMessage:
        "Your account has been suspended. Contact a newsroom admin if you think this is a mistake.",
    }),

    // Must come after admin() so the token it issues carries the role fields
    // the admin plugin adds.
    bearer(),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once a day of activity
  },
});

export type Session = typeof auth.$Infer.Session;
