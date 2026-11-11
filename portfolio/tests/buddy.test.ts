/**
 * The buddy's sim on fake panels (no DOM), and the sprite sheet manifests.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sheet from '../public/buddy/sheet.json';
import sheetSm from '../public/buddy/sheet-sm.json';
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
        if ((sim.mode === 'climb' || sim.mode === 'pull') && sim.y > A.y + 0.5) {
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
    expect(worst).toBeGreaterThan(OVERLAP - 1.5);
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
    // let go above A: he falls and lands on it
    sim.release();
    run(sim, 6, undefined, () => sim.platform >= 0);
    expect(sim.platform).toBe(IA);
    expect(sim.y).toBe(A.y);
  });

  it('let go with the hands inside a panel, he is put on top of that panel', () => {
    const sim = make();
    sim.place(IF, 150);
    sim.grab(150, 850);
    for (let i = 0; i < 60; i++) {
      sim.drag(450, 770); // inside A (its top is at 740)
      sim.update(1 / 60);
    }
    sim.release();
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

describe('buddy sim: the real page layout (1440 wide)', () => {
  const panels: Rect[] = [
    [153, 900, 1120, 286], [153, 1282, 152, 54], [153, 1360, 357, 258], [534, 1360, 357, 206], [915, 1360, 357, 206],
    [153, 1642, 357, 206], [534, 1642, 357, 206], [915, 1642, 357, 222], [153, 1888, 142, 34], [153, 1934, 554, 66],
    [719, 1934, 554, 66], [725, 2096, 548, 270], [153, 2096, 548, 270], [153, 2462, 643, 222], [820, 2462, 453, 222],
    [153, 2780, 1120, 236], [153, 3112, 1120, 76],
  ].map(([x, y, w, h]) => ({ x, y, w, h }));
  const page: World = { panels, floor: 3212, width: 1440 };
  const footer = panels.length; // the last panel

  it('he can get from the footer up to the first project card and back down', () => {
    const sim = make(page, 3);
    sim.place(footer, 200);
    sim.goTo(3, 300); // the first card
    run(sim, 400, undefined, () => sim.platform === 3);
    expect(sim.platform).toBe(3);
    expect(sim.y).toBe(panels[2].y);
    run(sim, 0.5); // let him recover from the pull-up
    sim.goTo(footer, 400);
    run(sim, 400, undefined, () => sim.platform === footer);
    expect(sim.platform).toBe(footer);
  });

  it('roams the whole page for 10 minutes without ever being inside a panel', () => {
    const sim = make(page, 11);
    sim.place(footer, 200);
    let bad = '';
    const seen = new Set<number>();
    run(sim, 600, () => {
      if (sim.platform >= 0) seen.add(sim.platform);
      if (!Number.isFinite(sim.x) || !Number.isFinite(sim.y)) bad = 'NaN';
      else if ((sim.mode === 'ground' || sim.mode === 'air') && insidePanel(sim, panels)) bad = `inside a panel at ${sim.x},${sim.y}`;
      else if (sim.y > page.floor || sim.y < 0 || sim.x < 0 || sim.x > page.width) bad = `off the page at ${sim.x},${sim.y}`;
    });
    expect(bad).toBe('');
    expect(seen.size).toBeGreaterThan(3);
    const share = sim.moved / sim.total;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.55);
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

// ------------------------------------------------------------------ the sheets

/** The distinct opaque colours of a PNG (RGBA, 8 bit, no interlace: what Pillow writes). */
function colours(file: string): Set<string> {
  const buf = readFileSync(new URL(`../public/buddy/${file}`, import.meta.url));
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let w = 0;
  let h = 0;
  const parts: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = v.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    if (type === 'IHDR') {
      w = v.getUint32(pos + 8);
      h = v.getUint32(pos + 12);
      expect(buf[pos + 16]).toBe(8);
      expect(buf[pos + 17]).toBe(6); // RGBA
    } else if (type === 'IDAT') parts.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const z = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    z.set(p, o);
    o += p.length;
  }
  const raw = inflateSync(z);
  const stride = w * 4;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const r = raw[y * (stride + 1) + 1 + x];
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (r + p) & 255;
    }
  }
  const set = new Set<string>();
  let soft = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] !== 0 && out[i + 3] !== 255) soft++;
    if (out[i + 3]) set.add(`${out[i]},${out[i + 1]},${out[i + 2]}`);
  }
  expect(soft).toBe(0); // alpha is 0 or 255: crisp pixels
  return set;
}

describe('sprite sheet manifests', () => {
  const need = ['idle', 'walk', 'guard', 'jump', 'fall', 'land', 'hang', 'climb'];
  const counts: Record<string, number> = { idle: 4, walk: 6, guard: 3, jump: 3, fall: 1, land: 2, hang: 6, climb: 6 };

  for (const [name, s] of [['sheet', sheet], ['sheet-sm', sheetSm]] as const) {
    it(`${name}: every animation is there, frames are inside the sheet, anchors inside their frames`, () => {
      expect(Object.keys(s.animations).sort()).toEqual([...need].sort());
      const [sw, sh] = s.size;
      for (const [k, a] of Object.entries(s.animations)) {
        expect(a.frames.length).toBe(counts[k]);
        expect(a.ms.length).toBe(a.frames.length);
        for (const f of a.frames) {
          expect(f.x).toBeGreaterThanOrEqual(0);
          expect(f.y).toBeGreaterThanOrEqual(0);
          expect(f.x + f.w).toBeLessThanOrEqual(sw);
          expect(f.y + f.h).toBeLessThanOrEqual(sh);
          expect(f.ax).toBeGreaterThanOrEqual(0);
          expect(f.ax).toBeLessThanOrEqual(f.w);
          expect(f.ay).toBeGreaterThanOrEqual(0);
          expect(f.ay).toBeLessThanOrEqual(f.h);
          if (k === 'climb') {
            const g = f as { gx?: number; gy?: number };
            expect(g.gx).toBeDefined();
            expect(g.gy! <= f.ay).toBe(true);
          }
        }
        // the ground anchor of a ground animation is the line under the feet
        if (a.anchor === 'ground') for (const f of a.frames) expect(f.ay).toBe(f.h);
      }
      expect(s.cell[0]).toBeGreaterThan(0);
      expect(s.origin[0]).toBeLessThan(s.cell[0]);
    });
  }

  it('standing height is 80 px (64 px in the small sheet), and the two sheets share one palette of at most 48 colours', () => {
    expect(sheet.metrics.body[1]).toBe(80);
    expect(sheetSm.metrics.body[1]).toBe(64);
    const big = colours('sheet.png');
    const small = colours('sheet-sm.png');
    expect(big.size).toBeLessThanOrEqual(48);
    expect(big.size).toBe(sheet.palette);
    for (const c of small) expect(big.has(c)).toBe(true);
  });

  it('the sim defaults match the sheet it is drawn with', () => {
    expect(M.hw).toBe(sheet.metrics.body[0] - 2);
    expect(M.bh).toBe(sheet.metrics.body[1]);
    expect(M.climbHalf).toBe(sheet.metrics.climbHalf);
    expect(M.grip).toBe(sheet.metrics.grip);
    expect(M.hang).toBe(sheet.metrics.hang);
  });
});
