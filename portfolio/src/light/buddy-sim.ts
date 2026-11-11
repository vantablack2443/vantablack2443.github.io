/**
 * The buddy's brain: a tiny platformer model with no DOM, so it can be tested.
 * Page coordinates, y grows downward, his position is the point between his feet
 * (or, while he is held, between his hands). The glass panels are solid boxes: he
 * stands on their tops, is stopped by their sides and bumps his head on their
 * undersides; the bottom of the page is a floor.
 *
 * Modes: on the ground, in the air, climbing a side (after jumping up and catching it
 * with his hands), pulling up over the top (or lowering himself over it), held by the
 * pointer. The map of what reaches what lives in buddy-plan.ts. On top sit the cursor
 * following (which plans a route to the panel under the cursor) and the weighted "what
 * shall I do now" that keeps him calm when nobody is looking.
 */

import {
  CATCH_T,
  CLIMB,
  CLIMB_DOWN,
  CROUCH,
  DOWN_T,
  DROP_MAX,
  DT,
  EPS,
  GRAVITY,
  HOLD_REACH,
  LAND_T,
  OVERLAP,
  PULL_T,
  RUN,
  RUN_UP,
  TERMINAL,
  WALK,
  Plan,
  over,
  stepBody,
  type Edge,
  type Metrics,
  type Rect,
} from './buddy-plan';

export type { Edge, Metrics, Rect };
export { CLIMB, CLIMB_DOWN, CROUCH, GRAVITY, OVERLAP, RUN, TERMINAL, WALK };

export interface World {
  panels: Rect[]; // glass panels: solid boxes
  floor: number; // y of the page bottom
  width: number; // page width
}

export type Anim = 'idle' | 'ready' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'hang' | 'climb';

export const DEFAULT_METRICS: Metrics = { hw: 14, bh: 72, crouch: 58, climbHalf: 17, grip: 73, hang: 81, stride: { walk: 50, run: 110, climb: 34 } };

export const HOP_V = 330; // a small happy jump
export const MAX_THROW = 1000; // fastest he can be thrown, px/s
export const FOLLOW_ATTENTION = 2.5; // he follows the cursor while it moved this recently
export const FOLLOW_HOLD = 4; // and stays put this much longer before going back to roaming
export const DEAD_ZONE = 36; // he stops this close to the cursor's x
export const READY_RANGE = 90; // fists up when the cursor is this close
const ACC = 900; // px/s^2, speeding up on the ground
const DEC = 1400; // and slowing down
const SPRING = 45; // rad/s of the hanging spring (hands towards the pointer)
const DAMP = 0.9;
const SWAY_W = 7; // pendulum: rad/s
const SWAY_Z = 0.15; // damping ratio
const SWAY_L = 55; // px, the arm of the pendulum
const SWAY_MAX = 1.2;

type Mode = 'ground' | 'air' | 'climb' | 'pull' | 'grab';

interface Climb {
  holds: number[]; // the holds along the wall, in the order he passes them
  i: number; // the one his hands are on
  up: boolean;
  sub: 'catch' | 'move' | 'hop' | 'drop';
  t: number;
  vy: number;
  cy: number; // height of his hands
  e: Edge | null;
}

