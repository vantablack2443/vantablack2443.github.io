/**
 * The buddy's brain: a tiny platformer model with no DOM, so it can be tested.
 * Page coordinates, y grows downward, his position is the point between his feet
 * (or, while he is held, between his hands). The glass panels are solid boxes: he
 * stands on their tops, is stopped by their sides and bumps his head on their
 * undersides; the bottom of the page is a floor.
 *
 * Modes: on the ground, in the air, climbing a side, pulling up over the top, held
 * by the pointer. On top of that sit a planner (which panel reaches which, found by
 * simulating the very same physics) and the weighted "what shall I do now" that
 * keeps him calm. The cursor only bends the same machinery.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface World {
  panels: Rect[]; // glass panels: solid boxes
  floor: number; // y of the page bottom
  width: number; // page width
}

/** What the sprite sheet says about his body (sheet.json "metrics", in screen px). */
export interface Metrics {
  hw: number; // half the body width, for the collisions
  bh: number; // body height
  climbHalf: number; // half the width of a climb frame (arms out)
  grip: number; // height of the higher hand above the feet while climbing
  hang: number; // feet below the joined hands while hanging
  stride: { walk: number; guard: number; climb: number }; // px of travel per full cycle of the legs
}

export type Anim = 'idle' | 'walk' | 'guard' | 'jump' | 'fall' | 'land' | 'hang' | 'climb';

export const DEFAULT_METRICS: Metrics = { hw: 14, bh: 80, climbHalf: 17, grip: 73, hang: 81, stride: { walk: 46, guard: 40, climb: 34 } };

export const GRAVITY = 1400; // px/s^2
export const TERMINAL = 1100; // fastest fall, px/s
export const WALK = 62; // px/s
export const GUARD = 46;
export const CLIMB = 38;
export const JUMP_V = 520; // launch speed of a full jump: a 96 px apex
export const HOP_V = 330; // a small happy jump
export const MAX_RISE = 70; // highest ledge a jump can reach
export const MAX_GAP = 90; // widest gap a jump can cross
export const MAX_THROW = 1000; // fastest he can be thrown, px/s
export const OVERLAP = 5; // how far his hands reach into a panel's side while climbing
export const FOLLOW_RANGE = 400; // the pointer is noticed within this distance
export const CROUCH = 0.12; // the anticipation before every jump
const LAND_T = 0.2;
const PULL_T = 0.55;
const CLIMB_GAP = 140; // the longest stretch of a climb with no panel edge beside him to hold on to
const CLIMB_MAX = 3200; // the longest climb (the whole page)
const STEP = 3; // largest move per collision sub-step, px
const EPS = 1e-6;
const SPRING = 20; // rad/s of the hanging spring (hands towards the pointer)
const DAMP = 0.7;

type Mode = 'ground' | 'air' | 'climb' | 'pull' | 'grab';

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Edge {
  kind: 'jump' | 'drop' | 'climb';
  from: number;
  to: number;
  x: number; // where he stands to start it
  vx: number;
  vy: number;
  dir: 1 | -1; // jump and drop: the way he heads; climb: the side the wall is on
  wall: number; // climb: x of the panel's side
  top: number; // climb: where he ends up standing on the panel
}

export interface Puff {
  on: boolean;
  x: number;
  y: number;
  age: number;
}
export const PUFF_LIFE = 0.45;

/**
 * Move a body one step through the panels (plats[0] is the floor). Sub-stepped so nothing tunnels. Returns the index of the
 * platform he landed on, or -1. A panel only catches him when his centre is over its top: past the corner he slides off.
 */
