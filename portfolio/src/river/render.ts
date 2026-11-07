import { Application, Buffer, BufferUsage, Container, Graphics, GlProgram, Mesh, MeshGeometry, Shader, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import type { Art } from './assets';
import { Camera } from './camera';
import {
  BOAT,
  CROC,
  DOCK,
  DOCKS,
  DOCK_ART,
  FLOATERS,
  FX,
  LANTERN,
  LANTERNS,
  LAYERS,
  MOON,
  RIG,
  ROPES,
  SAFE,
  SHALLOWS,
  SPRITES,
  VIEW,
  WATER,
  WORLD,
  dockPostZ,
  dockTipZ,
  type SpriteSpec,
} from './config';
import { polesOf, ropePoints, treeOf, type P3 } from './rig';
import type { River, RiverEvent } from './sim';

/**
 * The PixiJS scene. It reads the sim every frame and never writes to it. The river is drawn in a
 * low-angle perspective (camera.ts is the one place that projects metres to pixels), back to front:
 *
 *   sky, stars, moon  ->  far bank (parallax 0.12)  ->  mid bank (0.4)  ->  the water mesh (it
 *   runs on under the foreground plants)  ->  the far bank's reflection, the far poles and trees,
 *   the shore tufts and a band of mist along the far edge  ->  reflections and safe circles  ->
 *   everything on the water sorted by depth z, far to near (docks, lanterns, logs, hyacinth,
 *   lily pads, reeds, crocodiles, the boat, each with its own reflection)  ->  ropes, near poles and
 *   trees  ->  the foreground plants along the bottom edge  ->  labels  ->  additive glow  ->  darkness.
 *
 * Every sprite is side-on art, flipped by the sign of its heading's x and squeezed by
 * max(0.55, |cos yaw|) as it turns across the river. Where it meets the water (Clipped below) the
 * sprite fades out over a few pixels instead of being cut, carries on under the line as a faint
 * tinted ghost, hangs mirrored under it as a reflection, and has a soft ring and a foam line
 * around its contact. The hot loop allocates nothing: meshes and lines write into fixed buffers,
 * sprites and particles come from pools.
 */

const MAX_PARTICLES = 200;
const COLS = 14;
/** Vertices per column of a clipped sprite: top, start of the feather, the water line (dry side), the water line (wet side), bottom. */
const GV = 5;
/** Rows of a reflection (and of the far bank's reflection). */
const RR = 5;
const BANK_COLS = 28;
const BANK_ROWS = 8;
/** Extra rows of the water mesh in front of the near edge, so it runs on under the foreground plants. */
const NEAR_ROWS = 4;

/** Straight line segments drawn as quads into a fixed buffer (ropes, chains, poles, limbs). */
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

  /** A segment of width w px (tapering to w1 at its far end, if given). */
  seg(x0: number, y0: number, x1: number, y1: number, w: number, w1 = w): void {
    if (this.n >= this.capacity) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const p = this.pos;
    const o = this.n * 8;
    p[o] = x0 + nx * w * 0.5;
    p[o + 1] = y0 + ny * w * 0.5;
    p[o + 2] = x0 - nx * w * 0.5;
    p[o + 3] = y0 - ny * w * 0.5;
    p[o + 4] = x1 + nx * w1 * 0.5;
    p[o + 5] = y1 + ny * w1 * 0.5;
    p[o + 6] = x1 - nx * w1 * 0.5;
    p[o + 7] = y1 - ny * w1 * 0.5;
    this.n++;
  }

  end(): void {
    this.pos.fill(0, this.n * 8);
    this.mesh.geometry.getBuffer('aPosition').update();
  }
}

/**
 * A mesh whose vertices carry an alpha and a tint amount (`aFx`: alpha, how far the colour is
 * pulled to the water's), which the stock mesh cannot do. Premultiplied output like the stock one.
 */
const FX_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec2 aFx;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
out vec2 vFx;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vFx = aFx;
}`;
const FX_FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec2 vFx;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uTint;
uniform float uDark;
void main() {
  vec4 c = texture(uTexture, vUV);
  vec3 rgb = mix(c.rgb, uTint * c.a, vFx.y) * uDark;
  finalColor = vec4(rgb, c.a) * vFx.x;
}`;

type FxMesh = Mesh<MeshGeometry, Shader>;
let fxProgram: GlProgram | null = null;

function fxMesh(texture: Texture, pos: Float32Array, uv: Float32Array, fx: Float32Array, idx: Uint32Array, dark: number): FxMesh {
  const geometry = new MeshGeometry({ positions: pos, uvs: uv, indices: idx });
  geometry.addAttribute('aFx', { buffer: new Buffer({ data: fx, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: 'float32x2', stride: 8, offset: 0 });
  fxProgram ??= GlProgram.from({ vertex: FX_VERT, fragment: FX_FRAG, name: 'river-fx' });
  const shader = new Shader({
    glProgram: fxProgram,
    resources: { uTexture: texture.source, fxUniforms: { uTint: { value: new Float32Array(FX.tint), type: 'vec3<f32>' }, uDark: { value: dark, type: 'f32' } } },
  });
  return new Mesh({ geometry, shader });
}

const updateFx = (m: FxMesh): void => {
  m.geometry.getBuffer('aPosition').update();
  m.geometry.getBuffer('aUV').update();
  m.geometry.getBuffer('aFx').update();
};

/** Two triangles per quad of a grid of `cols` x `rows` vertices. */
function gridIndices(cols: number, rows: number): Uint32Array {
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let o = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + cols;
      idx.set([a, a + 1, b, a + 1, b + 1, b], o);
      o += 6;
    }
  }
  return idx;
}

