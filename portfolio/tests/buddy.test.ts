/**
 * The buddy's sim and planner on fake panels (no DOM). The sprite sheet manifests are tested in buddy-sheet.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Plan } from '../src/light/buddy-plan';
import { BuddySim, DEFAULT_METRICS, MAX_THROW, OVERLAP, type Rect, type World } from '../src/light/buddy-sim';

/** Small seeded generator so a "random" run is the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M = DEFAULT_METRICS;
// platform 0 is the floor; then F (a wide footer), A (above F), C (above A), D (beside A, a hop up)
const F: Rect = { x: 100, y: 900, w: 800, h: 70 };
const A: Rect = { x: 300, y: 740, w: 300, h: 60 };
const C: Rect = { x: 350, y: 600, w: 200, h: 60 };
const D: Rect = { x: 640, y: 700, w: 160, h: 60 };
const world: World = { panels: [F, A, C, D], floor: 1000, width: 1000 };
const IF = 1;
const IA = 2;
const IC = 3;
const ID = 4;

function make(w: World = world, seed = 1): BuddySim {
  const sim = new BuddySim(mulberry32(seed));
  sim.setWorld(w);
  return sim;
}

/** Step at 60 fps for up to `seconds`, or until `until` is true (so he is not left to wander on afterwards). */
function run(sim: BuddySim, seconds: number, each?: () => void, until?: () => boolean): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.update(1 / 60);
    each?.();
    if (until?.()) return;
  }
}

/** His body box is inside a panel by more than half a pixel. */
function insidePanel(sim: BuddySim, panels: Rect[]): boolean {
  return panels.some((p) => sim.x + M.hw > p.x + 0.5 && sim.x - M.hw < p.x + p.w - 0.5 && sim.y > p.y + 0.5 && sim.y - M.bh < p.y + p.h - 0.5);
}

describe('buddy sim: solid panels', () => {
  it('stands on top of a panel, and never enters one while walking back and forth for 10 s', () => {
    const sim = make();
    sim.place(IF, 150);
    let bad = '';
    let leg = 0;
    run(sim, 10, () => {
      if (sim.platform !== IF) bad = `left the footer (mode ${sim.mode})`;
      else if (sim.y !== F.y) bad = `feet at ${sim.y}`;
      else if (insidePanel(sim, world.panels)) bad = `inside a panel at ${sim.x}`;
      if (sim.anim !== 'walk' && sim.platform === IF && !sim.busy) {
        leg++;
        sim.goTo(IF, leg % 2 ? 560 : 140);
      }
    });
    expect(bad).toBe('');
    expect(leg).toBeGreaterThan(1);
  });

  it('is stopped by a panel side on the way', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.walkTo(450); // under A, which is 100 px above: he fits; the wall of D is further right
    run(sim, 8);
    expect(sim.y).toBe(F.y);
    sim.place(IF, 650);
    sim.walkTo(850); // D hangs 140 px over this stretch, so he fits under it but the side of nothing stops him
    run(sim, 8);
    expect(insidePanel(sim, world.panels)).toBe(false);
  });

  it('walking off an edge makes him fall and land on the panel below', () => {
    const sim = make();
    sim.place(IA, 450);
    sim.goTo(IF, 150);
    let airborne = false;
    run(
      sim,
      12,
      () => {
        if (sim.mode === 'air') airborne = true;
      },
      () => airborne && sim.platform === IF,
    );
    expect(airborne).toBe(true);
    expect(sim.platform).toBe(IF);
    expect(sim.y).toBe(F.y);
  });

  it('climbs a side with at most 6 px of overlap and ends up standing on top', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.goTo(IA, 450);
    let worst = 0;
    const modes = new Set<string>();
    run(
      sim,
      40,
      () => {
        modes.add(sim.mode);
        if (sim.mode === 'climb' && sim.animTime > 0.3 && sim.y > A.y + 0.5) {
          const left = sim.x < A.x + A.w / 2;
          worst = Math.max(worst, left ? sim.x + M.climbHalf - A.x : A.x + A.w - (sim.x - M.climbHalf));
        }
      },
      () => sim.platform === IA,
    );
    expect(modes.has('climb')).toBe(true);
    expect(sim.platform).toBe(IA);
    expect(sim.y).toBe(A.y);
    expect(sim.x).toBeGreaterThanOrEqual(A.x);
    expect(sim.x).toBeLessThanOrEqual(A.x + A.w);
    expect(worst).toBeGreaterThan(OVERLAP - 1.5); // once he has settled after the catch, his hands reach 5 px into the side
    expect(worst).toBeLessThanOrEqual(6);
  });

  it('plans a route to a higher panel (climb, then climb again) and across a gap (jump)', () => {
    const up = make();
    up.place(IF, 150);
    up.goTo(IC, 450);
    run(up, 90, undefined, () => up.platform === IC);
    expect(up.platform).toBe(IC);
    expect(up.y).toBe(C.y);

    const hop = make();
    hop.place(IA, 570);
    hop.goTo(ID, 700);
    const anims = new Set<string>();
    run(hop, 20, () => anims.add(hop.anim), () => hop.platform === ID);
    expect(anims.has('jump')).toBe(true);
    expect(hop.platform).toBe(ID);
  });
});

