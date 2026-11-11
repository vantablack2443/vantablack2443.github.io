# Buddy v3: fix plan

Status: **plan only. Nothing here is implemented yet.** The owner starts the work.

Builds on `BUDDY.md` and `BUDDY2.md` (read both). Code today: `portfolio/src/light/buddy-sim.ts` (pure sim, 1033 lines), `portfolio/src/light/buddy.ts` (DOM, canvas, pointer), `portfolio/scripts/buddy_sheet.py` (sheet builder), `portfolio/tests/buddy.test.ts`, sheets in `portfolio/public/buddy/`. Where this file disagrees with the older specs, this file wins.

Rules for every work package: do not commit or push; no new npm or Python dependencies (Pillow only, no numpy); dark mode and `src/river/` untouched; every link and button on the light page stays clickable; EN/DE through the i18n system; match the existing code style.

---

## 0. What the owner reported, and the cause found in the code

| # | Report | Cause (file:line today) |
|---|---|---|
| 1 | "It should jump from one panel to the other." He walks to a panel's end and stops at the gap. | Following the cursor only sets `aim = ptr.x` on the **current** platform (`buddy-sim.ts:773-779`); the route planner is never used for the cursor. Jumps exist only with one launch speed (`JUMP_V = 520`, a 96 px apex), which needs 96 px of headroom and looks wrong over a 24 px gap (`:930`). |
| 2 | "The character is cropped too much." Arms and fists are cut off flat. | The old `walk.webp` and `fight-walk.webp` strips are each **one connected blob** (the figures touch), so `split()` cuts them along a seam (`buddy_sheet.py: seam()`), slicing arms; `drop_strays()` then removes what the seam left. Measured: `walk` = 1 component, `fight-walk` = 1; the new `walk4` and `run` = 4 clean components each. |
| 3 | "He doesn't follow the cursor when it is above him; he should jump and climb to reach it." | Same as 1: `watchPointer` only reacts when the cursor is within a band of his own level (`:773`), and never calls `goTo`. Going to the cursor's panel is only one random option in `choose()` (weight 7 of ~90, `:830`). |
| 4 | "There should be a sway when I drag him." | Held, he is only translated: the hands follow the pointer on a spring (`updateGrab`, `:506`), the body never rotates. |
| 5 | "He should run faster if the cursor is far." | Only `WALK = 62` and `GUARD = 46` exist; there are no run frames. |
| 6 | "He should jump up and grab the panel above before climbing." | A climb starts from standing at the wall's foot and goes up from his feet, even through air: `gripped()` allows 140 px with no panel beside him (`CLIMB_GAP`, `:56`, `:973`). |
| 7 | New walk and run frames supplied. | `art/buddy/v2/walk4.webp` (4 frames), `art/buddy/v2/run.webp` (4 frames). |

### Other issues found while reading the code
8. **Idle head dip:** `idle` mixes the fighting stance (drawn at a hand-tuned scale, 72 px) with fight-walk frames (80 px).
9. **Land frames look reversed:** `land` is `jump[4], jump[5]` (standing, then crouch). The strip is crouch, launch, apex, tucked, legs-down, deep crouch; a landing should end in the crouch and then stand.
10. **Stale pointer after scrolling:** page coordinates are only updated on `pointermove` (`buddy.ts:573`); after a wheel scroll the stored cursor (and the drag target) is wrong until the mouse moves.
11. **Route choice:** `replan()` is breadth-first (fewest edges), not quickest; one edge is kept per target (`seen`), the first found.
12. **Teleport on release:** let go with the hands inside a card, he appears on its top instantly (`unstick(true)`, `:444`).
13. **Breathing bob lifts his feet:** the whole sprite moves up 1 px (`buddy.ts: bob`), so he floats off the panel for half of each breath.
14. **Standing half off an edge:** `lo/hi` are inset only 4 px (`:898`), so half his body hangs over a gap.
15. **Stale sprite sheet risk:** `public/buddy/sheet.png` and `.json` have no content hash, so after a deploy a cached PNG can be drawn with a new JSON (frames in the wrong places).
16. **Carrying him across the page:** the page does not scroll while he is held, so he can only be dropped inside the current screen.
17. **Tight headroom:** the collision height equals the sprite height (80). Real gaps on the page are 76 px (row-2 cards) and 70 px, so those tops are unusable by 4 px.
18. **Long falls:** from the top of the page the only way down is to walk off into the margin and fall to the page bottom (over 2000 px).

---