/**
 * A side-on sprite that sits on the water, a strip of COLS columns. For each column the line from
 * its top to its bottom meets the surface (its screen y at that column, `wl`) at a point; above it
 * the sprite is opaque and fades to a faint edge over the last few pixels (the feather), below it
 * the same pixels carry on as a ghost, tinted to the water, faint and swaying. A second mesh holds
 * the reflection: the part above the surface mirrored under it, fading with distance and wobbled
 * by the local slope (`sl`). `ring` is a soft lighter ellipse on the water around the contact and
 * `foam` a thin bright line along the hull at the surface.
 */
class Clipped {
  readonly mesh: FxMesh;
  readonly mirror: FxMesh;
  readonly ring: Sprite;
  readonly foam: Sprite;
  readonly wl = new Float32Array(COLS + 1);
  readonly sl = new Float32Array(COLS + 1);
  private readonly bpos = new Float32Array((COLS + 1) * GV * 2);
  private readonly buv = new Float32Array((COLS + 1) * GV * 2);
  private readonly bfx = new Float32Array((COLS + 1) * GV * 2);
  private readonly mpos = new Float32Array((COLS + 1) * (RR + 1) * 2);
  private readonly muv = new Float32Array((COLS + 1) * (RR + 1) * 2);
  private readonly mfx = new Float32Array((COLS + 1) * (RR + 1) * 2);

  constructor(
    readonly texture: Texture,
    glow: Texture,
  ) {
    // the body: the dry part in two bands (opaque, feather) and the ghost in one
    const idx = new Uint32Array(COLS * 3 * 6);
    let o = 0;
    for (let j = 0; j < COLS; j++) {
      for (const seg of [0, 1, 3]) {
        const a = j * GV + seg;
        const b = a + 1;
        const c = a + GV;
        idx.set([a, b, c, b, b + GV, c], o);
        o += 6;
      }
    }
    this.mesh = fxMesh(texture, this.bpos, this.buv, this.bfx, idx, 1);
    this.mirror = fxMesh(texture, this.mpos, this.muv, this.mfx, gridIndices(COLS + 1, RR + 1), FX.reflect.dark);
    this.ring = new Sprite(glow);
    this.ring.anchor.set(0.5);
    this.ring.blendMode = 'add';
    this.ring.tint = 0x9ec8ff;
    this.ring.alpha = 0;
    this.foam = new Sprite(glow);
    this.foam.anchor.set(0.5);
    this.foam.blendMode = 'add';
    this.foam.tint = 0xd6ecff;
    this.foam.alpha = 0;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = this.mirror.visible = this.ring.visible = this.foam.visible = v;
  }

  /**
   * Place it: pivot (px, py) on screen, size in px, the anchor (fraction of the image), a screen
   * rotation about the pivot, mirrored or not; `this.wl` and `this.sl` hold the water's screen y
   * and slope per column. `feather` (px) is the fade above the line, `s` the pixels per metre
   * (the sway scales with it), `t` the clock, `refl` how strong the reflection is (0 for none).
   */
  place(px: number, py: number, w: number, h: number, ax: number, ay: number, rot: number, flip: boolean, feather: number, s: number, t: number, refl: number): void {
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const axs = flip ? 1 - ax : ax;
    const top = -ay * h;
    const bot = (1 - ay) * h;
    const bp = this.bpos;
    const bu = this.buv;
    const bf = this.bfx;
    const mp = this.mpos;
    const mu = this.muv;
    const mf = this.mfx;
    const G = FX.ghost;
    const R = FX.reflect;
    for (let j = 0; j <= COLS; j++) {
      const f = j / COLS;
      const lx = (f - axs) * w;
      const tx = px + lx * c - top * sn;
      const ty = py + lx * sn + top * c;
      const bx = px + lx * c - bot * sn;
      const by = py + lx * sn + bot * c;
      const dx = bx - tx;
      const dy = by - ty;
      const wl = this.wl[j];
      // where the surface cuts this column (0 top .. 1 bottom): raw may run past either end
      const raw = dy > 1e-6 ? (wl - ty) / dy : 1;
      const k = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const kf = dy > 1e-6 ? Math.max(0, Math.min(k, (wl - feather - ty) / dy)) : k;
      const u = flip ? 1 - f : f;
      // the ghost sways sideways a little more the deeper it goes
      const sway = Math.sin(t * 1.7 + j * 0.85) * G.wobble * s;
      const dry = raw >= 1; // the whole column is above the water: nothing to feather, no ghost
      const put = (i: number, p: number, a: number, m: number, sx: number): void => {
        const o = (j * GV + i) * 2;
        bp[o] = tx + dx * p + sx;
        bp[o + 1] = ty + dy * p;
        bu[o] = u;
        bu[o + 1] = p;
        bf[o] = a;
        bf[o + 1] = m;
      };
      put(0, 0, 1, 0, 0);
      put(1, kf, 1, 0, 0);
      put(2, k, dry ? 1 : FX.lineAlpha, 0, 0);
      put(3, k, dry ? 0 : G.alpha, G.mix, sway * 0.25);
      put(4, 1, dry ? 0 : G.tail, G.mix, sway);
      // the reflection: the dry part mirrored about the surface, fading with distance
      for (let r = 0; r <= RR; r++) {
        const tt = r / RR;
        const p = k * (1 - tt);
        const o = (r * (COLS + 1) + j) * 2;
        const y0 = ty + dy * p;
        const y = 2 * wl - y0;
        const fade = (1 - tt) * (1 - tt) * (1 - tt * 0.3);
        // the surface slope bends the image sideways more the further down it goes; a slow sway on top
        const lim = R.wobble * s * 1.5;
        const slope = Math.max(-lim, Math.min(lim, this.sl[j] * (y - wl) * R.slope));
        mp[o] = tx + dx * p + slope + Math.sin(t * 1.9 + tt * 5 + j * 0.7) * R.wobble * s * tt;
        mp[o + 1] = y;
        mu[o] = u;
        mu[o + 1] = p;
        mf[o] = k > 0 ? R.alpha * refl * fade : 0;
        mf[o + 1] = R.mix;
      }
    }
    updateFx(this.mesh);
    updateFx(this.mirror);
  }
}

