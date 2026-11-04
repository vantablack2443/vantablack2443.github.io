import { Application, Container, Graphics, Mesh, MeshGeometry, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import type { Art } from './assets';
import { Camera } from './camera';
import {
  BOAT,
  CROC,
  DOCK,
  DOCKS,
  DOCK_ART,
  FLOATERS,
  LANTERN,
  LANTERNS,
  LAYERS,
  MOON,
  ROPES,
  SAFE,
  SPRITES,
  VIEW,
  WATER,
  WORLD,
  dockPostZ,
  dockTipZ,
  type SpriteSpec,
} from './config';
import type { River, RiverEvent } from './sim';

/**
 * The PixiJS scene. It reads the sim every frame and never writes to it. The river is drawn in a
 * low-angle perspective (camera.ts is the one place that projects metres to pixels), back to front:
 *
 *   sky, stars, moon  ->  far bank (parallax 0.12)  ->  mid bank (0.4; its bottom edge is the far
 *   edge of the water)  ->  the water mesh  ->  reflections and safe circles  ->  everything on
 *   the water sorted by depth z, far to near (docks, lanterns, logs, hyacinth, crocodiles, the
 *   boat)  ->  ropes, poles and branches  ->  the foreground plants along the bottom edge  ->
 *   labels  ->  additive glow  ->  darkness.
 *
 * Every sprite is side-on art, flipped by the sign of its heading's x and squeezed by
 * max(0.55, |cos yaw|) as it turns across the river, and clipped at the water surface under it
 * (Clipped below): a column of the sprite is cut where the surface crosses it, so the boat shows
 * its draught and a crocodile can sink until only its eyes and ridge show. The hot loop allocates
 * nothing: meshes and lines write into fixed buffers, sprites and particles come from pools.
 */

const MAX_PARTICLES = 200;
const COLS = 14;

/** Straight line segments drawn as quads into a fixed buffer (ropes, chains, poles). */
class Lines {
  readonly mesh: Mesh<MeshGeometry>;
  private readonly pos: Float32Array;
  private n = 0;

  constructor(
    readonly capacity: number,
    color: number,
    alpha = 1,
  ) {
    this.pos = new Float32Array(capacity * 8);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    const geometry = new MeshGeometry({ positions: this.pos, uvs: new Float32Array(capacity * 8), indices: idx });
    this.mesh = new Mesh({ geometry, texture: Texture.WHITE });
    this.mesh.tint = color;
    this.mesh.alpha = alpha;
  }

  begin(): void {
    this.n = 0;
  }

  /** A segment of width w px. */
  seg(x0: number, y0: number, x1: number, y1: number, w: number): void {
    if (this.n >= this.capacity) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * w * 0.5;
    const ny = (dx / l) * w * 0.5;
    const p = this.pos;
    const o = this.n * 8;
    p[o] = x0 + nx;
    p[o + 1] = y0 + ny;
    p[o + 2] = x0 - nx;
    p[o + 3] = y0 - ny;
    p[o + 4] = x1 + nx;
    p[o + 5] = y1 + ny;
    p[o + 6] = x1 - nx;
    p[o + 7] = y1 - ny;
    this.n++;
  }

  end(): void {
    this.pos.fill(0, this.n * 8);
    this.mesh.geometry.getBuffer('aPosition').update();
  }
}

/**
 * A side-on sprite clipped at the water surface: a strip of COLS quads. For each column the line
 * from its top to its bottom is cut where the surface (its screen y at that column, `wl`) crosses
 * it, and the texture coordinate of the bottom vertex follows. A column wholly under water
 * collapses to nothing.
 */
class Clipped {
  readonly mesh: Mesh<MeshGeometry>;
  readonly wl = new Float32Array(COLS + 1);
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;

  constructor(readonly texture: Texture) {
    const n = (COLS + 1) * 2;
    this.pos = new Float32Array(n * 2);
    this.uv = new Float32Array(n * 2);
    const idx = new Uint32Array(COLS * 6);
    for (let i = 0; i < COLS; i++) idx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
    const geometry = new MeshGeometry({ positions: this.pos, uvs: this.uv, indices: idx });
    this.mesh = new Mesh({ geometry, texture });
  }

  /**
   * Place it: pivot (px, py) on screen, size in px, the anchor (fraction of the image), a screen
   * rotation about the pivot, mirrored or not; `this.wl` holds the water's screen y per column.
   */
  place(px: number, py: number, w: number, h: number, ax: number, ay: number, rot: number, flip: boolean): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const axs = flip ? 1 - ax : ax;
    const top = -ay * h;
    const bot = (1 - ay) * h;
    const pos = this.pos;
    const uv = this.uv;
    for (let j = 0; j <= COLS; j++) {
      const t = j / COLS;
      const lx = (t - axs) * w;
      const tx = px + lx * c - top * s;
      const ty = py + lx * s + top * c;
      const bx = px + lx * c - bot * s;
      const by = py + lx * s + bot * c;
      // where the surface cuts this column (t along top -> bottom)
      const dy = by - ty;
      let k = dy > 1e-6 ? (this.wl[j] - ty) / dy : 1;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const o = j * 4;
      pos[o] = tx;
      pos[o + 1] = ty;
      pos[o + 2] = tx + (bx - tx) * k;
      pos[o + 3] = ty + (by - ty) * k;
      const u = flip ? 1 - t : t;
      uv[o] = u;
      uv[o + 1] = 0;
      uv[o + 2] = u;
      uv[o + 3] = k;
    }
    this.mesh.geometry.getBuffer('aPosition').update();
    this.mesh.geometry.getBuffer('aUV').update();
  }
}

interface DockView {
  sprite: Clipped;
  lamp: Sprite;
  glow: Sprite;
  label: Text;
}

interface LanternView {
  off: Sprite;
  on: Sprite;
  glow: Sprite;
  streak: Sprite;
  ring: Sprite;
}

interface FloaterView {
  sprite: Clipped;
}