describe('buddy sim: grab, drop and throw', () => {
  /** Distance from the hand point to the nearest pointer position seen so far. */
  const near = (sim: BuddySim, path: Array<[number, number]>): number => Math.min(...path.map(([x, y]) => Math.hypot(sim.x - x, sim.y - y)));

  it('hangs from the pointer, and lands on the panel he is let go over', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.grab(150, 850);
    const path: Array<[number, number]> = [[150, 850]];
    let worst = 0;
    for (let i = 1; i <= 90; i++) {
      const p: [number, number] = [150 + (i * 170) / 90, 850 - (i * 330) / 90];
      path.push(p);
      sim.drag(p[0], p[1]);
      sim.update(1 / 60);
      expect(sim.anim).toBe('hang');
      if (i > 20) worst = Math.max(worst, near(sim, path));
    }
    expect(worst).toBeLessThan(4);
    // let him settle (the swing dies down), then let go above A: he falls and lands on it
    for (let i = 0; i < 120; i++) {
      sim.drag(320, 520);
      sim.update(1 / 60);
    }
    sim.release();
    run(sim, 6, undefined, () => sim.platform >= 0);
    expect(sim.platform).toBe(IA);
    expect(sim.y).toBe(A.y);
  });


  it('let go over nothing, he falls to the floor', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.grab(150, 850);
    for (let i = 1; i <= 30; i++) {
      sim.drag(150 + i * 27, 300);
      sim.update(1 / 60);
    }
    for (let i = 0; i < 40; i++) {
      sim.drag(960, 300);
      sim.update(1 / 60);
    }
    sim.release();
    run(sim, 8, undefined, () => sim.platform >= 0);
    expect(sim.platform).toBe(0);
    expect(sim.y).toBe(world.floor);
  });

  it('caps the throw speed, and a thrown body does not tunnel through a thin panel', () => {
    const thin: World = { panels: [{ x: 100, y: 900, w: 300, h: 4 }], floor: 1000, width: 1000 };
    const sim = make(thin);
    sim.place(0, 250);
    sim.grab(250, 900);
    for (let i = 0; i < 90; i++) {
      sim.drag(250, 300);
      sim.update(1 / 60);
    }
    // the pointer slams downwards, far faster than the cap
    sim.drag(250, 300);
    sim.update(0.008);
    sim.drag(250, 2000);
    sim.update(0.008);
    sim.release();
    expect(Math.hypot(sim.vx, sim.vy)).toBeLessThanOrEqual(MAX_THROW + 1e-6);
    expect(Math.hypot(sim.vx, sim.vy)).toBeGreaterThan(MAX_THROW * 0.9);
    run(sim, 6, undefined, () => sim.platform >= 0);
    expect(sim.platform).toBe(1);
    expect(sim.y).toBe(900);
  });
});

