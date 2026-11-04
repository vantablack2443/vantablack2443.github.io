/**
 * Lantern River: every number in one place. World units are metres. The river is a flat sheet
 * seen from above in the physics (x along the river, z across it, z = 0 at the near bank and
 * z = 16 at the far bank) and has a height y on top of it (y = 0 is the rest water level, y comes
 * from the water). The sim, the water and the renderer all read from here, and nothing else
 * hard-codes geometry.
 */

/* ------------------------------------------------------------------ */
/* World and time                                                      */
/* ------------------------------------------------------------------ */

export const WORLD = {
  /** River length (m): x runs 0..length. */
  length: 140,
  /** River width (m): z runs 0..width, 0 is the near bank (bottom of the screen). */
  width: 16,
  /** Fixed physics step (s). */
  dt: 1 / 120,
  /** Most steps per frame; beyond that the clock slips instead of spiralling. */
  maxSteps: 5,
  velocityIterations: 8,
  positionIterations: 3,
  gravity: 9.81,
  /** Length of one night (s): the moon crosses the sky in this time. */
  nightSeconds: 150,
};

/** Collision categories. */
export const CAT = {
  boat: 0x0001,
  float: 0x0002,
  wall: 0x0004,
  croc: 0x0008,
  dock: 0x0010,
};

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

export const WATER = {
  /** Cell size (m): 140 m / 0.25 m = 560 cells along, 16 m / 0.25 m = 64 across. */
  dx: 0.25,
  nx: 560,
  nz: 64,
  /** Wave speed (m/s): how fast a ripple travels. CFL: c dt / dx must stay under 0.707 (see water-rs). */
  speed: 4.5,
  /** Velocity damping (1/s): ripples fade over several seconds. */
  damping: 0.45,
  /** Extra damping in the absorbing reed strips along both banks and both ends (1/s). */
  edgeDamping: 6,
  /** The field is stepped every this many physics steps (so at 60 Hz): plenty for 0.25 m cells. */
  every: 2,
  /** Ambient swell: two slow sines in x and z, added at sample time (never dead flat). */
  swell: [
    { amp: 0.035, kx: 1 / 44, kz: 1 / 70, period: 12 },
    { amp: 0.022, kx: -1 / 19, kz: 1 / 27, period: 8 },
  ],
};

/** A point in local metres. */
export type Pt = readonly [number, number];

/* ------------------------------------------------------------------ */
/* Vertical motion: heave, pitch and roll from the water under the hull */
/* ------------------------------------------------------------------ */

export interface BuoySpec {
  /** Mass (kg) for the heave, and radii of gyration (m) for pitch and roll. */
  mass: number;
  gyrPitch: number;
  gyrRoll: number;
  /** Rest draught (m): how deep the hull bottom sits in still water. */
  draught: number;
  /** Damping ratio of the heave (1 is critical). */
  zeta: number;
  /** Sample points under the hull: local (u along the heading, w across) and the rise of the hull bottom there (m). */
  pts: ReadonlyArray<readonly [number, number, number]>;
  /** Effective mass of the water a point drags along (kg): the body's half of the two way coupling (the wake). */
  coupleMass: number;
  /** Radius of the dent a point leaves in the water (m). */
  dentRadius: number;
}

/* ------------------------------------------------------------------ */
/* Boat                                                                */
/* ------------------------------------------------------------------ */

