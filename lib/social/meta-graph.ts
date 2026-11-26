import { GRAPH_API_VERSION } from "@/lib/social/oauth/meta";
import { SocialApiError } from "@/lib/social/types";
import { readJson } from "@/lib/social/http";

export const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_API_VERSION}`;

type GraphError = {
  message?: string;
  error_user_msg?: string;
  code?: number;
};

/**
 * Meta error codes only a reconnect can fix: 190 (token expired/revoked),
 * 102 (session), 10 and 200–299 (a permission the token doesn't carry).
 */
function isAuthCode(code: number | undefined): boolean {
  if (code === undefined) return false;
  return code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300);
}

export function metaError(data: Record<string, unknown> | null, status: number, what: string): SocialApiError {
  const err = (data?.error ?? null) as GraphError | null;
  // error_user_msg is the human-readable sentence Meta shows its own users;
  // prefer it over the developer-facing `message` when present.
  const detail = err?.error_user_msg || err?.message;
  return new SocialApiError(detail ? `${what}: ${detail}` : `${what} (HTTP ${status}).`, isAuthCode(err?.code));
}

export async function graphPost(url: string, params: Record<string, string>, what: string) {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  const data = await readJson(res);
  if (!res.ok || (data && "error" in data)) throw metaError(data, res.status, what);
  return data ?? {};
}

export async function graphGet(url: string, params: Record<string, string>, what: string) {
  const res = await fetch(`${url}?${new URLSearchParams(params).toString()}`);
  const data = await readJson(res);
  if (!res.ok || (data && "error" in data)) throw metaError(data, res.status, what);
  return data ?? {};
}

/** Graph sometimes returns permalinks as site-relative paths ("/reel/123"). */
export function absoluteFacebookUrl(link: unknown): string | null {
  if (typeof link !== "string" || !link) return null;
  return link.startsWith("http") ? link : `https://www.facebook.com${link.startsWith("/") ? "" : "/"}${link}`;
}
