import { Application } from 'pixi.js';
import { t } from '../i18n';
import { prefersReducedMotion } from '../motion';
import { Sfx } from './audio';
import { loadArt } from './assets';
import { BOAT, DOCKS, LANTERNS, WORLD } from './config';
import { Input } from './input';
import { Renderer } from './render';
import { River, type RiverEvent } from './sim';
import { Water, loadWaterWasm } from './water';
import wasmUrl from './wasm/water.wasm?url';

/**
 * Lantern River: the night game. This file wires the headless sim (sim.ts, water.ts, whose
 * height field is Rust compiled to WebAssembly), the PixiJS scene (render.ts), input, audio and
 * the DOM pieces around the canvas (HUD, start overlay, pause note, summary). It is dynamically
 * imported by main.ts only when the dark theme is entered, so light mode visitors never download
 * Pixi, planck or the wasm module.
 *
 * Fixed physics step with an accumulator (at most 5 steps a frame); the renderer interpolates.
 * Pauses: Space / Escape and a hidden tab freeze everything; an open dock card only holds the
 * night clock (the water keeps moving).
 */

export interface RiverOptions {
  /** Where the canvas goes (a fixed, full viewport element). */
  host: HTMLElement;
  /** The boat tied up at a dock: show that project (the id of its `.card`). */
  onDock(cardId: string): void;
  isModalOpen(): boolean;
}

export interface RiverGame {
  /** Begin the night (the Start button, the Enter key). */
  start(): void;
  /** End the night now. */
  endGame(): void;
  /** Freeze ('key', 'hidden') or hold the clock ('modal'). */
  setPaused(reason: string, on: boolean): void;
  /** Cast off from the dock (its card was closed). */
  castOff(): void;
  /** Fit to the viewport again. */
  resize(): void;
  /** Stop the loop and remove every listener, the canvas and the audio. */
  dispose(): void;
}

const HI_KEY = 'portfolio-hi-river';
/** Pause after a clear night so the celebration is seen before the summary. */
const SUMMARY_DELAY_MS = 2400;

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const pad = (n: number): string => String(n).padStart(5, '0');

