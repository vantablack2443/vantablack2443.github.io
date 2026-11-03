/**
 * layout.ts — single source of truth.
 *
 * Every content element's rectangle (DOM) and every physics shape (colliders)
 * is defined here, in LOGICAL units on a fixed 600 x 940 stage (the playfield
 * plus the apron; the backglass lives in the left HTML panel, not on the stage). The DOM is
 * positioned from `rects`; the physics world is built from the same numbers
 * (see game/physics.ts). Nothing here touches the DOM, so tests can import it.
 */

export const STAGE_W = 600;
export const STAGE_H = 940;

/** Physics works in metres; one metre is this many logical pixels. */
export const PX_PER_M = 50;
export const toM = (px: number): number => px / PX_PER_M;
export const toPx = (m: number): number => m * PX_PER_M;

export type Pt = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Basic table geometry                                                */
/* ------------------------------------------------------------------ */

export const WALL_L = 20; // playfield left wall
export const WALL_R = 540; // playfield right wall == plunger lane left wall
export const LANE_R = 580; // plunger lane right wall
export const TOP_Y = 16; // underside of the top arch (16 px of headroom for the rail stroke)
export const ARC_R = 100; // radius of the two top corners
export const MID_X = (WALL_L + WALL_R) / 2; // 280, centre of the playfield
export const APRON_Y = 840;
export const LANE_FLOOR_Y = 915;
export const BALL_R = 11;

/** Mirror an x coordinate around the playfield centre line. */
export const mx = (x: number): number => 2 * MID_X - x;

/** Sample an arc (screen coordinates, y down) into a polyline. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, segs: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Flippers                                                            */
/* ------------------------------------------------------------------ */

export interface FlipperDef {
  side: 'left' | 'right';
  pivot: Pt;
  length: number;
  baseR: number; // half thickness at the pivot
  tipR: number; // half thickness at the tip
  /** Rest angle of the flipper (radians, direction pivot -> tip, y down). */
  restAngle: number;
  /** Raised angle of the flipper. */
  upAngle: number;
}

const DEG = Math.PI / 180;
const FL_REST = 32 * DEG; // tip points 32 degrees below horizontal at rest
const FL_UP = 14 * DEG; // tip points 14 degrees above horizontal when raised

export const FLIPPERS: Record<'left' | 'right', FlipperDef> = {
  left: {
    side: 'left',
    pivot: [176, 775],
    length: 88,
    baseR: 10,
    tipR: 6,
    restAngle: FL_REST,
    upAngle: -FL_UP,
  },
  right: {
    side: 'right',
    pivot: [mx(176), 775],
    length: 88,
    baseR: 10,
    tipR: 6,
    // The right flipper is built mirrored (extends along local -x), so its
    // body angle is the negative of the "direction" angle used above.
    restAngle: -FL_REST,
    upAngle: FL_UP,
  },
};

/* ------------------------------------------------------------------ */
/* Walls, rails, guides                                                */
/* ------------------------------------------------------------------ */

const SLING_TOP = 618;
const SLING_BOTTOM = 724;

/**
 * The funnel leading into the left flipper lies exactly on the extension of
 * the flipper's resting top surface (the tangent line of its two end circles),
 * so a ball rolls from funnel onto blade with no lip to get wedged against.
 */
function funnelLeft(): { start: Pt; end: Pt } {
  const f = FLIPPERS.left;
  const phi = f.restAngle + Math.atan2(f.baseR - f.tipR, f.length); // direction of the top face
  const end: Pt = [f.pivot[0] + Math.sin(phi) * f.baseR, f.pivot[1] - Math.cos(phi) * f.baseR];
  const startX = 128;
  const startY = end[1] - Math.tan(phi) * (end[0] - startX);
  return { start: [startX, startY], end };
}
const FUNNEL_L = funnelLeft();
const SLING_R: Pt = FUNNEL_L.start;

const leftArc = arc(WALL_L + ARC_R, TOP_Y + ARC_R, ARC_R, Math.PI, 1.5 * Math.PI, 16);
const rightArc = arc(LANE_R - ARC_R, TOP_Y + ARC_R, ARC_R, 1.5 * Math.PI, 2 * Math.PI, 16);

