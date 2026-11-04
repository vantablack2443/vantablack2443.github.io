import { WATER } from './config';
import { WaterRef, type Field } from './water-ref';

/**
 * The river surface the sim and the renderer talk to: heightAt, slopeAt, velocityAt, disturb and
 * step over a 2D height field (cells every 0.25 m, 560 x 64). The field itself is Rust compiled to
 * WebAssembly (water-rs/), read through Float32Array views on the module's memory; if the module
 * cannot be loaded, the TypeScript reference (water-ref.ts, same algorithm) runs instead.
 * The ambient swell, two slow sines in x and z, is added here at sample time, so the field itself
 * settles to flat and the surface is never dead.
 */

type Exports = {
  memory: WebAssembly.Memory;
  water_new(nx: number, nz: number, dx: number): number;
  water_free(ptr: number): void;
  water_step(ptr: number, dt: number): void;
  water_disturb(ptr: number, x: number, z: number, radius: number, impulse: number): void;
  water_heights(ptr: number): number;
  water_velocities(ptr: number): number;
  water_params(ptr: number, c: number, damping: number, edgeDamping: number): void;
};

let compiled: WebAssembly.Module | null = null;

/**
 * Load the wasm module from a URL (the browser: fetch + instantiateStreaming) or from bytes
 * (tests, from fs). Returns whether the Rust field is available. Never throws: on failure the
 * game keeps the TypeScript field.
 */
export async function loadWaterWasm(source: string | URL | BufferSource): Promise<boolean> {
  try {
    if (typeof source === 'string' || source instanceof URL) {
      try {
        compiled = (await WebAssembly.instantiateStreaming(fetch(source), {})).module;
      } catch {
        // a server that does not send application/wasm: compile the bytes by hand
        compiled = await WebAssembly.compile(await (await fetch(source)).arrayBuffer());
      }
    } else {
      compiled = await WebAssembly.compile(source);
    }
  } catch (err) {
    console.warn('[portfolio] water.wasm failed to load, using the TypeScript water', err);
    compiled = null;
  }
  return compiled !== null;
}

export type Backend = 'wasm' | 'ts';

/** The Rust field: one module instance (its own memory) per river. */
export class WasmField implements Field {
  private readonly x: Exports;
  private readonly ptr: number;
  private buf: ArrayBufferLike | null = null;
  private hv!: Float32Array;
  private vv!: Float32Array;

  constructor(
    module: WebAssembly.Module,
    readonly nx: number,
    readonly nz: number,
    readonly dx: number,
  ) {
    this.x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
    this.ptr = this.x.water_new(nx, nz, dx);
    this.views();
  }

  /** (Re)create the views if the memory grew: a grown wasm memory detaches the old ArrayBuffer. */
  private views(): void {
    const buf = this.x.memory.buffer;
    if (buf === this.buf) return;
    this.buf = buf;
    const n = this.nx * this.nz;
    this.hv = new Float32Array(buf, this.x.water_heights(this.ptr), n);
    this.vv = new Float32Array(buf, this.x.water_velocities(this.ptr), n);
  }

  get h(): Float32Array {
    this.views();
    return this.hv;
  }
  get v(): Float32Array {
    this.views();
    return this.vv;
  }
  step(dt: number): void {
    this.x.water_step(this.ptr, dt);
  }
  disturb(x: number, z: number, radius: number, impulse: number): void {
    this.x.water_disturb(this.ptr, x, z, radius, impulse);
  }
  setParams(c: number, damping: number, edgeDamping: number): void {
    this.x.water_params(this.ptr, c, damping, edgeDamping);
  }
  free(): void {
    this.x.water_free(this.ptr);
  }
}

export class Water {
  readonly nx = WATER.nx;
  readonly nz = WATER.nz;
  readonly dx = WATER.dx;
  readonly length = WATER.nx * WATER.dx;
  readonly width = WATER.nz * WATER.dx;
  readonly backend: Backend;
  private readonly f: Field;
  /** Seconds simulated so far (drives the swell). */
  time = 0;
  private readonly phase: number[];
  private readonly slope = { x: 0, z: 0 };

