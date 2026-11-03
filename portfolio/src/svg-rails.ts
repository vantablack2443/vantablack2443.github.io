import {
  ARROWS,
  CARDS,
  DIE,
  FUNNELS,
  GATE_BOTTOM_Y,
  GATE_TOP_Y,
  LANE_GUIDE_XS,
  LANE_GUIDE_Y0,
  LANE_GUIDE_Y1,
  LANE_WALL,
  OUTER_WALL,
  PLUNGER,
  SLINGS,
  STAGE_H,
  STAGE_W,
  WALL_R,
  APRON_Y,
  cardOutline,
  diePins,
  mx,
  rimLamps,
  type Pt,
} from './layout';

const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

const pts = (p: readonly Pt[]): string => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
const f1 = (n: number): string => n.toFixed(1);

function prepare(svg: SVGSVGElement): void {
  svg.setAttribute('viewBox', `0 0 ${STAGE_W} ${STAGE_H}`);
  svg.setAttribute('width', String(STAGE_W));
  svg.setAttribute('height', String(STAGE_H));
  svg.setAttribute('aria-hidden', 'true');
  svg.replaceChildren();
}

/* ------------------------------------------------------------------ */
/* Board layer: the PCB under the cards and bumpers                    */
/* ------------------------------------------------------------------ */

