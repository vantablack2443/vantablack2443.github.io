# Portfolio — Phase 1: Dark Mode Pinball Table

Owner: Dipu Balamurugan (github.com/vantablack2443)
Scope of this phase: dark-mode arcade page, fully playable. Light mode (Ghibli-style wallpaper) is Phase 2 — only leave the hooks for it.

---

## 0. Hard requirements

1. **Static site only.** No backend. Must build to plain files deployable on GitHub Pages / Cloudflare Pages.
2. **Content readable before the game starts.** "Lights off" dims decorations (glow, neon, chrome, playfield art), **not text**. Body text in the dim state must keep ≥ 4.5:1 contrast against its background.
3. **Content is real HTML text** in `index.html` (SEO, screen readers, copy-paste, no-JS). JS only positions it and adds the game.
4. **Game is opt-in.** Nothing moves until the user presses START.
5. **Arrow keys / Space must scroll the page normally** unless a game is in progress. `preventDefault` only while state ≠ ATTRACT.
6. Works on desktop (keyboard) and mobile (touch), portrait.
7. `prefers-reduced-motion: reduce` → no chase-light animations, no screen shake, lights snap on instead of sequencing. Game still playable.
8. No phone number on the page. Email is shown via a `mailto:` link assembled in JS (light anti-scraper measure); no-JS fallback shows the GitHub link only.

---

## 1. Stack

- **Vite + TypeScript (vanilla, no framework).** `npm create vite@latest` template `vanilla-ts`, then strip demo files.
- **Physics: `planck` (Box2D port), pinned exact version** (e.g. `planck@1.0.x`, check npm for latest 1.x at least 2 weeks old). Reason: Box2D has continuous collision for fast bodies (`bullet: true`) and revolute joints with motors + limits — exactly what flippers need. Do **not** use Matter.js (ball tunnels through flippers).
- **Rendering:**
  - DOM for all content and static table art (cards, bumpers labels, lanes, apron, header).
  - One `<canvas>` layered on top of the playfield for moving things: ball, flippers, plunger, hit sparks.
- **Fonts (Google Fonts):** `Monoton` (name on backglass only), `Bungee` (labels, score digits), `Chakra Petch` 400/600 (all body text). Body text never in Monoton/Bungee.
- **Audio:** Web Audio API, synthesized blips (no sound files). Muted by default, toggle button.
- Dev deps only: `vite`, `typescript`. Runtime dep: `planck`.

---

## 2. Coordinate system (the key design decision)

The whole table is a **fixed logical stage of 600 × 1100 units**, scaled to fit the viewport with one CSS `transform: scale(s)` (centered, `s = min(vw/600, vh/1100)` on desktop; on narrow screens `s = vw/600`, page may scroll vertically slightly).

- `src/layout.ts` is the **single source of truth**: every content element and every physics shape has its rect/position in logical units here.
- DOM elements are absolutely positioned from `layout.ts` (set `left/top/width/height` inline from JS, logical px).
- Physics bodies are built from the **same** `layout.ts` numbers. No `getBoundingClientRect`, no rebuild on resize — resize only changes the CSS scale and canvas resolution.
- Physics units: `PX_PER_M = 50` (planck prefers objects 0.1–10 m). Convert at the boundary (`toM(px)`, `toPx(m)`). y axis points down in both (set gravity positive y).
- Canvas: internal size `600*s*devicePixelRatio × 1100*s*devicePixelRatio`, drawn with `ctx.setTransform(s*dpr, …)` so drawing code uses logical units. Cap dpr at 2.
- Pointer/touch → logical: `(clientX - stageLeft) / s`.

