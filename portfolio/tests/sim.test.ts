/**
 * Headless physics checks. These build the REAL world from layout.ts (the same
 * code the browser uses) and step it with the fixed 1/120 s timestep.
 */
import { describe, expect, it } from 'vitest';
import * as pl from 'planck';
import {
  BALL_R,
  BUMPERS,
  BUMPER_R,
  CARDS,
  cardOutline,
  DRAIN,
  FLIPPERS,
  GATE_BOTTOM_Y,
  GATE_TOP_Y,
  LANE_R,
  PLUNGER,
  STAGE_H,
  TOP_Y,
  WALL_L,
  WALL_R,
  toM,
  toPx,
  type Pt,
} from '../src/layout';
import { TUNING, Table } from '../src/game/physics';

/* ---------- helpers ---------- */

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

const DT = TUNING.dt;

/** Is there any fixture within `margin` px of this point (AABB level)? */
function spotIsFree(table: Table, x: number, y: number, margin = 6): boolean {
  const r = toM(BALL_R + margin);
  let free = true;
  const aabb = new pl.AABB(pl.Vec2(toM(x) - r, toM(y) - r), pl.Vec2(toM(x) + r, toM(y) + r));
  table.world.queryAABB(aabb, () => {
    free = false;
    return false;
  });
  return free;
}

function randomFreeSpot(table: Table, rand: () => number): [number, number] {
  for (let i = 0; i < 1000; i++) {
    const x = WALL_L + 20 + rand() * (WALL_R - WALL_L - 40);
    const y = TOP_Y + 30 + rand() * (740 - TOP_Y - 30);
    if (spotIsFree(table, x, y)) return [x, y];
  }
  throw new Error('no free spot');
}

interface Violation {
  step: number;
  msg: string;
}

function pointInPolygon(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Check invariants that must hold for a ball that started on the playfield. */
function checkBall(table: Table, prev: Pt | null): string | null {
  const p = table.ballPos();
  if (!p) return null;
  const [x, y] = p;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return `non-finite position`;
  if (x < WALL_L - 1) return `escaped left wall x=${x.toFixed(1)} y=${y.toFixed(1)}`;
  if (y < TOP_Y - 1) return `escaped top arch x=${x.toFixed(1)} y=${y.toFixed(1)}`;
  if (x > LANE_R + 1) return `escaped right wall x=${x.toFixed(1)}`;
  if (y > STAGE_H) return `fell out of the stage y=${y.toFixed(1)}`;
  // never inside a card or bumper
  for (const c of CARDS) {
    if (pointInPolygon(x, y, cardOutline(c))) {
      return `ball centre inside ${c.id} at ${x.toFixed(1)},${y.toFixed(1)}`;
    }
  }
  for (const b of BUMPERS) {
    if (Math.hypot(x - b.x, y - b.y) < BUMPER_R - 1) return `ball centre inside ${b.id}`;
  }
  // never crosses from the playfield into the plunger lane
  if (prev && prev[0] <= WALL_R && x > WALL_R + 1) return `entered plunger lane from the left at y=${y.toFixed(1)}`;
  return null;
}

/* ---------- 1. no tunneling ---------- */

function tunnelingRun(seed: number, maxLaunchSpeed: number, seconds: number): Violation[] {
  const rand = rng(seed);
  const table = new Table();
  const violations: Violation[] = [];
  const spawn = (): void => {
    const [x, y] = randomFreeSpot(table, rand);
    const a = rand() * Math.PI * 2;
    const s = rand() * maxLaunchSpeed;
    table.spawnBall([x, y], [0, 0]);
    table.ball!.setLinearVelocity(pl.Vec2(Math.cos(a) * s, Math.sin(a) * s));
  };
  spawn();
  let prev: Pt | null = table.ballPos();
  const steps = Math.round(seconds / DT);
  const toggleEvery = Math.round(0.2 / DT);
  for (let i = 0; i < steps; i++) {
    if (i % toggleEvery === 0) {
      table.input.left = rand() < 0.5;
      table.input.right = rand() < 0.5;
    }
    table.step();
    table.drainEvents(); // keep the queue small
    const p = table.ballPos()!;
    if (p[1] > DRAIN.y + 4) {
      // went down the drain: legitimate. New ball.
      spawn();
      prev = table.ballPos();
      continue;
    }
    const msg = checkBall(table, prev);
    if (msg) {
      violations.push({ step: i, msg });
      spawn();
      prev = table.ballPos();
      continue;
    }
    if (table.ballSpeed() > TUNING.ball.maxSpeed + 0.01) {
      violations.push({ step: i, msg: `speed above clamp ${table.ballSpeed()}` });
    }
    prev = p;
  }
  return violations;
}

describe('no tunneling', () => {
  it('20 random drops, flippers toggling every 0.2 s, 60 s each: ball never leaves the playfield', () => {
    const all: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      for (const v of tunnelingRun(seed, 8, 60)) all.push(`seed ${seed} step ${v.step}: ${v.msg}`);
    }
    expect(all).toEqual([]);
  });

  it('stress: 20 drops launched at up to 40 m/s in random directions', () => {
    const all: string[] = [];
    for (let seed = 101; seed <= 120; seed++) {
      for (const v of tunnelingRun(seed, 40, 30)) all.push(`seed ${seed} step ${v.step}: ${v.msg}`);
    }
    expect(all).toEqual([]);
  });
});

