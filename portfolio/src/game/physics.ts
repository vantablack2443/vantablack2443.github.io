import * as pl from 'planck';
import {
  BALL_R,
  BUMPERS,
  BUMPER_R,
  CARDS,
  DRAIN,
  FLIPPERS,
  FUNNELS,
  LANE_GUIDE_XS,
  LANE_GUIDE_Y0,
  LANE_GUIDE_Y1,
  LANE_SENSORS,
  LANE_WALL,
  OUTER_ARCH,
  OUTER_LEFT,
  OUTER_RIGHT,
  PLUNGER,
  SLINGS,
  WALL_R,
  cardPolygon,
  inPlungerLane,
  toM,
  toPx,
  type Pt,
  type Rect,
} from '../layout';
import { Flipper } from './flipper';
import { Plunger } from './plunger';

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const TUNING = {
  /** Fixed simulation step (s). */
  dt: 1 / 120,
  velocityIterations: 8,
  positionIterations: 3,
  /** Gravity (m/s^2). ~1.3 s to fall from the top arch to the flippers. */
  gravity: 18,
  ball: {
    density: 1,
    friction: 0.1,
    restitution: 0.3,
    linearDamping: 0.05,
    angularDamping: 0.3,
    maxSpeed: 40, // m/s
  },
  wall: { friction: 0.1, restitution: 0.4 },
  /** The top arch is dead-ish so a fast launch rolls along it instead of ricocheting. */
  arch: { friction: 0.1, restitution: 0.12 },
  flipper: {
    density: 5,
    friction: 0.3,
    restitution: 0.2,
    maxTorque: 2000,
    motorSpeed: 20, // rad/s
  },
  bumper: { restitution: 0.3, kick: 1.3 }, // kick = impulse (N*s) away from the bumper
  sling: { restitution: 0.3, kick: 1.1 },
  card: { friction: 0.1, restitution: 0.5 },
  plunger: {
    chargeTime: 1.0,
    minSpeed: 27, // m/s, still clears the lane exit
    maxSpeed: 36,
    autoPower: 0.85,
  },
};

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type TableEvent =
  | { type: 'bumper'; id: string }
  | { type: 'sling'; id: string }
  | { type: 'card'; id: string }
  | { type: 'lane'; id: string }
  | { type: 'drain' }
  | { type: 'launch'; power: number }
  | { type: 'flipper'; side: 'left' | 'right' };

export interface TableInput {
  left: boolean;
  right: boolean;
  plunger: boolean;
}

type UD =
  | { kind: 'ball' }
  | { kind: 'wall'; arch?: boolean }
  | { kind: 'lanewall' }
  | { kind: 'bumper'; id: string; cx: number; cy: number }
  | { kind: 'sling'; id: string; nx: number; ny: number }
  | { kind: 'card'; id: string }
  | { kind: 'lane'; id: string }
  | { kind: 'drain' }
  | { kind: 'flipper'; side: 'left' | 'right' }
  | { kind: 'plunger' }
  | { kind: 'post' };

const ud = (f: pl.Fixture): UD | null => (f.getUserData() as UD | null) ?? null;

const v = (p: Pt): pl.Vec2 => pl.Vec2(toM(p[0]), toM(p[1]));
const vs = (pts: readonly Pt[]): pl.Vec2[] => pts.map(v);

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

interface Kick {
  nx: number;
  ny: number;
  impulse: number;
}

/**
 * The complete physics table, built from layout.ts. DOM-free so it can be run
 * headlessly in tests. Callbacks only QUEUE things; bodies are only mutated
 * between world steps.
 */
export class Table {
  readonly world: pl.World;
  readonly ground: pl.Body;
  readonly left: Flipper;
  readonly right: Flipper;
  readonly plunger: Plunger;
  ball: pl.Body | null = null;
  readonly input: TableInput = { left: false, right: false, plunger: false };
  /** Events produced since the last `drainEvents()`. */
  private events: TableEvent[] = [];
  private kicks: Kick[] = [];
  private pendingLaunch: number | null = null;
  readonly tuning = TUNING;
  private readonly clearField: boolean;

  /**
   * @param opts.clearField  omit bumpers and cards (used by tests that isolate
   *   flipper strength from the obstacles above the flippers).
   */
  constructor(opts: { clearField?: boolean } = {}) {
    this.clearField = opts.clearField ?? false;
    this.world = new pl.World({ gravity: pl.Vec2(0, TUNING.gravity) });
    this.ground = this.world.createBody({ type: 'static' });
    this.buildStatic();
    this.left = new Flipper(this.world, this.ground, FLIPPERS.left, TUNING.flipper);
    this.right = new Flipper(this.world, this.ground, FLIPPERS.right, TUNING.flipper);
    this.plunger = new Plunger(this.world, TUNING.plunger);
    this.installListeners();
  }