describe('buddy sim: roaming', () => {
  it('120 s of seeded roaming never ends inside a panel, off the page, or with a NaN, and moves about a third of the time', () => {
    const all = new Set<string>();
    for (const seed of [42, 7, 99]) {
      const sim = make(world, seed);
      sim.place(IF, 120);
      let bad = '';
      const seen = new Set<string>();
      run(sim, 120, () => {
        seen.add(sim.anim);
        if (!Number.isFinite(sim.x) || !Number.isFinite(sim.y)) bad = 'NaN';
        else if ((sim.mode === 'ground' || sim.mode === 'air') && insidePanel(sim, world.panels)) bad = `inside a panel at ${sim.x},${sim.y} (${sim.mode})`;
        else if (sim.y > world.floor || sim.y < 0 || sim.x < 0 || sim.x > world.width) bad = `off the page at ${sim.x},${sim.y}`;
      });
      expect(bad).toBe('');
      seen.forEach((a) => all.add(a));
      const share = sim.moved / sim.total;
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.55);
    }
    expect(all.size).toBeGreaterThanOrEqual(6);
  });

  it('keeps still under reduced motion, hops on a click, and can still be grabbed', () => {
    const sim = make();
    sim.still = true;
    sim.place(IF, 120);
    run(sim, 20);
    expect(sim.x).toBe(120);
    expect(sim.anim).toBe('idle');
    sim.hop();
    run(sim, 2);
    expect(sim.platform).toBe(IF);
    expect(sim.x).toBe(120);
    sim.grab(120, 800);
    sim.update(1 / 60);
    expect(sim.held).toBe(true);
  });
});

// ------------------------------------------------------------ v3: hops, catches, climbs, the cursor, the swing

/** A world of its own: the floor, and these panels (platform 1 is the first). */
function world3(panels: Rect[], floor = 1200, width = 1200): World {
  return { panels, floor, width };
}

/** His hands are on a real side of one of these panels (within `tol` px), at this moment? */
function handsOnSide(sim: BuddySim, panels: Rect[], tol = 2): boolean {
  const yh = sim.y - M.grip;
  return panels.some((p) => yh >= p.y - tol && yh <= p.y + p.h + tol && (Math.abs(sim.x - (p.x - (M.climbHalf - OVERLAP))) <= 3 || Math.abs(sim.x - (p.x + p.w + (M.climbHalf - OVERLAP))) <= 3));
}

/** The longest free fall (from where the flight began, downwards) seen in a callback-driven run. */
class FallWatch {
  worst = 0;
  private from = NaN;
  seen(sim: BuddySim): void {
    if (sim.mode === 'air') {
      if (Number.isNaN(this.from)) this.from = sim.y;
      this.worst = Math.max(this.worst, sim.y - this.from);
    } else this.from = NaN;
  }
}

/** Keep sending him to `plat` (x) until he is standing there. */
function go(sim: BuddySim, plat: number, x: number, seconds: number, each?: () => void): boolean {
  for (let t = 0; t < seconds; t += 1 / 60) {
    if (sim.platform === plat && !sim.busy && sim.route.length === 0) return true;
    if (!sim.busy && sim.route.length === 0 && sim.platform !== plat) sim.goTo(plat, x);
    sim.update(1 / 60);
    each?.();
  }
  return sim.platform === plat;
}

describe('buddy sim v3: jumps', () => {
  it('1. crosses a 24 px gap with a small hop (apex under 45 px) and lands at least 8 px inside the other panel', () => {
    const P1: Rect = { x: 100, y: 600, w: 300, h: 60 };
    const P2: Rect = { x: 424, y: 600, w: 300, h: 60 };
    const sim = make(world3([P1, P2], 1000, 1000));
    sim.place(1, 300);
    sim.goTo(2, 600);
    let apex = 0;
    run(sim, 20, () => (apex = Math.max(apex, P1.y - sim.y)), () => sim.platform === 2);
    expect(sim.platform).toBe(2);
    expect(sim.count.jump).toBe(1);
    expect(apex).toBeGreaterThan(10);
    expect(apex).toBeLessThan(45); // the old single jump rose 96 px
    expect(sim.x).toBeGreaterThanOrEqual(P2.x + 8);
  });

  it('2. a 150 px gap needs the run-up: with 50 px of room he runs and leaps, without it the edge does not exist', () => {
    const P1: Rect = { x: 100, y: 600, w: 400, h: 60 };
    const P2: Rect = { x: 650, y: 600, w: 300, h: 60 };
    const w = world3([P1, P2], 1000, 1100);
    const sim = make(w);
    const leap = sim.planner.edges[1].find((e) => e.kind === 'jump' && e.to === 2);
    expect(leap).toBeDefined();
    expect(leap!.run).toBe(true);
    expect(Math.abs(leap!.vx)).toBeGreaterThan(130);
    sim.place(1, 150);
    sim.goTo(2, 800);
    const anims = new Set<string>();
    let fastest = 0;
    run(sim, 30, () => {
      anims.add(sim.anim);
      fastest = Math.max(fastest, Math.abs(sim.vx));
    }, () => sim.platform === 2);
    expect(sim.platform).toBe(2);
    expect(anims.has('run')).toBe(true);
    expect(fastest).toBeGreaterThan(130);
    // the same gap from a platform too short for a run-up: no jump or climb to the other side
    const narrow = make(world3([{ x: 440, y: 600, w: 60, h: 60 }, P2], 1000, 1100));
    expect(narrow.planner.edges[1].some((e) => e.to === 2 && (e.kind === 'jump' || e.kind === 'grab'))).toBe(false);
  });

  it('7. with a hop and a long climb both possible, the plan is the hop', () => {
    const P1: Rect = { x: 100, y: 600, w: 300, h: 60 };
    const P2: Rect = { x: 440, y: 510, w: 300, h: 100 }; // 90 px higher, 40 px away: a leap, or a catch of its side and a climb
    const sim = make(world3([P1, P2], 1000, 1000));
    const to2 = sim.planner.edges[1].filter((e) => e.to === 2);
    const kinds = to2.map((e) => e.kind);
    expect(kinds).toContain('jump');
    expect(kinds).toContain('grab');
    const hop = to2.filter((e) => e.kind === 'jump').sort((a, b) => a.time - b.time)[0];
    const climb = to2.filter((e) => e.kind === 'grab').sort((a, b) => a.time - b.time)[0];
    expect(hop.time).toBeLessThan(climb.time);
    const route = sim.planner.path(1, 2, 300)!;
    expect(route.length).toBe(1);
    expect(route[0].kind).toBe('jump');
  });
});

