/**
 * Lights on/off sequencing and hit flashes.
 *
 * "Lights off" dims decorations only (neon, glow, chrome, playfield art), never
 * text. The turn-on sequence is a single class change (`.lights-on` on #stage);
 * per-element `--delay` custom properties produce the stagger:
 *
 *   0 ms     the left panel's name flickers (2 quick flickers)
 *   150 ms   rim lamps chase on, 20 ms per lamp; traces power up
 *   500 ms   bumpers pop on one by one; the die's pin lamps wake
 *   800 ms   cards light up row by row
 *   1000 ms  arrow inserts
 *   1200 ms  rollover lamps, playfield brightens
 *   1400 ms  (game.ts) ball appears in the plunger lane
 *
 * With prefers-reduced-motion the CSS zeroes all delays/animations.
 */

export const LIGHTS_ON_MS = 1400;
export const FADE_OFF_MS = 1500;

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const sec = (ms: number): string => `${(ms / 1000).toFixed(3)}s`;

export class Lights {
  private readonly stage: HTMLElement;
  private flashTimers = new Map<string, number>();
  private pulseTimers = new Map<string, number>();
  private pinHead = 0;
  private offTimer = 0;
  private flickerTimer = 0;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.assignDelays();
  }

  private assignDelays(): void {
    const set = (el: Element | null, ms: number): void => {
      if (el instanceof HTMLElement || el instanceof SVGElement) el.style.setProperty('--delay', sec(ms));
    };
    const q = (sel: string): Element[] => Array.from(this.stage.querySelectorAll(sel));
    q('#rim-lamps .lamp').forEach((l, i) => {
      set(l, 150 + i * 20);
      (l as SVGElement).style.setProperty('--twinkle', sec(-(i * 170)));
    });
    q('#rails .rail, #rails .rail-hi, #rails .guide, #rails .gate, #rails .post, #rails .post-ring').forEach((l) =>
      set(l, 150),
    );
    q('#traces .tr').forEach((l, i) => set(l, 250 + (i % 8) * 40));
    q('#die .pin').forEach((l, i) => set(l, 600 + i * 16));
    q('#arrows .arrow').forEach((l) => set(l, 1000 + Number((l as SVGElement).style.getPropertyValue('--row') || 0) * 90));
    q('.bumper').forEach((b, i) => set(b, 500 + i * 60));
    q('.card').forEach((c) => {
      const row = Math.floor(q('.card').indexOf(c) / 2);
      set(c, 800 + row * 130);
      set(document.getElementById(`outline-${c.id}`), 800 + row * 130);
      (c as HTMLElement).style.setProperty('--chase', String(q('.card').indexOf(c)));
    });
    q('.sling').forEach((s) => {
      set(s, 1000);
      set(document.getElementById(`outline-${s.id}`), 1000);
    });
    q('.lane').forEach((l, i) => set(l, 1200 + i * 40));
    set(document.getElementById('playfield'), 1200);
  }

  /** The panels sit outside the stage; they follow the same lit / flicker state via <html>. */
  private readonly root = document.documentElement;

  on(): void {
    window.clearTimeout(this.offTimer);
    this.stage.classList.remove('fading');
    this.stage.classList.add('lights-on');
    this.root.classList.add('lit');
    if (!prefersReducedMotion()) {
      this.root.classList.remove('flicker');
      void this.root.offsetWidth; // restart the animation
      this.root.classList.add('flicker');
      window.clearTimeout(this.flickerTimer);
      this.flickerTimer = window.setTimeout(() => this.root.classList.remove('flicker'), 700);
    }
  }

  /** Fade back to the dim state over ~1.5 s. */
  off(): void {
    window.clearTimeout(this.offTimer);
    this.stage.classList.remove('running', 'chase');
    this.root.classList.remove('flicker', 'lit');
    if (prefersReducedMotion()) {
      this.stage.classList.remove('lights-on');
      return;
    }
    this.stage.classList.add('fading');
    this.stage.classList.remove('lights-on');
    this.offTimer = window.setTimeout(() => this.stage.classList.remove('fading'), FADE_OFF_MS + 100);
  }

  /** Immediately dark, no fade (used when leaving table mode). */
  reset(): void {
    window.clearTimeout(this.offTimer);
    this.stage.classList.remove('lights-on', 'fading', 'running', 'chase', 'shake');
    this.root.classList.remove('lit', 'flicker');
    this.clearState();
  }

  setRunning(on: boolean): void {
    this.stage.classList.toggle('running', on && !prefersReducedMotion());
  }

  /** Brief 'hit' flash on a table object (DOM element and its SVG outline). */
  flash(id: string, ms = 120): void {
    const els = this.targets(id);
    if (!els.length) return;
    for (const e of els) e.classList.add('hit');
    // ring pulse: restart the CSS animation, drop the class once it has played
    if (!prefersReducedMotion()) {
      for (const e of els) {
        e.classList.remove('pulse');
        if (e instanceof HTMLElement) void e.offsetWidth;
        e.classList.add('pulse');
      }
      window.clearTimeout(this.pulseTimers.get(id));
      this.pulseTimers.set(
        id,
        window.setTimeout(() => {
          for (const e of els) e.classList.remove('pulse');
        }, 560),
      );
    }
    window.clearTimeout(this.flashTimers.get(id));
    this.flashTimers.set(
      id,
      window.setTimeout(() => {
        for (const e of els) e.classList.remove('hit');
      }, ms),
    );
  }

  mark(id: string, cls: string, on = true): void {
    for (const e of this.targets(id)) e.classList.toggle(cls, on);
  }

  clearState(): void {
    this.stage
      .querySelectorAll('.visited, .lit, .hit, .pulse, .chase-pin, .filled')
      .forEach((e) => e.classList.remove('visited', 'lit', 'hit', 'pulse', 'chase-pin', 'filled'));
  }

  /** A bumper was hit: a short run of the die's pin lamps lights up and moves on round the chip. */
  pinChase(): void {
    const pins = Array.from(this.stage.querySelectorAll('#die .pin'));
    if (!pins.length) return;
    this.pinHead = (this.pinHead + 5) % pins.length;
    for (let k = 0; k < 5; k++) {
      const pin = pins[(this.pinHead + k) % pins.length];
      pin.classList.add('chase-pin');
      window.setTimeout(() => pin.classList.remove('chase-pin'), 260 + k * 70);
    }
  }

  /** The bonus multiplier (1..5) fills the die's pin lamps: 1x is empty, 5x is full. */
  setBonusFill(mult: number): void {
    const pins = Array.from(this.stage.querySelectorAll('#die .pin'));
    const n = Math.round(((Math.max(1, Math.min(5, mult)) - 1) / 4) * pins.length);
    pins.forEach((p, i) => p.classList.toggle('filled', i < n));
  }

  chase(): void {
    if (prefersReducedMotion()) return;
    this.stage.classList.remove('chase');
    void this.stage.offsetWidth;
    this.stage.classList.add('chase');
    window.setTimeout(() => this.stage.classList.remove('chase'), 1400);
  }

  shake(): void {
    if (prefersReducedMotion()) return;
    this.stage.classList.remove('shake');
    void this.stage.offsetWidth;
    this.stage.classList.add('shake');
    window.setTimeout(() => this.stage.classList.remove('shake'), 400);
  }

  private targets(id: string): Element[] {
    const out: Element[] = [];
    const main = document.getElementById(id);
    if (main) out.push(main);
    const outline = document.getElementById(`outline-${id}`);
    if (outline) out.push(outline);
    const lamp = document.getElementById(`lamp-${id}`);
    if (lamp) out.push(lamp);
    return out;
  }
}