  /* ---------------- construction ---------------- */

  private buildStatic(): void {
    const g = this.ground;
    const wall = TUNING.wall;

    // Outer shell: the arch is its own chain so it can have a deader bounce.
    g.createFixture(new pl.Chain(vs(OUTER_LEFT), false), { ...wall, userData: { kind: 'wall' } });
    g.createFixture(new pl.Chain(vs(OUTER_ARCH), false), {
      ...TUNING.arch,
      userData: { kind: 'wall', arch: true },
    });
    g.createFixture(new pl.Chain(vs(OUTER_RIGHT), false), { ...wall, userData: { kind: 'wall' } });

    // Lane wall with the one-way gate as child edge 0.
    g.createFixture(new pl.Chain(vs(LANE_WALL), false), { ...wall, userData: { kind: 'lanewall' } });

    // Funnels into the flippers.
    for (const f of FUNNELS) {
      g.createFixture(new pl.Chain(vs(f), false), { ...wall, userData: { kind: 'wall' } });
    }

    // Slingshots.
    for (const s of SLINGS) {
      g.createFixture(new pl.Polygon(vs(s.pts)), {
        friction: 0.1,
        restitution: TUNING.sling.restitution,
        userData: { kind: 'sling', id: s.id, nx: s.normal[0], ny: s.normal[1] },
      });
    }

    // Pop bumpers.
    for (const b of this.clearField ? [] : BUMPERS) {
      g.createFixture(new pl.Circle(v([b.x, b.y]), toM(BUMPER_R)), {
        friction: 0.1,
        restitution: TUNING.bumper.restitution,
        userData: { kind: 'bumper', id: b.id, cx: b.x, cy: b.y },
      });
    }

    // Cards.
    for (const c of this.clearField ? [] : CARDS) {
      g.createFixture(new pl.Polygon(vs(cardPolygon(c))), {
        ...TUNING.card,
        userData: { kind: 'card', id: c.id },
      });
    }

    // Rollover lane guides: thin rounded posts.
    for (const x of LANE_GUIDE_XS) {
      const h = (LANE_GUIDE_Y1 - LANE_GUIDE_Y0) / 2;
      g.createFixture(new pl.Box(toM(1.5), toM(h), v([x, LANE_GUIDE_Y0 + h]), 0), {
        friction: 0.05,
        restitution: 0.3,
        userData: { kind: 'post' },
      });
      g.createFixture(new pl.Circle(v([x, LANE_GUIDE_Y0]), toM(2.5)), {
        friction: 0.05,
        restitution: 0.3,
        userData: { kind: 'post' },
      });
    }

    // Rollover sensors.
    for (const s of LANE_SENSORS) this.sensorBox(s.rect, { kind: 'lane', id: s.id });

    // Drain sensor.
    this.sensorBox(DRAIN, { kind: 'drain' });
  }

