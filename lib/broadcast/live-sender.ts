/**
 * The browser half of going live: capture → MediaRecorder → WebSocket.
 *
 * Runs in the operator's tab. Not a React hook — a plain class with callbacks,
 * because its lifetime is a broadcast, not a render, and every attempt to keep
 * a MediaRecorder and a WebSocket inside effect dependencies ends badly.
 *
 * ## What it captures, and why that's the shape
 *
 * The Web Studio composites program as **DOM layers** — stacked `<video>`
 * elements with CSS transitions, plus the CG overlay. There is no
 * `MediaStream` of that composite anywhere: a canvas could be captured with
 * `captureStream()`, but the studio does not draw to one, and rewriting its
 * compositor onto canvas would mean re-implementing the CG renderer in canvas
 * too (the photocard studio's exporter shows what that costs).
 *
 * So program capture is `getDisplayMedia` — the operator shares the studio tab,
 * exactly as they already do to feed OBS. That is a real limitation, stated on
 * screen rather than hidden: the operator has to pick the right tab, and tab
 * audio has to be ticked in Chrome's picker.
 *
 * `camera` mode skips all of that for the simple case — a reporter going live
 * from a laptop with no mixing.
 *
 * ## Why WebM, and why the relay transcodes
 *
 * `MediaRecorder` gives WebM (VP8/VP9 + Opus) in Chrome. RTMP carries H.264 +
 * AAC. There is no overlap, so something must transcode, and the relay is the
 * only place that can. See relay/README.md for the CPU cost.
 */

export type LiveSenderSource = "program" | "camera";

export type LiveSenderStats = {
  state: "idle" | "capturing" | "connecting" | "streaming" | "reconnecting" | "stopped" | "failed";
  /** Measured over the last few seconds, in kbps — what is actually leaving the browser. */
  outKbps: number;
  bytesSent: number;
  /**
   * Times the upload fell so far behind that the stream had to be restarted.
   *
   * Not "chunks dropped": a MediaRecorder timeslice is not independently
   * parseable, so skipping one leaves a hole the relay's demuxer cannot
   * recover from — see the overrun branch in the `dataavailable` handler.
   */
  overruns: number;
  reconnects: number;
  error: string | null;
  /** Size the capture is really producing, which may not be what was asked for. */
  captureLabel: string | null;
  hasAudio: boolean;
};

export type LiveSenderOptions = {
  source: LiveSenderSource;
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** Mix the operator's microphone into the programme audio. */
  withMicrophone?: boolean;
  onStats: (stats: LiveSenderStats) => void;
  /** Fired once, the first time bytes actually reach the relay. */
  onStreaming: () => void;
  onTrouble: (detail: string) => void;
  /** Fired when the sender gives up — the UI should offer End live. */
  onFailed: (message: string) => void;
};

/** How often MediaRecorder hands over a chunk. */
const TIMESLICE_MS = 400;
/** Stop queueing if the socket is this far behind; dropping beats unbounded memory. */
const MAX_BUFFERED = 4 * 1024 * 1024;
/*
 * The backoff budget is sized to the relay's grace window, not picked for
 * looks: the relay holds a session open for 90 seconds waiting for the browser
 * (IDLE_TIMEOUT_MS in relay/server.js), and these delays sum to about 85
 * seconds across nine attempts. An earlier set totalling 31 seconds gave up
 * while the relay was still holding the broadcast open for it.
 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000, 15_000, 20_000, 25_000];
/**
 * How long a connection has to last before its success resets the backoff.
 *
 * Without this, a connection that opens and immediately breaks again — which
 * is exactly what a sustained overrun produces — reset the counter every time,
 * so the sender cycled at half-second intervals for ever, told the operator it
 * was restarting the stream once a second, and never reached the failure that
 * would have said "this upload cannot carry this bitrate".
 */
const STABLE_CONNECTION_MS = 15_000;
/** Overruns before the broadcast is called off rather than restarted again. */
const MAX_OVERRUNS = 6;

export class LiveSender {
  private opts: LiveSenderOptions;
  private url: string;
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private socket: WebSocket | null = null;
  private stats: LiveSenderStats = {
    state: "idle",
    outKbps: 0,
    bytesSent: 0,
    overruns: 0,
    reconnects: 0,
    error: null,
    captureLabel: null,
    hasAudio: false,
  };
  private windowBytes = 0;
  private windowStart = 0;
  private rateTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private stableTimer: number | null = null;
  private attempt = 0;
  private stopping = false;
  private announced = false;

  constructor(url: string, opts: LiveSenderOptions) {
    this.url = url;
    this.opts = opts;
  }