/* ---------- 2. flipper strength ---------- */

/** Unit vector pivot->tip of the flipper at rest (y down). */
function restDir(side: 'left' | 'right'): [number, number] {
  const f = FLIPPERS[side];
  const sgn = side === 'left' ? 1 : -1;
  return [sgn * Math.cos(Math.abs(f.restAngle)), Math.sin(Math.abs(f.restAngle))];
}

describe('flipper strength', () => {
  // Strength is measured with the cards and bumpers removed so nothing above
  // the flippers can interfere; the geometry of the flippers, funnels, gravity
  // and walls is the real thing.
  for (const side of ['left', 'right'] as const) {
    for (const frac of [0.3, 0.6, 0.9]) {
      it(`${side} flipper: ball resting on the flipper (${Math.round(frac * 100)}% along) is flipped to y < 240`, () => {
        const table = new Table({ clearField: true });
        const f = FLIPPERS[side];
        const [dx, dy] = restDir(side);
        const along = f.length * frac;
        const halfThick = f.baseR + (f.tipR - f.baseR) * frac;
        // normal pointing up from the blade
        const n: [number, number] = side === 'left' ? [dy, -dx] : [-dy, dx];
        const up = n[1] < 0 ? n : [-n[0], -n[1]];
        const pos: [number, number] = [
          f.pivot[0] + dx * along + up[0] * (halfThick + BALL_R + 0.5),
          f.pivot[1] + dy * along + up[1] * (halfThick + BALL_R + 0.5),
        ];
        table.spawnBall(pos, [0, 0]);
        // let it settle for 0.1 s with the flipper down, then flip
        for (let i = 0; i < 12; i++) table.step();
        let minY = Infinity;
        if (side === 'left') table.input.left = true;
        else table.input.right = true;
        for (let i = 0; i < 360; i++) {
          table.step();
          const p = table.ballPos()!;
          minY = Math.min(minY, p[1]);
        }
        expect(minY).toBeLessThan(240);
      });
    }
  }

  it('ball cradled on a RAISED flipper, then released and flipped, reaches y < 240', () => {
    const table = new Table({ clearField: true });
    table.input.left = true;
    for (let i = 0; i < 60; i++) table.step();
    // drop a ball onto the raised flipper
    table.spawnBall([FLIPPERS.left.pivot[0] + 40, FLIPPERS.left.pivot[1] - 60], [0, 0]);
    for (let i = 0; i < 240; i++) table.step();
    // release: the ball rolls out of the valley down the lowered flipper; flip when it is mid-blade
    table.input.left = false;
    for (let i = 0; i < 54; i++) table.step();
    table.input.left = true;
    let minY = Infinity;
    for (let i = 0; i < 360; i++) {
      table.step();
      minY = Math.min(minY, table.ballPos()![1]);
    }
    expect(minY).toBeLessThan(240);
  });

  it('with the real cards in place the centre gap is reachable: >= 15% of flips send the ball above the card block (y < 320)', () => {
    const rand = rng(42);
    let tries = 0;
    let hits = 0;
    for (const side of ['left', 'right'] as const) {
      for (let k = 0; k < 60; k++) {
        const table = new Table();
        const f = FLIPPERS[side];
        const [dx, dy] = restDir(side);
        const frac = 0.15 + rand() * 0.8;
        const n: [number, number] = side === 'left' ? [dy, -dx] : [-dy, dx];
        const up = n[1] < 0 ? n : [-n[0], -n[1]];
        const th = f.baseR + (f.tipR - f.baseR) * frac + BALL_R + 0.5;
        table.spawnBall(
          [f.pivot[0] + dx * f.length * frac + up[0] * th, f.pivot[1] + dy * f.length * frac + up[1] * th],
          [0, 0],
        );
        // the ball rolls on the blade for a random time before the player flips
        const settle = Math.floor(rand() * 40);
        for (let i = 0; i < settle; i++) table.step();
        if (side === 'left') table.input.left = true;
        else table.input.right = true;
        let minY = Infinity;
        for (let i = 0; i < 480; i++) {
          table.step();
          table.drainEvents();
          minY = Math.min(minY, table.ballPos()![1]);
        }
        tries++;
        if (minY < 320) hits++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`centre-gap reachability: ${hits}/${tries}`);
    expect(hits / tries).toBeGreaterThanOrEqual(0.15);
  });

  it('both flippers raised: a ball resting on a blade stays cradled, a dead-centre drop still slips through (shorter flippers, by design)', () => {
    // With the pivots unchanged, 88 px blades can no longer close the centre
    // (2 x (88 + 6) < 208 px between the pivots), so the old "cannot drop
    // through the gap" guarantee is gone on purpose.
    const run = (x: number, y: number, settleSteps: number): boolean => {
      const table = new Table();
      table.input.left = true;
      table.input.right = true;
      for (let i = 0; i < 60; i++) table.step();
      table.spawnBall([x, y], [0, 0]);
      let drained = false;
      for (let i = 0; i < settleSteps; i++) {
        table.step();
        if (table.ballPos()![1] > DRAIN.y) drained = true;
      }
      return drained;
    };
    const f = FLIPPERS.left;
    // sits just above the middle of the raised left blade
    const x = f.pivot[0] + 38;
    const y = f.pivot[1] - Math.tan(14 * (Math.PI / 180)) * 38 - f.baseR - BALL_R - 1;
    expect(run(x, y, 360)).toBe(false);
    expect(run(280, 540, 240)).toBe(true);
  });

  it('flippers at rest leave a gap a centred ball drains through', () => {
    const table = new Table();
    table.spawnBall([280, 540], [0, 0]);
    let drained = false;
    for (let i = 0; i < 360; i++) {
      table.step();
      if (table.ballPos()![1] > DRAIN.y) drained = true;
    }
    expect(drained).toBe(true);
  });
});


/* ---------- 2b. a naive bot must lose balls (difficulty check) ---------- */

describe('difficulty', () => {
  it('a bot that flips when the ball is below y = 720 loses its ball within 90 s in >= 30% of 60 seeds', () => {
    const BOT_Y = 720; // the brief's y = 880 minus the 160 px the layout moved up
    const SECONDS = 90;
    let lost = 0;
    const times: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(1000 + seed);
      const table = new Table();
      table.spawnBall();
      for (let i = 0; i < 30; i++) table.step();
      table.launch(0.5 + rand() * 0.5);
      let holdLeft = 0;
      let cooldown = 0;
      let drainedAt = -1;
      const steps = Math.round(SECONDS / DT);
      for (let i = 0; i < steps; i++) {
        const p = table.ballPos()!;
        if (holdLeft > 0) {
          holdLeft--;
          if (holdLeft === 0) cooldown = 14;
        } else if (cooldown > 0) {
          cooldown--;
          table.input.left = table.input.right = false;
        } else if (p[1] > BOT_Y && p[0] < WALL_R) {
          holdLeft = 20; // a quick 0.17 s flip of both flippers
        }
        table.input.left = table.input.right = holdLeft > 0;
        table.step();
        table.drainEvents();
        if (table.ballPos()![1] > DRAIN.y) {
          drainedAt = i * DT;
          break;
        }
      }
      if (drainedAt >= 0) {
        lost++;
        times.push(drainedAt);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`bot drain rate: ${lost}/60 (${Math.round((lost / 60) * 100)}%), median time ${times.sort((a, b) => a - b)[Math.floor(times.length / 2)]?.toFixed(1)} s`);
    expect(lost / 60).toBeGreaterThanOrEqual(0.3);
  });
});

/* ---------- 3. plunger ---------- */

type LaunchResult = { exited: boolean; exitedAt: number; returned: boolean; peakY: number };

function launchTest(holdSteps: number, auto?: number): LaunchResult {
  const table = new Table();
  table.spawnBall();
  for (let i = 0; i < 30; i++) table.step(); // settle on the plunger
  if (auto !== undefined) {
    table.launch(auto);
  } else {
    table.input.plunger = true;
    for (let i = 0; i < holdSteps; i++) table.step();
    table.input.plunger = false;
  }
  let exited = false;
  let exitedAt = -1;
  let returned = false;
  let peakY = Infinity;
  const total = Math.round(25 / DT);
  let prev = table.ballPos()!;
  for (let i = 0; i < total; i++) {
    table.step();
    table.drainEvents();
    const p = table.ballPos()!;
    peakY = Math.min(peakY, p[1]);
    if (!exited && p[0] < WALL_R - BALL_R && p[1] < GATE_BOTTOM_Y) {
      exited = true;
      exitedAt = i * DT;
    }
    // once out, it must never be back in the lane region
    if (exited && prev[0] <= WALL_R && p[0] > WALL_R + 1) returned = true;
    if (p[1] > DRAIN.y) break;
    prev = p;
  }
  return { exited, exitedAt, returned, peakY };
}

describe('plunger', () => {
  it('full-power launch leaves the lane and enters the playfield; never re-enters from the left', () => {
    const r = launchTest(Math.round(1.2 / DT));
    expect(r.exited).toBe(true);
    expect(r.returned).toBe(false);
  });

  it('minimum-power launch still exits the lane', () => {
    const r = launchTest(1);
    expect(r.exited).toBe(true);
    expect(r.returned).toBe(false);
  });

  it('mid-power and auto-fire (85%) launches exit the lane', () => {
    expect(launchTest(Math.round(0.5 / DT)).exited).toBe(true);
    const auto = launchTest(0, TUNING.plunger.autoPower);
    expect(auto.exited).toBe(true);
    expect(auto.returned).toBe(false);
  });

  it('plunger visibly pulls down while charging and returns after release', () => {
    const table = new Table();
    table.spawnBall();
    for (let i = 0; i < 30; i++) table.step();
    table.input.plunger = true;
    for (let i = 0; i < 60; i++) table.step();
    expect(table.plunger.pull).toBeGreaterThan(PLUNGER.travel * 0.4);
    table.input.plunger = false;
    table.step();
    expect(table.plunger.pull).toBe(0);
  });
});

/* ---------- 4. one-way gate ---------- */

describe('one-way gate', () => {
  it('a ball shot at the gate from the playfield side never gets into the lane', () => {
    const rand = rng(7);
    const failures: string[] = [];
    for (let n = 0; n < 150; n++) {
      const table = new Table();
      const y = GATE_TOP_Y + 12 + rand() * (GATE_BOTTOM_Y - GATE_TOP_Y - 12);
      const x = WALL_R - 20 - rand() * 80;
      if (!spotIsFree(table, x, y, 0)) continue;
      const speed = 3 + rand() * 37;
      const ang = (rand() - 0.5) * 1.6; // mostly rightwards
      table.spawnBall([x, y], [0, 0]);
      table.ball!.setLinearVelocity(pl.Vec2(Math.cos(ang) * speed, Math.sin(ang) * speed));
      let prev = table.ballPos()!;
      for (let i = 0; i < 480; i++) {
        table.step();
        table.drainEvents();
        const p = table.ballPos()!;
        if (prev[0] <= WALL_R && p[0] > WALL_R + 1) {
          failures.push(`shot ${n} entered lane at y=${p[1].toFixed(1)}`);
          break;
        }
        if (p[1] > DRAIN.y) break;
        prev = p;
      }
    }
    expect(failures).toEqual([]);
  });

  it('a ball moving left inside the lane can pass the gate', () => {
    const table = new Table();
    table.spawnBall([PLUNGER.x - 8, 70], [-6, -1]);
    let out = false;
    for (let i = 0; i < 240; i++) {
      table.step();
      if (table.ballPos()![0] < WALL_R - 30) out = true;
    }
    expect(out).toBe(true);
  });
});

/* ---------- 5. sanity of units ---------- */

describe('units', () => {
  it('toM / toPx round trip', () => {
    expect(toPx(toM(123.4))).toBeCloseTo(123.4);
  });
});
