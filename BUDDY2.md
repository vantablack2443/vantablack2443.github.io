# Buddy v2: real frames, solid panels, grab and drop

Reworks the light-mode buddy built from `BUDDY.md` (read it first; the code is `src/light/buddy.ts`, `src/light/buddy-sim.ts`, `scripts/buddy_sheet.py`, `tests/buddy.test.ts`). Where they disagree, this file wins. Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. **Do not commit or push.** Dark mode and `src/river/` stay untouched.

The owner's feedback: *"He can be a bit smaller. He shouldn't overlay the panels, they are physical platforms so he should be on them. While climbing too, just slightly overlay so it looks like he is grabbing on the panel. I want to grab him with the mouse so it looks like he is hanging on it, then drop him somewhere else. The current animation looks like you are stretching the character. He should have more life."*

---

## 1. New art (a new outfit: brown jacket, maroon shirt, jeans, boots)

The old hoodie sprite (`art/buddy/base.png`, `source.webp`) is replaced. New Gemini images in `art/buddy/v2/`, all on flat magenta, all facing right (except the climb, seen from behind):

| file | content | frames |
|---|---|---|
| `stance.webp` (1024²) | one fighting stance, fists up | 1 |
| `walk.webp` | side walk cycle | 6 |
| `fight-walk.webp` | fists-up shuffle (guard walk) | 6 |
| `jump.webp` | crouch → launch → arms-up apex → tucked → landing → crouch | 6 |
| `hang.webp` | hanging from both hands overhead, legs swinging | 6 |
| `climb.webp` | climbing seen from behind, alternating arms and legs | 6 |

Rewrite `scripts/buddy_sheet.py` to build `public/buddy/sheet.png` + `sheet.json` from these:
- Cut magenta with `scripts/art_key.py`, then split each strip into frames by **connected components** of the alpha (frames are not on a grid; merge tiny islands, like a stray pixel or the glasses glint, into their nearest frame). Assert the expected frame count per file and order frames left to right.
- **One consistent scale:** Gemini drew each strip at a slightly different size. Normalise every frame so the **head** is the same size in all animations (measure head width, e.g. the widest hair row in the top 40% of a standing frame, and use the per-strip median), then the standing height is **80 px** on screen at 1×. Downscale with a pixel-art-friendly method: box/area or nearest from the detected pixel grid, then snap alpha to 0/255 and quantise to a shared palette (≤ 48 colours) built from all strips together, so every frame has the same colours. Crisp pixels, no blur.
- **Anchors:** each frame gets a ground anchor (bottom centre between the feet) so frames line up; the hang frames get a **hand anchor** (the top centre of the joined hands); the climb frames get a **grip anchor** (the higher hand). Store anchors and per-animation ms-per-frame in the JSON.
- Deterministic: running the script twice gives identical files.
- Animations: `idle` (the stance frame plus 2–3 frames picked from fight-walk, with a 1 px breathing bob in code), `walk` (6), `guard` (fight-walk, 6), `jump` (crouch, launch, apex), `fall` (tucked), `land` (landing, crouch), `hang` (6), `climb` (6). No punch, kick, sit or wave this round (the owner will send those later); remove them from the code and tests.
- No shearing or stretching of frames anywhere, at build time or at draw time. The only transforms are horizontal flips and integer-pixel positioning.

## 2. Panels are solid

- Platform panels are **solid boxes**, not just top lines: the buddy stands **on top** of a panel (feet exactly on its top edge), and his body never overlaps a panel's interior while walking, standing, falling or landing. Collisions resolve against all four sides (land on top, bump the underside, stop at the sides).
- **Climbing** happens on a panel's left or right side: he presses against it from outside, overlapping it by only **4–6 px** so his hands look like they grip the edge, using the climb frames (back view). At the top he pulls up (land frames, then stands on top).
- Use the page's real glass panels anywhere on the page as platforms (section cards, project cards, experience and education cards, skills band, contact card, footer, the hero glow excluded). Rects from layout (`offsetLeft/Top` relative to the document, as now), refreshed on resize, fonts, `ResizeObserver` and the light page's reveal end; never per frame. The page bottom is a floor.

## 3. Grab and drop

