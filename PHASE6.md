# Phase 6: make Lantern River look like it floats

Fixes the issues in `GAME-ISSUES.md` (items 1–4 and 6–9; item 5, the repeated cloud, is already fixed in `public/night/mid.webp`). The crocodile lunge in that file is **not** part of this phase. Read `PHASE5.md` for how the game works; the code is in `portfolio/src/river/`. Where they disagree, this file wins.

Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. **Do not commit or push.** Keep the "Game still in development" pill (`#river-wip`).

The owner's words: *"water feels too high, boat and crocs seem a bit too submerged, especially the croc. Boat becomes too small when it moves. Nothing looks like it's floating on the water. The edges look cut out: the water doesn't merge with the dock, the side and the background. At some points a random lantern seems to float, not attached to anything."*

---

## 1. Sit on the water, not in it
- Boat: about 75–80% of the hull height above the water line at rest (draught ≈ 0.18 m for the art); adjust `BOAT` and the sprite anchor so physics and art agree. Heave and pitch still bob it.
- Crocodile water line (fraction of image height from the top): surfaced/stalk **0.40**, lurk **0.26** (eyes, head and the full back ridge show). The current values hide too much.
- Logs and hyacinth: about half above the water.

## 2. Soft water line instead of a hard cut
- Replace the hard clip at the water surface with a **feathered** one: a vertical alpha ramp of ~8 px (scaled by depth) across the water line.
- Below the line, keep a faint **submerged part**: the same sprite, tinted to the water colour, at ~18% alpha, with a gentle horizontal wobble. It should look under water, not cut off.
- A **contact ring** where every floating object meets the water: a soft lighter ellipse and a thin foam line along the hull, brighter when the object moves, plus the existing wake.

## 3. Reflections
- Mirror the boat, the docks, the crocodiles (when surfaced), the lanterns and the bank layers in the water: vertically flipped below their water line, ~25–35% alpha, darkened and tinted blue, faded out with distance from the line, and wobbled by the local water slope (reuse the displacement approach or offset rows by `slopeAt`).
- The far bank's reflection is a strip just below the far edge of the water. That strip is what makes the bank sit in the water.

## 4. Edges of the water
- **Far edge:** no straight hard line where the water meets the mid layer. Blend it with a soft band: a little mist or shore glow, the bank's reflection, and short reed tufts or stones scattered along the edge (procedural is fine).
- **Near edge:** remove the dark solid strip under the foreground plants (`front`). The plants overlap the bottom of the water directly, and the water darkens softly toward the bottom edge.
- **Dock stilts** fade into the water over ~0.3 m, with a small ripple ring around each stilt.

## 5. Lanterns are always hung from something
- Every lantern hangs from a drawn rope or branch that is **visibly attached** at both ends: ropes span the river between two poles (one on each bank, both drawn, standing on the banks), with a sag (catenary or parabola); branch lanterns hang from a visible branch that reaches out from a tree on the bank.
- No lantern hangs beyond the end of its rope or branch, and none floats over open water without a line above it. Write a test: for each lantern, its anchor point lies on a drawn rope or branch segment.
- Remove the stray dark diagonal line (item 8). Branch limbs must look like branches (tapered, bark coloured), not a thin black stroke.

## 6. Perspective
- Far objects at about **0.65×** the size of near ones (now 0.45×). Re-tune `zCam`, `camH` and `f`, so the boat no longer shrinks so much toward the far bank and the near half of the river takes less of the screen.
- The whole river width still fits the viewport on desktop and on a 390×844 phone.

## 7. Small fixes
- The pale hard-edged polygon in the water (the moon reflection, item 7): make it a soft, wobbling streak with no hard edges, or remove it.
- The near half of the river (item 9): after the perspective change, add a little life: a few lily pads, reed clumps standing in the shallows near the banks, and drifting fireflies low over the water. Keep it calm; it's a night scene.

## 8. Tests and checks
- All existing tests (`npm test`, `cargo test`) stay green. Update tests only where a constant from this spec changes them (draught, camera), and say which.
- Add the lantern anchor test from §5.
- `npm run build` has zero TS errors.

## 9. Verification
- The built-in browser pane has no WebGL. Use headless Chrome over CDP (software WebGL) for screenshots. The old helper script in the scratchpad is gone; write your own (spawn `google-chrome --headless=new --remote-debugging-port=… --use-angle=swiftshader --enable-unsafe-swiftshader`, drive it with `node --experimental-websocket`). Keep scripts and screenshots in `/tmp/claude-1000/-home-dipu-Documents-Portfolio-Web/95cfc852-ca61-46ba-8173-5d148f3eba94/scratchpad/`.
- Dev server: `npx vite --port 5174 --strictPort` in the background; stop it when done (find it by port, not with `pkill -f`, which can kill your own shell).
- Screenshots at 1440×900, **before** (once, at the start) and **after**: boat at rest mid-river; boat at the far bank; moored at a far and a near dock; a crocodile lurking and one surfaced; a lantern on a rope with its poles; the near edge; 390×844 phone.
- Report: what changed, the new constants, screenshot paths with one-line before/after observations, test status, and anything skipped.
