import { audioState, faderToGain, type AudioState } from "@/lib/studio";

/**
 * The studio's audio mixer. Real Web Audio, not decorative bars: every
 * channel is a GainNode with an AnalyserNode after it, so the meters show the
 * actual signal and "No signal" means the track really has been near-silent.
 *
 * Monitoring (hearing program on the operator's own speakers) is **off by
 * default**. A studio machine with an open microphone and monitoring on is a
 * feedback loop, and that is not a mistake to discover live on air.
 *
 * Program audio can't be sent anywhere yet — that needs the Live Studio relay.
 * Until then this mixes what the operator hears and what a screen capture of
 * the browser picks up.
 */

export type ChannelState = {
  id: string;
  label: string;
  fader: number;
  muted: boolean;
  solo: boolean;
  peak: number;
  state: AudioState;
  /** Whether this channel has an audio track at all. */
  hasAudio: boolean;
};

type Channel = {
  id: string;
  label: string;
  fader: number;
  muted: boolean;
  solo: boolean;
  gain: GainNode;
  analyser: AnalyserNode;
  /** Explicitly over an ArrayBuffer: TypeScript 5.7+ distinguishes
      Float32Array<ArrayBuffer> from the SharedArrayBuffer-capable variant, and
      getFloatTimeDomainData only accepts the former. */
  buffer: Float32Array<ArrayBuffer>;
  source: AudioNode;
  kind: "stream" | "element";
  silentSince: number | null;
  peak: number;
  hasAudio: boolean;
};