  /** The MIME type both this browser can record and ffmpeg can demux. */
  static supportedMimeType(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      // VP8 first, deliberately: it is the most widely demuxable from a pipe,
      // and the relay re-encodes anyway so VP9's efficiency buys nothing here.
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
  }

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices &&
      LiveSender.supportedMimeType() !== null
    );
  }

  private emit(patch: Partial<LiveSenderStats> = {}) {
    this.stats = { ...this.stats, ...patch };
    this.opts.onStats(this.stats);
  }

  /**
   * Asks for the capture. Separate from `start()` so the UI can show a preview
   * and let the operator confirm they picked the right tab *before* anything
   * goes to air — picking the wrong window is the most common live mistake and
   * the only one that is unrecoverable once viewers are watching.
   */
  async capture(): Promise<MediaStream> {
    const { source, width, height, fps } = this.opts;

    const stream =
      source === "program"
        ? await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: fps, max: fps },
              width: { ideal: width },
              height: { ideal: height },
            },
            // Tab audio, when the operator shares a tab and ticks the box.
            // There is no way to require it from here; the UI explains it.
            audio: true,
          })
        : await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
            audio: { echoCancellation: true, noiseSuppression: true },
          });

    this.stopping = false;
    this.attach(stream);
    return stream;
  }

  /** Records a captured stream and describes it, whoever asked for it. */
  private attach(stream: MediaStream) {
    this.stream = stream;
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings();
    this.emit({
      state: "capturing",
      captureLabel: settings
        ? `${settings.width ?? "?"}×${settings.height ?? "?"} @ ${Math.round(settings.frameRate ?? 0)}fps`
        : null,
      hasAudio: stream.getAudioTracks().length > 0,
    });

    // The operator pressing Chrome's own "Stop sharing" is a deliberate act,
    // not a fault — but it ends the pictures, so it has to surface.
    videoTrack?.addEventListener("ended", () => {
      if (this.stopping) return;
      this.fail("Screen sharing was stopped, so there are no pictures to send.");
    });
  }

  /**
   * Takes over the capture another sender is already holding.
   *
   * Going live is two steps on purpose: the operator approves the picture
   * before anything is created on Facebook or YouTube, so the sender that
   * opened the picker was built before the relay session existed and has no
   * URL to connect to. Rather than re-prompting — which would show the picker
   * a second time and could land on the wrong tab after the broadcast rows
   * already exist — the live sender adopts the approved stream and the first
   * one steps aside.
   */
  adopt(from: LiveSender): void {
    const stream = from.release();
    if (!stream) throw new Error("There is nothing captured to take over.");
    this.attach(stream);
  }

  /**
   * Gives up the capture without stopping it.
   *
   * `teardown()` stops every track, which is right when a broadcast ends and
   * wrong during a hand-over — it would kill the pictures the new sender is
   * about to send. `stopping` is set so this sender's own "Stop sharing"
   * listener stays quiet: the track it was watching now belongs to someone
   * else, and reporting its end here would toast an error about a broadcast
   * this object is no longer part of.
   */
  release(): MediaStream | null {
    const stream = this.stream;
    this.stream = null;
    this.stopping = true;
    return stream;
  }

  /**
   * Mixes the microphone into the captured audio.
   *
   * Web Audio rather than simply adding a second track: RTMP carries one audio
   * stream, and a MediaStream with two audio tracks gives MediaRecorder a
   * choice it makes silently (it takes the first). Summing them is the only way
   * both are actually heard.
   */
  private async buildAudioTrack(): Promise<MediaStreamTrack | null> {
    if (!this.stream) return null;
    const captured = this.stream.getAudioTracks();

    if (!this.opts.withMicrophone) return captured[0] ?? null;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.opts.onTrouble("The microphone wasn't available, so only the captured audio is going out.");
      return captured[0] ?? null;
    }

    const ctx = new AudioContext();
    this.audioContext = ctx;
    const destination = ctx.createMediaStreamDestination();

    if (captured.length > 0) {
      ctx.createMediaStreamSource(new MediaStream([captured[0]])).connect(destination);
    }
    ctx.createMediaStreamSource(this.micStream).connect(destination);

    return destination.stream.getAudioTracks()[0] ?? captured[0] ?? null;
  }

  /** Opens the socket and starts recording. `capture()` must have run first. */
  async start(): Promise<void> {
    if (!this.stream) throw new Error("Nothing is captured yet.");
    const mimeType = LiveSender.supportedMimeType();
    if (!mimeType) throw new Error("This browser can't record video. Use a recent Chrome or Edge.");

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("The capture has no video track.");

    const audioTrack = await this.buildAudioTrack();
    const outgoing = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack]);
    this.emit({ hasAudio: !!audioTrack });

    if (!audioTrack) {
      this.opts.onTrouble(
        "No audio is being captured. In Chrome's sharing dialog, pick the tab and tick “Also share tab audio”."
      );
    }

    /*
     * Checked after the awaits above, not before them. `buildAudioTrack` can
     * take a moment (it may ask for the microphone), and if the capture ends
     * during it — the operator pressing Chrome's "Stop sharing" — `fail()` has
     * already torn this sender down. Clearing `stopping` at that point revived
     * it: a MediaRecorder built on dead tracks, a rate timer left running for
     * the life of the tab, and a socket that made the relay restart ffmpeg for
     * a recording that would never produce a byte.
     */
    if (this.stats.state === "failed" || this.stats.state === "stopped") {
      this.teardown();
      throw new Error(this.stats.error ?? "The capture ended before the broadcast started.");
    }

    this.windowStart = performance.now();
    this.windowBytes = 0;

    /*
     * The recorder is constructed before the rate timer is installed, because
     * `new MediaRecorder` throws on a bitrate or mime type this browser
     * refuses — and a timer installed first would then keep firing `onStats`
     * for the life of the tab on a sender that never ran. `teardown()` here
     * also releases the microphone and AudioContext `buildAudioTrack` may just
     * have opened; the caller only gets to show an error.
     */
    try {
      this.recorder = new MediaRecorder(outgoing, {
        mimeType,
        videoBitsPerSecond: this.opts.videoBitrateKbps * 1000,
        audioBitsPerSecond: this.opts.audioBitrateKbps * 1000,
      });
    } catch (e) {
      this.stopping = true;
      this.teardown();
      throw new Error(
        e instanceof Error && e.message
          ? `This browser refused to record the stream: ${e.message}`
          : "This browser refused to record the stream."
      );
    }

    this.rateTimer = window.setInterval(() => {
      const elapsed = (performance.now() - this.windowStart) / 1000;
      if (elapsed <= 0) return;
      this.emit({ outKbps: Math.round((this.windowBytes * 8) / 1000 / elapsed) });
      this.windowBytes = 0;
      this.windowStart = performance.now();
    }, 2000);

    this.recorder.addEventListener("dataavailable", (event) => {
      const blob = event.data;
      if (!blob || blob.size === 0) return;
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      if (socket.bufferedAmount > MAX_BUFFERED) {
        /*
         * The upstream can't keep up, and queueing without limit grows until
         * the tab is killed. The fix is NOT to skip this chunk: a 400ms
         * timeslice is not an independently parseable unit, so dropping one
         * usually cuts a WebM cluster in half and every chunk after it lands
         * in a stream the relay's demuxer can no longer follow. The picture
         * would freeze on Facebook and YouTube for the rest of the broadcast
         * while this panel still showed a healthy bitrate.
         *
         * Closing the socket instead takes the reconnect path, which restarts
         * the recording — so the relay gets a fresh WebM header, which is
         * exactly what it restarts ffmpeg to receive. A second or two of gap,
         * then real pictures again.
         */
        const overruns = this.stats.overruns + 1;
        this.emit({ overruns });

        /*
         * Restarting only helps if the upload can carry the stream at all. Past
         * a handful of breaks it plainly cannot, and continuing to restart
         * leaves the operator watching "restarting the stream" for ever while
         * the relay respawns ffmpeg on every cycle. Saying so is more use than
         * another attempt.
         */
        if (overruns >= MAX_OVERRUNS) {
          this.fail(
            "The upload can't carry this broadcast — it has fallen behind " +
              `${overruns} times. End the broadcast and start again at a lower quality, or on a better connection.`
          );
          return;
        }

        this.opts.onTrouble("The upload fell behind — restarting the stream.");
        try {
          socket.close(1013, "upload behind");
        } catch {
          /* the close handler schedules the reconnect either way */
        }
        return;
      }

      socket.send(blob);
      this.windowBytes += blob.size;
      this.emit({ bytesSent: this.stats.bytesSent + blob.size });

      if (!this.announced) {
        this.announced = true;
        this.emit({ state: "streaming" });
        this.opts.onStreaming();
      }
    });

    this.recorder.addEventListener("error", () => {
      this.fail("The browser's recorder stopped unexpectedly.");
    });

    this.connect();
  }

  private connect() {
    // `stop()` and `fail()` both set this. A reconnect timer that fired in the
    // meantime must not open a socket for a sender that is finished — it would
    // make the relay restart ffmpeg for a recording that no longer exists.
    if (this.stopping) return;
    this.emit({ state: this.stats.reconnects > 0 ? "reconnecting" : "connecting", error: null });

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect("Couldn't open the connection to the relay.");
      return;
    }

    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      // The backoff is reset by a connection that *lasted*, not by one that
      // merely opened — see STABLE_CONNECTION_MS.
      if (this.stableTimer) window.clearTimeout(this.stableTimer);
      this.stableTimer = window.setTimeout(() => {
        this.stableTimer = null;
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) this.attempt = 0;
      }, STABLE_CONNECTION_MS);
      // The recorder is started only once the socket is up, so the WebM header
      // — which MediaRecorder writes exactly once per recording — is the first
      // thing the relay receives. Starting earlier would send the header into
      // a socket that does not exist yet and leave ffmpeg with a stream it
      // cannot demux.
      if (this.recorder && this.recorder.state === "inactive") {
        this.recorder.start(TIMESLICE_MS);
      }
      this.emit({ state: this.announced ? "streaming" : "connecting" });
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "failed") this.fail(String(msg.message || "The relay reported a failure."));
      } catch {
        /* the relay only sends our own control JSON */
      }
    });

    socket.addEventListener("close", (event) => {
      if (this.stopping) return;
      // A close from a socket we have already replaced says nothing about the
      // current one.
      if (this.socket !== socket) return;
      /*
       * 1008/1011 and a 401 handshake mean the relay refused us — a bad token,
       * an ended session — and reconnecting cannot fix that. Anything else is
       * treated as a network blip worth retrying, because the relay holds the
       * session open for 90 seconds precisely so this can recover.
       */
      if (event.code === 1008 || event.code === 1011) {
        this.fail(event.reason || "The relay closed the connection.");
        return;
      }
      this.scheduleReconnect("The connection to the relay dropped.");
    });

    socket.addEventListener("error", () => {
      // 'error' is always followed by 'close'; the reconnect is handled there.
    });
  }

  private scheduleReconnect(reason: string) {
    if (this.stopping) return;

    // A reconnect restarts the recording, because the relay restarts ffmpeg:
    // MediaRecorder writes a new WebM header per recording and feeding one
    // mid-stream breaks the demuxer. Stopping here keeps the two in step.
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;

    if (this.attempt > RECONNECT_DELAYS_MS.length) {
      this.fail(`${reason} Reconnecting didn't work.`);
      return;
    }

    this.emit({ state: "reconnecting", reconnects: this.stats.reconnects + 1, error: reason });
    this.opts.onTrouble(`${reason} Reconnecting…`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fail(message: string) {
    if (this.stats.state === "failed") return;
    /*
     * Before anything else, because `teardown()` closes the socket and a
     * client-initiated close arrives as code 1005 — which is not one of the
     * fatal codes, so the close handler would schedule a reconnect. Without
     * this line a failed sender came back a half-second later, told the
     * operator it was reconnecting, made the relay restart ffmpeg, and
     * reported "streaming" with no recorder left to send anything: a recovery
     * that could not happen, announced seven times.
     */
    this.stopping = true;
    this.emit({ state: "failed", error: message });
    this.opts.onFailed(message);
    this.teardown();
  }

  /** Ends cleanly: flush the recorder, tell the relay, release the devices. */
  async stop(): Promise<void> {
    if (this.stats.state === "stopped" || this.stats.state === "failed") {
      // Safe to call twice. Without this, a second End live would emit
      // "stopped" over a failure and wipe the error the operator needs to see.
      this.teardown();
      return;
    }
    this.stopping = true;

    // Cancelled here rather than in `teardown()` at the end: the 250ms wait
    // below is long enough for a pending backoff to fire, and `connect()`
    // would then replace `this.socket` with a CONNECTING one, so the EOS would
    // never be sent and the relay would hold the session open for 90 seconds
    // instead of flushing RTMP's end-of-stream.
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.recorder && this.recorder.state !== "inactive") {
      // `requestData` flushes whatever is buffered so the last second of the
      // broadcast isn't lost, then stop() ends the recording.
      try {
        this.recorder.requestData();
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }

    // Give the final chunk a moment to reach the socket before the EOS.
    await new Promise((r) => setTimeout(r, 250));

    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: "eos" }));
      } catch {
        /* nothing to do */
      }
    }

    this.emit({ state: "stopped" });
    this.teardown();
  }

  private teardown() {
    if (this.rateTimer) window.clearInterval(this.rateTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.stableTimer) window.clearTimeout(this.stableTimer);
    this.rateTimer = null;
    this.reconnectTimer = null;
    this.stableTimer = null;

    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.micStream = null;

    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.recorder = null;
  }

  get currentStream(): MediaStream | null {
    return this.stream;
  }
}