  private sensorBox(r: Rect, data: UD): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    this.ground.createFixture(new pl.Box(toM(r.w / 2), toM(r.h / 2), v([cx, cy]), 0), {
      isSensor: true,
      userData: data,
    });
  }

  private installListeners(): void {
    const world = this.world;

    world.on('begin-contact', (c) => {
      const fa = c.getFixtureA();
      const fb = c.getFixtureB();
      const ua = ud(fa);
      const ub = ud(fb);
      let other: UD | null = null;
      if (ua?.kind === 'ball') other = ub;
      else if (ub?.kind === 'ball') other = ua;
      if (!other) return;
      switch (other.kind) {
        case 'bumper': {
          const p = this.ball?.getPosition();
          if (!p) break;
          const dx = toPx(p.x) - other.cx;
          const dy = toPx(p.y) - other.cy;
          const d = Math.hypot(dx, dy) || 1;
          this.kicks.push({ nx: dx / d, ny: dy / d, impulse: TUNING.bumper.kick });
          this.events.push({ type: 'bumper', id: other.id });
          break;
        }
        case 'sling':
          this.kicks.push({ nx: other.nx, ny: other.ny, impulse: TUNING.sling.kick });
          this.events.push({ type: 'sling', id: other.id });
          break;
        case 'card':
          this.events.push({ type: 'card', id: other.id });
          break;
        case 'lane':
          this.events.push({ type: 'lane', id: other.id });
          break;
        case 'drain':
          this.events.push({ type: 'drain' });
          break;
        default:
          break;
      }
    });

    // One-way gate: only the first child edge of the lane wall (y 190..300).
    // The ball may pass it while travelling left (out of the plunger lane).
    world.on('pre-solve', (c) => {
      const fa = c.getFixtureA();
      const fb = c.getFixtureB();
      const ua = ud(fa);
      const ub = ud(fb);
      let child = -1;
      if (ua?.kind === 'lanewall' && ub?.kind === 'ball') child = c.getChildIndexA();
      else if (ub?.kind === 'lanewall' && ua?.kind === 'ball') child = c.getChildIndexB();
      if (child !== 0) return;
      const ball = this.ball;
      if (!ball) return;
      if (ball.getLinearVelocity().x < 0) c.setEnabled(false);
    });
  }

  /* ---------------- ball ---------------- */

  spawnBall(at: Pt = PLUNGER.ballStart, velocity: Pt = [0, 0]): pl.Body {
    this.removeBall();
    const b = this.world.createBody({
      type: 'dynamic',
      bullet: true,
      position: v(at),
      linearVelocity: pl.Vec2(velocity[0], velocity[1]),
      linearDamping: TUNING.ball.linearDamping,
      angularDamping: TUNING.ball.angularDamping,
    });
    b.createFixture(new pl.Circle(toM(BALL_R)), {
      density: TUNING.ball.density,
      friction: TUNING.ball.friction,
      restitution: TUNING.ball.restitution,
      userData: { kind: 'ball' },
    });
    this.ball = b;
    return b;
  }

  removeBall(): void {
    if (this.ball) {
      this.world.destroyBody(this.ball);
      this.ball = null;
    }
  }

  /** Ball position in logical px. */
  ballPos(): Pt | null {
    if (!this.ball) return null;
    const p = this.ball.getPosition();
    return [toPx(p.x), toPx(p.y)];
  }

  /** Ball speed in m/s. */
  ballSpeed(): number {
    return this.ball ? this.ball.getLinearVelocity().length() : 0;
  }

  /** True when the ball is sitting in the plunger lane near the plunger. */
  ballOnPlunger(): boolean {
    const p = this.ballPos();
    if (!p) return false;
    return p[0] > WALL_R && p[1] > PLUNGER.restTop - 60 - this.plunger.pull;
  }

  ballInLane(): boolean {
    const p = this.ballPos();
    return !!p && inPlungerLane(p[0], p[1]);
  }

  /** Fire the plunger at power 0..1 on the next step (used for auto-launch). */
  launch(power: number): void {
    this.pendingLaunch = power;
  }

  /* ---------------- stepping ---------------- */

  drainEvents(): TableEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step(): void {
    const dt = TUNING.dt;
    const wasLeft = this.left.held;
    const wasRight = this.right.held;
    this.left.setHeld(this.input.left);
    this.right.setHeld(this.input.right);
    if (this.input.left && !wasLeft) this.events.push({ type: 'flipper', side: 'left' });
    if (this.input.right && !wasRight) this.events.push({ type: 'flipper', side: 'right' });

    // Plunger: held charges it, release (or an auto-launch) fires it.
    let power = this.plunger.update(dt, this.input.plunger);
    if (this.pendingLaunch !== null) {
      power = this.pendingLaunch;
      this.pendingLaunch = null;
    }
    if (power !== null && power > 0 && this.ball && this.ballOnPlunger()) {
      this.fire(power);
    }

    this.world.step(dt, TUNING.velocityIterations, TUNING.positionIterations);

    // Apply queued kicks and clamp speed now that the step is finished.
    const ball = this.ball;
    if (ball) {
      for (const k of this.kicks) {
        ball.applyLinearImpulse(pl.Vec2(k.nx * k.impulse, k.ny * k.impulse), ball.getWorldCenter(), true);
      }
      const vel = ball.getLinearVelocity();
      const sp = vel.length();
      if (sp > TUNING.ball.maxSpeed) {
        ball.setLinearVelocity(vel.mul(TUNING.ball.maxSpeed / sp));
      }
    }
    this.kicks.length = 0;
  }

  private fire(power: number): void {
    const ball = this.ball!;
    this.plunger.reset();
    ball.setPosition(v([PLUNGER.ballStart[0], PLUNGER.ballStart[1]]));
    ball.setLinearVelocity(pl.Vec2(0, -this.plunger.launchSpeed(power)));
    ball.setAwake(true);
    this.events.push({ type: 'launch', power });
  }
}
