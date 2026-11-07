/**
 * A tiny Web Audio synth for the river: paddle splash, lantern chime, dock bell and a few
 * jingles. No files. Off by default; the choice is remembered. Created lazily on the first
 * user gesture (browsers refuse audio before one).
 */

const KEY = 'portfolio-sound';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = true;

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) !== 'on';
    } catch {
      /* storage unavailable: off for this visit */
    }
  }

  /** Release the audio device (the game is being disposed). */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? 'off' : 'on');
    } catch {
      /* ignore */
    }
    if (!m) this.unlock();
  }

  /** Call from a user gesture. */
  unlock(): void {
    if (this.muted) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 1, when = 0): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** White noise, made once (0.6 s). */
  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const n = Math.floor(ctx.sampleRate * 0.6);
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** A burst of filtered noise: water. */
  private splash(dur: number, vol: number, freq: number): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq * 1.8, t);
    f.frequency.exponentialRampToValueAtTime(freq, t + dur);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /**
   * A soft rush of air or water: noise through a low-pass filter that sweeps open and closed,
   * with a slow fade in (no click, no thump).
   */
  private woosh(dur: number, vol: number, lo: number, hi: number, when = 0): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const peak = t + dur * 0.4;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(lo, t);
    f.frequency.exponentialRampToValueAtTime(hi, peak);
    f.frequency.exponentialRampToValueAtTime(lo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, peak);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** A paddle stroke: the blade sweeping through the water, then a little trickle off it. */
  stroke(): void {
    const p = 1 + (Math.random() - 0.5) * 0.2;
    this.woosh(0.42, 0.55, 260 * p, 1400 * p);
    this.woosh(0.22, 0.12, 1800 * p, 3200 * p, 0.3);
  }
  lantern(): void {
    const p = 1 + (Math.random() - 0.5) * 0.06;
    this.tone('sine', 1318 * p, 1318 * p, 0.7, 0.4);
    this.tone('sine', 1976 * p, 1976 * p, 0.5, 0.22, 0.04);
    this.tone('sine', 2637 * p, 2637 * p, 0.35, 0.1, 0.08);
  }
  bell(): void {
    for (const [mul, vol, dur] of [
      [1, 0.5, 1.8],
      [2.76, 0.22, 1.1],
      [5.4, 0.1, 0.6],
    ]) {
      this.tone('sine', 523 * mul, 523 * mul, dur, vol);
    }
  }
  bump(): void {
    this.tone('sine', 110, 55, 0.22, 0.8);
    this.splash(0.2, 0.5, 300);
  }
  /** A crocodile lunges: a low splash and a growl-like burst. */
  lunge(): void {
    this.splash(0.5, 0.8, 190);
    this.tone('sawtooth', 96, 46, 0.55, 0.4);
    this.tone('square', 61, 36, 0.5, 0.18, 0.04);
  }
  /** It bites: a heavy thud, splash and a rasp. */
  bite(): void {
    this.splash(0.6, 0.9, 240);
    this.tone('sawtooth', 130, 38, 0.6, 0.55);
    this.tone('sine', 70, 40, 0.45, 0.7);
  }
  start(): void {
    [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.3, i * 0.11));
  }
  release(): void {
    this.splash(0.25, 0.4, 420);
  }
  celebrate(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.35, i * 0.12));
  }
  end(): void {
    [440, 392, 330, 262].forEach((f, i) => this.tone('sine', f, f * 0.99, 0.5, 0.3, i * 0.2));
  }
}
