/**
 * YouTube Live, via the Live Streaming API.
 *
 * The sequence, verified against Google's current docs while this was written:
 *
 *   1. `liveBroadcasts.insert` — the event. Needs `snippet.title`,
 *      `snippet.scheduledStartTime` and `status.privacyStatus`.
 *   2. `liveStreams.insert` — the ingest point. Needs `snippet.title`,
 *      `cdn.frameRate`, `cdn.resolution` and `cdn.ingestionType` ("rtmp",
 *      which covers RTMPS and returns both addresses).
 *   3. `liveBroadcasts.bind` — ties the two together.
 *   4. the encoder starts pushing, and the broadcast goes live.
 *
 * **`enableAutoStart` is used instead of the testing → live transition.** The
 * manual route means waiting for YouTube to report the stream as active, then
 * calling `transition(testing)` and `transition(live)`, and each of those
 * fails if called a moment too early — a race that shows up as an operator
 * pressing Go live and nothing happening. With auto-start, YouTube promotes
 * the broadcast itself the moment frames arrive, which is both simpler and
 * what the platform recommends. The cost is no monitor/preview period, which
 * this app does not offer anyway (the operator previews in the studio).
 *
 * `enableAutoStop` is deliberately **off**: it ends the broadcast about a
 * minute after frames stop, which would turn a network blip the relay is
 * recovering from into a finished broadcast.
 *
 * Scope: `youtube.force-ssl`, already requested by the YouTube connection.
 * The channel must also be enabled for live streaming — a one-off on the
 * channel itself (phone verification, no live restrictions, and a 24-hour wait
 * the first time) that no API call can do on the newsroom's behalf.
 */

import { SocialApiError, type SocialConnectionRecord } from "@/lib/social/types";
import { readJson } from "@/lib/social/http";
import { refreshYouTubeToken } from "@/lib/social/oauth/youtube";
import type { LiveComment, LiveCreateResult, LiveStatus } from "@/lib/live/types";

const API = "https://www.googleapis.com/youtube/v3";

/**
 * Same shape as `lib/social/youtube.ts`'s own helper and for the same reason:
 * Google's access tokens last an hour, a broadcast lasts longer, and a refresh
 * has to be persisted the moment it happens or the next call uses a dead one.
 */
async function freshToken(connection: SocialConnectionRecord): Promise<string> {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;
  if (!needsRefresh || !connection.refreshToken) return connection.accessToken;

  try {
    const refreshed = await refreshYouTubeToken(connection.refreshToken);
    const tokens = {
      accessToken: refreshed.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    };
    await connection.onTokenRefresh?.(tokens);
    return tokens.accessToken;
  } catch (e) {
    throw new SocialApiError(
      e instanceof Error ? e.message : "Couldn't refresh the YouTube token.",
      true
    );
  }
}

function googleError(data: Record<string, unknown> | null, status: number, what: string) {
  const err = data?.error as { message?: string; errors?: { reason?: string }[] } | undefined;
  const reason = err?.errors?.[0]?.reason ?? "";
  let detail = err?.message ?? "";

  /*
   * Two refusals account for nearly every first-time failure, and Google's own
   * wording for them is opaque. Translating them here means the control room
   * shows the fix rather than the error.
   */
  if (reason === "liveStreamingNotEnabled" || /not enabled for live streaming/i.test(detail)) {
    detail =
      "This YouTube channel isn't enabled for live streaming yet. Enable it in YouTube Studio — it needs phone verification and, the first time, a 24-hour wait.";
  } else if (reason === "insufficientLivePermissions" || reason === "forbidden") {
    detail =
      "YouTube refused the live request for this channel. Reconnect the channel so the token carries the force-ssl scope, and check the channel has no live-streaming restrictions.";
  } else if (reason === "quotaExceeded" || reason === "rateLimitExceeded") {
    detail =
      "The YouTube API quota for today is used up. Creating a broadcast costs a large share of the default daily quota — request more in the Google Cloud console if the newsroom goes live often.";
  }

  /*
   * The reason code is appended, not dropped.
   *
   * Google's prose varies by locale and gets rewritten; the reason code does
   * not. Callers that need to recognise a specific refusal — `endYouTubeLive`
   * swallowing `invalidTransition`, `discardYouTubeLive` swallowing a
   * broadcast that is already gone — were matching on the message and
   * therefore matching nothing, which turned "already ended" into a failed
   * destination. It also gives an operator something searchable.
   */
  const suffix = reason ? ` [${reason}]` : "";

  return new SocialApiError(
    detail ? `${what}: ${detail}${suffix}` : `${what} (HTTP ${status})${suffix}.`,
    status === 401 || reason === "authError"
  );
}

