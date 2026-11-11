# Buddy: a pixel-art Dipu that lives at the bottom of the light page

A small pixel-art fighter version of the owner walks, climbs and jumps around the glass panels at the bottom of the **light** theme (the "Let's talk" contact card, the footer, and anything else near the bottom). Read `LIGHT-MODE.md` for the light theme. Design system for any DOM UI: `.claude/skills/landing-page-design/SKILL.md` Part B.

Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. **Do not commit or push.** Dark mode and the game stay untouched.

---

## 1. Art: one pose in, a sprite sheet out

- Source: `art/buddy/base.png`, **70 × 128 px**, real pixel art at its native resolution (1 image pixel = 1 art pixel), alpha already cut out, facing right, in a relaxed fighting stance (fists up). The full-resolution Gemini original is `art/buddy/source.webp` (on flat magenta; `scripts/art_key.py` has the cut-out helpers).
- Write `scripts/buddy_sheet.py` (Pillow only, deterministic) that builds **`public/buddy/sheet.png`** plus **`public/buddy/sheet.json`** (frame rects, anchors, durations per animation) from the base image. Commit-ready: running it again gives the same files.
- How: cut the base into parts with hand-placed rectangles or masks in the script (head + hair, torso + hood, front arm/fist, back arm/fist, front leg, back leg; fill the gaps a moved part leaves with the neighbouring colours), then pose the parts per frame with small integer offsets and, where needed, nearest-neighbour rotation by 90° steps or shears of 1–2 px. **No smoothing, no new colours**: every pixel in the sheet comes from the base palette. The character must stay recognisable and consistent in every frame.
- Animations (frames at ~8–12 fps; the numbers are a guide):
  - `idle` 4: fighting-stance bounce, 1 px up and down, fists bob.
  - `walk` 6: legs alternate, slight body bob.
  - `run` 6: wider steps, leaning forward (can reuse walk with bigger offsets).
  - `jump` 2 (crouch, up) and `fall` 1 (legs tucked).
  - `climb` 4: facing the wall, arms reaching up alternately (side view against a panel edge is fine).
  - `ledge` 2: pulling up over a top edge.
  - `punch` 3: front fist shoots forward; `kick` 3: front leg kicks.
  - `sit` 2: sitting on a panel edge, legs dangling, small head bob.
  - `wave` 3: one arm up waving.
- Facing left is a horizontal flip at draw time.

## 2. Behaviour

The buddy lives in **page coordinates** on the light page and treats the glass panels as a little platform level:
- **Platforms:** the top edges of the light-mode glass panels in the lower part of the page: at least `#contact .contact-cta` (or its glass card) and `#lfooter`, plus the projects grid cards, the experience/education cards and the skills band if they are within ~1.5 viewport heights of the page bottom. Read their rects with `getBoundingClientRect()` + `scrollY` when the page lays out, on resize, after fonts load, and with a `ResizeObserver`; never every frame. The page bottom is also a floor.
- **Walls:** the left and right side edges of each panel. The buddy can **climb** a side edge up to its top, pull up over the ledge, and walk along the top. It can **drop** down from an edge and **jump** short gaps between panels.
- **Movement:** a tiny custom physics model, not planck: gravity, walk speed ~60 px/s, run ~140 px/s, jump with a fixed arc, climb ~40 px/s. Integer pixel positions when drawn so it stays crisp.
- **On its own:** a small state machine with weighted random choices: walk to a random spot on its platform, idle, sit on an edge with legs dangling, wave, climb up to a higher panel, drop down, do a punch or kick into the air now and then. Rests often; it should feel calm, not hyperactive.
- **The cursor:** if the pointer moves within ~400 px of the buddy, it turns toward it and walks or runs there. If the cursor rests over a higher panel, it climbs or jumps up to it. When the cursor stops still near it, it waves.
- **Clicks:** clicking or tapping the buddy makes it **punch** (alternating with a kick) and shows a small pixel "hit spark" (a few pixels drawn in code, no new art). It must never block clicks on links and buttons: only the buddy's own small hit box takes pointer events.
- **Touch:** tap the buddy to punch; tap on a panel's top area does nothing special (no hijacking of scrolling).
- Starts sitting on the footer panel (its left part), and stays within the bottom region of the page.

