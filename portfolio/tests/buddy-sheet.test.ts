/**
 * The buddy's sprite sheet manifests (v3) and pixels, built by scripts/buddy_sheet.py.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sheet from '../src/light/buddy-art/sheet.json';
import sheetSm from '../src/light/buddy-art/sheet-sm.json';

interface Png {
  w: number;
  h: number;
  px: Uint8Array;
}

/** Decode a PNG (RGBA, 8 bit, no interlace: what Pillow writes). */
function decode(file: string): Png {
  const buf = readFileSync(new URL(`../src/light/buddy-art/${file}`, import.meta.url));
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
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
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
      px[y * stride + x] = (r + p) & 255;
    }
  }
  return { w, h, px };
}

function colours(png: Png): Set<string> {
  const set = new Set<string>();
  let soft = 0;
  for (let i = 0; i < png.px.length; i += 4) {
    const a = png.px[i + 3];
    if (a !== 0 && a !== 255) soft++;
    if (a) set.add(`${png.px[i]},${png.px[i + 1]},${png.px[i + 2]}`);
  }
  expect(soft).toBe(0); // alpha is 0 or 255: crisp pixels
  return set;
}

const names = ['idle', 'ready', 'walk', 'run', 'jump', 'fall', 'land', 'hang', 'climb'];
const counts: Record<string, number> = { idle: 1, ready: 1, walk: 4, run: 4, jump: 3, fall: 2, land: 1, hang: 6, climb: 6 };

describe('sprite sheet manifests (v3)', () => {
  for (const [name, file, s] of [
    ['sheet', 'sheet.png', sheet],
    ['sheet-sm', 'sheet-sm.png', sheetSm],
  ] as const) {
    describe(name, () => {
      const png = decode(file);

      it('is version 3 with a square cell, the origin in its centre, and the right size', () => {
        expect(s.version).toBe(3);
        expect(s.cell[0]).toBe(s.cell[1]);
        expect(s.origin).toEqual([s.cell[0] / 2, s.cell[1] / 2]);
        expect(s.size).toEqual([png.w, png.h]);
      });

      it('has every animation with its frame count and one duration per frame', () => {
        expect(Object.keys(s.animations).sort()).toEqual([...names].sort());
        for (const [k, a] of Object.entries(s.animations)) {
          expect(a.frames.length).toBe(counts[k]);
          expect(a.ms.length).toBe(a.frames.length);
        }
        const strides = s.animations as unknown as Record<string, { stride?: number }>;
        for (const k of ['walk', 'run', 'climb']) expect(strides[k].stride).toBeGreaterThan(0);
      });

      it('has frames inside the sheet and anchors inside their frames', () => {
        for (const [k, a] of Object.entries(s.animations)) {
          for (const f of a.frames) {
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.x + f.w).toBeLessThanOrEqual(s.size[0]);
            expect(f.y + f.h).toBeLessThanOrEqual(s.size[1]);
            expect(f.ax).toBeGreaterThanOrEqual(0);
            expect(f.ax).toBeLessThanOrEqual(f.w);
            expect(f.ay).toBeGreaterThanOrEqual(0);
            expect(f.ay).toBeLessThanOrEqual(f.h);
            // the frame fits the cell around its anchor
            expect(f.ax).toBeLessThanOrEqual(s.origin[0]);
            expect(f.w - f.ax).toBeLessThanOrEqual(s.cell[0] - s.origin[0]);
            if (k === 'climb') {
              const g = f as { gx?: number; gy?: number };
              expect(g.gx).toBeDefined();
              expect(g.gy! <= f.ay).toBe(true);
            }
          }
          // the ground anchor of a ground animation is the line under the feet
          if (a.anchor === 'ground') for (const f of a.frames) expect(f.ay).toBe(f.h);
        }
      });

      it('has a collision body 0.9 times the sprite height, shorter than the sprite', () => {
        expect(s.metrics.body[1]).toBe(Math.round(0.9 * s.metrics.height));
        expect(s.metrics.body[0]).toBeGreaterThan(0);
        expect(s.metrics.crouch).toBeGreaterThan(0);
        expect(s.metrics.crouch).toBeLessThan(s.metrics.height);
      });

      it('has crisp pixels and no cut-off limb: no frame has a long opaque run along its first or last column', () => {
        colours(png);
        for (const [k, a] of Object.entries(s.animations)) {
          for (const [i, f] of a.frames.entries()) {
            for (const col of [f.x, f.x + f.w - 1]) {
              let n = 0;
              for (let y = f.y; y < f.y + f.h; y++) if (png.px[(y * png.w + col) * 4 + 3]) n++;
              expect(n / f.h, `${k}[${i}] column ${col - f.x}`).toBeLessThanOrEqual(0.4);
            }
          }
        }
      });
    });
  }

  it('standing height is 80 px (64 px in the small sheet), and the two sheets share one palette of at most 48 colours', () => {
    expect(sheet.metrics.height).toBe(80);
    expect(sheetSm.metrics.height).toBe(64);
    const big = colours(decode('sheet.png'));
    const small = colours(decode('sheet-sm.png'));
    expect(big.size).toBeLessThanOrEqual(48);
    expect(big.size).toBe(sheet.palette);
    for (const c of small) expect(big.has(c)).toBe(true);
  });
});
