/**
 * Web Studio vocabulary — pure types, constants and validation, imported by
 * the operator's console (client), the guest join page (client) and the
 * server actions alike.
 *
 * What is real here, and what isn't, in one place:
 *
 *   - **Local sources** (cameras, microphones, screen share) are real media
 *     streams from the operator's own machine via getUserMedia /
 *     getDisplayMedia. Status comes from the device and the track, not a flag.
 *   - **Remote reporters and guests** join through a token link and connect
 *     peer-to-peer (WebRTC) to the operator's browser; signalling is
 *     exchanged through this app's own database, so there is no media server
 *     to run. A restrictive network needs a TURN server (see .env.example).
 *   - **VTR** plays real files from the media library, with real playback
 *     position and an optional return to the previous source when it ends.
 *   - **Graphics** are the Studio CG desk's own templates, taken to air
 *     through the same actions the CG page uses, and overlaid on program.
 *   - **Program output** is composited in the operator's browser. Getting it
 *     to Facebook/YouTube needs the Live Studio relay (not built yet); until
 *     then the honest route is capturing the fullscreen program window in
 *     OBS/vMix. The UI says so rather than implying a stream exists.
 */

export const SOURCE_KINDS = ["camera", "screen", "reporter", "guest", "vtr", "graphics", "external", "black"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  camera: "Camera",
  screen: "Screen share",
  reporter: "Reporter (remote)",
  guest: "Remote guest",
  vtr: "VTR / package",
  graphics: "Graphics",
  external: "External feed",
  black: "Black",
};

/** Which kinds the operator can add by hand. */
export const ADDABLE_KINDS: SourceKind[] = ["camera", "screen", "reporter", "guest", "vtr", "external"];

/** Filter tabs on the source bus. */
/** Graphics aren't bus sources — they're layers over program, run from the
 *  graphics bus panel — so there's no graphics tab here. */
export const SOURCE_FILTERS = ["all", "cameras", "reporters", "guests", "vtr", "offline"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

export const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: "All",
  cameras: "Cameras",
  reporters: "Reporters",
  guests: "Guests",
  vtr: "VTR",
  offline: "Offline",
};

export function matchesFilter(kind: SourceKind, status: SourceStatus, filter: SourceFilter) {
  switch (filter) {
    case "all":
      return true;
    case "cameras":
      return kind === "camera" || kind === "screen";
    case "reporters":
      return kind === "reporter";
    case "guests":
      return kind === "guest";
    case "vtr":
      return kind === "vtr";
    case "offline":
      return status === "offline" || status === "error";
  }
}

/**
 * Live state of a source. Never stored — it's derived from the actual device,
 * peer connection or media element every render, so a source can't claim to be
 * connected while its camera is unplugged.
 */
