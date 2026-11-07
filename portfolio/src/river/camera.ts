import { VIEW, WORLD } from './config';

/**
 * The camera: low, behind the near bank, looking across the river. The one place that turns the
 * world (x along the river, y up, z across, 0 near and `width` far) into pixels:
 *
 *   d = z + zCam      s = f / d      screenX = cx + (x - camX) s      screenY = horizonY + (camH - y) s
 *
 * s is pixels per metre at that depth. zCam is fixed so the far bank is 0.65 times the size of the
 * near one; the viewport sets the rest: f from the pixels per metre mid river (the height of the
 * screen, but no more than the width allows) and camH so the whole river width takes about half
 * of the screen height. Whatever is left above is sky and the far banks.
 */
export class Camera {
  W = 1;
  H = 1;
  cx = 0;
  /** Camera x (m): follows the boat. */
  x = 0;
  f = 1;
  camH = 6;
  horizonY = 0;
  /** Screen shake (px), added to every projection. */
  ox = 0;
  oy = 0;
  /** Screen y of the water's near edge (z = 0) and far edge (z = width). */
  nearY = 0;
  farY = 0;

  /** Fit to a viewport (CSS pixels). */
  layout(W: number, H: number): void {
    this.W = Math.max(1, W);
    this.H = Math.max(1, H);
    this.cx = this.W / 2;
    const zc = VIEW.zCam;
    const mid = Math.min(this.H * VIEW.midPerHeight, this.W / VIEW.minWidthMid);
    this.f = mid * (WORLD.width / 2 + zc);
    const sNear = this.f / zc;
    const sFar = this.f / (WORLD.width + zc);
    const want = (VIEW.waterFraction * this.H) / (sNear - sFar);
    this.camH = Math.max(VIEW.camH.min, Math.min(VIEW.camH.max, want));
    this.nearY = VIEW.nearEdge * this.H;
    this.horizonY = this.nearY - this.camH * sNear;
    this.farY = this.horizonY + this.camH * sFar;
  }

  /** Pixels per metre at depth z. */
  scale(z: number): number {
    return this.f / (z + VIEW.zCam);
  }
  sx(x: number, s: number): number {
    return this.cx + this.ox + (x - this.x) * s;
  }
  sy(y: number, s: number): number {
    return this.horizonY + this.oy + (this.camH - y) * s;
  }

  /** Half the visible width (m) at depth z. */
  halfWidthAt(z: number): number {
    return this.W / (2 * this.scale(z));
  }

  /** Where a screen y lands on the water plane (y = 0): its z, or null above the horizon. */
  waterZ(screenY: number): number | null {
    const dy = screenY - this.horizonY - this.oy;
    if (dy <= 1e-3) return null;
    return (this.camH * this.f) / dy - VIEW.zCam;
  }

  /** World x at a screen x for an object at depth z. */
  worldX(screenX: number, z: number): number {
    return this.x + (screenX - this.cx - this.ox) / this.scale(z);
  }
}
