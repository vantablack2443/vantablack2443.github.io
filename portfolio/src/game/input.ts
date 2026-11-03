export interface InputHandlers {
  /** Are we in a running game (anything other than ATTRACT)? Controls preventDefault. */
  isActive(): boolean;
  /** Is a modal dialog open? */
  isModalOpen(): boolean;
  setLeft(on: boolean): void;
  setRight(on: boolean): void;
  setPlunger(on: boolean): void;
  onStart(): void;
  onPauseToggle(): void;
  onEnd(): void;
  onDebugToggle(): void;
  /** Called on any key/pointer press so audio can be unlocked. */
  onGesture(): void;
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyZ', 'ShiftLeft']);
const RIGHT_KEYS = new Set(['ArrowRight', 'Slash', 'ShiftRight']);
const PLUNGER_KEYS = new Set(['Space', 'ArrowDown']);
/** Keys we swallow while a game is running (so the page does not scroll). */
const SWALLOW = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Slash', 'KeyZ']);

/** Keyboard + multi-touch controls. */
export class Input {
  private readonly h: InputHandlers;
  private readonly stage: HTMLElement;
  private readonly plungerZone: HTMLElement | null;
  private keysLeft = new Set<string>();
  private keysRight = new Set<string>();
  private keysPlunger = new Set<string>();
  private touchLeft = new Set<number>();
  private touchRight = new Set<number>();
  private touchPlunger = new Set<number>();
  private disposers: Array<() => void> = [];

  constructor(stage: HTMLElement, handlers: InputHandlers) {
    this.stage = stage;
    this.h = handlers;
    this.plungerZone = document.getElementById('plunger-zone');
    this.bind();
  }

  private on(t: EventTarget, type: string, fn: (e: never) => void, opt?: AddEventListenerOptions): void {
    t.addEventListener(type, fn as EventListener, opt);
    this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opt));
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  /** Release everything (pause, blur, game end). */
  releaseAll(): void {
    this.keysLeft.clear();
    this.keysRight.clear();
    this.keysPlunger.clear();
    this.touchLeft.clear();
    this.touchRight.clear();
    this.touchPlunger.clear();
    this.push();
  }

  private push(): void {
    this.h.setLeft(this.keysLeft.size + this.touchLeft.size > 0);
    this.h.setRight(this.keysRight.size + this.touchRight.size > 0);
    this.h.setPlunger(this.keysPlunger.size + this.touchPlunger.size > 0);
  }

  private bind(): void {
    // ---- keyboard ----
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.h.isModalOpen()) return;
      const active = this.h.isActive();
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (typing) return;

      // Arrow keys / Space only scroll the page while NO game is running.
      if (active && SWALLOW.has(e.code)) e.preventDefault();

      if (e.code === 'Backquote') {
        this.h.onDebugToggle();
        return;
      }
      if (e.code === 'Enter' && !active) {
        const t = e.target;
        // let focused buttons / links do their own thing
        if (!(t instanceof Element) || !t.closest('button, a, summary')) {
          this.h.onGesture();
          this.h.onStart();
        }
        return;
      }
      if (!active) return;
      if (e.code === 'KeyP') {
        if (!e.repeat) this.h.onPauseToggle();
        return;
      }
      if (e.code === 'Escape') {
        this.h.onEnd();
        return;
      }
      this.h.onGesture();
      if (LEFT_KEYS.has(e.code)) this.keysLeft.add(e.code);
      else if (RIGHT_KEYS.has(e.code)) this.keysRight.add(e.code);
      else if (PLUNGER_KEYS.has(e.code)) this.keysPlunger.add(e.code);
      else return;
      if (e.code.startsWith('Shift')) e.preventDefault();
      this.push();
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => {
      const had =
        this.keysLeft.delete(e.code) || this.keysRight.delete(e.code) || this.keysPlunger.delete(e.code);
      if (had) this.push();
    });
    this.on(window, 'blur', () => this.releaseAll());

    // ---- pointers: two DOM touch zones over the lower part of the table ----
    // They are real elements, so the browser's own hit-testing keeps them
    // correct under the 3D tilt (no manual coordinate maths). CSS only lets
    // them receive pointers while a game is running.
    const bindZone = (zone: HTMLElement | null, set: Set<number>): void => {
      if (!zone) return;
      this.on(zone, 'pointerdown', (e: PointerEvent) => {
        if (!this.h.isActive() || this.h.isModalOpen()) return;
        this.h.onGesture();
        e.preventDefault();
        try {
          zone.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        set.add(e.pointerId);
        this.push();
      });
      const up = (e: PointerEvent): void => {
        if (set.delete(e.pointerId)) this.push();
      };
      this.on(zone, 'pointerup', up);
      this.on(zone, 'pointercancel', up);
      this.on(zone, 'lostpointercapture', up);
    };
    bindZone(document.getElementById('zone-left'), this.touchLeft);
    bindZone(document.getElementById('zone-right'), this.touchRight);

    // ---- plunger knob ----
    if (this.plungerZone) {
      this.on(this.plungerZone, 'pointerdown', (e: PointerEvent) => {
        if (!this.h.isActive() || this.h.isModalOpen()) return;
        this.h.onGesture();
        e.preventDefault();
        e.stopPropagation();
        try {
          this.plungerZone?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        this.touchPlunger.add(e.pointerId);
        this.push();
      });
      const pup = (e: PointerEvent): void => {
        if (this.touchPlunger.delete(e.pointerId)) this.push();
      };
      this.on(this.plungerZone, 'pointerup', pup);
      this.on(this.plungerZone, 'pointercancel', pup);
      this.on(this.plungerZone, 'lostpointercapture', pup);
    }

    // block the context menu / long-press menu while playing
    this.on(this.stage, 'contextmenu', (e: Event) => {
      if (this.h.isActive()) e.preventDefault();
    });
  }
}
