import * as pl from 'planck';
import { Lights, LIGHTS_ON_MS, prefersReducedMotion } from '../lights';
import { inPlungerLane } from '../layout';
import type { StageMetrics } from '../stage';
import { Sfx } from './audio';
import { Input } from './input';
import { Table, TUNING, type TableEvent } from './physics';
import { Renderer } from './render';

/**
 * State machine
 *   ATTRACT -> LIGHTS_ON -> PLUNGER -> PLAYING -> DRAINED -> (balls left ? PLUNGER : GAME_OVER) -> ATTRACT
 * PAUSED is an overlay (modal open, tab hidden, or the P key): the physics
 * loop simply stops stepping.
 */
export type GameState = 'ATTRACT' | 'LIGHTS_ON' | 'PLUNGER' | 'PLAYING' | 'DRAINED' | 'GAME_OVER';

export interface GameDeps {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  lights: Lights;
  isModalOpen(): boolean;
  metrics: StageMetrics;
  /** The ball hit a project card (the right panel's spotlight follows it). */
  onCardHit?(id: string): void;
}

const BALLS = 3;
const BALL_SAVE_S = 4;
const STUCK_SPEED = 0.3; // m/s
const STUCK_S = 3;
const DRAINED_S = 1.3;
const GAME_OVER_S = 4;
const HI_KEY = 'portfolio-hi';