describe('buddy sim v3: catch, climb, pull up, ledge grab, wall hop, descend', () => {
  const G: Rect = { x: 100, y: 1000, w: 400, h: 60 };

  it('3. jumps out, catches the side of a ledge 96 px above with his hands, climbs, pulls up and stands on top', () => {
    const T: Rect = { x: 100, y: 800, w: 400, h: 104 }; // its bottom is 96 px above G: the footer and contact case
    const sim = make(world3([G, T]));
    sim.place(1, 300);
    sim.goTo(2, 300);
    const modes: string[] = [];
    let climbSteps = 0;
    let bad = '';
    run(sim, 40, () => {
      if (modes[modes.length - 1] !== sim.mode) modes.push(sim.mode);
      if (sim.mode === 'climb') {
        climbSteps++;
        if (!sim.hopping && !handsOnSide(sim, [T])) bad = `hands off the wall at ${sim.x.toFixed(1)},${sim.y.toFixed(1)}`;
      }
    }, () => sim.platform === 2);
    expect(bad).toBe('');
    expect(sim.platform).toBe(2);
    expect(sim.y).toBe(T.y);
    expect(climbSteps).toBeGreaterThan(30);
    expect(sim.count.grab).toBe(1);
    // he never starts a climb from the ground: jump (air), catch (climb), pull up (pull), stand (ground)
    const i = modes.indexOf('climb');
    expect(modes[i - 1]).toBe('air');
    expect(modes.slice(i, i + 3)).toEqual(['climb', 'pull', 'ground']);
  });

  it('4. two aligned sides 70 px apart: one wall hop, then a catch', () => {
    const H1: Rect = { x: 100, y: 830, w: 300, h: 100 }; // 70 px above G, and 70 px under H2: too low to stand on
    const H2: Rect = { x: 100, y: 660, w: 300, h: 100 };
    const sim = make(world3([G, H1, H2]));
    expect(sim.planner.usable(2)).toBe(false);
    sim.place(1, 300);
    sim.goTo(3, 300);
    let hops = 0;
    let wasHop = false;
    let bad = '';
    const modes: string[] = [];
    run(sim, 40, () => {
      if (sim.hopping && !wasHop) hops++;
      wasHop = sim.hopping;
      if (modes[modes.length - 1] !== sim.mode) modes.push(sim.mode);
      if (sim.mode === 'climb' && !sim.hopping && !handsOnSide(sim, [H1, H2])) bad = `hands off the wall at ${sim.x.toFixed(1)},${sim.y.toFixed(1)}`;
    }, () => sim.platform === 3);
    expect(bad).toBe('');
    expect(sim.platform).toBe(3);
    expect(sim.y).toBe(H2.y);
    expect(hops).toBe(1);
    expect(sim.count.wallHop).toBe(1);
  });

  it('5. a ledge within reach: he is in climb mode for under 0.2 s before the pull-up', () => {
    const L: Rect = { x: 100, y: 870, w: 300, h: 14 };
    const sim = make(world3([G, L]));
    sim.place(1, 300);
    sim.goTo(2, 300);
    let climbT = 0;
    run(sim, 20, () => (climbT += sim.mode === 'climb' ? 1 / 60 : 0), () => sim.platform === 2);
    expect(sim.platform).toBe(2);
    expect(sim.y).toBe(L.y);
    expect(climbT).toBeGreaterThan(0.1); // the catch itself
    expect(climbT).toBeLessThan(0.2);
  });

  it('6. he comes down the same wall: lowers himself over the edge, climbs down, and no free fall is over 120 px', () => {
    const T: Rect = { x: 100, y: 800, w: 400, h: 104 };
    const sim = make(world3([G, T]));
    sim.setDropMax(60); // no walking off the end for him: the only way down is the wall
    sim.place(2, 300);
    sim.goTo(1, 300);
    expect(sim.route.map((e) => e.kind)).toEqual(['descend']);
    const fall = new FallWatch();
    let down = false;
    let bad = '';
    run(sim, 40, () => {
      fall.seen(sim);
      if (sim.climbing === 'down') down = true;
      if (sim.mode === 'ground' || sim.mode === 'air') {
        if (over(sim, T) || over(sim, G)) bad = `inside a panel at ${sim.x.toFixed(1)},${sim.y.toFixed(1)}`;
      }
    }, () => sim.platform === 1);
    expect(bad).toBe('');
    expect(sim.platform).toBe(1);
    expect(sim.count.descend).toBe(1);
    expect(down).toBe(true);
    expect(fall.worst).toBeLessThanOrEqual(120);
    expect(fall.worst).toBeGreaterThan(5);
  });
});

