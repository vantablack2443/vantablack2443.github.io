//! The river surface of "Lantern River": a 2D height field on a regular grid.
//!
//! Each cell has a height `h` (m) and a vertical velocity `v` (m/s). Per step:
//!
//!   v += (c^2 * laplacian(h) - damping * v) * dt
//!   h += v * dt
//!
//! with a 5-point Laplacian (the four neighbours minus 4 times the cell, over dx^2). The update
//! is symplectic Euler (v first, then h with the new v), the standard stable choice for a wave
//! equation. CFL limit: the update is stable for c * dt / dx <= 1 / sqrt(2) (about 0.707 for the
//! 2D 5-point stencil). With c = 4.5 m/s and dx = 0.25 m that allows dt up to 0.039 s; the game
//! steps at 1/60 s (c dt / dx = 0.3), so there is a wide margin.
//!
//! The banks mirror (no flow through the edge), and strips along both banks and both ends of the
//! river (the reed beds) soak waves up: extra velocity damping there, ramping up quadratically
//! toward the edge, and a slow leak of the height so a net push cannot raise the river for good.
//!
//! The C ABI at the bottom works on raw linear memory with no glue (no wasm-bindgen): the host
//! reads `water_heights` / `water_velocities` through a Float32Array on the wasm memory.

/// Reed beds at the two river ends and along the banks: width of the absorbing strips (m).
const END_STRIP: f32 = 8.0;
const BANK_STRIP: f32 = 2.0;
/// The height leak in a strip, as a fraction of its velocity damping.
const LEAK: f32 = 0.25;

pub struct Water {
    nx: usize,
    nz: usize,
    dx: f32,
    h: Vec<f32>,
    v: Vec<f32>,
    /// Per cell velocity damping (1/s): the base value plus the reed strips.
    damp: Vec<f32>,
    /// Per cell height leak (1/s): only in the strips.
    leak: Vec<f32>,
    c: f32,
}

impl Water {
    pub fn new(nx: usize, nz: usize, dx: f32) -> Water {
        let n = nx * nz;
        let mut w = Water {
            nx,
            nz,
            dx,
            h: vec![0.0; n],
            v: vec![0.0; n],
            damp: vec![0.0; n],
            leak: vec![0.0; n],
            c: 4.5,
        };
        w.set_params(4.5, 0.45, 6.0);
        w
    }

    pub fn nx(&self) -> usize {
        self.nx
    }
    pub fn nz(&self) -> usize {
        self.nz
    }
    pub fn dx(&self) -> f32 {
        self.dx
    }
    pub fn heights(&self) -> &[f32] {
        &self.h
    }
    pub fn velocities(&self) -> &[f32] {
        &self.v
    }

    /// Wave speed c (m/s), the base damping (1/s) and the extra damping in the reed strips (1/s).
    pub fn set_params(&mut self, c: f32, damping: f32, edge_damping: f32) {
        self.c = c;
        let (nx, nz, dx) = (self.nx, self.nz, self.dx);
        for j in 0..nz {
            let z = (j as f32 + 0.5) * dx;
            let bank = z.min(nz as f32 * dx - z);
            let rb = (1.0 - bank / BANK_STRIP).max(0.0);
            for i in 0..nx {
                let x = (i as f32 + 0.5) * dx;
                let end = x.min(nx as f32 * dx - x);
                let re = (1.0 - end / END_STRIP).max(0.0);
                let ramp = re.max(rb);
                let ramp = ramp * ramp;
                self.damp[j * nx + i] = damping + edge_damping * ramp;
                self.leak[j * nx + i] = LEAK * edge_damping * ramp;
            }
        }
    }

    /// Advance by dt seconds.
    pub fn step(&mut self, dt: f32) {
        let (nx, nz) = (self.nx, self.nz);
        let k = (self.c / self.dx) * (self.c / self.dx);
        let (h, v, damp) = (&self.h, &mut self.v, &self.damp);
        for j in 0..nz {
            // a row beyond the bank is the bank row itself: the mirrored edge
            let up = if j > 0 { j - 1 } else { j } * nx;
            let dn = if j + 1 < nz { j + 1 } else { j } * nx;
            let r = j * nx;
            let (hu, hd, hr) = (&h[up..up + nx], &h[dn..dn + nx], &h[r..r + nx]);
            let (vr, dr) = (&mut v[r..r + nx], &damp[r..r + nx]);
            for i in 0..nx {
                let l = if i > 0 { hr[i - 1] } else { hr[i] };
                let rt = if i + 1 < nx { hr[i + 1] } else { hr[i] };
                let lap = l + rt + hu[i] + hd[i] - 4.0 * hr[i];
                vr[i] += (k * lap - dr[i] * vr[i]) * dt;
            }
        }
        for ((h, v), l) in self.h.iter_mut().zip(self.v.iter()).zip(self.leak.iter()) {
            *h += *v * dt;
            *h -= *h * *l * dt;
        }
    }