export const BOAT = {
  mass: 320,
  /** Top-down hull: an elongated hexagon, 5 m by 1.6 m (counter clockwise, local (u, w)). */
  hull: [
    [2.5, 0],
    [1.6, 0.8],
    [-1.6, 0.8],
    [-2.5, 0],
    [-1.6, -0.8],
    [1.6, -0.8],
  ] as Pt[],
  /** Start pose. */
  start: { x: 6, z: 8, yaw: 0 },
  friction: 0.2,
  restitution: 0.25,
  linearDamping: 0,
  angularDamping: 1.6,
  /** Keel: water drag per second along the heading and sideways (the sideways one is high). */
  dragAlong: 1.3,
  dragSide: 4.5,
  /** Rest draught (m): the hull bottom is this far under the waterline (art: ~0.35). */
  draught: 0.35,
  vertical: {
    mass: 320,
    gyrPitch: 1.25,
    gyrRoll: 0.65,
    draught: 0.35,
    zeta: 0.5,
    // eight under the centre line (the ends of the hull rise) and two out to the sides
    pts: [
      [-2.1, 0, 0.18],
      [-1.5, 0, 0],
      [-0.9, 0, 0],
      [-0.3, 0, 0],
      [0.3, 0, 0],
      [0.9, 0, 0],
      [1.5, 0, 0],
      [2.1, 0, 0.18],
      [0, 0.65, 0.02],
      [0, -0.65, 0.02],
    ],
    coupleMass: 90,
    dentRadius: 0.6,
  } as BuoySpec,
  /** Paddling. */
  stroke: {
    /** Seconds between strokes while a direction is held. */
    cadence: 0.35,
    /** A stroke is a push spread over this long (s), so the speed does not jump. */
    pulse: 0.16,
    /** Impulse of a full stroke along the input direction (N s): about 5 m/s at the top (peaks a little over). */
    impulse: 700,
    /** Heading controller: torque turning the heading toward the input (stiffness 1/s^2, damping 1/s). */
    turnKp: 30,
    turnKd: 8,
    /** Pitch kick of a stroke (rad/s) and the splash at the paddle (m/s of dent, radius m). */
    pitchKick: 0.35,
    splash: 3.2,
    splashRadius: 0.55,
    /** The paddle enters the water this far beside the hull (m), behind the middle. */
    paddleSide: 1.05,
    paddleBack: 0.6,
    /** Inputs smaller than this do nothing. */
    deadZone: 0.15,
  },
  /** Wake: dent of the water at the bow (up) and behind the stern (down) per m/s of speed. */
  bowWave: 0.55,
  sternWave: 0.35,
  /** Where the rope ties on: local u of the bow / stern cleat. */
  cleat: 2.2,
};

/* ------------------------------------------------------------------ */
/* Lanterns                                                            */
/* ------------------------------------------------------------------ */

/** A rope strung across the river at x, between a pole on each bank. */
export interface RopeSpec {
  x: number;
  /** Height where the rope ties to the poles (m). */
  h: number;
}

export interface LanternSpec {
  /** 'rope' hangs from the rope index in ROPES at its x; 'near' and 'far' hang from a branch over that bank. */
  mount: 'rope' | 'near' | 'far';
  rope?: number;
  x: number;
  z: number;
  /** Rest height of the lantern's centre above the water (m). */
  y: number;
}

export const ROPES: RopeSpec[] = [8, 27, 49, 71, 93, 115].map((x) => ({ x, h: 4.7 }));

const rope = (r: number, z: number, y: number): LanternSpec => ({ mount: 'rope', rope: r, x: ROPES[r].x, z, y });
const branch = (side: 'near' | 'far', x: number, z: number, y: number): LanternSpec => ({ mount: side, x, z, y });

/** 10 lanterns, on ropes across the river and on branches over the banks, at different z. */
export const LANTERNS: LanternSpec[] = [
  rope(0, 5, 2.1),
  rope(1, 10.5, 2.3),
  branch('near', 44, 2.6, 1.9),
  rope(2, 8, 2.2),
  branch('far', 69, 13.4, 2.0),
  rope(3, 5.5, 2.4),
  rope(4, 9.5, 2.1),
  branch('near', 100, 2.8, 2.0),
  rope(5, 7.5, 2.3),
  branch('far', 132, 13.2, 1.9),
];

export const LANTERN = {
  radius: 0.22,
  /** The boat lights a lantern when its hull (a segment of this half length along the heading) passes this close (m). */
  lightDistance: 0.8,
  hullHalf: 1.5,
  /** Height the branch ties on (m) and how far the bank end of the branch is. */
  branchH: 4.1,
  /** The pendulum: damping (1/s), a little breeze (m/s^2) and what a touch does (m/s per m/s of the boat, and a fixed shove). */
  damping: 0.14,
  breeze: 0.2,
  touchGain: 0.35,
  touchShove: 0.9,
  score: 100,
};

