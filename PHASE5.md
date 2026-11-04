# Phase 5: Lantern River in two dimensions, Rust water, crocodiles

Builds on Phase 4 (read `PHASE4.md` first; it describes the current game in `src/river/`). Where they disagree, this file wins. Light mode, i18n, `#top-controls`, the dock card dialog, HUD, start overlay and summary stay as they are unless this file changes them. Design system for DOM UI: `.claude/skills/landing-page-design/SKILL.md` Part B.

Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. **Do not commit or push.**

## Why
The owner's feedback: the side-on game is too long and too linear. The boat must move **up and down** (across the river) as well as left and right, docks sit **on both banks**, and **1–2 crocodiles chase the boat**. The water physics stays and moves to **Rust compiled to WebAssembly** (the owner lists Rust on the CV; this is the showcase).

---

## 1. View: a low-angle 2.5D river

Keep the painted side-on look and all the art, but the river now has width.

- World: river **length 140 m** along x, **width 16 m** across z (z = 0 near bank at the bottom of the screen, z = 16 far bank). Height y comes from the water.
- Camera: low, behind the near bank, looking across. Perspective projection, one helper in one place: depth `d = z + zCam`, scale `s = f / d`, `screenX = cx + (x − camX)·s`, `screenY = horizonY + (camH − y)·s`. Tune `zCam`, `camH`, `f` so far objects are about 0.45× the size of near ones and the whole river width fits the viewport height on desktop and on a 390×844 phone (the sky takes what is left).
- The camera follows the boat along x with smoothing and look-ahead; z is not followed (the whole width is always visible). Clamp at the river ends.
- **Draw order by depth:** sky → moon → far layer → mid layer (the far bank; its bottom edge meets the far edge of the water) → far-bank docks → water surface → objects on the water sorted by z, far to near (lanterns, logs, hyacinth, crocodiles, the boat) → near-bank docks → front layer (plants along the bottom edge) → glow.
- **Waterline clipping:** every floating sprite is clipped at the water surface under it (mask or a shader), so the boat shows its draught, and a crocodile can sink until only its eyes and ridge show.
- Sprites keep their side-on art. Facing: flip by the sign of the heading's x component, and scale x by `max(0.55, |cos(yaw)|)` so turning across the river reads as foreshortening.

## 2. Water in Rust (WebAssembly)

- New crate `portfolio/water-rs/` (`crate-type = ["cdylib", "rlib"]`, **no dependencies**, no wasm-bindgen). A 2D height field: cells every 0.25 m (560 × 64). Per step: `v += (c²·∇²h − damping·v)·dt`, `h += v·dt` with a 5-point Laplacian, wave speed c ≈ 4.5 m/s, extra damping in absorbing strips along both banks and both ends (reed beds) so waves don't bounce forever. Check the CFL limit in a comment.
- C ABI exports on raw linear memory: `water_new(nx, nz, dx) -> *mut Water`, `water_free`, `water_step(ptr, dt)`, `water_disturb(ptr, x, z, radius, impulse)` (a smooth Gaussian push), `water_heights(ptr) -> *const f32`, `water_velocities(ptr) -> *const f32`, `water_params(ptr, c, damping, edge_damping)`. TS reads heights through a `Float32Array` view of the wasm memory (re-create the view if memory grows).
- `cargo test` in the crate: energy decays to < 1% in 20 s with no input; no NaN after 60 s of random disturbances; a disturbance spreads as a ring (symmetric within tolerance).
- `src/river/water.ts`: same interface as now, extended to 2D (`heightAt(x, z)` bilinear, `slopeAt(x, z)`, `disturb(x, z, r, impulse)`, `step(dt)`), backed by the wasm module. Load it with `fetch` + `WebAssembly.instantiateStreaming` (Vite `?url` import), and with `fs` bytes in Vitest.
- Keep a **TypeScript reference implementation** (`water-ref.ts`) with the same algorithm. It is the fallback if wasm fails to load, and a **parity test** checks Rust and TS agree (max |Δh| < 1e-4 after 5 s of the same disturbances).
- The ambient swell (two slow sines in x and z) is added analytically at sample time, as now.
- Build: `npm run build:wasm` runs `cargo build --release --target wasm32-unknown-unknown` and copies the `.wasm` into `src/river/wasm/`. `predev`, `prebuild` and `pretest` call it, so `npm run dev`, `npm run build` and `npm test` always use a fresh build. The `.wasm` is gitignored (CI builds it). Release profile: `opt-level = 3`, `lto = true`, `panic = "abort"`, `codegen-units = 1`.
- `.github/workflows/deploy.yml`: before `npm ci`, add `rustup target add wasm32-unknown-unknown` and `cargo test` (working directory `portfolio/water-rs`). Keep everything else.
- Show it: the summary card and the start overlay get one small caption line, "Water simulated in Rust, compiled to WebAssembly" (translated), and the HUD has a tiny `RUST·WASM` / `TS` badge in `?debug`.