export const SOURCE_STATUSES = ["live", "ready", "connecting", "offline", "error"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const STATUS_LABELS: Record<SourceStatus, string> = {
  live: "Connected",
  ready: "Ready",
  connecting: "Connecting",
  offline: "Offline",
  error: "Connection lost",
};

export const STATUS_DOT: Record<SourceStatus, string> = {
  live: "bg-emerald-500",
  ready: "bg-newsroom",
  connecting: "bg-marigold",
  offline: "bg-muted-foreground/40",
  error: "bg-destructive",
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const TRANSITIONS = ["cut", "dissolve", "wipe"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const TRANSITION_LABELS: Record<Transition, string> = {
  cut: "Cut",
  dissolve: "Dissolve",
  wipe: "Wipe",
};

/** Durations in milliseconds. Cut ignores this. */
export const TRANSITION_DURATIONS = [250, 500, 1000, 1500, 2000];

export const WIPE_DIRECTIONS = ["left", "right", "down", "up"] as const;
export type WipeDirection = (typeof WIPE_DIRECTIONS)[number];

export const WIPE_LABELS: Record<WipeDirection, string> = {
  left: "Left → right",
  right: "Right → left",
  down: "Top → bottom",
  up: "Bottom → top",
};

/**
 * `clip-path` insets for a wipe, as the incoming source is revealed. The
 * incoming layer sits above the outgoing one and its clip opens up, so the
 * outgoing picture stays put underneath instead of sliding — which is what a
 * vision mixer's wipe actually looks like.
 */
export function wipeClip(direction: WipeDirection, progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  const gone = `${(1 - p) * 100}%`;
  switch (direction) {
    case "left":
      return `inset(0 ${gone} 0 0)`;
    case "right":
      return `inset(0 0 0 ${gone})`;
    case "down":
      return `inset(0 0 ${gone} 0)`;
    case "up":
      return `inset(${gone} 0 0 0)`;
  }
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export const AUDIO_ROLES = ["source", "music", "external"] as const;
export type AudioRole = (typeof AUDIO_ROLES)[number];

/** dB-ish scale for the faders: 0–100 where 80 is unity. */
export const UNITY_FADER = 80;

/** A fader position turned into a linear gain (unity at 80, ~+6 dB at 100). */
export function faderToGain(value: number) {
  const v = Math.min(100, Math.max(0, value));
  if (v === 0) return 0;
  // Squared curve: fine control near the bottom, natural feel at the top.
  return Math.pow(v / UNITY_FADER, 2);
}

export const AUDIO_STATES = ["normal", "quiet", "clipping", "silent", "muted"] as const;
export type AudioState = (typeof AUDIO_STATES)[number];

export const AUDIO_STATE_LABELS: Record<AudioState, string> = {
  normal: "Normal",
  quiet: "Low",
  clipping: "Clipping",
  silent: "No signal",
  muted: "Muted",
};

/**
 * Classifies a channel from its measured peak (0–1) over the last moment.
 * Real numbers from an AnalyserNode, not a decorative bar: "No signal" means
 * the track genuinely carried near-silence for a while.
 */
export function audioState(peak: number, muted: boolean, silentMs: number): AudioState {
  if (muted) return "muted";
  if (peak >= 0.985) return "clipping";
  if (silentMs > 3000) return "silent";
  if (peak < 0.02) return "quiet";
  return "normal";
}

// ---------------------------------------------------------------------------
// Participants (remote reporters and guests)
// ---------------------------------------------------------------------------

export const PARTICIPANT_ROLES = ["reporter", "guest"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_STATES = ["invited", "waiting", "connected", "left"] as const;
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

export const PARTICIPANT_STATE_LABELS: Record<ParticipantState, string> = {
  invited: "Invited — link not opened yet",
  waiting: "In the waiting room",
  connected: "Connected",
  left: "Left",
};

/** How long a join link stays usable, in hours. */
export const INVITE_HOURS = 12;

// ---------------------------------------------------------------------------
// Studio settings
// ---------------------------------------------------------------------------

export type StudioSettings = {
  /** Section 36 of the brief: sample sources only when this is on. */
  demoData: boolean;
  transition: Transition;
  transitionMs: number;
  wipeDirection: WipeDirection;
  /** Return to the previous source when a VTR reaches its end. */
  vtrAutoReturn: boolean;
  /** Monitor program audio on the operator's own speakers. Off by default: on
   *  a studio machine with an open mic this is a feedback loop. */
  monitorAudio: boolean;
  masterFader: number;
};

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  demoData: false,
  transition: "cut",
  transitionMs: 500,
  wipeDirection: "left",
  vtrAutoReturn: true,
  monitorAudio: false,
  masterFader: UNITY_FADER,
};

export function sanitizeStudioSettings(input: unknown): StudioSettings {
  const r = (input ?? {}) as Record<string, unknown>;
  const ms = Number(r.transitionMs);
  const master = Number(r.masterFader);
  return {
    demoData: r.demoData === true,
    transition: TRANSITIONS.includes(r.transition as Transition) ? (r.transition as Transition) : "cut",
    transitionMs: Number.isFinite(ms) ? Math.min(5000, Math.max(0, Math.round(ms))) : 500,
    wipeDirection: WIPE_DIRECTIONS.includes(r.wipeDirection as WipeDirection) ? (r.wipeDirection as WipeDirection) : "left",
    vtrAutoReturn: r.vtrAutoReturn !== false,
    monitorAudio: r.monitorAudio === true,
    masterFader: Number.isFinite(master) ? Math.min(100, Math.max(0, Math.round(master))) : UNITY_FADER,
  };
}

// ---------------------------------------------------------------------------
// Demo sources (only when demoData is on)
// ---------------------------------------------------------------------------

export type DemoSource = { id: string; name: string; kind: SourceKind; location: string | null };

/**
 * The names the old mock-up showed. They exist only so a client demo can be
 * given without connecting real kit, and only while "Demo sources" is on —
 * they are clearly badged and can never be taken to air, because there is no
 * media behind them.
 */
export function demoSources(): DemoSource[] {
  return [
    { id: "demo-cam1", name: "Cam 1 — Anchor wide", kind: "camera", location: "Studio A" },
    { id: "demo-cam2", name: "Cam 2 — Anchor close", kind: "camera", location: "Studio A" },
    { id: "demo-reporter", name: "Reporter Live — মিরপুর", kind: "reporter", location: "মিরপুর, ঢাকা" },
    { id: "demo-guest", name: "Remote guest — চট্টগ্রাম", kind: "guest", location: "চট্টগ্রাম" },
    { id: "demo-vtr", name: "VTR — Package A", kind: "vtr", location: null },
  ];
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export const STUDIO_SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "Space", does: "Take — preview goes to program with the chosen transition" },
  { keys: "C", does: "Cut (ignores the transition setting)" },
  { keys: "D", does: "Dissolve" },
  { keys: "W", does: "Wipe" },
  { keys: "1 – 9", does: "Put that source on preview" },
  { keys: "G", does: "Open the graphics bus" },
  { keys: "B", does: "Take black to program" },
  { keys: "H", does: "Hold program (block every take)" },
  { keys: "P", does: "Production mode on/off" },
  { keys: "F", does: "Fullscreen program" },
  { keys: "M", does: "Mute/unmute the selected channel" },
  { keys: "?", does: "This panel" },
];

/** Switch-history verbs, kept out of the UI so both sides agree. */
export const SWITCH_ACTIONS = ["take", "cut", "dissolve", "wipe", "black", "hold", "release", "source_add", "source_remove", "invite", "join", "leave"] as const;
export type SwitchAction = (typeof SWITCH_ACTIONS)[number];
