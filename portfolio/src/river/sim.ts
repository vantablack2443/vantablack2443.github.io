import * as pl from 'planck';
import {
  BOAT,
  CAT,
  CROC,
  DOCK,
  DOCKS,
  FLOATER,
  FLOATERS,
  LANTERN,
  LANTERNS,
  ROPES,
  SAFE,
  SCORE,
  WATER,
  WORLD,
  dockPostZ,
  dockTipZ,
  dockZoneZ,
} from './config';
import { Buoy } from './buoy';
import { Water } from './water';

/**
 * The headless game world. Two halves, one per axis of the river:
 *
 *   top down   a planck world in the (x, z) plane with zero gravity: the boat, the crocodiles,
 *              the logs and the hyacinth rafts are dynamic bodies seen from above; the banks, the
 *              river ends and the jetties are static. (planck's y is our z.)
 *   vertical   each floating body also has a Buoy (buoy.ts): heave, pitch and roll from the water
 *              height under the hull, which in turn is dented by the bodies moving through it.
 *
 * On top of that: mooring, lanterns (2D pendulums, custom spring, not planck), crocodiles (steering
 * forces on their bodies plus a small state machine), scoring, the timer, the state machine and the
 * event queue. No DOM and no Pixi, deterministic for a given seed and input sequence, so
 * tests/river.test.ts runs the very same code the browser does.
 *
 * Contact callbacks only QUEUE things; game logic runs after the world step.
 *
 *   idle     the boat bobs in the dark, no timer, lanterns can't be lit, crocodiles only drift
 *   playing  the moon crosses the sky over WORLD.nightSeconds
 *   over     the night ended (time, a clear night, or ended by the visitor)
 */

export type Phase = 'idle' | 'playing' | 'over';
export type OverReason = 'time' | 'clear' | 'ended';
export type CrocState = 'lurk' | 'stalk' | 'lunge' | 'retreat';

export type RiverEvent =
  | { type: 'start' }
  | { type: 'stroke'; x: number; z: number }
  | { type: 'lantern'; index: number; score: number }
  | { type: 'moor'; dock: number; card: string; first: boolean; score: number }
  | { type: 'release'; dock: number }
  | { type: 'bump'; dock: number; speed: number }
  | { type: 'bank'; speed: number }
  | { type: 'hit'; speed: number }
  | { type: 'wake'; croc: number }
  | { type: 'lunge'; croc: number; x: number; z: number }
  | { type: 'bite'; croc: number; score: number; seconds: number }
  | { type: 'clear'; bonus: number; timeBonus: number }
  | { type: 'over'; reason: OverReason };

export interface RiverOptions {
  seed?: number;
  /** Leave out the logs and rafts (tests that isolate one thing at a time). */
  floaters?: boolean;
  /** Leave out the crocodiles. */
  crocs?: boolean;
  /** Pass a river to reuse its water (tests); by default a new one is built. */
  water?: Water;
}

/** A body the renderer draws: the pose before and after the last step, for interpolation. */
export class Tracked {
  px = 0;
  pz = 0;
  pa = 0;
  cx = 0;
  cz = 0;
  ca = 0;
  constructor(readonly body: pl.Body) {
    this.snap();
    this.snap();
  }
  snap(): void {
    this.px = this.cx;
    this.pz = this.cz;
    this.pa = this.ca;
    const p = this.body.getPosition();
    this.cx = p.x;
    this.cz = p.y;
    this.ca = this.body.getAngle();
  }
  /** Re-seat both poses on the body (after a teleport). */
  reset(): void {
    const p = this.body.getPosition();
    this.cx = this.px = p.x;
    this.cz = this.pz = p.y;
    this.ca = this.pa = this.body.getAngle();
  }
}

export interface Floater {
  kind: 'log' | 'hyacinth';
  tracked: Tracked;
  buoy: Buoy;
}

export interface Croc {
  index: number;
  tracked: Tracked;
  buoy: Buoy;
  state: CrocState;
  /** False until it wakes (the second one sleeps until the first dock visit). */
  awake: boolean;
  /** Seconds left in the lunge or the retreat. */
  timer: number;
  /** Where the water line sits in its sprite (fraction of the height from the top), eased. */
  line: number;
  /** Wander heading while lurking, and the fixed direction of a lunge. */
  wander: number;
  dirX: number;
  dirZ: number;
  bit: boolean;
}

export interface Lantern {
  index: number;
  /** Where the chain hangs from, and the chain's length to the middle of the lantern. */
  ax: number;
  az: number;
  ay: number;
  len: number;
  /** The pendulum: horizontal offset from the rest hanging point and its speed. */
  ox: number;
  oz: number;
  vx: number;
  vz: number;
  /** The lantern's centre now. */
  x: number;
  y: number;
  z: number;
  lit: boolean;
  /** Sim time (s) it was lit, or -1. */
  litAt: number;
  touching: boolean;
}

type UD = { kind: 'boat' } | { kind: 'wall' } | { kind: 'floater' } | { kind: 'croc' } | { kind: 'dock' };

const ud = (f: pl.Fixture): UD | null => (f.getUserData() as UD | null) ?? null;

