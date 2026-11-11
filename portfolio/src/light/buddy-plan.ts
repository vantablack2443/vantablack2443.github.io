/**
 * The buddy's map: which panel he can stand on, where, and how he gets from one to the next. Pure geometry and physics, no DOM,
 * no state. Platform 0 is the floor (the bottom of the page), the others are the glass panels.
 *
 * Edges are found by simulating the real collision code (`stepBody`), so what the planner says he can do is what the sim then
 * does. Four kinds: `jump` (hops and leaps, several launch speeds), `drop` (walk off an edge), `grab` (jump, catch a panel side
 * with the hands, climb the wall, pull up over the top) and `descend` (the climb in reverse, then a short fall inward).
 * The cost of an edge is in seconds, and `Plan.path` is a Dijkstra over the platforms.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the sprite sheet says about his body (sheet.json "metrics", in screen px). */
export interface Metrics {
  hw: number; // half the body width, for the collisions
  bh: number; // body height (a little shorter than the sprite)
  crouch: number; // height of the deep landing crouch
  climbHalf: number; // half the width of a climb frame (arms out)
  grip: number; // height of the higher hand above the feet while climbing
  hang: number; // feet below the joined hands while hanging
  stride: { walk: number; run: number; climb: number }; // px of travel per full cycle of the legs or arms
}

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const GRAVITY = 1400; // px/s^2
export const TERMINAL = 1100; // fastest fall, px/s
export const WALK = 70; // px/s
export const RUN = 200;
export const CLIMB = 64; // up a wall
export const CLIMB_DOWN = 110;
export const OVERLAP = 5; // how far his hands reach into a panel's side while climbing
export const INSET = 8; // a platform's standing span is this far inside its ends
export const DROP_MAX = 400; // the longest fall that is part of a planned route
export const CROUCH = 0.12; // the anticipation before a jump
export const CATCH_T = 0.14;
export const PULL_T = 0.5;
export const DOWN_T = 0.4; // lowering himself over an edge
export const LAND_T = 0.14;
export const JUMP_VY = [300, 400, 520, 620]; // launch speeds: apex 32, 57, 97, 137 px
export const JUMP_VX = [60, 110, 160, 200];
export const RUN_JUMP_VX = 130; // faster than this sideways is a running jump
export const RUN_UP = 50; // and needs this much room to run up
export const HOLD_REACH = 40; // between two holds this far apart he reaches across
export const HOLD_HOP = 120; // ... this far apart he hops (further, the chain ends)
export const CATCH_UP = 20; // the hands may catch this far above a panel's top edge (a ledge grab)
export const CATCH_DX = 8;
export const CATCH_VY: [number, number] = [-260, 300];
export const DESCEND_FALL = 120; // the free fall at the end of a descent is never longer than this
export const DESCEND_PUSH = [60, 110, 160];
export const DROP_VX = [30, 60, 110, 160];
const STEP = 3; // largest move per collision sub-step, px
export const EPS = 1e-6;
export const DT = 1 / 120; // the flight simulations and the sim's air physics use this step

/**
 * Move a body one step through the panels (plats[0] is the floor). Sub-stepped so nothing tunnels. Returns the index of the
 * platform he landed on, or -1. A panel only catches him when his centre is over its top: past the corner he slides off.
 */
