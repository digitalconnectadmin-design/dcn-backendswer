import { getSiteUrl } from "@/lib/site";

// Meta ships a new Graph API version roughly every 6 months, supported for
// ~2 years — bump this periodically (currently v25.0, current as of early
// 2026) rather than letting it silently age into an expired one.
const GRAPH_API_VERSION = "v25.0";

export type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
};

function requireEnv() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function isMetaOAuthConfigured() {
  return requireEnv() !== null;
}

/**
 * Facebook and Instagram both run through the same Meta app and the same
 * Graph API OAuth mechanics — only the callback path and requested scopes
 * differ. This factory gives each platform its own routes/cookies while
 * sharing the token-exchange logic.
 */
export function createMetaOAuthHelpers(callbackPath: string, scopes: string) {
  function callbackUrl() {
    return `${getSiteUrl()}${callbackPath}`;
  }

  function getAuthorizeUrl(state: string): string {
    const env = requireEnv();
    if (!env) {
      throw new Error(
        "FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not set — add a Meta app first."
      );
    }
    const params = new URLSearchParams({
      client_id: env.appId,
      redirect_uri: callbackUrl(),
      state,
      response_type: "code",
      scope: scopes,
    });
    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async function exchangeCodeForUserToken(code: string): Promise<string> {
    const env = requireEnv();
    if (!env) throw new Error("Meta OAuth is not configured.");
    const params = new URLSearchParams({
      client_id: env.appId,
      client_secret: env.appSecret,
      redirect_uri: callbackUrl(),
      code,
    });
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?${params.toString()}`
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Meta token exchange failed.");
    }
    return data.access_token as string;
  }

  /**
   * Exchanges a short-lived user token for a long-lived one (~60 days).
   * Page access tokens fetched afterwards with a long-lived user token
   * don't expire on their own, which is what makes them usable for
   * unattended auto-posting.
   */
  async function exchangeForLongLivedUserToken(
    shortLivedToken: string
  ): Promise<string> {
    const env = requireEnv();
    if (!env) throw new Error("Meta OAuth is not configured.");
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.appId,
      client_secret: env.appSecret,
      fb_exchange_token: shortLivedToken,
    });
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?${params.toString()}`
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Meta token exchange failed.");
    }
    return data.access_token as string;
  }

  async function fetchManagedPages(
    longLivedUserToken: string
  ): Promise<FacebookPage[]> {
    const params = new URLSearchParams({ access_token: longLivedUserToken });
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?${params.toString()}`
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Couldn't list Facebook Pages.");
    }
    return (data.data ?? []) as FacebookPage[];
  }

  /** The Instagram Business/Creator account linked to a Facebook Page, if any. */
  async function fetchInstagramBusinessAccount(
    page: FacebookPage
  ): Promise<{ id: string; username: string } | null> {
    const params = new URLSearchParams({
      fields: "instagram_business_account{id,username}",
      access_token: page.access_token,
    });
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${page.id}?${params.toString()}`
    );
    const data = await res.json();
    if (!res.ok || !data.instagram_business_account) return null;
    return data.instagram_business_account as { id: string; username: string };
  }

  return {
    getAuthorizeUrl,
    exchangeCodeForUserToken,
    exchangeForLongLivedUserToken,
    fetchManagedPages,
    fetchInstagramBusinessAccount,
  };
}

export { GRAPH_API_VERSION };