/** A copper trace with 45 degree bevels at the corners. */
function route(points: readonly Pt[], bevel = 9): string {
  let d = `M${f1(points[0][0])},${f1(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const c = Math.min(bevel, l1 / 2, l2 / 2);
    d += ` L${f1(cx - ((cx - px) / l1) * c)},${f1(cy - ((cy - py) / l1) * c)}`;
    d += ` L${f1(cx + ((nx - cx) / l2) * c)},${f1(cy + ((ny - cy) / l2) * c)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f1(last[0])},${f1(last[1])}`;
}

const mirror = (p: readonly Pt[]): Pt[] => p.map(([x, y]) => [mx(x), y] as Pt);

/**
 * Signal paths. Each starts at the end nearest the plunger lane, so the
 * "power-up" pulse runs outward from it. Bumpers feed cards, lanes feed
 * bumpers, the die sits in the middle of it all.
 */
const TRACES: Pt[][] = [
  // the power rail: up the plunger lane, then out across the top right
  [[560, 860], [560, 118], [546, 104], [470, 104], [458, 116], [458, 160]],
  // java and rust feed the SAARDEW chip, python and kotlin feed ORION
  [[435, 215], [435, 322]],
  [[375, 300], [375, 322]],
  [[125, 215], [125, 322]],
  [[185, 300], [185, 322]],
  // rust and kotlin reach out to the side corridors
  [[405, 270], [505, 270], [527, 292], [527, 322]],
  mirror([[405, 270], [505, 270], [527, 292], [527, 322]]),
  // lane outputs feed the bumpers
  [[367, 130], [367, 160], [398, 183]],
  [[309, 130], [309, 150], [292, 167], [292, 192]],
  [[251, 130], [251, 150], [268, 167], [268, 192]],
  [[193, 130], [193, 160], [162, 183]],
  // the C bumper drives the die
  [[280, 250], [280, 266]],
  // out of the die, down the centre gap
  [[294, 316], [294, 330], [294, 598]],
  [[266, 316], [266, 330], [266, 598]],
  // below the cards, towards the flippers
  [[410, 612], [410, 690], [388, 712], [388, 744]],
  [[150, 612], [150, 690], [172, 712], [172, 744]],
];

const BUSES: Pt[][] = [
  // data buses in the 12 px gaps between the card rows
  [[50, 422], [252, 422]],
  [[308, 422], [510, 422]],
  [[50, 518], [252, 518]],
  [[308, 518], [510, 518]],
];

const SILK: { x: number; y: number; t: string; rot?: number }[] = [
  { x: 226, y: 262, t: 'U1' },
  { x: 332, y: 322, t: 'J2' },
  { x: 36, y: 652, t: 'C9' },
  { x: 548, y: 652, t: 'C10' },
  { x: 548, y: 852, t: 'PWR', rot: -90 },
  { x: 50, y: 152, t: 'R12' },
  { x: 508, y: 152, t: 'R13' },
];

export function buildBoard(svg: SVGSVGElement): void {
  prepare(svg);

  // vias: a deterministic scatter of small rings on the open board
  const vias = el('g', { id: 'vias' });
  const spots: Pt[] = [
    [70, 60], [500, 60], [100, 300], [460, 300], [330, 180], [230, 180], [60, 240], [520, 240],
    [215, 560], [345, 560], [215, 700], [345, 700], [90, 560], [470, 560], [280, 745], [60, 760],
  ];
  for (const [x, y] of spots) vias.append(el('circle', { cx: x, cy: y, r: 3 }, 'via'));
  svg.append(vias);

  // traces: dim copper, a lit copy that fades in, and a pulse that runs along it
  const traces = el('g', { id: 'traces' });
  TRACES.concat(BUSES).forEach((raw) => {
    // orient so the start is the end nearest the plunger lane
    let p = raw;
    const [a, b] = [raw[0], raw[raw.length - 1]];
    if (a[0] < b[0]) p = [...raw].reverse();
    const d = route(p);
    const dist = Math.hypot(p[0][0] - 560, p[0][1] - 860);
    const g = el('g', { class: 'tr' });
    g.style.setProperty('--pd', `${((dist / 700) * 1.1).toFixed(2)}s`);
    g.append(el('path', { d }, 'trace'));
    g.append(el('path', { d }, 'trace-lit'));
    g.append(el('path', { d, pathLength: 100 }, 'trace-pulse'));
    for (const [x, y] of [p[0], p[p.length - 1]]) {
      g.append(el('circle', { cx: f1(x), cy: f1(y), r: 3.4 }, 'pad'));
      g.append(el('circle', { cx: f1(x), cy: f1(y), r: 1.2 }, 'pad-hole'));
    }
    traces.append(g);
  });
  svg.append(traces);

  // chip legs on the project cards (left and right sides)
  const legs = el('g', { id: 'legs' });
  for (const c of CARDS) {
    const { x, y, w, h } = c.rect;
    for (let i = 0; i < 6; i++) {
      const ly = y + 18 + (i * (h - 36)) / 5;
      legs.append(el('rect', { x: x - 4.5, y: f1(ly - 1.5), width: 5, height: 3 }, 'leg'));
      legs.append(el('rect', { x: x + w - 0.5, y: f1(ly - 1.5), width: 5, height: 3 }, 'leg'));
    }
  }
  svg.append(legs);

  // the CPU die: package, die window, silkscreen and 24 pin lamps
  const die = el('g', { id: 'die' });
  const { cx, cy, bw, bh } = DIE;
  die.append(el('rect', { x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh, rx: 4 }, 'die-pkg'));
  die.append(el('rect', { x: cx - 22, y: cy - 9, width: 44, height: 18, rx: 2 }, 'die-core'));
  const label = el('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle' }, 'die-label');
  label.textContent = 'CPU';
  die.append(label);
  die.append(el('circle', { cx: cx - bw / 2 + 6, cy: cy - bh / 2 + 6, r: 1.8 }, 'die-dot'));
  diePins().forEach((r, i) => {
    die.append(el('rect', { x: f1(r.x), y: f1(r.y), width: r.w, height: r.h, rx: 1, 'data-i': i }, 'pin'));
  });
  svg.append(die);

  // arrow lamp inserts
  const arrows = el('g', { id: 'arrows' });
  ARROWS.forEach((a, i) => {
    const row = ARROWS.filter((b) => b.group === a.group).indexOf(a);
    const arrow = el(
      'path',
      { d: 'M-9,4 L0,-5 L9,4 L5.5,7.5 L0,2 L-5.5,7.5 Z', transform: `translate(${a.x} ${a.y})`, 'data-g': a.group },
      'arrow',
    );
    arrow.style.setProperty('--row', String(row));
    arrow.style.setProperty('--ai', String(i));
    arrows.append(arrow);
  });
  svg.append(arrows);

  // silkscreen
  const silk = el('g', { id: 'silk' });
  for (const s of SILK) {
    const t = el('text', { x: s.x, y: s.y, transform: s.rot ? `rotate(${s.rot} ${s.x} ${s.y})` : '' }, 'silk');
    t.textContent = s.t;
    silk.append(t);
  }
  svg.append(silk);
}

/* ------------------------------------------------------------------ */
/* Rail layer: hardware over the cards                                 */
/* ------------------------------------------------------------------ */

/**
 * Draws rails, guides, slingshot bodies, card outlines and rim lamps. Every
 * coordinate comes from layout.ts, the same numbers the physics world uses.
 */
export function buildRails(svg: SVGSVGElement): void {
  prepare(svg);

  const defs = el('defs');
  const chrome = el('linearGradient', { id: 'chrome', x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [o, c] of [
    [0, '#f4f6fb'],
    [0.45, '#9aa1b4'],
    [1, '#4b5063'],
  ] as const) {
    chrome.append(el('stop', { offset: o, 'stop-color': c }));
  }
  const post = el('radialGradient', { id: 'post', cx: 0.35, cy: 0.3, r: 0.8 });
  for (const [o, c] of [
    [0, '#ffffff'],
    [0.5, '#a9b0c4'],
    [1, '#454a5e'],
  ] as const) {
    post.append(el('stop', { offset: o, 'stop-color': c }));
  }
  defs.append(chrome, post);
  svg.append(defs);

  // lamps first so rails draw over them
  const lamps = el('g', { id: 'rim-lamps' });
  for (const [x, y] of rimLamps()) lamps.append(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2 }, 'lamp'));
  svg.append(lamps);

  svg.append(el('line', { x1: 0, y1: APRON_Y, x2: WALL_R, y2: APRON_Y }, 'apron-line'));

  // slingshots: chrome-edged triangle with a rubber band on the kicker edge
  for (const s of SLINGS) {
    svg.append(el('polygon', { points: pts(s.pts), id: `outline-${s.id}`, 'data-for': s.id }, 'sling-body'));
    const inset = 6;
    const [fx, fy] = s.kickerFrom;
    const [tx, ty] = s.kickerTo;
    const nx = -s.normal[0] * inset;
    const ny = -s.normal[1] * inset;
    const lerp = (t: number): Pt => [fx + (tx - fx) * t + nx, fy + (ty - fy) * t + ny];
    const [x1, y1] = lerp(0.1);
    const [x2, y2] = lerp(0.9);
    svg.append(el('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), 'data-for': s.id }, 'sling-rubber'));
  }

  // card outlines (a full border, matching the chamfered collider), pin-1 dots, check lamps
  for (const c of CARDS) {
    const neon = document.getElementById(c.id)?.getAttribute('data-neon') ?? 'cyan';
    svg.append(
      el(
        'polygon',
        { points: pts(cardOutline(c)), id: `outline-${c.id}`, 'data-for': c.id, 'data-neon': neon },
        'card-outline',
      ),
    );
    svg.append(el('circle', { cx: c.rect.x + 8.5, cy: c.rect.y + 8.5, r: 2.2, 'data-neon': neon }, 'pin1'));
    const g = el('g', { id: `lamp-${c.id}`, 'data-neon': neon, transform: `translate(${c.rect.x + c.rect.w - 17} ${c.rect.y + 16})` }, 'vlamp');
    g.append(el('circle', { r: 8 }, 'vlamp-bulb'));
    g.append(el('path', { d: 'M-3.6,0.3 L-1.1,2.9 L3.8,-2.7' }, 'vlamp-check'));
    svg.append(g);
  }

  // chrome rails: a dull body plus a thin highlight on top
  const rail = (p: readonly Pt[]): void => {
    svg.append(el('polyline', { points: pts(p) }, 'rail'));
    svg.append(el('polyline', { points: pts(p) }, 'rail-hi'));
  };
  rail(OUTER_WALL);
  rail(LANE_WALL.slice(1)); // lane wall below the gate
  for (const f of FUNNELS) rail(f);

  // one-way gate (dashed): ball may leave the plunger lane here, never re-enter
  svg.append(el('line', { x1: WALL_R, y1: GATE_TOP_Y, x2: WALL_R, y2: GATE_BOTTOM_Y }, 'gate'));

  // rollover lane guides: a chrome post with a rubber ring on top
  for (const x of LANE_GUIDE_XS) {
    svg.append(el('line', { x1: x, y1: LANE_GUIDE_Y0, x2: x, y2: LANE_GUIDE_Y1 }, 'guide'));
    svg.append(el('circle', { cx: x, cy: LANE_GUIDE_Y0, r: 5.5 }, 'post-ring'));
    svg.append(el('circle', { cx: x, cy: LANE_GUIDE_Y0, r: 3.6, fill: 'url(#post)' }, 'post'));
  }

  // plunger lane label plate
  svg.append(el('rect', { x: PLUNGER.x - 14, y: LANE_GUIDE_Y1 + 40, width: 28, height: 4, rx: 2 }, 'plate'));
}