## 3. Physics split

- **planck, top-down:** a planck world in the (x, z) plane with zero gravity. Boat, crocodiles, logs and hyacinth are dynamic bodies seen from above (boat: an elongated hexagon 5 × 1.6 m). Banks, dock posts and the river ends are static. Linear damping is anisotropic for the boat (low along its heading, high sideways: a keel), applied manually per step.
- **Vertical, from the water:** a small custom integrator per floating body for heave and pitch (and roll for the bob only), driven by the height field sampled at 6–10 points under the hull, with damping. The renderer uses heave for the sprite's y and pitch for its rotation. Two-way: floating points moving vertically and bodies moving through the water disturb the height field (wake, bow wave, ripples behind a crocodile).
- Fixed step 1/120 s, accumulator, max 5 steps a frame, contact events queued and applied after the step, deterministic for a seed + input script: unchanged.

## 4. Controls

- Arrow keys / WASD in 8 directions. Holding a direction paddles toward it on a stroke cadence (~0.35 s): an impulse along the input direction, a torque turning the heading toward it, and a splash beside the hull. Top speed ≈ 5 m/s, reached in ~2 s; it must feel quick and responsive, not heavy.
- Touch: a virtual stick appears where the finger lands (anywhere on the canvas below the HUD); drag direction and distance set the paddle direction and strength. A short tap on the water instead sets a target point the boat paddles toward.
- Space / Escape / P pause, as now.

## 5. Content of the river

- **Docks:** six, alternating **far bank, near bank, far, near, far, near**, spaced along the river in `index.html` card order. Near-bank docks reach into the water toward the viewer and are drawn in front of the water. Mooring rule unchanged (in the zone, speed < 1.2 m/s for 0.4 s; rope = soft planck distance joint to the post; `onDock(cardId)`; closing the card or paddling away releases).
- **Lanterns:** 10, hanging from ropes strung across the river between poles and from branches over the banks, at different z. The boat lights one by passing within 0.8 m of it (in the x–z plane). Each lantern is a small 2D pendulum (custom spring, not planck) that swings when touched. Lit lanterns glow and keep swinging.
- **Lit lanterns scare crocodiles:** each lit lantern makes a safe circle of 3.5 m radius that crocodiles steer out of. Docks are safe too. So lighting lanterns builds safe paths.
- **Floating objects:** 3 logs and 3 hyacinth rafts, pushed around by the boat, the crocodiles and the waves.

## 6. Crocodiles

