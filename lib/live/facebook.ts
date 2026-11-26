/**
 * Facebook Live, via the Live Video API.
 *
 * Verified against Meta's current docs (Graph v25.0) while this was written:
 *
 * - `POST /{page-id}/live_videos` creates the broadcast and returns `id`,
 *   `stream_url` and `secure_stream_url`.
 * - **RTMPS only.** Meta stopped accepting unencrypted RTMP in November 2019,
 *   so `secure_stream_url` is the one to use and `stream_url` is ignored here.
 * - Ending is an update, not a delete: `POST /{live-video-id}` with
 *   `end_live_video=true`.
 * - `live_views` is the instant concurrent viewer count; the `comments` edge
 *   carries the comments.
 * - **Scheduling was removed.** `planned_start_time` was deprecated for all
 *   versions in December 2021, so a scheduled broadcast cannot be pre-created
 *   on Facebook — it is created at go-live. See lib/live.ts.
 *
 * Permissions: `publish_video` plus the Page scopes, and `publish_video`
 * requires App Review. Until that review passes, this works only for accounts
 * listed as developers or testers of the Meta app.
 */

import { GRAPH, graphGet, graphPost, absoluteFacebookUrl } from "@/lib/social/meta-graph";
import { SocialApiError, type SocialConnectionRecord } from "@/lib/social/types";
import type { LiveComment, LiveCreateResult, LiveStatus } from "@/lib/live/types";

/**
 * Creates the live video and returns its ingest URL.
 *
 * `status: "LIVE_NOW"` means the post appears on the Page as soon as video
 * arrives. The alternative, `UNPUBLISHED`, creates a broadcast nobody can see
 * — useful for a rehearsal, which is why `unpublished` is an option here.
 */
export async function createFacebookLive(
  connection: SocialConnectionRecord,
  input: { title: string; description?: string | null; unpublished?: boolean }
): Promise<LiveCreateResult> {
  const data = await graphPost(
    `${GRAPH}/${connection.externalAccountId}/live_videos`,
    {
      access_token: connection.accessToken,
      status: input.unpublished ? "UNPUBLISHED" : "LIVE_NOW",
      title: input.title.slice(0, 255),
      ...(input.description ? { description: input.description.slice(0, 5000) } : {}),
    },
    "Couldn't start the Facebook live video"
  );

  const id = typeof data.id === "string" ? data.id : null;
  const secure = typeof data.secure_stream_url === "string" ? data.secure_stream_url : null;

  if (!id || !secure) {
    // A response without a stream URL is not something to retry blindly — it
    // nearly always means the permission is missing rather than a transient
    // fault, and saying so is more use than "unexpected response".
    throw new SocialApiError(
      "Facebook created no stream URL. This usually means the Page's token is missing the publish_video permission — reconnect the Page after App Review approves it.",
      true
    );
  }

  return { externalVideoId: id, ingestUrl: secure, permalink: null };
}

