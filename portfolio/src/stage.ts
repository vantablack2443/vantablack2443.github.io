import {
  CARDS,
  OUTER_ARCH,
  OUTER_LEFT,
  APRON_Y,
  LANE_R,
  SLINGS,
  STAGE_H,
  STAGE_W,
  WALL_L,
  cardOutline,
  rects,
  type Pt,
  type Rect,
} from './layout';

/**
 * Stage: positions the DOM from layout.ts and keeps the CSS scale in sync with
 * the viewport. No getBoundingClientRect, no rebuild on resize: only `--s`
 * (the stage scale) and the canvas resolution change.
 */

export interface StageMetrics {
  /** CSS scale of the 600 x 940 stage (the cabinet frame scales with it). */
  scale: number;
  /** Device pixel ratio, capped at 2. */
  dpr: number;
}

/* ------------------------------------------------------------------ */
/* Cabinet, tilt and fitting                                           */
/* ------------------------------------------------------------------ */

/** Thickness of the cabinet frame around the stage, in logical px. */
export const CABINET = { padX: 22, padTop: 18, padBottom: 24 } as const;
export const CAB_W = STAGE_W + 2 * CABINET.padX;
export const CAB_H = STAGE_H + CABINET.padTop + CABINET.padBottom;

export const TILT_DEG = 18;
export const PERSPECTIVE = 1600;

/** `?flat` turns the 3D tilt off (debugging, or a fallback for blurry GPUs). */
export const isFlat = (): boolean => new URLSearchParams(location.search).has('flat');

/**
 * Projected height (px) of a cabinet drawn at scale `s` and tilted by `tilt`
 * about its bottom edge, seen with `perspective: PERSPECTIVE` and the
 * perspective origin on that bottom edge:
 *   P = H cos(t) * d / (d + H sin(t))   with H = CAB_H * s
 */
function projectedHeight(s: number, tilt: number): number {
  const h = CAB_H * s;
  return (h * Math.cos(tilt) * PERSPECTIVE) / (PERSPECTIVE + h * Math.sin(tilt));
}

/** Largest scale whose projected height is <= `p` (inverse of projectedHeight). */
function scaleForProjectedHeight(p: number, tilt: number): number {
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  const denom = c * PERSPECTIVE - p * sn;
  if (denom <= 0) return 0.2;
  return ((p * PERSPECTIVE) / denom) / CAB_H;
}

export interface Fit {
  scale: number;
  /** Width and height of the perspective viewport that holds the cabinet. */
  vpW: number;
  vpH: number;
  tiltDeg: number;
  desktop: boolean;
}

/** Desktop layout: three columns, landscape, at least 1024 px wide. */
export function isDesktop(vw: number, vh: number): boolean {
  return vw >= 1024 && vw > vh;
}

export function computeFit(): Fit {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const tiltDeg = isFlat() ? 0 : TILT_DEG;
  const tilt = (tiltDeg * Math.PI) / 180;
  const desktop = isDesktop(vw, vh);
  let s: number;
  if (desktop) {
    // Keep these numbers in sync with the grid in arcade.css.
    const pad = 24;
    const gap = vw >= 1440 ? 32 : 24;
    const minL = vw >= 1280 ? 280 : 240;
    const minR = vw >= 1280 ? 320 : 280;
    const byHeight = scaleForProjectedHeight(vh - 2 * pad, tilt);
    const byWidth = (vw - 2 * pad - 2 * gap - minL - minR) / CAB_W;
    s = Math.min(byHeight, byWidth);
  } else {
    const gutter = vw < 480 ? 8 : 24;
    s = (vw - 2 * gutter) / CAB_W;
    // tablets and landscape phones: keep the table on screen under the name strip and score (about 270 px)
    if (vw >= 700) s = Math.min(s, scaleForProjectedHeight(vh - 2 * gutter - 270, tilt));
  }
  s = Math.max(0.25, Math.min(s, 1.4));
  return { scale: s, vpW: CAB_W * s, vpH: projectedHeight(s, tilt), tiltDeg, desktop };
}

export function computeScale(): number {
  return computeFit().scale;
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

function polygonCss(points: readonly Pt[], origin: Rect): string {
  return `polygon(${points.map(([x, y]) => `${px(x - origin.x)} ${px(y - origin.y)}`).join(', ')})`;
}

/** Set --x/--y/--w/--h on every element that has an entry in `rects`. */
export function positionElements(root: Document = document): void {
  for (const [id, r] of Object.entries(rects)) {
    const el = root.getElementById(id);
    if (!el) continue;
    el.setAttribute('data-pos', '');
    el.style.setProperty('--x', px(r.x));
    el.style.setProperty('--y', px(r.y));
    el.style.setProperty('--w', px(r.w));
    el.style.setProperty('--h', px(r.h));
  }

  // Chamfered card panels and triangular slingshots are clipped to the exact
  // collider outline.
  for (const c of CARDS) {
    const el = root.getElementById(c.id);
    el?.style.setProperty('--clip', polygonCss(cardOutline(c), c.rect));
  }
  for (const s of SLINGS) {
    const el = root.getElementById(s.id);
    if (el) el.style.setProperty('--clip', polygonCss(s.pts, rects[s.id]));
  }

  // Playfield art is clipped to the shape of the table.
  const field: Pt[] = [
    [WALL_L, APRON_Y],
    ...OUTER_LEFT,
    ...OUTER_ARCH.slice(1),
    [LANE_R, APRON_Y],
  ];
  root
    .getElementById('playfield')
    ?.style.setProperty('--field-clip', `polygon(${field.map(([x, y]) => `${px(x)} ${px(y)}`).join(', ')})`);
}

export function metrics(): StageMetrics {
  return { scale: computeScale(), dpr: Math.min(window.devicePixelRatio || 1, 2) };
}

/** Apply the scale to the document and notify listeners (canvas resize). */
export function watchScale(cb: (m: StageMetrics) => void): () => void {
  const apply = (): void => {
    const f = computeFit();
    const m: StageMetrics = { scale: f.scale, dpr: Math.min(window.devicePixelRatio || 1, 2) };
    const st = document.documentElement.style;
    st.setProperty('--s', f.scale.toFixed(4));
    st.setProperty('--vp-w', `${f.vpW.toFixed(2)}px`);
    st.setProperty('--vp-h', `${f.vpH.toFixed(2)}px`);
    st.setProperty('--tilt', `${f.tiltDeg}deg`);
    st.setProperty('--persp', `${PERSPECTIVE}px`);
    st.setProperty('--cab-w', `${CAB_W}px`);
    st.setProperty('--cab-h', `${CAB_H}px`);
    st.setProperty('--cab-px', `${CABINET.padX}px`);
    st.setProperty('--cab-pt', `${CABINET.padTop}px`);
    st.setProperty('--cab-pb', `${CABINET.padBottom}px`);
    cb(m);
  };
  let timer = 0;
  const schedule = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 40);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  apply();
  return () => {
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
  };
}
