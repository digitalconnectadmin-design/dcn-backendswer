/**
 * WebRTC plumbing for the Web Studio, shared by the operator's console and
 * the remote join page. Framework-free on purpose: the React components only
 * wire callbacks, so the connection logic can be reasoned about (and fixed)
 * without chasing it through renders.
 *
 * Shape of the thing: the **participant offers**, the **operator answers**.
 * Signalling goes through /api/broadcast/studio/signal (database-backed
 * polling — there's no socket server here), and the media is peer-to-peer.
 * One RTCPeerConnection per participant; the operator runs a small mesh,
 * which is fine for the handful of remote contributors a bulletin uses and
 * is the honest limit of a server-less design.
 */

const SIGNAL_URL = "/api/broadcast/studio/signal";

export type PeerPhase = "idle" | "waiting" | "connecting" | "connected" | "failed" | "closed";

export type PeerQuality = {
  /** e.g. "1280×720 · 28fps" as the receiver actually sees it. */
  video: string | null;
  audio: string | null;
  /** "Excellent" | "Good" | "Poor" from loss and round-trip time. */
  network: string | null;
};

type SignalMessage = { id: string; kind: string; payload: unknown };

/**
 * One signalling read. `waitMs` asks the server to hold the request open until
 * something arrives — a message then lands within a few hundred milliseconds
 * instead of waiting for the next timer tick, and the traffic drops by an
 * order of magnitude.
 */
