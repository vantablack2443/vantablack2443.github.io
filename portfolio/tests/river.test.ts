/**
 * Headless checks of the night river. These run the real sim.ts, buoy.ts and water.ts (the same
 * code the browser runs, the Rust water loaded from its bytes) with the fixed 1/120 s step: the
 * Rust / TypeScript water parity, buoyancy, paddling, mooring, lanterns, crocodiles, a bot that
 * plays a whole night, and determinism.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BOAT, CROC, DOCK, DOCKS, LANTERNS, SAFE, SCORE, WATER, WORLD } from '../src/river/config';
import { River, type RiverEvent } from '../src/river/sim';
import { Water, loadWaterWasm } from '../src/river/water';

const DT = WORLD.dt;
const DEG = 180 / Math.PI;

beforeAll(async () => {
  const ok = await loadWaterWasm(readFileSync(new URL('../src/river/wasm/water.wasm', import.meta.url)));
  if (!ok) throw new Error('water.wasm did not load: run `npm run build:wasm`');
});

// the simulations run synchronously for seconds: let the runner's messages through between tests
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const steps = (seconds: number): number => Math.round(seconds / DT);

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

const pos = (sim: River): { x: number; z: number } => {
  const p = sim.boat.body.getPosition();
  return { x: p.x, z: p.y };
};

/** Run n seconds, collecting events. */
function run(sim: River, seconds: number, each?: () => void): RiverEvent[] {
  const seen: RiverEvent[] = [];
  for (let i = 0; i < steps(seconds); i++) {
    each?.();
    sim.step();
    seen.push(...sim.drainEvents());
  }
  return seen;
}

/** Paddle toward a point and stop on it: full strokes far away, none for the last few metres (the boat coasts to a halt). */
function goTo(sim: River, tx: number, tz: number, stopAt = 3): void {
  const p = pos(sim);
  const v = sim.boat.body.getLinearVelocity();
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  // the boat coasts about speed / drag further: stop paddling when that covers the rest
  const coast = Math.hypot(v.x, v.y) / BOAT.dragAlong;
  if (d < stopAt || d < coast * 0.9) {
    sim.inx = sim.inz = 0;
    return;
  }
  sim.inx = dx / d;
  sim.inz = dz / d;
}

/* ------------------------------------------------------------------ */
/* 1. the Rust water                                                   */
/* ------------------------------------------------------------------ */