async function call(
  // DELETE is used by `discardYouTubeLive`; it answers 204 with no body, which
  // `readJson` turns into null and `call` into {}.
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  what: string,
  options: { query?: Record<string, string>; body?: unknown } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = await readJson(res);
  if (!res.ok) throw googleError(data, res.status, what);
  return data ?? {};
}

/** Resolution/frame-rate strings the API accepts, derived from the chosen preset. */
function cdnFor(width: number, height: number, fps: number) {
  const resolution =
    height >= 2160 ? "2160p" : height >= 1440 ? "1440p" : height >= 1080 ? "1080p" : height >= 720 ? "720p" : height >= 480 ? "480p" : "360p";
  return {
    frameRate: fps >= 60 ? "60fps" : "30fps",
    resolution,
    // "rtmp" is the ingestion *type*; the response carries both the rtmp and
    // rtmps addresses, and only the rtmps one is used.
    ingestionType: "rtmp",
    // Width is accepted but unused by the API — recorded here so the call site
    // isn't left wondering why it passed one.
    _width: width,
  };
}

export async function createYouTubeLive(
  connection: SocialConnectionRecord,
  input: {
    title: string;
    description?: string | null;
    width: number;
    height: number;
    fps: number;
    /** `public` unless the operator chose otherwise — a rehearsal goes out unlisted. */
    privacy?: "public" | "unlisted" | "private";
    /** Pre-created for a scheduled event; otherwise now. */
    scheduledStartTime?: Date;
  }
): Promise<LiveCreateResult> {
  const token = await freshToken(connection);
  const cdn = cdnFor(input.width, input.height, input.fps);

  // 1. the broadcast
  const broadcast = await call("POST", "liveBroadcasts", token, "Couldn't create the YouTube broadcast", {
    query: { part: "id,snippet,status,contentDetails" },
    body: {
      snippet: {
        title: input.title.slice(0, 100),
        ...(input.description ? { description: input.description.slice(0, 5000) } : {}),
        scheduledStartTime: (input.scheduledStartTime ?? new Date()).toISOString(),
      },
      status: {
        privacyStatus: input.privacy ?? "public",
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        // See the file header: auto-start replaces the transition race.
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        recordFromStart: true,
        // No monitor stream: this app has no preview player, and leaving it on
        // adds a stage the operator would have to click past.
        monitorStream: { enableMonitorStream: false },
      },
    },
  });

  const broadcastId = typeof broadcast.id === "string" ? broadcast.id : null;
  if (!broadcastId) throw new SocialApiError("YouTube returned no broadcast id.", false);

  /*
   * Everything after the broadcast exists is wrapped, because a failure in
   * between leaves a real broadcast on the channel that nothing in this app
   * knows about. `externalVideoId` is only persisted once this function
   * returns, so a throw at step 2 or 3 — a quota refusal, a network fault —
   * used to leave a public "upcoming live stream" on the newsroom's channel
   * that no End live button could ever reach, and every retry of Go live added
   * another one. `liveBroadcasts.delete` is the right call here rather than a
   * transition: a broadcast that never received frames cannot be transitioned
   * to `complete`.
   */
  try {
    // 2. the ingest point
    const stream = await call("POST", "liveStreams", token, "Couldn't create the YouTube stream", {
      query: { part: "id,snippet,cdn,status" },
      body: {
        snippet: { title: `${input.title.slice(0, 80)} — ingest` },
        cdn: {
          frameRate: cdn.frameRate,
          resolution: cdn.resolution,
          ingestionType: cdn.ingestionType,
        },
        // A one-off stream per broadcast rather than a reusable key: a reusable
        // key shared between two broadcasts is how you accidentally send a
        // programme to last week's event.
        contentDetails: { isReusable: false },
      },
    });

    const streamId = typeof stream.id === "string" ? stream.id : null;
    const ingestion = ((stream.cdn as Record<string, unknown> | undefined)?.ingestionInfo ?? null) as
      | { rtmpsIngestionAddress?: unknown; ingestionAddress?: unknown; streamName?: unknown }
      | null;

    const address =
      typeof ingestion?.rtmpsIngestionAddress === "string"
        ? ingestion.rtmpsIngestionAddress
        : typeof ingestion?.ingestionAddress === "string"
          ? ingestion.ingestionAddress
          : null;
    const streamName = typeof ingestion?.streamName === "string" ? ingestion.streamName : null;

    if (!streamId || !address || !streamName) {
      throw new SocialApiError("YouTube returned no ingest address for the stream.", false);
    }

    // 3. bind them
    await call("POST", "liveBroadcasts/bind", token, "Couldn't bind the YouTube stream", {
      query: { id: broadcastId, streamId, part: "id,contentDetails" },
    });

    // The insert response's own snippet. It carries `liveChatId` for a broadcast
    // created with a chat, and `pollLive` re-reads it on every poll anyway
    // (`readYouTubeLive` returns it), so a null here is filled in within seconds
    // rather than being a missing chat for the whole broadcast.
    const chatId =
      ((broadcast.snippet as Record<string, unknown> | undefined)?.liveChatId as string | undefined) ??
      null;

    return {
      externalVideoId: broadcastId,
      externalStreamId: streamId,
      chatId,
      // `address` already ends with a slash in Google's response, but not
      // always — joining defensively avoids a key glued onto the host.
      ingestUrl: `${address.replace(/\/+$/, "")}/${streamName}`,
      permalink: `https://www.youtube.com/watch?v=${broadcastId}`,
    };
  } catch (e) {
    await discardYouTubeLive(connection, broadcastId).catch(() => {
      /* Nothing more can be done from here; the original failure is what the
         operator needs to see. */
    });
    throw e;
  }
}