async function signalGet(query: string, waitMs = 0, signal?: AbortSignal): Promise<SignalMessage[]> {
  const res = await fetch(`${SIGNAL_URL}?${query}${waitMs ? `&wait=${waitMs}` : ""}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`signal ${res.status}`);
  const data = (await res.json()) as { messages?: SignalMessage[] };
  return data.messages ?? [];
}

/** How long a single long poll hangs before coming back empty. */
const WAIT_MS = 15_000;

async function signalPost(query: string, body: Record<string, unknown>) {
  const res = await fetch(`${SIGNAL_URL}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`signal ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function fetchIceServers(query: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${SIGNAL_URL}?${query}&mode=ice`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    return data.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    // A STUN-only fallback still connects on most networks.
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

/** Turns getStats() into the three words an operator actually needs. */
async function readQuality(pc: RTCPeerConnection, direction: "inbound" | "outbound"): Promise<PeerQuality> {
  const out: PeerQuality = { video: null, audio: null, network: null };
  try {
    const stats = await pc.getStats();
    let loss = 0;
    let packets = 0;
    let rtt: number | null = null;
    stats.forEach((report) => {
      const r = report as unknown as Record<string, number | string>;
      const type = String(r.type);
      if (type === (direction === "inbound" ? "inbound-rtp" : "outbound-rtp")) {
        if (String(r.kind) === "video") {
          const w = Number(r.frameWidth ?? 0);
          const h = Number(r.frameHeight ?? 0);
          const fps = Math.round(Number(r.framesPerSecond ?? 0));
          if (w && h) out.video = `${w}×${h}${fps ? ` · ${fps}fps` : ""}`;
        }
        if (String(r.kind) === "audio") {
          const level = Number(r.audioLevel ?? 0);
          out.audio = level > 0.001 ? "Live" : "Silent";
        }
        packets += Number(r.packetsSent ?? r.packetsReceived ?? 0);
        loss += Number(r.packetsLost ?? 0);
      }
      if (type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime != null) {
        rtt = Number(r.currentRoundTripTime) * 1000;
      }
    });
    const lossPct = packets > 0 ? (loss / (packets + loss)) * 100 : 0;
    if (rtt != null || packets > 0) {
      out.network = lossPct > 5 || (rtt ?? 0) > 400 ? "Poor" : lossPct > 1.5 || (rtt ?? 0) > 200 ? "Good" : "Excellent";
    }
  } catch {
    // getStats can reject on a closed connection; a missing reading is fine.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operator side — answers each participant's offer and receives their media
// ---------------------------------------------------------------------------

export class OperatorPeer {
  readonly participantId: string;
  private pc: RTCPeerConnection | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private ice: RTCIceServer[] = [];
  private abort: AbortController | null = null;

  constructor(
    participantId: string,
    private readonly on: {
      stream: (stream: MediaStream | null) => void;
      phase: (phase: PeerPhase) => void;
      quality: (quality: PeerQuality) => void;
      error?: (message: string) => void;
    }
  ) {
    this.participantId = participantId;
  }

  private query() {
    return `participantId=${encodeURIComponent(this.participantId)}`;
  }

  async start() {
    this.ice = await fetchIceServers(this.query());
    this.on.phase("waiting");
    void this.loop();
  }

  /**
   * One request at a time, each one long-polling. An interval was wrong here:
   * when a request takes longer than the interval — which it does from South
   * Asia to a US function region — the browser stacks them up and the queue
   * only grows.
   */
  private async loop() {
    while (!this.closed) {
      const worked = await this.tick();
      if (this.closed) break;
      // A failed request backs off a little; a successful one comes straight
      // back round, since the server has already done the waiting.
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private ensurePc() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.ice });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) this.on.stream(stream);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void signalPost(this.query(), { kind: "candidate", payload: event.candidate.toJSON() }).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") this.on.phase("connected");
      else if (state === "connecting") this.on.phase("connecting");
      else if (state === "failed") {
        this.on.phase("failed");
        this.on.error?.("The connection failed — ask them to rejoin, or reset it.");
        this.teardownPc();
      } else if (state === "disconnected") {
        this.on.phase("connecting");
      } else if (state === "closed") {
        this.on.phase("closed");
      }
    };

    this.pc = pc;
    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      this.on.quality(await readQuality(this.pc, "inbound"));
    }, 5000);
    return pc;
  }

  private teardownPc() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.pc?.close();
    this.pc = null;
    this.pendingCandidates = [];
    this.on.stream(null);
  }

  private async tick(): Promise<boolean> {
    if (this.closed) return false;
    let messages: SignalMessage[] = [];
    this.abort = new AbortController();
    try {
      messages = await signalGet(this.query(), WAIT_MS, this.abort.signal);
    } catch {
      return false; // A dropped poll is normal; the loop backs off and retries.
    }

    for (const message of messages) {
      try {
        if (message.kind === "offer") {
          // A new offer means a fresh join (or a rejoin) — start clean rather
          // than trying to renegotiate onto a half-dead connection. Candidates
          // that arrived in the same batch belong to this offer, so they're
          // carried across the teardown rather than dropped.
          const carried = this.pendingCandidates;
          this.teardownPc();
          this.pendingCandidates = carried;
          const pc = this.ensurePc();
          await pc.setRemoteDescription(new RTCSessionDescription(message.payload as RTCSessionDescriptionInit));
          for (const candidate of this.pendingCandidates) await pc.addIceCandidate(candidate).catch(() => {});
          this.pendingCandidates = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await signalPost(this.query(), { kind: "answer", payload: answer });
          this.on.phase("connecting");
        } else if (message.kind === "candidate") {
          const candidate = message.payload as RTCIceCandidateInit;
          if (this.pc?.remoteDescription) await this.pc.addIceCandidate(candidate).catch(() => {});
          else this.pendingCandidates.push(candidate);
        } else if (message.kind === "bye") {
          this.teardownPc();
          this.on.phase("waiting");
        }
      } catch (e) {
        this.on.error?.(e instanceof Error ? e.message : "Signalling error");
      }
    }
    return true;
  }

  /**
   * Throws the connection away and asks the contributor's browser to offer
   * again, so "Reset" actually reconnects instead of waiting for someone in
   * the field to notice a button.
   */
  reset() {
    this.teardownPc();
    this.on.phase("waiting");
    void signalPost(this.query(), { kind: "reoffer", payload: null }).catch(() => {});
  }

  close() {
    this.closed = true;
    this.abort?.abort();
    this.abort = null;
    this.teardownPc();
    this.on.phase("closed");
  }
}

// ---------------------------------------------------------------------------
// Participant side — sends its camera to the studio
// ---------------------------------------------------------------------------

export class GuestPeer {
  private pc: RTCPeerConnection | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;
  private answered = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private ice: RTCIceServer[] = [];
  /**
   * Candidates gathered before the offer has been stored. They must not be
   * posted early: the server clears this side's rows when a new offer lands,
   * so anything sent during that round trip would be thrown away — which on a
   * fast local network is *every* candidate, and the call then never connects.
   */
  private outgoing: RTCIceCandidateInit[] = [];
  private offerStored = false;

  constructor(
    private readonly token: string,
    private readonly stream: MediaStream,
    private readonly on: {
      phase: (phase: PeerPhase) => void;
      quality: (quality: PeerQuality) => void;
      error?: (message: string) => void;
    }
  ) {}

  private query() {
    return `token=${encodeURIComponent(this.token)}`;
  }