function over(sim: BuddySim, p: Rect): boolean {
  return sim.x + M.hw > p.x + 0.5 && sim.x - M.hw < p.x + p.w - 0.5 && sim.y > p.y + 0.5 && sim.y - M.bh < p.y + p.h - 0.5;
}

describe('buddy sim v3: following the cursor', () => {
  /** Keep the pointer "moving" (a 2 px wobble) at (x, y) for the given seconds, or until the condition holds. */
  function hover(sim: BuddySim, x: number, y: number, seconds: number, until?: () => boolean, each?: () => void): void {
    for (let t = 0, k = 0; t < seconds; t += 1 / 60, k++) {
      if (k % 30 === 0) sim.pointer(x + ((k / 30) % 2) * 2, y, true);
      sim.update(1 / 60);
      each?.();
      if (until?.()) return;
    }
  }

  it('8. a pointer on a higher panel: he plans the way (catch, climb) and ends up on it, within 40 px of the pointer', () => {
    const sim = make();
    sim.place(IF, 150);
    expect(sim.targetFor(450, 630)).toBe(IC); // inside C
    hover(sim, 450, 630, 90, () => sim.platform === IC && Math.abs(sim.x - 450) <= 40);
    expect(sim.platform).toBe(IC);
    expect(Math.abs(sim.x - 450)).toBeLessThanOrEqual(40);
    expect(sim.count.grab).toBeGreaterThan(0);
  });

  it('9. a pointer 600 px away on his platform: he runs (over 150 px/s), ends inside the dead zone, and a pointer inside it does not move him', () => {
    const W: Rect = { x: 100, y: 600, w: 1200, h: 60 };
    const sim = make(world3([W], 1000, 1400));
    sim.place(1, 150);
    let fastest = 0;
    const anims = new Set<string>();
    hover(sim, 750, 560, 12, undefined, () => {
      fastest = Math.max(fastest, sim.speed);
      anims.add(sim.anim);
    });
    expect(fastest).toBeGreaterThan(150);
    expect(anims.has('run')).toBe(true);
    expect(anims.has('walk')).toBe(true); // he slows to a walk before he stops
    expect(Math.abs(sim.x - 750)).toBeLessThanOrEqual(36.5);
    expect(sim.anim).toBe('ready'); // cursor within 90 px: fists up
    // a pointer inside the dead zone: he stays put
    const still = make(world3([W], 1000, 1400));
    still.place(1, 500);
    hover(still, 520, 560, 6);
    expect(still.x).toBe(500);
    expect(still.speed).toBe(0);
  });

  it('10. a target he cannot reach: he goes to the nearest point and does not dither (at most two turns in 5 s)', () => {
    const L: Rect = { x: 100, y: 900, w: 300, h: 60 };
    const island: Rect = { x: 700, y: 300, w: 200, h: 60 }; // nothing leads there
    const sim = make(world3([L, island], 1200, 1200));
    sim.place(1, 200);
    expect(sim.targetFor(800, 330)).toBe(1); // the reachable spot nearest to it is the right end of L
    let turns = 0;
    let face = sim.face;
    let t = 0;
    hover(sim, 800, 330, 15, undefined, () => {
      t += 1 / 60;
      if (t <= 5 && sim.face !== face) turns++;
      face = sim.face;
    });
    expect(turns).toBeLessThanOrEqual(2);
    expect(sim.platform).toBe(1);
    expect(sim.x).toBeGreaterThan(L.x + L.w - 8 - 36.5 - 1); // as near as the dead zone lets him, at the end of L
    expect(sim.x).toBeLessThanOrEqual(L.x + L.w - 8);
  });
});

