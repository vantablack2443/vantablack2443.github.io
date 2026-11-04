# Phase 4: "Lantern River", the night game

Replaces the pinball table as the dark theme. Read with `LIGHT-MODE.md` and `PHASE3.md`; where they disagree, this file wins. Light mode keeps working exactly as now. The design system for all DOM UI is still `.claude/skills/landing-page-design/SKILL.md` (Part B, copy rules A5).

Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. **Do not commit or push.**

---

## 1. Concept

Light mode is the Kerala backwaters by day. The game is the same river at night. A small wooden country boat with an arched woven canopy floats on simulated water, seen from the side like a painting. The visitor paddles left and right along the river. Six docks on the far bank are the six projects; mooring at one opens that project. Lanterns hang from ropes over the water; brushing one with the canopy lights it. The moon crosses the sky as the timer.

The point is to show real engineering: a physics engine (planck, Box2D), a hand-written wave simulation coupled two ways with it, and a WebGL renderer (PixiJS). Keep the simulation headless and tested, as the pinball was.

---

## 2. Tech and structure

- Add `pixi.js` v8 (latest 8.x, exact version pinned in package.json). planck 1.4.3 stays.
- New folder `src/river/`:
  - `config.ts`: **single source of truth** for every number: world size, docks, lanterns, hull shape, physics constants, parallax factors, asset names and sprite offsets. Nothing else hard-codes geometry.
  - `water.ts`: the wave simulation. Pure TypeScript on `Float32Array`s, no planck, no Pixi. Small API (`step(dt)`, `heightAt(x)`, `velocityAt(x)`, `disturb(x, impulse)`), so it can later be replaced by a Rust/WebAssembly build with the same interface. Keep a comment saying so.
  - `sim.ts`: the headless game world: planck world, boat, buoyancy coupling, lanterns, docks, mooring, floating objects, scoring, timer, state machine, event queue. No DOM, no Pixi. Deterministic for a given seed and input sequence.
  - `render.ts`: PixiJS scene that reads the sim state each frame.
  - `input.ts`: keyboard and touch into a small input state.
  - `audio.ts`: tiny Web Audio synth (paddle splash, lantern chime, dock bell), **off by default**, with a toggle. Reuse ideas from `src/game/audio.ts`.
  - `assets.ts`: loads the art in `public/night/` if present, otherwise draws placeholders (see §6).
  - `index.ts`: `createRiver({ host, onDock, … })` returning `{ start(), endGame(), setPaused(reason, on), resize(), dispose() }`, same shape of contract `main.ts` uses for the pinball game today.
- Fixed physics step 1/120 s with an accumulator (max 5 steps per frame); render interpolates. Contact events are queued during the step and applied after it, like the pinball.
- Coordinates: planck in metres, y up. Pixi in pixels, y down. One conversion helper, in one place.
- Lazy loading as today: the river chunk (Pixi + planck) is imported only when the dark theme is entered. Light-mode visitors never download it.

---

## 3. The simulation

### World
- River length 320 m, boat ~5 m long. Hard banks at both ends (the boat bounces softly off a reed bed).
- Visible height about 16 m of world, derived from the viewport height; the camera follows the boat horizontally with smoothing and a small look-ahead in the travel direction, clamped to the river ends.