  async start() {
    this.ice = await fetchIceServers(this.query());
    // The loop runs first: even if the offer fails to store, a retry (or the
    // operator asking for a new offer) can still recover.
    void this.loop();
    await this.offer();
  }

  private async loop() {
    while (!this.closed) {
      const worked = await this.tick();
      if (this.closed) break;
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private async offer() {
    this.teardownPc();
    this.offerStored = false;
    this.outgoing = [];
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    this.pc = pc;
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (!this.offerStored) this.outgoing.push(candidate);
      else void signalPost(this.query(), { kind: "candidate", payload: candidate }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        this.on.phase("connected");
        void signalPost(this.query(), { kind: "state", state: "connected" }).catch(() => {});
      } else if (state === "failed") {
        this.on.phase("failed");
        this.on.error?.("Couldn't reach the studio. Check your connection and try again.");
      } else if (state === "connecting" || state === "disconnected") {
        this.on.phase("connecting");
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    try {
      await signalPost(this.query(), { kind: "offer", payload: offer });
    } catch {
      // A rejected offer is usually a link that has just been reissued or has
      // expired — say so rather than sitting on a silent dead page.
      this.on.phase("failed");
      this.on.error?.("The studio didn't accept the connection. Your link may have expired — ask for a new one.");
      return;
    }
    this.offerStored = true;
    for (const candidate of this.outgoing) {
      void signalPost(this.query(), { kind: "candidate", payload: candidate }).catch(() => {});
    }
    this.outgoing = [];
    this.on.phase("connecting");

    // Nobody answering is the common real-world case — the studio page simply
    // isn't open — and it used to look identical to a broken connection.
    this.answered = false;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (!this.answered && !this.closed) {
        this.on.error?.(
          "The studio hasn't answered yet. It can only accept you while the Web Studio page is open on the newsroom's computer — keep this page open and it will connect as soon as they open it."
        );
      }
    }, 12_000);

    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      const quality = await readQuality(this.pc, "outbound");
      this.on.quality(quality);
      // The studio shows what the contributor's own browser is managing to
      // send, so the operator can tell "their camera is poor" from "our end
      // is struggling".
      void signalPost(this.query(), {
        kind: "state",
        videoQuality: quality.video ?? "",
        audioQuality: quality.audio ?? "",
        networkQuality: quality.network ?? "",
      }).catch(() => {});
    }, 5000);
  }

  private teardownPc() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.pc?.close();
    this.pc = null;
    this.pendingCandidates = [];
  }

  private async tick(): Promise<boolean> {
    if (this.closed) return false;
    let messages: SignalMessage[] = [];
    this.abort = new AbortController();
    try {
      messages = await signalGet(this.query(), WAIT_MS, this.abort.signal);
    } catch {
      return false;
    }
    for (const message of messages) {
      try {
        if (message.kind === "reoffer") {
          // The operator reset the connection: offer again straight away
          // instead of waiting for the contributor to notice.
          await this.offer();
        } else if (message.kind === "answer") {
          this.answered = true;
          if (this.watchdog) clearTimeout(this.watchdog);
          // Only while we're actually waiting for one: a duplicate answer (two
          // operator tabs) would otherwise throw InvalidStateError and show the
          // contributor an error for something harmless.
          if (this.pc && this.pc.signalingState === "have-local-offer") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload as RTCSessionDescriptionInit));
            for (const candidate of this.pendingCandidates) await this.pc.addIceCandidate(candidate).catch(() => {});
            this.pendingCandidates = [];
          }
        } else if (message.kind === "candidate") {
          const candidate = message.payload as RTCIceCandidateInit;
          if (this.pc?.remoteDescription) await this.pc.addIceCandidate(candidate).catch(() => {});
          else this.pendingCandidates.push(candidate);
        } else if (message.kind === "bye") {
          // The operator dropped us: stop, and let them re-invite.
          this.teardownPc();
          this.on.phase("waiting");
        }
      } catch (e) {
        this.on.error?.(e instanceof Error ? e.message : "Signalling error");
      }
    }
    return true;
  }

  /** Re-offers from scratch — the "Reconnect" button. */
  async retry() {
    await this.offer();
  }

  close(tellStudio = true) {
    this.closed = true;
    this.abort?.abort();
    this.abort = null;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.teardownPc();
    if (tellStudio) void signalPost(this.query(), { kind: "bye", payload: null }).catch(() => {});
    this.on.phase("closed");
  }
}