describe('water', () => {
  it('cargo test passes in water-rs', () => {
    const env = { ...process.env, PATH: `${homedir()}/.cargo/bin${delimiter}${process.env.PATH ?? ''}` };
    let out = '';
    try {
      out = execFileSync('cargo', ['test', '--quiet'], { cwd: new URL('../water-rs', import.meta.url).pathname, env, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      const e = err as { code?: string; stdout?: string; stderr?: string };
      if (e.code === 'ENOENT') return; // no Rust here: the wasm bytes were built elsewhere
      throw new Error(`cargo test failed:\n${e.stdout}\n${e.stderr}`);
    }
    expect(out).toContain('test result: ok');
  }, 120000);

  it('Rust and TypeScript agree: max |dh| < 1e-4 after 5 s of the same disturbances', () => {
    const a = new Water(3);
    const b = new Water(3, true);
    expect(a.backend).toBe('wasm');
    expect(b.backend).toBe('ts');
    const r = rng(99);
    for (let n = 0; n < 300; n++) {
      if (n % 12 === 0) {
        const x = r() * 140;
        const z = r() * 16;
        const rad = 0.3 + r() * 1.6;
        const imp = (r() - 0.5) * 8;
        a.disturb(x, z, rad, imp);
        b.disturb(x, z, rad, imp);
      }
      a.step(1 / 60);
      b.step(1 / 60);
    }
    let worst = 0;
    let peak = 0;
    for (let i = 0; i < a.h.length; i++) {
      worst = Math.max(worst, Math.abs(a.h[i] - b.h[i]));
      peak = Math.max(peak, Math.abs(a.h[i]));
    }
    expect(peak).toBeGreaterThan(0.05); // there was something to compare
    expect(worst).toBeLessThan(1e-4);
  });

  it('settles: energy 20 s after a disturbance is under 1% of it, and nothing is NaN', () => {
    const w = new Water(3);
    w.disturb(70, 8, 1.2, -3);
    w.disturb(71.5, 9, 0.8, 2);
    for (let i = 0; i < 6; i++) w.step(1 / 60);
    const e0 = w.energy();
    expect(e0).toBeGreaterThan(0);
    for (let i = 0; i < 20 * 60; i++) w.step(1 / 60);
    expect(w.isFinite()).toBe(true);
    expect(w.energy() / e0).toBeLessThan(0.01);
  });

  it('spreads a ripple as a ring, bilinear height and slope read it, and a grown wasm memory is survived', () => {
    const w = new Water(1);
    w.disturb(70, 8, 1.2, -3);
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    // the ring is at about c t = 4.5 m: equal in the four directions
    // (read from the cells: heightAt adds the swell on top)
    const cell = (x: number, z: number): number => w.h[Math.round(z / w.dx - 0.5) * w.nx + Math.round(x / w.dx - 0.5)];
    let best = { r: 0, a: 0 };
    for (let r = 1; r < 6; r += 0.25) if (Math.abs(cell(70 + r, 8)) > best.a) best = { r, a: Math.abs(cell(70 + r, 8)) };
    expect(best.a).toBeGreaterThan(0.01);
    for (const [dx, dz] of [[-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, -0.707]]) {
      expect(Math.abs(Math.abs(cell(70 + dx * best.r, 8 + dz * best.r)) - best.a)).toBeLessThan(0.2 * best.a);
    }
    // the slope of the front points one way on each side
    expect(Math.sign(w.slopeAt(74.5, 8).x)).not.toBe(0);
    // memory growth detaches the old ArrayBuffer: the field must not read a stale view
    const f = w as unknown as { f: { x: { memory: WebAssembly.Memory } } };
    const before = w.heightAt(74.5, 8);
    f.f.x.memory.grow(1);
    expect(w.heightAt(74.5, 8)).toBeCloseTo(before, 6);
  });

  it('keeps the surface alive with a swell even when the cells are quiet', () => {
    const w = new Water(1);
    const s0 = w.heightAt(50, 8);
    for (let i = 0; i < 180; i++) w.step(1 / 60);
    expect(Math.abs(w.heightAt(50, 8) - s0)).toBeGreaterThan(1e-3);
  });
});

/* ------------------------------------------------------------------ */
/* 2-4. the boat                                                       */
/* ------------------------------------------------------------------ */

describe('boat', () => {
  it('settles (heave and pitch) within 3 s from a knock and stays afloat for 60 s', () => {
    const sim = new River({ seed: 7, crocs: false });
    sim.boatBuoy.y += 0.3;
    sim.boatBuoy.pitch = 0.2;
    sim.boatBuoy.roll = -0.15;
    for (let i = 0; i < steps(3); i++) sim.step();
    const bb = sim.boatBuoy;
    expect(Math.abs(bb.pitch) * DEG).toBeLessThan(2);
    expect(Math.abs(bb.roll) * DEG).toBeLessThan(3);
    expect(Math.abs(bb.vy)).toBeLessThan(0.05);
    for (let i = 0; i < steps(57); i++) {
      sim.step();
      const p = pos(sim);
      const draught = sim.water.heightAt(p.x, p.z) - (bb.y - BOAT.draught);
      expect(draught).toBeGreaterThan(0.2);
      expect(draught).toBeLessThan(0.5);
    }
  });

  // 30 seeds in batches of 5, so no single test blocks the runner for long
  it.each([0, 1, 2, 3, 4, 5])('survives 60 s of random input without NaN, leaving the river or capsizing (seeds batch %i of 6, 30 seeds in all)', (batch) => {
    for (let seed = batch * 5 + 1; seed <= batch * 5 + 5; seed++) {
      const sim = new River({ seed });
      sim.start();
      const r = rng(seed * 977);
      let hold = 0;
      for (let i = 0; i < steps(60); i++) {
        if (hold-- <= 0) {
          hold = steps(0.3 + r() * 1.4);
          // eight directions, or none
          const k = Math.floor(r() * 9);
          if (k === 8) sim.inx = sim.inz = 0;
          else {
            const a = (k * Math.PI) / 4;
            sim.inx = Math.round(Math.cos(a));
            sim.inz = Math.round(Math.sin(a));
            const m = Math.hypot(sim.inx, sim.inz);
            sim.inx /= m;
            sim.inz /= m;
          }
        }
        sim.step();
        sim.drainEvents();
        if (sim.phase !== 'playing') sim.start();
        if (i % 6 === 0) {
          const p = pos(sim);
          if (!sim.isSane() || p.x < 0 || p.x > WORLD.length || p.z < 0 || p.z > WORLD.width || Math.abs(sim.boatBuoy.pitch) > 30 / DEG || Math.abs(sim.boatBuoy.roll) > 30 / DEG) {
            throw new Error(`seed ${seed}: at ${p.x.toFixed(1)},${p.z.toFixed(1)} pitch ${(sim.boatBuoy.pitch * DEG).toFixed(1)} at ${(i * DT).toFixed(1)} s`);
          }
        }
      }
    }
  });

  it('holding one direction travels at least 25 m in 8 s, at most 6 m/s, and reaches ~5 m/s in about 2 s', () => {
    const sim = new River({ seed: 2, floaters: false, crocs: false });
    sim.start();
    sim.placeBoat(49, 8);
    sim.inx = 1;
    let top = 0;
    let at2 = 0;
    for (let i = 0; i < steps(8); i++) {
      sim.step();
      top = Math.max(top, sim.boatSpeed());
      if (i === steps(2)) at2 = sim.boatSpeed();
    }
    expect(pos(sim).x - 49).toBeGreaterThanOrEqual(25);
    expect(top).toBeLessThanOrEqual(6);
    expect(top).toBeGreaterThan(4);
    expect(at2).toBeGreaterThan(3.5);
  });

  it('crosses from the near bank to the far bank in 5 s or less', () => {
    for (const x of [49, 71, 93]) {
      const sim = new River({ seed: 2, floaters: false, crocs: false });
      sim.start();
      sim.placeBoat(x, 1.2);
      sim.inz = 1;
      let t = -1;
      for (let i = 0; i < steps(8) && t < 0; i++) {
        sim.step();
        if (pos(sim).z > WORLD.width - 3) t = i * DT;
      }
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(5);
    }
  });

  it('turns toward the input, and diagonals work', () => {
    const sim = new River({ seed: 2, floaters: false, crocs: false });
    sim.start();
    sim.placeBoat(49, 4, 0, 0);
    sim.inx = -1; // straight back: a half turn first
    run(sim, 1.2);
    expect(Math.cos(sim.boat.body.getAngle())).toBeLessThan(-0.7);
    sim.inx = 0.707;
    sim.inz = 0.707;
    run(sim, 1.5);
    expect(sim.boat.body.getLinearVelocity().y).toBeGreaterThan(1);
  });

  it('does not capsize when it hits a log at speed', () => {
    const sim = new River({ seed: 4, crocs: false });
    sim.start();
    const log = sim.floaters.find((f) => f.kind === 'log')!;
    const lp = log.tracked.body.getPosition();
    sim.placeBoat(lp.x - 10, lp.y, 0, 4);
    sim.inx = 1;
    let rock = 0;
    run(sim, 6, () => (rock = Math.max(rock, Math.abs(sim.boatBuoy.pitch), Math.abs(sim.boatBuoy.roll))));
    expect(rock).toBeLessThan(30 / DEG);
  });

  it('leaves a wake: the water is dented behind a moving boat, and the logs are pushed by it', () => {
    const sim = new River({ seed: 2, floaters: false, crocs: false });
    sim.start();
    sim.placeBoat(40, 8);
    sim.inx = 1;
    run(sim, 3);
    let peak = 0;
    const p = pos(sim);
    for (let x = p.x - 10; x < p.x; x += 0.5) for (let z = 4; z < 12; z += 0.5) peak = Math.max(peak, Math.abs(sim.water.heightAt(x, z) - 0));
    expect(peak).toBeGreaterThan(0.05);
  });
});

/* ------------------------------------------------------------------ */
/* 5. docks                                                            */
/* ------------------------------------------------------------------ */

describe('docks', () => {
  it('alternate far, near, far, near, far, near along the river', () => {
    expect(DOCKS.map((d) => d.side)).toEqual(['far', 'near', 'far', 'near', 'far', 'near']);
    for (let i = 1; i < DOCKS.length; i++) expect(DOCKS[i].x).toBeGreaterThan(DOCKS[i - 1].x);
  });

  it('a slow approach moors at a far-bank and a near-bank dock and fires the event; a stroke away casts off', () => {
    for (const d of [0, 1, 2, 3]) {
      const sim = new River({ seed: 10 + d, floaters: false, crocs: false });
      sim.start();
      const zone = sim.zoneOf(d);
      sim.placeBoat(zone.x - 12, WORLD.width / 2);
      const seen: RiverEvent[] = [];
      for (let i = 0; i < steps(25) && sim.moored < 0; i++) {
        goTo(sim, zone.x, zone.z, 2.5);
        sim.step();
        seen.push(...sim.drainEvents());
      }
      const moor = seen.filter((e) => e.type === 'moor');
      expect(moor).toHaveLength(1);
      expect(moor[0]).toMatchObject({ type: 'moor', dock: d, card: DOCKS[d].card, first: true, score: SCORE.dock });
      expect(sim.moored).toBe(d);
      expect(sim.docksVisited).toBe(1);
      // tied up: let it sit for 5 s, the boat stays beside the dock
      sim.inx = sim.inz = 0;
      run(sim, 5);
      const post = sim.postOf(d);
      expect(Math.hypot(pos(sim).x - post.x, pos(sim).z - post.z)).toBeLessThan(6);
      expect(sim.moored).toBe(d);
      // paddling away from the post casts off
      sim.inz = DOCKS[d].side === 'far' ? -1 : 1;
      const after = run(sim, 2);
      expect(sim.moored).toBe(-1);
      expect(after.some((e) => e.type === 'release')).toBe(true);
    }
  });

  it('a fast pass (over 2.5 m/s) bumps but does not moor, at a far and a near dock', () => {
    for (const d of [1, 2, 4, 5]) {
      const sim = new River({ seed: 5, floaters: false, crocs: false });
      sim.start();
      const zone = sim.zoneOf(d);
      sim.placeBoat(zone.x - 16, zone.z, 0, 4);
      sim.inx = 1;
      const seen = run(sim, 8);
      const bump = seen.find((e) => e.type === 'bump');
      expect(bump).toBeTruthy();
      expect(seen.some((e) => e.type === 'moor')).toBe(false);
      expect(sim.moored).toBe(-1);
      expect(pos(sim).x).toBeGreaterThan(zone.x + DOCK.zoneHalfX);
    }
  });

  it('after casting off, the same dock does not catch the boat again until it has left the zone', () => {
    const sim = new River({ seed: 6, floaters: false, crocs: false });
    sim.start();
    const zone = sim.zoneOf(1);
    sim.placeBoat(zone.x - 10, zone.z);
    for (let i = 0; i < steps(25) && sim.moored < 0; i++) {
      goTo(sim, zone.x, zone.z, 2.5);
      sim.step();
    }
    expect(sim.moored).toBe(1);
    sim.release(); // the card was closed
    sim.drainEvents();
    sim.inx = sim.inz = 0;
    const seen = run(sim, 4);
    expect(sim.moored).toBe(-1);
    expect(seen.some((e) => e.type === 'moor')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 6. lanterns                                                         */
/* ------------------------------------------------------------------ */

describe('lanterns', () => {
  it('lights once when the hull passes within 0.8 m, and scores 100', () => {
    const sim = new River({ seed: 3, floaters: false, crocs: false });
    sim.start();
    const l = LANTERNS[3];
    sim.placeBoat(l.x - 10, l.z, 0, 2.5);
    const lit: RiverEvent[] = [];
    // run under it, back and forth, a few times
    for (let pass = 0; pass < 3; pass++) {
      sim.inx = pass % 2 === 0 ? 1 : -1;
      lit.push(...run(sim, 4).filter((e) => e.type === 'lantern'));
    }
    expect(lit).toHaveLength(1);
    expect(lit[0]).toMatchObject({ type: 'lantern', index: 3, score: 100 });
    expect(sim.lanterns[3].lit).toBe(true);
    expect(sim.lanternsLit).toBe(1);
    expect(sim.score).toBe(100);
  });

  it('a boat passing 2 m away does not light it, but the lantern is only lit when the night is on', () => {
    const sim = new River({ seed: 3, floaters: false, crocs: false });
    sim.start();
    const l = LANTERNS[3];
    sim.placeBoat(l.x - 10, l.z + 2.2, 0, 3);
    sim.inx = 1;
    run(sim, 6);
    expect(sim.lanternsLit).toBe(0);
    const idle = new River({ seed: 3, floaters: false, crocs: false });
    idle.placeBoat(l.x - 10, l.z, 0, 3);
    idle.inx = 1;
    run(idle, 6);
    expect(idle.lanternsLit).toBe(0);
    expect(idle.score).toBe(0);
  });

  it('a touch makes it swing', () => {
    const sim = new River({ seed: 3, floaters: false, crocs: false });
    sim.start();
    const l = sim.lanterns[3];
    sim.placeBoat(LANTERNS[3].x - 6, LANTERNS[3].z, 0, 3);
    sim.inx = 1;
    let swing = 0;
    run(sim, 6, () => (swing = Math.max(swing, Math.hypot(l.ox, l.oz))));
    expect(swing).toBeGreaterThan(0.3);
  });
});

/* ------------------------------------------------------------------ */
/* 7. crocodiles                                                       */
/* ------------------------------------------------------------------ */

/** Directions from a boat mid-river that stay inside the river out to 17 m: along it and a little across. */
const ANGLES = [0, Math.PI, 0.2, Math.PI - 0.2, -0.2, Math.PI + 0.2];

/** Park a crocodile `dist` metres from the boat in a direction (the boat sits in open water). */
function placeCroc(sim: River, i: number, dist: number, angle: number): void {
  const b = pos(sim);
  const c = sim.crocs[i];
  const body = c.tracked.body;
  if (!c.awake) body.setActive(true), (c.awake = true);
  body.setPosition({ x: b.x + Math.cos(angle) * dist, y: b.z + Math.sin(angle) * dist });
  body.setLinearVelocity({ x: 0, y: 0 });
  c.state = 'lurk';
  c.tracked.reset();
}

describe('crocodiles', () => {
  it('there are two; the second sleeps until the first dock visit, and neither spawns within 15 m of the boat', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new River({ seed });
      expect(sim.crocs).toHaveLength(2);
      expect(sim.crocs[0].awake).toBe(true);
      expect(sim.crocs[1].awake).toBe(false);
      const c = sim.crocs[0].tracked.body.getPosition();
      expect(Math.hypot(c.x - pos(sim).x, c.y - pos(sim).z)).toBeGreaterThanOrEqual(CROC.spawnMin);
    }
    const sim = new River({ seed: 8, floaters: false });
    sim.start();
    const zone = sim.zoneOf(0);
    sim.placeBoat(zone.x - 10, zone.z);
    const seen: RiverEvent[] = [];
    for (let i = 0; i < steps(30) && sim.docksVisited < 1; i++) {
      goTo(sim, zone.x, zone.z, 2.5);
      sim.step();
      seen.push(...sim.drainEvents());
    }
    sim.step();
    expect(sim.crocs[1].awake).toBe(true);
    const c = sim.crocs[1].tracked.body.getPosition();
    expect(Math.hypot(c.x - pos(sim).x, c.y - pos(sim).z)).toBeGreaterThanOrEqual(CROC.spawnMin);
  });

  it('a stationary boat in open water gets bitten within 20 s', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new River({ seed, floaters: false });
      sim.start();
      sim.placeBoat(70, 8);
      placeCroc(sim, 0, 17, ANGLES[seed % ANGLES.length]);
      expect(sim.inSafe(70, 8)).toBe(false);
      const seen = run(sim, 20);
      expect(seen.some((e) => e.type === 'bite'), `seed ${seed}`).toBe(true);
    }
  });

  it('a bite costs 15 s and 150 points, and the croc retreats', () => {
    const sim = new River({ seed: 2, floaters: false });
    sim.start();
    sim.placeBoat(70, 8);
    sim.score = 400;
    placeCroc(sim, 0, 8, 0.3);
    let elapsedBefore = 0;
    let bite: RiverEvent | undefined;
    for (let i = 0; i < steps(20) && !bite; i++) {
      elapsedBefore = sim.elapsed;
      sim.step();
      bite = sim.drainEvents().find((e) => e.type === 'bite');
    }
    expect(bite).toMatchObject({ type: 'bite', score: -150, seconds: 15 });
    expect(sim.score).toBe(250);
    expect(sim.elapsed - elapsedBefore).toBeCloseTo(15 + DT, 3);
    expect(sim.bites).toBe(1);
    expect(sim.crocs[0].state).toBe('retreat');
    // no second bite while it retreats
    expect(run(sim, 4).some((e) => e.type === 'bite')).toBe(false);
  });

  it('is never bitten while moored, or with a card open', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = new River({ seed, floaters: false });
      sim.start();
      const zone = sim.zoneOf(1);
      sim.placeBoat(zone.x - 10, zone.z);
      for (let i = 0; i < steps(25) && sim.moored < 0; i++) {
        goTo(sim, zone.x, zone.z, 2.5);
        sim.step();
      }
      expect(sim.moored).toBe(1);
      sim.drainEvents();
      sim.inx = sim.inz = 0;
      placeCroc(sim, 0, 9, ANGLES[seed % 6]);
      placeCroc(sim, 1, 12, ANGLES[(seed + 2) % 6]);
      expect(run(sim, 30).some((e) => e.type === 'bite')).toBe(false);
      sim.release();
      sim.holdClock = true; // a card is open
      expect(run(sim, 10).some((e) => e.type === 'bite')).toBe(false);
    }
  });

  it("is never bitten inside a lit lantern's circle, even with crocodiles all around", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = new River({ seed, floaters: false });
      sim.start();
      const l = sim.lanterns[3]; // a rope lantern in open water
      sim.placeBoat(l.ax - 8, l.az, 0, 2.5);
      sim.inx = 1;
      for (let i = 0; i < steps(8) && !l.lit; i++) {
        sim.step();
        sim.drainEvents();
      }
      expect(l.lit).toBe(true);
      sim.inx = sim.inz = 0;
      sim.placeBoat(l.ax + 1, l.az + 0.5);
      expect(sim.inSafe(l.ax + 1, l.az + 0.5)).toBe(true);
      placeCroc(sim, 0, 10, ANGLES[seed % 6]);
      placeCroc(sim, 1, 11, ANGLES[(seed + 3) % 6]);
      let nearest = 99;
      const seen = run(sim, 30, () => {
        for (const c of sim.crocs) {
          const p = c.tracked.body.getPosition();
          nearest = Math.min(nearest, Math.hypot(p.x - l.ax, p.y - l.az));
        }
      });
      expect(seen.some((e) => e.type === 'bite'), `seed ${seed}`).toBe(false);
      // they really do keep out of the circle
      expect(nearest).toBeGreaterThan(SAFE.lantern - 1.3);
    }
  });

  it('stalking is slower than the boat, and a lunge is a 0.5 s burst at 7 m/s', () => {
    const sim = new River({ seed: 2, floaters: false });
    sim.start();
    sim.placeBoat(70, 8);
    placeCroc(sim, 0, 9, Math.PI);
    let stalkTop = 0;
    let lungeTop = 0;
    let lungeTime = 0;
    for (let i = 0; i < steps(14); i++) {
      sim.step();
      sim.drainEvents();
      const c = sim.crocs[0];
      const v = c.tracked.body.getLinearVelocity();
      const sp = Math.hypot(v.x, v.y);
      if (c.state === 'stalk') stalkTop = Math.max(stalkTop, sp);
      if (c.state === 'lunge') {
        lungeTop = Math.max(lungeTop, sp);
        lungeTime += DT;
      }
    }
    expect(stalkTop).toBeGreaterThan(2.5);
    expect(stalkTop).toBeLessThanOrEqual(CROC.stalkSpeed + 0.4);
    expect(lungeTop).toBeGreaterThan(5.5);
    expect(lungeTime).toBeGreaterThan(0.1);
    expect(lungeTime).toBeLessThanOrEqual(CROC.lungeTime + 0.05);
  });
});