const wrapPi = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Renderer {
  readonly cam = new Camera();
  private readonly app: Application;
  private readonly art: Art;
  private readonly reduced: boolean;
  private sim: River | null = null;
  private debug = false;

  private W = 1;
  private H = 1;
  private shake = 0;
  private clock = 0;
  /** Lights on, 0..1: the start sequence ramps it. */
  private light = 0;
  private lightTarget = 0;
  private target: { x: number; z: number } | null = null;
  private targetAge = 0;

  // layers
  private readonly sky: Sprite;
  private readonly stars: Sprite[] = [];
  private readonly moonGlow: Sprite;
  private readonly moon: Sprite;
  private readonly far: TilingSprite;
  private readonly mid: TilingSprite;
  private readonly front: TilingSprite;
  private readonly nearBank = new Graphics();
  private readonly things = new Container();
  private readonly labels = new Container();
  private readonly fx = new Container();
  private readonly glowLayer = new Container();
  private readonly dark = new Graphics();
  private readonly debugG = new Graphics();

  // world contents
  private readonly docks: DockView[] = [];
  private readonly lanterns: LanternView[] = [];
  private readonly floaters: FloaterView[] = [];
  private readonly crocs: Clipped[] = [];
  private readonly boat: Clipped;
  private readonly boatGlow: Sprite;
  private readonly boatStreak: Sprite;
  private readonly moonStreak: Sprite[] = [];
  private readonly targetRing: Sprite;
  private readonly ropes = new Lines(160, 0x7a6650);
  private readonly poles = new Lines(120, 0x0a1522);

  // the water mesh: a world-anchored grid of GX x DZ, one row per DZ across the river
  private readonly GX = 0.5;
  private readonly rows = 41;
  private cols = 0;
  private waterGeo: MeshGeometry;
  private water: Mesh<MeshGeometry>;
  private wh = new Float32Array(0);

  // fireflies and particles
  private readonly flies: Sprite[] = [];
  private readonly pSprites: Sprite[] = [];
  private readonly pData = new Float32Array(MAX_PARTICLES * 10); // x y z vx vy vz life max size gravity
  private pNext = 0;
  private celebrate = 0;

  constructor(app: Application, art: Art, labels: string[], reduced: boolean) {
    this.app = app;
    this.art = art;
    this.reduced = reduced;
    const stage = app.stage;

    // ---- sky (fixed) ----
    this.sky = new Sprite(art.sky);
    stage.addChild(this.sky);
    for (let i = 0; i < 26; i++) {
      const st = new Sprite(art.glow);
      st.anchor.set(0.5);
      st.blendMode = 'add';
      st.tint = i % 4 === 0 ? 0xcfe0ff : 0xffffff;
      stage.addChild(st);
      this.stars.push(st);
    }
    this.moonGlow = new Sprite(art.glow);
    this.moonGlow.anchor.set(0.5);
    this.moonGlow.blendMode = 'add';
    this.moonGlow.tint = 0xfff1c9;
    this.moon = new Sprite(art.moon);
    this.moon.anchor.set(0.5);
    stage.addChild(this.moonGlow, this.moon);

    // ---- banks and the water ----
    this.far = new TilingSprite({ texture: art.far });
    this.mid = new TilingSprite({ texture: art.mid });
    this.front = new TilingSprite({ texture: art.front });
    stage.addChild(this.far, this.mid, this.nearBank);
    this.waterGeo = new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array(6) });
    this.water = new Mesh({ geometry: this.waterGeo, texture: art.ramp });
    stage.addChild(this.water);

    // reflections, safe circles and the tap target sit on the water, additive
    for (let i = 0; i < 12; i++) {
      const sp = new Sprite(art.glow);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      sp.tint = 0xfff1c9;
      this.fx.addChild(sp);
      this.moonStreak.push(sp);
    }
    this.targetRing = new Sprite(art.ring);
    this.targetRing.anchor.set(0.5);
    this.targetRing.blendMode = 'add';
    this.targetRing.tint = 0x9ec8ff;
    this.targetRing.visible = false;
    this.fx.addChild(this.targetRing);
    stage.addChild(this.fx);

    // ---- things on the water, sorted by depth ----
    this.things.sortableChildren = true;
    stage.addChild(this.things);

    DOCKS.forEach((_, i) => {
      const sprite = new Clipped(art.dock);
      const lamp = new Sprite(art.lanternOn);
      lamp.anchor.set(0.5);
      lamp.visible = false;
      const glow = this.glowSprite(0xffb347);
      const label = new Text({
        text: labels[i] ?? '',
        style: {
          fontFamily: 'Geist, system-ui, sans-serif',
          fontSize: 15,
          fontWeight: '600',
          fill: '#e8eef6',
          stroke: { color: '#050a14', width: 4, join: 'round' },
          align: 'center',
        },
      });
      label.anchor.set(0.5, 1);
      this.things.addChild(sprite.mesh, lamp);
      this.labels.addChild(label);
      this.docks.push({ sprite, lamp, glow, label });
    });

    LANTERNS.forEach(() => {
      const off = new Sprite(art.lanternOff);
      const on = new Sprite(art.lanternOn);
      off.anchor.set(0.5);
      on.anchor.set(0.5);
      on.alpha = 0;
      this.things.addChild(off, on);
      const streak = this.glowSprite(0xffb347);
      streak.visible = false;
      this.fx.addChild(streak);
      const ring = new Sprite(art.ring);
      ring.anchor.set(0.5);
      ring.blendMode = 'add';
      ring.tint = 0xffb347;
      ring.visible = false;
      this.fx.addChild(ring);
      this.lanterns.push({ off, on, glow: this.glowSprite(0xffb347), streak, ring });
    });

    for (const f of FLOATERS) {
      const sprite = new Clipped(f.kind === 'log' ? art.log : art.hyacinth);
      this.things.addChild(sprite.mesh);
      this.floaters.push({ sprite });
    }
    for (let i = 0; i < CROC.count; i++) {
      const c = new Clipped(art.croc);
      c.mesh.visible = false;
      this.things.addChild(c.mesh);
      this.crocs.push(c);
    }
    this.boat = new Clipped(art.boat);
    this.things.addChild(this.boat.mesh);
    this.boatGlow = this.glowSprite(0xffb347);
    this.boatStreak = this.glowSprite(0xffb347);
    this.fx.addChild(this.boatStreak);

    // ---- ropes and poles, the foreground, labels, glow, darkness ----
    stage.addChild(this.ropes.mesh, this.poles.mesh, this.front, this.labels);
    for (const l of this.lanterns) this.glowLayer.addChild(l.glow);
    for (const d of this.docks) this.glowLayer.addChild(d.glow);
    this.glowLayer.addChild(this.boatGlow);
    if (!reduced) {
      for (let i = 0; i < 40; i++) {
        const f = this.glowSprite(i % 3 === 0 ? 0xd8ff9a : 0xffe08a);
        this.glowLayer.addChild(f);
        this.flies.push(f);
      }
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.glowSprite(0xffffff);
      p.visible = false;
      this.glowLayer.addChild(p);
      this.pSprites.push(p);
    }
    stage.addChild(this.glowLayer, this.dark, this.debugG);
    this.layoutStatic();
  }

  /** An additive soft glow (alpha 0, scaled per frame). */
  private glowSprite(tint: number): Sprite {
    const s = new Sprite(this.art.glow);
    s.anchor.set(0.5);
    s.tint = tint;
    s.blendMode = 'add';
    s.alpha = 0;
    return s;
  }

  setDebug(on: boolean): void {
    this.debug = on;
    this.debugG.visible = on;
  }

  /* ---------------- sim, events, lights ---------------- */

  setSim(sim: River): void {
    this.sim = sim;
    this.cam.x = sim.boat.cx;
    for (const p of this.pSprites) p.visible = false;
    this.celebrate = 0;
    this.shake = 0;
    this.target = null;
  }

  /** Lights on (the start sequence) or off (idle, in the dark). */
  setLights(on: boolean, instant = false): void {
    this.lightTarget = on ? 1 : 0;
    if (instant) this.light = this.lightTarget;
  }

  get lightsOn(): boolean {
    return this.lightTarget > 0;
  }

  /** The tap-to-go marker (null clears it). */
  setTarget(t: { x: number; z: number } | null): void {
    if (t && (!this.target || this.target.x !== t.x || this.target.z !== t.z)) this.targetAge = 0;
    this.target = t;
  }

  /** The water point under a screen position (CSS px), clamped to the river, or null above the far bank. */
  toWorld(px: number, py: number): { x: number; z: number } | null {
    const cam = this.cam;
    const z = cam.waterZ(py);
    if (z === null) return null;
    const zc = Math.max(0.8, Math.min(WORLD.width - 0.8, z));
    return { x: Math.max(0.5, Math.min(WORLD.length - 0.5, cam.worldX(px, zc))), z: zc };
  }

  /** Sparks, shakes and splashes for sim events. */
  onEvent(e: RiverEvent): void {
    const sim = this.sim;
    if (!sim) return;
    switch (e.type) {
      case 'stroke':
        if (this.light > 0.3) this.emit(e.x, 0.05, e.z, 7, 2.2, 0xbcd8ff, 0.2, 9);
        break;
      case 'lantern': {
        const l = sim.lanterns[e.index];
        this.emit(l.x, l.y, l.z, 14, 2.4, 0xffb347, 0.35, 3.5);
        break;
      }
      case 'moor': {
        const p = sim.postOf(e.dock);
        this.emit(p.x, 1.2, p.z, e.first ? 22 : 8, 2.8, 0xffd98a, 0.35, 4);
        break;
      }
      case 'bump':
      case 'hit':
      case 'bank':
        if (!this.reduced) this.shake = Math.max(this.shake, Math.min(1, 0.2 + e.speed * 0.12));
        break;
      case 'lunge': {
        this.emit(e.x, 0.1, e.z, 16, 3.5, 0xdbeaff, 0.3, 9);
        break;
      }
      case 'bite': {
        const b = sim.boat;
        this.emit(b.cx, 0.6, b.cz, 30, 4.5, 0xdbeaff, 0.4, 8);
        this.emit(b.cx, 0.6, b.cz, 10, 3, 0xff6a5a, 0.3, 6);
        if (!this.reduced) this.shake = 1;
        break;
      }
      case 'clear':
        this.celebrate = this.reduced ? 0.01 : 3.2;
        this.burst(sim.boat.cx, sim.boat.cz);
        break;
      default:
        break;
    }
  }

  /** Spawn n particles at a world point with a spread speed, a tint, a size (m) and gravity. */
  private emit(x: number, y: number, z: number, n: number, speed: number, tint: number, size: number, gravity: number): void {
    const d = this.pData;
    for (let i = 0; i < n; i++) {
      const k = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      d[k * 10] = x;
      d[k * 10 + 1] = y;
      d[k * 10 + 2] = z;
      d[k * 10 + 3] = Math.cos(a) * v * 0.6;
      d[k * 10 + 4] = Math.abs(Math.sin(a)) * v + 0.6;
      d[k * 10 + 5] = Math.sin(a) * v * 0.4;
      d[k * 10 + 6] = 0.7 + Math.random() * 0.6;
      d[k * 10 + 7] = d[k * 10 + 6];
      d[k * 10 + 8] = size;
      d[k * 10 + 9] = gravity;
      const sp = this.pSprites[k];
      sp.tint = tint;
      sp.visible = true;
    }
  }

  private burst(cx: number, cz: number): void {
    const colors = [0xffb347, 0xff7a9a, 0x9ec8ff, 0xd8ff9a, 0xffe08a];
    const x = cx + (Math.random() - 0.5) * 10;
    const z = Math.max(2, Math.min(WORLD.width - 2, cz + (Math.random() - 0.5) * 8));
    this.emit(x, 3 + Math.random() * 2, z, 18, 3.6, colors[(Math.random() * colors.length) | 0], 0.4, 2.5);
  }

  /* ---------------- layout ---------------- */

  /** Fit to a new size in CSS pixels. */
  resize(w: number, h: number): void {
    this.W = Math.max(1, w);
    this.H = Math.max(1, h);
    this.cam.layout(this.W, this.H);
    this.layoutStatic();
  }

  private layoutStatic(): void {
    const { W, H, cam } = this;
    const art = this.art;
    // sky: cover the screen
    const k = Math.max(W / art.sky.width, H / art.sky.height);
    this.sky.scale.set(k);
    this.sky.position.set((W - art.sky.width * k) / 2, (H - art.sky.height * k) / 2);
    const r = (n: number): number => {
      const x = Math.sin(n * 91.3) * 43758.5453;
      return x - Math.floor(x);
    };
    this.stars.forEach((st, i) => {
      st.position.set(r(i + 1) * W, r(i + 40) * cam.farY * 0.8);
      st.scale.set((0.005 + r(i + 80) * 0.01) * (Math.min(W, 1200) / 100));
    });
    const moonPx = SPRITES.moon.width * cam.scale(WORLD.width);
    this.moon.scale.set(moonPx / art.moon.width);
    this.moonGlow.scale.set((moonPx * 2.6) / art.glow.width);

    // banks: heights are metres at the far edge; the mid layer's bottom is the far edge of the water
    const sFar = cam.scale(WORLD.width);
    const layer = (ts: TilingSprite, tex: Texture, spec: { height: number; tuck: number }): void => {
      const hPx = spec.height * sFar;
      ts.width = W;
      ts.height = hPx;
      ts.tileScale.set(hPx / tex.height);
      ts.position.set(0, cam.farY + spec.tuck * hPx - hPx);
    };
    layer(this.far, art.far, LAYERS.far);
    layer(this.mid, art.mid, LAYERS.mid);
    // the foreground strip along the very bottom of the screen
    const fh = LAYERS.front.height * H;
    this.front.width = W;
    this.front.height = fh;
    this.front.tileScale.set(fh / art.front.height);
    this.front.position.set(0, H - fh);
    this.nearBank.clear().rect(0, cam.nearY, W, Math.max(0, H - cam.nearY)).fill({ color: 0x04101c });

    this.dark.clear().rect(0, 0, W, H).fill({ color: 0x02040c });

    // the water grid: enough columns to cover the far edge's width, world anchored
    const half = cam.halfWidthAt(WORLD.width) + 1.5;
    const cols = Math.ceil((2 * half) / this.GX) + 2;
    if (cols !== this.cols) {
      this.cols = cols;
      const n = cols * this.rows;
      this.wh = new Float32Array(n);
      const idx = new Uint32Array((cols - 1) * (this.rows - 1) * 6);
      let o = 0;
      for (let rr = 0; rr < this.rows - 1; rr++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = rr * cols + c;
          const b = a + cols;
          idx.set([a, a + 1, b, a + 1, b + 1, b], o);
          o += 6;
        }
      }
      const geo = new MeshGeometry({ positions: new Float32Array(n * 2), uvs: new Float32Array(n * 2), indices: idx });
      this.water.geometry = geo;
      this.waterGeo.destroy();
      this.waterGeo = geo;
    }
    for (const d of this.docks) d.label.style.fontSize = Math.max(11, Math.min(17, cam.scale(8) * 0.2));
  }

  /* ---------------- per frame ---------------- */

  /** Update the scene from the sim and draw it. `alpha` is the fraction of the next physics step. */
  draw(alpha: number, dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    this.clock += dt;
    const cam = this.cam;
    const { W } = this;

    // lights ramp (the start sequence)
    const ramp = this.reduced ? 0.4 : 1.6;
    this.light += Math.sign(this.lightTarget - this.light) * Math.min(Math.abs(this.lightTarget - this.light), dt / ramp);
    const light = this.light;

    // camera: follow the boat along the river with smoothing and a look ahead; z is not followed
    const boat = sim.boat;
    const bx = boat.px + (boat.cx - boat.px) * alpha;
    const bz = boat.pz + (boat.cz - boat.pz) * alpha;
    const vx = boat.body.getLinearVelocity().x;
    const ahead = Math.max(-VIEW.lookAheadMax, Math.min(VIEW.lookAheadMax, vx * VIEW.lookAhead));
    const half = cam.halfWidthAt(WORLD.width / 2);
    const target = half * 2 >= WORLD.length ? WORLD.length / 2 : Math.max(half, Math.min(WORLD.length - half, bx + ahead));
    cam.x += (target - cam.x) * (1 - Math.exp(-VIEW.follow * dt));

    // camera shake (off under reduced motion: shake is never set)
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    cam.ox = sh ? Math.sin(this.clock * 61) * sh * 7 : 0;
    cam.oy = sh ? Math.cos(this.clock * 53) * sh * 5 : 0;

    this.drawSky(sim, light);
    const sFar = cam.scale(WORLD.width);
    const sNear = cam.scale(0);
    this.far.tilePosition.x = -cam.x * VIEW.parallax.far * sFar + cam.ox * 0.3;
    this.mid.tilePosition.x = -cam.x * VIEW.parallax.mid * sFar + cam.ox * 0.5;
    this.front.tilePosition.x = -cam.x * VIEW.parallax.front * sNear + cam.ox * 1.4;
    this.mid.y = cam.farY + cam.oy * 0.5 - this.mid.height;
    this.far.y = cam.farY + LAYERS.far.tuck * this.far.height + cam.oy * 0.3 - this.far.height;

    this.drawWater(sim, light);
    this.drawMoonStreak(sim, light);

    // the lists below set zIndex by depth: far to near
    const zi = (z: number): number => (WORLD.width + 4 - z) * 100;

    // docks
    DOCKS.forEach((d, i) => {
      const v = this.docks[i];
      const z = dockTipZ(d);
      const s = cam.scale(z);
      const spec = SPRITES.dock;
      const w = spec.width * s;
      const h = (w * this.art.dock.height) / this.art.dock.width;
      const px = cam.sx(d.x + spec.at[0], s);
      const visible = px > -w && px < W + w;
      v.sprite.mesh.visible = v.lamp.visible = v.label.visible = visible;
      v.glow.visible = visible;
      if (!visible) return;
      // the water under the dock; the deck stands in it, so the surface cuts its stilts
      const py = cam.sy(this.water_(sim, d.x, z) + spec.at[1], s);
      this.clipColumns(v.sprite, d.x, z, spec.width, spec.anchor[0], 1, 0, false, s);
      v.sprite.place(px, py, w, h, spec.anchor[0], spec.anchor[1], 0, false);
      v.sprite.mesh.zIndex = zi(z);
      // the lamp on the sign pole lights when the project has been visited; the label sits over the sign
      const lx = px + (DOCK_ART.lamp[0] - spec.anchor[0]) * w;
      const ly = py + (DOCK_ART.lamp[1] - spec.anchor[1]) * h;
      const visited = sim.visited[i];
      v.lamp.visible = visited;
      v.lamp.position.set(lx, ly);
      v.lamp.scale.set((0.34 * s) / this.art.lanternOn.width);
      v.lamp.zIndex = zi(z) + 1;
      const flicker = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.clock * 7 + i * 2.1);
      v.glow.position.set(lx, ly);
      v.glow.scale.set((3 * s) / this.art.glow.width);
      v.glow.alpha = visited ? 0.9 * flicker : 0;
      const sx = px + (DOCK_ART.sign[0] - spec.anchor[0]) * w;
      const sy = py + (DOCK_ART.sign[1] - spec.anchor[1]) * h;
      v.label.position.set(sx, sy + 8);
      v.label.anchor.set(0.5, 0.5);
      if (v.label.tint !== (visited ? 0xffd98a : 0xffffff)) v.label.tint = visited ? 0xffd98a : 0xffffff;
      v.label.alpha = 0.55 + 0.45 * light;
    });

    this.drawLanterns(sim, alpha, light, zi);

    // logs and rafts
    sim.floaters.forEach((f, i) => {
      const t = f.tracked;
      const x = t.px + (t.cx - t.px) * alpha;
      const z = t.pz + (t.cz - t.pz) * alpha;
      const yaw = this.lerpAngle(t.pa, t.ca, alpha);
      const spec = f.kind === 'log' ? SPRITES.log : SPRITES.hyacinth;
      const tex = f.kind === 'log' ? this.art.log : this.art.hyacinth;
      this.placeFloating(this.floaters[i].sprite, tex, spec, spec.anchor[1], x, z, this.lerp(f.buoy.py, f.buoy.y, alpha), yaw, this.rot(f.buoy, yaw, alpha), zi(z));
    });

    // crocodiles: the water line in the sprite moves between surfaced and lurking
    sim.crocs.forEach((c, i) => {
      const v = this.crocs[i];
      v.mesh.visible = c.awake;
      if (!c.awake) return;
      const t = c.tracked;
      const x = t.px + (t.cx - t.px) * alpha;
      const z = t.pz + (t.cz - t.pz) * alpha;
      const yaw = this.lerpAngle(t.pa, t.ca, alpha);
      this.placeFloating(v, this.art.croc, SPRITES.croc, c.line, x, z, this.lerp(c.buoy.py, c.buoy.y, alpha), yaw, this.rot(c.buoy, yaw, alpha), zi(z));
    });

    // the boat, and the warm lantern glowing inside the canopy
    const byaw = this.lerpAngle(boat.pa, boat.ca, alpha);
    const bb = sim.boatBuoy;
    const by = this.lerp(bb.py, bb.y, alpha);
    this.placeFloating(this.boat, this.art.boat, SPRITES.boat, SPRITES.boat.anchor[1], bx, bz, by, byaw, this.rot(bb, byaw, alpha), zi(bz));
    {
      const s = cam.scale(bz);
      this.boatGlow.position.set(cam.sx(bx, s), cam.sy(by + 1.0, s));
      this.boatGlow.scale.set((4.2 * s) / this.art.glow.width);
      this.boatGlow.alpha = 0.7 * light * (this.reduced ? 1 : 0.92 + 0.08 * Math.sin(this.clock * 6));
      this.boatStreak.position.set(cam.sx(bx, s) + this.wobble(bx, bz, 0.12 * s), cam.sy(-1.1, s));
      this.boatStreak.scale.set((1.2 * s) / this.art.glow.width, (3.2 * s) / this.art.glow.width);
      this.boatStreak.alpha = 0.3 * light;
    }

    this.drawRopes(sim, bx, bz, byaw, by, alpha);
    this.drawGlow(dt, light);

    // the tap target, a ring on the water
    const tr = this.targetRing;
    tr.visible = this.target !== null && sim.phase === 'playing';
    if (tr.visible && this.target) {
      this.targetAge += dt;
      const s = cam.scale(this.target.z);
      const pulse = 1 + 0.12 * Math.sin(this.targetAge * 6);
      tr.position.set(cam.sx(this.target.x, s), cam.sy(0, s));
      tr.scale.set((1.8 * s * pulse) / this.art.ring.width, (1.8 * s * pulse * 0.32) / this.art.ring.width);
      tr.alpha = 0.8;
    }

    this.dark.alpha = 0.6 * (1 - light);
    if (this.debug) this.drawDebug(sim);
    this.app.renderer.render(this.app.stage);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  private lerpAngle(a: number, b: number, t: number): number {
    return a + wrapPi(b - a) * t;
  }

  /** The screen rotation of a sprite: the pitch shows when it is side on, the roll when it heads across the river. */
  private rot(b: { pitch: number; ppitch: number; roll: number; proll: number }, yaw: number, alpha: number): number {
    const p = this.lerp(b.ppitch, b.pitch, alpha);
    const r = this.lerp(b.proll, b.roll, alpha);
    return -p * Math.cos(yaw) - r * Math.sin(yaw);
  }

  /** Water height at (x, z) as the sim sees it. */
  private water_(sim: River, x: number, z: number): number {
    return sim.water.heightAt(x, z);
  }

  /** The water surface's screen y under each column of a clipped sprite that stands at world (x, z) and spans `width` m along the heading. */
  private clipColumns(c: Clipped, x: number, z: number, width: number, ax: number, dirX: number, dirZ: number, flip: boolean, s: number): void {
    const sim = this.sim;
    if (!sim) return;
    const cam = this.cam;
    for (let j = 0; j <= COLS; j++) {
      const t = j / COLS;
      const u = flip ? 1 - t : t; // the art's own coordinate: its bow is at u = 1
      const f = (u - ax) * width;
      const wx = x + f * dirX;
      const wz = z + f * dirZ;
      c.wl[j] = cam.sy(this.water_(sim, wx, Math.max(0.2, Math.min(WORLD.width - 0.2, wz))), s);
    }
  }

  /**
   * Place a sprite that floats: pivot on the water at (x, z) with its datum height, heading yaw.
   * `anchorY` is the water line's place in the image (a crocodile moves it).
   */
  private placeFloating(c: Clipped, tex: Texture, spec: SpriteSpec, anchorY: number, x: number, z: number, y: number, yaw: number, rot: number, zIndex: number): void {
    const cam = this.cam;
    const s = cam.scale(z);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const fx = Math.max(0.55, Math.abs(cy));
    const flip = cy < 0;
    const wPx = spec.width * s * fx;
    const hPx = (wPx * tex.height) / tex.width;
    const px = cam.sx(x, s);
    const visible = px > -wPx && px < this.W + wPx;
    c.mesh.visible = visible;
    if (!visible) return;
    c.mesh.zIndex = zIndex;
    this.clipColumns(c, x, z, spec.width, spec.anchor[0], cy, sy, flip, s);
    c.place(px, cam.sy(y + spec.at[1], s), wPx, hPx, spec.anchor[0], anchorY, rot, flip);
  }

  /** A small sideways wobble from the surface slope and time (px). */
  private wobble(x: number, z: number, amp: number): number {
    const sim = this.sim;
    if (!sim) return 0;
    const sl = sim.water.slopeAt(x, z);
    return (this.reduced ? 0 : Math.sin(this.clock * 2.3 + x * 0.7) * amp * 0.5) + sl.x * amp * 8;
  }

  private drawSky(sim: River, light: number): void {
    const { W, cam } = this;
    // the moon is the timer: it rises from the left, crosses, and sets on the right
    const t = sim.phase === 'idle' ? 0 : Math.min(1, sim.elapsed / WORLD.nightSeconds);
    const mx = (MOON.x0 + (MOON.x1 - MOON.x0) * t) * W;
    const skyH = cam.farY * 0.9;
    const my = (MOON.yLow - (MOON.yLow - MOON.yHigh) * Math.sin(Math.PI * t)) * skyH;
    this.moon.position.set(mx, my);
    this.moonGlow.position.set(mx, my);
    this.moonGlow.alpha = 0.35 + 0.25 * light;
    for (let i = 0; i < this.stars.length; i++) {
      const tw = this.reduced ? 0.7 : 0.55 + 0.45 * Math.sin(this.clock * (0.8 + (i % 5) * 0.35) + i * 3.1);
      this.stars[i].alpha = tw * (0.5 + 0.5 * light) * 0.9;
    }
  }

  /** The water mesh: each vertex projected, its height from the field, shaded by the surface slope and the moon. */
  private drawWater(sim: River, light: number): void {
    const { cam, cols, rows, GX } = this;
    const water = sim.water;
    const half = cam.halfWidthAt(WORLD.width) + 1.5;
    const first = Math.floor((cam.x - half) / GX);
    const dz = WORLD.width / (rows - 1);
    const H = this.wh;
    for (let r = 0; r < rows; r++) {
      const z = r * dz;
      for (let c = 0; c < cols; c++) H[r * cols + c] = water.heightAt((first + c) * GX, z);
    }
    const pos = this.waterGeo.positions;
    const uv = this.waterGeo.uvs;
    const moonX = this.moon.x;
    const mvis = this.reduced ? 0.8 : 1;
    for (let r = 0; r < rows; r++) {
      const z = r * dz;
      const s = cam.scale(z);
      const near = 1 - z / WORLD.width;
      const spread = this.W * (0.06 + 0.05 * near);
      const rm = r > 0 ? r - 1 : r;
      const rp = r < rows - 1 ? r + 1 : r;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (first + c) * GX;
        const cm = c > 0 ? c - 1 : c;
        const cp = c < cols - 1 ? c + 1 : c;
        const hx = (H[r * cols + cp] - H[r * cols + cm]) / ((cp - cm) * GX || 1);
        const hz = (H[rp * cols + c] - H[rm * cols + c]) / ((rp - rm) * dz || 1);
        const px = cam.sx(x, s);
        const py = cam.sy(H[i], s);
        pos[i * 2] = px;
        pos[i * 2 + 1] = py;
        // shade: the faces tilted toward the moon are lit, the others dark; a glint lane under the moon
        const dxm = (px - moonX) / spread;
        const lane = Math.exp(-dxm * dxm) * mvis;
        let u = 0.34 + 6 * -hz + 1.2 * Math.abs(hx) + lane * (0.1 + 5.5 * Math.abs(hz) + 1.5 * Math.abs(hx));
        u = clamp01(u * (0.6 + 0.4 * light));
        uv[i * 2] = u * 0.97 + 0.015;
        uv[i * 2 + 1] = near * 0.9 + 0.05;
      }
    }
    this.waterGeo.getBuffer('aPosition').update();
    this.waterGeo.getBuffer('aUV').update();
  }

  /** A stretched, wobbling glow streak under the moon, from the far edge to the near edge. */
  private drawMoonStreak(sim: River, light: number): void {
    const cam = this.cam;
    const n = this.moonStreak.length;
    for (let i = 0; i < n; i++) {
      const sp = this.moonStreak[i];
      const t = (i + 0.5) / n;
      const y = cam.farY + (cam.nearY - cam.farY) * (t * t * 0.9 + 0.02);
      const z = cam.waterZ(y) ?? 8;
      const s = cam.scale(Math.max(0, Math.min(WORLD.width, z)));
      const sl = sim.water.slopeAt(cam.x, Math.max(0.5, Math.min(WORLD.width - 0.5, z)));
      const wob = (this.reduced ? 0 : Math.sin(this.clock * 1.7 + i * 1.9) * 0.18 + Math.sin(this.clock * 3.1 + i * 0.7) * 0.08) * s;
      sp.position.set(this.moon.x + wob + sl.z * 40 * s * 0.1, y);
      sp.scale.set((2.2 * s * (0.8 + t)) / this.art.glow.width, (1.5 * s * (0.6 + t)) / this.art.glow.width);
      sp.alpha = (0.2 + 0.4 * (1 - t)) * (0.4 + 0.6 * light) * (this.moon.y < cam.farY ? 1 : 0);
    }
  }

  private drawLanterns(sim: River, alpha: number, light: number, zi: (z: number) => number): void {
    const cam = this.cam;
    const W = this.W;
    for (let i = 0; i < LANTERNS.length; i++) {
      const v = this.lanterns[i];
      const l = sim.lanterns[i];
      const s = cam.scale(l.z);
      const px = cam.sx(l.x, s);
      const near = px > -3 * s && px < W + 3 * s;
      v.off.visible = v.on.visible = near;
      v.glow.visible = near;
      v.streak.visible = near && l.lit;
      v.ring.visible = near && l.lit;
      if (!near) continue;
      const py = cam.sy(l.y, s);
      // the sprite hangs from its anchor: tilt it along the chain
      const ax = cam.sx(l.ax, cam.scale(l.az));
      const ay = cam.sy(l.ay, cam.scale(l.az));
      const rot = Math.atan2(ax - px, py - ay);
      const k = (SPRITES.lanternOff.width * s) / this.art.lanternOff.width;
      v.off.position.set(px, py);
      v.on.position.set(px, py);
      v.off.scale.set(k);
      v.on.scale.set((SPRITES.lanternOn.width * s) / this.art.lanternOn.width);
      v.off.rotation = v.on.rotation = rot;
      v.off.zIndex = zi(l.z);
      v.on.zIndex = zi(l.z) + 1;
      // lit: the glow fades in (with a short flash), then flickers softly
      const age = l.lit ? sim.t - l.litAt : -1;
      const on = l.lit ? Math.min(1, age / 0.5) : 0;
      v.on.alpha = on;
      const flash = l.lit && age < 0.4 ? 1 + (1 - age / 0.4) * 0.8 : 1;
      const flick = this.reduced ? 1 : 0.88 + 0.12 * Math.sin(this.clock * (5 + (i % 4)) + i * 1.7);
      v.glow.position.set(px, py);
      v.glow.alpha = on * 0.95 * flick;
      v.glow.scale.set((3.4 * flash * s) / this.art.glow.width);
      // reflection: a streak under the lantern's place on the water, wobbling with the surface
      const bs = cam.scale(l.az);
      v.streak.position.set(cam.sx(l.ax, bs) + this.wobble(l.ax, l.az, 0.25 * bs), cam.sy(-0.2 - l.y * 0.5, bs));
      v.streak.scale.set((0.9 * bs) / this.art.glow.width, (2.8 * bs * (0.9 + 0.1 * Math.sin(this.clock * 3 + i))) / this.art.glow.width);
      v.streak.alpha = on * 0.55;
      // the safe circle: a ring on the water
      const rr = SAFE.lantern;
      const sNearEdge = cam.scale(Math.max(0, l.az - rr));
      const sFarEdge = cam.scale(Math.min(WORLD.width, l.az + rr));
      const yN = cam.sy(0, sNearEdge);
      const yF = cam.sy(0, sFarEdge);
      v.ring.position.set(cam.sx(l.ax, bs), (yN + yF) / 2);
      v.ring.scale.set((2 * rr * bs) / this.art.ring.width, Math.abs(yN - yF) / this.art.ring.height);
      v.ring.alpha = on * (this.reduced ? 0.3 : 0.28 + 0.06 * Math.sin(this.clock * 2 + i));
    }
    void light;
    void alpha;
  }

  /** Ropes strung across the river, the poles, the branches, the lantern chains and the mooring rope. */
  private drawRopes(sim: River, bx: number, bz: number, byaw: number, by: number, alpha: number): void {
    const cam = this.cam;
    const ropes = this.ropes;
    const poles = this.poles;
    ropes.begin();
    poles.begin();
    const W = this.W;
    const pole = (x: number, z: number, h: number): void => {
      const s = cam.scale(z);
      const px = cam.sx(x, s);
      if (px < -50 || px > W + 50) return;
      poles.seg(px, cam.sy(-0.3, s), px, cam.sy(h + 0.3, s), Math.max(2, 0.07 * s));
    };
    // ropes across the river, with a little sag, each tied to a pole on both banks
    for (const rp of ROPES) {
      const sN = cam.scale(-0.8);
      if (cam.sx(rp.x, sN) < -W && cam.sx(rp.x, cam.scale(WORLD.width + 0.8)) < -W) continue;
      let lastX = 0;
      let lastY = 0;
      const n = 8;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const z = -0.8 + t * (WORLD.width + 1.6);
        const s = cam.scale(z);
        const x = cam.sx(rp.x, s);
        const y = cam.sy(rp.h - 0.35 * (1 - (2 * t - 1) * (2 * t - 1)), s);
        if (k) ropes.seg(lastX, lastY, x, y, Math.max(1.2, 0.05 * s));
        lastX = x;
        lastY = y;
      }
      pole(rp.x, -0.8, rp.h);
      pole(rp.x, WORLD.width + 0.8, rp.h);
    }
    // lantern chains, and a limb for the ones that hang over a bank
    for (let i = 0; i < LANTERNS.length; i++) {
      const l = sim.lanterns[i];
      const spec = LANTERNS[i];
      const s = cam.scale(l.z);
      const px = cam.sx(l.x, s);
      if (px < -3 * s || px > W + 3 * s) continue;
      const sa = cam.scale(l.az);
      const ax = cam.sx(l.ax, sa);
      const ay = cam.sy(l.ay, sa);
      const topY = cam.sy(l.y + LANTERN.radius * 1.1, s);
      const topX = px + (ax - px) * 0.0;
      ropes.seg(ax, ay, topX, topY, Math.max(1, 0.03 * s));
      if (spec.mount !== 'rope') {
        const bankZ = spec.mount === 'near' ? -0.5 : WORLD.width + 0.5;
        const sb = cam.scale(bankZ);
        // a limb reaching out from the bank (the tree itself is off screen), thick at the root and thin at the tip
        const bx0 = cam.sx(l.ax - 3.2, sb);
        const by0 = cam.sy(3.0, sb);
        const mx = (bx0 + ax) / 2;
        const my = (by0 + ay) / 2 - 0.12 * sa;
        poles.seg(bx0, by0, mx, my, Math.max(2, 0.045 * sb));
        poles.seg(mx, my, ax, ay, Math.max(1.5, 0.025 * sa));
      }
    }
    // the mooring rope: a little slack in the middle
    if (sim.moored >= 0) {
      const d = DOCKS[sim.moored];
      const post = sim.postOf(sim.moored);
      const sp = cam.scale(post.z);
      const c = Math.cos(byaw);
      const sn = Math.sin(byaw);
      const cx = bx + c * sim.cleatSide * BOAT.cleat;
      const cz = bz + sn * sim.cleatSide * BOAT.cleat;
      const sc = cam.scale(cz);
      const x0 = cam.sx(post.x, sp);
      const y0 = cam.sy(DOCK.postY, sp);
      const x1 = cam.sx(cx, sc);
      const y1 = cam.sy(by + 0.5, sc);
      ropes.seg(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2 + 0.1 * sp, Math.max(1.5, 0.05 * sp));
      ropes.seg((x0 + x1) / 2, (y0 + y1) / 2 + 0.1 * sp, x1, y1, Math.max(1.5, 0.05 * sc));
      void d;
    }
    ropes.end();
    poles.end();
    void alpha;
  }

  /** Fireflies and particles. */
  private drawGlow(dt: number, light: number): void {
    const cam = this.cam;
    if (this.flies.length) {
      const span = 2 * cam.halfWidthAt(8) + 6;
      for (let i = 0; i < this.flies.length; i++) {
        const f = this.flies[i];
        const u = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const base = (u < 0 ? u + 1 : u) * span;
        const x = cam.x - span / 2 + ((base + this.clock * (0.25 + (i % 5) * 0.08)) % span);
        const z = 1.5 + ((i * 0.6180339) % 1) * (WORLD.width - 3);
        const y = 0.8 + ((i * 0.37) % 1) * 3 + Math.sin(this.clock * (0.6 + (i % 3) * 0.2) + i) * 0.4;
        const s = cam.scale(z);
        f.position.set(cam.sx(x, s), cam.sy(y, s));
        f.scale.set((0.34 * s) / this.art.glow.width);
        f.alpha = light * (0.25 + 0.75 * Math.max(0, Math.sin(this.clock * (1.1 + (i % 4) * 0.4) + i * 2.3))) * 0.8;
      }
    }
    // celebration: bursts of sparks over the river
    if (this.celebrate > 0 && this.sim) {
      this.celebrate -= dt;
      if (Math.random() < dt * 5) this.burst(cam.x, 8);
    }
    const d = this.pData;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      const sp = this.pSprites[k];
      if (!sp.visible) continue;
      const o = k * 10;
      const life = d[o + 6] - dt;
      if (life <= 0) {
        sp.visible = false;
        continue;
      }
      d[o + 6] = life;
      d[o + 4] -= d[o + 9] * dt;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      if (d[o + 1] < 0 && d[o + 4] < 0) d[o + 4] *= -0.2; // a splash does not go under the water
      const z = Math.max(-0.5, Math.min(WORLD.width + 0.5, d[o + 2]));
      const s = cam.scale(z);
      sp.position.set(cam.sx(d[o], s), cam.sy(Math.max(0, d[o + 1]), s));
      const f = life / d[o + 7];
      sp.alpha = Math.min(1, f * 1.4);
      sp.scale.set((d[o + 8] * (0.6 + f * 0.6) * s) / this.art.glow.width);
    }
  }

  /** ?debug: the physics shapes seen from above, projected onto the water plane. */
  private drawDebug(sim: River): void {
    const g = this.debugG;
    const cam = this.cam;
    g.clear();
    const proj = (x: number, z: number): [number, number] => {
      const s = cam.scale(z);
      return [cam.sx(x, s), cam.sy(0, s)];
    };
    const outline = (body: { getPosition(): { x: number; y: number }; getAngle(): number }, pts: ReadonlyArray<readonly [number, number]>, color: number): void => {
      const p = body.getPosition();
      const a = body.getAngle();
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.forEach(([u, w], i) => {
        const [sx, sy] = proj(p.x + c * u - s * w, p.y + s * u + c * w);
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath().stroke({ color, width: 2, alpha: 0.9 });
    };
    outline(sim.boat.body, BOAT.hull, 0x66ff88);
    for (const c of sim.crocs) {
      if (!c.awake) continue;
      outline(c.tracked.body, [[CROC.halfL, 0], [CROC.halfL * 0.55, CROC.halfW], [-CROC.halfL * 0.7, CROC.halfW], [-CROC.halfL, 0], [-CROC.halfL * 0.7, -CROC.halfW], [CROC.halfL * 0.55, -CROC.halfW]], 0xff5555);
    }
    sim.floaters.forEach((f, i) => {
      const k = FLOATERS[i].kind === 'log' ? { l: 1.3, w: 0.28 } : { l: 0.9, w: 0.6 };
      outline(f.tracked.body, [[k.l, -k.w], [k.l, k.w], [-k.l, k.w], [-k.l, -k.w]], 0xffdd55);
    });
    DOCKS.forEach((d, i) => {
      const bank = d.side === 'far' ? WORLD.width : 0;
      const tip = dockTipZ(d);
      const pts: Array<[number, number]> = [
        [d.x + DOCK.deckFrom, bank],
        [d.x + DOCK.deckTo, bank],
        [d.x + DOCK.deckTo, tip],
        [d.x + DOCK.deckFrom, tip],
      ];
      pts.forEach(([x, z], k) => {
        const [sx, sy] = proj(x, z);
        if (k) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath().stroke({ color: 0x88aaff, width: 2, alpha: 0.9 });
      const z = sim.zoneOf(i);
      const zp: Array<[number, number]> = [
        [z.x - DOCK.zoneHalfX, z.z - DOCK.zoneHalfZ],
        [z.x + DOCK.zoneHalfX, z.z - DOCK.zoneHalfZ],
        [z.x + DOCK.zoneHalfX, z.z + DOCK.zoneHalfZ],
        [z.x - DOCK.zoneHalfX, z.z + DOCK.zoneHalfZ],
      ];
      zp.forEach(([x, zz], k) => {
        const [sx, sy] = proj(x, zz);
        if (k) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath().stroke({ color: 0xaaaaff, width: 1, alpha: 0.5 });
      const pz = dockPostZ(d);
      const [px, py] = proj(d.x, pz);
      g.circle(px, py, 4).fill({ color: 0xffffff });
    });
    // a strip map of the whole river, top right under the cluster
    const mw = Math.min(280, this.W - 24);
    const mh = (mw * WORLD.width) / WORLD.length;
    const mx = this.W - mw - 12;
    const my = 70;
    g.rect(mx, my, mw, mh).fill({ color: 0x000000, alpha: 0.45 });
    const m = (x: number, z: number): [number, number] => [mx + (x / WORLD.length) * mw, my + mh - (z / WORLD.width) * mh];
    for (const d of DOCKS) {
      const [x, y] = m(d.x, d.side === 'far' ? WORLD.width : 0);
      g.rect(x - 2, y - 2, 4, 4).fill({ color: 0x88aaff });
    }
    for (const l of sim.lanterns) {
      const [x, y] = m(l.ax, l.az);
      g.circle(x, y, 2).fill({ color: l.lit ? 0xffb347 : 0x666666 });
    }
    for (const c of sim.crocs) {
      if (!c.awake) continue;
      const p = c.tracked.body.getPosition();
      const [x, y] = m(p.x, p.y);
      g.circle(x, y, 3).fill({ color: c.state === 'lunge' ? 0xff0000 : c.state === 'stalk' ? 0xff8844 : 0x44aa66 });
    }
    const bp = sim.boat.body.getPosition();
    const [x, y] = m(bp.x, bp.y);
    g.circle(x, y, 3).fill({ color: 0xffffff });
    void WATER;
  }

  dispose(): void {
    this.sim = null;
    // the textures belong to assets.ts (they are reused next time), so they are not destroyed here
    this.app.destroy(true, { children: true });
  }
}