export class StudioAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private monitor: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterBuffer = new Float32Array(new ArrayBuffer(1024 * 4));
  private channels = new Map<string, Channel>();
  /** An element can only be wrapped in a MediaElementSource once, ever. */
  private elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  /** Which channel an element is currently wired to, so re-using the same
   *  <video> for a different clip can't leave two gains summing it. */
  private elementChannel = new WeakMap<HTMLMediaElement, string>();
  private monitorOn: boolean;
  private masterFader: number;
  private disposed = false;

  constructor(options: { master?: number; monitor?: boolean } = {}) {
    // Saved settings have to reach the graph the moment it's created, or the
    // UI would show a master of 20 while the output ran at unity.
    this.masterFader = options.master ?? 80;
    this.monitorOn = options.monitor ?? false;
  }

  /** Created lazily on a user gesture — browsers won't start one otherwise. */
  private context() {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    const monitor = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.gain.value = faderToGain(this.masterFader);
    monitor.gain.value = this.monitorOn ? 1 : 0;
    master.connect(analyser);
    analyser.connect(monitor);
    monitor.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.monitor = monitor;
    this.masterAnalyser = analyser;
    return ctx;
  }

  async resume() {
    const ctx = this.context();
    if (ctx && ctx.state === "suspended") await ctx.resume();
  }

  get ready() {
    return !!this.ctx;
  }

  attachStream(id: string, label: string, stream: MediaStream) {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const hasAudio = stream.getAudioTracks().length > 0;
    if (!hasAudio) {
      // Still register the channel so the operator sees it exists and is
      // silent, rather than the fader quietly missing from the mixer.
      this.registerSilent(id, label);
      return;
    }
    this.detach(id);
    const source = ctx.createMediaStreamSource(stream);
    this.wire(id, label, source, "stream", true);
  }

  attachElement(id: string, label: string, element: HTMLMediaElement) {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    // If this element was feeding another channel (the same <video> reused for
    // a different clip), retire that channel first — otherwise the clip is
    // summed twice and a phantom fader stays in the mixer.
    const previousId = this.elementChannel.get(element);
    if (previousId && previousId !== id) this.detach(previousId);
    this.detach(id);
    let source = this.elementSources.get(element);
    if (!source) {
      try {
        source = ctx.createMediaElementSource(element);
      } catch {
        // Already wrapped by a disposed context, or not allowed — the clip
        // still plays, it just isn't in the mixer.
        return;
      }
      this.elementSources.set(element, source);
    }
    this.elementChannel.set(element, id);
    this.wire(id, label, source, "element", true);
  }

  private registerSilent(id: string, label: string) {
    const existing = this.channels.get(id);
    if (existing) {
      // Drop whatever was feeding it: a replacement stream with no audio track
      // must not leave the old one audible under a "No signal" meter.
      this.detach(id);
    }
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    gain.connect(analyser);
    analyser.connect(this.master);
    this.channels.set(id, {
      id,
      label,
      fader: 80,
      muted: false,
      solo: false,
      gain,
      analyser,
      buffer: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      source: gain,
      kind: "stream",
      silentSince: Date.now(),
      peak: 0,
      hasAudio: false,
    });
  }

  private wire(id: string, label: string, source: AudioNode, kind: "stream" | "element", hasAudio: boolean) {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const previous = this.channels.get(id);
    const fader = previous?.fader ?? 80;
    const muted = previous?.muted ?? false;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(this.master!);
    gain.gain.value = muted ? 0 : faderToGain(fader);
    this.channels.set(id, {
      id,
      label,
      fader,
      muted,
      solo: previous?.solo ?? false,
      gain,
      analyser,
      buffer: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      source,
      kind,
      silentSince: null,
      peak: 0,
      hasAudio,
    });
    this.applySolo();
  }

  detach(id: string) {
    const channel = this.channels.get(id);
    if (!channel) return;
    try {
      channel.gain.disconnect();
      channel.analyser.disconnect();
      // A MediaElementSource stays attached to its element for the element's
      // whole life — disconnecting the node is as far as we can undo it.
      if (channel.kind === "stream") channel.source.disconnect();
    } catch {
      // Already torn down.
    }
    this.channels.delete(id);
    this.applySolo();
  }

  setFader(id: string, value: number) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.fader = Math.min(100, Math.max(0, Math.round(value)));
    this.applyGain(channel);
  }

  setMuted(id: string, muted: boolean) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.muted = muted;
    this.applyGain(channel);
  }

  toggleSolo(id: string) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.solo = !channel.solo;
    this.applySolo();
  }

  /** Solo is exclusive-ish: any soloed channel silences the un-soloed ones. */
  private applySolo() {
    const anySolo = Array.from(this.channels.values()).some((c) => c.solo);
    for (const channel of this.channels.values()) {
      channel.gain.gain.value = channel.muted || (anySolo && !channel.solo) ? 0 : faderToGain(channel.fader);
    }
    void anySolo;
  }

  private applyGain(channel: Channel) {
    const anySolo = Array.from(this.channels.values()).some((c) => c.solo);
    channel.gain.gain.value = channel.muted || (anySolo && !channel.solo) ? 0 : faderToGain(channel.fader);
  }

  setMaster(value: number) {
    this.masterFader = Math.min(100, Math.max(0, Math.round(value)));
    if (this.master) this.master.gain.value = faderToGain(this.masterFader);
  }

  setMonitor(on: boolean) {
    this.monitorOn = on;
    if (this.monitor) this.monitor.gain.value = on ? 1 : 0;
  }

  /** One pass over every analyser. Called on a timer by the console. */
  read(): { channels: ChannelState[]; masterPeak: number } {
    const channels: ChannelState[] = [];
    if (this.disposed || !this.ctx) return { channels, masterPeak: 0 };
    const now = Date.now();
    for (const channel of this.channels.values()) {
      let peak = 0;
      if (channel.hasAudio) {
        channel.analyser.getFloatTimeDomainData(channel.buffer);
        for (let i = 0; i < channel.buffer.length; i++) {
          const v = Math.abs(channel.buffer[i]);
          if (v > peak) peak = v;
        }
      }
      // Decay so the meter falls smoothly instead of flickering.
      channel.peak = Math.max(peak, channel.peak * 0.82);
      if (peak < 0.01) channel.silentSince ??= now;
      else channel.silentSince = null;
      channels.push({
        id: channel.id,
        label: channel.label,
        fader: channel.fader,
        muted: channel.muted,
        solo: channel.solo,
        peak: channel.peak,
        hasAudio: channel.hasAudio,
        state: channel.hasAudio
          ? audioState(channel.peak, channel.muted, channel.silentSince ? now - channel.silentSince : 0)
          : "silent",
      });
    }
    let masterPeak = 0;
    if (this.masterAnalyser) {
      this.masterAnalyser.getFloatTimeDomainData(this.masterBuffer);
      for (let i = 0; i < this.masterBuffer.length; i++) {
        const v = Math.abs(this.masterBuffer[i]);
        if (v > masterPeak) masterPeak = v;
      }
    }
    return { channels, masterPeak };
  }

  close() {
    this.disposed = true;
    for (const id of Array.from(this.channels.keys())) this.detach(id);
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.monitor = null;
    this.masterAnalyser = null;
  }
}