function stepBody(b: Body, dt: number, plats: Rect[], hw: number, bh: number, width: number): number {
  const n = Math.max(1, Math.ceil((Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt) / STEP));
  const sx = (b.vx * dt) / n;
  const sy = (b.vy * dt) / n;
  for (let i = 0; i < n; i++) {
    b.x += sx;
    if (b.x < hw) {
      b.x = hw;
      b.vx = 0;
    } else if (b.x > width - hw) {
      b.x = width - hw;
      b.vx = 0;
    }
    for (let j = 1; j < plats.length; j++) {
      const p = plats[j];
      if (!over(b, p, hw, bh)) continue;
      b.x = sx > 0 ? p.x - hw : sx < 0 ? p.x + p.w + hw : b.x < p.x + p.w / 2 ? p.x - hw : p.x + p.w + hw;
      b.vx = 0;
    }
    b.y += sy;
    if (b.y < bh) {
      b.y = bh;
      if (b.vy < 0) b.vy = 0;
    }
    for (let j = 0; j < plats.length; j++) {
      const p = plats[j];
      if (!over(b, p, hw, bh)) continue;
      if (b.x >= p.x && b.x <= p.x + p.w) {
        if (sy > 0) {
          b.y = p.y;
          b.vy = 0;
          return j;
        }
        if (sy < 0) {
          b.y = p.y + p.h + bh;
          b.vy = 0;
        }
      } else {
        // the corner: slide off sideways, if there is room there (a gap narrower than he is catches him on the nearer edge)
        const side = b.x < p.x + p.w / 2 ? p.x - hw : p.x + p.w + hw;
        const here = b.x;
        b.x = side;
        let room = true;
        for (let k = 1; k < plats.length && room; k++) if (k !== j && over(b, plats[k], hw, bh)) room = false;
        if (room) {
          b.vx = 0;
        } else {
          b.x = Math.min(p.x + p.w, Math.max(p.x, here));
          b.vx = 0;
          if (sy > 0) {
            b.y = p.y;
            b.vy = 0;
            return j;
          }
          b.y = p.y + p.h + bh;
          b.vy = 0;
        }
      }
    }
  }
  return -1;
}

function over(b: Body, p: Rect, hw: number, bh: number): boolean {
  return b.x + hw > p.x + EPS && b.x - hw < p.x + p.w - EPS && b.y > p.y + EPS && b.y - bh < p.y + p.h - EPS;
}

export class BuddySim {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  face: 1 | -1 = 1;
  anim: Anim = 'idle';
  animTime = 0; // seconds in the current animation
  phase = 0; // frames of a cycle (walk, guard, climb, hang): advanced by distance, not time
  mode: Mode = 'air';
  /** Reduced motion: he stands where he is (grabbing and dropping him still work). */
  still = false;
  bubbleT = 0; // seconds since he was grabbed (the "!" bubble)
  readonly puffs: Puff[] = Array.from({ length: 6 }, () => ({ on: false, x: 0, y: 0, age: 0 }));
  /** How much of the time he spent walking, climbing or jumping (for the tests and for tuning). */
  moved = 0;
  total = 0;