## 3. Rendering

- One small `<canvas>` absolutely positioned in the document (page coordinates), sized to the sprite frame times the scale, moved with `transform: translate3d(...)` to the buddy's position; `image-rendering: pixelated`. Scale: **1×** on viewports ≥ 600 px wide, **0.75×** below (nearest neighbour; acceptable).
- A soft 1-px-blurred shadow ellipse under its feet when standing on a panel.
- `z-index` above the panels, below the nav and any dialog. `aria-hidden="true"` on the canvas; the hit box is a `<button>` with an `aria-label` ("Buddy: click to make him punch" / German), visually transparent, following the sprite, with a visible focus ring; pressing Enter or Space on it makes him punch.
- Only runs while light mode is active and the buddy is within ~1 viewport of the visible area (IntersectionObserver on a sentinel near the page bottom); pause when the tab is hidden. No per-frame allocation.

## 4. Settings and accessibility

- A small toggle in the footer, next to "Play the game": **"Hide buddy" / "Show buddy"** (DE: "Buddy ausblenden" / "Buddy einblenden"), remembered in `localStorage` (try/catch). Default: shown.
- `prefers-reduced-motion: reduce`: he sits still on the footer with a gentle 2-frame idle only (no walking, climbing or jumping). Clicking still punches once.
- All new text through the i18n system (`data-i18n`, `t()`), with German in `src/i18n/de.ts`; the i18n test must pass.
- Light mode stays readable: the buddy never covers the hero, the nav or the contact buttons for long (he never stops on top of a button).

## 5. Code

- `src/light/buddy.ts` (behaviour, state machine, physics, rendering) and, if it helps, a pure `src/light/buddy-sim.ts` with no DOM so it can be tested. Started and stopped from `src/light/index.ts` like the other light-mode pieces (`enterLight` / `leaveLight`), lazily loaded with the light chunk; leaving light mode removes every listener and element.
- The sheet is fetched only in light mode (it is in `public/`, loaded on demand).

## 6. Tests

`tests/buddy.test.ts` on the pure sim with fake platforms:
1. Standing on a platform, gravity keeps it there; walking off an edge makes it fall and land on the platform below.
2. Climbing a side wall reaches the top and ends standing on it.
3. A target on a higher platform is reached (climb or jump) within a time limit.
4. 60 s of random behaviour with a fixed seed: never ends inside a panel, never leaves the bottom region, no NaN.
5. The sheet JSON has every animation listed in §1, each frame inside the sheet bounds.
All existing tests stay green.

## 7. Verification

- `npm test`, `npm run build` (zero TS errors), and run `scripts/buddy_sheet.py` twice to confirm the output does not change.
- The built-in browser pane works for light mode (it is a 2D canvas, no WebGL needed). Dev server `npx vite --port 5174 --strictPort` in the background; stop it by port when done (not `pkill -f`). Use `preview_start` with the URL.
- Check at 1440×900 and 390×844: he sits on the footer, walks, climbs onto the contact card, follows the cursor, punches on click, the toggle hides him and is remembered, reduced motion keeps him still, German labels, no horizontal overflow, links and buttons under him still clickable.
- Save a zoomed screenshot of the whole sprite sheet (nearest neighbour, 4×) in `/tmp/claude-1000/-home-dipu-Documents-Portfolio-Web/95cfc852-ca61-46ba-8173-5d148f3eba94/scratchpad/buddy/` so the owner can see every frame.
- Report: files added, sheet size and frame count, the constants, test status, screenshot paths with one-line observations, and anything skipped.