## 1. The level, measured (1440 px wide)

Panels as `[x, top, width, height]`; left edge of the column x = 153, right edge x ≈ 1273; page bottom ("floor") y = 3212.

| Panel | Rect | Clear space above | Can stand? |
|---|---|---|---|
| Tagline panel | 153, 900, 1120, 286 | open | yes, the summit |
| "Projects" chip | 153, 1282, 152, 54 | 96 | yes |
| Row-1 cards | y 1360: x 153 (h 258), 534 (h 206), 915 (h 206); w 357 | 174 (24 under the chip) | yes |
| Row-2 cards | y 1642: x 153, 534 (h 206), 915 (h 222) | 24, 76, 76 | no; 534 and 915 only with a 72 px body |
| "More" chip | 153, 1888, 142, 34 | 40 | no |
| List rows | y 1934, h 66: x 153 (w 554), 719 (w 554) | 12 to 86 | partly, but enclosed |
| Education, Experience | y 2096, h 270: x 153 (w 548), 725 (w 548) | 96 | yes |
| Skills, Languages | y 2462, h 222: x 153 (w 643), 820 (w 453) | 96 | yes |
| Contact | 153, 2780, 1120, 236 | 96 | yes |
| Footer | 153, 3112, 1120, 76 | 96 | yes |

What this means for movement:
- Panels in a row are **24 px apart**: narrower than his body (28), so he cannot fall or climb between them. He crosses with a **small hop**.
- Rows are stacked flush in one column, **96 px apart**. The only way up or down is on the **outer sides of the column, in the page margins** (153 px wide on the left, 167 px on the right). Both margins form a "ladder" of aligned panel sides with gaps of 24 to 96 px between them.
- Left ladder, bottom to top: footer, contact, skills, education, list row, "More" chip, row-2 card, row-1 card, "Projects" chip, tagline. Right ladder: footer, contact, languages, experience, list row, row-2 card, row-1 card, tagline.
- At 390 px the page is one column with 16 px margins. Capture the real rects there (WP4) and add them as a second fixture.

---

## 2. Design

### 2.1 Art and sprite sheet
- **Sources** (all in `art/buddy/v2/`): `walk4.webp` (4), `run.webp` (4), `jump.webp` (6), `hang.webp` (6), `climb.webp` (6), `stance.webp` (1). **Stop using** `walk.webp` and `fight-walk.webp` (leave the files; they are the cropped ones).
- **No seam cutting, ever.** Delete `seam()`, `drop_strays()`, `clean_guard()` and the merged-blob branch of `split()`. Every strip must split into exactly its expected number of connected components (islands under `ISLAND` px still join the nearest frame). If not, the script **fails** with: `"<strip>: figures touch; regenerate with a clear magenta gap between them"`.
- **Crop guard:** after splitting, assert that no frame has a straight vertical run of more than 12 opaque pixels in its first or last column (full resolution). That is the signature of a cut-off limb.
- **Animations** (manifest names; `ms` per frame; `stride` = px travelled per full cycle at 80 px):

| name | frames | notes |
|---|---|---|
| `idle` | `jump[4]` (the upright, arms-down figure) | 1 frame. If it reads as "falling" in the browser, use `walk4[1]` instead; decide by eye and say which. |
| `ready` | `stance[0]` | 1 frame: fists up. Scale by the **pure head rule** (same head width as every other strip, no averaging hack): he is lower in his stance, which is right. Check the head does not change size against `idle`; if it does, correct the head measurement, not the scale. |
| `walk` | `walk4[0..3]` | loop; stride ≈ 2 × the widest foot spread in the frames (measure it, about 50 px) |
| `run` | `run[0..3]` | loop; stride measured the same way (about 110 px) |
| `jump` | `jump[0]`, `jump[1]`, `jump[2]` | crouch (anticipation), launch (rising), arms-up (near the apex) |
| `fall` | `jump[3]`, `jump[4]` | tucked while `vy < 250`, legs down when falling faster |
| `land` | `jump[5]` | the deep crouch, 140 ms, then `idle` |
| `hang` | `hang[0..5]` | hand anchor = top centre of the joined hands |
| `climb` | `climb[0..5]` | grip anchor = the higher hand; frame 0 is also the "catch" pose |

