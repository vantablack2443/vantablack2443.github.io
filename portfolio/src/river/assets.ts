import { Rectangle, Texture } from 'pixi.js';
import { ART_FILES, DOCK_ART, PALETTE } from './config';

/**
 * Art for the river. Every image has a procedural placeholder drawn here with the canvas, so
 * the game is complete without any files. If public/night/ holds a file from the list in
 * config.ts (ART_FILES), that file is used instead of its placeholder. Sprite placement
 * (width, anchor, offset) lives in config.ts, so swapping in real art is a config change.
 *
 * Real images are trimmed to their visible pixels (the art is not always cropped tight), so a
 * sprite's anchor is always a fraction of what can be seen. Placeholders are drawn tight.
 */

export interface Art {
  sky: Texture;
  moon: Texture;
  far: Texture;
  mid: Texture;
  front: Texture;
  boat: Texture;
  lanternOff: Texture;
  lanternOn: Texture;
  dock: Texture;
  log: Texture;
  hyacinth: Texture;
  croc: Texture;
  /** Always procedural: a soft glow, and the colour ramp of the water (x: how lit, y: far to near). */
  glow: Texture;
  /** A soft ring, for the safe circles and the tap target. */
  ring: Texture;
  ramp: Texture;
  /** File names that were found in public/night/ and used. */
  real: string[];
}

const PPM = 100; // placeholder pixels per metre

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available');
  return { c, g };
}

/** A canvas covering [x0, x1] x [y0, y1] metres, drawn with y up. */
function metric(x0: number, y0: number, x1: number, y1: number): { c: HTMLCanvasElement; g: Ctx } {
  const { c, g } = canvas((x1 - x0) * PPM, (y1 - y0) * PPM);
  g.setTransform(PPM, 0, 0, -PPM, -x0 * PPM, y1 * PPM);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  return { c, g };
}

/** `repeat` 'x' tiles sideways only (the banks: no seam line at the top edge), 'xy' tiles both ways. */
function tex(c: HTMLCanvasElement, repeat?: 'x' | 'xy'): Texture {
  const t = Texture.from(c);
  if (repeat) wrapMode(t, repeat);
  return t;
}

function wrapMode(t: Texture, repeat: 'x' | 'xy'): void {
  t.source.style.addressModeU = 'repeat';
  t.source.style.addressModeV = repeat === 'xy' ? 'repeat' : 'clamp-to-edge';
}

/** mulberry32, so the placeholders look the same on every load. */
function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function path(g: Ctx, pts: ReadonlyArray<readonly [number, number]>): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/* ---------------- sky, moon, glow, gradients ---------------- */

function drawSky(): HTMLCanvasElement {
  const W = 1600;
  const H = 900;
  const { c, g } = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(0.42, PALETTE.skyMid);
  grad.addColorStop(0.64, PALETTE.skyLow);
  grad.addColorStop(1, '#0b2a36');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const r = rnd(7);
  // a faint milky band
  g.save();
  g.translate(W * 0.45, H * 0.28);
  g.rotate(-0.35);
  g.scale(1, 0.12);
  const band = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.6);
  band.addColorStop(0, 'rgba(150,190,255,0.16)');
  band.addColorStop(1, 'rgba(150,190,255,0)');
  g.fillStyle = band;
  g.beginPath();
  g.arc(0, 0, W * 0.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // soft moonlit clouds low on the right
  for (let i = 0; i < 7; i++) {
    const x = W * (0.55 + r() * 0.4);
    const y = H * (0.5 + r() * 0.1);
    const cl = g.createRadialGradient(x, y, 0, x, y, 120 + r() * 120);
    cl.addColorStop(0, 'rgba(120,160,200,0.14)');
    cl.addColorStop(1, 'rgba(120,160,200,0)');
    g.fillStyle = cl;
    g.fillRect(x - 260, y - 140, 520, 280);
  }
  // stars, thinner toward the horizon
  for (let i = 0; i < 420; i++) {
    const y = r() * H * 0.64;
    const a = (0.25 + r() * 0.65) * (1 - (y / (H * 0.64)) * 0.6);
    g.fillStyle = `rgba(235,240,255,${a.toFixed(2)})`;
    const s = r() < 0.08 ? 2 : 1;
    g.fillRect(Math.floor(r() * W), Math.floor(y), s, s);
  }
  return c;
}