### Debug overlay
`?debug` in the URL (or pressing `` ` ``) draws every physics fixture outline on the canvas in green over the DOM. Use it to confirm DOM and colliders line up. Must exist; it is how alignment is verified.

---

## 3. Table layout (logical units, approximate — tune for feel)

```
y=0    ┌──────────────────────────────────────────┐
       │ BACKGLASS (no physics)                   │  name, tagline, links,
       │ DIPU BALAMURUGAN                         │  SCORE / BALL / HI display
y=150  ├──────────────────────────────────────────┤  ← top arch wall begins
       │  ( EN )( DE )( ML )( HI )   rollover lanes│  sensors
y=260  │                                          │
       │   (PY)   (C)   (JAVA)                    ││ plunger
       │      (KOTLIN) (RUST)      pop bumpers    ││ lane
y=470  │                                          ││ x 545–580
       │  [ ORION        ] [ SAARDEW      ]       ││
       │  [ 2048 GAME    ] [ PAGERANK     ]       ││
       │  [ EDGE DETECT  ] [ MIPS R-P-S   ]       ││
y=800  │                                          ││
       │  ◣ B.Sc.            HiWi ◢  slingshots   ││
       │ |  \                  /  |  inlanes      ││
y=960  │ |   \___ flippers ___/   |               ││
       │         (drain gap)                     [▼]plunger
y=1000 ├──────────────────────────────────────────┤
       │ APRON:   [ ● START ]   ? READ CV   ♪     │  no physics
y=1100 └──────────────────────────────────────────┘
```

Rough geometry (adjust while testing with `?debug`):
- Outer walls: left x=20, right x=580, playfield top y=150. Top corners rounded with arc made of ~16 edge segments.
- Plunger lane: x 545–580, wall at x=540 from y=300 down to y=1000. Lane exits top-right into the arch; ball rolls left across the top.
- **One-way gate** at lane exit (x≈540, y≈260–300): an edge fixture; in planck `pre-solve`, call `contact.setEnabled(false)` when the ball is moving out of the lane (from the right side). Ball must never fall back into the lane from the playfield.
- Rollover lanes: 4 thin vertical guide walls with sensors between them (y 170–240), labels EN · DE · ML · HI (spoken languages).
- Pop bumpers: 5 circles r=30, labeled with skills Python, C, Java, Kotlin, Rust. Remaining skills (SQL, RISC-V, Git, Docker, GitLab) shown as small text on the playfield near bumpers (decorative, no physics) or as tiny round posts r=8.
- Project cards: 6 rectangles ~240 × 90, 2 columns × 3 rows, x≈45 and x≈300, y 480–790 with ~18 gap. Chamfer corners (use a polygon with 8 vertices, not a raw box) so the ball doesn't snag.
- Slingshots: two triangles above flippers (left: label "B.Sc. Informatik · UdS"; right: "HiWi · MPI-INF"). Kicker edge is the inner long side.
- Inlane/outlane guides: edge chains from walls down to flipper pivots.
- Flippers: pivots at (180, 935) and (370, 935) (playfield center ≈ 280, because plunger lane takes the right strip), length 82, thickness tapering 18→10. Tip gap ≈ 30 so a centered ball drains (that's real pinball).
- Drain sensor: horizontal sensor at y=1010 across playfield.

---

## 4. Content (from CV) — `index.html` static markup

All of this is plain semantic HTML in `index.html`. Each element that becomes a table object has an `id` matching a key in `layout.ts`.

**Backglass header**
- Name: **Dipu Balamurugan**
- Tagline: "B.Sc. Informatik @ Saarland University — Security · Data Networks · Software Engineering"
- Sub: "Saarbrücken, Germany · M.Sc. Informatik place secured"
- Links: GitHub (github.com/vantablack2443), Email (JS-assembled mailto: dipubalamurugan2k@gmail.com), CV PDF (placeholder link `cv.pdf`, file added later by owner).
- Score display: SCORE, BALL n/3, HI.

**Project cards** (title, stack line, 1-line summary on card; full bullets in modal; GitHub link):
1. **Orion — Multi-Agent AI Platform** · Next.js, TypeScript, Gemini API · Solo at MonaAI Hackathon: 10 domain agents for enterprise workflows. → https://github.com/vantablack2443/MonaAI-Hackathon
2. **Saardew — Farming Simulation** · Kotlin, Gradle, Detekt, JaCoCo · Team tick-based simulation, UML-first, tested & statically analysed. → https://github.com/vantablack2443/FarmingSimulation_Kotlin
3. **2048 + CPU Player** · Java, OOP, TDD · Test-first game logic plus a heuristic AI player. → https://github.com/vantablack2443/Java_2048-Game
4. **PageRank in C** · C, Graphs · Random-surfer & Markov-chain PageRank with memory-efficient structures. → https://github.com/vantablack2443/C_PageRank
5. **Edge Detection** · C, Image Processing · Gaussian blur, gradients, magnitude, thresholding. → https://github.com/vantablack2443/Edge-Detection_C
6. **Rock-Paper-Scissors in MIPS** · MIPS Assembly · Full interactive game in assembly: state, input, scoring. → https://github.com/vantablack2443/MIPS---RockPaperScissors

Modal for each card shows the full CV bullets (copy them from the CV text in §4a). Modal also lists "More": Django Web App (https://github.com/vantablack2443/django-fame-system), Rust Book notes (https://github.com/vantablack2443/Rustbook-Notes).

**Slingshot modals**
- Education: B.Sc. Informatik, Saarland University, Apr 2023 – present, 130+ ECTS, expected graduation by Sep 2027, M.Sc. place secured. Studienkolleg Jena (T-Kurs, 2,2), Apr 2022 – Jan 2023.
- Experience: HiWi, Campus Library Informatik+Mathematik (Max Planck Institute for Informatics), Apr 2024 – present: front-desk tech support; digitisation with GIMP; Python scripts/plugins automating the GIMP workflow.

**Languages** (rollover lanes): English C2, German B2, Malayalam C2, Hindi B2 — level shown in small text under each lane label.

### 4a. CV bullets (verbatim source for modals)
- Orion: Built solo at the MonaAI Hackathon: 10 domain-specific agents for enterprise workflows (document validation, HR shift replacement, CV fraud detection, pricing). / Designed the prompts for each agent on Gemini 2.5 Flash, e.g. an invoice agent that extracts invoice details, routes them to the right department and summarises the action needed. / Built the document upload pipeline (PDF, DOCX, images) into the model, with a Next.js 14 and Tailwind frontend.
- Saardew: Built a tick-based simulation as a team in the Softwarepraktikum at Saarland University. / Started with UML design, split the work by modules, and adapted the implementation when the requirements changed mid-project. / Reviewed each other's code and used unit and system tests plus static analysis (Detekt) and coverage (JaCoCo) for code quality.
- 2048: Wrote tests for the game logic first, then implemented it: tile-merging, scoring and game-state management. / Structured the game logic using object-oriented principles. / Added a CPU player that chooses moves by heuristic evaluation (e.g. maximising free tiles, keeping the highest tile in a corner).
- PageRank: Implemented Google's PageRank algorithm from scratch in C to analyse graph-based link structures. / Built graph traversal, iterative rank computation and convergence checks. / Focused on memory-efficient data structures for larger graph datasets.
- Edge Detection: Implemented edge-detection techniques to find object boundaries in digital images. / Processed pixel-level image data and applied filtering operations to extract features. / Worked with low-level memory management and performance-oriented C.
- MIPS RPS: Implemented an interactive game entirely in MIPS assembly: game state, user input, branching logic and score tracking. / Gained practice in processor architecture, low-level execution flow and assembly-level debugging.
- Django: Implemented database operations with the Django ORM in a course project. / Integrated external REST APIs into the application. / Built frontend pages with HTML and CSS to present application data.

### 4b. Reader mode / no-JS fallback
- `<html class="no-js">`; JS swaps to `class="js table"`.
- Without `.table` class, CSS renders the same HTML as a normal single-column readable page (header, education, experience, projects, skills, languages, contact).
- Apron button "READ CV" toggles `.table` off → reader layout (and back). Remember choice in `localStorage` (try/catch).
- Screen widths < 380 px: show a small banner "Best played on a bigger screen — or read the CV" with the toggle.

---

## 5. Visual design — dark arcade

Palette (CSS custom properties on `:root[data-theme="dark"]`):
- `--cabinet: #07060b`, `--playfield: #120f1c`, `--rail: #5b5670` (chrome), `--text: #e8e4f4`, `--text-dim: #b8b2cc` (dim-state body text; check ≥ 4.5:1 on `--playfield`).
- Neon: `--neon-pink: #ff3d9a`, `--neon-cyan: #2ee6ff`, `--neon-amber: #ffb52e`, `--neon-lime: #a6ff3d`.

Elements:
- Playfield: deep purple-black with subtle radial vignette, faint grid / circuit-trace pattern (CSS gradients, no images).
- Cards: dark glass panels, 2px border in a neon color, title in Bungee, stack in Chakra Petch 600, summary 400.
- Bumpers: circle with a neon ring + inner cap, label centered.
- Rails/walls: chrome gradient strokes drawn in DOM (SVG inline in the playfield, generated from `layout.ts` points) so they match physics.
- Inserts: small round "lamp" dots around the table rim and under cards (decor), become chase lights on start.

### Lights off → lights on
- **ATTRACT (lights off):** neon borders at ~25 % opacity, no glow, lamps unlit grey, chrome dull. Text stays `--text-dim` / `--text` → readable. A slow "breathing" pulse on the START button only (it's the call to action).
- **Lights-on sequence (~1.4 s total)** on START:
  1. 0 ms: flicker of the backglass name (2 quick flickers, like a fluorescent tube).
  2. 150 ms: rim lamps chase on clockwise (staggered `transition-delay`, 20 ms per lamp).
  3. 500 ms: bumpers pop on one by one.
  4. 800 ms: cards light up row by row (glow via `box-shadow` + `text-shadow`).
  5. 1200 ms: rollover lane lamps; playfield brightens.
  6. 1400 ms: ball appears in the plunger lane, plunger auto-fires (first ball only).
- Implement via a single class change on the stage (`.lights-on`) + per-element `--delay` custom properties. With reduced motion: no delays, no flicker.
- After GAME OVER, wait 4 s showing "GAME OVER / PRESS START", then lights fade back to off over 1.5 s.

---

## 6. Game mechanics

### State machine (`src/game/game.ts`)
`ATTRACT → LIGHTS_ON → PLUNGER → PLAYING → DRAINED → (balls left ? PLUNGER : GAME_OVER) → ATTRACT`
- `PAUSED` overlay state (modal open, tab hidden, or `P` key). Physics loop stops while paused.

### Physics setup
- Fixed timestep `1/120 s` with accumulator; max 5 substeps per frame (avoid spiral of death). planck velocity iterations 8, position 3.
- Gravity tuned for feel, start at `(0, 18)` m/s² (in our units real pinball ≈ table tilt; tune until the ball takes ~1.2 s to fall from top to flippers).
- Ball: dynamic circle r=11 px (0.22 m), `bullet: true`, density 1, friction 0.1, restitution 0.3, linear damping 0.05. Clamp speed to 40 m/s.
- Walls: static edge chains, restitution 0.4, friction 0.1.
- Flippers: dynamic polygon bodies, `revoluteJoint` to a static anchor at pivot; `enableLimit` (rest angle −30°, up angle +28°, mirrored for right), `enableMotor`, `maxMotorTorque` large (start 2000, tune), `motorSpeed` +/−25 rad/s held while pressed / released (motor always on, so flipper falls back fast). Flippers ignore gravity (`gravityScale 0`) and have high density. Flipper `bullet: true` too.
- Pop bumpers: static circles; on `begin-contact` with ball, queue an impulse along the normal (away from bumper center) of fixed magnitude → score +100, light flash `.hit` 120 ms, sound.
- Slingshots: static polygon; kicker edge kicks like bumpers (+50). Other edges passive.
- Cards: static polygons, restitution 0.5, no kick. On hit: +250, card `.hit` flash, card gets `.visited` (stays brighter for rest of game).
- Rollover lanes: sensors; ball passing lights the lane (+500). All 4 lit → "POLYGLOT!" message, bonus multiplier +1 (max 5×), lanes reset.
- All 6 cards visited in one game → "ALL PROJECTS EXPLORED!" +10 000, cards do a light chase.
- **Never modify bodies inside planck callbacks.** Queue events in callbacks, apply impulses/state after `world.step`.

### Plunger
- Ball rests on the plunger at lane bottom.
- Hold `Space` or `↓` (or press-and-hold the plunger knob on touch) → charge 0→1 over 1 s, plunger knob visibly pulls down; release → impulse up proportional to charge (min power must still clear the lane exit; tune).
- First ball after START auto-fires at ~85 % power so "press start → ball shoots up" works with one press.

### Fairness helpers
- **Ball save**: drain within 6 s of launch → ball returns to plunger, "BALL SAVED" message.
- **Stuck detection**: ball speed < 0.3 m/s for 3 s outside plunger lane → small random impulse ("NUDGE").
- **Out-of-bounds safety**: ball outside stage bounds (tunnel bug) → treat as drain without losing ball, log a console warning.

### Scoring & HUD
- Score, ball (n/3), multiplier, high score in backglass, Bungee digits with neon.
- Pop-up text messages ("+250 ORION", "BALL SAVED") in a backglass message line, 1.5 s.
- High score in `localStorage` (try/catch, page works without it).

### Controls
| Action | Keyboard | Touch |
|---|---|---|
| Start | Enter / START button | tap START |
| Left flipper | ← or Z or Left Shift | touch & hold left half of the lower 40 % of the stage |
| Right flipper | → or / or Right Shift | touch & hold right half of the lower 40 % |
| Plunger | hold Space or ↓ | hold plunger knob |
| Pause | P | — (auto on tab hidden) |
| End game | Esc | — |
- Multi-touch: both flippers at once must work (track touches by `identifier`).
- While playing: `touch-action: none` on the stage; restore after.
- Click/tap on a card during ATTRACT → open modal. During PLAYING, card clicks are ignored (fingers are on flippers); show "tap cards after the game, or press READ CV".

### Modal
- Accessible dialog (`<dialog>` element), focus trap via native `showModal()`, Esc closes, returns focus.
- Pauses game if open during play.

### Audio (`src/game/audio.ts`)
- Created lazily on first user gesture. Sounds: bumper (short square blip, random pitch ± 10 %), flipper (low thunk), card hit (two-tone chime), drain (descending sweep), launch (noise burst + rising tone). Master gain 0.2. Muted default; toggle ♪ in apron, remember choice.

---

## 7. File structure

```
portfolio/
  index.html              static semantic content + stage containers
  package.json
  tsconfig.json
  vite.config.ts          base: './' so it works on GitHub Pages subpaths
  public/
    favicon.svg
  src/
    main.ts               bootstrap: theme, reader/table mode, scaling, wire game
    layout.ts             ALL logical coordinates (content rects + physics shapes)
    stage.ts              positions DOM from layout, computes scale, resize handling
    svg-rails.ts          draws walls/rails SVG from layout points
    lights.ts             lights-on/off sequencing, hit flashes
    modal.ts              project/education/experience dialog
    game/
      game.ts             state machine, scoring, main loop
      physics.ts          planck world + body factories, unit conversions
      flipper.ts
      plunger.ts
      input.ts            keyboard + touch → flipper/plunger commands
      render.ts           canvas drawing: ball, flippers, plunger, sparks, debug overlay
      audio.ts
    styles/
      base.css            reset, fonts, reader-mode layout (also no-JS layout)
      arcade.css          everything scoped under [data-theme="dark"].table
  tests/
    sim.test.ts           headless physics checks (see §9)
```

Theme hook for Phase 2: `<html data-theme="dark">`. All arcade CSS scoped under `[data-theme="dark"]`. Game code only boots when theme is dark and table mode is on (dynamic `import('./game/game')` so light mode never loads planck).

---

## 8. Build order (do in this order, check each before next)

1. Scaffold Vite vanilla-ts, install `planck` (exact version), clean template.
2. `index.html` with all content as semantic HTML + `base.css` reader layout. Check it reads well with JS disabled.
3. `layout.ts` + `stage.ts`: absolute-position content on the 600×1100 stage, scaling to viewport. Static arcade styling in lights-off state. Check readability.
4. `svg-rails.ts`: walls, lanes, slingshots, plunger lane drawn from layout.
5. `physics.ts` + `render.ts`: world with walls only, ball dropped from top, debug overlay. Verify outlines match DOM.
6. Flippers + input (keyboard). Tune until flipping a resting ball sends it to the top of the table.
7. Plunger + one-way gate + drain sensor + state machine + ball count.
8. Bumpers, slingshots, cards, rollovers: contacts, scoring, hit flashes.
9. Lights-on sequence, game over → lights off.
10. Touch controls, multi-touch, `touch-action`, mobile scaling.
11. Modal, reader-mode toggle, audio, high score, ball save, stuck detection, pause on hidden tab.
12. Reduced motion, contrast check, keyboard-focus styles, final `npm run build`.

---

## 9. Verification (must pass before reporting done)

- `npm run build` succeeds with zero TypeScript errors.
- `tests/sim.test.ts` (run with `npx vitest run` or a plain `tsx` script — add whichever as dev dep) builds the real world from `layout.ts` headlessly and checks:
  - Ball dropped at 20 random positions on the playfield, with flippers toggling randomly every 0.2 s, simulated 60 s each: ball never leaves the playfield polygon (no tunneling) except through the drain.
  - Ball resting on a raised flipper and then flipped reaches y < 400 (flipper strong enough).
  - Full-power plunger launch: ball exits the lane and enters the playfield; ball never re-enters the lane from the left.
  - Min-power launch still exits the lane.
- Manual in browser: `?debug` outlines match DOM elements; content readable in lights-off state; START → lights sequence → ball launches; flippers on ← →; 3 balls then game over → lights off; page scrolls normally with arrow keys in ATTRACT.

---

## 10. Deploy (later, owner does this)

- Push repo to GitHub → GitHub Pages via Actions (`vite build`, upload `dist/`), or connect repo to Cloudflare Pages (build `npm run build`, output `dist`).
- Custom domain: add CNAME record at the registrar → only cost is the domain.

## Out of scope for Phase 1
Light mode, global leaderboard, contact form, CV PDF file, analytics.