- `guard`, the old `walk` and the fight-walk idle frames are **removed** from the manifest, the code and the tests.
- **Head-size normalisation** stays (median head width per strip), referenced to `walk4`: standing height 80 px (and 64 px for the small sheet, built from the originals). Keep the `CLIMB_CAP` rule for the back view. One shared palette, alpha 0 or 255, deterministic output.
- **Metrics in the manifest:** `body = [hw, bh]` with `bh = round(0.9 × height)` (72 and 58): the collision body is a little shorter than the sprite, so 76 px gaps are usable; his hair may tuck up to 8 px over a panel above in tight spots. `hw` from the `idle` frame's half width. Also `crouch` (height of `land`), `climbHalf`, `grip`, `hang` as now.
- **Manifest `version: 3`**, and each animation's `stride` in px per full cycle. The sim's `phase` becomes **cycles** (0..1 per stride), so the frame is `floor(phase × n) % n` for any frame count (replaces the "six per stride" convention at `buddy.ts:425`).
- **Cache-safe loading:** move the built sheets to `src/light/buddy-art/` (`sheet.png`, `sheet.json`, `sheet-sm.png`, `sheet-sm.json`) and load them with Vite imports (`import url from './buddy-art/sheet.png'`, JSON via dynamic `import()`), so both get content-hashed names and stay lazy with the light chunk. Delete `public/buddy/`.

### 2.2 Movement basics
- Constants: `WALK = 70`, `RUN = 200`, `CLIMB = 64`, `CLIMB_DOWN = 110` px/s; `GRAVITY = 1400`, `TERMINAL = 1100` unchanged.
- **Run or walk:** run when the remaining distance along the route on this platform is over 220 px; drop back to a walk under 140 px (hysteresis). Applies to following the cursor and to roaming trips over 500 px.
- **Acceleration:** ground speed ramps at 900 px/s² up and 1400 px/s² down instead of switching instantly; stopping from a run leaves one dust puff (a skid).
- **Standing room:** a platform's span is inset **8 px** from each end (was 4), so both feet are on the panel. Headroom checks use `bh` from the manifest.

### 2.3 Jumps
- Launch options tried by the planner: `vy ∈ {300, 400, 520, 620}` px/s (apex 32, 57, 97, 137 px) × `vx ∈ {0, ±60, ±110, ±160, ±200}`.
- For every pair of platforms keep the **cheapest** landing found: lowest `vy` first, then lowest `|vx|`, landing at least 8 px inside the target's span. So a 24 px gap is crossed with the 32 px hop, not a full jump.
- `|vx| > 130` is a **running jump**: needs 50 px of run-up on the source platform in that direction.
- Launch spots: both ends of the platform, plus the points under each higher panel's two side lines (so he can jump from below a ledge), all checked with `fits()`.
- Every jump is validated by simulating it with the real collision code (`flight()`), as now, so low ceilings and walls are respected.
- Animation: `jump[0]` during the 0.12 s crouch, `jump[1]` while rising, `jump[2]` when `|vy| < 120`, then `fall`, then `land`.

### 2.4 Jump, catch, climb (replaces climbing through air)
His hands must hold a real panel side at all times while climbing.

- **Climb line** for a wall at `x = wall` (`dir = +1` when the panel is on his right): `xc = wall − dir × (climbHalf − OVERLAP)`, with `OVERLAP = 5`. If `xc` would leave the page (phone margins are 16 px), clamp it to `[climbHalf, width − climbHalf]`: on small screens he overlaps the panel edge more.
- **Catch:** in the air he catches a wall when all hold: `|x − xc| ≤ 8` (or he is pressed against that wall by the collision code); his hands (`y − grip`) are within a side of that wall line, at least 10 px above the side's bottom; `−260 ≤ vy ≤ 300`; and the body at `xc` overlaps no other panel. Then: 0.14 s `catch` (climb frame 0, body sags 3 px and settles), then he climbs.
- **Grab edge** (new edge kind `grab`): the planner finds these by running the same jump simulations and testing the catch condition at every step. From the footer's left end, for example: a small jump up and outward (`vx −60`, `vy −400`), he drifts 20 px out past the column's edge and catches the contact card's side 96 px above. He never starts a climb from the ground: even with a wall right beside him it is a hop and a catch.
- **Ledge grab:** if the catch puts his hands within 4 px of the panel's top edge, skip the climb and go straight to the pull-up.
- **Holds along a wall:** panel sides whose x is within 6 px of the wall line form a chain. Between two holds with a vertical gap `g`: `g ≤ 40` he reaches across (keeps climbing); `40 < g ≤ 120` he does a **wall hop** (a short jump straight up along the wall, `vy = −sqrt(2·GRAVITY·(g + 12))`, jump frame, then a catch); `g > 120` the chain ends. Remove `CLIMB_GAP` and the air climbing.
- **Where a climb ends:** the top of any hold whose pull-up spot (`wall + dir × (hw + 10)`, clamped to the span) is standable is a destination; tops that are not standable (row-2 cards, the "More" chip) are passed.
- **Pull-up:** 0.5 s as now (rise along the wall, then step onto the top), climb frame, then `land`, then `idle`.
- **Climbing down** (new edge kind `descend`, the reverse of each grab chain): at the top's end he turns, lowers himself over the edge (pull-up played backwards, 0.4 s), climbs down at `CLIMB_DOWN` with the climb frames in reverse, wall-hops become short controlled drops with a catch, and at the lowest hold he lets go with an inward push (`vx` 60, 110 or 160, the first that lands inside the lower platform's span when simulated).
- **Drops:** walking off an edge still exists, but a drop of more than 400 px is never part of a planned route.