/**
 * Deletes a broadcast outright.
 *
 * For a broadcast that never went live. `liveBroadcasts.transition` to
 * `complete` is refused in that state (`invalidTransition`), so a rollback
 * that only transitioned left the broadcast sitting on the channel as a
 * public upcoming live stream while this app recorded it as ended. Deleting
 * removes it, which is what "this never happened" should mean. A broadcast
 * that *has* streamed should be transitioned instead — deleting it would
 * throw away the recording.
 */
export async function discardYouTubeLive(
  connection: SocialConnectionRecord,
  broadcastId: string
): Promise<void> {
  const token = await freshToken(connection);
  try {
    await call("DELETE", "liveBroadcasts", token, "Couldn't delete the YouTube broadcast", {
      query: { id: broadcastId },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // Already gone, or already streamed and therefore not deletable. Matched
    // on the reason code `googleError` now appends, not on Google's prose.
    if (/\[(notFound|liveBroadcastNotFound|forbidden|insufficientPermissions)\]/i.test(message)) {
      return;
    }
    if (/cannot be found|not be found|does not exist|doesn't exist/i.test(message)) return;
    throw e;
  }
}

export async function readYouTubeLive(
  connection: SocialConnectionRecord,
  broadcastId: string
): Promise<{ status: LiveStatus; viewers: number; chatId: string | null }> {
  const token = await freshToken(connection);
  const data = await call("GET", "liveBroadcasts", token, "Couldn't read the YouTube broadcast", {
    query: { part: "id,status,snippet", id: broadcastId },
  });

  const item = (Array.isArray(data.items) ? data.items[0] : null) as Record<string, unknown> | null;
  const lifeCycle = ((item?.status as Record<string, unknown> | undefined)?.lifeCycleStatus ??
    "") as string;
  const snippet = (item?.snippet ?? null) as Record<string, unknown> | null;

  /*
   * Concurrent viewers are not on the broadcast — they are on the *video*, via
   * `videos.list` with `part=liveStreamingDetails`. One extra call, but it is
   * the only place the number exists.
   */
  let viewers = 0;
  try {
    const video = await call("GET", "videos", token, "Couldn't read the YouTube viewer count", {
      query: { part: "liveStreamingDetails", id: broadcastId },
    });
    const v = (Array.isArray(video.items) ? video.items[0] : null) as Record<string, unknown> | null;
    const details = (v?.liveStreamingDetails ?? null) as { concurrentViewers?: unknown } | null;
    viewers = Number(details?.concurrentViewers) || 0;
  } catch {
    // A viewer count is a nice-to-have; never fail a status read over it.
  }

  return {
    status: lifeCycle === "live" ? "live" : lifeCycle === "complete" || lifeCycle === "revoked" ? "ended" : "ready",
    viewers,
    chatId: typeof snippet?.liveChatId === "string" ? snippet.liveChatId : null,
  };
}

/**
 * Ends the broadcast by transitioning it to `complete`.
 *
 * YouTube refuses the transition when the broadcast is not live (it may have
 * never started, or auto-stopped), and "it is already not live" is exactly
 * what End Live wants — so that case is swallowed.
 */
export async function endYouTubeLive(
  connection: SocialConnectionRecord,
  broadcastId: string
): Promise<void> {
  const token = await freshToken(connection);
  try {
    await call("POST", "liveBroadcasts/transition", token, "Couldn't end the YouTube broadcast", {
      query: { id: broadcastId, broadcastStatus: "complete", part: "id,status" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // The reason code first, for the same reason as above; the prose patterns
    // stay as a second line of defence.
    if (/\[(invalidTransition|redundantTransition|errorStreamInactive|notFound)\]/i.test(message)) {
      return;
    }
    if (/invalid transition|redundant|not live|already complete/i.test(message)) return;
    throw e;
  }
}

/**
 * Live chat messages.
 *
 * `liveChatMessages.list` is paginated with a `pageToken` *and* tells the
 * caller how long to wait before asking again (`pollingIntervalMillis`). Both
 * are returned so the poller can respect them — ignoring the interval is the
 * quickest way to exhaust the daily quota on a long broadcast.
 */
export async function fetchYouTubeLiveChat(
  connection: SocialConnectionRecord,
  chatId: string,
  pageToken?: string | null
): Promise<{ comments: LiveComment[]; nextPageToken: string | null; pollAfterMs: number }> {
  const token = await freshToken(connection);
  const data = await call("GET", "liveChat/messages", token, "Couldn't read the YouTube live chat", {
    query: {
      liveChatId: chatId,
      part: "id,snippet,authorDetails",
      maxResults: "200",
      ...(pageToken ? { pageToken } : {}),
    },
  });

  const items = Array.isArray(data.items) ? data.items : [];
  const comments: LiveComment[] = [];

  for (const raw of items as Record<string, unknown>[]) {
    const id = typeof raw.id === "string" ? raw.id : null;
    const snippet = (raw.snippet ?? null) as Record<string, unknown> | null;
    const author = (raw.authorDetails ?? null) as Record<string, unknown> | null;
    const message =
      typeof snippet?.displayMessage === "string" ? snippet.displayMessage : "";
    if (!id || !message.trim()) continue;

    comments.push({
      externalId: id,
      authorName: typeof author?.displayName === "string" ? author.displayName : null,
      authorAvatarUrl: typeof author?.profileImageUrl === "string" ? author.profileImageUrl : null,
      message,
      postedAt:
        typeof snippet?.publishedAt === "string" ? new Date(snippet.publishedAt) : new Date(),
    });
  }

  return {
    comments,
    nextPageToken: typeof data.nextPageToken === "string" ? data.nextPageToken : null,
    pollAfterMs: Math.max(5000, Number(data.pollingIntervalMillis) || 10_000),
  };
}
