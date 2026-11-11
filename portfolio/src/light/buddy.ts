import { t } from '../i18n';
import { BuddySim, PUFF_LIFE, type Anim, type Metrics, type Rect } from './buddy-sim';
import { reducedMotion } from './frame';

/**
 * The buddy: a pixel-art Dipu who lives on the glass panels of the light page. This
 * file is the DOM side (layout, canvas, pointer, the footer toggle); buddy-sim.ts is
 * the brain and knows nothing about the page.
 *
 * One layer in the document (page coordinates, clipped so it never widens the page)
 * holds a canvas that is moved with translate3d, a soft shadow, a few dust puffs and
 * a transparent button over his body: only that button takes pointer events. Press
 * and drag it and he hangs from the cursor by his hands; let go and he falls.
 */

const KEY = 'buddy';
const SMALL = 600; // below this viewport width the 64 px sheet is used
const PANELS = [
  '#lfooter',
  '#contact',
  '#tagline-text',
  '.card',
  '.sling',
  '#skills',
  '#languages',
  '#more-projects li',
  '#projects > h2',
  '#more-projects h3',
];
const LONG_PRESS = 300; // ms: a touch held this long grabs him
const DRAG = 4; // px a mouse must move with the button down before he is grabbed
const SLOP = 10; // px a finger may wander during the long press before it counts as a scroll
const BUBBLE_TIME = 1.1; // seconds the "!" shows after a grab
const BOB = 700; // ms per half breath

const ORDER: Anim[] = ['idle', 'walk', 'guard', 'jump', 'fall', 'land', 'hang', 'climb'];
const PHASED = new Set<Anim>(['walk', 'guard', 'climb', 'hang']); // frames follow distance (or drag speed), not the clock

// the "!" bubble: # outline, f fill, x mark
const BUBBLE_ART = ['.#####.', '#fffff#', '#ffxff#', '#ffxff#', '#ffxff#', '#fffff#', '#ffxff#', '#fffff#', '.#####.'];
const BUBBLE_COLOUR: Record<string, string> = { '#': '#1c2833', f: '#fff6d6', x: '#c8442b' };

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
interface Clip {
  loop: boolean;
  ms: number[];
  anchor: 'ground' | 'hand';
  stride?: number;
  frames: Frame[];
}
interface Manifest {
  size: [number, number];
  cell: [number, number];
  origin: [number, number];
  metrics: { body: [number, number]; climbHalf: number; grip: number; hang: number };
  animations: Record<Anim, Clip>;
}
interface Loaded {
  manifest: Manifest;
  img: HTMLImageElement;
  total: Record<string, number>; // loop length of each animation, ms
}

export class Buddy {
  private readonly toggle = document.getElementById('buddy-toggle') as HTMLButtonElement | null;
  private sim: BuddySim | null = null;
  private layer: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private shadow: HTMLDivElement | null = null;
  private hit: HTMLButtonElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private puffs: Array<{ c: HTMLCanvasElement; x: CanvasRenderingContext2D; shown: boolean }> = [];
  private sheets = new Map<string, Promise<Loaded>>();
  private cur: Loaded | null = null;
  private curName = '';
  private els: HTMLElement[] = [];
  private stops: Array<() => void> = []; // the toggle and the language hook: live from start() to stop()
  private pageStops: Array<() => void> = []; // everything that exists only while he is shown
  private off = false; // hidden by the visitor
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private inView = false;
  private raf = 0;
  private layoutRaf = 0;
  private last = 0;
  private started = false; // placed on the footer yet
  private key = -1; // what is currently painted, to skip identical frames
  private px = NaN;
  private py = NaN;
  private hitKind = '';
  private runId = 0; // bumped on stop so a late sheet load is dropped
  // pointer
  private down: { id: number; x: number; y: number; touch: boolean; timer: number; grabbed: boolean } | null = null;

  start(): void {
    const id = ++this.runId;
    this.off = this.stored();
    if (this.toggle) {
      this.toggle.hidden = false;
      this.toggle.addEventListener('click', this.onToggle);
      this.stops.push(() => this.toggle?.removeEventListener('click', this.onToggle));
    }
    const onLang = (): void => this.relabel();
    document.addEventListener('langchange', onLang);
    this.stops.push(() => document.removeEventListener('langchange', onLang));
    this.relabel();
    if (!this.off) void this.show(id);
  }