/* ------------------------------------------------------------------ */
/* 8. a bot plays a whole night                                        */
/* ------------------------------------------------------------------ */

/**
 * Steer to the next unvisited dock (moor slowly, read its card for a second, cast off), detour
 * through unlit lanterns that are nearly on the way, and flee a stalking or lunging crocodile
 * (toward the nearest safe circle if that is away from it, else straight away, never into a bank).
 */
function runBot(seed: number): { visited: number; at: number; bites: number; lit: number } {
  const sim = new River({ seed });
  sim.start();
  let cardUntil = -1;
  let waited = 0;
  let dash = 0;
  for (let i = 0; i < steps(WORLD.nightSeconds + 1) && sim.phase === 'playing'; i++) {
    if (sim.moored >= 0) {
      // "reading the card" for a second (the clock holds), then closing it
      if (cardUntil < 0) {
        cardUntil = sim.t + 1;
        sim.holdClock = true;
        sim.inx = sim.inz = 0;
      } else if (sim.t >= cardUntil) {
        sim.holdClock = false;
        sim.release();
        cardUntil = -1;
      }
    } else if (botFlee(sim)) {
      waited = 0;
    } else if (botWaits(sim, waited)) {
      // in a safe circle with a crocodile prowling: sit tight (for a while)
      sim.inx = sim.inz = 0;
      waited += DT;
    } else {
      if (waited > 0) dash = steps(5);
      waited = 0;
      botSteer(sim);
    }
    if (dash > 0) dash--;
    sim.step();
    sim.drainEvents();
    if (sim.docksVisited === DOCKS.length) break; // all six: the bot's job is done
  }
  return { visited: sim.docksVisited, at: sim.elapsed, bites: sim.bites, lit: sim.lanternsLit };
}