### 2.5 Route planning
- Graph: nodes are standable platforms (plus the floor); edges are `jump`, `drop`, `grab` (with its chain), `descend`. Keep up to two edges per (from, to), the cheapest of each kind.
- **Cost = seconds:** walk or run to the launch spot + flight time, or climb length ÷ speed + 0.6 s per catch and pull-up. Replace the breadth-first search with Dijkstra (the graph has about 20 nodes).
- Build once per `setWorld` (as now). Measure it: if `buildEdges` takes over 30 ms on the 1440 fixture, cut the candidate list (skip targets further than 700 px away) before anything else.
- Suggested split: move spans, edges and the search into a new pure file `src/light/buddy-plan.ts`; `buddy-sim.ts` keeps the state machine and physics.

### 2.6 Following the cursor
Mouse only (touch has no hover).
- **Attention:** he follows while the pointer has moved in the last 2.5 s, the pointer is inside the viewport, and he is within the viewport ± 200 px. After 2.5 s without movement he stays where he is; after 4 more seconds he goes back to roaming.
- **Target platform** `targetFor(px, py)`: (1) if the cursor is inside a reachable, standable panel's rect, that panel (he stands on top of the card the cursor is on); (2) otherwise, among reachable platforms, the one whose standing point `(clamp(px, lo, hi), top)` puts his chest (`top − bh/2`) closest to the cursor.
- **Go there:** same platform: walk or run to `clamp(px)`; stop within 36 px (dead zone), face the cursor, show `ready` while the cursor is within 90 px. Different platform: `goTo(target, px)` through the planner, so he hops gaps, catches, climbs and comes down as needed.
- **No thrashing:** retarget at most every 0.35 s and only if the target platform changed for 0.25 s or the cursor moved over 60 px; never interrupt a crouch, a flight, a catch, a climb or a pull-up (apply the new target at the next moment he stands).
- **Out of reach:** go to the reachable point closest to the cursor, face it, and at most once every 3 s do a small hop towards it if it is straight above within 250 px.
- **Scrolling:** `buddy.ts` stores the pointer's client coordinates and recomputes the page coordinates on `scroll` (without refreshing the "moved" time). Same for the drag target while he is held.

### 2.7 Held: sway like a pendulum
- The hands track the pointer tightly (`SPRING = 45`, `DAMP = 0.9`).
- New state `sway` (radians, 0 = hanging straight down) with `swayV`, integrated at 120 Hz:
  `swayA = −ω²·sin(sway) − 2ζω·swayV − (ax·cos(sway) + ay·sin(sway)) / L`
  where `(ax, ay)` is the hands' acceleration (difference of the spring's hand velocity, low-passed over 50 ms), `L = 55 px`, `ω = 7 rad/s` (a period of about 0.9 s), `ζ = 0.15` (three to four visible swings after a stop). Clamp `|sway| ≤ 1.2`.
- **Draw:** rotate the sprite around the hand anchor by `sway`, in the canvas, with `imageSmoothingEnabled = false`; snap the drawn angle to 2° steps. The canvas must be big enough for the rotation: make it a square of side `2 × (hang + 20)` with the origin in the centre (for all animations; simpler than resizing it).
- The hang frames run faster with `|swayV|`.
- **Release:** the feet are at `hands + hang × (sin(sway), cos(sway))`; the throw velocity adds the swing (`swayV × L` along the tangent), still capped at `MAX_THROW`; a `tilt` (starting at `sway`) eases to 0 with a 0.12 s time constant and is drawn as a rotation around the body's centre while he falls.
- **Let go inside a card:** no teleport. If the hands are inside a standable panel, he does a 0.25 s arc (jump frames) from where he is to the nearest standing point on its top. Otherwise he is pushed out the shortest way and falls.
- **Carry across the page:** while he is held and the pointer is within 60 px of the top or bottom of the viewport, scroll the page (up to 900 px/s, faster nearer the edge), keeping him under the pointer.
- Reduced motion: sway uses `ζ = 1` (settles without swinging).

