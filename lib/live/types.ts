/**
 * Shared vocabulary for the two live platforms, so the actions can treat them
 * alike where they genuinely are alike and branch only where they differ.
 *
 * Pure types and constants — no database, no `fetch`. The control room imports
 * from here too.
 */

/** The platforms this app can actually broadcast to. */
export const LIVE_PLATFORMS = ["facebook", "youtube"] as const;
export type LivePlatform = (typeof LIVE_PLATFORMS)[number];

export function isLivePlatform(value: unknown): value is LivePlatform {
  return typeof value === "string" && (LIVE_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Why the other four connected platforms are not on that list — worth stating
 * once rather than leaving an operator to wonder why X isn't offered:
 *
 * - **X** has no public API for creating a live broadcast at all.
 * - **LinkedIn** live video is invite-only and needs separate approval.
 * - **TikTok** live is granted per-app by TikTok and is not in the public API.
 * - **Instagram** removed live creation from the Graph API; Meta's own apps do
 *   it over a private protocol.
 *
 * If any of those changes, the work is a new module beside facebook.ts and
 * youtube.ts plus a line here — nothing above this layer assumes two.
 */
export const LIVE_UNSUPPORTED: Record<string, string> = {
  x: "X has no API for starting a live broadcast.",
  linkedin: "LinkedIn Live needs separate approval from LinkedIn and isn't in the public API.",
  tiktok: "TikTok grants live access per app; it isn't in the public API.",
  instagram: "Instagram removed live creation from the Graph API.",
};

/** What a platform reports about a broadcast right now. */
export type LiveStatus = "ready" | "live" | "ended";

/** What creating a broadcast gives back. */
export type LiveCreateResult = {
  externalVideoId: string;
  /** Full RTMPS URL including the stream key. Never persisted, never sent to a browser. */
  ingestUrl: string;
  /** YouTube only: the stream resource bound to the broadcast. */
  externalStreamId?: string;
  /** YouTube only: the live chat to poll. */
  chatId?: string | null;
  permalink: string | null;
};

export type LiveComment = {
  externalId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  message: string;
  postedAt: Date;
};

// ---------------------------------------------------------------------------
// Encode presets
// ---------------------------------------------------------------------------

/**
 * What the operator picks instead of typing numbers.
 *
 * The bitrates are the platforms' own recommendations for each resolution, and
 * the CPU column is what the relay README measures — a preset that the
 * newsroom's VPS cannot encode in real time produces a stuttering broadcast,
 * so the cost is shown at the point of choosing.
 */
export const LIVE_PRESETS = [
  {
    id: "720p30",
    label: "720p 30fps",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrateKbps: 3000,
    cpuHint: "about 2 vCPU on the relay",
  },
  {
    id: "1080p30",
    label: "1080p 30fps",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrateKbps: 4500,
    cpuHint: "about 4 vCPU on the relay",
  },
  {
    id: "1080p60",
    label: "1080p 60fps",
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrateKbps: 7000,
    cpuHint: "6–8 vCPU on the relay; only worth it from a 60fps source",
  },
] as const;

export type LivePresetId = (typeof LIVE_PRESETS)[number]["id"];

export function presetFor(width: number, height: number, fps: number): LivePresetId {
  const match = LIVE_PRESETS.find((p) => p.width === width && p.height === height && p.fps === fps);
  return match?.id ?? "1080p30";
}
