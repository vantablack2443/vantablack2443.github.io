import { onFrameScroll, reducedMotion } from './frame';

/**
 * Floating pollen: 25 to 40 tiny warm dots drifting up and sideways with a
 * slow flicker. One canvas, DPR capped at 2, paused when the tab is hidden or
 * the page is scrolled past the hero. Not started under reduced motion.
 */

interface Mote {
  x: number; // px
  y: number;
  r: number; // radius px
  vy: number; // px/s (negative = up)
  sway: number; // px amplitude
  freq: number; // rad/s
  phase: number;
  flick: number; // rad/s
  a: number; // base alpha
}

export class Motes {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sprite: HTMLCanvasElement | null = null;
  private motes: Mote[] = [];
  private raf = 0;
  private last = 0;
  private t = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private stops: Array<() => void> = [];
  private pastHero = false;

  start(): void {
    if (reducedMotion()) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'lmotes';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;
    this.sprite = makeSprite();
    this.resize();
    this.populate();

    const onResize = (): void => {
      this.resize();
      this.populate();
    };
    window.addEventListener('resize', onResize);
    this.stops.push(() => window.removeEventListener('resize', onResize));

    const onVis = (): void => this.sync();
    document.addEventListener('visibilitychange', onVis);
    this.stops.push(() => document.removeEventListener('visibilitychange', onVis));

    this.stops.push(
      onFrameScroll((y) => {
        this.pastHero = y > window.innerHeight * 0.9;
        this.sync();
      }),
    );
    this.sync();
  }

  private sync(): void {
    const should = !document.hidden && !this.pastHero;
    if (should && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!should && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.ctx?.clearRect(0, 0, this.w * this.dpr, this.h * this.dpr);
    }
  }

  private resize(): void {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private populate(): void {
    const n = Math.round(Math.min(40, Math.max(25, (this.w * this.h) / 36000)));
    this.motes = Array.from({ length: n }, () => this.spawn(true));
  }

  private spawn(anywhere: boolean): Mote {
    const rnd = Math.random;
    return {
      x: rnd() * this.w,
      y: anywhere ? rnd() * this.h : this.h + 10,
      r: 0.8 + rnd() * 1.6,
      vy: -(6 + rnd() * 12),
      sway: 8 + rnd() * 22,
      freq: 0.25 + rnd() * 0.5,
      phase: rnd() * Math.PI * 2,
      flick: 0.8 + rnd() * 1.6,
      a: 0.35 + rnd() * 0.45,
    };
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const ctx = this.ctx;
    const sprite = this.sprite;
    if (!ctx || !sprite) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const m of this.motes) {
      m.y += m.vy * dt;
      if (m.y < -10) Object.assign(m, this.spawn(false));
      const x = m.x + Math.sin(this.t * m.freq + m.phase) * m.sway;
      const alpha = m.a * (0.65 + 0.35 * Math.sin(this.t * m.flick + m.phase * 2));
      const size = m.r * 6; // the sprite has a soft halo
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - size / 2, m.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.frame);
  };

  stop(): void {
    this.stops.forEach((s) => s());
    this.stops = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.sprite = null;
    this.motes = [];
    this.pastHero = false;
  }
}

/** A small pre-rendered warm white dot with a soft halo, drawn scaled for every mote. */
function makeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255, 250, 232, 1)');
  grad.addColorStop(0.18, 'rgba(255, 248, 226, 0.85)');
  grad.addColorStop(0.5, 'rgba(255, 244, 214, 0.18)');
  grad.addColorStop(1, 'rgba(255, 244, 214, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}