- **Mouse:** press on the buddy and drag: he **hangs from the cursor** by his hands (hang frames, hand anchor at the pointer), swinging like a pendulum with a little lag and overshoot from the pointer's velocity (a damped spring), legs kicking (cycle the hang frames faster when the pointer moves fast).
- **Release:** he is thrown with the pointer's velocity (capped), falls under gravity (fall frame), and lands on whatever panel is below (land frames, a few pixel dust puffs). Dropped in mid-air over nothing, he falls to the page bottom. He then lives where he landed: anywhere on the page.
- **Touch:** a **long-press (~300 ms)** on him grabs him, then drag; a normal swipe still scrolls (don't prevent default until the long-press fires); a short tap makes him do a small jump. Use pointer events with `setPointerCapture`; `touch-action: none` only on the buddy's hit box while grabbed.
- **Click (no drag):** a small happy jump.
- The cursor shows `grab` over him and `grabbing` while held. While grabbed, page text selection is suppressed.
- Keyboard: the hit-box button still focuses; Enter/Space makes him jump. (No keyboard drag.)

## 4. More life

- **Idle variety:** breathing bob, glancing (flip to face the pointer when it moves nearby), guard shuffles a few steps in place now and then, occasionally walks to a panel edge, looks down, turns back.
- **Purposeful roaming:** picks a destination (another panel, the cursor's panel, a random spot), plans a route (walk, jump short gaps up to ~90 px across and ~70 px up, climb taller sides, drop down from edges), and goes there. Rests between trips. Calm, not hyperactive: on average moving about a third of the time.
- **Follows the cursor** within ~400 px as before (guard walk when the cursor is close, walk when far), but stops at panel edges instead of walking off them unless he planned a jump or drop.
- **Juice:** small dust puffs on landing and on jump take-off; a 1-frame anticipation crouch before every jump; a tiny "!" pixel bubble when grabbed (drawn in code). Nothing loud.
- Facing changes only when he turns, never flickers.

## 5. Size and placement

- Standing height **80 px** at 1× (≥ 600 px wide viewports); **64 px** below 600 px (draw the 80-px sheet at 0.8× with nearest neighbour, or build a second 64-px sheet; choose whichever looks crisper).
- Starts standing on the footer, away from its text and buttons. He never stands still on top of a button or link for long; the hit box only covers his body.

## 6. Keep

Hide/Show toggle and `localStorage`, reduced motion (he stands still with only the breathing bob; grab and drop still work, but no roaming), i18n (EN/DE) for every label, lazy loading only in light mode, disposal on leaving light mode, no per-frame allocation, pause when hidden or far off screen.

## 7. Tests (`tests/buddy.test.ts`, rewritten for v2)

1. Standing on a solid panel: feet on the top edge, body never inside it over 10 s of walking back and forth.
2. Walking off an edge: falls and lands on the panel below.
3. Climbing a side: overlap with the panel never exceeds 6 px, ends standing on top.
4. Route planning: reaches a target on a higher panel within a time limit (via jump or climb).
5. Grab and drop: while grabbed, the hand anchor stays within a few px of the pointer path; released over a panel, he lands on it; released over nothing, he lands on the floor.
6. Throw: release velocity is capped; no tunnelling through a thin panel at max speed.
7. 120 s seeded random roaming: never inside a panel, never off the page, no NaN.
8. The sheet JSON lists every animation in §1 with frames inside the sheet, anchors inside each frame, and all frames using the shared palette.
All other tests stay green.

## 8. Verification

- `npm test`, `npm run build` (zero TS errors), the sheet script twice (identical output).
- The browser pane works for light mode, but when it is hidden its animation stalls: call `mcp__ccd_view__show_pane` with `pane: "preview"` first (load it with ToolSearch if needed). Dev server `npx vite --port 5174 --strictPort` in the background, open with `preview_start` (url) or `navigate`; stop it by port when done.
- Check at 1440×900 and 390×844: standing on the footer (not overlapping), walking, a jump between panels, climbing a side with the small overlap, grab with the mouse (drag with `left_click_drag`), drop on another panel, drop into empty space, cursor follow, toggle, German labels, no horizontal overflow, links under or near him still clickable.
- Save a 4× nearest-neighbour image of the whole new sheet and a few page screenshots in `/tmp/claude-1000/-home-dipu-Documents-Portfolio-Web/95cfc852-ca61-46ba-8173-5d148f3eba94/scratchpad/buddy2/`.
- Report: files changed, sheet size and frames per animation, the scale/normalisation used, constants, test status, screenshot paths with one-line observations, and anything skipped.
