/**
 * The app's side of the relay's control API.
 *
 * **Server-only by convention**, like `lib/ai-feed/ai.ts`: it reads
 * `LIVE_RELAY_SECRET` and handles RTMPS stream keys, so it is imported solely
 * from `"use server"` actions and route handlers. Nothing here is ever passed
 * to a client component, and the browser never calls the relay's control API —
 * it only opens the ingest socket with the session token an action hands it.
 *
 * See relay/README.md for the service itself.
 */

import type { LiveRelayStats } from "@/lib/live/queries";

const TIMEOUT_MS = 10_000;

function config() {
  const url = process.env.LIVE_RELAY_URL?.replace(/\/+$/, "");
  const secret = process.env.LIVE_RELAY_SECRET;
  if (!url || !secret) return null;
  return { url, secret };
}

/** Whether the newsroom has a relay configured at all — the page needs to say so. */
export function isRelayConfigured(): boolean {
  return config() !== null;
}

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayError";
  }
}

async function relayFetch(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown } = { method: "GET" }
): Promise<Record<string, unknown>> {
  const cfg = config();
  if (!cfg) {
    throw new RelayError(
      "No live relay is configured. Set LIVE_RELAY_URL and LIVE_RELAY_SECRET — see relay/README.md."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${cfg.secret}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!res.ok) {
      const detail = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      // 401 is worth naming specifically: it means the two halves of the
      // deployment disagree about the secret, which no amount of retrying fixes.
      throw new RelayError(
        res.status === 401
          ? "The relay rejected the newsroom's credentials — LIVE_RELAY_SECRET doesn't match the relay's own."
          : detail
      );
    }
    return data;
  } catch (e) {
    if (e instanceof RelayError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new RelayError("The relay didn't answer within 10 seconds. Check that the service is running.");
    }
    throw new RelayError(
      e instanceof Error
        ? `Couldn't reach the relay: ${e.message}`
        : "Couldn't reach the relay."
    );
  } finally {
    clearTimeout(timer);
  }
}

export type RelayHealth = {
  ok: boolean;
  sessions: number;
  capacity: number;
  uptimeSec: number;
};

export async function relayHealth(): Promise<RelayHealth> {
  const data = await relayFetch("/health");
  return {
    ok: data.ok === true,
    sessions: Number(data.sessions) || 0,
    capacity: Number(data.capacity) || 0,
    uptimeSec: Number(data.uptimeSec) || 0,
  };
}

export type RelayTarget = { id: string; label: string; url: string };

export type RelaySession = {
  sessionId: string;
  /**
   * Handed to the browser so it can open the ingest socket.
   *
   * Scoped to this session, not single-use: the browser reuses it on every
   * reconnect. See the security note at the top of relay/server.js for what it
   * does and doesn't protect.
   */
  ingestToken: string;
  /** Where the browser connects — derived here so the client never builds it. */
  ingestUrl: string;
};

/**
 * Opens a relay session for a set of destinations.
 *
 * This is the only place RTMPS URLs cross a network boundary, and they cross it
 * to a host the newsroom owns, over TLS, behind a bearer secret.
 */
export async function createRelaySession(input: {
  targets: RelayTarget[];
  video: { width: number; height: number; fps: number; bitrateKbps: number };
  audio: { bitrateKbps: number };
}): Promise<RelaySession> {
  const cfg = config();
  if (!cfg) throw new RelayError("No live relay is configured.");

  const data = await relayFetch("/sessions", { method: "POST", body: input });
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
  const ingestToken = typeof data.ingestToken === "string" ? data.ingestToken : null;
  if (!sessionId || !ingestToken) throw new RelayError("The relay returned no session.");

  // https → wss, so the studio page's secure context can open it.
  const wsBase = cfg.url.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");

  return {
    sessionId,
    ingestToken,
    ingestUrl: `${wsBase}/ingest?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(ingestToken)}`,
  };
}

export async function readRelaySession(sessionId: string): Promise<LiveRelayStats | null> {
  try {
    const data = await relayFetch(`/sessions/${sessionId}`);
    const stats = (data.stats ?? {}) as Record<string, unknown>;
    return {
      state: String(data.state ?? "unknown"),
      uptimeSec: Number(data.uptimeSec) || 0,
      bitrate: typeof stats.bitrate === "string" ? stats.bitrate : null,
      fps: Number(stats.fps) || 0,
      droppedFrames: Number(stats.dropped) || 0,
      overruns: Number(stats.overruns) || 0,
      speed: typeof stats.speed === "string" ? stats.speed : null,
      restarts: Number(data.restarts) || 0,
      error: typeof data.error === "string" ? data.error : null,
      log: Array.isArray(data.log) ? data.log.filter((l): l is string => typeof l === "string") : [],
    };
  } catch (e) {
    // A relay that has forgotten the session (restarted, or the session aged
    // out) is not an error the control room should block on — it reports the
    // broadcast as no longer carried, which is the truth.
    if (e instanceof RelayError && /HTTP 404|No such session/i.test(e.message)) return null;
    throw e;
  }
}

export async function stopRelaySession(sessionId: string): Promise<void> {
  try {
    await relayFetch(`/sessions/${sessionId}`, { method: "DELETE" });
  } catch (e) {
    // Ending a broadcast must not fail because the relay already forgot it.
    if (e instanceof RelayError && /HTTP 404|No such session/i.test(e.message)) return;
    throw e;
  }
}
