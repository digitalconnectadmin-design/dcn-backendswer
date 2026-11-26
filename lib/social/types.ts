import type { socialPlatformEnum } from "@/db/schema";
import type {
  SocialContentType,
  SocialMediaItem,
  SocialPostOptions,
} from "@/lib/social/content";

export type SocialPlatform = (typeof socialPlatformEnum.enumValues)[number];

export interface SocialConnectionRecord {
  id: string;
  platform: SocialPlatform;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  /**
   * Called the moment a publisher refreshes the token, before it does
   * anything else. X rotates refresh tokens on every use, so a refresh
   * followed by a failed post must still be saved — otherwise the old,
   * now-dead refresh token stays on the row and the account silently needs
   * reconnecting.
   */
  onTokenRefresh?: (tokens: RefreshedToken) => Promise<void>;
}

export type RefreshedToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

/**
 * Everything one account needs to publish one item. Built by the composer
 * (or the legacy cross-post path) and stored on the `social_post` row, so a
 * retry re-sends exactly the same request.
 */
export interface PublishRequest {
  contentType: SocialContentType;
  caption: string;
  /** YouTube title; ignored elsewhere. */
  title: string | null;
  /** The story's URL — becomes a link-preview post where the platform has one. */
  linkUrl: string | null;
  media: SocialMediaItem[];
  thumbnailUrl: string | null;
  options: SocialPostOptions;
}

export interface PublishResult {
  externalPostId: string;
  /** Public URL of the created item as reported by the platform, when available. */
  permalink?: string | null;
  /**
   * Published, but something the editor should know — e.g. Facebook
   * reporting a Reel's permalink under /stories/, or a thumbnail YouTube
   * refused. Shown next to the success tick, never silently dropped.
   */
  warning?: string | null;
  /**
   * Set when the publisher had to refresh an expired access token before
   * posting — the orchestrator persists this back onto the connection row
   * so the next publish doesn't need to refresh again.
   */
  refreshedToken?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  };
}

/** Profile details shown on an account card. Any field may be unavailable. */
export interface AccountProfile {
  label?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  followerCount?: number | null;
  accountType?: string | null;
  refreshedToken?: PublishResult["refreshedToken"];
}

/**
 * Thrown by publishers for every platform error. `authProblem` marks the
 * failures that only a reconnect can fix (expired/revoked token, a missing
 * permission) — the orchestrator flags the account "Action required" for
 * those instead of treating them like a one-off content rejection.
 */
export class SocialApiError extends Error {
  readonly authProblem: boolean;
  constructor(message: string, authProblem = false) {
    super(message);
    this.name = "SocialApiError";
    this.authProblem = authProblem;
  }
}

/**
 * One implementation per platform. `publish` dispatches on
 * `request.contentType` to a separate code path per type — a Reel and a
 * Story never share an endpoint. `contentTypes` must match
 * PLATFORM_CONTENT_OPTIONS in lib/social/content.ts.
 */
export interface SocialPublisher {
  platform: SocialPlatform;
  contentTypes: readonly SocialContentType[];
  publish(request: PublishRequest, connection: SocialConnectionRecord): Promise<PublishResult>;
  fetchProfile(connection: SocialConnectionRecord): Promise<AccountProfile>;
}
