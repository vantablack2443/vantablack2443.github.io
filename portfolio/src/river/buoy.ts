import { WORLD, type BuoySpec } from './config';
import type { Water } from './water';

/**
 * The vertical half of a floating body: a small custom integrator for heave, pitch and roll,
 * driven by the height field sampled at a handful of points under the hull. The horizontal half
 * (planck, seen from above) lives in sim.ts and tells this where the body is and which way it
 * points; this tells the renderer how high it rides and how it tilts.
 *
 * Each sample point i sits at local (u along the heading, w across) with its hull bottom `rise_i`
 * above the lowest point. A point is wet when the water is above it, and pushes up with
 * k_i * depth plus a damper on its velocity relative to the water. The stiffness is chosen so the
 * body floats at its rest draught. Two way: a wet point moving through the water leaves a dent in
 * the field in proportion to its velocity relative to the surface.
 *
 *   y      height of the body's waterline datum (m), about the water height under it at rest
 *   pitch  bow up is positive (rad);  roll  the side at +w up is positive (rad)
 */
export class Buoy {
  y = 0;
  vy = 0;
  pitch = 0;
  wp = 0;
  roll = 0;
  wr = 0;
  /** The same three one step ago, for the renderer's interpolation. */
  py = 0;
  ppitch = 0;
  proll = 0;

  private readonly n: number;
  private readonly u: Float64Array;
  private readonly w: Float64Array;
  private readonly bottom: Float64Array;
  private readonly kPt: number;
  private readonly cPt: number;
  private readonly iPitch: number;
  private readonly iRoll: number;

  constructor(readonly spec: BuoySpec) {
    const n = spec.pts.length;
    this.n = n;
    this.u = new Float64Array(n);
    this.w = new Float64Array(n);
    this.bottom = new Float64Array(n);
    let wet = 0;
    spec.pts.forEach(([u, w, rise], i) => {
      this.u[i] = u;
      this.w[i] = w;
      this.bottom[i] = -spec.draught + rise;
      wet += Math.max(0, -this.bottom[i]);
    });
    // stiffness: the points together carry the weight at the rest draught
    this.kPt = (spec.mass * WORLD.gravity) / wet;
    // damping: zeta of critical for the heave, shared by the points
    const omega2 = (this.kPt * n) / spec.mass;
    this.cPt = (2 * spec.zeta * Math.sqrt(omega2) * spec.mass) / n;
    this.iPitch = spec.mass * spec.gyrPitch * spec.gyrPitch;
    this.iRoll = spec.mass * spec.gyrRoll * spec.gyrRoll;
  }

  /** Put the body at rest on the water under (x, z). */
  settle(water: Water, x: number, z: number): void {
    this.y = this.py = water.heightAt(x, z);
    this.vy = this.pitch = this.wp = this.roll = this.wr = this.ppitch = this.proll = 0;
  }

  /** Kick the pitch (rad/s) or the heave (m/s): a stroke, a hit. */
  kick(pitch: number, heave = 0): void {
    this.wp += pitch;
    this.vy += heave;
  }

  /**
   * One step. (x, z) and yaw are the horizontal pose from the top-down physics.
   */
  step(dt: number, water: Water, x: number, z: number, yaw: number): void {
    this.py = this.y;
    this.ppitch = this.pitch;
    this.proll = this.roll;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const g = WORLD.gravity;
    const spec = this.spec;
    let force = -spec.mass * g;
    let tp = 0;
    let tr = 0;
    for (let i = 0; i < this.n; i++) {
      const u = this.u[i];
      const w = this.w[i];
      const wx = x + c * u - s * w;
      const wz = z + s * u + c * w;
      const e = this.y + u * this.pitch + w * this.roll + this.bottom[i];
      const depth = water.heightAt(wx, wz) - e;
      if (depth <= 0) continue;
      const vp = this.vy + u * this.wp + w * this.wr;
      const vw = water.velocityAt(wx, wz);
      const rel = vp - vw;
      // the damper fades in over the first centimetres so a point at the surface does not stick to it
      const fade = depth > 0.08 ? 1 : depth / 0.08;
      const f = this.kPt * Math.min(depth, 1.1) - this.cPt * fade * rel;
      force += f;
      tp += f * u;
      tr += f * w;
      // two way coupling: the water is dragged along with the point (the body's bobbing makes ripples)
      const dent = (this.cPt * fade * rel * dt) / spec.coupleMass;
      if (dent > 1e-4 || dent < -1e-4) water.disturb(wx, wz, spec.dentRadius, dent);
    }
    this.vy += (force / spec.mass) * dt;
    this.wp += (tp / this.iPitch) * dt;
    this.wr += (tr / this.iRoll) * dt;
    this.y += this.vy * dt;
    this.pitch += this.wp * dt;
    this.roll += this.wr * dt;
    // a runaway tilt is never wanted: clamp, and kill the spin that pushes into the clamp
    const lim = 0.6;
    if (this.pitch > lim || this.pitch < -lim) {
      this.pitch = Math.sign(this.pitch) * lim;
      this.wp = 0;
    }
    if (this.roll > lim || this.roll < -lim) {
      this.roll = Math.sign(this.roll) * lim;
      this.wr = 0;
    }
  }
}
