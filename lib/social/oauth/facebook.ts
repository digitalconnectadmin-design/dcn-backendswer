import { createMetaOAuthHelpers, isMetaOAuthConfigured } from "@/lib/social/oauth/meta";

/*
 * `publish_video` is the Live Video API's own permission — `pages_manage_posts`
 * covers feed posts and uploaded video, but not `POST /{page-id}/live_videos`.
 * It requires App Review before it works for anyone outside the app's own
 * developers and testers, so a Page connected before this scope was added has
 * to be **disconnected and reconnected** for Live to work: Meta does not grant
 * a new permission to a token that already exists.
 */
const FACEBOOK_SCOPES =
  "pages_show_list,pages_read_engagement,pages_manage_posts,publish_video";

const helpers = createMetaOAuthHelpers(
  "/api/social/oauth/facebook/callback",
  FACEBOOK_SCOPES
);

export const isFacebookOAuthConfigured = isMetaOAuthConfigured;
export const getFacebookAuthorizeUrl = helpers.getAuthorizeUrl;
export const exchangeCodeForUserToken = helpers.exchangeCodeForUserToken;
export const exchangeForLongLivedUserToken = helpers.exchangeForLongLivedUserToken;
export const fetchManagedPages = helpers.fetchManagedPages;
export type { FacebookPage } from "@/lib/social/oauth/meta";