### Water (`water.ts`)
- Spring columns every 0.25 m along the whole river (≈1280 columns; it's cheap). Each column: height offset and velocity. Per step: `v += (-k·h − d·v)·dt`, then 2–4 spreading passes to neighbours. Tune `k`, `d` and spread so ripples travel visibly, cross each other, and die away in a few seconds.
- Must be stable: total energy decays to near zero with no input. A test checks this.
- A very slow, low ambient swell (sum of two sines) is added on top so the water is never dead flat.

### Boat
- A planck dynamic body: hull polygon (flat-bottomed, raised bow and stern) plus a canopy fixture on top. Centre of mass set low (custom mass data) so it is stable and self-righting.
- **Buoyancy:** 10 sample points along the hull bottom. For each, submerged depth = water surface at that x − point y. If > 0, apply an upward force `ρ·g·depth·w` at that point, plus linear drag on the point's velocity (stronger vertical than horizontal). Tune so the boat floats with about a third of the hull submerged and settles within ~3 s.
- **Two-way coupling:** a submerged point moving vertically disturbs the nearest columns, so the boat makes a wake and bobbing ripples.
- **Paddling:** → is a forward stroke, ← a back stroke (also D/A). Holding a key repeats strokes on a cadence (~0.45 s). Each stroke: a horizontal impulse at the hull's waterline, a small pitch, and a splash (`disturb`) at the paddle position. Max speed ~4 m/s through drag, not a hard clamp.
- Touch: hold the left half of the screen for back strokes, the right half for forward strokes.

### Lanterns
- 14 lanterns across the river. Each hangs from an overhead branch or rope by a chain of 3 small links joined with revolute joints, so it swings like a pendulum, then a lantern body. Heights vary so the canopy brushes most of them; a few hang high and need the boat lifted on a swell or wake.
- Contact with the canopy lights the lantern (once): score, a chime, the glow turns on. Lit lanterns keep swinging and glowing.

### Docks (the projects)
- Six docks along the far bank, roughly evenly spaced, in the project order of `index.html` (`card-orion`, `card-saardew`, `card-2048`, `card-pagerank`, `card-edge`, `card-mips`). Each has a sensor zone over the water beside it.
- **Mooring:** if the boat is in the zone and its speed is below 1.2 m/s for 0.4 s, a rope (a soft distance joint with frequency/damping) ties it to the dock post and `onDock(cardId)` fires. A paddle stroke away from the dock, or closing the card, releases the rope. Arriving fast gives a bump, not a mooring.
- First visit to a dock scores and marks it visited (lamp on the dock sign).

### Floating objects
- 4 logs and 3 water hyacinth rafts as dynamic bodies that float with the same buoyancy code (fewer sample points). The boat pushes them; hitting one fast rocks the boat.

### Game states
`idle` (boat bobbing in the dark, no timer, lanterns unlit, "Start" shown) → `playing` (the moon rises and crosses the sky over **3 minutes**) → `over` (summary). Pause on Space/Escape, when the tab is hidden, and while a dock card is open (the timer stops; the water keeps moving).

### Scoring
Lantern 100. First visit to a dock 500. All six docks + all lanterns: a 2000 "clear night" bonus and the game ends early with a celebration. Time bonus at the end: 10 per remaining second, only on a clear. High score in `localStorage` (try/catch).

---

## 4. Rendering (`render.ts`, PixiJS)

Layers back to front, with parallax factors from `config.ts`:
1. **Sky** (fixed): night gradient with stars; the moon sprite on an arc driven by the timer.
2. **Far bank** (0.15), **mid palms and houses** (0.4): tiling across the world.
3. **Docks, ropes, lanterns** (1.0): sprites positioned from the sim.
4. **Boat and floating objects** (1.0).
5. **Water** (1.0): drawn every frame from the column heights as a filled polygon with a vertical gradient (deep blue-black to lighter at the surface), a thin moonlit highlight line along the surface, and **reflections**: lit lanterns, the moon and the boat reflected below the surface, vertically flipped, faded and wobbled with a displacement filter.
6. **Foreground** (1.3): reeds, grass, hibiscus silhouettes along the bottom.
7. **Glow**: additive-blend radial sprites for lit lanterns, dock lamps and fireflies (a few dozen, drifting; off under reduced motion).

- Before Start, everything is dark and unlit except a faint moonlight, like the pinball's "lights off". Start turns the lights on with a short sequence.
- DPR cap 2; resize to the viewport; pause rendering when the tab is hidden. Target 60 fps on a mid phone: no per-frame allocation in the hot loop.
- Reduced motion: no camera shake, no fireflies, gentler start sequence; the game stays playable.

---

## 5. The dark theme page

The page is the game. Remove the clutter.

- Full viewport canvas. Over it, DOM only:
  - **Top bar:** "Dipu B." left; the existing `#top-controls` cluster right (`[EN | DE]` + "Back to site"). Keep it exactly as Phase 3 made it.
  - **HUD**, small and in a corner (top left under the name on desktop, a thin strip on mobile): score, lanterns `7 / 14`, docks `2 / 6`, and the moon timer as a thin progress line. Geist Mono digits.
  - **Start overlay:** title "Lantern River", one line "Paddle with ← →, moor at a dock to open a project.", the Start button, a sound toggle. Touch devices get the touch wording.
  - **Dock card:** a dialog (reuse `src/modal.ts`) showing the project: its title, stack line, bullets and the GitHub link, **taken from the existing `.card` DOM in `index.html`** (no duplicated text; translated via the i18n system as now). Closing it releases the mooring.
  - **Summary** at the end: score, docks and lanterns found, high score, "Play again" and "Back to site".
- **Remove the pinball:** `src/game/`, `layout.ts`, `stage.ts`, `svg-rails.ts`, `lights.ts`, `spotlight.ts`, `tests/sim.test.ts`, and the table-only DOM (stage, cabinet, apron, backglass panel, HUD panel, spotlight, controls legend, reader mode and its buttons, small-screen banner) plus `arcade.css` rules that only served them. The CV content in `#content` stays (light mode uses it) but is hidden in dark except as the dock card source. `git` keeps the old code; no need to archive it.
- Keep `main.ts`'s structure: `enterDark()` boots the river, `enterLight()` disposes it (no listener survives; arrow keys and Space scroll in light mode).
- Copy updates: the light-mode button "Play the arcade" becomes **"Play the game"** (DE "Zum Spiel"); the footer becomes "© 2026 Dipu Balamurugan · Built with Vite, PixiJS and a lot of physics"; the meta descriptions say "a playable night river game" instead of a pinball. Update `de.ts` (all new strings in both languages; the i18n test must pass). Game texts that were left English in Phase 3 are now translated too.

---

## 6. Art: placeholders now, Gemini art later

The owner will generate painted art with Gemini later (prompts in `NIGHT-ART.md`). Build the whole game with **procedural placeholders** first, so it is complete and playable without any image files:
- Sky: gradient + random stars. Banks: layered dark silhouettes from noise. Boat, dock, lantern, log, hyacinth: simple vector shapes in a matching palette (deep indigo, teal-black, warm lantern amber `#FFB347`).

`assets.ts` checks `public/night/` for these files and uses each one that exists instead of its placeholder:

| file | content | alpha |
|---|---|---|
| `sky.webp` | night sky, no moon | no |
| `moon.webp` | moon | yes |
| `far.webp` | distant tree line, tiling | yes |
| `mid.webp` | palms and houses, tiling | yes |
| `front.webp` | reeds and grass, tiling | yes |
| `boat.webp` | boat, side view, facing right | yes |
| `lantern-off.webp`, `lantern-on.webp` | lantern | yes |
| `dock.webp` | wooden jetty with post and blank sign | yes |
| `log.webp`, `hyacinth.webp` | floating objects | yes |

Sprite placement (scale, anchor, offset relative to the physics body) lives in `config.ts`, so swapping in real art is a config change. Physics shapes never depend on image sizes.

---

## 7. Tests (`tests/river.test.ts`, headless `sim.ts` + `water.ts`)

1. Water with no input: energy after 20 s < 1% of an initial disturbance; no NaN.
2. Boat at rest settles within 3 s: |angle| < 2°, vertical speed < 0.05 m/s, and stays afloat for 60 s.
3. 30 seeds × 60 s of random strokes: the boat never capsizes (|angle| < 35°), never leaves the river, never sinks.
4. Holding forward for 10 s from rest: travels ≥ 20 m; top speed ≤ 5 m/s.
5. Mooring: slow approach to each dock moors and fires the event; a fast pass (> 2.5 m/s) does not.
6. Lantern contact lights it exactly once and scores 100.
7. A simple bot (paddle toward the next unvisited dock, slow down when near) visits all six docks within the 3 minutes in at least 25 of 30 seeds. Report the number.
8. Determinism: the same seed and input script give identical state after 30 s.
9. The existing `tests/i18n.test.ts` stays green.

---

## 8. Verification before reporting

- `npm run build` zero TS errors; `npx vitest run` all green.
- Dev server: `npx vite --port 5174 --strictPort` in the project folder, started in the background; never the pane's saved "portfolio" preview. Stop it before finishing and reset the viewport to the desktop preset.
- Browser pane (if the pane is hidden its rAF stalls; use `show_pane` or rely on JS state checks):
  1. Light mode loads with no river chunk downloaded (check network).
  2. "Play the game" enters the river: idle scene, Start overlay, top-right cluster visible.
  3. Start, paddle right to the first dock, moor: the card opens with the right project in EN and DE; close it and paddle on.
  4. Light a lantern; the HUD counts it.
  5. 390×844 touch layout: HUD, overlay and cluster fit; no horizontal overflow.
  6. "Back to site" returns to light; arrow keys scroll; no river listeners remain.
  7. FPS: report a measured frame time on desktop and with 4× CPU throttling if available.
- Report: files added/removed, bundle sizes (light chunk and river chunk), physics constants chosen, bot result, screenshots' observations, and anything skipped.