- **Two** crocodiles. The second wakes up after the first dock visit.
- States:
  - `lurk`: drifts slowly, submerged to eye level, random wander.
  - `stalk`: the boat within 12 m → pursue with lead (aim where the boat will be), max 3.4 m/s (slower than the boat's top speed, faster than a lazy paddle), rising a little.
  - `lunge`: within 2.5 m → a 0.5 s burst at 7 m/s, fully surfaced, a big splash.
  - `retreat`: after a bite or a miss, swim away and sink for 5 s, no bites.
- Steering forces on their planck bodies (seek, avoid lantern light and docks, avoid banks), so they bump logs and each other physically.
- **A bite:** a strong knockback impulse and spin on the boat, a big disturbance in the water, camera shake (not under reduced motion), score −150, and **15 s off the night** (the moon jumps ahead). A short red flash on the HUD timer.
- Never bite while the boat is moored or a card is open. Never spawn within 15 m of the boat.
- Audio: a low splash and a growl-like noise burst on lunge (the existing synth; sound stays off by default).

## 7. Game rules

- The night lasts **150 s** (moon timer). Scoring: lantern 100, first dock visit 500, bite −150, all docks + all lanterns = 2000 "clear night" bonus and an early, happy end; time bonus 10 per remaining second on a clear.
- HUD gains nothing new except the bite flash; lanterns `x / 10`, docks `x / 6`.

## 8. Rendering details

- **Water surface:** a Pixi mesh over the visible part of the river (e.g. 0.5 m grid), each vertex projected with the camera helper, its height from the field. Shade per vertex (or in a shader) from the surface slope: moonlight specular glints and darker troughs, so **ripples and wakes are clearly visible from this angle**. Deep blue-black far away, a little lighter near the camera.
- Reflections: a stretched, wobbling glow streak under the moon and under each lit lantern, distorted by the local slope.
- Fireflies, glow and the start "lights on" sequence as now.
- Performance: no per-frame allocation in the hot loops; target 60 fps on a mid phone; report the wasm step time and the frame time.

## 9. Art

Already in `public/night/`: `sky`, `moon`, `mid`, `lantern-off`, `lantern-on`, `boat`, `dock`, `log`, `hyacinth`. Still missing: `far`, `front`, and new `croc.webp` (crocodile, side view, facing right, swimming). Placeholders for the missing ones. Re-tune `SPRITES` in `config.ts` for the real images (they are cropped tight to the object): boat width 5 m with its anchor at the waterline (the hull bottom is the image bottom; draught ~0.35 m), dock width ~6 m, log 3 m, hyacinth 2 m, croc 4 m. Check each against the physics shape in `?debug`.

## 10. Tests

Replace `tests/river.test.ts` for the new sim (headless, the wasm water loaded from bytes):
1. Rust/TS water parity (above), and the cargo tests pass.
2. Boat at rest settles (heave and pitch) within 3 s and stays afloat 60 s.
3. 30 seeds × 60 s of random input: no NaN, never leaves the river, never capsizes (|pitch| < 30°).
4. Holding one direction: ≥ 25 m in 8 s, top speed ≤ 6 m/s; it can reach the far bank from the near bank in ≤ 5 s.
5. Mooring at a far-bank and a near-bank dock; a fast pass does not moor.
6. Lantern lights once when passed within 0.8 m; scores 100.
7. Crocodile: a stationary boat in open water gets bitten within 20 s; a boat moored or inside a lit lantern's circle is never bitten in 30 s; a bite costs 15 s and 150 points.
8. Bot: steer to the next unvisited dock, detour through lanterns on the way, flee a lunging crocodile. Visits all six docks within 150 s in ≥ 24 of 30 seeds. Report the number and average bites.
9. Determinism with a seed + input script.
10. `tests/i18n.test.ts` stays green.

## 11. Verification

- `npm run build` zero TS errors, `npm test` and `cargo test` all green.
- The built-in browser pane has **no WebGL**. Verify visuals with headless Chrome over CDP (software WebGL; the helper script from Phase 4 is in the scratchpad if useful, or write your own), and logic with JS checks. Dev server: `npx vite --port 5174 --strictPort` in the background; stop it when done.
- Screenshots: idle at 1440×900, playing with the boat mid-river and a visible wake, a crocodile stalking, moored at a near-bank dock with the card open, 390×844 with the touch stick.
- Report: files added/changed, wasm size, wasm vs TS step time, physics constants, bot result, screenshots' observations, anything skipped.