export async function createRiver(opt: RiverOptions): Promise<RiverGame> {
  const { host } = opt;
  const reduced = prefersReducedMotion();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const app = new Application();
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    resolution: dpr,
    autoDensity: true,
    antialias: false,
    background: '#02040c',
    autoStart: false,
    preference: 'webgl',
  });
  app.ticker.stop();
  // the scene needs WebGL (meshes, filters): without it say so, instead of drawing nothing
  if (app.renderer.name !== 'webgl') {
    app.destroy(true);
    throw new Error('WebGL is not available');
  }
  try {
    await document.fonts?.load('600 15px Geist');
  } catch {
    /* fonts are best effort: the labels fall back to the system font */
  }
  // the Rust water: if it cannot be loaded the TypeScript reference runs instead (same algorithm)
  await loadWaterWasm(wasmUrl);
  const art = await loadArt();
  host.append(app.canvas);
  app.canvas.setAttribute('aria-hidden', 'true');

  const labels = DOCKS.map((d) => document.querySelector(`#${d.card} .t`)?.textContent?.trim() ?? '');
  const renderer = new Renderer(app, art, labels, reduced);
  const sfx = new Sfx();
  const rootEl = $('river');
  const debug = new URLSearchParams(location.search).has('debug');

  let sim = new River({ seed: newSeed() });
  renderer.setSim(sim);
  let disposed = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let summaryTimer = 0;
  /** The paddle vector (keys, stick) and the tap target; the target is followed when no key or stick is held. */
  let vecX = 0;
  let vecZ = 0;
  let target: { x: number; z: number } | null = null;
  let high = 0;
  const pauses = new Set<string>();
  const frameTimes: number[] = [];
  const disposers: Array<() => void> = [];

  try {
    high = Number(localStorage.getItem(HI_KEY)) || 0;
  } catch {
    /* storage unavailable: no high score this visit */
  }

  /* ---------------- DOM ---------------- */

  const el = {
    score: $('r-score'),
    lanterns: $('r-lanterns'),
    docks: $('r-docks'),
    moon: $('r-moon'),
    start: $<HTMLButtonElement>('r-start'),
    again: $<HTMLButtonElement>('r-again'),
    resume: $<HTMLButtonElement>('r-resume'),
    sTitle: $('rs-title'),
    sScore: $('rs-score'),
    sDocks: $('rs-docks'),
    sLanterns: $('rs-lanterns'),
    sHigh: $('rs-high'),
    sNew: $('rs-new'),
    live: $('river-live'),
    hud: $('river-hud'),
    badge: $('r-badge'),
    stick: $('r-stick'),
  };
  const soundButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-river-sound]'));
  const shown = { score: -1, lit: -1, docks: -1 };

  const setAttr = (name: string, value: string | null): void => {
    if (!rootEl) return;
    if (value === null) rootEl.removeAttribute(name);
    else rootEl.setAttribute(name, value);
  };

  function say(text: string): void {
    if (el.live) el.live.textContent = text;
  }

  function updateHud(): void {
    if (sim.score !== shown.score && el.score) {
      shown.score = sim.score;
      el.score.textContent = pad(sim.score);
    }
    if (sim.lanternsLit !== shown.lit && el.lanterns) {
      shown.lit = sim.lanternsLit;
      el.lanterns.textContent = `${sim.lanternsLit} / ${LANTERNS.length}`;
    }
    if (sim.docksVisited !== shown.docks && el.docks) {
      shown.docks = sim.docksVisited;
      el.docks.textContent = `${sim.docksVisited} / ${DOCKS.length}`;
    }
    // the moon is the timer: a thin line that fills as the night goes
    if (el.moon) {
      const f = sim.phase === 'idle' ? 0 : Math.min(1, sim.elapsed / WORLD.nightSeconds);
      el.moon.style.transform = `scaleX(${f.toFixed(4)})`;
    }
  }

  function syncSound(): void {
    const on = !sfx.muted;
    for (const b of soundButtons) {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? t('sound.onAria', 'Sound is on. Turn sound off') : t('sound.offAria', 'Sound is off. Turn sound on'));
      const text = b.querySelector('.mute-text');
      if (text) text.textContent = on ? t('sound.on', 'Sound on') : t('sound.off', 'Sound off');
    }
  }

  function renderSummary(): void {
    const cleared = sim.cleared;
    if (el.sTitle) el.sTitle.textContent = cleared ? t('river.over.clear', 'Clear night') : t('river.over.title', 'Night over');
    if (el.sScore) el.sScore.textContent = pad(sim.score);
    if (el.sDocks) el.sDocks.textContent = `${sim.docksVisited} / ${DOCKS.length}`;
    if (el.sLanterns) el.sLanterns.textContent = `${sim.lanternsLit} / ${LANTERNS.length}`;
    if (el.sHigh) el.sHigh.textContent = pad(high);
    if (el.sNew) el.sNew.hidden = !(sim.score > 0 && sim.score >= high && newHigh);
  }
  let newHigh = false;

  /* ---------------- sim events ---------------- */

  function handle(events: RiverEvent[]): void {
    for (const e of events) {
      renderer.onEvent(e);
      switch (e.type) {
        case 'stroke':
          sfx.stroke();
          break;
        case 'lunge':
          sfx.lunge();
          break;
        case 'bite':
          sfx.bite();
          flashHud();
          say(t('river.say.bite', 'A crocodile bit the boat. Fifteen seconds lost.'));
          break;
        case 'lantern':
          sfx.lantern();
          say(t('river.say.lantern', 'Lantern lit. {n} of {m}.').replace('{n}', String(sim.lanternsLit)).replace('{m}', String(LANTERNS.length)));
          break;
        case 'moor': {
          sfx.bell();
          const name = labels[e.dock];
          say(t('river.say.moor', 'Moored at {name}.').replace('{name}', name));
          opt.onDock(e.card);
          break;
        }
        case 'release':
          sfx.release();
          break;
        case 'bump':
        case 'bank':
        case 'hit':
          sfx.bump();
          break;
        case 'clear':
          sfx.celebrate();
          say(t('river.say.clear', 'Clear night. All docks and lanterns found.'));
          break;
        case 'over':
          finishNight(e.reason);
          break;
        case 'start':
        case 'wake':
          break;
      }
    }
  }

  /** A short red flash on the HUD timer when a crocodile bites. */
  let flashTimer = 0;
  function flashHud(): void {
    if (!el.hud) return;
    el.hud.classList.remove('bitten');
    void el.hud.offsetWidth; // restart the animation
    el.hud.classList.add('bitten');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => el.hud?.classList.remove('bitten'), 900);
  }

  function finishNight(reason: 'time' | 'clear' | 'ended'): void {
    input.releaseAll();
    stopPaddle();
    newHigh = sim.score > high;
    if (newHigh) {
      high = sim.score;
      try {
        localStorage.setItem(HI_KEY, String(high));
      } catch {
        /* ignore */
      }
    }
    if (reason !== 'clear') sfx.end();
    renderSummary();
    setAttr('data-phase', 'over');
    // after a clear night the celebration plays first
    window.clearTimeout(summaryTimer);
    const reveal = (): void => setAttr('data-summary', '1');
    if (reason === 'clear' && !reduced) summaryTimer = window.setTimeout(reveal, SUMMARY_DELAY_MS);
    else reveal();
  }

  /* ---------------- loop ---------------- */

  const frozen = (): boolean => pauses.has('key') || pauses.has('hidden');

  function ensureLoop(): void {
    if (raf || disposed || frozen()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    raf = 0;
    if (disposed) return;
    const t0 = debug ? performance.now() : 0;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (frozen()) return;

    acc += dt;
    let n = 0;
    steer();
    while (acc >= WORLD.dt && n < WORLD.maxSteps) {
      sim.step();
      const ev = sim.drainEvents();
      if (ev.length) handle(ev);
      acc -= WORLD.dt;
      n++;
    }
    if (n >= WORLD.maxSteps) acc = 0; // the clock slips instead of spiralling
    renderer.draw(acc / WORLD.dt, dt);
    updateHud();
    if (debug) {
      frameTimes.push(performance.now() - t0, dt * 1000);
      if (frameTimes.length > 600) frameTimes.splice(0, 2);
    }
    raf = requestAnimationFrame(frame);
  }

  /** Set the sim's paddle input: the keys and the stick win over a tap target, which is followed and then dropped. */
  function steer(): void {
    let x = vecX;
    let z = vecZ;
    if (pauses.has('modal') || sim.phase !== 'playing') x = z = 0;
    else if (x === 0 && z === 0 && target) {
      const p = sim.boat.body.getPosition();
      const v = sim.boat.body.getLinearVelocity();
      const dx = target.x - p.x;
      const dz = target.z - p.y;
      const d = Math.hypot(dx, dz);
      // paddle toward it, and let go early enough that the boat coasts onto it (the keel's drag)
      if (d < 2.2) {
        target = null;
        renderer.setTarget(null);
      } else if (d > Math.hypot(v.x, v.y) / BOAT.dragAlong + 1.2) {
        x = dx / d;
        z = dz / d;
      }
    }
    sim.inx = x;
    sim.inz = z;
  }

  function stopPaddle(): void {
    vecX = vecZ = 0;
    target = null;
    renderer.setTarget(null);
  }

  /** One frame without advancing time (after a resize while frozen). */
  function drawOnce(): void {
    renderer.draw(acc / WORLD.dt, 0);
  }

  /* ---------------- public API ---------------- */

  function start(): void {
    if (sim.phase === 'over') {
      again();
      return;
    }
    if (sim.phase !== 'idle') return;
    sfx.unlock();
    sim.start();
    renderer.setLights(true);
    sfx.start();
    setAttr('data-phase', 'playing');
    say(t('river.say.start', 'The night begins. Light the lanterns and moor at the docks.'));
    ensureLoop();
  }

  /** A fresh night straight away, lights already on. */
  function again(): void {
    window.clearTimeout(summaryTimer);
    sim = new River({ seed: newSeed() });
    renderer.setSim(sim);
    renderer.setLights(true, true);
    acc = 0;
    shown.score = shown.lit = shown.docks = -1;
    setAttr('data-summary', null);
    sfx.unlock();
    sim.start();
    sfx.start();
    setAttr('data-phase', 'playing');
    updateHud();
    ensureLoop();
  }

  function setPaused(reason: string, on: boolean): void {
    if (on === pauses.has(reason)) return;
    if (on) pauses.add(reason);
    else pauses.delete(reason);
    if (reason === 'modal') {
      sim.holdClock = on;
      if (on) {
        input.releaseAll();
        stopPaddle();
      }
      return;
    }
    const f = frozen();
    if (f) {
      input.releaseAll();
      stopPaddle();
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (reason === 'key') setAttr('data-paused', on ? '1' : null);
    if (!f) ensureLoop();
  }

  function endGame(): void {
    sim.end('ended');
    handle(sim.drainEvents());
  }

  function castOff(): void {
    sim.release();
    handle(sim.drainEvents());
  }

  function resize(): void {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    app.renderer.resize(w, h);
    renderer.resize(w, h);
    if (frozen() || !raf) drawOnce();
  }

  /* ---------------- input and wiring ---------------- */

  const input = new Input(host, {
    isPlaying: () => sim.phase === 'playing',
    isModalOpen: () => opt.isModalOpen(),
    setVec: (x, z) => {
      vecX = x;
      vecZ = z;
      if (x !== 0 || z !== 0) {
        target = null;
        renderer.setTarget(null);
      }
    },
    onTap: (cx, cy) => {
      const r = host.getBoundingClientRect();
      const w = renderer.toWorld(cx - r.left, cy - r.top);
      if (!w) return;
      target = w;
      renderer.setTarget(w);
    },
    topLimit: () => (el.hud ? el.hud.getBoundingClientRect().bottom : 0),
    onPauseToggle: () => setPaused('key', !pauses.has('key')),
    onStart: () => start(),
    onGesture: () => sfx.unlock(),
  }, el.stick);

  const listen = (target: EventTarget | null, type: string, fn: (e: Event) => void): void => {
    if (!target) return;
    target.addEventListener(type, fn);
    disposers.push(() => target.removeEventListener(type, fn));
  };

  listen(el.start, 'click', () => start());
  listen(el.again, 'click', () => again());
  listen(el.resume, 'click', () => setPaused('key', false));
  for (const b of soundButtons) {
    listen(b, 'click', () => {
      sfx.setMuted(!sfx.muted);
      syncSound();
      sfx.lantern();
    });
  }
  listen(document, 'visibilitychange', () => setPaused('hidden', document.hidden));
  listen(document, 'langchange', () => {
    syncSound();
    if (sim.phase === 'over') renderSummary();
  });
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  disposers.push(() => ro.disconnect());

  syncSound();
  setAttr('data-phase', 'idle');
  setAttr('data-summary', null);
  setAttr('data-paused', null);
  resize();
  updateHud();
  ensureLoop();

  if (debug) {
    renderer.setDebug(true);
    if (el.badge) {
      el.badge.textContent = sim.water.backend === 'wasm' ? 'RUST·WASM' : 'TS';
      el.badge.hidden = false;
    }
    const stats = (): { js: number; interval: number; fps: number; n: number } => {
      const js: number[] = [];
      const iv: number[] = [];
      for (let i = 0; i < frameTimes.length; i += 2) {
        js.push(frameTimes[i]);
        iv.push(frameTimes[i + 1]);
      }
      const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      return { js: avg(js), interval: avg(iv), fps: 1000 / (avg(iv) || 1), n: js.length };
    };
    /** Time n water steps (with a stir now and then) in the wasm field and in the TypeScript field, ms per step. */
    const bench = (n = 600): { wasm: number; ts: number } => {
      const time = (forceTs: boolean): number => {
        const w = new Water(1, forceTs);
        w.disturb(70, 8, 1, -3);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          if (i % 20 === 0) w.disturb(60 + (i % 40), 8, 0.8, -2);
          w.step(1 / 60);
        }
        return (performance.now() - t0) / n;
      };
      return { wasm: time(false), ts: time(true) };
    };
    (window as unknown as { __river?: unknown }).__river = {
      get sim() {
        return sim;
      },
      renderer,
      stats,
      bench,
      frameTimes,
      app,
    };
  }

  return {
    start,
    endGame,
    setPaused,
    castOff,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      window.clearTimeout(summaryTimer);
      input.releaseAll();
      input.dispose();
      disposers.forEach((d) => d());
      disposers.length = 0;
      sfx.dispose();
      renderer.dispose();
      setAttr('data-phase', null);
      setAttr('data-summary', null);
      setAttr('data-paused', null);
      window.clearTimeout(flashTimer);
      delete (window as unknown as { __river?: unknown }).__river;
    },
  };
}

/** A new seed per night, so the logs and the swell differ; the sim itself is deterministic for a given seed. */
function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}