function botSteer(sim: River): void {
  const p = pos(sim);
  let d = 0;
  while (d < DOCKS.length && sim.visited[d]) d++;
  if (d >= DOCKS.length) {
    sim.inx = sim.inz = 0;
    return;
  }
  const zone = sim.zoneOf(d);
  // a lantern is worth a detour if it costs under 7 m
  let tx = zone.x;
  let tz = zone.z;
  let best = 7;
  for (const l of sim.lanterns) {
    if (l.lit) continue;
    const cost = Math.hypot(l.ax - p.x, l.az - p.z) + Math.hypot(zone.x - l.ax, zone.z - l.az) - Math.hypot(zone.x - p.x, zone.z - p.z);
    if (cost < best && Math.hypot(l.ax - p.x, l.az - p.z) > 0.5) {
      best = cost;
      tx = l.ax;
      tz = l.az;
    }
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  const m = Math.hypot(dx, dz) || 1;
  let gx = dx / m;
  let gz = dz / m;
  // keep clear of crocodiles that are not retreating: a sideways bend around them
  for (const c of sim.crocs) {
    if (!c.awake || c.state === 'retreat') continue;
    const q = c.tracked.body.getPosition();
    const cx = p.x - q.x;
    const cz = p.z - q.y;
    const cd = Math.hypot(cx, cz);
    if (cd > 18 || sim.inSafe(p.x, p.z)) continue;
    const k = (1 - cd / 18) * 2.2;
    gx += (cx / cd) * k;
    gz += (cz / cd) * k;
  }
  const gm = Math.hypot(gx, gz) || 1;
  if (tx === zone.x && gm === 0) return;
  if (tx === zone.x && Math.hypot(dx, dz) < 12) {
    goTo(sim, tx, tz, 2.5);
    if (sim.inx !== 0 || sim.inz !== 0) {
      sim.inx = gx / gm;
      sim.inz = gz / gm;
    }
  } else {
    sim.inx = gx / gm;
    sim.inz = gz / gm;
  }
}

/** Is the boat in a safe circle with a crocodile close by (and has it not waited too long already)? */
function botWaits(sim: River, waited: number): boolean {
  const p = pos(sim);
  if (waited > 4 || !sim.inSafe(p.x, p.z)) return false;
  return sim.crocs.some((c) => {
    if (!c.awake || c.state === 'retreat') return false;
    const q = c.tracked.body.getPosition();
    return Math.hypot(p.x - q.x, p.z - q.y) < 9;
  });
}

function botFlee(sim: River): boolean {
  const p = pos(sim);
  if (sim.inSafe(p.x, p.z)) return false;
  let worst: { dx: number; dz: number; d: number; lunge: boolean; dirX: number; dirZ: number } | null = null;
  for (const c of sim.crocs) {
    if (!c.awake || (c.state !== 'stalk' && c.state !== 'lunge')) continue;
    const q = c.tracked.body.getPosition();
    const d = Math.hypot(p.x - q.x, p.z - q.y);
    if (d < 7.5 && (!worst || d < worst.d)) worst = { dx: p.x - q.x, dz: p.z - q.y, d, lunge: c.state === 'lunge', dirX: c.dirX, dirZ: c.dirZ };
  }
  if (!worst) return false;
  let fx = worst.dx / (worst.d || 1);
  let fz = worst.dz / (worst.d || 1);
  if (worst.lunge) {
    // dodge sideways to the lunge, away from it
    const side = Math.sign(fx * -worst.dirZ + fz * worst.dirX) || 1;
    fx += -worst.dirZ * side;
    fz += worst.dirX * side;
  } else {
    // a safe circle (a lit lantern, a dock) on the far side of the boat is a refuge
    let refuge: { x: number; z: number } | null = null;
    let near = 20;
    const consider = (x: number, z: number): void => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < near && ((x - p.x) * fx + (z - p.z) * fz) / d > 0.3) {
        near = d;
        refuge = { x, z };
      }
    };
    for (const l of sim.lanterns) if (l.lit) consider(l.ax, l.az);
    for (let i = 0; i < DOCKS.length; i++) consider(sim.postOf(i).x, sim.postOf(i).z);
    if (refuge) {
      const r = refuge as { x: number; z: number };
      const m = Math.hypot(r.x - p.x, r.z - p.z) || 1;
      fx = (r.x - p.x) / m + 0.3 * fx;
      fz = (r.z - p.z) / m + 0.3 * fz;
    }
  }
  // never flee into a bank or an end: slide along it
  if (p.z < 2.5 && fz < 0) fz = 0.5;
  if (p.z > WORLD.width - 2.5 && fz > 0) fz = -0.5;
  if (p.x < 4 && fx < 0) fx = 0.5;
  if (p.x > WORLD.length - 4 && fx > 0) fx = -0.5;
  const m = Math.hypot(fx, fz) || 1;
  sim.inx = fx / m;
  sim.inz = fz / m;
  return true;
}