describe('buddy sim v3: held, swinging, released', () => {
  it('11. the body trails when the pointer speeds up, then swings like a pendulum (0.7 to 1.1 s) and settles', () => {
    const sim = make(world3([], 1000, 1400));
    sim.place(0, 300);
    sim.grab(300, 400);
    let px = 300;
    for (let i = 0; i < 60; i++) {
      sim.drag(px, 400);
      sim.update(1 / 60);
    }
    expect(Math.abs(sim.sway)).toBeLessThan(0.05);
    // the pointer accelerates to the right for half a second
    let v = 0;
    let minSway = 0;
    let bad = false;
    const watch = (): void => {
      if (!Number.isFinite(sim.sway) || Math.abs(sim.sway) > 1.2 + 1e-9) bad = true;
    };
    for (let i = 0; i < 30; i++) {
      v += 14;
      px += v / 60;
      sim.drag(px, 400);
      sim.update(1 / 60);
      minSway = Math.min(minSway, sim.sway);
      watch();
    }
    expect(minSway).toBeLessThan(-0.15); // trailing to the left
    // then it stops: the swing comes back over zero, with a period of about 0.9 s, and dies down
    const crossings: number[] = [];
    let prev = sim.sway;
    let late = 0;
    for (let i = 0; i < 60 * 5; i++) {
      sim.drag(px, 400);
      sim.update(1 / 60);
      watch();
      if ((prev < 0) !== (sim.sway < 0) && prev !== 0) crossings.push(i / 60);
      prev = sim.sway;
      if (i >= 60 * 4) late = Math.max(late, Math.abs(sim.sway));
    }
    expect(bad).toBe(false);
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    const half = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    expect(half * 2).toBeGreaterThan(0.7);
    expect(half * 2).toBeLessThan(1.1);
    expect(late).toBeLessThan(0.05);
  });

  it('12. let go with the hands inside a card, he arcs onto its top without a jump of more than 30 px in one step', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.grab(150, 850);
    for (let i = 0; i < 90; i++) {
      sim.drag(450, 770); // inside A (its top is at 740)
      sim.update(1 / 60);
    }
    sim.release();
    let px = sim.x;
    let py = sim.y;
    let worst = 0;
    const anims = new Set<string>();
    run(sim, 3, () => {
      worst = Math.max(worst, Math.hypot(sim.x - px, sim.y - py));
      px = sim.x;
      py = sim.y;
      anims.add(sim.anim);
    }, () => sim.platform >= 0 && !sim.busy);
    expect(sim.platform).toBe(IA);
    expect(sim.y).toBe(A.y);
    expect(worst).toBeLessThanOrEqual(30);
    expect(anims.has('jump')).toBe(true);
  });
});

// ------------------------------------------------------ v3: the real layout, planned routes