function drawMoon(): HTMLCanvasElement {
  const { c, g } = canvas(256, 256);
  const glow = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  glow.addColorStop(0, 'rgba(255,241,201,0.32)');
  glow.addColorStop(1, 'rgba(255,241,201,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  const disc = g.createRadialGradient(112, 112, 10, 128, 128, 72);
  disc.addColorStop(0, '#fffaf0');
  disc.addColorStop(1, PALETTE.moon);
  g.fillStyle = disc;
  g.beginPath();
  g.arc(128, 128, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,130,100,0.16)';
  for (const [x, y, rr] of [
    [108, 112, 13],
    [146, 100, 8],
    [140, 148, 15],
    [112, 154, 7],
    [158, 128, 5],
  ]) {
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function drawGlow(): HTMLCanvasElement {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function drawRing(): HTMLCanvasElement {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.05)');
  gr.addColorStop(0.72, 'rgba(255,255,255,0.1)');
  gr.addColorStop(0.9, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.97, 'rgba(255,255,255,0.2)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * The water's colour ramp. The mesh puts a per vertex shade in u (0 dark trough, 1 moonlit glint)
 * and the depth in v (0 far, 1 near): deep blue-black far away, a little lighter near the camera.
 */
function drawRamp(): HTMLCanvasElement {
  const W = 128;
  const H = 16;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // dark trough, body of the water, lit face, glint (r, g, b at stops along u)
  const stops: Array<[number, number, number, number]> = [
    [0, 3, 9, 18],
    [0.3, 10, 34, 54],
    [0.55, 30, 78, 108],
    [0.8, 96, 150, 182],
    [1, 190, 222, 244],
  ];
  for (let y = 0; y < H; y++) {
    const near = y / (H - 1);
    const lift = lerp(0.8, 1.35, near);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      let k = 0;
      while (k < stops.length - 2 && u > stops[k + 1][0]) k++;
      const t = (u - stops[k][0]) / (stops[k + 1][0] - stops[k][0]);
      const i = (y * W + x) * 4;
      const glint = u > 0.7 ? 1 : lift; // the glints do not dim with distance
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.min(255, lerp(stops[k][ch + 1], stops[k + 1][ch + 1], t) * glint);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------------- banks (tiling silhouettes) ---------------- */

/** Draw `fn` at x and one tile either side, so shapes that cross the edge wrap. */
function wrap(W: number, x: number, fn: (x: number) => void): void {
  fn(x);
  fn(x - W);
  fn(x + W);
}

function palm(g: Ctx, x: number, base: number, h: number, lean: number, col: string, rim: string | null): void {
  const top = { x: x + lean, y: base - h };
  g.strokeStyle = col;
  g.lineWidth = Math.max(2, h * 0.035);
  g.beginPath();
  g.moveTo(x, base);
  g.quadraticCurveTo(x + lean * 0.2, base - h * 0.55, top.x, top.y);
  g.stroke();
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = Math.PI * (0.04 + (0.92 * i) / (fronds - 1));
    const dx = Math.cos(a);
    const len = h * (0.3 + (i % 2) * 0.07);
    // a frond arches up and out, then droops
    const ex = top.x + dx * len;
    const ey = top.y + len * 0.22 + Math.abs(dx) * len * 0.26;
    const cx = top.x + dx * len * 0.55;
    const cy = top.y - len * 0.4 - Math.sin(a) * len * 0.12;
    if (rim) {
      g.strokeStyle = rim;
      g.lineWidth = Math.max(1.5, h * 0.022);
      g.beginPath();
      g.moveTo(top.x, top.y - 1);
      g.quadraticCurveTo(cx, cy - 1.5, ex, ey - 1.5);
      g.stroke();
    }
    g.strokeStyle = col;
    g.lineWidth = Math.max(2, h * 0.03);
    g.beginPath();
    g.moveTo(top.x, top.y);
    g.quadraticCurveTo(cx, cy, ex, ey);
    g.stroke();
  }
}

function house(g: Ctx, x: number, base: number, w: number, h: number, col: string, window: boolean): void {
  g.fillStyle = col;
  g.fillRect(x - w / 2, base - h, w, h);
  g.beginPath();
  g.moveTo(x - w / 2 - 6, base - h);
  g.lineTo(x, base - h - h * 0.55);
  g.lineTo(x + w / 2 + 6, base - h);
  g.closePath();
  g.fill();
  if (window) {
    g.fillStyle = 'rgba(255,179,71,0.85)';
    g.fillRect(x - w * 0.2, base - h * 0.62, w * 0.18, h * 0.3);
    g.fillRect(x + w * 0.1, base - h * 0.62, w * 0.18, h * 0.3);
  }
}

function drawBank(kind: 'far' | 'mid' | 'front'): HTMLCanvasElement {
  const W = 1024;
  const H = kind === 'mid' ? 384 : 256;
  const { c, g } = canvas(W, H);
  const r = rnd(kind === 'far' ? 11 : kind === 'mid' ? 23 : 37);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const two = Math.PI * 2;

  if (kind === 'far') {
    // misty distant tree line: blue, faded toward the bottom
    const body = g.createLinearGradient(0, H * 0.35, 0, H);
    body.addColorStop(0, PALETTE.bankFar);
    body.addColorStop(1, '#1b4560');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const t = (x / W) * two;
      const y = H * 0.62 + Math.sin(t * 3) * 14 + Math.sin(t * 7 + 1) * 8 + Math.sin(t * 19) * 4;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.fillStyle = PALETTE.bankFar;
    for (let i = 0; i < 70; i++) {
      const x = r() * W;
      const y = H * 0.62 + Math.sin((x / W) * two * 3) * 14 - 4;
      const rr = 8 + r() * 14;
      wrap(W, x, (xx) => {
        g.beginPath();
        g.arc(xx, y, rr, 0, two);
        g.fill();
      });
    }
    for (let i = 0; i < 16; i++) {
      const x = r() * W;
      const base = H * 0.62 + Math.sin((x / W) * two * 3) * 14;
      wrap(W, x, (xx) => palm(g, xx, base + 4, 70 + r() * 40, (r() - 0.5) * 24, PALETTE.bankFar, null));
    }
    g.fillStyle = 'rgba(255,179,71,0.6)';
    for (let i = 0; i < 7; i++) g.fillRect(Math.floor(r() * W), Math.floor(H * 0.66 + r() * 10), 2, 2);
  } else if (kind === 'mid') {
    g.fillStyle = PALETTE.bankMid;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const t = (x / W) * two;
      g.lineTo(x, H * 0.78 + Math.sin(t * 4 + 0.5) * 12 + Math.sin(t * 11) * 6);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // houses with warm windows
    for (const x of [140, 430, 760]) wrap(W, x, (xx) => house(g, xx, H * 0.8, 70 + r() * 20, 44, PALETTE.bankMid, true));
    // palms, with a thin moonlit rim on the fronds
    for (let i = 0; i < 12; i++) {
      const x = (i + r() * 0.6) * (W / 12);
      const hgt = 170 + r() * 110;
      wrap(W, x, (xx) => palm(g, xx, H * 0.84, hgt, (r() - 0.5) * 60, PALETTE.bankMid, '#2c5174'));
    }
    // banana plants and dense foliage
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const y = H * 0.8 + r() * 14;
      const rr = 14 + r() * 20;
      wrap(W, x, (xx) => {
        g.fillStyle = PALETTE.bankMid;
        g.beginPath();
        g.ellipse(xx, y, rr * 1.2, rr, 0, 0, two);
        g.fill();
      });
    }
  } else {
    // foreground: reeds and grass blades rising from the bottom edge, a few hibiscus
    g.fillStyle = PALETTE.bankFront;
    g.fillRect(0, H * 0.84, W, H * 0.16);
    for (let i = 0; i < 190; i++) {
      const x = r() * W;
      const hgt = 40 + r() * (H * 0.62);
      const lean = (r() - 0.5) * 50;
      const w = 2 + r() * 3.2;
      const shade = r();
      wrap(W, x, (xx) => {
        g.fillStyle = shade < 0.2 ? '#071a28' : PALETTE.bankFront;
        g.beginPath();
        g.moveTo(xx - w, H);
        g.quadraticCurveTo(xx - w * 0.6 + lean * 0.2, H - hgt * 0.6, xx + lean, H - hgt);
        g.quadraticCurveTo(xx + w * 0.6 + lean * 0.2, H - hgt * 0.6, xx + w, H);
        g.closePath();
        g.fill();
      });
    }
    for (let i = 0; i < 6; i++) {
      const x = r() * W;
      const y = H - 40 - r() * 60;
      wrap(W, x, (xx) => {
        g.fillStyle = PALETTE.bankFront;
        g.beginPath();
        g.ellipse(xx - 10, y + 6, 14, 6, -0.5, 0, two);
        g.ellipse(xx + 10, y + 6, 14, 6, 0.5, 0, two);
        g.fill();
        g.fillStyle = '#4a1124';
        g.beginPath();
        g.arc(xx, y, 8, 0, two);
        g.fill();
      });
    }
  }
  return c;
}

/* ---------------- boat, lanterns, dock, floaters ---------------- */

/** A placeholder canvas of w x h metres at 100 px per metre, drawn with y up from the bottom edge. */
function sheet(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const { c, g } = canvas(w * PPM, h * PPM);
  g.setTransform(PPM, 0, 0, -PPM, 0, h * PPM);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  return { c, g };
}

/** The boat: 5 m wide, its bottom at the bottom edge (the hull bottom), a low arched canopy lit from inside. */
function drawBoat(): HTMLCanvasElement {
  const { c, g } = sheet(5, 2.1);
  g.fillStyle = PALETTE.wood;
  path(g, [
    [0.05, 0.95],
    [0.5, 0.05],
    [4.5, 0.05],
    [4.95, 1.0],
    [4.6, 0.9],
    [3.0, 0.62],
    [2.0, 0.62],
    [0.4, 0.9],
  ]);
  g.fill();
  g.strokeStyle = PALETTE.woodLit;
  g.lineWidth = 0.04;
  g.beginPath();
  g.moveTo(0.1, 0.92);
  g.quadraticCurveTo(2.5, 0.35, 4.9, 0.95);
  g.stroke();
  // canopy: an arch of woven palm leaf over the middle
  const inner = g.createRadialGradient(2.5, 1.1, 0.05, 2.5, 1.1, 1.3);
  inner.addColorStop(0, 'rgba(255,179,71,0.85)');
  inner.addColorStop(1, 'rgba(255,179,71,0)');
  g.fillStyle = '#2a1f1a';
  g.beginPath();
  g.moveTo(1.0, 0.7);
  g.bezierCurveTo(1.0, 1.9, 4.0, 1.9, 4.0, 0.7);
  g.closePath();
  g.fill();
  g.fillStyle = inner;
  g.fill();
  g.strokeStyle = 'rgba(20,12,8,0.55)';
  g.lineWidth = 0.03;
  for (let i = 0; i < 9; i++) {
    const x = 1.3 + i * 0.33;
    g.beginPath();
    g.moveTo(x, 0.72);
    g.quadraticCurveTo(x, 1.5, 2.5 + (x - 2.5) * 0.6, 1.62);
    g.stroke();
  }
  return c;
}

function drawLantern(lit: boolean): HTMLCanvasElement {
  const { c, g } = metric(-0.31, -0.31, 0.31, 0.31);
  if (lit) {
    const gl = g.createRadialGradient(0, 0, 0.05, 0, 0, 0.31);
    gl.addColorStop(0, 'rgba(255,200,110,0.9)');
    gl.addColorStop(1, 'rgba(255,179,71,0)');
    g.fillStyle = gl;
    g.fillRect(-0.31, -0.31, 0.62, 0.62);
  }
  // ring, cap, paper body, base
  g.strokeStyle = lit ? '#ffcf8a' : '#5c6b78';
  g.lineWidth = 0.025;
  g.beginPath();
  g.arc(0, 0.265, 0.04, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = lit ? '#7a4a1c' : '#2a3038';
  g.beginPath();
  g.moveTo(-0.1, 0.19);
  g.lineTo(0.1, 0.19);
  g.lineTo(0.13, 0.22);
  g.lineTo(-0.13, 0.22);
  g.closePath();
  g.fill();
  const body = g.createLinearGradient(0, -0.2, 0, 0.2);
  if (lit) {
    body.addColorStop(0, '#ffd89a');
    body.addColorStop(1, '#ff9a2e');
  } else {
    body.addColorStop(0, '#46556a');
    body.addColorStop(1, '#222b38');
  }
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, 0, 0.17, 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = lit ? 'rgba(122,74,28,0.7)' : 'rgba(10,16,24,0.7)';
  g.lineWidth = 0.014;
  for (const k of [-0.09, 0, 0.09]) {
    g.beginPath();
    g.ellipse(k * 0.6, 0, Math.abs(k) * 0.8 + 0.001, 0.2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = lit ? '#7a4a1c' : '#2a3038';
  g.fillRect(-0.09, -0.225, 0.18, 0.04);
  return c;
}

/** A jetty on stilts, a big post on the right and a blank sign on a pole; the places in config's DOCK_ART. */
function drawDock(): HTMLCanvasElement {
  const W = 6;
  const H = 4.1;
  const { c, g } = sheet(W, H);
  const deckY = 1.5;
  g.fillStyle = PALETTE.wood;
  for (const x of [0.5, 1.7, 2.9, 4.1]) g.fillRect(x - 0.08, 0, 0.16, deckY);
  g.fillRect(0.1, deckY, 5.0, 0.16);
  g.fillStyle = PALETTE.woodLit;
  g.fillRect(0.1, deckY + 0.14, 5.0, 0.03);
  // the big post
  g.fillStyle = PALETTE.wood;
  g.fillRect(W * DOCK_ART.post[0] - 0.14, 0, 0.28, deckY + 1.5);
  // sign board on a pole
  const sx = W * DOCK_ART.sign[0];
  const sy = H * (1 - DOCK_ART.sign[1]);
  g.fillRect(sx - 0.05, deckY, 0.1, sy - deckY);
  g.fillRect(sx - 0.7, sy - 0.35, 1.4, 0.7);
  g.strokeStyle = PALETTE.woodLit;
  g.lineWidth = 0.03;
  g.strokeRect(sx - 0.7, sy - 0.35, 1.4, 0.7);
  // the lamp on the pole
  g.fillStyle = '#2a3038';
  g.fillRect(W * DOCK_ART.lamp[0] - 0.09, H * (1 - DOCK_ART.lamp[1]) - 0.12, 0.18, 0.24);
  return c;
}

function drawLog(): HTMLCanvasElement {
  const { c, g } = metric(-1.5, -0.17, 1.5, 0.38);
  g.fillStyle = '#2d221c';
  g.beginPath();
  g.roundRect(-1.3, -0.17, 2.6, 0.34, 0.15);
  g.fill();
  g.strokeStyle = '#4a382c';
  g.lineWidth = 0.02;
  for (const x of [-0.8, -0.1, 0.7]) {
    g.beginPath();
    g.moveTo(x, -0.14);
    g.lineTo(x + 0.15, 0.14);
    g.stroke();
  }
  g.fillStyle = '#2b4a3a';
  for (const [x, w] of [
    [-0.9, 0.5],
    [0.1, 0.7],
    [0.95, 0.3],
  ]) {
    g.beginPath();
    g.ellipse(x, 0.17, w / 2, 0.07, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function drawHyacinth(): HTMLCanvasElement {
  const { c, g } = metric(-1.05, -0.12, 1.05, 0.58);
  g.fillStyle = '#16372c';
  for (let i = -4; i <= 4; i++) {
    g.beginPath();
    g.ellipse(i * 0.2, 0.06, 0.2, 0.13 + (i % 2) * 0.03, i * 0.12, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#245443';
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.ellipse(i * 0.24 + 0.06, 0.13, 0.12, 0.08, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (const x of [-0.35, 0.4]) {
    g.strokeStyle = '#245443';
    g.lineWidth = 0.025;
    g.beginPath();
    g.moveTo(x, 0.12);
    g.lineTo(x, 0.4);
    g.stroke();
    g.fillStyle = '#b9c8f0';
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * 0.06, 0.42 + Math.sin(a) * 0.05, 0.05, 0.035, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e6d27a';
    g.beginPath();
    g.arc(x, 0.42, 0.02, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** A crocodile seen from the side, facing right, swimming: the water line is half way up (config CROC.lineSurfaced). */
function drawCroc(): HTMLCanvasElement {
  const { c, g } = sheet(4, 1.27);
  g.fillStyle = '#2b4636';
  g.beginPath();
  g.ellipse(2.0, 0.64, 1.35, 0.4, 0, 0, Math.PI * 2);
  g.fill();
  // tail curling down on the left, snout on the right
  g.beginPath();
  g.moveTo(0.8, 0.8);
  g.quadraticCurveTo(0.1, 0.9, 0.1, 0.1);
  g.quadraticCurveTo(0.5, 0.5, 0.9, 0.5);
  g.fill();
  g.beginPath();
  g.moveTo(3.1, 0.82);
  g.lineTo(3.95, 0.66);
  g.lineTo(3.95, 0.55);
  g.lineTo(3.1, 0.5);
  g.fill();
  g.beginPath();
  g.arc(3.2, 0.9, 0.12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffd98a';
  g.beginPath();
  g.arc(3.2, 0.93, 0.035, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1b3126';
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(0.9 + i * 0.19, 0.99);
    g.lineTo(0.97 + i * 0.19, 1.08);
    g.lineTo(1.04 + i * 0.19, 0.99);
    g.fill();
  }
  return c;
}

/* ---------------- loading ---------------- */

/** Files that are cut to their visible pixels when loaded (the layers and the sky are used whole). */
const TRIMMED = new Set(['moon', 'boat', 'lantern-off', 'lantern-on', 'dock', 'log', 'hyacinth', 'croc'].map((n) => `${n}.webp`));

/**
 * The visible part of an image: rows and columns that have at least 3 reasonably opaque pixels
 * (a stray speck at an edge does not count).
 */
function visibleFrame(img: HTMLImageElement): Rectangle | null {
  const { c, g } = canvas(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, 0, 0);
  const w = c.width;
  const h = c.height;
  const d = g.getImageData(0, 0, w, h).data;
  const rows = new Uint16Array(h);
  const cols = new Uint16Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const first = (a: Uint16Array): number => a.findIndex((n) => n >= 3);
  const last = (a: Uint16Array): number => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= 3) return i;
    return -1;
  };
  const x0 = first(cols);
  const x1 = last(cols);
  const y0 = first(rows);
  const y1 = last(rows);
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return null;
  return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Try to load public/night/<file>; null if it is not there. */
function tryLoad(file: string): Promise<Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const frame = TRIMMED.has(file) ? visibleFrame(img) : null;
      if (!frame) return resolve(Texture.from(img));
      const { c, g } = canvas(frame.width, frame.height);
      g.drawImage(img, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
      resolve(Texture.from(c));
    };
    img.onerror = () => resolve(null);
    img.src = `${import.meta.env.BASE_URL}night/${file}`;
  });
}

/** Drawn and loaded once: leaving the game and coming back reuses the textures. */
let cached: Promise<Art> | null = null;

export function loadArt(): Promise<Art> {
  cached ??= buildArt().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

async function buildArt(): Promise<Art> {
  const found = new Map<string, Texture>();
  const results = await Promise.all(ART_FILES.map((f) => tryLoad(f)));
  ART_FILES.forEach((f, i) => {
    const t = results[i];
    if (t) found.set(f, t);
  });
  const pick = (file: string, make: () => HTMLCanvasElement, repeat?: 'x'): Texture => {
    const real = found.get(file);
    if (real) {
      if (repeat) wrapMode(real, repeat);
      return real;
    }
    return tex(make(), repeat);
  };
  return {
    sky: pick('sky.webp', drawSky),
    moon: pick('moon.webp', drawMoon),
    far: pick('far.webp', () => drawBank('far'), 'x'),
    mid: pick('mid.webp', () => drawBank('mid'), 'x'),
    front: pick('front.webp', () => drawBank('front'), 'x'),
    boat: pick('boat.webp', drawBoat),
    lanternOff: pick('lantern-off.webp', () => drawLantern(false)),
    lanternOn: pick('lantern-on.webp', () => drawLantern(true)),
    dock: pick('dock.webp', drawDock),
    log: pick('log.webp', drawLog),
    hyacinth: pick('hyacinth.webp', drawHyacinth),
    croc: pick('croc.webp', drawCroc),
    glow: tex(drawGlow()),
    ring: tex(drawRing()),
    ramp: tex(drawRamp()),
    real: [...found.keys()],
  };
}
