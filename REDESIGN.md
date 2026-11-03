# Phase 1.5: Harder game, full-screen layout, better visuals

Read this file together with `PLAN.md` (the original spec). Where they disagree, this file wins. The game code in `portfolio/` already works. Keep the physics engine, the state machine, the tests and the single-source `layout.ts`. Change only what this file asks for.

---

## 1. Gameplay: shorter flippers

- Flipper `length` 100 → **84** in `src/layout.ts` (both sides). Keep the pivots where they are, so the gap between the flipper tips gets wider and draining gets easier. That makes the game harder, which is the goal.
- Reduce the bumper kick by about 15% (1.5 → 1.3 N·s) and the sling kick to 1.1 N·s.
- Ball save: 6 s → 4 s.
- Move the funnels and inlane guides so they still line up with the shorter flipper's resting top surface (the existing tangent-line helper should handle it; check with `?debug`).
- All tests must still pass. You may change the thresholds of two tests:
  - the bot-survival or "centre gap reachable" percentage test (it may now need ≥ 10% instead of 15%);
  - the flipper strength test (positions 30/60/90% along the blade still apply, measured on the new length).
- Add a **new test**: a simple bot that flips when the ball is below y = 880 should lose its ball in under 90 s in at least 30% of 60 seeds. If it doesn't, keep weakening the flippers (motor speed, torque) until it does. Report the final numbers.

---

## 2. Layout: fill a laptop browser

The table currently sits in a narrow column in the middle of the screen, with the content too small to read. New layout for viewports ≥ 1024 px wide (landscape):

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ┌─────────────┐   ┌───────────────────────────┐   ┌─────────────────────┐ │
│ │ LEFT PANEL  │   │                           │   │ RIGHT PANEL (HUD)   │ │
│ │ (backglass) │   │      TABLE                │   │                     │ │
│ │             │   │      full viewport height │   │ SCORE   BALL  BONUS │ │
│ │ Name        │   │      tilted in 3D         │   │ mission / message   │ │
│ │ Tagline     │   │                           │   │                     │ │
│ │ Links       │   │                           │   │ PROJECT SPOTLIGHT   │ │
│ │ Education   │   │                           │   │ (card last hit or   │ │
│ │ Experience  │   │                           │   │  hovered, in full)  │ │
│ │ Skills      │   │                           │   │                     │ │
│ │ Languages   │   │                           │   │ Controls            │ │
│ └─────────────┘   └───────────────────────────┘   └─────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