describe('buddy sim v3: the real layout (1440 wide)', () => {
  const panels: Rect[] = [
    [153, 900, 1120, 286], [153, 1282, 152, 54], [153, 1360, 357, 258], [534, 1360, 357, 206], [915, 1360, 357, 206],
    [153, 1642, 357, 206], [534, 1642, 357, 206], [915, 1642, 357, 222], [153, 1888, 142, 34], [153, 1934, 554, 66],
    [719, 1934, 554, 66], [725, 2096, 548, 270], [153, 2096, 548, 270], [153, 2462, 643, 222], [820, 2462, 453, 222],
    [153, 2780, 1120, 236], [153, 3112, 1120, 76],
  ].map(([x, y, w, h]) => ({ x, y, w, h }));
  const page: World = { panels, floor: 3212, width: 1440 };
  const TAGLINE = 1;
  const CHIP = 2;
  const CARDS = [3, 4, 5];
  const EXPERIENCE = 12;
  const EDUCATION = 13;
  const SKILLS = 14;
  const LANGUAGES = 15;
  const CONTACT = 16;
  const FOOTER = 17;

  it('buildEdges on this page stays cheap (printed)', () => {
    const plats = [{ x: 0, y: page.floor, w: page.width, h: 4000 }, ...panels];
    new Plan(plats, page.width, M); // warm up the JIT
    const t0 = performance.now();
    const plan = new Plan(plats, page.width, M);
    const ms = performance.now() - t0;
    console.log(`buildEdges on the 1440 px page: ${ms.toFixed(1)} ms (${plan.edges.reduce((n, e) => n + e.length, 0)} edges, ${plan.holds.length} holds)`);
    expect(ms).toBeLessThan(250);
  });

  it('13. from the footer he reaches the contact card, skills, languages, education, experience, the chip, the three cards and the tagline, and back, with no fall over 400 px', () => {
    const sim = make(page, 5);
    sim.place(FOOTER, 200);
    const fall = new FallWatch();
    let bad = '';
    const each = (): void => {
      fall.seen(sim);
      if (!Number.isFinite(sim.x) || !Number.isFinite(sim.y)) bad = 'NaN';
      else if ((sim.mode === 'ground' || sim.mode === 'air') && panels.some((p) => over(sim, p))) bad = `inside a panel at ${sim.x.toFixed(1)},${sim.y.toFixed(1)}`;
    };
    for (const to of [CONTACT, SKILLS, LANGUAGES, EDUCATION, EXPERIENCE, CHIP, ...CARDS, TAGLINE, FOOTER]) {
      const [lo, hi] = sim.span(to);
      const reached = go(sim, to, (lo + hi) / 2, 200, each);
      expect(bad).toBe('');
      expect(reached, `could not get to platform ${to} (stuck on ${sim.platform} at ${sim.x.toFixed(0)},${sim.y.toFixed(0)}, ${sim.mode})`).toBe(true);
      run(sim, 0.4, each);
    }
    expect(fall.worst).toBeLessThanOrEqual(400);
  });

  it('plans from the floor to the top panel and back down', () => {
    const sim = make(page, 9);
    sim.place(0, 700);
    const fall = new FallWatch();
    expect(go(sim, TAGLINE, 600, 300, () => fall.seen(sim))).toBe(true);
    expect(sim.y).toBe(panels[0].y);
    expect(sim.count.grab).toBeGreaterThan(0);
    run(sim, 0.4);
    expect(go(sim, 0, 700, 300, () => fall.seen(sim))).toBe(true);
    expect(sim.y).toBe(page.floor);
    expect(fall.worst).toBeLessThanOrEqual(400);
  });

  it('a cursor on a panel above him (the skills panel, from the footer): he climbs there and stands within 40 px of it', () => {
    const sim = make(page, 4);
    sim.place(FOOTER, 600);
    let k = 0;
    for (let t = 0; t < 120; t += 1 / 60, k++) {
      if (k % 30 === 0) sim.pointer(400 + (k / 30) % 2, 2600, true);
      sim.update(1 / 60);
      if (sim.platform === SKILLS && Math.abs(sim.x - 400) <= 40 && !sim.busy) break;
    }
    expect(sim.platform).toBe(SKILLS);
    expect(Math.abs(sim.x - 400)).toBeLessThanOrEqual(40);
    expect(sim.count.grab).toBeGreaterThan(0);
  });

  it('14. roams for 10 minutes (seeded): never inside a panel, no fall over 600 px, moves 20 to 60% of the time, and hops, catches and climbs, and descends', () => {
    const sim = make(page, 11);
    sim.place(FOOTER, 200);
    const fall = new FallWatch();
    let bad = '';
    const climbs = { up: false, down: false };
    run(sim, 600, () => {
      fall.seen(sim);
      if (sim.climbing === 'up') climbs.up = true;
      if (sim.climbing === 'down') climbs.down = true;
      if (!Number.isFinite(sim.x) || !Number.isFinite(sim.y)) bad = 'NaN';
      else if ((sim.mode === 'ground' || sim.mode === 'air') && panels.some((p) => over(sim, p))) bad = `inside a panel at ${sim.x.toFixed(1)},${sim.y.toFixed(1)} (${sim.mode})`;
      else if (sim.y > page.floor || sim.y < 0 || sim.x < 0 || sim.x > page.width) bad = `off the page at ${sim.x},${sim.y}`;
    });
    expect(bad).toBe('');
    expect(fall.worst).toBeLessThanOrEqual(600);
    const share = sim.moved / sim.total;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.6);
    expect(sim.count.jump).toBeGreaterThanOrEqual(1);
    expect(sim.count.grab).toBeGreaterThanOrEqual(1);
    expect(climbs.up).toBe(true);
    expect(sim.count.descend).toBeGreaterThanOrEqual(1);
    expect(climbs.down).toBe(true);
  });
});

