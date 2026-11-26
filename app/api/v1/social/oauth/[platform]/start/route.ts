import { requireNewsroomManager } from "@/lib/api/guard";
import { handler, ok, preflight, HttpError } from "@/lib/api/http";
import { createOAuthState } from "@/lib/api/oauth-state";

import { getFacebookAuthorizeUrl, isFacebookOAuthConfigured } from "@/lib/social/oauth/facebook";
import { getInstagramAuthorizeUrl, isInstagramOAuthConfigured } from "@/lib/social/oauth/instagram";
import { getLinkedInAuthorizeUrl, isLinkedInOAuthConfigured } from "@/lib/social/oauth/linkedin";
import { getYouTubeAuthorizeUrl, isYouTubeOAuthConfigured } from "@/lib/social/oauth/youtube";
import { getTikTokAuthorizeUrl, isTikTokOAuthConfigured } from "@/lib/social/oauth/tiktok";
import { beginXAuthorize, isXOAuthConfigured } from "@/lib/social/oauth/x";
import { generateCodeVerifier } from "@/lib/social/oauth/pkce";

export const dynamic = "force-dynamic";

/**
 *   POST /api/v1/social/oauth/:platform/start
 *   → { platform, authorizeUrl }
 *
 * Replaces the six per-platform `GET .../start` routes, which were plain
 * redirects the browser followed directly.
 *
 * It is a POST that returns a URL instead of a redirect, because the role
 * check has to happen on an authenticated call, and an authenticated call
 * needs an `Authorization` header — which a browser navigation cannot carry.
 * The frontend calls this, gets a URL, and navigates to it itself:
 *
 *   const r = await api.social.startOAuth("facebook");
 *   if (r.ok) window.location.assign(r.data.authorizeUrl);
 *
 * The connecting user's identity travels inside the signed `state` parameter —
 * see lib/api/oauth-state.ts for why, and for what that does and doesn't
 * protect.
 *
 * One route for all six rather than six near-identical files: the only things
 * that differ are which authorize-URL builder to call and whether the flow
 * needs a PKCE verifier (X alone does).
 */

type Ctx = { params: Promise<{ platform: string }> };

const PLATFORMS = ["facebook", "instagram", "linkedin", "youtube", "x", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

const CONFIGURED: Record<Platform, () => boolean> = {
  facebook: isFacebookOAuthConfigured,
  instagram: isInstagramOAuthConfigured,
  linkedin: isLinkedInOAuthConfigured,
  youtube: isYouTubeOAuthConfigured,
  x: isXOAuthConfigured,
  tiktok: isTikTokOAuthConfigured,
};

export const POST = handler<Ctx>(async (request, { params }) => {
  const session = await requireNewsroomManager(request);
  const { platform } = await params;

  if (!isPlatform(platform)) {
    throw new HttpError(404, `Unknown platform "${platform}".`);
  }

  if (!CONFIGURED[platform]()) {
    // The old route handled this by redirecting with
    // `?error=<platform>_not_configured`. As an API it's a plain 400 and the
    // frontend decides how to say so.
    throw new HttpError(400, `${platform} isn't configured — add its app credentials first.`, {
      code: `${platform}_not_configured`,
    });
  }

  // X is the only PKCE flow. The verifier is generated here so it can be
  // sealed into the state *before* the authorize URL is built — the callback
  // reads it back out of the state rather than out of a cookie, because a
  // cookie set during this cross-origin POST would never be stored. See the
  // note on `existingVerifier` in lib/social/oauth/x.ts.
  if (platform === "x") {
    const verifier = generateCodeVerifier();
    const state = createOAuthState({
      userId: session.user.id,
      platform,
      extra: { verifier },
    });
    const { authorizeUrl } = await beginXAuthorize(state, verifier);
    return ok(request, { platform, authorizeUrl });
  }

  const state = createOAuthState({ userId: session.user.id, platform });

  const authorizeUrl =
    platform === "facebook"
      ? getFacebookAuthorizeUrl(state)
      : platform === "instagram"
        ? getInstagramAuthorizeUrl(state)
        : platform === "linkedin"
          ? getLinkedInAuthorizeUrl(state)
          : platform === "youtube"
            ? getYouTubeAuthorizeUrl(state)
            : getTikTokAuthorizeUrl(state);

  return ok(request, { platform, authorizeUrl });
});

export const OPTIONS = preflight;
