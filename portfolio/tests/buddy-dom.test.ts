import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Plan } from '../src/light/buddy-plan';
import type { Metrics, Rect } from '../src/light/buddy-sim';

/** The real sheets' metrics (not DEFAULT_METRICS) on the 1440 px level of BUDDY3.md section 1. */
function metricsOf(file: string): Metrics {
  const m = JSON.parse(new TextDecoder().decode(readFileSync(new URL(`../src/light/buddy-art/${file}`, import.meta.url))));
  const a = m.animations;
  return {
    hw: m.metrics.body[0],
    bh: m.metrics.body[1],
    crouch: m.metrics.crouch,
    climbHalf: m.metrics.climbHalf,
    grip: m.metrics.grip,
    hang: m.metrics.hang,
    stride: { walk: a.walk.stride, run: a.run.stride, climb: a.climb.stride },
  };
}

const panels: Rect[] = [
  [153, 900, 1120, 286], [153, 1282, 152, 54], [153, 1360, 357, 258], [534, 1360, 357, 206], [915, 1360, 357, 206],
  [153, 1642, 357, 206], [534, 1642, 357, 206], [915, 1642, 357, 222], [153, 1888, 142, 34], [153, 1934, 554, 66],
  [719, 1934, 554, 66], [725, 2096, 548, 270], [153, 2096, 548, 270], [153, 2462, 643, 222], [820, 2462, 453, 222],
  [153, 2780, 1120, 236], [153, 3112, 1120, 76],
].map(([x, y, w, h]) => ({ x, y, w, h }));
const plats: Rect[] = [{ x: 0, y: 3212, w: 1440, h: 4000 }, ...panels];

describe.each(['sheet.json', 'sheet-sm.json'])('real manifest metrics (%s) on the 1440 px level', (file) => {
  const m = metricsOf(file);
  const plan = new Plan(plats, 1440, m);
  const TAGLINE = 1;
  const FOOTER = 17;
  // standable and not enclosed (row-2 middle card and the two list rows are boxed in by their neighbours, as in the plan)
  const standable = [TAGLINE, 2, 3, 4, 5, 8, 12, 13, 14, 15, 16, FOOTER];

  it('has the standable panels of the plan', () => {
    for (const i of standable) expect(plan.usable(i), `panel ${i}`).toBe(true);
  });

  it('spans keep both feet on the panel', () => {
    for (const i of standable) {
      const p = plats[i];
      expect(plan.lo[i]).toBeGreaterThanOrEqual(p.x);
      expect(plan.hi[i]).toBeLessThanOrEqual(p.x + p.w);
    }
  });

  it('floor to the top panel and back down, and the footer reaches every standable panel and returns', () => {
    const up = plan.path(0, TAGLINE, 700);
    expect(up, 'floor to tagline').not.toBeNull();
    expect(plan.path(TAGLINE, 0, 700), 'tagline to floor').not.toBeNull();
    for (const i of standable) {
      const x = (plan.lo[i] + plan.hi[i]) / 2;
      expect(plan.path(FOOTER, i, plan.lo[FOOTER]), `footer to ${i}`).not.toBeNull();
      expect(plan.path(i, FOOTER, x), `${i} to footer`).not.toBeNull();
    }
  });
});

describe('buddy listeners', () => {
  it('every listener that calls preventDefault is registered as not passive (Chrome logs an error otherwise)', () => {
    const src = new TextDecoder().decode(readFileSync(new URL('../src/light/buddy.ts', import.meta.url)));
    for (const type of ['pointerdown', 'contextmenu', 'touchmove', 'selectstart']) {
      const at = src.indexOf(`'${type}'`);
      expect(at, type).toBeGreaterThan(-1);
      // the call ends at the first "});" or ", false);" line after the type
      const rest = src.slice(at);
      const end = rest.search(/\}, false\);|, false\);/);
      const close = rest.search(/\n\s*\}\);\n/);
      expect(end, `${type} is passive`).toBeGreaterThan(-1);
      expect(close === -1 || end < close, `${type} is passive`).toBe(true);
    }
  });
});
