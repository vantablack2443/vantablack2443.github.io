import { LANTERN, LANTERNS, RIG, ROPES, WORLD, type LanternSpec, type RopeSpec } from './config';

/**
 * The geometry of what holds the lanterns: ropes strung between a pole on each bank, and limbs
 * that reach out from a tree on a bank. A pure function of config, shared by the sim (a lantern's
 * anchor height), the renderer (what to draw) and a test (every anchor lies on a drawn segment).
 * Points are world metres: x along the river, y up, z across.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Segments per rope and per limb. */
export const ROPE_SEGMENTS = 14;
export const LIMB_SEGMENTS = 6;

const nearZ = -RIG.out;
const farZ = WORLD.width + RIG.out;

/** Height of a rope at depth z: its tie height less a parabola of sag, zero at both poles. */
export function ropeHeight(r: RopeSpec, z: number): number {
  const t = (z - nearZ) / (farZ - nearZ);
  return r.h - RIG.sag * (1 - (2 * t - 1) * (2 * t - 1));
}

/** The rope as a polyline from the near pole to the far pole. */
export function ropePoints(r: RopeSpec): P3[] {
  const pts: P3[] = [];
  for (let k = 0; k <= ROPE_SEGMENTS; k++) {
    const z = nearZ + (k / ROPE_SEGMENTS) * (farZ - nearZ);
    pts.push({ x: r.x, y: ropeHeight(r, z), z });
  }
  return pts;
}

/** The two poles of a rope: base and top, near bank first. */
export function polesOf(r: RopeSpec): Array<[P3, P3]> {
  return [nearZ, farZ].map((z) => [
    { x: r.x, y: RIG.poleBase, z },
    { x: r.x, y: r.h + RIG.poleTop, z },
  ]);
}

export interface Tree {
  /** The trunk from its foot to its tip. */
  trunk: P3[];
  /** The limb from the fork on the trunk out to the lantern's anchor (its last point). */
  limb: P3[];
  /** A short twig off the limb. */
  twig: P3[];
}

/** The anchor of a lantern: where its chain is tied (on the rope, or at the tip of the limb). */
export function anchorOf(spec: LanternSpec): P3 {
  if (spec.mount === 'rope') return { x: spec.x, y: ropeHeight(ROPES[spec.rope ?? 0], spec.z), z: spec.z };
  return { x: spec.x, y: LANTERN.branchH, z: spec.z };
}

/** The tree a branch lantern hangs from: on its bank, leaning toward the river, its limb ending at the anchor. */
export function treeOf(spec: LanternSpec): Tree | null {
  if (spec.mount === 'rope') return null;
  const near = spec.mount === 'near';
  const bank = near ? nearZ - 0.2 : farZ + 0.2;
  const toward = near ? 1 : -1; // the direction of the river from the bank
  const side = near ? -1 : 1;
  const tx = spec.x + side * RIG.trunkDx;
  const a = anchorOf(spec);
  // trunk: a gentle curve, leaning toward the river
  const trunk: P3[] = [];
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    trunk.push({ x: tx - side * 0.25 * t, y: RIG.poleBase + (RIG.trunkH - RIG.poleBase) * t, z: bank + toward * RIG.trunkLean * t * t });
  }
  // the limb leaves the trunk at the fork and arches out to the anchor (a quadratic curve)
  const f = { x: tx - side * 0.25 * ((RIG.forkH - RIG.poleBase) / (RIG.trunkH - RIG.poleBase)), y: RIG.forkH, z: bank + toward * RIG.trunkLean * Math.pow((RIG.forkH - RIG.poleBase) / (RIG.trunkH - RIG.poleBase), 2) };
  const c = { x: (f.x + a.x) / 2, y: (f.y + a.y) / 2 + RIG.arch, z: (f.z + a.z) / 2 };
  const limb: P3[] = [];
  for (let k = 0; k <= LIMB_SEGMENTS; k++) {
    const t = k / LIMB_SEGMENTS;
    const u = 1 - t;
    limb.push({ x: u * u * f.x + 2 * u * t * c.x + t * t * a.x, y: u * u * f.y + 2 * u * t * c.y + t * t * a.y, z: u * u * f.z + 2 * u * t * c.z + t * t * a.z });
  }
  // a twig leaves the limb a third of the way out, up and toward the river
  const o = limb[2];
  const twig: P3[] = [o, { x: o.x + side * -0.5, y: o.y + 0.45, z: o.z + toward * 0.5 }, { x: o.x + side * -0.9, y: o.y + 0.7, z: o.z + toward * 0.9 }];
  return { trunk, limb, twig };
}

/** Every drawn rope and limb of the river as polylines, for the test (the anchors of all lanterns must lie on them). */
export function rigPolylines(): P3[][] {
  const out: P3[][] = ROPES.map(ropePoints);
  for (const l of LANTERNS) {
    const t = treeOf(l);
    if (t) out.push(t.limb);
  }
  return out;
}