  /** `forceTs` picks the TypeScript field even if the wasm module is loaded (the parity test). */
  constructor(seed = 0, forceTs = false) {
    if (compiled && !forceTs) {
      this.f = new WasmField(compiled, this.nx, this.nz, this.dx);
      this.backend = 'wasm';
    } else {
      this.f = new WaterRef(this.nx, this.nz, this.dx);
      this.backend = 'ts';
    }
    this.f.setParams(WATER.speed, WATER.damping, WATER.edgeDamping);
    // the seed only shifts where the swell starts, so every night differs a little
    this.phase = WATER.swell.map((_, i) => (((seed * 2654435761 + i * 40503) >>> 0) % 6283) / 1000);
  }

  /** The raw cells (heights, velocities), for the debug badge, the parity test and the renderer. */
  get h(): Float32Array {
    return this.f.h;
  }
  get v(): Float32Array {
    return this.f.v;
  }

  step(dt: number): void {
    this.f.step(dt);
    this.time += dt;
  }

  /** A smooth Gaussian push of up to `impulse` m/s (up is positive), falling to nothing at `radius` m. */
  disturb(x: number, z: number, radius: number, impulse: number): void {
    this.f.disturb(x, z, radius, impulse);
  }

  /** Swell height and vertical speed at (x, z), and its slope, into `out`. */
  private swell(x: number, z: number, out: { h: number; v: number; sx: number; sz: number }): void {
    let h = 0;
    let v = 0;
    let sx = 0;
    let sz = 0;
    const tau = Math.PI * 2;
    for (let i = 0; i < WATER.swell.length; i++) {
      const s = WATER.swell[i];
      const w = tau / s.period;
      const arg = tau * (s.kx * x + s.kz * z) - w * this.time + this.phase[i];
      const sn = Math.sin(arg);
      const cs = Math.cos(arg);
      h += s.amp * sn;
      v += -s.amp * w * cs;
      sx += s.amp * tau * s.kx * cs;
      sz += s.amp * tau * s.kz * cs;
    }
    out.h = h;
    out.v = v;
    out.sx = sx;
    out.sz = sz;
  }
  private readonly sw = { h: 0, v: 0, sx: 0, sz: 0 };

  /** Bilinear read of a cell array at (x, z), cells centred on (i + 0.5) dx. */
  private sample(a: Float32Array, x: number, z: number): number {
    const nx = this.nx;
    let fx = x / this.dx - 0.5;
    let fz = z / this.dx - 0.5;
    fx = fx < 0 ? 0 : fx > nx - 1.0001 ? nx - 1.0001 : fx;
    fz = fz < 0 ? 0 : fz > this.nz - 1.0001 ? this.nz - 1.0001 : fz;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * nx + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + nx] * (1 - tx) + a[k + nx + 1] * tx) * tz;
  }

  /** Surface height (m) at (x, z): the cells, interpolated, plus the swell. */
  heightAt(x: number, z: number): number {
    this.swell(x, z, this.sw);
    return this.sample(this.f.h, x, z) + this.sw.h;
  }

  /** Vertical velocity (m/s) of the surface at (x, z). */
  velocityAt(x: number, z: number): number {
    this.swell(x, z, this.sw);
    return this.sample(this.f.v, x, z) + this.sw.v;
  }

  /** Surface slope (dh/dx, dh/dz) at (x, z). The returned object is reused by the next call. */
  slopeAt(x: number, z: number): { x: number; z: number } {
    const e = this.dx;
    const h = this.f.h;
    this.swell(x, z, this.sw);
    this.slope.x = (this.sample(h, x + e, z) - this.sample(h, x - e, z)) / (2 * e) + this.sw.sx;
    this.slope.z = (this.sample(h, x, z + e) - this.sample(h, x, z - e)) / (2 * e) + this.sw.sz;
    return this.slope;
  }

  /** Wave energy of the cells (1/2 v^2 + 1/2 c^2 |grad h|^2), for tests. */
  energy(): number {
    const { nx, nz, dx } = this;
    const h = this.f.h;
    const v = this.f.v;
    const c2 = WATER.speed * WATER.speed;
    let e = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        e += 0.5 * v[n] * v[n];
        if (i < nx - 1) {
          const g = (h[n + 1] - h[n]) / dx;
          e += 0.5 * c2 * g * g;
        }
        if (j < nz - 1) {
          const g = (h[n + nx] - h[n]) / dx;
          e += 0.5 * c2 * g * g;
        }
      }
    }
    return e * dx * dx;
  }

  /** True if every cell is a finite number. */
  isFinite(): boolean {
    const h = this.f.h;
    const v = this.f.v;
    for (let i = 0; i < h.length; i++) if (!Number.isFinite(h[i]) || !Number.isFinite(v[i])) return false;
    return true;
  }
}