interface DockView {
  sprite: Clipped;
  lamp: Sprite;
  glow: Sprite;
  label: Text;
  /** Ripple rings around the stilts. */
  stilts: Sprite[];
}

interface LanternView {
  off: Sprite;
  on: Sprite;
  glow: Sprite;
  streak: Sprite;
  ring: Sprite;
  /** The lantern's own reflection under it. */
  mirror: Sprite;
}

interface FloaterView {
  sprite: Clipped;
}

/** A still piece of the shallows: a lily pad or a clump of reeds with its reflection, where it stands (m). */
interface Decor {
  x: number;
  z: number;
  size: number;
  sprite: Sprite;
  mirror: Sprite | null;
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
  private readonly shore: TilingSprite;
  private readonly mist: Sprite;
  private readonly bankMirror: FxMesh;
  private readonly bankPos = new Float32Array((BANK_COLS + 1) * (BANK_ROWS + 1) * 2);
  private readonly bankUv = new Float32Array((BANK_COLS + 1) * (BANK_ROWS + 1) * 2);
  private readonly bankFx = new Float32Array((BANK_COLS + 1) * (BANK_ROWS + 1) * 2);
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
  /** Poles, trunks and limbs: the far bank's are drawn behind everything on the water, the near bank's in front of it. */
  private readonly bark = new Lines(240, RIG.barkNear);
  private readonly barkFar = new Lines(160, RIG.bark);
  private readonly decor: Decor[] = [];
  private readonly ropePts = ROPES.map(ropePoints);
  private readonly polePts = ROPES.map(polesOf);
  private readonly trees = LANTERNS.map(treeOf);

  // the water mesh: a world-anchored grid of GX x DZ, one row per DZ across the river (and a few rows in front of z = 0)
  private readonly GX = 0.5;
  private readonly rows = 41 + NEAR_ROWS;
  private readonly rowZ = new Float32Array(41 + NEAR_ROWS);
  private cols = 0;
  private waterGeo: MeshGeometry;
  private water: Mesh<MeshGeometry>;
  private wh = new Float32Array(0);