// ------------------------------------------------------ the phone layout (390 wide), rects captured from the real page

describe('buddy sim: the real layout at 390 px wide (64 px sheet)', () => {
  const SMALL = { hw: 11, bh: 58, crouch: 55, climbHalf: 13, grip: 56, hang: 81, stride: { walk: 30, run: 70, climb: 27 } };
  const panels: Rect[] = [
    [24, 4550, 342, 132], [24, 4172, 342, 314], [24, 844, 342, 310], [24, 1296, 342, 258], [24, 1578, 342, 206],
    [24, 1808, 342, 206], [24, 2038, 342, 206], [24, 2268, 342, 206], [24, 2498, 342, 222], [24, 3348, 342, 258],
    [24, 3038, 342, 286], [24, 3670, 342, 256], [24, 3950, 342, 158], [24, 2790, 342, 86], [24, 2888, 342, 86],
    [24, 1218, 152, 54], [24, 2744, 142, 34],
  ].map(([x, y, w, h]) => ({ x, y, w, h }));
  const page: World = { panels, floor: 4706, width: 390 };
  const FOOTER = 1;

  function small(seed: number): BuddySim {
    const sim = new BuddySim(mulberry32(seed));
    sim.setMetrics(SMALL);
    sim.setWorld(page);
    return sim;
  }

  it('the floor under the footer is a tunnel too low to walk through: it is cut into two stretches and no route crosses it', () => {
    const plats = [{ x: 0, y: page.floor, w: page.width, h: 4000 }, ...panels];
    const plan = new Plan(plats, page.width, SMALL);
    expect(plan.floorSegs.length).toBe(2);
    expect(plan.floorSeg(12)).not.toBe(plan.floorSeg(378));
    const route = plan.path(1, 4, 80);
    expect(route).not.toBeNull();
    const down = route!.find((q) => q.to === 0)!;
    const next = route!.find((q) => q.from === 0)!;
    expect(plan.cut(down.arrX, next.x)).toBe(false);
    expect(plan.cut(12, 378)).toBe(true);
  });

  it('from the footer he reaches every standable panel and gets back, with no fall over 400 px', () => {
    const sim = small(3);
    sim.place(FOOTER, 80);
    const fall = new FallWatch();
    const reach: number[] = [];
    for (let i = 1; i <= panels.length; i++) {
      const [lo, hi] = sim.span(i);
      if (hi > lo) reach.push(i);
    }
    expect(reach.length).toBeGreaterThan(5);
    for (const to of reach) {
      if (to === FOOTER) continue;
      const [lo, hi] = sim.span(to);
      const reached = go(sim, to, (lo + hi) / 2, 240, () => fall.seen(sim));
      expect(reached, `could not get to platform ${to} (stuck on ${sim.platform} at ${sim.x.toFixed(0)},${sim.y.toFixed(0)}, ${sim.mode})`).toBe(true);
      run(sim, 0.4, () => fall.seen(sim));
      const back = go(sim, FOOTER, 80, 240, () => fall.seen(sim));
      expect(back, `could not get back to the footer from ${to}`).toBe(true);
      run(sim, 0.4, () => fall.seen(sim));
    }
    expect(fall.worst).toBeLessThanOrEqual(400);
  });
});
