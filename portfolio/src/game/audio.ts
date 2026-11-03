/**
 * Synthesised sound effects (Web Audio, no files). Created lazily on the first
 * user gesture; muted by default; the choice is remembered in localStorage.
 */

const KEY = 'portfolio-sound';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = true;

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) !== 'on';
    } catch {
      /* storage unavailable */
    }
  }

  /** Release the audio device (the game is being disposed). */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
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
      this.master.gain.value = 0.2;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol = 1,
    when = 0,
  ): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.6, hp = 800): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  bumper(): void {
    const p = 1 + (Math.random() - 0.5) * 0.2;
    this.tone('square', 640 * p, 420 * p, 0.09, 0.55);
  }
  sling(): void {
    this.tone('square', 300, 520, 0.07, 0.5);
  }
  flipper(): void {
    this.tone('triangle', 130, 70, 0.07, 0.9);
  }
  card(): void {
    this.tone('sine', 880, 880, 0.14, 0.6);
    this.tone('sine', 1320, 1320, 0.22, 0.5, 0.07);
  }
  lane(): void {
    this.tone('sine', 1040, 1560, 0.12, 0.45);
  }
  special(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.12, 0.4, i * 0.09));
  }
  drain(): void {
    this.tone('sawtooth', 520, 70, 0.7, 0.5);
  }
  launch(): void {
    this.noise(0.25, 0.5, 1200);
    this.tone('sawtooth', 180, 700, 0.3, 0.35);
  }
  save(): void {
    this.tone('sine', 660, 990, 0.2, 0.5);
    this.tone('sine', 990, 1320, 0.2, 0.5, 0.12);
  }
  start(): void {
    this.tone('square', 392, 392, 0.1, 0.4);
    this.tone('square', 523, 523, 0.1, 0.4, 0.1);
    this.tone('square', 784, 784, 0.2, 0.4, 0.2);
  }
  gameOver(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone('square', f, f * 0.98, 0.25, 0.4, i * 0.22));
  }
}