### 2.8 Small fixes
- **Breathing:** remove the whole-sprite bob. For half of each 1.4 s breath, draw the top 55% of the `idle` frame 1 px lower (the rows overlap by one); the feet stay planted.
- **Idle life** (roaming, no cursor): keep the calm pace (moving about a third of the time), but trips now use hops, catches and descents; occasional `ready` pose for a second; the click or tap hop stays.
- **Debug view:** `?buddy-debug` in the URL draws the standable spans, the climb lines, the edges, the current route and the catch points on an overlay canvas, and exposes `window.__buddy` (`sim`, `plan`, `teleport(plat, x)`, `goTo(plat, x)`). Needed for WP4 and useful later.

---

## 3. Interfaces fixed up front (so the packages can run in parallel)

**Sheet manifest v3** (`src/light/buddy-art/sheet.json`, and `-sm`):
```jsonc
{
  "version": 3,
  "size": [w, h], "cell": [s, s], "origin": [s/2, s/2],   // square cell, origin in the centre
  "palette": 48,
  "metrics": { "height": 80, "body": [hw, bh], "crouch": n, "climbHalf": n, "grip": n, "hang": n },
  "animations": {
    "<name>": { "loop": bool, "ms": [..], "anchor": "ground" | "hand", "stride": px?,   // stride: walk, run, climb
                "frames": [{ "x","y","w","h","ax","ay","gx"?,"gy"? }] }
  }
}
```
Names: `idle, ready, walk, run, jump, fall, land, hang, climb`. Frame counts: 1, 1, 4, 4, 3, 2, 1, 6, 6.

**Sim** (`buddy-sim.ts`), additions and changes:
```ts
export type Anim = 'idle' | 'ready' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'hang' | 'climb';
export interface Metrics { hw; bh; crouch; climbHalf; grip; hang; stride: { walk; run; climb } }
class BuddySim {
  phase: number;      // cycles: frame = floor(phase * n) % n
  sway: number;       // radians while held, else 0
  tilt: number;       // radians in the air after a release, eases to 0
  frame: number;      // for jump and fall: which frame of the clip the sim wants (0-based)
  pointer(x, y, moved: boolean): void;   // moved = false when only the page scrolled
  // unchanged: setWorld, setMetrics, place, goTo, walkTo, hop, grab, drag, release, update, platformAt, span, puffs
}
```

---

## 4. Work packages

Run **WP1 and WP2 in parallel** (different files), then WP3, then WP4. One Sonnet subagent per package.

### WP1: art and sheet
Files: `scripts/buddy_sheet.py`, `src/light/buddy-art/*` (new), `public/buddy/` (delete), new `tests/buddy-sheet.test.ts` (move the "sprite sheet manifests" tests out of `tests/buddy.test.ts` into it).
1. Rewrite the script per §2.1 and §3. Look at every source image first.
2. Assertions in the script: component count per strip, the crop guard, palette ≤ 48, alpha 0/255, same output on a second run.
3. Tests: names and frame counts; frames inside the sheet; anchors inside frames; `metrics.body[1] = round(0.9 × height)`; both sheets share the palette; no frame has more than 40% of its rows opaque in its first or last column (the crop detector, in JS).
4. Output a 4× nearest-neighbour picture of the sheet with the anchors marked, in the scratchpad `buddy3/`.
Done when: both sheets build twice identically, the tests pass, and no limb is cut in the 4× picture.