/** Left wall: from the apron (so a ball in the drain basin cannot slip out sideways) up to the arch. */
export const OUTER_LEFT: Pt[] = [
  [WALL_L, APRON_Y],
  [WALL_L, TOP_Y + ARC_R],
];
/** The top arch: rounded corners and the flat roof. Livelier physics tuning lives in physics.ts. */
export const OUTER_ARCH: Pt[] = [...leftArc, ...rightArc.slice(1)];
/** Right wall of the plunger lane and the lane floor. */
export const OUTER_RIGHT: Pt[] = [
  [LANE_R, TOP_Y + ARC_R],
  [LANE_R, LANE_FLOOR_Y],
  [WALL_R, LANE_FLOOR_Y],
];

/** The outer shell as one polyline (for drawing). */
export const OUTER_WALL: Pt[] = [...OUTER_LEFT, ...OUTER_ARCH.slice(1), ...OUTER_RIGHT.slice(1)];

/**
 * x = 540 wall. Child edge 0 (y 190 -> 300) is the ONE-WAY GATE: the ball may
 * leave the plunger lane through it but may not come back. Child edge 1 is the
 * ordinary lane wall.
 */
export const GATE_TOP_Y = 30;
export const GATE_BOTTOM_Y = 140;
export const LANE_WALL: Pt[] = [
  [WALL_R, GATE_TOP_Y],
  [WALL_R, GATE_BOTTOM_Y],
  [WALL_R, LANE_FLOOR_Y],
];

export const FUNNELS: Pt[][] = [
  [FUNNEL_L.start, FUNNEL_L.end],
  [
    [mx(FUNNEL_L.start[0]), FUNNEL_L.start[1]],
    [mx(FUNNEL_L.end[0]), FUNNEL_L.end[1]],
  ],
];

export interface SlingDef {
  id: 'sling-left' | 'sling-right';
  pts: Pt[]; // triangle
  /** Index of the kicker edge: from pts[0] to pts[2]. */
  kickerFrom: Pt;
  kickerTo: Pt;
  /** Unit normal of the kicker edge, pointing into the playfield. */
  normal: Pt;
}

function slingDef(id: SlingDef['id'], mirror: boolean): SlingDef {
  const f = (x: number): number => (mirror ? mx(x) : x);
  const T: Pt = [f(WALL_L), SLING_TOP];
  const B: Pt = [f(WALL_L), SLING_BOTTOM];
  const R: Pt = [f(SLING_R[0]), SLING_R[1]];
  const dx = R[0] - T[0];
  const dy = R[1] - T[1];
  const len = Math.hypot(dx, dy);
  // normal that points up/inwards (towards the playfield)
  let nx = dy / len;
  let ny = -dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { id, pts: [T, B, R], kickerFrom: T, kickerTo: R, normal: [nx, ny] };
}

export const SLINGS: SlingDef[] = [slingDef('sling-left', false), slingDef('sling-right', true)];

/** Rollover lane guides (thin posts) and the lane sensors between them. */
export const LANE_GUIDE_XS = [164, 222, 280, 338, 396];
export const LANE_GUIDE_Y0 = 55;
export const LANE_GUIDE_Y1 = 125;
export const LANE_IDS = ['lane-en', 'lane-de', 'lane-ml', 'lane-hi'] as const;
export const LANE_SENSORS: { id: string; rect: Rect }[] = LANE_IDS.map((id, i) => {
  const cx = (LANE_GUIDE_XS[i] + LANE_GUIDE_XS[i + 1]) / 2;
  return { id, rect: { x: cx - 20, y: 73, w: 40, h: 34 } };
});

/* ------------------------------------------------------------------ */
/* Pop bumpers                                                         */
/* ------------------------------------------------------------------ */

export const BUMPER_R = 30;
export const BUMPERS: { id: string; x: number; y: number }[] = [
  { id: 'bumper-python', x: 125, y: 185 },
  { id: 'bumper-c', x: 280, y: 220 },
  { id: 'bumper-java', x: 435, y: 185 },
  { id: 'bumper-kotlin', x: 185, y: 270 },
  { id: 'bumper-rust', x: 375, y: 270 },
];

/* ------------------------------------------------------------------ */
/* Project cards                                                       */
/* ------------------------------------------------------------------ */

export const CARD_W = 210;
export const CARD_H = 84;
/** 26 px side corridors, a 48 px centre gap the ball can shoot up through. */
const CARD_COLS = [46, 304];
const CARD_ROWS = [332, 428, 524];
export const CARD_IDS = [
  'card-orion',
  'card-saardew',
  'card-2048',
  'card-pagerank',
  'card-edge',
  'card-mips',
] as const;

/** Chamfer sizes in px, clockwise from the top-left corner: [TL, TR, BR, BL]. */
export type Chamfer = readonly [number, number, number, number];