/* ------------------------------------------------------------------ */
/* Docks (the six projects, in the order of index.html)                */
/* ------------------------------------------------------------------ */

export interface DockSpec {
  /** id of the `.card` in index.html that holds this project's text. */
  card: string;
  x: number;
  /** Which bank: far is z = width, near is z = 0. */
  side: 'far' | 'near';
}

const DOCK_CARDS = ['card-orion', 'card-saardew', 'card-2048', 'card-pagerank', 'card-edge', 'card-mips'];
export const DOCKS: DockSpec[] = DOCK_CARDS.map((card, i) => ({ card, x: 16 + i * 22, side: i % 2 === 0 ? 'far' : 'near' }));

export const DOCK = {
  /** The jetty reaches this far into the water from its bank (m), and spans these x relative to the dock's x (its post). */
  jetty: 2.4,
  deckFrom: -5,
  deckTo: 0.6,
  /** The post stands this far in from the jetty tip (m). */
  postIn: 0.3,
  /** Height the rope ties to the post. */
  postY: 2.2,
  /** The mooring zone: a box this far in front of the jetty tip and this far left of the post, half sizes (x, z). */
  zoneOut: 2.7,
  zoneDx: -1.4,
  zoneHalfX: 3.2,
  zoneHalfZ: 2.0,
  /** Mooring: slower than this for this long, inside the zone. */
  maxSpeed: 1.2,
  holdTime: 0.4,
  /** Arriving faster than this is a bump (a little braking, no rope). */
  bumpSpeed: 2.5,
  bumpBrake: 0.12,
  /** The rope: a soft distance joint. */
  rope: { length: 1.1, frequencyHz: 0.5, dampingRatio: 0.9 },
  /** Crocodiles keep this far from the post. */
  safeRadius: 5,
  score: 500,
};

/** z of a dock's jetty tip, and of its post, and the centre of its zone. */
export function dockTipZ(d: DockSpec): number {
  return d.side === 'far' ? WORLD.width - DOCK.jetty : DOCK.jetty;
}
export function dockPostZ(d: DockSpec): number {
  return d.side === 'far' ? dockTipZ(d) + DOCK.postIn : dockTipZ(d) - DOCK.postIn;
}
export function dockZoneZ(d: DockSpec): number {
  return d.side === 'far' ? dockTipZ(d) - DOCK.zoneOut : dockTipZ(d) + DOCK.zoneOut;
}

/* ------------------------------------------------------------------ */
/* Floating objects                                                    */
/* ------------------------------------------------------------------ */

export interface FloaterSpec {
  kind: 'log' | 'hyacinth';
  /** Rough place; the seed moves it by up to +-jitter. */
  x: number;
  z: number;
  jitter: number;
}

export const FLOATERS: FloaterSpec[] = [
  { kind: 'log', x: 30, z: 6, jitter: 7 },
  { kind: 'log', x: 72, z: 10, jitter: 8 },
  { kind: 'log', x: 112, z: 6, jitter: 8 },
  { kind: 'hyacinth', x: 50, z: 5, jitter: 6 },
  { kind: 'hyacinth', x: 92, z: 7, jitter: 7 },
  { kind: 'hyacinth', x: 122, z: 11, jitter: 6 },
];

const floaterVertical = (mass: number, draught: number, halfLen: number, n: number): BuoySpec => ({
  mass,
  gyrPitch: halfLen * 0.6,
  gyrRoll: 0.3,
  draught,
  zeta: 0.45,
  pts: Array.from({ length: n }, (_, i) => [-halfLen * 0.8 + (i * 2 * halfLen * 0.8) / (n - 1), 0, 0] as const),
  coupleMass: 160,
  dentRadius: 0.45,
});

export const FLOATER = {
  /** Top-down boxes: half length, half width, density (kg/m^2), draught (m). */
  log: { halfL: 1.3, halfW: 0.28, density: 80, draught: 0.15 },
  hyacinth: { halfL: 0.9, halfW: 0.6, density: 45, draught: 0.09 },
  friction: 0.25,
  restitution: 0.25,
  linearDamping: 1.2,
  angularDamping: 1.6,
  /** Waves push them: a share of gravity down the surface slope. */
  slopePush: 0.5,
  vertical: {
    log: floaterVertical(210, 0.15, 1.3, 4),
    hyacinth: floaterVertical(95, 0.09, 0.9, 3),
  },
};

