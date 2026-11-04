/**
 * The TypeScript reference of the river's height field: the same algorithm as water-rs/src/lib.rs,
 * line for line (a 5-point Laplacian wave equation with damping and absorbing reed strips).
 * It is the fallback when the WebAssembly module cannot be loaded, and tests/river.test.ts checks
 * that the two agree. If you change one, change the other.
 */

/** The absorbing strips (see the Rust file). */
const END_STRIP = 8;
const BANK_STRIP = 2;
const LEAK = 0.25;

/** What water.ts needs from a height field, wasm or TypeScript. */
export interface Field {
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  /** Height (m) and vertical velocity (m/s) per cell, row by row (z). Re-read after any call: a wasm view can be replaced. */
  readonly h: Float32Array;
  readonly v: Float32Array;
  step(dt: number): void;
  disturb(x: number, z: number, radius: number, impulse: number): void;
  setParams(c: number, damping: number, edgeDamping: number): void;
}

export class WaterRef implements Field {
  readonly h: Float32Array;
  readonly v: Float32Array;
  private readonly damp: Float32Array;
  private readonly leak: Float32Array;
  private c = 4.5;
  private readonly gx = new Float32Array(64);
  private readonly gz = new Float32Array(64);

  constructor(
    readonly nx: number,
    readonly nz: number,
    readonly dx: number,
  ) {
    const n = nx * nz;
    this.h = new Float32Array(n);
    this.v = new Float32Array(n);
    this.damp = new Float32Array(n);
    this.leak = new Float32Array(n);
    this.setParams(4.5, 0.45, 6);
  }

  setParams(c: number, damping: number, edgeDamping: number): void {
    this.c = Math.fround(c);
    const { nx, nz, dx } = this;
    for (let j = 0; j < nz; j++) {
      const z = (j + 0.5) * dx;
      const bank = Math.min(z, nz * dx - z);
      const rb = Math.max(0, 1 - bank / BANK_STRIP);
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * dx;
        const end = Math.min(x, nx * dx - x);
        const re = Math.max(0, 1 - end / END_STRIP);
        const r = Math.max(re, rb);
        const ramp = r * r;
        this.damp[j * nx + i] = damping + edgeDamping * ramp;
        this.leak[j * nx + i] = LEAK * edgeDamping * ramp;
      }
    }
  }

  step(dt: number): void {
    const { nx, nz, h, v, damp, leak } = this;
    const k = (this.c / this.dx) * (this.c / this.dx);
    for (let j = 0; j < nz; j++) {
      // a row beyond the bank is the bank row itself: the mirrored edge
      const up = (j > 0 ? j - 1 : j) * nx;
      const dn = (j + 1 < nz ? j + 1 : j) * nx;
      const r = j * nx;
      for (let i = 0; i < nx; i++) {
        const c = h[r + i];
        const l = i > 0 ? h[r + i - 1] : c;
        const rt = i + 1 < nx ? h[r + i + 1] : c;
        const lap = l + rt + h[up + i] + h[dn + i] - 4 * c;
        v[r + i] += (k * lap - damp[r + i] * v[r + i]) * dt;
      }
    }
    for (let n = 0, len = nx * nz; n < len; n++) {
      h[n] += v[n] * dt;
      h[n] -= h[n] * leak[n] * dt;
    }
  }

  disturb(x: number, z: number, radius: number, impulse: number): void {
    const { dx, nx, nz, gx, gz, v } = this;
    const sigma = Math.max(radius * 0.4, dx * 0.6);
    const fx = x / dx - 0.5;
    const fz = z / dx - 0.5;
    const reach = Math.max(1, Math.ceil(radius / dx));
    const i0 = Math.max(0, Math.ceil(fx - reach));
    const i1 = Math.min(nx - 1, Math.floor(fx + reach));
    const j0 = Math.max(0, Math.ceil(fz - reach));
    const j1 = Math.min(nz - 1, Math.floor(fz + reach));
    if (i0 > i1 || j0 > j1) return;
    const wi = i1 - i0 + 1;
    const wj = j1 - j0 + 1;
    if (wi > 64 || wj > 64) return;
    const inv = -0.5 / (sigma * sigma);
    for (let i = 0; i < wi; i++) {
      const d = (i0 + i - fx) * dx;
      gx[i] = Math.exp(d * d * inv);
    }
    for (let j = 0; j < wj; j++) {
      const d = (j0 + j - fz) * dx;
      gz[j] = Math.exp(d * d * inv) * impulse;
    }
    for (let j = 0; j < wj; j++) {
      const row = (j0 + j) * nx + i0;
      for (let i = 0; i < wi; i++) v[row + i] += gx[i] * gz[j];
    }
  }
}