    /// A smooth Gaussian push: adds up to `impulse` (m/s, positive is up) to the velocity at (x, z),
    /// falling off to nearly nothing at `radius` (m) from it.
    pub fn disturb(&mut self, x: f32, z: f32, radius: f32, impulse: f32) {
        let dx = self.dx;
        let sigma = (radius * 0.4).max(dx * 0.6);
        let fx = x / dx - 0.5;
        let fz = z / dx - 0.5;
        let reach = (radius / dx).ceil().max(1.0);
        let i0 = (fx - reach).ceil().max(0.0) as usize;
        let i1 = ((fx + reach).floor().min(self.nx as f32 - 1.0)).max(-1.0);
        let j0 = (fz - reach).ceil().max(0.0) as usize;
        let j1 = ((fz + reach).floor().min(self.nz as f32 - 1.0)).max(-1.0);
        if i1 < 0.0 || j1 < 0.0 {
            return;
        }
        let (i1, j1) = (i1 as usize, j1 as usize);
        if i0 > i1 || j0 > j1 {
            return;
        }
        // the Gaussian is separable: one exp per column and per row, not per cell
        let inv = -0.5 / (sigma * sigma);
        let mut gx = [0.0f32; 64];
        let mut gz = [0.0f32; 64];
        let (wi, wj) = (i1 - i0 + 1, j1 - j0 + 1);
        if wi > 64 || wj > 64 {
            return;
        }
        for i in 0..wi {
            let d = ((i0 + i) as f32 - fx) * dx;
            gx[i] = (d * d * inv).exp();
        }
        for j in 0..wj {
            let d = ((j0 + j) as f32 - fz) * dx;
            gz[j] = (d * d * inv).exp() * impulse;
        }
        for j in 0..wj {
            let row = (j0 + j) * self.nx + i0;
            for i in 0..wi {
                self.v[row + i] += gx[i] * gz[j];
            }
        }
    }

    /// Kinetic plus wave energy (the gradient term), for tests: 1/2 v^2 + 1/2 c^2 |grad h|^2.
    pub fn energy(&self) -> f64 {
        let (nx, nz, dx) = (self.nx, self.nz, self.dx as f64);
        let c2 = (self.c as f64) * (self.c as f64);
        let mut e = 0.0f64;
        for j in 0..nz {
            for i in 0..nx {
                let n = j * nx + i;
                let v = self.v[n] as f64;
                e += 0.5 * v * v;
                if i + 1 < nx {
                    let g = (self.h[n + 1] - self.h[n]) as f64 / dx;
                    e += 0.5 * c2 * g * g;
                }
                if j + 1 < nz {
                    let g = (self.h[n + nx] - self.h[n]) as f64 / dx;
                    e += 0.5 * c2 * g * g;
                }
            }
        }
        e * dx * dx
    }

    pub fn is_finite(&self) -> bool {
        self.h.iter().all(|x| x.is_finite()) && self.v.iter().all(|x| x.is_finite())
    }
}

/* ---------------- the C ABI, on raw linear memory ---------------- */

#[no_mangle]
pub extern "C" fn water_new(nx: u32, nz: u32, dx: f32) -> *mut Water {
    Box::into_raw(Box::new(Water::new(nx as usize, nz as usize, dx)))
}

/// # Safety
/// `ptr` must come from `water_new` and not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn water_free(ptr: *mut Water) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

/// # Safety
/// `ptr` must be a live pointer from `water_new`.
#[no_mangle]
pub unsafe extern "C" fn water_step(ptr: *mut Water, dt: f32) {
    (*ptr).step(dt);
}

/// # Safety
/// `ptr` must be a live pointer from `water_new`.
#[no_mangle]
pub unsafe extern "C" fn water_disturb(ptr: *mut Water, x: f32, z: f32, radius: f32, impulse: f32) {
    (*ptr).disturb(x, z, radius, impulse);
}