/** mulberry32: a tiny seeded generator, so a seed always builds the same river. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const poly = (pts: ReadonlyArray<readonly [number, number]>): pl.Polygon => new pl.Polygon(pts.map(([x, z]) => pl.Vec2(x, z)));

/** Angle wrapped to -pi..pi. */
const wrap = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Distance from (px, pz) to the segment (ax, az)-(bx, bz). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export class River {
  readonly world: pl.World;
  readonly water: Water;
  readonly seed: number;

  /** The boat. `boat.body` is the planck body (x, z in the river plane, the angle is the heading). */
  readonly boat: Tracked;
  readonly boatBuoy: Buoy;
  readonly lanterns: Lantern[] = [];
  readonly floaters: Floater[] = [];
  readonly crocs: Croc[] = [];

  phase: Phase = 'idle';
  overReason: OverReason | null = null;
  /** Sim seconds since the world was built (always advances). */
  t = 0;
  /** Seconds of the night used up (only advances while playing and not held). */
  elapsed = 0;
  /** Hold the night clock (a dock card is open) while the water keeps moving. */
  holdClock = false;

  score = 0;
  lanternsLit = 0;
  readonly visited: boolean[] = DOCKS.map(() => false);
  docksVisited = 0;
  bites = 0;
  timeBonus = 0;
  cleared = false;

  /** Dock the boat is tied to (an index), or -1. */
  moored = -1;
  /** +1 if the rope ties to the bow, -1 if to the stern. */
  cleatSide = 1;

  /** The paddle input, set by the caller before each step: x right, z away from the viewer, length 0..1. */
  inx = 0;
  inz = 0;

  private readonly rand: () => number;
  private readonly events: RiverEvent[] = [];
  private readonly posts: pl.Body[] = [];
  private readonly zoneIn: boolean[] = DOCKS.map(() => false);
  private joint: pl.Joint | null = null;
  private locked = -1;
  private slow = 0;
  private cooldown = 0;
  private pulse = 0;
  private pulseX = 0;
  private pulseZ = 0;
  private pulseK = 0;
  private side = 1;
  private stepNo = 0;
  private readonly sc = pl.Vec2(0, 0);
  private rx = 0;
  private rz = 0;
  private readonly bumps: Array<{ speed: number; wall: boolean }> = [];

  constructor(opt: RiverOptions = {}) {
    this.seed = opt.seed ?? 1;
    this.rand = rng(this.seed);
    this.water = opt.water ?? new Water(this.seed);
    this.world = new pl.World({ gravity: pl.Vec2(0, 0) });

    this.buildWalls();
    const boat = this.buildBoat();
    this.boat = boat;
    this.boatBuoy = new Buoy(BOAT.vertical);
    this.buildDocks();
    this.buildLanterns();
    if (opt.floaters ?? true) this.buildFloaters();
    if (opt.crocs ?? true) this.buildCrocs();
    this.installListeners();
    this.boatBuoy.settle(this.water, BOAT.start.x, BOAT.start.z);
    for (const f of this.floaters) f.buoy.settle(this.water, f.tracked.cx, f.tracked.cz);
    for (const c of this.crocs) c.buoy.settle(this.water, c.tracked.cx, c.tracked.cz);
  }

  /* ---------------- construction ---------------- */

  private buildWalls(): void {
    const g = this.world.createBody({ type: 'static' });
    const mask = CAT.boat | CAT.float | CAT.croc;
    const t = 1;
    const L = WORLD.length;
    const W = WORLD.width;
    const boxes: Array<[number, number, number, number]> = [
      [-t, W / 2, t, W / 2 + t], // river ends
      [L + t, W / 2, t, W / 2 + t],
      [L / 2, -t, L / 2 + t, t], // banks
      [L / 2, W + t, L / 2 + t, t],
    ];
    for (const [x, z, hx, hz] of boxes) {
      g.createFixture(new pl.Box(hx, hz, pl.Vec2(x, z)), {
        friction: 0.1,
        restitution: 0.2,
        filterCategoryBits: CAT.wall,
        filterMaskBits: mask,
        userData: { kind: 'wall' } satisfies UD,
      });
    }
  }

  private buildBoat(): Tracked {
    const body = this.world.createBody({
      type: 'dynamic',
      position: pl.Vec2(BOAT.start.x, BOAT.start.z),
      angle: BOAT.start.yaw,
      linearDamping: BOAT.linearDamping,
      angularDamping: BOAT.angularDamping,
    });
    body.createFixture(poly(BOAT.hull), {
      density: BOAT.mass / polyArea(BOAT.hull),
      friction: BOAT.friction,
      restitution: BOAT.restitution,
      filterCategoryBits: CAT.boat,
      filterMaskBits: CAT.wall | CAT.float | CAT.croc | CAT.dock,
      userData: { kind: 'boat' } satisfies UD,
    });
    return new Tracked(body);
  }

  private buildDocks(): void {
    const g = this.world.createBody({ type: 'static' });
    for (const d of DOCKS) {
      const bankZ = d.side === 'far' ? WORLD.width : 0;
      const tip = dockTipZ(d);
      g.createFixture(new pl.Box((DOCK.deckTo - DOCK.deckFrom) / 2, DOCK.jetty / 2, pl.Vec2(d.x + (DOCK.deckFrom + DOCK.deckTo) / 2, (bankZ + tip) / 2)), {
        friction: 0.2,
        restitution: 0.15,
        filterCategoryBits: CAT.dock,
        filterMaskBits: CAT.boat | CAT.float | CAT.croc,
        userData: { kind: 'dock' } satisfies UD,
      });
      this.posts.push(this.world.createBody({ type: 'static', position: pl.Vec2(d.x, dockPostZ(d)) }));
    }
  }

  private buildLanterns(): void {
    LANTERNS.forEach((spec, index) => {
      const ay = spec.mount === 'rope' ? ROPES[spec.rope ?? 0].h : LANTERN.branchH;
      const len = ay - spec.y;
      const l: Lantern = {
        index,
        ax: spec.x,
        az: spec.z,
        ay,
        len,
        ox: 0,
        oz: 0,
        vx: (this.rand() - 0.5) * 0.8, // a little sway, different per seed
        vz: (this.rand() - 0.5) * 0.8,
        x: spec.x,
        y: spec.y,
        z: spec.z,
        lit: false,
        litAt: -1,
        touching: false,
      };
      this.lanterns.push(l);
    });
  }

  private buildFloaters(): void {
    for (const spec of FLOATERS) {
      const f = FLOATER[spec.kind];
      const x = spec.x + (this.rand() * 2 - 1) * spec.jitter;
      const z = Math.min(WORLD.width - 3, Math.max(3, spec.z + (this.rand() * 2 - 1) * 2));
      const body = this.world.createBody({
        type: 'dynamic',
        position: pl.Vec2(x, z),
        angle: this.rand() * Math.PI * 2,
        linearDamping: FLOATER.linearDamping,
        angularDamping: FLOATER.angularDamping,
      });
      body.createFixture(new pl.Box(f.halfL, f.halfW), {
        density: f.density,
        friction: FLOATER.friction,
        restitution: FLOATER.restitution,
        filterCategoryBits: CAT.float,
        filterMaskBits: CAT.boat | CAT.float | CAT.wall | CAT.croc | CAT.dock,
        userData: { kind: 'floater' } satisfies UD,
      });
      this.floaters.push({ kind: spec.kind, tracked: new Tracked(body), buoy: new Buoy(FLOATER.vertical[spec.kind]) });
    }
  }

  private buildCrocs(): void {
    for (let i = 0; i < CROC.count; i++) {
      const body = this.world.createBody({
        type: 'dynamic',
        linearDamping: CROC.linearDamping,
        angularDamping: CROC.angularDamping,
      });
      body.createFixture(
        poly([
          [CROC.halfL, 0],
          [CROC.halfL * 0.55, CROC.halfW],
          [-CROC.halfL * 0.7, CROC.halfW],
          [-CROC.halfL, 0],
          [-CROC.halfL * 0.7, -CROC.halfW],
          [CROC.halfL * 0.55, -CROC.halfW],
        ]),
        {
          density: CROC.mass / (CROC.halfL * 2 * CROC.halfW * 1.6),
          friction: CROC.friction,
          restitution: CROC.restitution,
          filterCategoryBits: CAT.croc,
          filterMaskBits: CAT.boat | CAT.float | CAT.wall | CAT.croc | CAT.dock,
          userData: { kind: 'croc' } satisfies UD,
        },
      );
      const c: Croc = {
        index: i,
        tracked: new Tracked(body),
        buoy: new Buoy(CROC.vertical),
        state: 'lurk',
        awake: false,
        timer: 0,
        line: CROC.lineLurk,
        wander: this.rand() * Math.PI * 2,
        dirX: 1,
        dirZ: 0,
        bit: false,
      };
      this.crocs.push(c);
      if (i === 0) this.spawn(c, 15);
      else body.setActive(false);
    }
  }

  /** Put a crocodile somewhere in the river at least `minDist` from the boat (and from the other one). */
  private spawn(c: Croc, minDist: number): void {
    const b = this.boat.body.getPosition();
    let x = 70;
    let z = 8;
    for (let tries = 0; tries < 40; tries++) {
      x = 14 + this.rand() * (WORLD.length - 28);
      z = 3.5 + this.rand() * (WORLD.width - 7);
      if (Math.hypot(x - b.x, z - b.y) >= minDist && !this.inSafe(x, z)) break;
    }
    const body = c.tracked.body;
    body.setActive(true);
    body.setPosition(pl.Vec2(x, z));
    body.setAngle(this.rand() * Math.PI * 2);
    body.setLinearVelocity(pl.Vec2(0, 0));
    c.awake = true;
    c.state = 'lurk';
    c.wander = body.getAngle();
    c.tracked.reset();
    c.buoy.settle(this.water, x, z);
  }

  private installListeners(): void {
    this.world.on('begin-contact', (c) => {
      const fa = c.getFixtureA();
      const fb = c.getFixtureB();
      const a = ud(fa);
      const b = ud(fb);
      if (!a || !b) return;
      this.contact(a, b, fa, fb);
      this.contact(b, a, fb, fa);
    });
  }

  /** One side of a begin-contact: the boat touched a wall, a floater or a crocodile. Only queues. */
  private contact(me: UD, other: UD, fMe: pl.Fixture, fOther: pl.Fixture): void {
    if (me.kind !== 'boat') return;
    if (other.kind !== 'wall' && other.kind !== 'floater' && other.kind !== 'croc' && other.kind !== 'dock') return;
    const vb = fMe.getBody().getLinearVelocity();
    const vo = fOther.getBody().getLinearVelocity();
    const speed = Math.hypot(vb.x - vo.x, vb.y - vo.y);
    if (speed > 0.8) this.bumps.push({ speed, wall: other.kind === 'wall' || other.kind === 'dock' });
  }

  /* ---------------- public API ---------------- */

  /** Begin the night: the timer starts, lanterns and docks can score, crocodiles can bite. */
  start(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'playing';
    this.events.push({ type: 'start' });
  }

  /** End the night now (the visitor left, or asked to stop). */
  end(reason: OverReason = 'ended'): void {
    if (this.phase !== 'playing') return;
    this.release();
    this.phase = 'over';
    this.overReason = reason;
    this.events.push({ type: 'over', reason });
  }

  /** Cast off: the rope goes, and the dock can't catch the boat again until the boat has left its zone. */
  release(): void {
    if (this.moored < 0) return;
    const dock = this.moored;
    if (this.joint) this.world.destroyJoint(this.joint);
    this.joint = null;
    this.moored = -1;
    this.locked = dock;
    this.slow = 0;
    this.events.push({ type: 'release', dock });
  }

  drainEvents(): RiverEvent[] {
    if (!this.events.length) return this.events;
    return this.events.splice(0, this.events.length);
  }

  /** Seconds of the night left. */
  get timeLeft(): number {
    return Math.max(0, WORLD.nightSeconds - this.elapsed);
  }

  /** Test and debug helper: put the boat at (x, z) with a heading and a speed along it. */
  placeBoat(x: number, z = BOAT.start.z, yaw = 0, speed = 0): void {
    const b = this.boat.body;
    b.setPosition(pl.Vec2(x, z));
    b.setAngle(yaw);
    b.setAngularVelocity(0);
    b.setLinearVelocity(pl.Vec2(Math.cos(yaw) * speed, Math.sin(yaw) * speed));
    b.setAwake(true);
    this.boat.reset();
    this.boatBuoy.settle(this.water, x, z);
  }

  boatSpeed(): number {
    const v = this.boat.body.getLinearVelocity();
    return Math.hypot(v.x, v.y);
  }

  /** The mooring post of a dock (x, z). */
  postOf(dock: number): { x: number; z: number } {
    const p = this.posts[dock].getPosition();
    return { x: p.x, z: p.y };
  }

  /** Centre of a dock's mooring zone (x, z). */
  zoneOf(dock: number): { x: number; z: number } {
    return { x: DOCKS[dock].x + DOCK.zoneDx, z: dockZoneZ(DOCKS[dock]) };
  }

  /** Is (x, z) inside a safe circle: a lit lantern's, or a dock's? Crocodiles steer out of these. */
  inSafe(x: number, z: number): boolean {
    for (const l of this.lanterns) if (l.lit && Math.hypot(x - l.ax, z - l.az) < SAFE.lantern) return true;
    for (let i = 0; i < DOCKS.length; i++) {
      const p = this.posts[i].getPosition();
      if (Math.hypot(x - p.x, z - p.y) < SAFE.dock) return true;
    }
    return false;
  }

  /** Nothing has gone to NaN (boat and water). */
  isSane(): boolean {
    const p = this.boat.body.getPosition();
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(this.boat.body.getAngle()) && Number.isFinite(this.boatBuoy.y) && this.water.isFinite();
  }

  /* ---------------- stepping ---------------- */

  /** Advance the world by one fixed step (WORLD.dt). */
  step(): void {
    const dt = WORLD.dt;
    this.paddle(dt);
    this.keel();
    this.floatForces();
    this.crocAi(dt);
    this.world.step(dt, WORLD.velocityIterations, WORLD.positionIterations);
    if (++this.stepNo % WATER.every === 0) this.water.step(dt * WATER.every);
    this.vertical(dt);
    this.flush();
    this.lanternsStep(dt);
    this.mooring(dt);
    this.t += dt;
    if (this.phase === 'playing' && !this.holdClock) {
      this.elapsed += dt;
      if (this.elapsed >= WORLD.nightSeconds) this.end('time');
    }
    this.boat.snap();
    for (const f of this.floaters) f.tracked.snap();
    for (const c of this.crocs) if (c.awake) c.tracked.snap();
  }

  private active(): boolean {
    return this.phase === 'playing' && !this.holdClock;
  }

  /** Paddling: strokes on a cadence while a direction is held, a torque turning the heading toward it. */
  private paddle(dt: number): void {
    const S = BOAT.stroke;
    const body = this.boat.body;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const mag = Math.hypot(this.inx, this.inz);
    const on = this.active() && mag > S.deadZone;
    if (on) {
      const ux = this.inx / mag;
      const uz = this.inz / mag;
      // turn the heading toward the input: a spring and a damper on the heading error
      const err = wrap(Math.atan2(uz, ux) - body.getAngle());
      body.applyTorque(body.getInertia() * (S.turnKp * err - S.turnKd * body.getAngularVelocity()), true);
      if (this.cooldown <= 0) this.beginStroke(ux, uz, Math.min(1, mag));
      // a stroke away from the dock casts off
      if (this.moored >= 0) {
        const post = this.postOf(this.moored);
        const p = body.getPosition();
        if (ux * (p.x - post.x) + uz * (p.y - post.z) > 0.3 * Math.hypot(p.x - post.x, p.y - post.z)) this.release();
      }
    }
    if (this.pulse > 0) {
      this.pulse -= dt;
      const f = (S.impulse * this.pulseK) / S.pulse;
      this.sc.set(this.pulseX * f, this.pulseZ * f);
      body.applyForceToCenter(this.sc, true);
    }
  }

  private beginStroke(ux: number, uz: number, k: number): void {
    const S = BOAT.stroke;
    const body = this.boat.body;
    this.cooldown = S.cadence;
    this.pulse = S.pulse;
    this.pulseX = ux;
    this.pulseZ = uz;
    this.pulseK = k;
    // the splash: beside the hull, behind the middle, alternating sides
    this.side = -this.side;
    const a = body.getAngle();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const p = body.getPosition();
    const px = p.x - c * S.paddleBack - s * S.paddleSide * this.side;
    const pz = p.y - s * S.paddleBack + c * S.paddleSide * this.side;
    this.water.disturb(px, pz, S.splashRadius, -S.splash * (0.5 + 0.5 * k));
    this.boatBuoy.kick(S.pitchKick * k);
    this.events.push({ type: 'stroke', x: px, z: pz });
  }

  /** The keel: water drag along the heading is low, sideways it is high. */
  private keel(): void {
    const body = this.boat.body;
    const a = body.getAngle();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const v = body.getLinearVelocity();
    const vf = v.x * c + v.y * s;
    const vs = -v.x * s + v.y * c;
    const kf = BOAT.dragAlong * vf;
    const ks = BOAT.dragSide * vs;
    this.sc.set(-BOAT.mass * (kf * c - ks * s), -BOAT.mass * (kf * s + ks * c));
    body.applyForceToCenter(this.sc, true);
  }

  /** Waves push the logs and the rafts down the slope of the surface. */
  private floatForces(): void {
    for (const f of this.floaters) {
      const body = f.tracked.body;
      const p = body.getPosition();
      const sl = this.water.slopeAt(p.x, p.y);
      const k = -FLOATER.slopePush * WORLD.gravity * body.getMass();
      this.sc.set(k * sl.x, k * sl.z);
      body.applyForceToCenter(this.sc, true);
    }
  }

  /* ---------------- crocodiles ---------------- */

  /** Is the boat somewhere a crocodile may not hurt it: moored, a card open, in a safe circle, or not playing? */
  private boatSafe(): boolean {
    if (!this.active() || this.moored >= 0) return true;
    const p = this.boat.body.getPosition();
    return this.inSafe(p.x, p.y);
  }

  private crocAi(dt: number): void {
    const boat = this.boat.body;
    const bp = boat.getPosition();
    const bv = boat.getLinearVelocity();
    const safe = this.boatSafe();
    const armed = this.phase === 'playing';
    // the second crocodile wakes up after the first dock visit, far from the boat
    if (this.crocs.length > 1 && !this.crocs[1].awake && this.docksVisited >= 1) {
      this.spawn(this.crocs[1], 20);
      this.events.push({ type: 'wake', croc: 1 });
    }
    for (const c of this.crocs) {
      if (!c.awake) continue;
      const body = c.tracked.body;
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      const dx = bp.x - p.x;
      const dz = bp.y - p.y;
      const dist = Math.hypot(dx, dz);
      let wx = 0; // the wanted velocity
      let wz = 0;
      let gain = CROC.steer;
      let maxAcc = 14;
      let line = CROC.lineLurk;

      switch (c.state) {
        case 'lurk': {
          c.wander += (this.rand() - 0.5) * dt * 3;
          const sp = CROC.lurkSpeed * 0.6;
          wx = Math.cos(c.wander) * sp;
          wz = Math.sin(c.wander) * sp;
          if (armed && !safe && dist < 60) {
            // crocodiles feel the wake: a slow drift toward the boat
            wx += (dx / dist) * CROC.lurkPull;
            wz += (dz / dist) * CROC.lurkPull;
          }
          else if (armed && safe && dist < 24) {
            // the boat is out of reach (a lantern's circle, a dock, a card open): it loses interest and drifts off
            wx -= (dx / dist) * CROC.lurkPull;
            wz -= (dz / dist) * CROC.lurkPull;
          }
          if (armed && !safe && dist < CROC.stalkRange) c.state = 'stalk';
          break;
        }
        case 'stalk': {
          const lead = Math.min(1.5, dist / CROC.stalkSpeed);
          const tx = bp.x + bv.x * lead - p.x;
          const tz = bp.y + bv.y * lead - p.y;
          const tl = Math.hypot(tx, tz) || 1;
          wx = (tx / tl) * CROC.stalkSpeed;
          wz = (tz / tl) * CROC.stalkSpeed;
          line = 0.28; // rising a little
          if (safe || !armed || dist > CROC.loseRange) c.state = 'lurk';
          else if (this.snoutGap(c, p) < CROC.lungeRange) this.beginLunge(c, p, bp, bv);
          break;
        }
        case 'lunge': {
          wx = c.dirX * CROC.lungeSpeed;
          wz = c.dirZ * CROC.lungeSpeed;
          gain = 30;
          maxAcc = 90;
          line = CROC.lineSurfaced;
          c.timer -= dt;
          if (!c.bit && !safe && armed) this.tryBite(c, p);
          if (c.timer <= 0 || safe || !armed) this.retreat(c);
          break;
        }
        case 'retreat': {
          const l = dist || 1;
          wx = (-dx / l) * CROC.retreatSpeed;
          wz = (-dz / l) * CROC.retreatSpeed;
          c.timer -= dt;
          if (c.timer <= 0) c.state = 'lurk';
          break;
        }
      }

      // steer out of the safe circles (lit lanterns, docks) and away from the banks and the ends
      const lit = this.lanterns;
      for (let i = 0; i < lit.length; i++) {
        if (!lit[i].lit) continue;
        this.repel(p, lit[i].ax, lit[i].az, SAFE.lantern, wx, wz);
        wx += this.rx;
        wz += this.rz;
      }
      for (let i = 0; i < DOCKS.length; i++) {
        const q = this.posts[i].getPosition();
        this.repel(p, q.x, q.y, SAFE.dock, wx, wz);
        wx += this.rx;
        wz += this.rz;
      }
      if (p.y < 1.6) wz += (1.6 - p.y) * 2.5;
      else if (p.y > WORLD.width - 1.6) wz -= (p.y - (WORLD.width - 1.6)) * 2.5;
      if (p.x < 3) wx += (3 - p.x) * 2.5;
      else if (p.x > WORLD.length - 3) wx -= (p.x - (WORLD.length - 3)) * 2.5;

      // a steering force toward the wanted velocity, and a torque turning the snout the way it goes
      let ax = gain * (wx - v.x);
      let az = gain * (wz - v.y);
      const am = Math.hypot(ax, az);
      if (am > maxAcc) {
        ax *= maxAcc / am;
        az *= maxAcc / am;
      }
      this.sc.set(ax * body.getMass(), az * body.getMass());
      body.applyForceToCenter(this.sc, true);
      const want = Math.hypot(wx, wz) > 0.2 ? Math.atan2(wz, wx) : body.getAngle();
      const err = wrap(want - body.getAngle());
      body.applyTorque(body.getInertia() * (CROC.turnKp * err - CROC.turnKd * body.getAngularVelocity()), true);
      c.line += (line - c.line) * Math.min(1, dt * 3);
    }
  }

  /**
   * How a safe circle bends a wanted velocity (w), into (rx, rz): a push away from its centre, hard
   * inside it and fading out 1.5 m beyond, plus a sideways push the way the crocodile wanted to go,
   * so it slides around the circle instead of sticking to its edge.
   */
  private repel(p: pl.Vec2, cx: number, cz: number, radius: number, wx: number, wz: number): void {
    this.rx = this.rz = 0;
    const dx = p.x - cx;
    const dz = p.y - cz;
    const d = Math.hypot(dx, dz) || 0.01;
    const k = Math.max(0, Math.min(1, (radius + 1.5 - d) / 1.5));
    if (k <= 0) return;
    const nx = dx / d;
    const nz = dz / d;
    const side = nx * wz - nz * wx >= 0 ? 1 : -1; // counter clockwise or clockwise, whichever the wish leans to
    this.rx = (nx * 7 - nz * side * 4.5) * k;
    this.rz = (nz * 7 + nx * side * 4.5) * k;
  }

  /** Distance from a crocodile's snout to the boat's hull (its centre line, less the half beam). */
  private snoutGap(c: Croc, p: pl.Vec2): number {
    const a = c.tracked.body.getAngle();
    const boat = this.boat.body;
    const ba = boat.getAngle();
    const bp = boat.getPosition();
    const hx = Math.cos(ba) * 2;
    const hz = Math.sin(ba) * 2;
    const sx = p.x + Math.cos(a) * CROC.halfL;
    const sz = p.y + Math.sin(a) * CROC.halfL;
    return segDist(sx, sz, bp.x - hx, bp.y - hz, bp.x + hx, bp.y + hz) - BOAT.hull[1][1];
  }

  private beginLunge(c: Croc, p: pl.Vec2, bp: pl.Vec2, bv: pl.Vec2): void {
    const t = 0.3;
    const tx = bp.x + bv.x * t - p.x;
    const tz = bp.y + bv.y * t - p.y;
    const l = Math.hypot(tx, tz) || 1;
    c.dirX = tx / l;
    c.dirZ = tz / l;
    c.state = 'lunge';
    c.timer = CROC.lungeTime;
    c.bit = false;
    // the big splash of a lunge
    this.water.disturb(p.x + c.dirX * CROC.halfL * 0.8, p.y + c.dirZ * CROC.halfL * 0.8, 1.2, -2.5);
    this.events.push({ type: 'lunge', croc: c.index, x: p.x, z: p.y });
  }

  private retreat(c: Croc): void {
    c.state = 'retreat';
    c.timer = CROC.retreatTime;
  }

  /** During a lunge: the snout within reach of the hull is a bite. */
  private tryBite(c: Croc, p: pl.Vec2): void {
    const boat = this.boat.body;
    const a = boat.getAngle();
    const bp = boat.getPosition();
    const hx = Math.cos(a) * 2;
    const hz = Math.sin(a) * 2;
    const sx = p.x + c.dirX * CROC.halfL;
    const sz = p.y + c.dirZ * CROC.halfL;
    if (segDist(sx, sz, bp.x - hx, bp.y - hz, bp.x + hx, bp.y + hz) > BOAT.hull[1][1] + CROC.biteReach) return;
    c.bit = true;
    this.bites++;
    const lost = Math.min(this.score, CROC.bite.score);
    this.score -= lost;
    this.elapsed += CROC.bite.seconds;
    // a knockback along the way the crocodile was going, and a spin
    const side = Math.sign(c.dirX * (bp.y - p.y) - c.dirZ * (bp.x - p.x)) || 1;
    this.sc.set(c.dirX * CROC.bite.impulse, c.dirZ * CROC.bite.impulse);
    boat.applyLinearImpulse(this.sc, boat.getWorldCenter(), true);
    boat.applyAngularImpulse(side * CROC.bite.spin, true);
    this.boatBuoy.kick(0.9 * side, 0.6);
    this.water.disturb(bp.x, bp.y, 1.8, -5);
    this.events.push({ type: 'bite', croc: c.index, score: -lost, seconds: CROC.bite.seconds });
    this.retreat(c);
    if (this.elapsed >= WORLD.nightSeconds) this.end('time');
  }

  /* ---------------- the vertical half ---------------- */

  /** Heave and pitch from the water, and the wake: bodies moving through the water leave dents. */
  private vertical(dt: number): void {
    const b = this.boat.body;
    const bp = b.getPosition();
    this.boatBuoy.step(dt, this.water, bp.x, bp.y, b.getAngle());
    this.wake(bp, b.getLinearVelocity(), 2.6, 1, BOAT.bowWave, BOAT.sternWave, dt);
    for (const f of this.floaters) {
      const body = f.tracked.body;
      const p = body.getPosition();
      f.buoy.step(dt, this.water, p.x, p.y, body.getAngle());
      this.wake(p, body.getLinearVelocity(), FLOATER[f.kind].halfL + 0.5, 0.25, BOAT.bowWave, BOAT.sternWave, dt);
    }
    for (const c of this.crocs) {
      if (!c.awake) continue;
      const body = c.tracked.body;
      const p = body.getPosition();
      c.buoy.step(dt, this.water, p.x, p.y, body.getAngle());
      // a crocodile leaves ripples behind it, more when it is fast and when it is up
      const k = c.state === 'lunge' ? 1.3 : c.state === 'stalk' ? 0.6 : 0.35;
      this.wake(p, body.getLinearVelocity(), CROC.halfL + 0.3, k, BOAT.bowWave, BOAT.sternWave, dt);
    }
  }

  /** A dent that rises at the leading end and sinks behind the trailing end, in proportion to the speed. */
  private wake(p: pl.Vec2, v: pl.Vec2, reach: number, k: number, bow: number, stern: number, dt: number): void {
    const speed = Math.hypot(v.x, v.y);
    if (speed < 0.35) return;
    const ux = v.x / speed;
    const uz = v.y / speed;
    const r = 0.5 + 0.35 * Math.min(1, k);
    this.water.disturb(p.x + ux * reach, p.y + uz * reach, r + 0.3, bow * speed * k * dt);
    this.water.disturb(p.x - ux * reach, p.y - uz * reach, r, -stern * speed * k * dt);
  }

  /* ---------------- after the step ---------------- */

  /** Act on what the contact callbacks queued. */
  private flush(): void {
    if (this.bumps.length) {
      const list = this.bumps.splice(0, this.bumps.length);
      for (const bump of list) this.events.push(bump.wall ? { type: 'bank', speed: bump.speed } : { type: 'hit', speed: bump.speed });
    }
    if (this.locked >= 0 && !this.zoneIn[this.locked]) this.locked = -1;
  }

  /** The lanterns: 2D pendulums on a custom spring, lit when the hull passes within reach. */
  private lanternsStep(dt: number): void {
    const boat = this.boat.body;
    const a = boat.getAngle();
    const bp = boat.getPosition();
    const bv = boat.getLinearVelocity();
    const hx = Math.cos(a) * LANTERN.hullHalf;
    const hz = Math.sin(a) * LANTERN.hullHalf;
    const g = WORLD.gravity;
    for (const l of this.lanterns) {
      // pendulum: a = -(g / L) offset - damping v + a little breeze
      const w2 = g / l.len;
      const ph = l.index * 1.7;
      l.vx += (-w2 * l.ox - LANTERN.damping * l.vx + LANTERN.breeze * Math.sin(this.t * 0.9 + ph)) * dt;
      l.vz += (-w2 * l.oz - LANTERN.damping * l.vz + LANTERN.breeze * Math.cos(this.t * 0.7 + ph)) * dt;
      l.ox += l.vx * dt;
      l.oz += l.vz * dt;
      const o2 = l.ox * l.ox + l.oz * l.oz;
      const max = l.len * 0.8;
      if (o2 > max * max) {
        const k = max / Math.sqrt(o2);
        l.ox *= k;
        l.oz *= k;
      }
      l.x = l.ax + l.ox;
      l.z = l.az + l.oz;
      l.y = l.ay - Math.sqrt(Math.max(0.01, l.len * l.len - l.ox * l.ox - l.oz * l.oz));
      // the hull brushing it: a shove, and the first time, a light
      const d = segDist(l.x, l.z, bp.x - hx, bp.y - hz, bp.x + hx, bp.y + hz);
      const near = d < LANTERN.lightDistance;
      if (near && !l.touching) {
        const dx = l.x - bp.x;
        const dz = l.z - bp.y;
        const dl = Math.hypot(dx, dz) || 1;
        l.vx += LANTERN.touchGain * bv.x + (dx / dl) * LANTERN.touchShove;
        l.vz += LANTERN.touchGain * bv.y + (dz / dl) * LANTERN.touchShove;
        if (this.phase === 'playing') this.light(l);
      }
      l.touching = near;
    }
  }

  private light(l: Lantern): void {
    if (l.lit) return;
    l.lit = true;
    l.litAt = this.t;
    this.lanternsLit++;
    this.score += SCORE.lantern;
    this.events.push({ type: 'lantern', index: l.index, score: SCORE.lantern });
    this.checkClear();
  }

  /** Slow enough for long enough inside a dock zone: tie up. */
  private mooring(dt: number): void {
    const p = this.boat.body.getPosition();
    let dock = -1;
    for (let i = 0; i < DOCKS.length; i++) {
      const z = this.zoneOf(i);
      const inside = Math.abs(p.x - z.x) < DOCK.zoneHalfX && Math.abs(p.y - z.z) < DOCK.zoneHalfZ;
      if (inside && !this.zoneIn[i]) this.enterZone(i);
      this.zoneIn[i] = inside;
      if (inside && dock < 0) dock = i;
    }
    if (this.phase !== 'playing' || this.moored >= 0) return;
    if (dock < 0 || dock === this.locked) {
      this.slow = 0;
      return;
    }
    if (this.boatSpeed() < DOCK.maxSpeed) {
      this.slow += dt;
      if (this.slow >= DOCK.holdTime) this.moor(dock);
    } else {
      this.slow = 0;
    }
  }

  /** The boat just entered a dock zone: arriving fast is a bump (a little braking, no rope). */
  private enterZone(dock: number): void {
    const body = this.boat.body;
    const v = body.getLinearVelocity();
    const speed = Math.hypot(v.x, v.y);
    if (speed > DOCK.bumpSpeed && this.phase === 'playing') {
      body.setLinearVelocity(pl.Vec2(v.x * (1 - DOCK.bumpBrake), v.y * (1 - DOCK.bumpBrake)));
      this.events.push({ type: 'bump', dock, speed });
    }
  }

  private moor(dock: number): void {
    const body = this.boat.body;
    const post = this.posts[dock].getPosition();
    const p = body.getPosition();
    const a = body.getAngle();
    // the cleat nearer the post
    this.cleatSide = (post.x - p.x) * Math.cos(a) + (post.y - p.y) * Math.sin(a) >= 0 ? 1 : -1;
    const ax = p.x + Math.cos(a) * this.cleatSide * BOAT.cleat;
    const az = p.y + Math.sin(a) * this.cleatSide * BOAT.cleat;
    this.joint = this.world.createJoint(
      new pl.DistanceJoint(
        { length: DOCK.rope.length, frequencyHz: DOCK.rope.frequencyHz, dampingRatio: DOCK.rope.dampingRatio },
        this.posts[dock],
        body,
        pl.Vec2(post.x, post.y),
        pl.Vec2(ax, az),
      ),
    );
    this.moored = dock;
    this.slow = 0;
    const first = !this.visited[dock];
    let score = 0;
    if (first) {
      this.visited[dock] = true;
      this.docksVisited++;
      score = SCORE.dock;
      this.score += score;
    }
    this.events.push({ type: 'moor', dock, card: DOCKS[dock].card, first, score });
    this.checkClear();
  }

  /** All six docks and all lanterns: the clear night bonus, a time bonus, and the night ends early. */
  private checkClear(): void {
    if (this.cleared || this.phase !== 'playing') return;
    if (this.docksVisited < DOCKS.length || this.lanternsLit < this.lanterns.length) return;
    this.cleared = true;
    this.timeBonus = Math.round(this.timeLeft) * SCORE.timePerSecond;
    this.score += SCORE.clearBonus + this.timeBonus;
    this.events.push({ type: 'clear', bonus: SCORE.clearBonus, timeBonus: this.timeBonus });
    this.end('clear');
  }
}

function polyArea(pts: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}