/* ------------------------------------------------------------------ */
/* Crocodiles                                                          */
/* ------------------------------------------------------------------ */

export const CROC = {
  count: 2,
  /** Top-down shape: half length and half width (m), mass (kg). */
  halfL: 1.9,
  halfW: 0.42,
  mass: 260,
  linearDamping: 1.1,
  angularDamping: 3,
  friction: 0.2,
  restitution: 0.2,
  /** Speeds (m/s). Stalking is slower than the boat's top speed, faster than a lazy paddle. */
  lurkSpeed: 0.9,
  stalkSpeed: 3.4,
  lungeSpeed: 7,
  retreatSpeed: 2.6,
  /** Distances (m): wake up and stalk (to the boat's centre), give up, lunge (from the snout to the hull). */
  stalkRange: 12,
  loseRange: 18,
  lungeRange: 2.5,
  /** Lunge burst (s), the bite reach from the snout (m), retreat time (s). */
  lungeTime: 0.5,
  biteReach: 1.0,
  retreatTime: 5,
  /** Steering gain (1/s) toward the wanted velocity. */
  steer: 5,
  turnKp: 22,
  turnKd: 7,
  /** Never spawn closer than this to the boat (m). */
  spawnMin: 15,
  /** Lurking drifts a little toward the boat (m/s): crocodiles feel the wake. */
  lurkPull: 1.1,
  /** Bite: knockback impulse and spin on the boat, score, seconds off the night, and a stun for the croc. */
  bite: { impulse: 1100, spin: 420, score: 150, seconds: 15 },
  /** Vertical: heave and pitch like any floater. */
  vertical: {
    mass: 260,
    gyrPitch: 1.1,
    gyrRoll: 0.3,
    draught: 0.25,
    zeta: 0.5,
    pts: [
      [-1.4, 0, 0],
      [-0.5, 0, 0],
      [0.5, 0, 0],
      [1.4, 0, 0],
    ],
    coupleMass: 140,
    dentRadius: 0.5,
  } as BuoySpec,
  /** Where the water line sits in the sprite (fraction of its height from the top): surfaced / lunging, and lurking. */
  lineSurfaced: 0.5,
  lineLurk: 0.2,
};

/** Lit lanterns make a safe circle crocodiles steer out of (m). */
export const SAFE = { lantern: 3.5, dock: DOCK.safeRadius };

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export const SCORE = {
  lantern: LANTERN.score,
  dock: DOCK.score,
  clearBonus: 2000,
  timePerSecond: 10,
};

/* ------------------------------------------------------------------ */
/* Camera, layers                                                      */
/* ------------------------------------------------------------------ */

/**
 * The camera is low and behind the near bank, looking across the river. One projection:
 *   d = z + zCam,  s = f / d,  screenX = cx + (x - camX) s,  screenY = horizonY + (camH - y) s.
 * zCam is chosen so the far bank is 0.45 times the size of the near one: zCam / (width + zCam).
 * camH and f are derived from the viewport (camera.ts): f from the pixels per metre mid river,
 * camH so the whole river width takes about `waterFraction` of the viewport height.
 */
export const VIEW = {
  zCam: (WORLD.width * 0.45) / 0.55,
  /** Pixels per metre mid river: from the viewport height, but no more than the width allows. */
  midPerHeight: 0.078,
  minWidthMid: 11,
  /** Share of the viewport height the river takes on screen, and the range of camera heights (m). */
  waterFraction: 0.5,
  camH: { min: 5, max: 10 },
  /** Where the near bank edge (z = 0) sits, as a fraction of the screen height from the top. */
  nearEdge: 0.9,
  /** Camera smoothing (1/s) and look ahead (m per m/s of boat speed, capped). */
  follow: 3.2,
  lookAhead: 0.8,
  lookAheadMax: 3,
  /** Parallax factor per layer: how much of the camera movement each layer follows. */
  parallax: { far: 0.12, mid: 0.4, front: 1.2 },
  /** Resolution cap. */
  maxDpr: 2,
};