  private m: Metrics = DEFAULT_METRICS;
  private plats: Rect[] = [{ x: 0, y: 0, w: 0, h: 0 }]; // 0 is the floor
  private width = 0;
  private lo: number[] = [0];
  private hi: number[] = [0];
  private edges: Edge[][] = [[]];
  private ground = 0;
  private plan: Edge[] = [];
  private goalPlat = -1;
  private goalX = 0;
  private aim = NaN; // x he is walking to on this platform
  private aimGuard = false;
  private aimOff = false; // may walk off the edge (a planned drop)
  private aimFollow = false;
  private peek = 0; // after arriving: face this way for a moment (looking over an edge)
  private rest = 1;
  private lock = 0; // seconds he cannot move: crouching before a jump, recovering from a landing
  private pending: Edge | null = null; // the jump he is crouching for
  private gv = 0; // ground slide after a landing
  private glance = 0;
  private climbE: Edge | null = null;
  private pullT = 0;
  private pullY = 0;
  private pullX = 0;
  private limLo = 0;
  private limHi = 0;
  private t = 0;
  private ptr = { x: 0, y: 0, t: -99, on: false };
  // held by the pointer
  private tx = 0;
  private ty = 0;
  private hvx = 0;
  private hvy = 0;
  private samples = new Float64Array(12); // 4 x (x, y, t)
  private nSamples = 0;
  private puffN = 0;
  private scratch: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private landX = 0;

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
    return this.plats;
  }
  get held(): boolean {
    return this.mode === 'grab';
  }
  /** The leftmost and rightmost x where he can stand on a platform. */
  span(plat: number): [number, number] {
    return [this.lo[plat], this.hi[plat]];
  }
  /** Where he stands now if he is on the ground (the hand point while held). */
  get busy(): boolean {
    return this.mode !== 'ground' || this.lock > 0;
  }

  setMetrics(m: Metrics): void {
    this.m = m;
    this.buildEdges();
  }

  /** The page changed shape: rebuild the panels and the map of what reaches what. */
  setWorld(w: World): void {
    const same =
      w.width === this.width &&
      w.floor === this.plats[0].y &&
      w.panels.length === this.plats.length - 1 &&
      w.panels.every((p, i) => {
        const q = this.plats[i + 1];
        return p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;
      });
    if (same) return;
    this.width = w.width;
    this.plats = [{ x: 0, y: w.floor, w: w.width, h: 4000 }, ...w.panels];
    this.buildEdges();
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    if (this.mode === 'ground') {
      // the panel he stands on may have moved a little (reveal, resize): ride along; if it is gone, fall
      let best = -1;
      for (let i = 0; i < this.plats.length; i++) {
        const p = this.plats[i];
        if (this.x >= p.x - 2 && this.x <= p.x + p.w + 2 && Math.abs(this.y - p.y) < 120 && (best < 0 || Math.abs(this.y - p.y) < Math.abs(this.y - this.plats[best].y))) best = i;
      }
      if (best >= 0) {
        this.ground = best;
        this.y = this.plats[best].y;
      } else {
        this.mode = 'air';
        this.vx = this.vy = 0;
        this.setAnim('fall');
      }
    } else if (this.mode === 'climb' || this.mode === 'pull') {
      this.mode = 'air';
      this.vx = this.vy = 0;
      this.setAnim('fall');
    }
    if (this.mode === 'air') this.unstick();
  }

  /** Put him on a platform, standing, at x. */
  place(plat: number, x: number): void {
    this.ground = plat;
    this.mode = 'ground';
    this.x = Math.min(this.hi[plat], Math.max(this.lo[plat], x));
    this.y = this.plats[plat].y;
    this.vx = this.vy = this.gv = 0;
    this.lock = 0;
    this.pending = null;
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.rest = 1 + this.rnd() * 2;
    this.setAnim('idle');
  }

  /** The pointer moved (page coordinates). */
  pointer(x: number, y: number): void {
    this.ptr.x = x;
    this.ptr.y = y;
    this.ptr.t = this.t;
    this.ptr.on = true;
  }

  /** Head for platform `plat` (0 is the floor), ending near x; does nothing if it cannot be reached. */
  goTo(plat: number, x: number): void {
    if (this.mode !== 'ground' || this.lock > 0) return;
    this.goalPlat = plat;
    this.goalX = x;
    this.aim = NaN;
    this.replan();
    if (plat !== this.ground && !this.plan.length) this.goalPlat = -1;
  }

  /** Walk to x on the platform he is on (no further than its edges). */
  walkTo(x: number, guard = false): void {
    if (this.mode !== 'ground') return;
    this.aim = x;
    this.aimGuard = guard;
    this.aimOff = false;
    this.aimFollow = false;
  }

  /** A click, a tap or Enter: a small happy jump. */
  hop(): void {
    if (this.mode !== 'ground' || this.lock > 0) return;
    this.plan = [];
    this.goalPlat = -1;
    this.aim = NaN;
    this.pending = { kind: 'jump', from: this.ground, to: -1, x: this.x, vx: 0, vy: -HOP_V, dir: this.face, wall: 0, top: 0 };
    this.lock = CROUCH;
    this.setAnim('jump');
  }

  // ----------------------------------------------------------- grab and drop

  /** Pressed on him: he now hangs from the pointer by his hands. */
  grab(px: number, py: number): void {
    if (this.mode === 'grab') return;
    this.hvx = this.hvy = 0;
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
    this.gv = 0;
    this.bubbleT = 0;
    this.phase = 0;
    this.setAnim('hang');
  }

  /** The pointer moved while he is held. */
  drag(px: number, py: number): void {
    if (this.mode !== 'grab') return;
    this.tx = px;
    this.ty = py;
    this.sample(px, py);
  }

  /** Let go: he is thrown with the pointer's velocity (capped), falls, and lands. */
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
    const sp = Math.hypot(vx, vy);
    if (sp > MAX_THROW) {
      vx *= MAX_THROW / sp;
      vy *= MAX_THROW / sp;
    }
    this.mode = 'air';
    this.y += this.m.hang; // the hands are let go: the feet are where the body hung
    this.vx = vx;
    this.vy = vy;
    this.setAnim('fall');
    this.unstick(true);
    if (this.y > this.plats[0].y) this.y = this.plats[0].y;
    if (this.mode === 'air' && this.y >= this.plats[0].y - EPS) this.land(0);
    this.rest = 1 + this.rnd() * 2;
  }

  private sample(x: number, y: number): void {
    const i = (this.nSamples % 4) * 3;
    this.samples[i] = x;
    this.samples[i + 1] = y;
    this.samples[i + 2] = this.t;
    this.nSamples++;
  }

  /**
   * He is inside a panel (released over one, or the page moved): push him out the shortest way. Let go with the hands inside a
   * panel, he is put on top of it instead (that is the panel he was dropped on).
   */
  private unstick(released = false): void {
    const hw = this.m.hw;
    const bh = this.m.bh;
    for (let pass = 0; pass < 8; pass++) {
      let hit = -1;
      for (let j = 1; j < this.plats.length; j++) if (over(this, this.plats[j], hw, bh)) hit = j;
      if (hit < 0) return;
      const p = this.plats[hit];
      if (released && this.x >= p.x && this.x <= p.x + p.w && this.y - this.m.hang < p.y + p.h - 4 && this.fits(this.x, p.y)) {
        this.y = p.y;
        this.vx = this.vy = 0;
        this.land(hit);
        this.puff(this.x, this.y);
        return;
      }
      const up = this.y - p.y;
      const down = p.y + p.h + bh - this.y;
      const left = this.x + hw - p.x;
      const right = p.x + p.w - (this.x - hw);
      const best = Math.min(up, down, left, right);
      if (best === up && this.x >= p.x && this.x <= p.x + p.w) {
        this.y = p.y;
        this.vx = this.vy = 0;
        this.land(hit);
        return;
      }
      if (best === down) this.y = p.y + p.h + bh;
      else if (best === left || (best === up && this.x < p.x + p.w / 2)) this.x = p.x - hw;
      else this.x = p.x + p.w + hw;
      this.vx = 0;
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.animTime += dt;
    if (this.mode === 'grab') this.bubbleT += dt;
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
      if (this.mode !== 'ground' || this.lock > 0 || Math.abs(this.x - was) > 1e-6 || Math.abs(this.y - wasY) > 1e-6 || !Number.isNaN(this.aim)) this.moved += dt;
    }
  }

  private updateGrab(dt: number): void {
    // the hands follow the pointer on a damped spring: a little lag, a little overshoot
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    const w2 = SPRING * SPRING;
    const c = 2 * DAMP * SPRING;
    for (let i = 0; i < n; i++) {
      this.hvx += (w2 * (this.tx - this.x) - c * this.hvx) * h;
      this.hvy += (w2 * (this.ty - this.y) - c * this.hvy) * h;
      this.x += this.hvx * h;
      this.y += this.hvy * h;
    }
    this.x = Math.min(this.width, Math.max(0, this.x));
    this.y = Math.min(this.plats[0].y, Math.max(0, this.y));
    // the legs kick faster the faster he is dragged
    this.phase += (4 + Math.min(16, Math.hypot(this.hvx, this.hvy) / 45)) * dt;
  }

  private updateGround(dt: number): void {
    const p = this.plats[this.ground];
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
      return;
    }
    this.watchPointer(dt);

    if (this.plan.length) {
      const e = this.plan[0];
      if (e.from !== this.ground) {
        this.plan = [];
        this.replan();
        return;
      }
      if (this.stepTo(e.x, dt, false, e.kind === 'drop') && this.mode === 'ground') this.begin(e);
      return;
    }
    if (this.goalPlat === this.ground) {
      this.aim = Math.min(this.hi[this.ground], Math.max(this.lo[this.ground], this.goalX));
      this.aimGuard = false;
      this.aimOff = false;
      this.aimFollow = false;
      this.goalPlat = -1;
    } else if (this.goalPlat >= 0) {
      this.replan();
      if (!this.plan.length) this.goalPlat = -1;
      return;
    }
    if (!Number.isNaN(this.aim)) {
      if (this.stepTo(this.aim, dt, this.aimGuard, this.aimOff) || this.mode !== 'ground') {
        this.aim = NaN;
        this.rest = this.peek ? 1.6 : 2 + this.rnd() * 4;
        if (this.peek) this.face = this.peek as 1 | -1;
        this.peek = 0;
        this.setAnim('idle');
      }
      return;
    }
    if (this.anim !== 'idle') this.setAnim('idle');
    this.rest -= dt;
    if (this.rest <= 0) this.choose(p);
  }

  /** Walk towards x along the platform. Returns true on arrival (or when something blocks the way). */
  private stepTo(x: number, dt: number, guard: boolean, off: boolean): boolean {
    const d = x - this.x;
    if (Math.abs(d) < 1) {
      this.x = x;
      return true;
    }
    const dir = d > 0 ? 1 : -1;
    const speed = guard ? GUARD : WALK;
    const before = this.x;
    this.face = dir;
    this.moveX(dir * Math.min(Math.abs(d), speed * dt), off);
    const moved = Math.abs(this.x - before);
    this.setAnim(guard ? 'guard' : 'walk');
    this.phase += (moved * 6) / (guard ? this.m.stride.guard : this.m.stride.walk);
    return moved < 1e-6 * dt || (this.mode === 'ground' && Math.abs(x - this.x) < 1);
  }

  /** Move along the ground, stopped by walls and by the edges of the panel (unless `off`: he may step off). */
  private moveX(dx: number, off: boolean): void {
    const p = this.plats[this.ground];
    this.limits(off);
    const nx = Math.min(this.limHi, Math.max(this.limLo, this.x + dx));
    this.x = nx;
    if (this.ground > 0 && (this.x < p.x || this.x > p.x + p.w)) {
      // the centre is past the edge: he falls (a planned drop sets his sideways speed)
      const e = this.plan[0];
      this.mode = 'air';
      this.vx = e && e.kind === 'drop' && e.from === this.ground ? e.vx : this.x < p.x ? -30 : 30;
      this.vy = 0;
      this.setAnim('fall');
    }
  }

  /** limLo and limHi: how far he can walk from where he stands. */
  private limits(off: boolean): void {
    const p = this.plats[this.ground];
    const hw = this.m.hw;
    const bh = this.m.bh;
    let lo = this.ground === 0 ? hw : off ? -1e9 : this.lo[this.ground];
    let hi = this.ground === 0 ? this.width - hw : off ? 1e9 : this.hi[this.ground];
    for (let i = 1; i < this.plats.length; i++) {
      if (i === this.ground) continue;
      const q = this.plats[i];
      if (q.y >= p.y - 0.5 || q.y + q.h <= p.y - bh + 0.5) continue; // not in his way: below his feet or above his head
      if (q.x >= this.x - 0.5) hi = Math.min(hi, q.x - hw);
      else if (q.x + q.w <= this.x + 0.5) lo = Math.max(lo, q.x + q.w + hw);
    }
    this.limLo = lo;
    this.limHi = Math.max(lo, hi);
  }

  private begin(e: Edge): void {
    this.face = e.dir;
    if (e.kind === 'climb') {
      this.mode = 'climb';
      this.climbE = e;
      this.vx = this.vy = 0;
      this.phase = 0;
      this.setAnim('climb');
    } else if (e.kind === 'jump') {
      this.pending = e;
      this.lock = CROUCH;
      this.setAnim('jump');
    } else {
      this.mode = 'air'; // a drop whose edge he reached exactly
      this.vx = e.vx;
      this.vy = 0;
      this.setAnim('fall');
    }
  }

  private launch(e: Edge): void {
    this.mode = 'air';
    this.vx = e.vx;
    this.vy = e.vy;
    this.puff(this.x, this.y);
  }

  private updateAir(dt: number): void {
    this.vy = Math.min(TERMINAL, this.vy + GRAVITY * dt);
    const j = stepBody(this, dt, this.plats, this.m.hw, this.m.bh, this.width);
    if (this.anim === 'jump' && this.vy > 0) this.setAnim('fall');
    else if (this.anim !== 'jump' && this.anim !== 'fall') this.setAnim('fall');
    if (j >= 0) this.land(j, true);
  }

  private land(j: number, fromAir = false): void {
    const speed = this.vy;
    this.ground = j;
    this.y = this.plats[j].y;
    this.mode = 'ground';
    this.gv = Math.max(-220, Math.min(220, this.vx * 0.6));
    this.vx = this.vy = 0;
    this.lock = LAND_T;
    this.pending = null;
    this.setAnim('land');
    if (fromAir && speed > 200) this.puff(this.x, this.y);
    const e = this.plan[0];
    if (e && e.kind !== 'climb' && e.to === j) this.plan.shift();
    else this.plan = [];
    this.rest = Math.max(this.rest, 0.4);
    if (this.goalPlat >= 0 && this.goalPlat !== j) this.replan();
  }

  private updateClimb(dt: number): void {
    const e = this.climbE;
    if (!e) return this.fall();
    const A = this.plats[e.to];
    const xc = e.wall - e.dir * (this.m.climbHalf - OVERLAP);
    this.x += Math.max(-80 * dt, Math.min(80 * dt, xc - this.x));
    this.y -= CLIMB * dt;
    this.phase += (CLIMB * dt * 6) / this.m.stride.climb;
    if (this.y <= A.y + this.m.grip - 6) {
      this.mode = 'pull';
      this.pullT = 0;
      this.pullY = this.y;
      this.pullX = this.x;
      this.setAnim('land');
    }
  }

  /** Over the top: up along the wall, then across onto the panel, in the crouched landing pose. */
  private updatePull(dt: number): void {
    const e = this.climbE;
    if (!e) return this.fall();
    const A = this.plats[e.to];
    this.pullT += dt;
    const k = Math.min(1, this.pullT / PULL_T);
    const rise = Math.min(1, k / 0.65);
    const slide = Math.max(0, (k - 0.65) / 0.35);
    this.y = this.pullY + (A.y - this.pullY) * (1 - (1 - rise) * (1 - rise));
    this.x = this.pullX + (e.top - this.pullX) * slide;
    if (k >= 1) {
      this.ground = e.to;
      this.mode = 'ground';
      this.x = e.top;
      this.y = A.y;
      this.lock = 0.12;
      this.climbE = null;
      this.plan.shift();
      this.rest = 0.6 + this.rnd();
      this.puff(this.x, this.y);
      if (this.goalPlat >= 0) this.replan();
    }
  }

  private fall(): void {
    this.mode = 'air';
    this.vx = this.vy = 0;
    this.plan = [];
    this.goalPlat = -1;
    this.climbE = null;
    this.setAnim('fall');
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

  private watchPointer(dt: number): void {
    const ptr = this.ptr;
    if (this.glance > 0) this.glance -= dt;
    if (!ptr.on) return;
    const age = this.t - ptr.t;
    if (age > 3) return;
    const dx = ptr.x - this.x;
    const dy = ptr.y - (this.y - this.m.bh / 2);
    if (Math.hypot(dx, dy) > FOLLOW_RANGE) return;
    const dir = dx >= 0 ? 1 : -1;
    // glance: when the pointer moves nearby he turns his head (his whole body, he is a sprite) towards it
    if (this.glance <= 0 && age < 0.3 && Math.abs(dx) > 50 && this.face !== dir && Number.isNaN(this.aim) && this.plan.length === 0) {
      this.face = dir;
      this.glance = 1.4;
    }
    if (age > 0.7 || this.plan.length || this.goalPlat >= 0) return;
    // follow, if the cursor is near his own level (not on some other panel far above or below)
    if (ptr.y > this.y - 320 && ptr.y < this.y + 40) {
      if (Math.abs(dx) > 56) {
        this.aim = ptr.x;
        this.aimGuard = Math.abs(dx) < 170; // the guard walk when it is close, the walk when it is far
        this.aimOff = false;
        this.aimFollow = true;
        this.peek = 0;
      } else if (this.aimFollow) {
        this.aim = NaN;
        this.aimFollow = false;
        this.face = dir;
        this.rest = 1.2;
      }
    }
  }

  /** The platform whose top is the nearest at or below the point (the one "under" the cursor), or -1. */
  platformAt(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 1; i < this.plats.length; i++) {
      const p = this.plats[i];
      if (x < p.x || x > p.x + p.w || this.lo[i] > this.hi[i]) continue;
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
    const [lo, hi] = [this.lo[this.ground], this.hi[this.ground]];
    const room = hi - lo;
    const opts: Array<[number, () => void]> = [
      [20, () => this.walkTo(lo + this.rnd() * room)],
      [40, () => (this.rest = 3 + this.rnd() * 5)],
      [9, () => this.walkTo(this.x + (this.rnd() < 0.5 ? -1 : 1) * (14 + this.rnd() * 20), true)],
      [3, () => this.hop()],
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
    if (reach.length) opts.push([7, () => this.travel(this.nearby(reach))]);
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
    for (const i of list) sum += 1 / (1 + Math.abs(this.plats[i].y - this.y) / 250);
    let r = this.rnd() * sum;
    for (const i of list) {
      r -= 1 / (1 + Math.abs(this.plats[i].y - this.y) / 250);
      if (r <= 0) return i;
    }
    return list[list.length - 1];
  }

  private travel(to: number): void {
    const [lo, hi] = [this.lo[to], this.hi[to]];
    this.goTo(to, lo + this.rnd() * (hi - lo));
  }

  // ----------------------------------------------------------- the planner

  private fits(x: number, y: number): boolean {
    const hw = this.m.hw;
    if (x < hw - EPS || x > this.width - hw + EPS) return false;
    this.scratch.x = x;
    this.scratch.y = y;
    for (let j = 1; j < this.plats.length; j++) if (over(this.scratch, this.plats[j], hw, this.m.bh)) return false;
    return true;
  }

  /** Simulate a flight from (x, y) with a launch speed; returns the platform he lands on (or -1) and sets landX. */
  private flight(x: number, y: number, vx: number, vy: number): number {
    const b = this.scratch;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    const dt = 1 / 90;
    for (let i = 0; i < 400; i++) {
      b.vy = Math.min(TERMINAL, b.vy + GRAVITY * dt);
      const j = stepBody(b, dt, this.plats, this.m.hw, this.m.bh, this.width);
      if (j >= 0) {
        this.landX = b.x;
        return j;
      }
    }
    return -1;
  }

  /** What each platform reaches and how: climbs along a panel's side, jumps and drops found by simulating them. */
  private buildEdges(): void {
    const n = this.plats.length;
    const hw = this.m.hw;
    const bh = this.m.bh;
    this.lo = [];
    this.hi = [];
    this.edges = Array.from({ length: n }, () => []);
    this.lo[0] = hw;
    this.hi[0] = this.width - hw;
    for (let i = 1; i < n; i++) {
      // the widest stretch of the top with headroom (a panel just above blocks the part under it)
      const p = this.plats[i];
      let free: Array<[number, number]> = [[p.x + 4, p.x + p.w - 4]];
      for (let j = 1; j < n; j++) {
        const q = this.plats[j];
        if (j === i || q.y >= p.y - 0.5 || q.y + q.h <= p.y - bh + 0.5) continue;
        const a = q.x - hw;
        const b = q.x + q.w + hw;
        free = free.flatMap(([l, r]) => (b <= l || a >= r ? [[l, r] as [number, number]] : [[l, Math.min(r, a)] as [number, number], [Math.max(l, b), r] as [number, number]]));
      }
      let best: [number, number] = [1, 0];
      for (const f of free) if (f[1] - f[0] > best[1] - best[0]) best = f;
      this.lo[i] = best[0];
      this.hi[i] = best[1];
    }
    const usable = (i: number): boolean => this.lo[i] <= this.hi[i];
    const floor = this.plats[0].y;
    const speeds = [40, 70, 100, 130, 165];
    for (let b = 0; b < n; b++) {
      if (!usable(b)) continue;
      const B = this.plats[b];
      const out = this.edges[b];
      const seen = new Set<number>();
      // jumps and drops: from the ends of the panel (from beside the panel for the floor)
      const spots: Array<[number, 1 | -1, boolean]> = []; // x, direction, may drop
      if (b > 0) {
        spots.push([B.x - 1, -1, true], [B.x + B.w + 1, 1, true], [Math.max(this.lo[b], B.x + 6), -1, false], [Math.min(this.hi[b], B.x + B.w - 6), 1, false]);
      } else {
        for (let a = 1; a < n; a++) {
          const A = this.plats[a];
          if (A.y < floor - MAX_RISE - 70 || A.y > floor) continue;
          spots.push([A.x - hw - 2, 1, false], [A.x + A.w + hw + 2, -1, false]);
        }
      }
      for (const vy of [0, -JUMP_V]) {
        for (const [x, dir, drop] of spots) {
          if ((vy === 0) !== drop && b > 0) continue; // drops start past the edge, jumps from just inside it
          if (vy === 0 && b === 0) continue;
          if (!this.fits(x, B.y)) continue;
          for (const s of speeds) {
            const j = this.flight(x, B.y, dir * s, vy);
            if (j < 0 || j === b || seen.has(j) || !usable(j)) continue;
            if (this.landX < this.lo[j] - 6 || this.landX > this.hi[j] + 6) continue; // the top is inset by 4 px each side
            if (vy < 0 && j > 0 && B.y - this.plats[j].y > MAX_RISE + 30) continue;
            seen.add(j);
            out.push({ kind: vy === 0 ? 'drop' : 'jump', from: b, to: j, x, vx: dir * s, vy, dir, wall: 0, top: 0 });
          }
        }
      }
      // climbs: up the left or right side of a higher panel, standing beside it; panels whose sides line up
      // form one long wall (the page's left and right margins), so a climb may pass several of them
      for (let a = 1; a < n; a++) {
        const A = this.plats[a];
        if (a === b || !usable(a)) continue;
        const rise = B.y - A.y;
        if (rise < 50 || rise > CLIMB_MAX) continue;
        for (const dir of [1, -1] as const) {
          const wall = dir === 1 ? A.x : A.x + A.w;
          const xs = wall - dir * hw;
          if (b > 0 && (xs < B.x + 4 || xs > B.x + B.w - 4)) continue;
          if (!this.fits(xs, B.y)) continue;
          if (!this.gripped(wall, dir, A.y, B.y)) continue;
          const top = Math.min(this.hi[a], Math.max(this.lo[a], dir === 1 ? A.x + hw + 10 : A.x + A.w - hw - 10));
          if (!this.fits(top, A.y)) continue;
          let free = true;
          for (let q = 1; q < n && free; q++) {
            const Q = this.plats[q];
            if (q === a || q === b) continue;
            if (Q.y < B.y && Q.y + Q.h > A.y && Q.x < xs + hw - 1 && Q.x + Q.w > xs - hw + 1) free = false;
          }
          if (free) out.push({ kind: 'climb', from: b, to: a, x: xs, vx: 0, vy: 0, dir, wall, top });
        }
      }
    }
  }

  /** Is there a panel side on this wall line close enough to hold on to all the way from yBot up to yTop (no gap above CLIMB_GAP)? */
  private gripped(wall: number, dir: 1 | -1, yTop: number, yBot: number): boolean {
    let cursor = yBot;
    // walk up the wall, always taking the next panel side that reaches highest below the cursor
    for (let guard = 0; guard < 64 && cursor > yTop; guard++) {
      let bestTop = Infinity;
      for (let q = 1; q < this.plats.length; q++) {
        const Q = this.plats[q];
        if (Math.abs((dir === 1 ? Q.x : Q.x + Q.w) - wall) > 6) continue;
        if (Q.y + Q.h < yTop || Q.y >= cursor) continue; // not above the cursor
        if (Q.y + Q.h < cursor - CLIMB_GAP) continue; // the next hold is too far above
        if (Q.y < bestTop) bestTop = Q.y;
      }
      if (bestTop === Infinity) return false;
      cursor = bestTop;
    }
    return cursor <= yTop;
  }

  /** Shortest chain of edges (breadth first over platforms) from the current platform to the goal. */
  private replan(): void {
    this.plan = [];
    if (this.goalPlat < 0 || this.goalPlat === this.ground) return;
    const prev = new Map<number, Edge>();
    const seen = new Set<number>([this.ground]);
    const queue = [this.ground];
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      if (at === this.goalPlat) break;
      for (const e of this.edges[at] ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, e);
        queue.push(e.to);
      }
    }
    const path: Edge[] = [];
    for (let at = this.goalPlat; at !== this.ground; ) {
      const e = prev.get(at);
      if (!e) return;
      path.unshift(e);
      at = e.from;
    }
    this.plan = path;
  }

  /** Platforms he can get to from here (the floor is not a destination: the footer is the bottom of the page). */
  private reachable(): number[] {
    const seen = new Set<number>([this.ground]);
    const queue = [this.ground];
    for (let i = 0; i < queue.length; i++)
      for (const e of this.edges[queue[i]] ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    seen.delete(this.ground);
    seen.delete(0);
    return [...seen];
  }
}