export interface CardDef {
  id: string;
  rect: Rect;
  row: number;
  col: number;
  chamfer: Chamfer;
}

export const CARDS: CardDef[] = CARD_IDS.map((id, i) => {
  const row = Math.floor(i / 2);
  const col = i % 2;
  const base = 10;
  // The bottom row's two inner corners get big chamfers that funnel a ball
  // shot up from the flippers into the centre gap.
  const funnel = 24;
  const chamfer: [number, number, number, number] = [base, base, base, base];
  if (row === 2) {
    if (col === 0) chamfer[2] = funnel;
    else chamfer[3] = funnel;
  }
  return { id, row, col, chamfer, rect: { x: CARD_COLS[col], y: CARD_ROWS[row], w: CARD_W, h: CARD_H } };
});

/** The chamfered outline of a card (clockwise from top-left, 8 vertices). Used for the CSS clip-path too. */
export function cardOutline(c: CardDef): Pt[] {
  const { x, y, w, h } = c.rect;
  const [tl, tr, br, bl] = c.chamfer;
  return [
    [x + tl, y],
    [x + w - tr, y],
    [x + w, y + tr],
    [x + w, y + h - br],
    [x + w - br, y + h],
    [x + bl, y + h],
    [x, y + h - bl],
    [x, y + tl],
  ];
}

/**
 * Collider for a card: the outline, except the top face is a very shallow
 * roof (apex on the card's top edge, top corners dropped by 5 px) so a ball
 * can never balance on it.
 */