/** Colours (the placeholder palette; the art swaps in over it). */
export const PALETTE = {
  skyTop: '#070a22',
  skyMid: '#0f1a45',
  skyLow: '#17495a',
  bankFar: '#11284a',
  bankMid: '#0a1830',
  bankFront: '#04101c',
  highlight: '#bfe3ff',
  amber: '#ffb347',
  moon: '#fff1c9',
  wood: '#3a2a22',
  woodLit: '#6b4a38',
};

/* ------------------------------------------------------------------ */
/* Art: file names and sprite placement                                */
/* ------------------------------------------------------------------ */

/**
 * `file`   in public/night/ (a missing file means the placeholder is drawn)
 * `width`  world width of the sprite (m); the height follows the image's aspect ratio
 * `anchor` the point of the image (fraction of width, height from the top left) ...
 * `at`     ... that sits at this local position (u along the heading, y up, in metres) relative to
 *          the body's waterline datum
 * Every sprite is side-on art, clipped at the water surface under it.
 */
export interface SpriteSpec {
  file: string;
  width: number;
  anchor: readonly [number, number];
  at: readonly [number, number];
}

export const SPRITES: Record<'boat' | 'lanternOff' | 'lanternOn' | 'dock' | 'log' | 'hyacinth' | 'croc' | 'moon', SpriteSpec> = {
  /** The hull bottom is the image bottom: it sits one draught under the waterline, and the clip shows that. */
  boat: { file: 'boat.webp', width: 5, anchor: [0.5, 1], at: [0, -BOAT.draught] },
  lanternOff: { file: 'lantern-off.webp', width: 0.5, anchor: [0.5, 0.5], at: [0, 0] },
  lanternOn: { file: 'lantern-on.webp', width: 0.5, anchor: [0.5, 0.5], at: [0, 0] },
  /** Anchored at its big mooring post (92% across), so the post of the art is the post of the physics. */
  dock: { file: 'dock.webp', width: 6, anchor: [0.92, 1], at: [0, -0.3] },
  log: { file: 'log.webp', width: 3, anchor: [0.5, 0.62], at: [0, 0] },
  hyacinth: { file: 'hyacinth.webp', width: 2, anchor: [0.5, 0.82], at: [0, 0] },
  /** 993 x 315: the anchor's y is the water line fraction, set per frame between lineSurfaced and lineLurk. */
  croc: { file: 'croc.webp', width: 4, anchor: [0.5, CROC.lineSurfaced], at: [0, 0] },
  moon: { file: 'moon.webp', width: 3.6, anchor: [0.5, 0.5], at: [0, 0] },
};

/** Places on the dock art (fractions of the image): the middle of the sign board, the lantern on the sign pole, the top of the post. */
export const DOCK_ART = { sign: [0.68, 0.17], lamp: [0.714, 0.42], post: [0.92, 0.28] } as const;

export interface LayerSpec {
  file: string;
  /** World height of one tile at the far bank (m); the width follows the aspect ratio. */
  height: number;
  /** How far the tile's bottom edge sits below the far edge of the water, in tile heights (tucked behind the next layer). */
  tuck: number;
}

/** The far layer's bottom is tucked behind the mid layer; the mid layer's bottom meets the far edge of the water. */
export const LAYERS: Record<'far' | 'mid' | 'front', LayerSpec> = {
  far: { file: 'far.webp', height: 5.5, tuck: 0.3 },
  mid: { file: 'mid.webp', height: 5.2, tuck: 0 },
  /** The foreground is pinned to the bottom edge of the screen: `height` is a fraction of the screen height (a strip, never hiding the near river). */
  front: { file: 'front.webp', height: 0.14, tuck: 0 },
};

/** Moon arc across the sky: start and end as fractions of the screen width, and the low and high height (fractions of the sky). */
export const MOON = { x0: 0.08, x1: 0.92, yLow: 0.8, yHigh: 0.22 };

/** All art files, for the loader. */
export const ART_FILES = ['sky', 'moon', 'far', 'mid', 'front', 'boat', 'lantern-off', 'lantern-on', 'dock', 'log', 'hyacinth', 'croc'].map(
  (n) => `${n}.webp`,
);