### WP2: sim and planner
Files: `src/light/buddy-sim.ts`, new `src/light/buddy-plan.ts`, `tests/buddy.test.ts`. Uses `DEFAULT_METRICS` (update to the v3 shape; WP3 feeds the real ones).
Implement §2.2 to §2.7 (the sim side) and §2.8's `ready`. Tests, all on the pure sim:
1. **Hop:** two panels at the same height 24 px apart: he crosses with an apex under 45 px and lands at least 8 px inside.
2. **Running jump:** a 150 px gap needs the run-up; without 50 px of room the edge does not exist.
3. **Catch and climb:** a ledge 96 px above, wall aligned with his platform's end (the footer and contact case): jump out, catch, climb, pull up, stands on top. In every climb-mode step his hands are inside a side of that wall line (± 2 px), or he is in a wall hop.
4. **Wall hop:** two aligned sides 70 px apart: one hop, then a catch.
5. **Ledge grab:** a top within reach: under 0.2 s in climb mode before the pull-up.
6. **Descend:** comes down the same wall; no free fall over 120 px.
7. **Cheapest route:** with a hop and a long climb both possible, the plan is the hop.
8. **Follow up:** pointer on a higher panel: within a time limit he stands on it within 40 px of the pointer's x.
9. **Follow far and near:** pointer 600 px away on his platform: his speed exceeds 150 px/s on the way and he ends inside the dead zone; pointer inside the dead zone: he does not move.
10. **Out of reach:** an unreachable target: he goes to the nearest point and changes direction at most twice in 5 s.
11. **Sway:** pointer accelerates right: `sway` goes negative (the body trails); pointer stops: `sway` oscillates with a period of 0.7 to 1.1 s and decays below 0.05 within 4 s; never NaN, never beyond 1.2.
12. **Release:** hands inside a standable card: he ends on its top and no single step moves him over 30 px (no teleport). Throw cap and no tunnelling through a 4 px panel stay.
13. **Real layout, 1440 fixture:** from the footer he reaches the contact card, skills, languages, education, experience, the "Projects" chip, the three row-1 cards and the tagline panel, and gets back to the footer, with no fall over 400 px.
14. **Roaming:** 10 minutes, seeded: never inside a panel, no fall over 600 px, moving 20 to 60% of the time, and at least one hop, one catch and climb and one descent happen.
15. Reduced motion test stays (still, hop on click, can be grabbed).
Done when: `npx vitest run tests/buddy.test.ts` passes and `buildEdges` on the 1440 fixture is under 30 ms (print it).

### WP3: DOM, drawing, pointer
Files: `src/light/buddy.ts`, the Buddy block of `src/styles/light.css`. Needs WP1's manifests and WP2's API.
1. Load the sheets from `src/light/buddy-art/` (hashed, lazy); manifest v3; `metrics()` passes `body`, `crouch`, strides.
2. Square canvas, rotation for `sway` and `tilt`, frame from `phase` (cycles) or `sim.frame`; the breathing draw; the shadow and puffs as now.
3. Pointer: client coordinates stored, page coordinates recomputed on scroll, `sim.pointer(x, y, moved)`; edge auto-scroll while held.
4. `?buddy-debug` overlay and `window.__buddy`.
5. The hit box still covers only his body and follows him; cursors `grab` and `grabbing`; long-press on touch unchanged.
Done when: `npm test` and `npm run build` pass (zero TS errors).

### WP4: check in a real browser, tune, report
1. Headless Chrome over CDP at 1440×900 (light mode is a 2D canvas, so it runs without WebGL; the built-in pane stalls animation when hidden). Drive the mouse with timed `Input.dispatchMouseEvent` moves (20 ms apart), not a single jump. Save screenshot strips (one frame every 100 ms) into the scratchpad `buddy3/` for each sequence.
2. Sequences to record: hop between two row-1 cards; cursor on the contact card while he is on the footer (jump out, catch, climb, pull up); cursor back on the footer (descend); cursor 800 px away on the same panel (run, then walk, then stop); drag in a circle and stop (sway decays); release over a card (arc to its top); release in the margin (falls to the page bottom, then finds his way back up); carry him from the footer to the projects with edge scrolling.
3. Capture the real panel rects at 390×844 from the page, add them as a second fixture in `tests/buddy.test.ts`, with a test that he reaches every standable panel there from the footer and comes back.
4. Check: no cut limbs in any frame; feet on the panel top; hair overlap in tight spots no more than 8 px; German labels; no horizontal overflow at 390; links and buttons under him clickable; reduced motion (still, no sway swings); Hide and Show still work.
5. Tune only constants (speeds, the sway's `ω`, `ζ`, `L`, dead zones) and report every change.
Report: files changed, sheet sizes and frame counts, constants, planner build time, test status, the screenshot strips with one line each, and anything not done.

---

## 5. Not in this round
- Punch, kick, sit and wave (the owner will send the art).
- A guard walk: needs a new fight-walk strip **with a clear gap between every figure**.
- A real pull-up strip and a turn-around frame would make the ledge moves read better; optional art.
- Sounds.
