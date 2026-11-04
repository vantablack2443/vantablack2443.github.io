/**
 * Keyboard and touch into a paddle vector. The caller gets a vector (x right, z away from the
 * viewer, length 0..1), tap targets, pause toggles and start requests; everything is removed
 * again in dispose().
 *
 *   keyboard   arrows or WASD, eight directions (two keys make a diagonal, normalised)
 *   touch      a virtual stick appears where the finger lands (anywhere on the canvas below the
 *              HUD): the drag's direction and distance set the paddle direction and strength
 *   a short tap on the water sets a target point the boat paddles toward (touch and mouse)
 */

export interface InputHandlers {
  /** A night is running: arrows and Space are taken (the page does not scroll in dark anyway). */
  isPlaying(): boolean;
  /** A dialog is open: leave the keys alone. */
  isModalOpen(): boolean;
  /** The paddle vector changed (length up to 1). Keys and the stick cancel a tap target. */
  setVec(x: number, z: number): void;
  /** A short tap on the water, in CSS pixels. */
  onTap(clientX: number, clientY: number): void;
  /** Screen y (client) above which touches are the HUD's, not the river's. */
  topLimit(): number;
  onPauseToggle(): void;
  onStart(): void;
  /** Any key or pointer press, so audio can be unlocked. */
  onGesture(): void;
}

const CODES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  KeyW: [0, 1],
  ArrowDown: [0, -1],
  KeyS: [0, -1],
};

/** How far the finger drags for full strength (px), the dead zone, and what still counts as a tap. */
const STICK_R = 64;
const DEAD = 10;
const TAP_PX = 14;
const TAP_MS = 320;

export class Input {
  private readonly h: InputHandlers;
  private readonly area: HTMLElement;
  private readonly stick: HTMLElement | null;
  private readonly knob: HTMLElement | null;
  private readonly keys = new Set<string>();
  private pointer = -1;
  private sx = 0;
  private sy = 0;
  private t0 = 0;
  private dragging = false;
  private disposers: Array<() => void> = [];

  constructor(area: HTMLElement, handlers: InputHandlers, stick: HTMLElement | null = null) {
    this.h = handlers;
    this.area = area;
    this.stick = stick;
    this.knob = stick?.querySelector('i') ?? null;
    this.bind();
  }

  private on(t: EventTarget, type: string, fn: (e: never) => void, opt?: AddEventListenerOptions): void {
    t.addEventListener(type, fn as EventListener, opt);
    this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opt));
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.keys.clear();
    this.showStick(false);
  }

  /** Let go of everything (pause, blur, the end of the night). */
  releaseAll(): void {
    this.keys.clear();
    this.pointer = -1;
    this.dragging = false;
    this.showStick(false);
    this.h.setVec(0, 0);
  }

  private pushKeys(): void {
    let x = 0;
    let z = 0;
    for (const c of this.keys) {
      x += CODES[c][0];
      z += CODES[c][1];
    }
    const m = Math.hypot(x, z);
    this.h.setVec(m > 1 ? x / m : x, m > 1 ? z / m : z);
  }

  private showStick(on: boolean, ox = 0, oy = 0, kx = 0, ky = 0): void {
    if (!this.stick) return;
    this.stick.toggleAttribute('data-on', on);
    if (!on) return;
    this.stick.style.transform = `translate(${ox}px, ${oy}px)`;
    if (this.knob) this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  private bind(): void {
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.h.isModalOpen()) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const playing = this.h.isPlaying();
      if (e.code in CODES) e.preventDefault();

      if (e.code === 'Enter' && !playing) {
        // a focused button or link does its own thing
        const t = e.target;
        if (!(t instanceof Element) || !t.closest('button, a, summary')) {
          this.h.onGesture();
          this.h.onStart();
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP') {
        if (!playing) return;
        e.preventDefault();
        if (!e.repeat) this.h.onPauseToggle();
        return;
      }
      if (!playing || !(e.code in CODES)) return;
      this.h.onGesture();
      this.keys.add(e.code);
      this.pushKeys();
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => {
      if (this.keys.delete(e.code)) this.pushKeys();
    });
    this.on(window, 'blur', () => this.releaseAll());

    // touch: a stick where the finger lands; a short tap is a target (the mouse only taps)
    this.on(this.area, 'pointerdown', (e: PointerEvent) => {
      if (!this.h.isPlaying() || this.h.isModalOpen() || this.pointer >= 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.clientY < this.h.topLimit()) return;
      this.h.onGesture();
      e.preventDefault();
      try {
        this.area.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.pointer = e.pointerId;
      this.sx = e.clientX;
      this.sy = e.clientY;
      this.t0 = performance.now();
      this.dragging = false;
    });
    this.on(this.area, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointer || e.pointerType === 'mouse') return;
      const dx = e.clientX - this.sx;
      const dy = e.clientY - this.sy;
      const d = Math.hypot(dx, dy);
      if (!this.dragging && d < DEAD) return;
      if (!this.dragging) {
        this.dragging = true;
        this.keys.clear();
      }
      const k = Math.min(1, d / STICK_R);
      const r = this.area.getBoundingClientRect();
      const ux = dx / (d || 1);
      const uy = dy / (d || 1);
      this.h.setVec(ux * k, -uy * k);
      this.showStick(true, this.sx - r.left, this.sy - r.top, ux * k * STICK_R * 0.6, uy * k * STICK_R * 0.6);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointer) return;
      const tap = !this.dragging && Math.hypot(e.clientX - this.sx, e.clientY - this.sy) < TAP_PX && performance.now() - this.t0 < TAP_MS;
      const wasDragging = this.dragging;
      this.pointer = -1;
      this.dragging = false;
      this.showStick(false);
      if (wasDragging) this.h.setVec(0, 0);
      else if (tap && e.type === 'pointerup') this.h.onTap(e.clientX, e.clientY);
    };
    this.on(this.area, 'pointerup', up);
    this.on(this.area, 'pointercancel', up);
    this.on(this.area, 'lostpointercapture', (e: PointerEvent) => {
      if (e.pointerId === this.pointer) up(e);
    });
    this.on(this.area, 'contextmenu', (e: Event) => {
      if (this.h.isPlaying()) e.preventDefault();
    });
  }
}