export interface Puff {
  on: boolean;
  x: number;
  y: number;
  age: number;
}
export const PUFF_LIFE = 0.45;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class BuddySim {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  face: 1 | -1 = 1;
  anim: Anim = 'idle';
  animTime = 0; // seconds in the current animation
  phase = 0; // cycles (0..1) of walk, run, climb and hang: advanced by distance, not time; the frame is floor(phase * n) % n
  frame = 0; // jump and fall: which frame of the clip the sim wants (0-based)
  mode: Mode = 'air';
  /** Reduced motion: he stands where he is (grabbing and dropping him still work). */
  still = false;
  bubbleT = 0; // seconds since he was grabbed (the "!" bubble)
  sway = 0; // radians while held, 0 = hanging straight down, negative = the body trails to the left
  swayV = 0;
  tilt = 0; // radians in the air after a release, eases to 0
  readonly puffs: Puff[] = Array.from({ length: 6 }, () => ({ on: false, x: 0, y: 0, age: 0 }));
  /** How much of the time he spent walking, climbing or jumping (for the tests and for tuning). */
  moved = 0;
  total = 0;
  /** How many of each kind of move he has started (for the tests). */
  readonly count = { jump: 0, drop: 0, grab: 0, descend: 0, wallHop: 0 };

  private m: Metrics = DEFAULT_METRICS;
  private pl: Plan = new Plan([{ x: 0, y: 0, w: 0, h: 0 }], 0, DEFAULT_METRICS);
  private width = 0;
  private dropMax = DROP_MAX;
  private ground = 0;
  private plan: Edge[] = [];
  private goalPlat = -1;
  private goalX = 0;
  private aim = NaN; // x he is walking to on this platform
  private aimOff = false; // may walk off the edge (a planned drop)
  private runOk = false; // may run when the way is long
  private running = false;
  private spd = 0; // ground speed, px/s, along sdir
  private sdir: 1 | -1 = 1;
  private peakRun = false;
  private runup = false;
  private peek = 0; // after arriving: face this way for a moment (looking over an edge)
  private rest = 1;
  private readyT = 0; // seconds of the "fists up" pose left (roaming)
  private lock = 0; // seconds he cannot move: crouching before a jump, recovering from a landing
  private pending: Edge | null = null; // the jump he is crouching for
  private gv = 0; // ground slide after a landing
  private catchE: Edge | null = null; // the grab he is flying: he may catch the wall
  private pushVx = 0; // a descent's push inward, applied once his head is clear of the panel he hung from
  private pushY = 0;
  private airAcc = 0; // time not yet simulated in the air (fixed steps)
  private cl: Climb | null = null;
  private pull: { xs: number; ys: number; xe: number; ye: number; t: number; T: number; dir: 1 | -1; hold: number } | null = null;
  private arc: { x0: number; y0: number; x1: number; y1: number; t: number; T: number; plat: number } | null = null;
  private t = 0;
  // the cursor
  private ptr = { x: 0, y: 0, t: -99, on: false };
  private vp: { top: number; bottom: number } | null = null;
  private fTarget = -1; // platform he is heading for because of the cursor
  private fCand = -1;
  private fCandT = 0;
  private fLast = -99;
  private fPx = 0;
  private fPy = 0;
  private fMoving = false;
  private following = false;
  private hopT = -99;
  // held by the pointer
  private tx = 0;
  private ty = 0;
  private hvx = 0;
  private hvy = 0;
  private axf = 0; // the hands' acceleration, low-passed
  private ayf = 0;
  private samples = new Float64Array(12); // 4 x (x, y, t)
  private nSamples = 0;
  private puffN = 0;

  constructor(private readonly rnd: () => number = Math.random) {}

  get hw(): number {
    return this.m.hw;
  }
  get bh(): number {
    return this.m.bh;
  }
  get metrics(): Metrics {
    return this.m;
  }
  /** The platform he stands on (-1 when he is not on one). 0 is the floor. */
  get platform(): number {
    return this.mode === 'ground' ? this.ground : -1;
  }
  get platforms(): readonly Rect[] {
    return this.pl.plats;
  }
  get held(): boolean {
    return this.mode === 'grab';
  }
  get busy(): boolean {
    return this.mode !== 'ground' || this.lock > 0;
  }
  /** The map of what reaches what (for the debug view and the tests). */
  get planner(): Plan {
    return this.pl;
  }
  /** The edges he is going to take, first one next. */
  get route(): readonly Edge[] {
    return this.plan;
  }
  /** Ground speed in px/s. */
  get speed(): number {
    return this.spd;
  }
  /** In a wall hop (hands off the wall for a moment). */
  get hopping(): boolean {
    return this.mode === 'climb' && !!this.cl && (this.cl.sub === 'hop' || this.cl.sub === 'drop');
  }
  /** 'up' or 'down' while on a wall. */
  get climbing(): '' | 'up' | 'down' {
    return this.mode === 'climb' && this.cl ? (this.cl.up ? 'up' : 'down') : '';
  }
  /** The leftmost and rightmost x where he can stand on a platform. */
  span(plat: number): [number, number] {
    return [this.pl.lo[plat], this.pl.hi[plat]];
  }

  setMetrics(m: Metrics): void {
    this.m = m;
    this.rebuild();
  }

  /** Planned drops longer than this are never part of a route (400 by default; tests lower it to force other ways). */
  setDropMax(n: number): void {
    this.dropMax = n;
    this.rebuild();
  }

  /** The page changed shape: rebuild the panels and the map of what reaches what. */
  setWorld(w: World): void {
    const plats = this.pl.plats;
    const same =
      w.width === this.width &&
      w.floor === plats[0].y &&
      w.panels.length === plats.length - 1 &&
      w.panels.every((p, i) => {
        const q = plats[i + 1];
        return p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;
      });
    if (same) return;
    this.width = w.width;
    this.rebuild([{ x: 0, y: w.floor, w: w.width, h: 4000 }, ...w.panels]);
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.fTarget = -1;
    if (this.mode === 'ground') {
      // the panel he stands on may have moved a little (reveal, resize): ride along; if it is gone, fall
      let best = -1;
      const ps = this.pl.plats;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (this.x >= p.x - 2 && this.x <= p.x + p.w + 2 && Math.abs(this.y - p.y) < 120 && (best < 0 || Math.abs(this.y - p.y) < Math.abs(this.y - ps[best].y))) best = i;
      }
      if (best >= 0) {
        this.ground = best;
        this.y = ps[best].y;
      } else {
        this.mode = 'air';
        this.vx = this.vy = 0;
        this.setAnim('fall');
      }
    } else if (this.mode === 'climb' || this.mode === 'pull') {
      this.fall();
    }
    if (this.mode === 'air') this.unstick();
  }

  private rebuild(plats: Rect[] = this.pl.plats): void {
    this.pl = new Plan(plats, this.width, this.m, this.dropMax);
  }

  /** Put him on a platform, standing, at x. */
  place(plat: number, x: number): void {
    this.ground = plat;
    this.mode = 'ground';
    this.x = clamp(x, this.pl.lo[plat], this.pl.hi[plat]);
    this.y = this.pl.plats[plat].y;
    this.vx = this.vy = this.gv = this.spd = 0;
    this.lock = 0;
    this.pending = null;
    this.catchE = null;
    this.cl = null;
    this.pull = null;
    this.arc = null;
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.runup = false;
    this.fTarget = -1;
    this.rest = 1 + this.rnd() * 2;
    this.setAnim('idle');
  }

  /** The pointer is at (x, y) in page coordinates. `moved` is false when only the page scrolled under it. */
  pointer(x: number, y: number, moved = true): void {
    this.ptr.x = x;
    this.ptr.y = y;
    this.ptr.on = true;
    if (moved) this.ptr.t = this.t;
  }

  /** Optional: the visible part of the page (page y of its top and bottom). Without it he does not mind where the screen is. */
  viewport(top: number, bottom: number): void {
    this.vp = { top, bottom };
  }

  /** Head for platform `plat` (0 is the floor), ending near x; does nothing if it cannot be reached. */
  goTo(plat: number, x: number): void {
    if (this.mode !== 'ground' || this.lock > 0) return;
    this.goalPlat = plat;
    this.goalX = x;
    this.aim = NaN;
    this.runOk = true;
    this.replan();
    if (plat !== this.ground && !this.plan.length) this.goalPlat = -1;
  }

  /** Walk to x on the platform he is on (no further than its edges). */
  walkTo(x: number): void {
    if (this.mode !== 'ground') return;
    this.aim = x;
    this.aimOff = false;
    this.runOk = Math.abs(x - this.x) > 500;
  }

  /** A click, a tap or Enter: a small happy jump. */
  hop(): void {
    if (this.mode !== 'ground' || this.lock > 0) return;
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.spd = 0;
    this.pending = { kind: 'jump', from: this.ground, to: -1, x: this.x, vx: 0, vy: -HOP_V, dir: this.face, run: false, path: [], top: 0, arrX: this.x, time: 0 };
    this.lock = CROUCH;
    this.setAnim('jump');
    this.frame = 0;
  }

  /**
   * Which platform the cursor at (px, py) draws him to: the reachable standable panel it is over, else the reachable platform
   * whose standing point puts his chest nearest to it. -1 when nothing is reachable.
   */
  targetFor(px: number, py: number): number {
    const pl = this.pl;
    const cands = [this.ground, ...pl.reach(this.ground)].filter((j) => pl.usable(j));
    for (const j of cands) {
      const p = pl.plats[j];
      if (j > 0 && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) return j;
    }
    let best = -1;
    let bd = Infinity;
    for (const j of cands) {
      const sx = clamp(px, pl.lo[j], pl.hi[j]);
      const d = Math.hypot(px - sx, py - (pl.plats[j].y - this.m.bh / 2));
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  // ----------------------------------------------------------- grab and drop

  /** Pressed on him: he now hangs from the pointer by his hands. */
  grab(px: number, py: number): void {
    if (this.mode === 'grab') return;
    this.hvx = this.hvy = 0;
    this.axf = this.ayf = 0;
    // hands start where they would be if he hung from where he stands, then the spring lifts them to the pointer
    const hx = this.x;
    const hy = this.mode === 'ground' ? this.y - this.m.bh * 0.9 : this.y - this.m.hang;
    this.mode = 'grab';
    this.x = hx;
    this.y = hy;
    this.tx = px;
    this.ty = py;
    this.nSamples = 0;
    this.sample(px, py);
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.lock = 0;
    this.pending = null;
    this.catchE = null;
    this.cl = null;
    this.pull = null;
    this.arc = null;
    this.gv = this.spd = 0;
    this.bubbleT = 0;
    this.phase = 0;
    this.sway = this.swayV = 0;
    this.tilt = 0;
    this.fTarget = -1;
    this.setAnim('hang');
  }

  /** The pointer moved while he is held. */
  drag(px: number, py: number): void {
    if (this.mode !== 'grab') return;
    this.tx = px;
    this.ty = py;
    this.sample(px, py);
  }

  /** Let go: he is thrown with the pointer's velocity plus his swing (capped), falls, and lands. */
  release(): void {
    if (this.mode !== 'grab') return;
    let vx = 0;
    let vy = 0;
    // the oldest sample no more than 120 ms back, against the newest
    const n = this.nSamples;
    if (n >= 2) {
      const s = this.samples;
      const newest = ((n - 1) % 4) * 3;
      let oldest = newest;
      for (let k = Math.max(0, n - 4); k < n - 1; k++) {
        const i = (k % 4) * 3;
        if (s[newest + 2] - s[i + 2] <= 0.12) {
          oldest = i;
          break;
        }
      }
      const dt = s[newest + 2] - s[oldest + 2];
      if (dt > 0.008) {
        vx = (s[newest] - s[oldest]) / dt;
        vy = (s[newest + 1] - s[oldest + 1]) / dt;
      }
    }
    const sw = this.sway;
    // the swing adds along the tangent of the pendulum
    vx += this.swayV * SWAY_L * Math.cos(sw);
    vy -= this.swayV * SWAY_L * Math.sin(sw);
    const sp = Math.hypot(vx, vy);
    if (sp > MAX_THROW) {
      vx *= MAX_THROW / sp;
      vy *= MAX_THROW / sp;
    }
    const hx = this.x;
    const hy = this.y;
    // let go with the hands inside a standable panel: he arcs onto its top instead of appearing there
    let card = -1;
    const pl = this.pl;
    for (let j = 1; j < pl.plats.length && card < 0; j++) {
      const p = pl.plats[j];
      if (pl.usable(j) && hx >= p.x && hx <= p.x + p.w && hy >= p.y && hy <= p.y + p.h) card = j;
    }
    this.mode = 'air';
    this.x = hx + this.m.hang * Math.sin(sw);
    this.y = hy + this.m.hang * Math.cos(sw);
    this.vx = vx;
    this.vy = vy;
    this.tilt = sw;
    this.sway = this.swayV = 0;
    this.setAnim('fall');
    this.rest = 1 + this.rnd() * 2;
    if (card > 0) {
      const tx = clamp(hx, pl.lo[card], pl.hi[card]);
      const ty = pl.plats[card].y;
      if (pl.fits(tx, ty)) {
        this.arc = { x0: this.x, y0: this.y, x1: tx, y1: ty, t: 0, T: Math.max(0.25, Math.hypot(tx - this.x, ty - this.y) / 600), plat: card };
        this.vx = this.vy = 0;
        this.setAnim('jump');
        this.frame = 1;
        this.puff(this.x, this.y);
        return;
      }
    }
    this.unstick();
    if (this.y > pl.plats[0].y) this.y = pl.plats[0].y;
    if (this.mode === 'air' && this.y >= pl.plats[0].y - EPS) this.land(0);
  }

  private sample(x: number, y: number): void {
    const i = (this.nSamples % 4) * 3;
    this.samples[i] = x;
    this.samples[i + 1] = y;
    this.samples[i + 2] = this.t;
    this.nSamples++;
  }

  /** He is inside a panel (released over one, or the page moved): push him out the shortest way that leaves him room. */
  private unstick(): void {
    const { hw, bh } = this.m;
    const pl = this.pl;
    const plats = pl.plats;
    let hit = -1;
    for (let j = 1; j < plats.length; j++) if (over(this, plats[j], hw, bh)) hit = j;
    if (hit < 0) return;
    const cands: Array<[number, number, number, boolean]> = []; // distance, x, y, lands on top
    for (let j = 1; j < plats.length; j++) {
      const p = plats[j];
      if (!over(this, p, hw, bh)) continue;
      if (this.x >= p.x && this.x <= p.x + p.w) cands.push([this.y - p.y, this.x, p.y, true]);
      cands.push([p.y + p.h + bh - this.y, this.x, p.y + p.h + bh, false]);
      cands.push([this.x + hw - p.x, p.x - hw, this.y, false]);
      cands.push([p.x + p.w - (this.x - hw), p.x + p.w + hw, this.y, false]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, x, y, top] of cands) {
      if (!pl.fits(x, y)) continue;
      this.x = x;
      this.y = y;
      this.vx = 0;
      if (top) {
        this.vy = 0;
        const j = plats.findIndex((p, k) => k > 0 && Math.abs(p.y - y) < 1e-6 && x >= p.x && x <= p.x + p.w);
        this.land(j);
      }
      return;
    }
    // nowhere near has room: the floor, at the nearest free spot
    const fy = plats[0].y;
    for (let d = 0; d < this.width; d += 8)
      for (const x of [this.x + d, this.x - d])
        if (pl.fits(x, fy)) {
          this.x = x;
          this.y = fy;
          this.vx = this.vy = 0;
          this.land(0);
          return;
        }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.animTime += dt;
    if (this.mode === 'grab') this.bubbleT += dt;
    if (this.mode !== 'grab' && this.tilt !== 0) {
      this.tilt *= Math.exp(-dt / 0.12);
      if (Math.abs(this.tilt) < 0.002) this.tilt = 0;
    }
    for (const p of this.puffs) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= PUFF_LIFE) p.on = false;
    }
    const was = this.x;
    const wasY = this.y;
    switch (this.mode) {
      case 'ground':
        this.updateGround(dt);
        break;
      case 'air':
        this.updateAir(dt);
        break;
      case 'climb':
        this.updateClimb(dt);
        break;
      case 'pull':
        this.updatePull(dt);
        break;
      case 'grab':
        this.updateGrab(dt);
        break;
    }
    if (this.mode !== 'grab') {
      this.total += dt;
      const busy = this.mode !== 'ground' || this.lock > 0 || this.fMoving || this.plan.length > 0 || !Number.isNaN(this.aim);
      if (busy || Math.abs(this.x - was) > 1e-6 || Math.abs(this.y - wasY) > 1e-6) this.moved += dt;
    }
  }

  private updateGrab(dt: number): void {
    // the hands follow the pointer on a damped spring: a little lag, a little overshoot; the body swings from them like a pendulum
    const n = Math.ceil(dt / DT - 1e-9);
    const h = dt / n;
    const w2 = SPRING * SPRING;
    const c = 2 * DAMP * SPRING;
    const lp = 1 - Math.exp(-h / 0.05);
    const zeta = this.still ? 1 : SWAY_Z;
    const gate = Math.min(1, this.bubbleT / 0.2); // the hands fly to the pointer at the grab: that is no swing
    for (let i = 0; i < n; i++) {
      const pvx = this.hvx;
      const pvy = this.hvy;
      this.hvx += (w2 * (this.tx - this.x) - c * this.hvx) * h;
      this.hvy += (w2 * (this.ty - this.y) - c * this.hvy) * h;
      this.x += this.hvx * h;
      this.y += this.hvy * h;
      this.axf += ((this.hvx - pvx) / h - this.axf) * lp;
      this.ayf += ((this.hvy - pvy) / h - this.ayf) * lp;
      const s = this.sway;
      const a = -SWAY_W * SWAY_W * Math.sin(s) - 2 * zeta * SWAY_W * this.swayV - (gate * (this.axf * Math.cos(s) + this.ayf * Math.sin(s))) / SWAY_L;
      this.swayV += a * h;
      this.sway += this.swayV * h;
      if (this.sway > SWAY_MAX || this.sway < -SWAY_MAX) {
        this.sway = clamp(this.sway, -SWAY_MAX, SWAY_MAX);
        this.swayV = 0;
      }
    }
    if (!Number.isFinite(this.sway) || !Number.isFinite(this.swayV)) this.sway = this.swayV = 0;
    this.x = clamp(this.x, 0, this.width);
    this.y = clamp(this.y, 0, this.pl.plats[0].y);
    // the arms work faster the more he swings and the faster he is dragged
    this.phase = this.wrap(this.phase + (0.7 + Math.min(2.5, Math.abs(this.swayV) * 0.5 + Math.hypot(this.hvx, this.hvy) / 600)) * dt);
  }

  private wrap(p: number): number {
    return p - Math.floor(p);
  }

  private updateGround(dt: number): void {
    const p = this.pl.plats[this.ground];
    if (this.gv !== 0) {
      this.moveX(this.gv * dt, false);
      const d = Math.min(Math.abs(this.gv), 650 * dt);
      this.gv += this.gv > 0 ? -d : d;
      if (this.mode !== 'ground') return;
    }
    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0) {
        const e = this.pending;
        this.pending = null;
        if (e) this.launch(e);
        else this.setAnim('idle');
      }
      return;
    }
    if (this.still) {
      if (this.anim !== 'idle') this.setAnim('idle');
      this.spd = 0;
      return;
    }
    if (this.followTick(dt)) return;

    if (this.plan.length) {
      const e = this.plan[0];
      if (e.from !== this.ground) {
        this.plan = [];
        this.replan();
        return;
      }
      this.runEdge(e, dt);
      return;
    }
    if (this.goalPlat === this.ground) {
      this.goalPlat = -1;
      if (!this.following) {
        this.aim = clamp(this.goalX, this.pl.lo[this.ground], this.pl.hi[this.ground]);
        this.aimOff = false;
        this.runOk = Math.abs(this.aim - this.x) > 220;
      }
    } else if (this.goalPlat >= 0) {
      this.replan();
      if (!this.plan.length) this.goalPlat = -1;
      return;
    }
    if (!Number.isNaN(this.aim)) {
      if (this.stepTo(this.aim, dt, this.aimOff) || this.mode !== 'ground') {
        this.aim = NaN;
        this.rest = this.peek ? 1.6 : 1.8 + this.rnd() * 3.5;
        if (this.peek) this.face = this.peek as 1 | -1;
        this.peek = 0;
        this.setAnim('idle');
      }
      return;
    }
    this.slowDown(dt);
    if (this.readyT > 0) {
      this.readyT -= dt;
      this.setAnim('ready');
    } else if (this.anim !== 'idle') this.setAnim('idle');
    this.rest -= dt;
    if (this.rest <= 0) {
      if (this.t - this.ptr.t < FOLLOW_ATTENTION + FOLLOW_HOLD) this.rest = 0.5; // he has just been watching the cursor: stay a while
      else this.choose(p);
    }
  }

  private slowDown(dt: number): void {
    if (this.spd > 0) {
      this.spd = Math.max(0, this.spd - DEC * dt);
      if (this.spd === 0) this.arrive();
    }
  }

  private arrive(): void {
    if (this.peakRun) {
      this.puff(this.x, this.y); // the skid
      this.peakRun = false;
    }
    this.spd = 0;
    this.running = false;
  }

  /** Carry out the next edge of the route: walk to where it starts, then do it. */
  private runEdge(e: Edge, dt: number): void {
    if (e.run) {
      if (!this.runup) {
        if (this.stepTo(e.x - e.dir * RUN_UP, dt, false)) {
          this.runup = true;
          this.spd = 0;
          this.sdir = e.dir;
        }
        return;
      }
      // the run-up: speed up towards the launch spot and leap without stopping
      this.face = e.dir;
      this.spd = Math.min(RUN, this.spd + ACC * dt);
      const step = this.spd * dt;
      this.setAnim('run');
      this.phase = this.wrap(this.phase + step / this.m.stride.run);
      if ((this.x + e.dir * step - e.x) * e.dir >= 0) {
        this.x = e.x;
        this.runup = false;
        this.begin(e);
      } else this.moveX(e.dir * step, false);
      return;
    }
    if (this.stepTo(e.x, dt, e.kind === 'drop') && this.mode === 'ground') this.begin(e);
  }

  /**
   * Walk or run towards x along the platform, stopping `stop` px short of it. Speeds up and slows down smoothly, runs when the
   * way is long (and `runOk`), with some hysteresis. Returns true on arrival (or when something blocks the way).
   */
  private stepTo(x: number, dt: number, off: boolean, stop = 0): boolean {
    const d = x - this.x;
    const dist = Math.abs(d) - stop;
    if (dist <= 0.5) {
      if (stop === 0) this.x = x;
      this.arrive();
      return true;
    }
    const dir = d > 0 ? 1 : -1;
    if (dir !== this.sdir) {
      this.spd = 0;
      this.sdir = dir;
    }
    this.face = dir;
    if (this.runOk) {
      if (!this.running && dist > 220) this.running = true;
      else if (this.running && dist < 140) this.running = false;
    } else this.running = false;
    const vt = this.running ? RUN : WALK;
    this.spd = this.spd < vt ? Math.min(vt, this.spd + ACC * dt) : Math.max(vt, this.spd - DEC * dt);
    this.spd = Math.min(this.spd, Math.max(Math.sqrt(2 * DEC * dist), 25));
    if (this.spd > 150) this.peakRun = true;
    const before = this.x;
    this.moveX(dir * Math.min(dist, this.spd * dt), off);
    const moved = Math.abs(this.x - before);
    const run = this.spd > 130;
    this.setAnim(run ? 'run' : 'walk');
    this.phase = this.wrap(this.phase + moved / (run ? this.m.stride.run : this.m.stride.walk));
    if (moved < 1e-6 * dt) {
      this.arrive();
      return true;
    }
    return false;
  }

  /** Move along the ground, stopped by walls and by the edges of the panel (unless `off`: he may step off). */
  private moveX(dx: number, off: boolean): void {
    const p = this.pl.plats[this.ground];
    const [limLo, limHi] = this.limits(off);
    this.x = Math.min(limHi, Math.max(limLo, this.x + dx));
    if (this.ground > 0 && (this.x < p.x || this.x > p.x + p.w)) {
      // the centre is past the edge: he falls (a planned drop sets his sideways speed)
      const e = this.plan[0];
      this.mode = 'air';
      this.vx = e && e.kind === 'drop' && e.from === this.ground ? e.vx : this.x < p.x ? -30 : 30;
      this.vy = 0;
      this.spd = 0;
      this.catchE = null;
      this.airAcc = 0;
      this.setAnim('fall');
      this.frame = 0;
    }
  }

  /** How far he can walk from where he stands: [left, right]. */
  private limits(off: boolean): [number, number] {
    const pl = this.pl;
    const p = pl.plats[this.ground];
    const { hw, bh } = this.m;
    let lo = this.ground === 0 ? hw : off ? -1e9 : pl.lo[this.ground];
    let hi = this.ground === 0 ? this.width - hw : off ? 1e9 : pl.hi[this.ground];
    for (let i = 1; i < pl.plats.length; i++) {
      if (i === this.ground) continue;
      const q = pl.plats[i];
      if (q.y >= p.y - 0.5 || q.y + q.h <= p.y - bh + 0.5) continue; // not in his way: below his feet or above his head
      if (q.x >= this.x - 0.5) hi = Math.min(hi, q.x - hw);
      else if (q.x + q.w <= this.x + 0.5) lo = Math.max(lo, q.x + q.w + hw);
    }
    return [lo, Math.max(lo, hi)];
  }

  private begin(e: Edge): void {
    this.face = e.dir;
    this.spd = 0;
    if (e.kind === 'descend') {
      const h = this.pl.holds[e.path[0]];
      const A = this.pl.plats[this.ground];
      this.count.descend++;
      this.mode = 'pull';
      this.cl = { holds: e.path, i: 0, up: false, sub: 'move', t: 0, vy: 0, cy: h.ytop, e };
      this.pull = { xs: h.xc, ys: h.ytop + this.m.grip, xe: e.x, ye: A.y, t: 0, T: DOWN_T, dir: -1, hold: h.id };
      this.face = h.dir;
      this.setAnim('climb');
      this.phase = 0.9;
    } else if (e.kind === 'drop') {
      this.count.drop++;
      this.mode = 'air'; // a drop whose edge he reached exactly
      this.airAcc = 0;
      this.vx = e.vx;
      this.vy = 0;
      this.setAnim('fall');
      this.frame = 0;
    } else if (e.run) {
      this.launch(e);
    } else {
      this.pending = e;
      this.lock = CROUCH;
      this.setAnim('jump');
      this.frame = 0;
    }
  }

  private launch(e: Edge): void {
    this.mode = 'air';
    this.vx = e.vx;
    this.vy = e.vy;
    this.catchE = e.kind === 'grab' ? e : null;
    this.airAcc = 0;
    if (e.kind === 'grab') this.count.grab++;
    else if (e.kind === 'jump' && e.to >= 0) this.count.jump++;
    this.setAnim('jump');
    this.frame = 1;
    this.puff(this.x, this.y);
  }

  private updateAir(dt: number): void {
    if (this.arc) return this.updateArc(dt);
    // fixed steps of 1/120 s, whatever the frame rate: a flight is then the one the planner simulated
    this.airAcc += dt;
    const { hw, bh } = this.m;
    while (this.airAcc >= DT - 1e-9) {
      this.airAcc = Math.max(0, this.airAcc - DT);
      this.vy = Math.min(TERMINAL, this.vy + GRAVITY * DT);
      const j = stepBody(this, DT, this.pl.plats, hw, bh, this.width);
      if (j >= 0) {
        this.land(j, true);
        return;
      }
      if (this.pushVx !== 0 && this.y - bh >= this.pushY) {
        this.vx = this.pushVx;
        this.pushVx = 0;
      }
      if (this.catchE) {
        const id = this.pl.catchAt(this.x, this.y, this.vy);
        if (id >= 0 && this.startCatch(id, this.catchE)) return;
      }
    }
    if (this.anim === 'jump' && this.vy > 120) this.setAnim('fall');
    else if (this.anim !== 'jump' && this.anim !== 'fall') this.setAnim('fall');
    this.frame = this.anim === 'jump' ? (this.vy < -120 ? 1 : 2) : this.vy < 250 ? 0 : 1;
  }

  /** After a release over a card: the quick arc from where he is onto its top. */
  private updateArc(dt: number): void {
    const a = this.arc!;
    a.t += dt;
    const u = Math.min(1, a.t / a.T);
    this.x = a.x0 + (a.x1 - a.x0) * u;
    this.y = a.y0 + (a.y1 - a.y0) * u - 4 * 30 * u * (1 - u);
    this.frame = u < 0.35 ? 1 : u < 0.75 ? 2 : 0;
    this.anim = u < 0.75 ? 'jump' : 'fall';
    if (u >= 1) {
      this.arc = null;
      this.x = a.x1;
      this.y = a.y1;
      this.vx = this.vy = 0;
      this.land(a.plat);
      this.puff(this.x, this.y);
    }
  }

  private land(j: number, fromAir = false): void {
    const speed = this.vy;
    this.ground = j;
    this.y = this.pl.plats[j].y;
    this.mode = 'ground';
    this.gv = Math.max(-220, Math.min(220, this.vx * 0.6));
    this.vx = this.vy = 0;
    this.lock = LAND_T;
    this.pending = null;
    this.catchE = null;
    this.pushVx = 0;
    this.spd = 0;
    this.setAnim('land');
    this.frame = 0;
    if (fromAir && speed > 200) this.puff(this.x, this.y);
    const e = this.plan[0];
    if (e && e.kind !== 'grab' && e.to === j) this.plan.shift();
    else this.plan = [];
    this.rest = Math.max(this.rest, 0.4);
    if (this.goalPlat >= 0 && this.goalPlat !== j) this.replan();
  }

  // ------------------------------------------------------------- climbing

  /** In the air he caught a panel side with his hands. Returns false if that hold is no use for the grab he is flying. */
  private startCatch(id: number, e: Edge): boolean {
    const hs = this.pl.holds;
    const h = hs[id];
    const idx = e.path.indexOf(id);
    const path = idx >= 0 ? e.path.slice(idx) : this.pl.chainUp(id, e.path[e.path.length - 1]);
    if (!path) return false;
    this.mode = 'climb';
    this.catchE = null;
    this.cl = { holds: path, i: 0, up: true, sub: 'catch', t: 0, vy: 0, cy: clamp(this.y - this.m.grip, h.ytop, h.U), e };
    this.vx = this.vy = 0;
    this.face = h.dir;
    this.phase = 0;
    this.setAnim('climb');
    this.y = this.cl.cy + this.m.grip + 3;
    return true;
  }

  private updateClimb(dt: number): void {
    const c = this.cl;
    if (!c) return this.fall();
    const hs = this.pl.holds;
    const grip = this.m.grip;
    const h = hs[c.holds[c.i]];
    this.x += clamp(h.xc - this.x, -80 * dt, 80 * dt);
    const last = c.i === c.holds.length - 1;
    if (c.sub === 'catch') {
      c.t += dt;
      this.y = c.cy + grip + 3 * Math.max(0, 1 - c.t / CATCH_T); // he sags a little and settles
      if (c.t >= CATCH_T) {
        c.sub = 'move';
        this.y = c.cy + grip;
      }
      return;
    }
    if (c.sub === 'hop') {
      const n = hs[c.holds[c.i + 1]];
      c.cy += c.vy * dt + 0.5 * GRAVITY * dt * dt; // exact, so the apex is the height the hop was made for
      c.vy += GRAVITY * dt;
      this.y = c.cy + grip;
      this.frame = c.vy < -120 ? 1 : 2;
      if (c.vy >= -260 && c.vy <= 300 && c.cy <= n.U && c.cy >= n.hmin) {
        c.i++;
        c.cy = clamp(c.cy, n.ytop, n.U);
        c.sub = 'catch';
        c.t = 0;
        this.phase = 0;
        this.setAnim('climb');
      } else if (c.vy > 300 || c.cy > h.U + 30) this.fall();
      return;
    }
    if (c.sub === 'drop') {
      const n = hs[c.holds[c.i + 1]];
      c.vy = Math.min(300, c.vy + GRAVITY * dt);
      c.cy += c.vy * dt;
      this.y = c.cy + grip;
      this.frame = 0;
      if (c.cy >= n.ytop + 2) {
        c.i++;
        c.cy = n.ytop + 2;
        c.sub = 'catch';
        c.t = 0;
        this.phase = 0;
        this.setAnim('climb');
      }
      return;
    }
    if (c.up) {
      c.cy -= CLIMB * dt;
      this.phase = this.wrap(this.phase + (CLIMB * dt) / this.m.stride.climb);
      if (last) {
        if (c.cy <= h.ytop + 4) return this.startPull(h.id, c);
      } else {
        const n = hs[c.holds[c.i + 1]];
        const g = h.top - n.bot;
        if (g <= HOLD_REACH) {
          if (c.cy <= n.U) c.i++;
        } else if (c.cy <= h.ytop + 0.5) {
          c.cy = h.ytop;
          c.sub = 'hop';
          c.vy = -Math.sqrt(2 * GRAVITY * (g + 12));
          this.count.wallHop++;
          this.setAnim('jump');
        }
      }
    } else {
      c.cy += CLIMB_DOWN * dt;
      this.phase = this.wrap(this.phase - (CLIMB_DOWN * dt) / this.m.stride.climb);
      if (last) {
        if (c.cy >= h.U) {
          c.cy = h.U;
          return this.letGo(c);
        }
      } else {
        const n = hs[c.holds[c.i + 1]];
        const g = n.top - h.bot;
        if (g <= HOLD_REACH) {
          if (c.cy >= n.ytop) c.i++;
        } else if (c.cy >= h.U) {
          c.sub = 'drop';
          c.vy = 0;
          this.setAnim('fall');
        }
      }
    }
    this.y = c.cy + grip;
  }

  /** At the lowest hold of a descent: let go with a push inward and fall onto the panel below. */
  private letGo(c: Climb): void {
    const e = c.e;
    const h = this.pl.holds[c.holds[c.i]];
    this.mode = 'air';
    this.x = this.pl.letGoX(h);
    this.y = c.cy + this.m.grip;
    this.vx = 0;
    this.pushVx = e ? e.vx : h.dir * 60;
    this.pushY = h.bot;
    this.airAcc = 0;
    this.vy = 0;
    this.cl = null;
    this.catchE = null;
    this.setAnim('fall');
    this.frame = 0;
  }

  private startPull(holdId: number, c: Climb): void {
    const h = this.pl.holds[holdId];
    const A = this.pl.plats[h.plat];
    this.mode = 'pull';
    this.pull = { xs: this.x, ys: this.y, xe: h.stand, ye: A.y, t: 0, T: PULL_T, dir: 1, hold: holdId };
    this.cl = c;
    this.setAnim('climb');
    this.phase = 0.9;
  }

  /** Over the top: up along the wall, then across onto the panel (or the same backwards, lowering himself over the edge). */
  private updatePull(dt: number): void {
    const p = this.pull;
    if (!p) return this.fall();
    p.t += dt;
    const k = p.dir > 0 ? Math.min(1, p.t / p.T) : Math.max(0, 1 - p.t / p.T);
    const rise = Math.min(1, k / 0.65);
    const slide = Math.max(0, (k - 0.65) / 0.35);
    this.y = p.ys + (p.ye - p.ys) * (1 - (1 - rise) * (1 - rise));
    this.x = p.xs + (p.xe - p.xs) * slide;
    if (p.dir > 0 && p.t >= p.T) {
      const h = this.pl.holds[p.hold];
      this.ground = h.plat;
      this.mode = 'ground';
      this.x = p.xe;
      this.y = p.ye;
      this.lock = LAND_T;
      this.pull = null;
      this.cl = null;
      this.setAnim('land');
      this.frame = 0;
      const e = this.plan[0];
      if (e && e.kind === 'grab' && e.to === h.plat) this.plan.shift();
      else this.plan = [];
      this.rest = 0.6 + this.rnd();
      this.puff(this.x, this.y);
      if (this.goalPlat >= 0 && this.goalPlat !== h.plat) this.replan();
    } else if (p.dir < 0 && p.t >= p.T) {
      this.mode = 'climb';
      this.pull = null;
      this.x = p.xs;
      this.y = p.ys;
      if (this.cl) {
        this.cl.up = false;
        this.cl.sub = 'move';
        this.cl.cy = p.ys - this.m.grip;
      }
      this.phase = 0;
      this.setAnim('climb');
    }
  }

  private fall(): void {
    this.mode = 'air';
    this.vx = this.vy = 0;
    this.plan = [];
    this.goalPlat = -1;
    this.cl = null;
    this.pull = null;
    this.catchE = null;
    this.setAnim('fall');
    this.frame = 0;
  }

  private puff(x: number, y: number): void {
    const p = this.puffs[this.puffN++ % this.puffs.length];
    p.on = true;
    p.x = x;
    p.y = y;
    p.age = 0;
  }

  private setAnim(a: Anim): void {
    if (this.anim === a) return;
    this.anim = a;
    this.animTime = 0;
  }

  // ------------------------------------------------------------- the cursor

  /**
   * Follow the cursor while it keeps moving: pick the platform it draws him to, plan the route, and (on the right platform)
   * walk or run to it. Returns true when it moved him (or kept him standing) this frame, so the roaming code stays out of it.
   */
  private followTick(dt: number): boolean {
    this.following = false;
    const p = this.ptr;
    if (!p.on) return false;
    const age = this.t - p.t;
    if (age > FOLLOW_ATTENTION) {
      this.fTarget = -1;
      this.fMoving = false;
      return false;
    }
    const vp = this.vp;
    if (vp && (p.y < vp.top || p.y > vp.bottom || this.y < vp.top - 200 || this.y > vp.bottom + 200)) return false;
    this.following = true;
    const cand = this.targetFor(p.x, p.y);
    if (cand < 0) return false;
    if (cand !== this.fCand) {
      this.fCand = cand;
      this.fCandT = this.t;
    }
    const since = this.t - this.fLast;
    const routing = this.plan.length > 0 || this.goalPlat >= 0;
    if (cand !== this.fTarget && (this.fTarget < 0 || (this.t - this.fCandT >= 0.25 && since >= 0.35))) this.retarget(cand);
    else if (routing && since >= 0.35 && Math.hypot(p.x - this.fPx, p.y - this.fPy) > 60) this.retarget(cand);
    if (this.plan.length > 0 || this.goalPlat >= 0) return false;
    return this.followDirect(dt, cand);
  }

  private retarget(cand: number): void {
    this.fTarget = cand;
    this.fLast = this.t;
    this.fPx = this.ptr.x;
    this.fPy = this.ptr.y;
    this.aim = NaN;
    this.peek = 0;
    this.runOk = true;
    this.runup = false;
    if (cand === this.ground) {
      this.plan = [];
      this.goalPlat = -1;
      return;
    }
    const path = this.pl.path(this.ground, cand, this.x);
    if (path && path.length) {
      this.plan = path;
      this.goalPlat = cand;
      this.goalX = this.ptr.x;
    } else this.fTarget = this.ground;
  }

  /** On the platform the cursor draws him to: go to its x, stop in the dead zone, face it, fists up when it is close. */
  private followDirect(dt: number, cand: number): boolean {
    const p = this.ptr;
    const pl = this.pl;
    this.aim = NaN;
    this.peek = 0;
    this.runOk = true;
    const tx = clamp(p.x, pl.lo[this.ground], pl.hi[this.ground]);
    const d = tx - this.x;
    if (Math.abs(d) > (this.fMoving ? DEAD_ZONE : DEAD_ZONE + 10)) {
      this.fMoving = true;
      this.readyT = 0;
      if (this.stepTo(tx, dt, false, DEAD_ZONE)) this.fMoving = false;
      return true;
    }
    this.fMoving = false;
    this.slowDown(dt);
    const dx = p.x - this.x;
    if (Math.abs(dx) > 12) this.face = dx > 0 ? 1 : -1;
    const near = Math.hypot(dx, p.y - (this.y - this.m.bh / 2)) < READY_RANGE;
    this.setAnim(near ? 'ready' : 'idle');
    this.rest = Math.max(this.rest, 1);
    // out of reach (straight above him, nothing he can climb): a small hop towards it now and then
    if (cand === this.ground && this.t - this.hopT >= 3 && Math.abs(dx) < 40 && p.y < this.y - this.m.bh && this.y - p.y <= 250 && this.spd === 0) {
      this.hopT = this.t;
      this.hop();
    }
    return true;
  }

  /** The platform whose top is the nearest at or below the point (the one "under" the cursor), or -1. */
  platformAt(x: number, y: number): number {
    const pl = this.pl;
    let best = -1;
    let bestD = Infinity;
    for (let i = 1; i < pl.plats.length; i++) {
      const p = pl.plats[i];
      if (x < p.x || x > p.x + p.w || !pl.usable(i)) continue;
      const inside = y >= p.y && y <= p.y + p.h;
      const d = inside ? 0 : Math.abs(p.y - y);
      if (d < bestD && d < 200) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ------------------------------------------------------- what to do next

  private choose(p: Rect): void {
    const reach = this.reachable();
    const cur = this.ptr.on && this.t - this.ptr.t < 8 ? this.platformAt(this.ptr.x, this.ptr.y) : -1;
    const [lo, hi] = [this.pl.lo[this.ground], this.pl.hi[this.ground]];
    const room = hi - lo;
    const opts: Array<[number, () => void]> = [
      [20, () => this.walkTo(lo + this.rnd() * room)],
      [30, () => (this.rest = 2.5 + this.rnd() * 4.5)],
      [8, () => this.walkTo(clamp(this.x + (this.rnd() < 0.5 ? -1 : 1) * (14 + this.rnd() * 40), lo, hi))],
      [3, () => this.hop()],
      [4, () => ((this.readyT = 1), (this.rest = 1.6))],
    ];
    if (this.ground > 0 && room > 80) {
      opts.push([
        7,
        () => {
          const right = this.x - p.x > p.x + p.w - this.x;
          this.walkTo(right ? hi : lo);
          this.peek = right ? 1 : -1; // looks over the edge, then turns back
        },
      ]);
    }
    if (reach.length) opts.push([12, () => this.travel(this.nearby(reach))]);
    if (cur > 0 && cur !== this.ground && reach.includes(cur)) opts.push([7, () => this.travel(cur)]);
    let r = this.rnd() * opts.reduce((s, o) => s + o[0], 0);
    for (const [w, fn] of opts) {
      r -= w;
      if (r <= 0) return void fn();
    }
  }

  /** A destination from the list, the nearer ones more likely (a trip across the whole page is rare). */
  private nearby(list: number[]): number {
    let sum = 0;
    for (const i of list) sum += 1 / (1 + Math.abs(this.pl.plats[i].y - this.y) / 250);
    let r = this.rnd() * sum;
    for (const i of list) {
      r -= 1 / (1 + Math.abs(this.pl.plats[i].y - this.y) / 250);
      if (r <= 0) return i;
    }
    return list[list.length - 1];
  }

  private travel(to: number): void {
    const [lo, hi] = [this.pl.lo[to], this.pl.hi[to]];
    const x = lo + this.rnd() * (hi - lo);
    this.goTo(to, x);
    let len = 0;
    let at = this.x;
    for (const e of this.plan) {
      len += Math.abs(e.x - at);
      at = e.arrX;
    }
    this.runOk = len + Math.abs(x - at) > 500;
  }

  private replan(): void {
    this.plan = [];
    this.runup = false;
    if (this.goalPlat < 0 || this.goalPlat === this.ground) return;
    this.plan = this.pl.path(this.ground, this.goalPlat, this.x) ?? [];
  }

  /** Platforms he can get to from here (the floor is not a destination: the footer is the bottom of the page). */
  private reachable(): number[] {
    return this.pl.reach(this.ground).filter((j) => j > 0);
  }
}