export function cardPolygon(c: CardDef): Pt[] {
  const t = 5;
  const o = cardOutline(c);
  const { x, w, y } = c.rect;
  const out: Pt[] = [];
  out.push([o[0][0], y + t]);
  out.push([x + w / 2, y]);
  out.push([o[1][0], y + t]);
  out.push(...o.slice(2, 7));
  out.push([o[7][0], o[7][1] < y + t ? y + t : o[7][1]]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Plunger, drain                                                      */
/* ------------------------------------------------------------------ */

export const PLUNGER = {
  x: (WALL_R + LANE_R) / 2, // 560
  restTop: APRON_Y, // top surface of the plunger tip at rest
  halfW: 14,
  halfH: 6,
  travel: 45, // how far it pulls down at full charge
  ballStart: [(WALL_R + LANE_R) / 2, APRON_Y - BALL_R - 0.5] as Pt,
};

export const DRAIN: Rect = { x: WALL_L - 4, y: 844, w: WALL_R - WALL_L + 8, h: 28 };

/** Region of the plunger lane (used by game logic to know "ball in lane"). */
export const LANE_ZONE: Rect = { x: WALL_R, y: 120, w: LANE_R - WALL_R, h: LANE_FLOOR_Y - 120 };

export function inPlungerLane(x: number, y: number): boolean {
  return x > WALL_R && y > LANE_ZONE.y;
}

/* ------------------------------------------------------------------ */
/* DOM rectangles (every positioned content element)                   */
/* ------------------------------------------------------------------ */

const bumperRect = (b: { x: number; y: number }): Rect => ({
  x: b.x - BUMPER_R,
  y: b.y - BUMPER_R,
  w: BUMPER_R * 2,
  h: BUMPER_R * 2,
});

export const rects: Record<string, Rect> = {
  // table objects
  ...Object.fromEntries(CARDS.map((c) => [c.id, c.rect])),
  ...Object.fromEntries(BUMPERS.map((b) => [b.id, bumperRect(b)])),
  ...Object.fromEntries(LANE_SENSORS.map((l) => [l.id, { x: l.rect.x, y: 46, w: l.rect.w, h: 82 }])),
  'languages-h': { x: LANE_GUIDE_XS[0], y: 27, w: LANE_GUIDE_XS[4] - LANE_GUIDE_XS[0], h: 16 },
  'skills-also': { x: 40, y: 304, w: 500, h: 22 },
  'sling-left': { x: WALL_L, y: SLING_TOP, w: SLING_R[0] - WALL_L, h: SLING_R[1] - SLING_TOP },
  'sling-right': {
    x: mx(SLING_R[0]),
    y: SLING_TOP,
    w: SLING_R[0] - WALL_L,
    h: SLING_R[1] - SLING_TOP,
  },
  // apron
  apron: { x: 0, y: APRON_Y, w: 600, h: STAGE_H - APRON_Y },
  'btn-start': { x: 30, y: 874, w: 210, h: 52 },
  'btn-reader': { x: 256, y: 880, w: 150, h: 40 },
  'plunger-zone': { x: WALL_R + 2, y: 800, w: 56, h: 132 },
  'table-hint': { x: 30, y: 136, w: 240, h: 18 },
  // touch zones for the flippers (lower part of the playfield)
  'zone-left': { x: 0, y: 564, w: 300, h: 276 },
  'zone-right': { x: 300, y: 564, w: 300, h: 276 },
};

/** Elements whose position is driven by `rects` (id -> rect). */
export const POSITIONED_IDS = Object.keys(rects);

/* ------------------------------------------------------------------ */
/* Playfield decor: CPU die, arrow lamps                               */
/* ------------------------------------------------------------------ */

/** The "CPU die" decal between the bumpers and the cards (no physics). */
export const DIE = { cx: 280, cy: 291, bw: 80, bh: 34, pinLen: 7 } as const;

export interface PinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The die's 24 pin lamps in clockwise order starting at the top-left:
 * 8 along the top, 4 down the right side, 8 along the bottom (right to left),
 * 4 up the left side.
 */
export function diePins(): PinRect[] {
  const { cx, cy, bw, bh, pinLen } = DIE;
  const x0 = cx - bw / 2;
  const y0 = cy - bh / 2;
  const out: PinRect[] = [];
  const hx = (i: number): number => x0 + 6 + (i * (bw - 12 - 5)) / 7; // 8 pins, 5 px wide
  const vy = (i: number): number => y0 + 5 + (i * (bh - 10 - 4)) / 3; // 4 pins, 4 px tall
  for (let i = 0; i < 8; i++) out.push({ x: hx(i), y: y0 - pinLen, w: 5, h: pinLen });
  for (let i = 0; i < 4; i++) out.push({ x: x0 + bw, y: vy(i), w: pinLen, h: 4 });
  for (let i = 7; i >= 0; i--) out.push({ x: hx(i), y: y0 + bh, w: 5, h: pinLen });
  for (let i = 3; i >= 0; i--) out.push({ x: x0 - pinLen, y: vy(i), w: pinLen, h: 4 });
  return out;
}

/** Arrow lamp inserts that point up at the three gaps between the cards and the walls. */
export const ARROWS: { x: number; y: number; group: 'left' | 'centre' | 'right' }[] = [
  ...[596, 578, 560].map((y) => ({ x: 33, y, group: 'left' as const })),
  ...[658, 640, 622].map((y) => ({ x: 280, y, group: 'centre' as const })),
  ...[596, 578, 560].map((y) => ({ x: 527, y, group: 'right' as const })),
];

/* ------------------------------------------------------------------ */
/* Decorative rim lamps                                                */
/* ------------------------------------------------------------------ */

const pointInRect = (x: number, y: number, r: Rect, pad = 0): boolean =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/** Clockwise (starting bottom-left) lamp positions around the inside of the rim. */
export function rimLamps(): Pt[] {
  const path: Pt[] = [];
  const inset = 11;
  path.push([WALL_L + inset, 702], [WALL_L + inset, TOP_Y + ARC_R]);
  const a = arc(WALL_L + ARC_R, TOP_Y + ARC_R, ARC_R - inset, Math.PI, 1.5 * Math.PI, 14);
  path.push(...a.slice(1));
  // top edge, then the right arch (stopping before the plunger lane)
  path.push([WALL_R - ARC_R - 40, TOP_Y + inset]);
  const r = arc(LANE_R - ARC_R, TOP_Y + ARC_R, ARC_R - inset, 1.5 * Math.PI, 1.85 * Math.PI, 8);
  path.push(...r.slice(1));
  path.push([WALL_R - inset, 140], [WALL_R - inset, 702]);

  // resample along the polyline at a fixed spacing
  const spacing = 27;
  const out: Pt[] = [];
  let next = 0; // distance along the path at which the next lamp goes
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    while (next <= walked + len) {
      const t = (next - walked) / len;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      next += spacing;
    }
    walked += len;
  }
  const cardRects = CARDS.map((c) => c.rect);
  return out.filter(
    ([x, y]) =>
      !cardRects.some((r2) => pointInRect(x, y, r2, 6)) && !ARROWS.some((a) => Math.hypot(a.x - x, a.y - y) < 16),
  );
}

/** All polygons/circles the debug overlay and SVG art need (convenience). */
export const SLING_LABEL_SIDE: Record<SlingDef['id'], 'left' | 'right'> = {
  'sling-left': 'left',
  'sling-right': 'right',
};