  stop(): void {
    this.runId++;
    this.hide();
    this.stops.forEach((s) => s());
    this.stops = [];
    this.sheets.clear();
    if (this.toggle) this.toggle.hidden = true;
  }

  // ------------------------------------------------------------ the toggle

  private stored(): boolean {
    try {
      return localStorage.getItem(KEY) === 'off';
    } catch {
      return false;
    }
  }

  private onToggle = (): void => {
    this.off = !this.off;
    try {
      localStorage.setItem(KEY, this.off ? 'off' : 'on');
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
    this.relabel();
    if (this.off) this.hide();
    else void this.show(this.runId);
  };

  private relabel(): void {
    if (this.toggle) this.toggle.textContent = this.off ? t('buddy.show', 'Show buddy') : t('buddy.hide', 'Hide buddy');
    this.hit?.setAttribute('aria-label', t('buddy.label', 'Buddy: press Enter to make him jump, or drag him around with the mouse'));
  }

  // --------------------------------------------------------------- showing

  /** Load a sheet once (the 80 px one, or the 64 px one for narrow screens). */
  private load(name: string): Promise<Loaded> {
    let p = this.sheets.get(name);
    if (!p) {
      p = Promise.all([
        fetch(`buddy/${name}.json`).then((r) => r.json() as Promise<Manifest>),
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `buddy/${name}.png`;
        }),
      ]).then(([manifest, img]) => {
        const total: Record<string, number> = {};
        for (const [k, c] of Object.entries(manifest.animations)) total[k] = c.ms.reduce((s, v) => s + v, 0);
        return { manifest, img, total };
      });
      p.catch(() => this.sheets.delete(name));
      this.sheets.set(name, p);
    }
    return p;
  }

  private sheetName(): string {
    return document.documentElement.clientWidth < SMALL ? 'sheet-sm' : 'sheet';
  }

  private async show(id: number): Promise<void> {
    if (this.layer) return;
    const name = this.sheetName();
    let loaded: Loaded;
    try {
      loaded = await this.load(name);
    } catch {
      return; // no sheet, no buddy; the page is fine without him
    }
    if (id !== this.runId || this.layer || this.off) return;
    this.cur = loaded;
    this.curName = name;
    this.build();
  }

  private build(): void {
    const layer = document.createElement('div');
    layer.id = 'lbuddy';
    const box = document.createElement('div');
    box.className = 'buddy';
    const shadow = document.createElement('div');
    shadow.className = 'buddy-shadow';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'buddy-hit';
    box.append(shadow, canvas, hit);
    layer.append(box);
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('canvas');
      c.className = 'buddy-puff';
      c.width = 28;
      c.height = 12;
      c.setAttribute('aria-hidden', 'true');
      layer.append(c);
      const x = c.getContext('2d')!;
      this.puffs.push({ c, x, shown: false });
    }
    document.body.append(layer);
    Object.assign(this, { layer, box, shadow, canvas, hit, ctx: canvas.getContext('2d') });
    this.ctx!.imageSmoothingEnabled = false;
    this.applySheet();

    const sim = new BuddySim();
    sim.still = reducedMotion();
    sim.setMetrics(this.metrics());
    this.sim = sim;
    this.started = false;
    this.relabel();

    this.on(hit, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.on(hit, 'click', (e) => {
      if ((e as MouseEvent).detail === 0) this.sim?.hop(); // Enter or Space; a mouse click is handled with the pointer
    });
    this.on(hit, 'contextmenu', (e) => {
      if (this.down?.touch) e.preventDefault(); // a long press must not open a menu
    });
    this.on(hit, 'dragstart', (e) => e.preventDefault());
    this.on(hit, 'touchmove', (e) => {
      if (this.down?.grabbed && e.cancelable) e.preventDefault(); // once grabbed, a drag moves him and does not scroll
    }, false);
    this.on(window, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.on(window, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.on(window, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    this.on(document, 'selectstart', (e) => {
      if (this.down?.grabbed) e.preventDefault();
    });
    this.on(window, 'resize', () => this.scheduleLayout());
    this.on(document, 'visibilitychange', () => this.sync());
    // the light page's reveals end with a transitionend: a panel may have settled
    this.on(document, 'transitionend', (e) => {
      if ((e.target as HTMLElement).classList?.contains('reveal')) this.scheduleLayout();
    });
    this.ro = new ResizeObserver(() => this.scheduleLayout());
    this.ro.observe(document.body);
    void document.fonts?.ready.then(() => this.scheduleLayout());
    this.io = new IntersectionObserver(
      (entries) => {
        this.inView = entries.some((en) => en.isIntersecting);
        this.sync();
      },
      { rootMargin: '100% 0px 100% 0px' },
    );
    this.io.observe(box);
    this.layout();
  }

  /** Add a listener that stop() removes. */
  private on(target: EventTarget, type: string, fn: (e: Event) => void, passive = true): void {
    target.addEventListener(type, fn, { passive });
    this.pageStops.push(() => target.removeEventListener(type, fn));
  }

  private hide(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf);
    if (this.down) window.clearTimeout(this.down.timer);
    this.down = null;
    document.documentElement.classList.remove('buddy-grabbing');
    this.raf = this.layoutRaf = 0;
    this.ro?.disconnect();
    this.io?.disconnect();
    this.ro = this.io = null;
    this.pageStops.forEach((s) => s());
    this.pageStops = [];
    this.layer?.remove();
    this.layer = this.box = this.shadow = this.hit = this.canvas = this.ctx = null;
    this.puffs = [];
    this.sim = null;
    this.cur = null;
    this.curName = '';
    this.inView = false;
    this.key = -1;
    this.px = this.py = NaN;
    this.hitKind = '';
    this.relabel();
  }

  // --------------------------------------------------------------- the sheet

  private metrics(): Metrics {
    const m = this.cur!.manifest;
    const a = m.animations;
    return {
      hw: m.metrics.body[0] - 2,
      bh: m.metrics.body[1],
      climbHalf: m.metrics.climbHalf,
      grip: m.metrics.grip,
      hang: m.metrics.hang,
      stride: { walk: a.walk.stride ?? 46, guard: a.guard.stride ?? 40, climb: a.climb.stride ?? 34 },
    };
  }

  /** Size the canvas, the shadow and the hit box for the current sheet. */
  private applySheet(): void {
    const m = this.cur!.manifest;
    this.canvas!.width = m.cell[0];
    this.canvas!.height = m.cell[1];
    this.canvas!.style.width = `${m.cell[0]}px`;
    this.canvas!.style.height = `${m.cell[1]}px`;
    this.ctx!.imageSmoothingEnabled = false;
    const [ox, oy] = m.origin;
    const hw = m.metrics.body[0];
    const sh = this.shadow!.style;
    sh.left = `${ox - hw}px`;
    sh.top = `${oy - 3}px`;
    sh.width = `${2 * hw}px`;
    sh.height = '6px';
    this.key = -1;
    this.hitKind = '';
  }

  /** The 80 px sheet on wide screens, the 64 px one on narrow ones: swapped when the viewport crosses the line. */
  private async swapSheet(): Promise<void> {
    const name = this.sheetName();
    if (name === this.curName || !this.sim) return;
    const id = this.runId;
    try {
      const loaded = await this.load(name);
      if (id !== this.runId || !this.sim || name === this.curName || name !== this.sheetName()) return;
      this.cur = loaded;
      this.curName = name;
      this.applySheet();
      this.sim.setMetrics(this.metrics());
      this.layout();
    } catch {
      /* keep the sheet he has */
    }
  }

  // ---------------------------------------------------------------- layout

  private scheduleLayout(): void {
    if (!this.layoutRaf) {
      this.layoutRaf = requestAnimationFrame(() => {
        this.layoutRaf = 0;
        this.layout();
      });
    }
  }

  /** Read the panels' rects (page coordinates) and hand them to the sim. Runs on resize, fonts, reveals; never per frame. */
  private layout(): void {
    const sim = this.sim;
    const layer = this.layer;
    if (!sim || !layer || !this.cur) return;
    void this.swapSheet();
    const width = document.documentElement.clientWidth;
    // the body's own bottom, not scrollHeight: a section that has not risen yet (a transform) must not stretch the page
    const height = Math.round(Math.max(window.innerHeight, document.body.getBoundingClientRect().bottom + window.scrollY + 24));
    layer.style.height = `${height}px`;

    const found: Array<{ el: HTMLElement; r: Rect }> = [];
    for (const sel of PANELS) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const r = pageRect(el);
        if (r.w < 40 || r.h < 20) return; // not laid out (hidden)
        found.push({ el, r });
      });
    }
    // a panel inside another (a button strip in a card) is not a platform of its own
    const list = found.filter((a) => !found.some((b) => b !== a && a.r.x >= b.r.x - 1 && a.r.y >= b.r.y - 1 && a.r.x + a.r.w <= b.r.x + b.r.w + 1 && a.r.y + a.r.h <= b.r.y + b.r.h + 1 && (a.r.w < b.r.w || a.r.h < b.r.h)));
    this.els = list.map((p) => p.el);
    sim.setWorld({ panels: list.map((p) => p.r), floor: height, width });
    if (!this.started) {
      const footer = this.els.indexOf(document.getElementById('lfooter') as HTMLElement) + 1;
      this.started = true;
      if (footer > 0 && sim.span(footer)[0] <= sim.span(footer)[1]) sim.place(footer, sim.platforms[footer].x + 56);
      else sim.place(0, 56);
      this.paint(true);
    }
    this.sync();
  }

  // -------------------------------------------------------------- the loop

  private sync(): void {
    const run = !!this.sim && this.started && (this.inView || !!this.down?.grabbed) && !document.hidden;
    if (run && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const sim = this.sim;
    if (!sim) return;
    const dt = (now - this.last) / 1000;
    this.last = now;
    sim.update(dt);
    this.paint(false);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** The frame to show: by walked distance for the cycles, by the clock for the rest. */
  private frameIndex(clip: Clip, name: Anim, sim: BuddySim, total: number): number {
    const n = clip.frames.length;
    // the sim counts six frames per stride; a cycle with fewer frames spreads them over the same stride
    if (PHASED.has(name)) return Math.floor((sim.phase * n) / 6) % n;
    if (sim.still && name === 'idle') return 0; // reduced motion: the stance, only the breathing bob
    let ms = sim.animTime * 1000;
    if (clip.loop) ms %= total;
    let i = 0;
    while (i < n - 1 && ms >= clip.ms[i]) {
      ms -= clip.ms[i];
      i++;
    }
    return i;
  }

  /** Move the box to the buddy and repaint the canvas only when the picture changes. */
  private paint(force: boolean): void {
    const sim = this.sim;
    const cur = this.cur;
    const box = this.box;
    const ctx = this.ctx;
    if (!sim || !cur || !box || !ctx) return;
    const m = cur.manifest;
    const name = sim.anim;
    const clip = m.animations[name];
    const i = this.frameIndex(clip, name, sim, cur.total[name]);
    const flip = sim.face === -1 ? 1 : 0;
    const bubble = sim.held && sim.bubbleT < BUBBLE_TIME ? 1 : 0;
    const key = ((ORDER.indexOf(name) * 8 + i) * 2 + flip) * 2 + bubble;
    if (force || key !== this.key) {
      this.key = key;
      const f = clip.frames[i];
      const [cw, ch] = m.cell;
      const [ox, oy] = m.origin;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (flip) ctx.setTransform(-1, 0, 0, 1, cw, 0); // the anchor sits on the centre line, so a flip keeps it put
      ctx.drawImage(cur.img, f.x, f.y, f.w, f.h, ox - f.ax, oy - f.ay, f.w, f.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bubble) this.drawBubble(ctx, ox + 7, oy - 16);
    }
    // the breathing bob: one pixel up for half of every breath, only while he stands at ease
    const bob = name === 'idle' && Math.floor((sim.animTime * 1000) / BOB) % 2 === 1 ? -1 : 0;
    const x = Math.round(sim.x - m.origin[0]);
    const y = Math.round(sim.y - m.origin[1]) + bob;
    if (x !== this.px || y !== this.py) {
      this.px = x;
      this.py = y;
      box.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    this.hitBox(clip.anchor);
    this.shadow!.style.opacity = sim.platform >= 0 && sim.anim !== 'land' ? '1' : sim.platform >= 0 ? '0.6' : '0';
    this.drawPuffs(sim);
  }

  /** The button covers his body only: standing (above the anchor) or hanging (below it). */
  private hitBox(kind: 'ground' | 'hand'): void {
    if (kind === this.hitKind || !this.cur || !this.hit) return;
    this.hitKind = kind;
    const m = this.cur.manifest;
    const [ox, oy] = m.origin;
    const [hw, bh] = m.metrics.body;
    const s = this.hit.style;
    s.left = `${ox - hw}px`;
    s.width = `${2 * hw}px`;
    s.top = `${kind === 'ground' ? oy - bh : oy}px`;
    s.height = `${kind === 'ground' ? bh : m.metrics.hang}px`;
  }

  /** A tiny pixel speech bubble with a "!" (drawn in code). */
  private drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    BUBBLE_ART.forEach((row, j) => {
      for (let k = 0; k < row.length; k++) {
        const c = row[k];
        if (c === '.') continue;
        ctx.fillStyle = BUBBLE_COLOUR[c];
        ctx.fillRect(x + k, y + j, 1, 1);
      }
    });
  }

  /** Dust puffs: a few pale pixels drifting out and up, in a small canvas of their own left where the dust rose. */
  private drawPuffs(sim: BuddySim): void {
    for (let i = 0; i < this.puffs.length; i++) {
      const slot = this.puffs[i];
      const p = sim.puffs[i];
      if (!p.on) {
        if (slot.shown) {
          slot.c.style.visibility = 'hidden';
          slot.shown = false;
        }
        continue;
      }
      const k = p.age / PUFF_LIFE;
      const c = slot.x;
      c.clearRect(0, 0, 28, 12);
      for (let j = 0; j < 5; j++) {
        const d = (j - 2) / 2;
        const px = 14 + d * (3 + k * 10);
        const py = 9 - k * 4 - Math.abs(d) * 1.5 * (1 - k);
        const size = k < 0.55 ? 3 : 2;
        c.fillStyle = k < 0.7 ? 'rgba(255, 251, 242, 0.95)' : 'rgba(255, 251, 242, 0.55)';
        c.fillRect(Math.round(px - size / 2), Math.round(py - size / 2), size, size);
      }
      slot.c.style.transform = `translate3d(${Math.round(p.x - 14)}px,${Math.round(p.y - 10)}px,0)`;
      if (!slot.shown) {
        slot.c.style.visibility = 'visible';
        slot.shown = true;
      }
    }
  }

  // --------------------------------------------------------------- pointer

  private onDown(e: PointerEvent): void {
    if (!this.sim || this.down) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    const d = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: 0, grabbed: false };
    this.down = d;
    if (touch) {
      // a long press grabs him; until then a swipe scrolls as it always does
      d.timer = window.setTimeout(() => {
        if (this.down === d) this.grab(e.pageX, e.pageY, d);
      }, LONG_PRESS);
    } else {
      e.preventDefault(); // no text selection, no drag ghost
      try {
        this.hit?.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
  }

  private onMove(e: PointerEvent): void {
    const sim = this.sim;
    if (!sim) return;
    const d = this.down;
    if (d && e.pointerId === d.id) {
      if (!d.grabbed) {
        const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
        if (!d.touch && far > DRAG) this.grab(e.pageX, e.pageY, d);
        else if (d.touch && far > SLOP) this.endPress();
      } else {
        sim.drag(e.pageX, e.pageY);
        return;
      }
    }
    if (e.pointerType !== 'touch') sim.pointer(e.pageX, e.pageY);
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    const sim = this.sim;
    const wasGrabbed = d.grabbed;
    this.endPress();
    if (!sim) return;
    if (wasGrabbed) sim.release();
    else if (e.type === 'pointerup') sim.hop(); // a click or a tap
  }

  private grab(px: number, py: number, d: { id: number; grabbed: boolean }): void {
    const sim = this.sim;
    if (!sim) return;
    d.grabbed = true;
    sim.grab(px, py);
    try {
      this.hit?.setPointerCapture(d.id);
    } catch {
      /* the pointer is already gone */
    }
    this.hit?.classList.add('grabbing');
    if (this.hit) this.hit.style.touchAction = 'none';
    document.documentElement.classList.add('buddy-grabbing');
    this.sync();
  }

  private endPress(): void {
    const d = this.down;
    if (!d) return;
    window.clearTimeout(d.timer);
    try {
      this.hit?.releasePointerCapture(d.id);
    } catch {
      /* not captured */
    }
    this.hit?.classList.remove('grabbing');
    if (this.hit) this.hit.style.touchAction = '';
    document.documentElement.classList.remove('buddy-grabbing');
    this.down = null;
  }
}

/** The element's box in page coordinates from layout offsets, so the 32 px a section has not yet risen (a transform) does not count. */
function pageRect(el: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
    x += e.offsetLeft;
    y += e.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