export function stepBody(b: Body, dt: number, plats: Rect[], hw: number, bh: number, width: number): number {
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

export function over(b: { x: number; y: number }, p: Rect, hw: number, bh: number): boolean {
  return b.x + hw > p.x + EPS && b.x - hw < p.x + p.w - EPS && b.y > p.y + EPS && b.y - bh < p.y + p.h - EPS;
}

/** A panel side he can hold on to: the left side (`dir` 1, the panel is on his right) or the right side (`dir` -1). */
export interface Hold {
  id: number;
  plat: number;
  dir: 1 | -1;
  wall: number; // x of the side
  top: number; // the panel's top edge
  bot: number; // and its bottom edge
  xc: number; // the climb line: where his body is while his hands are on this side
  ytop: number; // the highest his hands can be (the panel top, or lower when another panel is just above the climb line)
  hmin: number; // the highest his hands may be when he catches (a little above the top: a ledge grab)
  U: number; // the lowest his hands can be: 10 px above the bottom, or higher when another panel is below
  cluster: number;
  pos: number; // index in the cluster, top (0) to bottom
  linkUp: boolean; // connected to the hold above it (a gap of at most HOLD_HOP, nothing in the way)
  stand: number; // x of the pull-up spot on the panel's top, NaN when the top is not standable
}

export interface Edge {
  kind: 'jump' | 'drop' | 'grab' | 'descend';
  from: number;
  to: number;
  x: number; // where he stands to start it
  vx: number; // jump and grab: launch speed; drop: speed past the edge; descend: the push at the end
  vy: number;
  dir: 1 | -1; // the way he heads
  run: boolean; // a running jump: starts with a run-up
  path: number[]; // grab: the holds climbed, first = expected catch; descend: the holds lowered along
  top: number; // grab and descend: x of the pull-up spot
  arrX: number; // where he stands when it is done
  time: number; // seconds, not counting the walk to x
}

interface Flight {
  plat: number; // landed on this platform, or -1
  hold: number; // caught this hold, or -1
  x: number;
  y: number;
  t: number;
}

/** Seconds to walk or run a distance on a platform (the planner's rough guess). */
export function walkTime(d: number): number {
  return d > 220 ? d / RUN + 0.3 : d / WALK;
}

/** Seconds for a hop of height h (rising to the apex). */
function hopUp(g: number): number {
  return Math.sqrt(2 * GRAVITY * (g + 12)) / GRAVITY;
}

export class Plan {
  readonly lo: number[] = [];
  readonly hi: number[] = [];
  readonly holds: Hold[] = [];
  readonly clusters: number[][] = [];
  /** The floor is cut into stretches by panels that sit lower than his height above it (a 24 px gap under a panel is no tunnel). */
  readonly floorSegs: Array<[number, number]> = [];
  readonly edges: Edge[][];
  private reachCache: Array<number[] | undefined> = [];
  private readonly b: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private readonly fp: Rect[] = [];
  private readonly fi: number[] = [];
  private readonly fh: number[] = [];
  readonly res: Flight = { plat: -1, hold: -1, x: 0, y: 0, t: 0 };

  constructor(
    readonly plats: Rect[],
    readonly width: number,
    readonly m: Metrics,
    readonly dropMax: number = DROP_MAX,
  ) {
    this.edges = plats.map(() => []);
    this.spans();
    this.makeHolds();
    this.makeEdges();
  }

  /** Which stretch of the floor x is in (-1 when none). A floor walk is only possible inside one stretch. */
  floorSeg(x: number): number {
    return this.floorSegs.findIndex(([l, r]) => x >= l - 1 && x <= r + 1);
  }

  /** True when a walk along the floor from a to b is blocked by a panel above it (both ends are on real, different stretches). */
  cut(a: number, b: number): boolean {
    const sa = this.floorSeg(a);
    const sb = this.floorSeg(b);
    return sa >= 0 && sb >= 0 && sa !== sb;
  }

  usable(i: number): boolean {
    return this.lo[i] <= this.hi[i];
  }

  /** Does his body box fit at (x, y) (feet), touching no panel? */
  fits(x: number, y: number): boolean {
    const hw = this.m.hw;
    if (x < hw - EPS || x > this.width - hw + EPS) return false;
    const b = this.b;
    b.x = x;
    b.y = y;
    for (let j = 1; j < this.plats.length; j++) if (over(b, this.plats[j], hw, this.m.bh)) return false;
    return true;
  }

  // ------------------------------------------------------------------ spans

  /** For each panel, the widest stretch of its top where he can stand: inset from both ends, and with headroom. */
  private spans(): void {
    const { plats, m } = this;
    const n = plats.length;
    const hw = m.hw;
    const bh = m.bh;
    this.lo[0] = hw;
    this.hi[0] = this.width - hw;
    let segs: Array<[number, number]> = [[hw, this.width - hw]];
    for (let j = 1; j < n; j++) {
      const q = plats[j];
      if (q.y >= plats[0].y - 0.5 || q.y + q.h <= plats[0].y - bh + 0.5) continue;
      const a = q.x - hw;
      const b = q.x + q.w + hw;
      segs = segs.flatMap(([l, r]) => (b <= l || a >= r ? [[l, r] as [number, number]] : [[l, Math.min(r, a)] as [number, number], [Math.max(l, b), r] as [number, number]]));
    }
    this.floorSegs.length = 0;
    this.floorSegs.push(...segs.filter(([l, r]) => r >= l));
    for (let i = 1; i < n; i++) {
      const p = plats[i];
      let free: Array<[number, number]> = [[p.x + INSET, p.x + p.w - INSET]];
      for (let j = 1; j < n; j++) {
        const q = plats[j];
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
  }

  // ------------------------------------------------------------------ holds

  private makeHolds(): void {
    const { plats, m } = this;
    const n = plats.length;
    const { hw, bh, grip } = m;
    const raw: Hold[] = [];
    for (let i = 1; i < n; i++) {
      const p = plats[i];
      if (p.h < 14) continue;
      for (const dir of [1, -1] as const) {
        const wall = dir === 1 ? p.x : p.x + p.w;
        const xc = Math.min(this.width - m.climbHalf, Math.max(m.climbHalf, wall - dir * (m.climbHalf - OVERLAP)));
        let ytop = p.y;
        let U = Math.min(p.y + p.h - 10, plats[0].y - grip); // and his feet stay above the floor
        let cap = -Infinity;
        for (let j = 1; j < n; j++) {
          if (j === i) continue;
          const q = plats[j];
          if (!(q.x < xc + hw - 1 && q.x + q.w > xc - hw + 1)) continue;
          if (Math.abs((dir === 1 ? q.x : q.x + q.w) - wall) <= 6) continue; // a neighbour on the same wall line: it is a hold too
          if (q.y >= p.y) U = Math.min(U, q.y - grip);
          else cap = Math.max(cap, q.y + q.h - grip + bh);
        }
        ytop = Math.max(ytop, cap);
        if (U - ytop < 4) continue;
        raw.push({ id: -1, plat: i, dir, wall, top: p.y, bot: p.y + p.h, xc, ytop, hmin: Math.max(p.y - CATCH_UP, cap), U, cluster: -1, pos: -1, linkUp: false, stand: NaN });
      }
    }
    // panel sides that line up (within 6 px) form one wall
    for (const dir of [1, -1] as const) {
      const side = raw.filter((h) => h.dir === dir).sort((a, b) => a.wall - b.wall);
      let group: Hold[] = [];
      const flush = (): void => {
        if (!group.length) return;
        group.sort((a, b) => a.top - b.top);
        const c = this.clusters.length;
        const ids: number[] = [];
        group.forEach((h, k) => {
          h.id = this.holds.length;
          h.cluster = c;
          h.pos = k;
          this.holds.push(h);
          ids.push(h.id);
        });
        this.clusters.push(ids);
        group = [];
      };
      for (const h of side) {
        if (group.length && h.wall - group[0].wall > 6) flush();
        group.push(h);
      }
      flush();
    }
    for (const ids of this.clusters) {
      for (let k = 1; k < ids.length; k++) {
        const up = this.holds[ids[k - 1]];
        const lo = this.holds[ids[k]];
        const g = lo.top - up.bot;
        if (g > HOLD_HOP) continue;
        if (g > HOLD_REACH && up.U < up.bot - 12) continue; // the hop would overshoot the hold
        // nothing else in the way of his body between the two
        let free = true;
        for (let j = 1; j < plats.length && free; j++) {
          const q = plats[j];
          if (!(q.x < lo.xc + hw - 1 && q.x + q.w > lo.xc - hw + 1)) continue;
          if (Math.abs((lo.dir === 1 ? q.x : q.x + q.w) - lo.wall) <= 6) continue;
          if (q.y + q.h > up.U + 1 && q.y < lo.ytop + grip) free = false;
        }
        lo.linkUp = free;
      }
    }
    for (const h of this.holds) {
      const A = plats[h.plat];
      if (!this.usable(h.plat)) continue;
      const sx = Math.min(this.hi[h.plat], Math.max(this.lo[h.plat], h.wall + h.dir * (hw + 10)));
      if (Math.abs(sx - h.wall) <= 80 && this.fits(sx, A.y)) h.stand = sx;
    }
  }

  /** The hold, if any, that his hands would catch at this moment in the air. */
  catchAt(x: number, y: number, vy: number, list?: ArrayLike<number>): number {
    if (vy < CATCH_VY[0] || vy > CATCH_VY[1]) return -1;
    const yh = y - this.m.grip;
    let best = -1;
    let bd = CATCH_DX + 1e-9;
    const n = list ? list.length : this.holds.length;
    for (let k = 0; k < n; k++) {
      const h = this.holds[list ? list[k] : k];
      const d = Math.abs(x - h.xc);
      if (d > bd || yh < h.hmin || yh > h.U) continue;
      bd = d;
      best = h.id;
    }
    return best;
  }

  /** The holds from `from` up to `to` along their wall, or null if they are not linked. */
  chainUp(from: number, to: number): number[] | null {
    const a = this.holds[from];
    const b = this.holds[to];
    if (a.cluster !== b.cluster || b.pos > a.pos) return null;
    const ids = this.clusters[a.cluster];
    const out = [from];
    for (let k = a.pos; k > b.pos; k--) {
      if (!this.holds[ids[k]].linkUp) return null;
      out.push(ids[k - 1]);
    }
    return out;
  }

  // ---------------------------------------------------------------- flights

  /**
   * Simulate a flight from the feet at (x, y). Stops at a landing or (when `catching`) at a catch; the result is in `res`.
   * `push` (a descent) is a sideways speed he gets once his head is below `pushY`: against a wall he could not use it before.
   * Only the panels and holds near the arc are looked at, which keeps the planner fast.
   */
  flight(x: number, y: number, vx: number, vy: number, catching: boolean, push = 0, pushY = 0): Flight {
    const { plats, m, res } = this;
    const hw = m.hw;
    const bh = m.bh;
    const xr = Math.abs(vx) * 1.8 + hw + 6;
    const yTop = y - (vy < 0 ? (vy * vy) / (2 * GRAVITY) : 0) - bh - 8;
    const yBot = y + this.dropMax + 80;
    this.fp.length = 0;
    this.fi.length = 0;
    this.fh.length = 0;
    this.fp.push(plats[0]);
    this.fi.push(0);
    for (let j = 1; j < plats.length; j++) {
      const p = plats[j];
      if (p.x < x + xr && p.x + p.w > x - xr && p.y + p.h > yTop && p.y < yBot) {
        this.fp.push(p);
        this.fi.push(j);
      }
    }
    if (catching)
      for (const h of this.holds) if (h.xc > x - xr - CATCH_DX && h.xc < x + xr + CATCH_DX && h.U + m.grip >= yTop && h.hmin + m.grip <= yBot) this.fh.push(h.id);
    const b = this.b;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    res.plat = -1;
    res.hold = -1;
    for (let i = 0; i < 240; i++) {
      b.vy = Math.min(TERMINAL, b.vy + GRAVITY * DT);
      const j = stepBody(b, DT, this.fp, hw, bh, this.width);
      if (j >= 0) {
        res.plat = this.fi[j];
        res.x = b.x;
        res.y = b.y;
        res.t = (i + 1) * DT;
        return res;
      }
      if (push !== 0 && b.y - bh >= pushY) {
        b.vx = push;
        push = 0;
      }
      if (catching && this.fh.length) {
        const h = this.catchAt(b.x, b.y, b.vy, this.fh);
        if (h >= 0) {
          res.hold = h;
          res.x = b.x;
          res.y = b.y;
          res.t = (i + 1) * DT;
          return res;
        }
      }
      if (b.y > y + this.dropMax + 60) break;
    }
    return res;
  }

  // ------------------------------------------------------------------ edges

  private add(map: Map<string, Edge>, e: Edge): void {
    const side = e.x < (this.plats[e.from].x + this.plats[e.from].w / 2) ? 0 : 1;
    const key = `${e.kind}:${e.to}:${side}`;
    const o = map.get(key);
    // the gentlest launch that works wins (lowest vy, then lowest |vx|), the quickest among equals
    const rank = (v: Edge): number => Math.abs(v.vy) * 1e3 + Math.abs(v.vx) * 5 + v.time;
    if (!o || rank(e) < rank(o)) map.set(key, e);
  }

  private makeEdges(): void {
    const { plats, m } = this;
    const n = plats.length;
    const hw = m.hw;
    const grip = m.grip;
    for (let b = 0; b < n; b++) {
      if (!this.usable(b)) continue;
      const B = plats[b];
      const map = new Map<string, Edge>();
      // ---- jumps and grabs
      const spots: number[] = [];
      const seen = new Set<number>();
      const push = (x: number): void => {
        const k = Math.round(x);
        if (seen.has(k) || x < this.lo[b] - EPS || x > this.hi[b] + EPS || !this.fits(x, B.y)) return;
        seen.add(k);
        spots.push(x);
      };
      if (b > 0) {
        push(this.lo[b]);
        push(this.hi[b]);
      }
      for (const h of this.holds) {
        if (h.plat === b || h.bot > B.y + 10 || h.bot < B.y - 300) continue;
        push(h.xc);
        push(h.wall - h.dir * (hw + 1));
      }
      for (const x of spots) {
        for (const vy of JUMP_VY) {
          for (let k = -JUMP_VX.length; k <= JUMP_VX.length; k++) {
            const vx = k === 0 ? 0 : Math.sign(k) * JUMP_VX[Math.abs(k) - 1];
            const dir = (vx === 0 ? 1 : Math.sign(vx)) as 1 | -1;
            const run = Math.abs(vx) > RUN_JUMP_VX;
            if (run && (x - dir * RUN_UP < this.lo[b] - EPS || x - dir * RUN_UP > this.hi[b] + EPS)) continue;
            const f = this.flight(x, B.y, vx, -vy, true);
            const pre = run ? 0 : CROUCH;
            if (f.plat >= 0) {
              const j = f.plat;
              if (j === b || !this.usable(j) || f.y - B.y > this.dropMax) continue;
              if (f.x < this.lo[j] || f.x > this.hi[j]) continue;
              this.add(map, { kind: 'jump', from: b, to: j, x, vx, vy: -vy, dir, run, path: [], top: 0, arrX: f.x, time: pre + f.t + LAND_T });
            } else if (f.hold >= 0) {
              const h0 = this.holds[f.hold];
              const L = this.clusters[h0.cluster];
              const cy0 = Math.min(h0.U, Math.max(h0.ytop, f.y - grip));
              const path = [h0.id];
              for (let k2 = h0.pos; k2 >= 0; k2--) {
                const H = this.holds[L[k2]];
                if (k2 < h0.pos) {
                  if (!this.holds[L[k2 + 1]].linkUp) break;
                  path.push(H.id);
                }
                if (Number.isNaN(H.stand) || H.plat === b) continue;
                const t = pre + f.t + CATCH_T + this.upTime(path, cy0) + PULL_T + LAND_T;
                this.add(map, { kind: 'grab', from: b, to: H.plat, x, vx, vy: -vy, dir, run, path: path.slice(), top: H.stand, arrX: H.stand, time: t });
              }
            }
          }
        }
      }
      // ---- drops: walk off an end
      if (b > 0) {
        for (const dir of [-1, 1] as const) {
          const x = dir === -1 ? B.x - 1 : B.x + B.w + 1;
          if (!this.fits(x, B.y)) continue;
          for (const s of DROP_VX) {
            const f = this.flight(x, B.y, dir * s, 0, false);
            const j = f.plat;
            if (j < 0 || j === b || !this.usable(j) || f.y - B.y > this.dropMax) continue;
            if (f.x < this.lo[j] || f.x > this.hi[j]) continue;
            this.add(map, { kind: 'drop', from: b, to: j, x, vx: dir * s, vy: 0, dir, run: false, path: [], top: 0, arrX: f.x, time: f.t + LAND_T });
          }
        }
      }
      // ---- descents: over the edge, down the wall, let go
      for (const h of this.holds) {
        if (h.plat !== b || Number.isNaN(h.stand)) continue;
        const L = this.clusters[h.cluster];
        const path = [h.id];
        for (let k = h.pos; k < L.length; k++) {
          if (k > h.pos) {
            if (!this.holds[L[k]].linkUp) break;
            path.push(L[k]);
          }
          const Q = this.holds[L[k]];
          const y0 = Q.U + grip;
          const x0 = this.letGoX(Q);
          for (const push2 of DESCEND_PUSH) {
            const f = this.flight(x0, y0, 0, 0, false, Q.dir * push2, Q.bot);
            const j = f.plat;
            if (j < 0 || j === b || !this.usable(j) || f.y - y0 > DESCEND_FALL) continue;
            if (f.x < this.lo[j] - 10 || f.x > this.hi[j] + 10) continue; // he slides the last few px in after landing
            const t = DOWN_T + this.downTime(path) + f.t + LAND_T;
            this.add(map, { kind: 'descend', from: b, to: j, x: h.stand, vx: Q.dir * push2, vy: 0, dir: Q.dir, run: false, path: path.slice(), top: h.stand, arrX: Math.min(this.hi[j], Math.max(this.lo[j], f.x)), time: t });
            break;
          }
        }
      }
      for (const e of map.values()) this.edges[b].push(e);
    }
  }

  /** Where he lets go of a hold: pressed against the side, not overlapping it (the climb line overlaps a little for the hands). */
  letGoX(h: Hold): number {
    return h.dir === 1 ? Math.min(h.xc, h.wall - this.m.hw) : Math.max(h.xc, h.wall + this.m.hw);
  }

  /** Seconds to climb up the wall through these holds, with the hands starting at cy0. */
  private upTime(path: number[], cy0: number): number {
    let t = 0;
    let cy = cy0;
    for (let i = 0; i < path.length - 1; i++) {
      const h = this.holds[path[i]];
      const nx = this.holds[path[i + 1]];
      const g = h.top - nx.bot;
      if (g <= HOLD_REACH) {
        t += Math.max(0, cy - nx.U) / CLIMB;
        cy = Math.min(cy, nx.U);
      } else {
        t += Math.max(0, cy - h.ytop) / CLIMB + hopUp(g) * 2 + CATCH_T;
        cy = nx.bot - 12;
      }
    }
    const last = this.holds[path[path.length - 1]];
    return t + Math.max(0, cy - last.ytop) / CLIMB;
  }

  /** Seconds to lower himself down the wall through these holds, from the first hold's top to the last hold's lowest point. */
  private downTime(path: number[]): number {
    let t = 0;
    let cy = this.holds[path[0]].ytop;
    for (let i = 0; i < path.length; i++) {
      const h = this.holds[path[i]];
      if (i === path.length - 1) {
        t += Math.max(0, h.U - cy) / CLIMB_DOWN;
        break;
      }
      const nx = this.holds[path[i + 1]];
      const g = nx.top - h.bot;
      if (g <= HOLD_REACH) {
        t += Math.max(0, nx.ytop - cy) / CLIMB_DOWN;
        cy = nx.ytop;
      } else {
        t += Math.max(0, h.U - cy) / CLIMB_DOWN + (nx.ytop - h.U) / 300 + 0.1 + CATCH_T;
        cy = nx.ytop + 2;
      }
    }
    return t;
  }

  // ------------------------------------------------------------------ search

  /** The quickest chain of edges (in seconds) from platform `from`, standing at x0, to `to`; null when there is none. */
  path(from: number, to: number, x0: number): Edge[] | null {
    const n = this.plats.length;
    if (from === to) return [];
    const dist = new Float64Array(n).fill(Infinity);
    const pos = new Float64Array(n);
    const prev: Array<Edge | null> = new Array(n).fill(null);
    const done = new Uint8Array(n);
    dist[from] = 0;
    pos[from] = x0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const e of this.edges[u]) {
        if (u === 0 && this.cut(pos[u], e.x)) continue; // the floor is cut in two under a panel
        const c = dist[u] + walkTime(Math.abs(pos[u] - e.x)) + (e.run ? 0.25 : 0) + e.time;
        if (c < dist[e.to]) {
          dist[e.to] = c;
          pos[e.to] = e.arrX;
          prev[e.to] = e;
        }
      }
    }
    if (!prev[to]) return null;
    const out: Edge[] = [];
    for (let at = to; at !== from; ) {
      const e = prev[at];
      if (!e) return null;
      out.unshift(e);
      at = e.from;
    }
    return out;
  }

  /** Every platform reachable from `from` (not counting itself). */
  reach(from: number): number[] {
    let r = this.reachCache[from];
    if (r) return r;
    const seen = new Set<number>([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++)
      for (const e of this.edges[queue[i]]) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    seen.delete(from);
    r = [...seen];
    this.reachCache[from] = r;
    return r;
  }
}