const SPARK_COLOR: Record<string, string> = {
  pink: '#ff3d9a',
  cyan: '#2ee6ff',
  amber: '#ffb52e',
  lime: '#a6ff3d',
};
const BUMPER_COLOR: Record<string, string> = {
  'bumper-python': SPARK_COLOR.pink,
  'bumper-c': SPARK_COLOR.cyan,
  'bumper-java': SPARK_COLOR.amber,
  'bumper-kotlin': SPARK_COLOR.lime,
  'bumper-rust': SPARK_COLOR.pink,
};

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export class Game {
  readonly table = new Table();
  state: GameState = 'ATTRACT';

  private readonly d: GameDeps;
  private readonly renderer: Renderer;
  private readonly sfx = new Sfx();
  private readonly input: Input;
  /** Listeners this game added outside Input (removed again in dispose()). */
  private readonly disposers: Array<() => void> = [];
  private disposed = false;

  // loop
  private raf = 0;
  private last = 0;
  private acc = 0;
  private clock = 0; // game seconds (does not advance while paused)
  private stateT = 0;
  private readonly pauseReasons = new Set<string>();
  debug = false;

  // game
  private score = 0;
  private hi = 0;
  private ball = 1;
  private mult = 1;
  private visited = new Set<string>();
  private litLanes = new Set<string>();
  private allProjectsDone = false;
  private launchedAt = 0;
  private saveUsed = false;
  private stuckFor = 0;
  private laneIdle = 0;
  private autoFireAt = -1;
  private laneResetAt = -1;
  private messageUntil = 0;

  // input state (set by Input; applied to the table every step)
  private want = { left: false, right: false, plunger: false };

  // DOM
  private readonly elScore = $('score');
  private readonly elBall = $('ball');
  private readonly elMult = $('mult');
  private readonly elHi = $('hi');
  private readonly elMsg = $('message');
  private readonly elMission = $('mission');
  private readonly btnStart = $<HTMLButtonElement>('btn-start');
  private readonly btnMute = $<HTMLButtonElement>('btn-mute');

  constructor(deps: GameDeps) {
    this.d = deps;
    this.renderer = new Renderer(deps.canvas, this.table);
    this.renderer.resize(deps.metrics);
    this.debug = new URLSearchParams(location.search).has('debug');

    try {
      this.hi = Number(localStorage.getItem(HI_KEY)) || 0;
    } catch {
      /* storage unavailable: page works without it */
    }

    this.input = new Input(deps.stage, {
      isActive: () => this.state !== 'ATTRACT',
      isModalOpen: () => this.d.isModalOpen(),
      setLeft: (on) => (this.want.left = on),
      setRight: (on) => (this.want.right = on),
      setPlunger: (on) => (this.want.plunger = on),
      onStart: () => this.start(),
      onPauseToggle: () => this.setPaused('key', !this.pauseReasons.has('key')),
      onEnd: () => this.endGame(),
      onDebugToggle: () => {
        this.debug = !this.debug;
        this.drawStatic();
      },
      onGesture: () => this.sfx.unlock(),
    });

    this.listen(this.btnStart, 'click', () => {
      this.sfx.unlock();
      this.start();
    });
    this.syncMuteButton();
    this.listen(this.btnMute, 'click', () => {
      this.sfx.setMuted(!this.sfx.muted);
      this.syncMuteButton();
      this.sfx.bumper();
    });
    this.listen(document, 'visibilitychange', () => this.setPaused('hidden', document.hidden));

    this.updateHud();
    this.syncStartButton();
    this.setState('ATTRACT');
    this.say('PRESS START', Infinity);
    this.drawStatic();
    if (this.debug) {
      (window as unknown as { __pinball?: Game }).__pinball = this;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /** A game is in progress and the user's fingers/keys are busy with it. */
  isRunning(): boolean {
    return this.state === 'LIGHTS_ON' || this.state === 'PLUNGER' || this.state === 'PLAYING' || this.state === 'DRAINED';
  }

  resize(m: StageMetrics): void {
    this.renderer.resize(m);
    this.drawStatic();
  }

  /** Show a message on the backglass for a while. */
  say(text: string, ms = 1500): void {
    if (!this.elMsg) return;
    this.elMsg.textContent = text;
    this.messageUntil = ms === Infinity ? Infinity : this.clock + ms / 1000;
  }

  setPaused(reason: string, on: boolean): void {
    if (on === this.pauseReasons.has(reason)) return;
    if (on) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const paused = this.pauseReasons.size > 0;
    if (paused) {
      this.input.releaseAll();
      this.want = { left: false, right: false, plunger: false };
      if (this.isRunning()) this.say('PAUSED', Infinity);
    } else if (this.elMsg && this.elMsg.textContent === 'PAUSED') {
      if (this.state === 'GAME_OVER') this.say('GAME OVER · PRESS START', Infinity);
      else if (this.state === 'ATTRACT') this.say('PRESS START', Infinity);
      else this.say('', 0);
      this.last = performance.now();
    }
    if (!paused && this.state !== 'ATTRACT') this.ensureLoop();
  }

  start(): void {
    if (this.state !== 'ATTRACT' && this.state !== 'GAME_OVER') return;
    if (this.d.isModalOpen()) return;
    this.sfx.unlock();
    this.score = 0;
    this.ball = 1;
    this.mult = 1;
    this.visited.clear();
    this.litLanes.clear();
    this.allProjectsDone = false;
    this.saveUsed = false;
    this.want = { left: false, right: false, plunger: false };
    this.d.lights.clearState();
    this.d.lights.on();
    this.table.removeBall();
    this.renderer.clearSparks();
    this.setState('LIGHTS_ON');
    this.say('GET READY', 1400);
    this.sfx.start();
    this.updateHud();
    // make sure the whole table is on screen on small devices
    this.d.stage.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    this.ensureLoop();
  }

  /** Esc: end the current game now. */
  endGame(): void {
    if (!this.isRunning()) return;
    this.table.removeBall();
    this.finishGame();
  }

  /** Stop the loop and remove every listener, so nothing of this game survives (leaving the dark theme). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.releaseAll();
    this.input.dispose();
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.want = { left: false, right: false, plunger: false };
    this.sfx.dispose();
    if ((window as unknown as { __pinball?: Game }).__pinball === this) {
      delete (window as unknown as { __pinball?: Game }).__pinball;
    }
  }

  private listen(t: EventTarget | null, type: string, fn: () => void): void {
    if (!t) return;
    t.addEventListener(type, fn);
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  /* ------------------------------------------------------------------ */
  /* State machine                                                       */
  /* ------------------------------------------------------------------ */

  private setState(s: GameState): void {
    this.state = s;
    this.stateT = this.clock;
    this.d.stage.setAttribute('data-state', s);
    this.syncStartButton();
  }

  private enterPlunger(): void {
    this.table.spawnBall();
    this.saveUsed = false;
    this.stuckFor = 0;
    this.laneIdle = 0;
    this.setState('PLUNGER');
    this.say(`BALL ${this.ball}`, 1500);
    this.updateHud();
    // the first ball of a game launches by itself, so one press of START is enough
    this.autoFireAt = this.ball === 1 ? this.clock + 0.45 : -1;
  }

  private finishGame(): void {
    this.table.input.left = this.table.input.right = this.table.input.plunger = false;
    this.d.lights.setRunning(false);
    if (this.score > this.hi) {
      this.hi = this.score;
      try {
        localStorage.setItem(HI_KEY, String(this.hi));
      } catch {
        /* ignore */
      }
    }
    this.setState('GAME_OVER');
    this.say('GAME OVER · PRESS START', Infinity);
    this.sfx.gameOver();
    this.updateHud();
  }

  private toAttract(): void {
    this.d.lights.off();
    this.setState('ATTRACT');
    this.say('PRESS START', Infinity);
    this.renderer.clearSparks();
    this.updateHud();
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */

  private ensureLoop(): void {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const paused = this.pauseReasons.size > 0;

    if (!paused) {
      this.clock += dt;
      this.acc += dt;
      let n = 0;
      while (this.acc >= TUNING.dt && n < 5) {
        this.stepOnce();
        this.acc -= TUNING.dt;
        n++;
      }
      if (n >= 5) this.acc = 0; // avoid a spiral of death
      this.update(dt);
    }

    this.renderer.draw(dt, { lit: this.d.stage.classList.contains('lights-on'), debug: this.debug });

    // idle: stop the loop; nothing moves in ATTRACT
    if (this.state === 'ATTRACT' && !paused && !this.debug) return;
    if (paused && this.state === 'ATTRACT') return;
    if (paused) {
      // keep a cheap loop alive so resume is instant after tab-hidden etc.
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawStatic(): void {
    this.renderer.draw(0, { lit: this.d.stage.classList.contains('lights-on'), debug: this.debug });
    if (this.debug && this.state === 'ATTRACT') this.ensureLoop();
  }

  private stepOnce(): void {
    const t = this.table;
    const live = this.state === 'PLUNGER' || this.state === 'PLAYING' || this.state === 'DRAINED';
    t.input.left = live && this.want.left;
    t.input.right = live && this.want.right;
    t.input.plunger =
      (this.state === 'PLUNGER' || (this.state === 'PLAYING' && t.ballOnPlunger())) && this.want.plunger;
    t.step();
    const events = t.drainEvents();
    if (events.length) this.handleEvents(events);
  }

  /** Per-frame logic that is not physics. */
  private update(dt: number): void {
    const now = this.clock;
    if (this.elMsg && this.messageUntil !== Infinity && this.messageUntil > 0 && now > this.messageUntil) {
      this.elMsg.textContent = '';
      this.messageUntil = 0;
    }
    if (this.laneResetAt > 0 && now >= this.laneResetAt) {
      this.laneResetAt = -1;
      for (const id of this.litLanes) this.d.lights.mark(id, 'lit', false);
      this.litLanes.clear();
      this.updateHud();
    }

    switch (this.state) {
      case 'LIGHTS_ON': {
        const wait = prefersReducedMotion() ? 0.25 : LIGHTS_ON_MS / 1000;
        if (now - this.stateT >= wait) {
          this.d.lights.setRunning(true);
          this.enterPlunger();
        }
        break;
      }
      case 'PLUNGER': {
        if (this.autoFireAt > 0 && now >= this.autoFireAt) {
          this.autoFireAt = -1;
          if (!this.want.plunger) this.table.launch(TUNING.plunger.autoPower);
        }
        break;
      }
      case 'PLAYING':
        this.watchBall(dt);
        break;
      case 'DRAINED':
        if (now - this.stateT >= DRAINED_S) {
          if (this.ball < BALLS) {
            this.ball++;
            this.mult = 1;
            this.enterPlunger();
          } else {
            this.finishGame();
          }
        }
        break;
      case 'GAME_OVER':
        if (now - this.stateT >= GAME_OVER_S) this.toAttract();
        break;
      default:
        break;
    }
  }

  /** Ball watchdogs while PLAYING: out-of-bounds, fell back in the lane, stuck. */
  private watchBall(dt: number): void {
    const t = this.table;
    const p = t.ballPos();
    if (!p || !t.ball) return;
    const [x, y] = p;

    // Out-of-bounds safety (a tunnelling bug must never cost the player a ball).
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -40 || x > 640 || y < -60 || y > 1000) {
      console.warn('[pinball] ball left the table; resetting it without losing a ball', p);
      this.returnToPlunger('BALL RESET');
      return;
    }

    const speed = t.ballSpeed();

    // A weak launch can fall back down the lane: hand the plunger back.
    if (inPlungerLane(x, y) && y > 740 && speed < 0.8) {
      this.laneIdle += dt;
      if (this.laneIdle > 0.5) {
        this.laneIdle = 0;
        this.setState('PLUNGER');
        this.say('PULL THE PLUNGER', 1800);
        return;
      }
    } else {
      this.laneIdle = 0;
    }

    // Stuck ball: tiny random nudge.
    if (!inPlungerLane(x, y) && speed < STUCK_SPEED) {
      this.stuckFor += dt;
      const held = this.want.left || this.want.right;
      if (this.stuckFor >= STUCK_S && (!held || this.stuckFor >= STUCK_S * 2)) {
        this.stuckFor = 0;
        const rand = Math.random;
        t.ball.applyLinearImpulse(
          pl.Vec2((rand() - 0.5) * 0.9, -(0.7 + rand() * 0.5)),
          t.ball.getWorldCenter(),
          true,
        );
        this.say('NUDGE', 1000);
        this.d.lights.shake();
      }
    } else {
      this.stuckFor = 0;
    }
  }

  private returnToPlunger(msg: string): void {
    this.table.spawnBall();
    this.setState('PLUNGER');
    this.stuckFor = 0;
    this.laneIdle = 0;
    this.say(msg, 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Events & scoring                                                    */
  /* ------------------------------------------------------------------ */

  private handleEvents(events: TableEvent[]): void {
    const ballPos = this.table.ballPos();
    const lights = this.d.lights;
    for (const e of events) {
      switch (e.type) {
        case 'launch':
          if (this.state === 'PLUNGER') {
            this.setState('PLAYING');
            this.launchedAt = this.clock;
            this.stuckFor = 0;
            this.say('', 0);
          }
          this.sfx.launch();
          break;
        case 'flipper':
          this.sfx.flipper();
          break;
        case 'bumper':
          if (this.state !== 'PLAYING') break;
          this.addScore(100);
          lights.flash(e.id);
          lights.pinChase();
          if (ballPos) this.renderer.spark(ballPos[0], ballPos[1], BUMPER_COLOR[e.id] ?? '#fff', 9, 190);
          this.sfx.bumper();
          break;
        case 'sling':
          if (this.state !== 'PLAYING') break;
          this.addScore(50);
          lights.flash(e.id);
          if (ballPos) this.renderer.spark(ballPos[0], ballPos[1], SPARK_COLOR.amber, 6, 150);
          this.sfx.sling();
          break;
        case 'card':
          if (this.state !== 'PLAYING') break;
          this.onCard(e.id, ballPos);
          break;
        case 'lane':
          if (this.state !== 'PLAYING') break;
          this.onLane(e.id);
          break;
        case 'drain':
          if (this.state === 'PLAYING') this.onDrain();
          break;
      }
    }
  }

  private onCard(id: string, ballPos: readonly [number, number] | null): void {
    const el = document.getElementById(id);
    const name = el?.querySelector('.t')?.textContent?.toUpperCase() ?? id;
    const pts = this.addScore(250);
    this.d.lights.flash(id);
    this.d.onCardHit?.(id);
    if (!this.visited.has(id)) {
      this.visited.add(id);
      this.d.lights.mark(id, 'visited');
    }
    this.updateHud();
    this.say(`+${pts} ${name}`, 1500);
    if (ballPos) this.renderer.spark(ballPos[0], ballPos[1], SPARK_COLOR[el?.dataset.neon ?? 'cyan'] ?? '#fff', 8, 170);
    this.sfx.card();
    if (!this.allProjectsDone && this.visited.size >= 6) {
      this.allProjectsDone = true;
      this.score += 10000;
      this.say('ALL PROJECTS EXPLORED! +10000', 2600);
      this.d.lights.chase();
      this.d.lights.shake();
      this.sfx.special();
      this.updateHud();
    }
  }

  private onLane(id: string): void {
    if (this.litLanes.has(id)) return;
    this.litLanes.add(id);
    this.d.lights.mark(id, 'lit');
    const pts = this.addScore(500);
    const abbr = document.getElementById(id)?.querySelector('.abbr')?.textContent ?? '';
    this.say(`+${pts} ${abbr}`, 1200);
    this.sfx.lane();
    if (this.litLanes.size >= 4) {
      this.mult = Math.min(5, this.mult + 1);
      this.say(`POLYGLOT! BONUS x${this.mult}`, 2200);
      this.laneResetAt = this.clock + 0.9;
      this.d.lights.shake();
      this.sfx.special();
      this.updateHud();
    }
  }

  private onDrain(): void {
    const t = this.table;
    const withinSave = this.clock - this.launchedAt < BALL_SAVE_S;
    if (withinSave && !this.saveUsed) {
      this.saveUsed = true;
      this.sfx.save();
      t.spawnBall();
      this.setState('PLUNGER');
      this.say('BALL SAVED', 1800);
      return;
    }
    this.sfx.drain();
    t.removeBall();
    this.d.lights.setRunning(false);
    this.setState('DRAINED');
    this.say(this.ball < BALLS ? 'BALL LOST' : 'LAST BALL LOST', DRAINED_S * 1000);
  }

  private addScore(base: number): number {
    const pts = base * this.mult;
    this.score += pts;
    this.updateHud();
    return pts;
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  private updateHud(): void {
    const pad = (n: number): string => String(n).padStart(7, '0');
    if (this.elScore) this.elScore.textContent = pad(this.score);
    if (this.elHi) this.elHi.textContent = pad(Math.max(this.hi, this.score));
    if (this.elBall) this.elBall.textContent = `${Math.min(this.ball, BALLS)}/${BALLS}`;
    if (this.elMult) this.elMult.textContent = `${this.mult}×`;
    this.d.lights.setBonusFill(this.mult);
    if (this.elMission) {
      this.elMission.textContent = this.isRunning()
        ? `Projects ${this.visited.size}/6 · Lanes ${this.litLanes.size}/4`
        : 'Hit all six project cards, then light all four language lanes.';
    }
  }

  private syncStartButton(): void {
    if (!this.btnStart) return;
    const idle = this.state === 'ATTRACT' || this.state === 'GAME_OVER';
    this.btnStart.disabled = !idle;
    const label = this.btnStart.querySelector('span');
    if (label) label.textContent = idle ? 'Start' : 'Playing';
  }

  private syncMuteButton(): void {
    if (!this.btnMute) return;
    const on = !this.sfx.muted;
    this.btnMute.setAttribute('aria-pressed', String(on));
    this.btnMute.setAttribute('aria-label', on ? 'Sound is on. Turn sound off' : 'Sound is off. Turn sound on');
    const t = this.btnMute.querySelector('.mute-text');
    if (t) t.textContent = on ? 'Sound on' : 'Sound off';
  }
}

export function createGame(deps: GameDeps): Game {
  return new Game(deps);
}