/// Height of every cell (m), row by row (z), `nx * nz` floats.
/// # Safety
/// `ptr` must be a live pointer from `water_new`.
#[no_mangle]
pub unsafe extern "C" fn water_heights(ptr: *const Water) -> *const f32 {
    (*ptr).h.as_ptr()
}

/// Vertical velocity of every cell (m/s), same layout.
/// # Safety
/// `ptr` must be a live pointer from `water_new`.
#[no_mangle]
pub unsafe extern "C" fn water_velocities(ptr: *const Water) -> *const f32 {
    (*ptr).v.as_ptr()
}

/// # Safety
/// `ptr` must be a live pointer from `water_new`.
#[no_mangle]
pub unsafe extern "C" fn water_params(ptr: *mut Water, c: f32, damping: f32, edge_damping: f32) {
    (*ptr).set_params(c, damping, edge_damping);
}

#[cfg(test)]
mod tests {
    use super::*;

    const NX: usize = 560;
    const NZ: usize = 64;
    const DX: f32 = 0.25;
    const DT: f32 = 1.0 / 60.0;

    /// A tiny deterministic generator (no dependencies).
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 40) as f32) / 16777216.0
        }
    }

    #[test]
    fn energy_decays_below_one_percent_in_20_s_with_no_input() {
        let mut w = Water::new(NX, NZ, DX);
        w.disturb(70.0, 8.0, 1.2, -3.0);
        w.disturb(71.5, 9.0, 0.8, 2.0);
        // let the push turn into waves first, then measure from there
        for _ in 0..6 {
            w.step(DT);
        }
        let e0 = w.energy();
        assert!(e0 > 0.0);
        for _ in 0..(20.0 / DT) as usize {
            w.step(DT);
        }
        assert!(w.is_finite());
        let ratio = w.energy() / e0;
        assert!(ratio < 0.01, "energy left after 20 s: {ratio}");
    }

    #[test]
    fn no_nan_after_60_s_of_random_disturbances() {
        let mut w = Water::new(NX, NZ, DX);
        let mut r = Lcg(7);
        for n in 0..(60.0 / DT) as usize {
            if n % 3 == 0 {
                let x = r.next() * 150.0 - 5.0; // some land outside the river: they must be ignored safely
                let z = r.next() * 20.0 - 2.0;
                w.disturb(x, z, 0.3 + r.next() * 2.0, (r.next() - 0.5) * 12.0);
            }
            w.step(DT);
        }
        assert!(w.is_finite());
        let peak = w.heights().iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak < 50.0, "peak height {peak}");
    }

    #[test]
    fn a_disturbance_spreads_as_a_ring() {
        let mut w = Water::new(NX, NZ, DX);
        let (cx, cz) = (70.0f32, 8.0f32);
        w.disturb(cx, cz, 1.2, -3.0);
        for _ in 0..(0.9 / DT) as usize {
            w.step(DT);
        }
        let at = |x: f32, z: f32| -> f32 {
            let (fx, fz) = (x / DX - 0.5, z / DX - 0.5);
            let (i, j) = (fx.floor() as usize, fz.floor() as usize);
            let (tx, tz) = (fx - i as f32, fz - j as f32);
            let h = w.heights();
            let g = |i: usize, j: usize| h[j * NX + i];
            (g(i, j) * (1.0 - tx) + g(i + 1, j) * tx) * (1.0 - tz) + (g(i, j + 1) * (1.0 - tx) + g(i + 1, j + 1) * tx) * tz
        };
        // the biggest ripple along +x tells the ring radius, then probe the other seven directions
        let mut best = (0.0f32, 0.0f32);
        let mut rr = 1.0f32;
        while rr < 6.0 {
            let a = at(cx + rr, cz).abs();
            if a > best.0 {
                best = (a, rr);
            }
            rr += 0.1;
        }
        let (amp, ring) = best;
        assert!(amp > 0.02, "a ripple should be visible: {amp}");
        for k in 0..8 {
            let a = k as f32 * std::f32::consts::FRAC_PI_4;
            let p = at(cx + ring * a.cos(), cz + ring * a.sin());
            assert!((p.abs() - amp).abs() < 0.12 * amp, "direction {k}: {p} vs {amp}");
        }
    }
}