- `body` fills `100vw × 100dvh`, no page scroll on desktop. Grid: `minmax(280px, 1fr) auto minmax(320px, 1fr)` with 24–32 px gutters.
- **Table** height = `100dvh − 2 × 24px`; its width follows from the stage aspect ratio. The stage scale is computed from the height only.
- **Move the backglass out of the table.** The name, tagline, links and score no longer sit at the top of the stage. The stage becomes **600 × 940 logical units** (playfield 0–860 plus apron), and all `layout.ts` y values shift up by the old backglass height (176). Physics and tests use `layout.ts`, so they follow automatically. Re-run the tests.
- **Left panel** (real text, readable at 14–16 px, never scaled by the stage transform): name (large), tagline, location line, links (GitHub, Email, CV), then compact sections Education, Experience, Skills, Languages. This is the "backglass" of the machine: framed, lit, part of the cabinet.
- **Right panel** = HUD:
  - Score, ball and bonus in a mono font, inside framed boxes (like a real machine's score display: a dark inset, glowing digits).
  - A message line: "Press start", "Ball saved", "+250 Orion".
  - A **Project spotlight**: shows the full detail of the card the ball last hit, or the card the mouse is over. Before the game starts, it shows a short "How to play / tap a card" note and then cycles through the projects every 6 s. The DOM cards on the table then only need a **title and a stack line**, in a big, readable size; drop the summary line from the table cards.
  - Controls legend and a sound toggle.
- The table keeps its START / READ CV buttons in the apron.
- **Narrow screens (< 1024 px or portrait):** stack the layout as name strip, table (full width) and panels below it; the table scales from width. Mobile must still work as it does now.
- The READ CV reader mode stays as it is.

---

## 3. 3D tilt

Real pinball is viewed at an angle. Give the table depth:

- Wrap the stage in a container with `perspective: 1600px`, and give the stage `transform: rotateX(18deg)` with `transform-origin: 50% 100%` (the bottom edge stays put, the top recedes). Apply it to the stage element that holds both the DOM layer and the canvas, so they stay aligned.
- Fit the scale to the **projected** height (about `cos(18°)` of the flat height plus perspective shrink); compute it, don't guess. The whole table must stay inside the viewport.
- Touch zones and card clicks go through DOM hit-testing, so they keep working under the transform. Check that the plunger knob and both flipper halves still respond.
- Cabinet: a thick frame around the playfield (dark side rails with an inner chrome edge and a subtle bevel) so it reads like a machine standing in front of you, not a flat rectangle.
- `?flat` URL flag turns the tilt off (useful for debugging, and as a fallback if the tilt makes text blurry on some GPUs).

---

## 4. Visual direction

### Reference, and what not to copy
The owner supplied a screenshot of a classic commercial pinball game as a quality bar. **Do not recreate that table, its layout, its art, its characters or its logos.** Take only the general qualities that make it look rich:
- a dense, illustrated playfield instead of a flat colour;
- many small lamp inserts in patterns (rings, arrows pointing at targets, rows above lanes);
- 3D-looking hardware: domed bumper caps, chrome posts, rubber rings, a flipper with a highlight;
- strong framing, and a HUD that sits outside the playfield.

### Our own theme: "Motherboard"
The owner is a CS student (security, networks, low-level C/MIPS). Make the playfield a **circuit board**:
- Deep navy/indigo PCB base with faint **copper traces** routed between objects (SVG paths generated in `svg-rails.ts` or a static SVG; traces should connect bumpers to cards, as if signals flow between them). Small solder-pad dots at trace ends.
- **Centre feature, between the bumpers and the cards**: a "CPU die" decal: a square chip outline with pin rows on all four sides. The pin rows are **lamp inserts** that light in a chase when the ball hits bumpers, and fill up as the bonus multiplier rises.
- **Bumpers = "capacitor" caps**: a domed top (radial highlight), a coloured ring and a skill label. On hit: a flash, a ring pulse and a spark burst (there is a canvas already).
- **Cards = "chips/modules" on the board**: a dark surface, a thin full border, a chamfered corner, a pin-1 dot. Big title (≥ 20 px at stage scale 1), stack line under it. Lit state = border glow and title colour; visited = a small checkmark lamp.
- **Arrow lamp inserts** under the side corridors, pointing up at the gaps (an inviting "shoot here").
- **Rollover lanes** keep the languages, styled as lamp inserts with letters.
- Slingshots: chrome-edged triangles with a rubber band (light stroke) on the kicker side.
- Flippers: drawn with a body gradient + highlight + a rubber edge; keep them in the canvas.
- Ball: chrome sphere (radial gradient plus a specular highlight), with a soft shadow offset towards the bottom.

### Lights off vs on (keep the existing behaviour)
- Off: traces and lamps unlit (dark copper, grey lamps), but **all text stays readable** (≥ 4.5:1 contrast).
- On: the sequence as before, plus traces "power up": copper turns bright, and a short pulse runs along the traces from the plunger lane outward (CSS `stroke-dashoffset` animation; skipped under reduced motion).

### Design-system rules (adapted from the `landing-page-design` skill)
That skill is written for marketing landing pages, so not all of it fits a pinball page. Apply these parts:
- **Type:** one typeface for UI text, **Geist** (Google Fonts), plus **Geist Mono** for score digits, the stack lines and lamp letters. No Inter/Roboto/Arial. No italics. Max weight 700. Drop Monoton, Bungee and Chakra Petch. The arcade feel comes from lighting, framing and art, not from novelty fonts.
- **Sizes** snap to the Tailwind scale: 12/16, 14/20, 16/24, 18/28, 20/28, 24/32, 30/36, 36/40, 48, 60. Define named classes once (`heading-2`, `title-3`, `body-6`, `caption-4`, …) and use them. Name in the left panel: Heading 2 (48 px) with the `#FFFFFF → #9B9B9B` text gradient.
- **Spacing** only from: 0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96 px (panels and HUD; table geometry is exempt because it comes from physics).
- **Radius** from Tailwind steps; nested radius = outer − gap.
- **Panel surfaces** use the flat dark colours `#000000 #181818 #1F1F1F #272727 #313131`. Borders go all the way around or not at all. *Exception: the playfield and lighting effects may use gradients and glows; that's the point of a pinball table.*
- **Motion:** `cubic-bezier(0.22,1,0.36,1)`; 500 ms for moves, 300 ms for colour/opacity; animate transform and opacity only (glow via opacity of a pseudo-element, not by animating `box-shadow`). Reduced motion: plain opacity changes.
- **States:** every button has hover, active (`scale(.98)`), and a visible focus ring.
- **Icons:** Phosphor (inline SVG, copy the few paths you need: github, envelope, file-text, speaker-high, speaker-slash, play, book-open). Don't load an icon font.
- **Copy:** sentence case for buttons and labels ("Start", "Read CV"); keep the arcade ALL-CAPS only on lamp/score text. No hyphens inside running text.
- **Ship items:** `<title>`, meta description, `og:title`, `og:description`, skip-to-content link, favicon kept, a check at 390 px with no horizontal overflow.

Skip these parts of the skill (they're for sales pages): intake questions, CTA/FAQ/risk-reversal sections, the tagline-reveal section, the "no background gradients" rule on the playfield.

---

## 5. Process

1. Gameplay changes (§1) and the tests first. Commit nothing (no git here); just keep the tests green.
2. Stage height change + backglass moved out (§2) and the tests again.
3. Desktop grid + panels + spotlight.
4. Tilt + cabinet (§3).
5. Playfield art and hardware (§4).
6. Responsive pass: 1440×900, 1280×800, 1920×1080, 390×844 (portrait phone), 768×1024.
7. If the `frontend-design:frontend-design` skill is available to you, load it before step 3 and use it for aesthetic judgement within the constraints above.

## 6. Verification before reporting

- `npm run build`, zero TS errors. `npx vitest run`, all green, including the new bot test.
- Screenshots in the browser pane at 1440×900 lights off, 1440×900 lights on mid-game, and 390×844. Check that at 1440×900 the table plus panels fill the viewport with no page scroll, and that the table's text is readable.
- Report: what changed, the final physics numbers, the bot drain rate, the screenshot observations, and anything not done.