  // fireflies and particles
  private readonly flies: Sprite[] = [];
  /** The first fliesHigh fireflies drift at tree height over the whole river, the rest low over the near water. */
  private fliesHigh = 0;
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
    stage.addChild(this.far, this.mid);
    this.waterGeo = new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array(6) });
    this.water = new Mesh({ geometry: this.waterGeo, texture: art.ramp });
    stage.addChild(this.water);
    // the far bank mirrored in the water just under its edge, then what stands on that edge: far poles and trees, tufts and stones, a band of mist
    this.bankMirror = fxMesh(art.mid, this.bankPos, this.bankUv, this.bankFx, gridIndices(BANK_COLS + 1, BANK_ROWS + 1), 0.72);
    this.shore = new TilingSprite({ texture: art.shore });
    this.mist = new Sprite(art.mist);
    this.mist.blendMode = 'add';
    this.mist.tint = 0x6fb0c8;
    stage.addChild(this.bankMirror, this.barkFar.mesh, this.shore, this.mist);

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
      const sprite = new Clipped(art.dock, art.glow);
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
      this.addClipped(sprite);
      this.things.addChild(lamp);
      // a ripple ring around each stilt
      const stilts = DOCK_ART.stilts.map(() => {
        const ring = new Sprite(art.ring);
        ring.anchor.set(0.5);
        ring.blendMode = 'add';
        ring.tint = 0x9ec8ff;
        ring.alpha = 0;
        this.things.addChild(ring);
        return ring;
      });
      this.labels.addChild(label);
      this.docks.push({ sprite, lamp, glow, label, stilts });
    });

    LANTERNS.forEach(() => {
      const off = new Sprite(art.lanternOff);
      const on = new Sprite(art.lanternOn);
      off.anchor.set(0.5);
      on.anchor.set(0.5);
      on.alpha = 0;
      const mirror = new Sprite(art.lanternOff);
      mirror.anchor.set(0.5);
      this.things.addChild(mirror, off, on);
      const streak = this.glowSprite(0xffb347);
      streak.visible = false;
      this.fx.addChild(streak);
      const ring = new Sprite(art.ring);
      ring.anchor.set(0.5);
      ring.blendMode = 'add';
      ring.tint = 0xffb347;
      ring.visible = false;
      this.fx.addChild(ring);
      this.lanterns.push({ off, on, glow: this.glowSprite(0xffb347), streak, ring, mirror });
    });

    for (const f of FLOATERS) {
      const sprite = new Clipped(f.kind === 'log' ? art.log : art.hyacinth, art.glow);
      this.addClipped(sprite);
      this.floaters.push({ sprite });
    }
    for (let i = 0; i < CROC.count; i++) {
      const c = new Clipped(art.croc, art.glow);
      this.addClipped(c);
      c.setVisible(false);
      this.crocs.push(c);
    }
    this.boat = new Clipped(art.boat, art.glow);
    this.addClipped(this.boat);
    this.makeDecor();
    this.boatGlow = this.glowSprite(0xffb347);
    this.boatStreak = this.glowSprite(0xffb347);
    this.fx.addChild(this.boatStreak);

    // ---- ropes and poles, the foreground, labels, glow, darkness ----
    stage.addChild(this.ropes.mesh, this.bark.mesh, this.front, this.labels);
    for (const l of this.lanterns) this.glowLayer.addChild(l.glow);
    for (const d of this.docks) this.glowLayer.addChild(d.glow);
    this.glowLayer.addChild(this.boatGlow);
    if (!reduced) {
      this.fliesHigh = 40;
      for (let i = 0; i < this.fliesHigh + SHALLOWS.flies; i++) {
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

  /** A clipped sprite's meshes go in with the things on the water, its contact ring under them on the water. */
  private addClipped(c: Clipped): void {
    this.things.addChild(c.mirror, c.mesh, c.foam);
    this.fx.addChild(c.ring);
  }

  /** The shallows: lily pads and reed clumps at fixed places along both banks (seeded, so they are the same every visit). */
  private makeDecor(): void {
    const art = this.art;
    let a = 0x51f15e;
    const r = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const add = (tex: Texture, x: number, z: number, size: number, mirrored: boolean, anchorY: number): void => {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, anchorY);
      let mirror: Sprite | null = null;
      if (mirrored) {
        mirror = new Sprite(tex);
        mirror.anchor.set(0.5, anchorY);
        mirror.tint = 0x5f8fb0;
        mirror.alpha = 0.3;
        this.things.addChild(mirror);
      }
      this.things.addChild(sprite);
      this.decor.push({ x, z, size, sprite, mirror });
    };
    for (let i = 0; i < SHALLOWS.lilies; i++) {
      const x = ((i + r() * 0.7) / SHALLOWS.lilies) * WORLD.length;
      const z = i % 2 ? 1.4 + r() * 3.4 : WORLD.width - 1.6 - r() * 3.6;
      add(art.lily, x, z, 1.4 + r() * 1.1, false, 0.5);
    }
    for (let i = 0; i < SHALLOWS.reeds; i++) {
      const x = ((i + 0.2 + r() * 0.6) / SHALLOWS.reeds) * WORLD.length;
      const z = i % 2 ? 0.7 + r() * 1.0 : WORLD.width - 0.7 - r() * 1.0;
      add(art.reeds, x, z, 1.1 + r() * 0.9, true, 0.97);
    }
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
    // the shore along the far edge (tufts and stones, a little in front of the edge) and the mist band over it
    const shoreH = 1.25 * sFar;
    this.shore.width = W;
    this.shore.height = shoreH;
    this.shore.tileScale.set(shoreH / art.shore.height);
    this.mist.width = W;
    this.mist.height = 2 * FX.mist.height * sFar;

    this.dark.clear().rect(0, 0, W, H).fill({ color: 0x02040c });

    // the water rows: across the river, then a few more in front of the near edge, down to the bottom of the screen (the plants stand in the water)
    const rowsAcross = this.rows - NEAR_ROWS;
    const zBottom = cam.waterZ(H + 6);
    const zNear = Math.max(-VIEW.zCam * 0.6, Math.min(-0.3, zBottom ?? -3));
    for (let r = 0; r < this.rows; r++) {
      this.rowZ[r] = r < NEAR_ROWS ? zNear * (1 - r / NEAR_ROWS) : ((r - NEAR_ROWS) * WORLD.width) / (rowsAcross - 1);
    }

    // the water grid: enough columns to cover the far edge's width, world anchored
    const half = cam.halfWidthAt(WORLD.width) + 1.5;
    const cols = Math.ceil((2 * half) / this.GX) + 2;
    if (cols !== this.cols) {
      this.cols = cols;
      const n = cols * this.rows;
      this.wh = new Float32Array(n);
      const idx = gridIndices(cols, this.rows);
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
    // what stands on the far edge moves with the water (speed 1), not with the bank's parallax
    this.shore.tilePosition.x = -cam.x * sFar + cam.ox * 0.8;
    this.shore.y = cam.farY + 0.3 * sFar + cam.oy * 0.6 - this.shore.height;
    this.mist.y = cam.farY + cam.oy * 0.5 - this.mist.height / 2;
    this.mist.alpha = FX.mist.alpha * (0.5 + 0.5 * light) * (this.reduced ? 1 : 0.88 + 0.12 * Math.sin(this.clock * 0.5));

    this.drawWater(sim, light);
    this.drawBankMirror(sim, light);
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
      v.sprite.setVisible(visible);
      v.sprite.ring.visible = v.sprite.foam.visible = false;
      v.lamp.visible = v.label.visible = visible;
      v.glow.visible = visible;
      for (const ring of v.stilts) ring.visible = visible;
      if (!visible) return;
      // the water under the dock; the deck stands in it, so the stilts fade into the surface over a stretch of 0.3 m
      const py = cam.sy(this.water_(sim, d.x, z) + spec.at[1], s);
      this.clipColumns(v.sprite, d.x, z, spec.width, spec.anchor[0], 1, 0, false, s);
      v.sprite.place(px, py, w, h, spec.anchor[0], spec.anchor[1], 0, false, FX.dockFeather * s, s, this.clock, 1);
      v.sprite.mesh.zIndex = zi(z);
      v.sprite.mirror.zIndex = zi(z) - 1;
      // a ripple ring around each stilt where it enters the water
      const flat = cam.camH / (z + VIEW.zCam);
      DOCK_ART.stilts.forEach((f, k) => {
        const ring = v.stilts[k];
        const wy = v.sprite.wl[Math.round(f * COLS)];
        ring.position.set(px + (f - spec.anchor[0]) * w, wy);
        ring.scale.set((0.6 * s) / this.art.ring.width, (0.6 * s * flat) / this.art.ring.height);
        ring.alpha = 0.22 * (this.reduced ? 1 : 0.8 + 0.2 * Math.sin(this.clock * 1.8 + k * 1.3));
        ring.zIndex = zi(z) + 1;
      });
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
      const lv = t.body.getLinearVelocity();
      this.placeFloating(this.floaters[i].sprite, tex, spec, spec.anchor[1], x, z, this.lerp(f.buoy.py, f.buoy.y, alpha), yaw, this.rot(f.buoy, yaw, alpha), zi(z), Math.hypot(lv.x, lv.y), 1);
    });

    // crocodiles: the water line in the sprite moves between surfaced and lurking
    sim.crocs.forEach((c, i) => {
      const v = this.crocs[i];
      if (!c.awake) {
        v.setVisible(false);
        return;
      }
      const t = c.tracked;
      const x = t.px + (t.cx - t.px) * alpha;
      const z = t.pz + (t.cz - t.pz) * alpha;
      const yaw = this.lerpAngle(t.pa, t.ca, alpha);
      const cv = t.body.getLinearVelocity();
      // a reflection and a ring only when it is up: a lurking one is mostly a ripple
      const up = clamp01((c.line - CROC.lineLurk) / (CROC.lineSurfaced - CROC.lineLurk));
      this.placeFloating(v, this.art.croc, SPRITES.croc, c.line, x, z, this.lerp(c.buoy.py, c.buoy.y, alpha), yaw, this.rot(c.buoy, yaw, alpha), zi(z), Math.hypot(cv.x, cv.y), 0.3 + 0.7 * up);
    });

    // the boat, and the warm lantern glowing inside the canopy
    const byaw = this.lerpAngle(boat.pa, boat.ca, alpha);
    const bb = sim.boatBuoy;
    const by = this.lerp(bb.py, bb.y, alpha);
    this.placeFloating(this.boat, this.art.boat, SPRITES.boat, SPRITES.boat.anchor[1], bx, bz, by, byaw, this.rot(bb, byaw, alpha), zi(bz), sim.boatSpeed(), 1);
    {
      const s = cam.scale(bz);
      this.boatGlow.position.set(cam.sx(bx, s), cam.sy(by + 1.0, s));
      this.boatGlow.scale.set((4.2 * s) / this.art.glow.width);
      this.boatGlow.alpha = 0.7 * light * (this.reduced ? 1 : 0.92 + 0.08 * Math.sin(this.clock * 6));
      this.boatStreak.position.set(cam.sx(bx, s) + this.wobble(bx, bz, 0.12 * s), cam.sy(-1.1, s));
      this.boatStreak.scale.set((1.2 * s) / this.art.glow.width, (3.2 * s) / this.art.glow.width);
      this.boatStreak.alpha = 0.3 * light;
    }

    this.drawShallows(sim, zi);
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

  /** The water surface's screen y and slope under each column of a clipped sprite that stands at world (x, z) and spans `width` m along the heading. */
  private clipColumns(c: Clipped, x: number, z: number, width: number, ax: number, dirX: number, dirZ: number, flip: boolean, s: number): void {
    const sim = this.sim;
    if (!sim) return;
    const cam = this.cam;
    for (let j = 0; j <= COLS; j++) {
      const t = j / COLS;
      const u = flip ? 1 - t : t; // the art's own coordinate: its bow is at u = 1
      const f = (u - ax) * width;
      const wx = x + f * dirX;
      const wz = Math.max(0.2, Math.min(WORLD.width - 0.2, z + f * dirZ));
      c.wl[j] = cam.sy(this.water_(sim, wx, wz), s);
      c.sl[j] = sim.water.slopeAt(wx, wz).x;
    }
  }

  /**
   * Place a sprite that floats: pivot on the water at (x, z) with its datum height, heading yaw.
   * `anchorY` is the water line's place in the image (a crocodile moves it); `speed` (m/s)
   * brightens the foam and the ring, `refl` scales the reflection.
   */
  private placeFloating(c: Clipped, tex: Texture, spec: SpriteSpec, anchorY: number, x: number, z: number, y: number, yaw: number, rot: number, zIndex: number, speed: number, refl: number): void {
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
    c.setVisible(visible);
    if (!visible) return;
    c.mesh.zIndex = zIndex;
    c.mirror.zIndex = zIndex - 1;
    c.foam.zIndex = zIndex + 2;
    this.clipColumns(c, x, z, spec.width, spec.anchor[0], cy, sy, flip, s);
    c.place(px, cam.sy(y + spec.at[1], s), wPx, hPx, spec.anchor[0], anchorY, rot, flip, FX.feather * s, s, this.clock, refl);
    // contact: a soft lighter ellipse on the water and a thin foam line along the hull, brighter when it moves
    const C = FX.contact;
    const wy = c.wl[COLS >> 1];
    const k = clamp01(speed / C.speed);
    const flat = cam.camH / (z + VIEW.zCam);
    c.ring.position.set(px, wy);
    c.ring.scale.set((wPx * 1.25) / this.art.glow.width, ((spec.beam ?? 1) * s * flat * 1.5) / this.art.glow.height);
    c.ring.alpha = (C.ring + C.ringMove * k) * refl;
    c.foam.position.set(px, wy);
    c.foam.rotation = rot;
    c.foam.scale.set((wPx * 0.95) / this.art.glow.width, Math.max(5, 0.1 * s) / this.art.glow.height);
    c.foam.alpha = (C.foam + C.foamMove * k) * refl;
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

  /**
   * The water mesh: each vertex projected, its height from the field, shaded by the surface slope
   * and the moon. The shade is compressed softly at the top (no flat saturated patches with hard
   * edges), and the rows in front of the near edge darken toward the bottom of the screen.
   */
  private drawWater(sim: River, light: number): void {
    const { cam, cols, rows, GX, rowZ } = this;
    const water = sim.water;
    const half = cam.halfWidthAt(WORLD.width) + 1.5;
    const first = Math.floor((cam.x - half) / GX);
    const H = this.wh;
    for (let r = 0; r < rows; r++) {
      const z = rowZ[r];
      for (let c = 0; c < cols; c++) H[r * cols + c] = water.heightAt((first + c) * GX, z);
    }
    const pos = this.waterGeo.positions;
    const uv = this.waterGeo.uvs;
    const moonX = this.moon.x;
    const mvis = this.reduced ? 0.8 : 1;
    const fadeY = cam.nearY - 0.04 * this.H;
    for (let r = 0; r < rows; r++) {
      const z = rowZ[r];
      const s = cam.scale(z);
      const near = clamp01(1 - z / WORLD.width);
      const spread = this.W * (0.06 + 0.05 * near);
      const rm = r > 1 ? r - 2 : r;
      const rp = r < rows - 2 ? r + 2 : r;
      const dzr = rowZ[rp] - rowZ[rm] || 1;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (first + c) * GX;
        // a wide stencil along the river, so a steep wake does not alias into jagged facets
        const cm = c > 1 ? c - 2 : c;
        const cp = c < cols - 2 ? c + 2 : c;
        const hx = (H[r * cols + cp] - H[r * cols + cm]) / ((cp - cm) * GX || 1);
        const hz = (H[rp * cols + c] - H[rm * cols + c]) / dzr;
        const px = cam.sx(x, s);
        const py = cam.sy(H[i], s);
        pos[i * 2] = px;
        pos[i * 2 + 1] = py;
        // shade: the faces tilted toward the moon are lit, the others dark; a glint lane under the moon
        const dxm = (px - moonX) / spread;
        const lane = Math.exp(-dxm * dxm) * mvis;
        // the slope terms are capped: a steep wake brightens smoothly instead of saturating into a pale patch with hard edges
        const tilt = Math.max(-0.34, Math.min(0.26, 6 * -hz)) + Math.min(0.14, 1.2 * Math.abs(hx));
        const glint = Math.min(0.9, 0.1 + 5.5 * Math.abs(hz) + 1.5 * Math.abs(hx));
        let u = (0.34 + tilt + lane * glint) * (0.6 + 0.4 * light);
        u = u < 0 ? 0 : u < 0.62 ? u : 0.62 + 0.38 * Math.tanh((u - 0.62) / 0.38);
        // the water runs on under the foreground plants and darkens softly toward the bottom edge
        const dk = clamp01((py - fadeY) / (this.H - fadeY));
        u *= 1 - 0.75 * dk * dk * (3 - 2 * dk);
        uv[i * 2] = u * 0.97 + 0.015;
        uv[i * 2 + 1] = near * 0.9 + 0.05;
      }
    }
    this.waterGeo.getBuffer('aPosition').update();
    this.waterGeo.getBuffer('aUV').update();
  }

  /**
   * The far bank mirrored in the water just under its edge: the bottom of the mid layer flipped,
   * dark and blue, fading with distance and wobbled by the slope. This strip is what makes the
   * bank sit in the water.
   */
  private drawBankMirror(sim: River, light: number): void {
    const { cam, W } = this;
    const tex = this.art.mid;
    const sFar = cam.scale(WORLD.width);
    const tileH = this.mid.height;
    const depth = FX.bank.depth * sFar;
    const frac = Math.min(0.9, depth / tileH);
    const tileW = tex.width * this.mid.tileScale.x;
    const x0 = this.mid.tilePosition.x;
    const y0 = cam.farY + cam.oy * 0.5;
    const sl = sim.water.slopeAt(cam.x, WORLD.width - 0.6);
    const pos = this.bankPos;
    const uv = this.bankUv;
    const fx = this.bankFx;
    const lit = 0.5 + 0.5 * light;
    for (let r = 0; r <= BANK_ROWS; r++) {
      const t = r / BANK_ROWS;
      const y = y0 + t * depth;
      const a = FX.bank.alpha * Math.pow(1 - t, 1.3) * lit;
      for (let c = 0; c <= BANK_COLS; c++) {
        const sx = (c / BANK_COLS) * W;
        const o = (r * (BANK_COLS + 1) + c) * 2;
        const wob = this.reduced ? 0 : Math.sin(this.clock * 1.3 + r * 1.15 + c * 0.5) * FX.reflect.wobble * sFar * t;
        pos[o] = sx + wob + sl.x * depth * t * FX.reflect.slope;
        pos[o + 1] = y;
        uv[o] = (sx - x0) / tileW;
        uv[o + 1] = 1 - t * frac;
        fx[o] = a;
        fx[o + 1] = FX.reflect.mix;
      }
    }
    updateFx(this.bankMirror);
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
      const wob = (this.reduced ? 0 : Math.sin(this.clock * 1.7 + i * 1.9) * 0.26 + Math.sin(this.clock * 3.1 + i * 0.7) * 0.12) * s;
      sp.position.set(this.moon.x + wob + sl.z * 40 * s * 0.1, y);
      sp.scale.set((2.2 * s * (0.8 + t)) / this.art.glow.width, (1.5 * s * (0.6 + t)) / this.art.glow.width);
      // it grows out of nothing at the far edge (no hard end where it meets the bank)
      const grow = clamp01(t * 5);
      sp.alpha = (0.2 + 0.4 * (1 - t)) * (0.4 + 0.6 * light) * grow * grow * (this.moon.y < cam.farY ? 1 : 0);
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
      v.off.visible = v.on.visible = v.mirror.visible = near;
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
      // its reflection: the lantern mirrored about the water under it, swaying with the surface
      const tex = l.lit ? this.art.lanternOn : this.art.lanternOff;
      if (v.mirror.texture !== tex) v.mirror.texture = tex;
      const mk = (SPRITES.lanternOff.width * s) / tex.width;
      v.mirror.position.set(px + this.wobble(l.x, l.z, 0.1 * s), 2 * cam.sy(this.water_(sim, l.x, l.z), s) - py);
      v.mirror.scale.set(mk, -mk);
      v.mirror.rotation = -rot;
      v.mirror.alpha = l.lit ? 0.42 : 0.24;
      v.mirror.tint = l.lit ? 0xffd9a0 : 0x6f90b0;
      v.mirror.zIndex = zi(l.z) - 1;
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

  /** Lily pads and reed clumps standing in the shallows near the banks (still, they move only with the water). */
  private drawShallows(sim: River, zi: (z: number) => number): void {
    const cam = this.cam;
    const W = this.W;
    for (const d of this.decor) {
      const s = cam.scale(d.z);
      const px = cam.sx(d.x, s);
      const vis = px > -2 * d.size * s && px < W + 2 * d.size * s;
      d.sprite.visible = vis;
      if (d.mirror) d.mirror.visible = vis;
      if (!vis) continue;
      const tex = d.sprite.texture;
      const wy = cam.sy(this.water_(sim, d.x, d.z), s);
      d.sprite.position.set(px, wy);
      d.sprite.zIndex = zi(d.z);
      if (d.mirror) {
        // a clump of reeds: its width follows its size, it sways a little, and it hangs mirrored in the water
        const k = (0.75 * d.size * s) / tex.width;
        const sway = this.reduced ? 0 : Math.sin(this.clock * 0.7 + d.x * 0.9) * 0.03;
        d.sprite.scale.set(k);
        d.sprite.rotation = sway;
        d.mirror.position.set(px + this.wobble(d.x, d.z, 0.08 * s), wy);
        d.mirror.scale.set(k, -k);
        d.mirror.rotation = -sway;
        d.mirror.zIndex = zi(d.z) - 1;
      } else {
        // a lily pad lies flat: squashed to the river's angle
        const k = (d.size * s) / tex.width;
        d.sprite.scale.set(k, (k * cam.camH) / (d.z + VIEW.zCam));
      }
    }
  }

  /**
   * What holds the lanterns, all of it drawn from rig.ts: each rope sags between two poles that
   * stand on the banks, branch lanterns hang from a limb that reaches out of a tree on a bank, and
   * every chain starts exactly on the rope or at the tip of the limb. Then the mooring rope.
   */
  private drawRopes(sim: River, bx: number, bz: number, byaw: number, by: number, alpha: number): void {
    const cam = this.cam;
    const { ropes, bark, barkFar } = this;
    ropes.begin();
    bark.begin();
    barkFar.begin();
    const W = this.W;
    /** A polyline of world points as tapered segments: widths in metres at the first and the last point, never thinner than `min` px. */
    const poly = (lines: Lines, pts: ReadonlyArray<P3>, w0: number, w1: number, min: number): void => {
      const n = pts.length - 1;
      for (let k = 0; k < n; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const sa = cam.scale(a.z);
        const sb = cam.scale(b.z);
        lines.seg(
          cam.sx(a.x, sa),
          cam.sy(a.y, sa),
          cam.sx(b.x, sb),
          cam.sy(b.y, sb),
          Math.max(min, (w0 + ((w1 - w0) * k) / n) * sa),
          Math.max(min, (w0 + ((w1 - w0) * (k + 1)) / n) * sb),
        );
      }
    };
    ROPES.forEach((_, i) => {
      const pts = this.ropePts[i];
      const near = pts[0];
      const far = pts[pts.length - 1];
      const xa = cam.sx(near.x, cam.scale(near.z));
      const xb = cam.sx(far.x, cam.scale(far.z));
      if ((xa < -80 && xb < -80) || (xa > W + 80 && xb > W + 80)) return;
      poly(ropes, pts, 0.05, 0.05, 1.2);
      // the poles: one on each bank (the far one behind the things on the water), a crossbar at the top
      this.polePts[i].forEach(([base, top], k) => {
        const s = cam.scale(base.z);
        const x = cam.sx(base.x, s);
        if (x < -60 || x > W + 60) return;
        const lines = k === 0 ? bark : barkFar;
        const yt = cam.sy(top.y, s);
        lines.seg(x, cam.sy(base.y, s), x, yt, Math.max(2, RIG.poleWidth * s * 1.15), Math.max(2, RIG.poleWidth * s * 0.8));
        lines.seg(x - 0.34 * s, yt + 0.08 * s, x + 0.34 * s, yt + 0.08 * s, Math.max(1.5, 0.1 * s));
      });
    });
    // trees for the branch lanterns: trunk, the limb out to the anchor, a twig
    LANTERNS.forEach((spec, i) => {
      const tree = this.trees[i];
      if (!tree) return;
      const a = tree.limb[tree.limb.length - 1];
      const sa = cam.scale(a.z);
      const x = cam.sx(a.x, sa);
      if (x < -8 * sa || x > W + 8 * sa) return;
      const lines = spec.mount === 'near' ? bark : barkFar;
      poly(lines, tree.trunk, RIG.trunkW[0], RIG.trunkW[1], 2);
      poly(lines, tree.limb, RIG.limbW[0], RIG.limbW[1], 1.5);
      poly(lines, tree.twig, 0.05, 0.02, 1);
    });
    // lantern chains, from the anchor on the rope or at the limb's tip down to the lantern
    for (let i = 0; i < LANTERNS.length; i++) {
      const l = sim.lanterns[i];
      const s = cam.scale(l.z);
      const px = cam.sx(l.x, s);
      if (px < -3 * s || px > W + 3 * s) continue;
      const sa = cam.scale(l.az);
      const ax = cam.sx(l.ax, sa);
      const ay = cam.sy(l.ay, sa);
      const topY = cam.sy(l.y + LANTERN.radius * 1.1, s);
      ropes.seg(ax, ay, px, topY, Math.max(1, 0.03 * s));
    }
    // the mooring rope: a little slack in the middle
    if (sim.moored >= 0) {
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
    }
    ropes.end();
    bark.end();
    barkFar.end();
    void alpha;
  }

  /** Fireflies and particles. */
  private drawGlow(dt: number, light: number): void {
    const cam = this.cam;
    if (this.flies.length) {
      const span = 2 * cam.halfWidthAt(8) + 6;
      for (let i = 0; i < this.flies.length; i++) {
        const f = this.flies[i];
        const low = i >= this.fliesHigh; // the low ones drift slowly just over the near water
        const u = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const base = (u < 0 ? u + 1 : u) * span;
        const x = cam.x - span / 2 + ((base + this.clock * (low ? 0.1 + (i % 4) * 0.04 : 0.25 + (i % 5) * 0.08)) % span);
        const z = low ? 0.9 + ((i * 0.6180339) % 1) * 6.5 + Math.sin(this.clock * 0.3 + i) * 0.7 : 1.5 + ((i * 0.6180339) % 1) * (WORLD.width - 3);
        const y = low ? 0.25 + ((i * 0.37) % 1) * 0.9 + Math.sin(this.clock * 0.5 + i) * 0.15 : 0.8 + ((i * 0.37) % 1) * 3 + Math.sin(this.clock * (0.6 + (i % 3) * 0.2) + i) * 0.4;
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