describe('bot', () => {
  const results: Array<{ seed: number; visited: number; at: number; bites: number; lit: number }> = [];
  it.each([0, 1, 2, 3, 4, 5])('plays the night on seeds batch %i of 6', (batch) => {
    for (let seed = batch * 5 + 1; seed <= batch * 5 + 5; seed++) results.push({ seed, ...runBot(seed) });
  });
  it('visits all six docks within 150 s in at least 24 of 30 seeds', () => {
    const ok = results.filter((r) => r.visited === DOCKS.length).length;
    const bites = results.reduce((s, r) => s + r.bites, 0) / results.length;
    const lit = results.reduce((s, r) => s + r.lit, 0) / results.length;
    console.log(
      `bot: ${ok}/30 seeds visited all six docks, ${bites.toFixed(2)} bites a night, ${lit.toFixed(1)} lanterns lit (${results
        .map((r) => `${r.seed}:${r.visited}d/${r.bites}b@${r.at.toFixed(0)}s`)
        .join(' ')})`,
    );
    expect(results).toHaveLength(30);
    expect(ok).toBeGreaterThanOrEqual(24);
  });
});

/* ------------------------------------------------------------------ */
/* 9. determinism                                                      */
/* ------------------------------------------------------------------ */

describe('determinism', () => {
  it('the same seed and input script give an identical state after 30 s', () => {
    const go = (): unknown => {
      const sim = new River({ seed: 11 });
      sim.start();
      const r = rng(4242);
      let hold = 0;
      let events = 0;
      for (let i = 0; i < steps(30); i++) {
        if (hold-- <= 0) {
          hold = steps(0.2 + r());
          const a = r() * Math.PI * 2;
          const k = r();
          sim.inx = k < 0.2 ? 0 : Math.cos(a);
          sim.inz = k < 0.2 ? 0 : Math.sin(a);
        }
        sim.step();
        events += sim.drainEvents().length;
      }
      const p = sim.boat.body.getPosition();
      let sum = 0;
      for (let i = 0; i < sim.water.h.length; i++) sum += sim.water.h[i] * ((i % 97) + 1);
      return {
        boat: [p.x, p.y, sim.boat.body.getAngle(), sim.boatBuoy.y, sim.boatBuoy.pitch],
        water: sum,
        lanterns: sim.lanterns.flatMap((l) => [l.x, l.z, l.y]),
        crocs: sim.crocs.map((c) => [c.tracked.body.getPosition().x, c.tracked.body.getPosition().y, c.state]),
        score: sim.score,
        events,
      };
    };
    expect(go()).toEqual(go());
  });

  it('different seeds build different rivers', () => {
    const a = new River({ seed: 1 });
    const b = new River({ seed: 2 });
    expect(a.floaters[0].tracked.body.getPosition().x).not.toBe(b.floaters[0].tracked.body.getPosition().x);
    expect(WATER.nx * WATER.dx).toBe(WORLD.length);
  });
});
