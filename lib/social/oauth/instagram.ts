import { createMetaOAuthHelpers, isMetaOAuthConfigured, type FacebookPage } from "@/lib/social/oauth/meta";

const INSTAGRAM_SCOPES =
  "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish";

const helpers = createMetaOAuthHelpers(
  "/api/social/oauth/instagram/callback",
  INSTAGRAM_SCOPES
);

export const isInstagramOAuthConfigured = isMetaOAuthConfigured;
export const getInstagramAuthorizeUrl = helpers.getAuthorizeUrl;
export const exchangeCodeForUserToken = helpers.exchangeCodeForUserToken;
export const exchangeForLongLivedUserToken = helpers.exchangeForLongLivedUserToken;
export const fetchManagedPages = helpers.fetchManagedPages;
export const fetchInstagramBusinessAccount = helpers.fetchInstagramBusinessAccount;

export type InstagramAccount = {
  id: string;
  username: string;
  /** The linked Page's access token — Instagram Graph API calls authenticate with this, not a separate IG token. */
  pageAccessToken: string;
};

/** Every Instagram Business/Creator account reachable from the Pages this user manages. */
export async function fetchLinkedInstagramAccounts(
  pages: FacebookPage[]
): Promise<InstagramAccount[]> {
  const accounts: InstagramAccount[] = [];
  for (const page of pages) {
    const ig = await fetchInstagramBusinessAccount(page);
    if (ig) {
      accounts.push({ id: ig.id, username: ig.username, pageAccessToken: page.access_token });
    }
  }
  return accounts;
}