/** The permalink only exists once Facebook has made the post, so it is read separately. */
export async function readFacebookLive(
  connection: SocialConnectionRecord,
  videoId: string
): Promise<{ status: LiveStatus; viewers: number; permalink: string | null }> {
  /*
   * `broadcast_status` is the lifecycle field; `status` is not.
   *
   * `status` describes how the video was *published* — LIVE_NOW, UNPUBLISHED,
   * SCHEDULED_* — and has no terminal value, so it still reads LIVE_NOW after
   * the broadcast is over. Reading only that field meant Facebook's end could
   * never be detected. `broadcast_status` carries LIVE / LIVE_STOPPED /
   * PROCESSING / VOD, which is what answers "is this still going".
   *
   * Asked for in the same call, with a fallback: Graph fails the *whole*
   * request for one unrecognised field, and this app has never been run
   * against a live Page from here, so a version that doesn't expose it would
   * otherwise take the viewer count and permalink down with it.
   */
  let data: Record<string, unknown>;
  try {
    data = await graphGet(
      `${GRAPH}/${videoId}`,
      {
        access_token: connection.accessToken,
        fields: "status,broadcast_status,live_views,permalink_url",
      },
      "Couldn't read the Facebook live video"
    );
  } catch (e) {
    /*
     * Retried ONLY when Graph says it doesn't know the field.
     *
     * Catching everything would turn an expired token or a rate limit into two
     * full requests with the same credentials on every poll from every tab —
     * amplification against a Page that is already being throttled — and a
     * first call that failed for a real reason would come back from the second
     * as a lifecycle of "ready", quietly hiding the end of a broadcast.
     */
    const message = e instanceof Error ? e.message : "";
    if (!/nonexistent field|unknown fields?|broadcast_status/i.test(message)) throw e;
    data = await graphGet(
      `${GRAPH}/${videoId}`,
      { access_token: connection.accessToken, fields: "status,live_views,permalink_url" },
      "Couldn't read the Facebook live video"
    );
  }

  const broadcast = typeof data.broadcast_status === "string" ? data.broadcast_status : "";
  const publish = typeof data.status === "string" ? data.status : "";

  /*
   * `LIVE_STOPPED` is deliberately NOT treated as finished.
   *
   * Facebook reports it whenever RTMP input stops — which this system does on
   * purpose: a reconnect restarts ffmpeg, and an upload overrun closes the
   * socket so the browser can start a fresh recording. Both are recoveries,
   * and both leave a one-or-two-second window in which Facebook says
   * LIVE_STOPPED. A poll landing in that window would have ended the
   * destination, and with it the whole event — stopping the relay session and
   * killing the broadcast that was in the middle of recovering from a blip.
   *
   * `PROCESSING` and `VOD` are the states Facebook only reaches after it has
   * finalised the video, so they are the ones that mean finished. The cost of
   * this choice is that an end on Facebook's side is noticed a minute or so
   * later, once the video becomes a VOD, rather than the instant ingest stops.
   * That is the right way round: late is recoverable, wrong is not.
   */
  const status: LiveStatus = broadcast
    ? broadcast === "LIVE" || broadcast === "LIVE_STOPPED"
      ? "live"
      : broadcast === "PROCESSING" || broadcast === "VOD"
        ? "ended"
        : "ready"
    : // No lifecycle field available: the publish state is all there is, and it
      // cannot report the end — so this never returns "ended", and the caller
      // must not conclude from it that the broadcast is still running.
      publish === "LIVE_NOW"
      ? "live"
      : "ready";

  return {
    status,
    viewers: Number(data.live_views) || 0,
    permalink: absoluteFacebookUrl(data.permalink_url),
  };
}

/**
 * Ends the broadcast.
 *
 * Idempotent in practice: Meta refuses with "only valid if the live video is
 * still running" when it has already finished, which is not a failure worth
 * surfacing to an operator who pressed End Live twice.
 */
export async function endFacebookLive(
  connection: SocialConnectionRecord,
  videoId: string
): Promise<void> {
  try {
    await graphPost(
      `${GRAPH}/${videoId}`,
      { access_token: connection.accessToken, end_live_video: "true" },
      "Couldn't end the Facebook live video"
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/still running|already ended|not live/i.test(message)) return;
    throw e;
  }
}

/**
 * Recent comments on the live video.
 *
 * `order=reverse_chronological` with a small limit is the only sensible shape:
 * a busy broadcast gets hundreds, the control room wants the newest, and
 * paging the whole thread on every poll would burn the Page's rate limit.
 */
export async function fetchFacebookLiveComments(
  connection: SocialConnectionRecord,
  videoId: string,
  limit = 50
): Promise<LiveComment[]> {
  const data = await graphGet(
    `${GRAPH}/${videoId}/comments`,
    {
      access_token: connection.accessToken,
      order: "reverse_chronological",
      limit: String(Math.min(100, Math.max(1, limit))),
      fields: "id,message,created_time,from{name,picture}",
    },
    "Couldn't read Facebook comments"
  );

  const rows = Array.isArray(data.data) ? data.data : [];
  const out: LiveComment[] = [];

  for (const row of rows as Record<string, unknown>[]) {
    const id = typeof row.id === "string" ? row.id : null;
    const message = typeof row.message === "string" ? row.message : "";
    if (!id || !message.trim()) continue;

    const from = (row.from ?? null) as { name?: unknown; picture?: unknown } | null;
    const picture = (from?.picture ?? null) as { data?: { url?: unknown } } | null;

    out.push({
      externalId: id,
      // A comment from someone who hasn't granted the Page a profile scope
      // comes back with no `from` at all — Meta's own behaviour, not an error.
      authorName: typeof from?.name === "string" ? from.name : null,
      authorAvatarUrl: typeof picture?.data?.url === "string" ? picture.data.url : null,
      message,
      postedAt: typeof row.created_time === "string" ? new Date(row.created_time) : new Date(),
    });
  }

  return out;
}
