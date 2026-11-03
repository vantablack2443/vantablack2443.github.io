# Phase 2: Light mode, "Backwaters"

Read with `PLAN.md` and `REDESIGN.md`. Where they disagree, this file wins for light mode. **Dark mode (the pinball table) must keep working exactly as it does now.** All existing tests must stay green.

The installed skill `.claude/skills/landing-page-design/SKILL.md` (in /home/dipu/Documents/Portfolio-Web) is the design system for light mode. Read Part B fully. Apply all of Part B except where this file says otherwise. From Part A use only the copy rules (A5): specific, no filler words, sentence case, no hyphens inside sentences.

---

## 1. Concept

Dark mode is an arcade at night. Light mode is the same person in daylight: a calm, hand-painted Kerala backwater scene (the owner's roots; Malayalam is a native language), gently moving, with the CV content floating on frosted panels. Quiet, warm, readable. It must feel like a painting you can scroll through, not a template.

Assets, already made and in `portfolio/public/light/`:
- `bg.webm` (VP9, 828 KB), `bg.mp4` (H.264, 1.17 MB): 1280×720, 24 fps, 8.5 s seamless loop, no audio.
- `poster.webp`, `poster.jpg`: the first frame.

What the scene contains (use it for composition): coconut palms on the left third, huge cumulus clouds on the right third, **calm open sky in the center top (x 30–65%, y 5–40%)**, a houseboat at the center (x ≈ 43%, y ≈ 70%), rice paddies and a village on the right, grass and red hibiscus along the bottom 20%.

---

## 2. Theme switching

- Initial theme: `localStorage['theme']` if set (try/catch), else `prefers-color-scheme` (light → light, dark → dark). Set it with an **inline script in `<head>`** before CSS loads, so the wrong theme never flashes.
- `<html data-theme="light|dark">`. Update `<meta name="theme-color">` to match (light: `#EAF3FA`, dark: `#000000`).
- **Toggle button** in both themes:
  - In light mode: in the floating nav, label "Arcade mode" with a moon/joystick icon (Phosphor `game-controller` or `moon`).
  - In dark mode: in the right HUD panel next to the sound toggle, label "Daylight" with a Phosphor `sun` icon.
  - `aria-pressed`, a visible focus ring, and the state remembered in localStorage.
- **Switching at runtime with no page reload:**
  - To dark: run the existing `bootTable()` (lazy-loads planck as before) and lights stay OFF until START, as now.
  - To light: if a game is running, end it (`endGame()`), then `dispose()` the game (cancel rAF, remove listeners, release keys) and set `game = null` so the next switch to dark boots a fresh one. **Arrow keys and Space must scroll normally in light mode**; check that no game listener survives.
  - Use `document.startViewTransition()` when available for a 500 ms cross-fade; fall back to an opacity fade of `#app` on the B7 curve. Reduced motion: instant swap.
- Refactor `main.ts` cleanly: `applyTheme(theme)`, `enterDark()`, `enterLight()`. Light-mode code (video, reveals, parallax) lives in `src/light/` and is dynamically imported only when light mode is first entered, just as the game is only loaded for dark.

---

## 3. Layout

### Content reuse (no duplicated CV text)
The CV text already exists once in `index.html` (`#panel-left` header, `main#content` sections, the card `.detail` blocks, `#contact`). Light mode is a **CSS layout of the same DOM** plus a few light-only wrappers. Reader mode already lays it out as a normal page; build light mode from that path (`[data-theme="light"]` styles) rather than from the table styles. Elements that only make sense on the table (stage, canvas, rails, board, apron, HUD, spotlight) are `display: none` in light mode. If a light-only element is unavoidable (hero copy, tagline section, nav), add it once with a `light-only` class, hidden in dark.

The READ CV reader mode keeps working in dark mode. In light mode it is unnecessary, so hide its toggle.

### Background
- A `<video>` fixed behind everything: `position: fixed; inset: 0; object-fit: cover; object-position: 42% 60%` (keeps the houseboat and calm sky in frame on both wide and tall screens). `muted autoplay loop playsinline disablepictureinpicture`, `poster="light/poster.webp"`, `<source src="light/bg.webm" type="video/webm">` then mp4. `aria-hidden="true"`, `tabindex="-1"`.
- Only create or attach the video in light mode (don't download 2 MB for dark-mode visitors). Pause it when the tab is hidden.
- **Poster only, no video** when `prefers-reduced-motion: reduce` or `navigator.connection?.saveData` is true. Use the poster image as a CSS background.
- A very soft scrim for legibility: a fixed overlay `rgba(255,255,255,0.0→0.35)` that gets slightly stronger as the user scrolls down (opacity driven by scroll, throttled through rAF; animate opacity only).
- **Gentle depth:** the video layer moves up to ±10 px with the pointer (desktop only) and has a slight 1.04 scale so edges never show. Transform only, smoothed with lerp in rAF, off under reduced motion and on touch devices.
- **Floating pollen/light motes:** a full-screen `<canvas>` above the video with 25–40 tiny warm white dots drifting slowly upward and sideways with slight flicker. Cap at DPR 2. Pause when hidden or scrolled past the hero. Off under reduced motion.

### Sections (top to bottom)
1. **Floating nav** (B7 navigation rules): a compact pill centered at the top with translucent cream glass `rgba(255,251,242,0.72)` and `backdrop-filter: blur(16px) saturate(1.2)`. Left: "Dipu B." wordmark. Links: Projects · Experience · Skills · Contact (smooth scroll, current section indicated via IntersectionObserver). Right: the theme toggle "Arcade mode". On mobile: a menu button that opens a full-height panel with the staggered link entrance from B7.
2. **Hero, a full viewport height.** Content sits in the calm sky area, **centered horizontally, top third** (not over the palms or clouds):
   - Small caption chip: "B.Sc. Informatik · Saarland University".
   - Heading 1 (60 px; 48 px under 768 px; 36 px under 390 px), light-theme text gradient `#000000 → #666666` per B5, max width 680 px, meaningful line break. Copy: **"I build software from the processor up."** (the owner writes MIPS, C, Java, Kotlin and TypeScript; this is true to the CV). Break after "software".
   - Subheading Body 3 (or Title 2), max width 680 px: "Computer science student in Saarbrücken, focused on security, data networks and software engineering. I like knowing what every layer underneath is doing."
   - Primary CTA: "See my projects" (scrolls to projects). Secondary ghost button: "Play the arcade" (switches theme to dark). Only these two above the fold.
   - Proof line (Caption 2): "130+ ECTS · M.Sc. place secured · HiWi at MPI for Informatics".
   - **Legibility:** the hero text sits on a soft radial cream glow behind it (a blurred ellipse `rgba(255,252,245,0.55)`, not a box), so dark text stays at ≥ 4.5:1 on the bright sky. Measure the contrast against the poster pixels behind the text and adjust the glow until it passes.
   - A small "Scroll" cue at the bottom with a slow 2 s bob (transform only; reduced motion: static).
3. **Tagline reveal (B11, mandatory):** Heading 2, max width 680 px, centered, on a glass band. Copy (two lines): "From MIPS registers to multi-agent AI, / I like building the whole stack." Words go from 30% to full opacity one by one as they cross a trigger line (IntersectionObserver per word or a single rAF-throttled scroll handler). Reduced motion: shown at full colour.
4. **Projects:** a responsive grid of the six project cards (3 columns ≥ 1100 px, 2 columns ≥ 700 px, otherwise 1). Each card is a glass panel (`rgba(255,251,242,0.78)`, blur 14 px, 1 px border `rgba(255,255,255,0.6)` all round, radius `rounded-2xl` 16 px, inner radius per the B3 formula). Contents:
   - title (Title 1), stack line (Caption 4 in Geist Mono), the short summary;
   - "Details" button that expands the full bullets (`.detail`) inline with a height-free animation (animate `grid-template-rows: 0fr → 1fr`? No: B7 forbids animating size. Use a `<details>`-style toggle with an opacity + translateY entrance of the revealed content);
   - "View on GitHub" link with a Phosphor `github-logo` icon.
   - Below the grid: "More on GitHub": the Django app and the Rust Book notes as small link rows.
5. **Experience and education:** two glass cards side by side (stacked on mobile): HiWi at the MPI-INF Campus Library (Apr 2024 – present, three bullets) and Education (B.Sc. Saarland University with ECTS/graduation/M.Sc. line; Studienkolleg Jena).
6. **Skills and languages:** chips in two groups (Programming: Python, C, Java, Kotlin, Rust, SQL, RISC-V · Tools: Git, GitLab, Docker) and languages with levels (English C2, German B2, Malayalam C2, Hindi B2). Chips: Caption 3, glass, rounded-full.
7. **Contact / footer:** a glass card: "Let's talk." (Heading 4), one line "Open to working student positions and internships in Germany." (write it as a placeholder `{{availability}}` if unsure; owner confirms), buttons: Email (JS-assembled mailto as in dark), GitHub, CV (PDF). Footer line: "© 2026 Dipu Balamurugan · Built with Vite and a lot of pinball physics" + theme toggle again. No phone number.

Sections 3–7 scroll over the fixed video. Spacing between sections: Spacing-900 (96 px) desktop, Spacing-700 (64 px) mobile. Content max width 1120 px, side gutter 24 px (16 px under 390 px).

### Scroll reveals
Per B7: each section rises 32 px and fades in over 700 ms on the base curve, once, using IntersectionObserver. Cards in the grid are staggered 60 ms each (cap 400 ms total).

---

## 4. Visual system (light)

- Fonts: Geist (UI) + Geist Mono (stack lines, chips), already loaded. Named text classes from REDESIGN.md are reused; add missing ones from the skill's B1 table if needed.
- Text colours: primary `#14212B` (deep blue-ink, not pure black; it suits the painting), secondary `#3E4C57`, muted `#5F6B74`. All must hit ≥ 4.5:1 on the glass surfaces; verify by computing contrast against the glass colour composited over the poster behind it.
- Accent (CTA): a warm hibiscus red `#C8402F` with white text (check contrast ≥ 4.5:1; darken if needed). Hover: slightly darker, `translateY(-1px)`. Active: `scale(.98)`. Focus: a 2 px ring `#14212B` plus a 2 px offset.
- Secondary accent for links/chips: backwater teal `#1F6F78`.
- Glass: `rgba(255,251,242,0.72–0.82)` + `backdrop-filter: blur(14–16px) saturate(1.15)`, borders all round, soft shadow `0 8px 32px rgba(20,33,43,0.10)`. Provide a solid fallback (`@supports not (backdrop-filter: blur(1px))` → `rgba(255,251,242,0.94)`).
- No gradients on surfaces except: the hero text gradient (B5), the radial legibility glow behind the hero, and the scrim.
- Radius and spacing only from the skill tokens. Icons: Phosphor inline SVG (add `sun`, `moon` or `game-controller`, `github-logo` if missing, `arrow-down`, `list`, `x`).

---

## 5. Performance & accessibility

- The light chunk (JS) is loaded only in light mode; planck is loaded only in dark mode. Check the network panel: in light mode no `game-*.js`, and in dark mode no `bg.webm`/`bg.mp4`.
- The video is never the LCP blocker: the poster shows immediately; the video fades in on `canplay`.
- Skip link to `#main` works in both themes. Semantic landmarks are kept.
- 390 px wide: no horizontal overflow, CTA visible on the first screen.
- Meta: `og:image` can point to `light/poster.jpg` (absolute URL comes later with the domain; use a relative path and note it).

---

## 6. Verification before reporting

- `npm run build` with zero TS errors; `npx vitest run` all green.
- Use the browser pane, and screenshot each:
  1. light 1440×900 hero;
  2. light 1440×900 scrolled to projects;
  3. light 390×844 hero;
  4. light 390×844 menu open;
  5. toggle → dark: the table shows lights-off, START plays, then toggle back → light, then arrow keys scroll the page;
  6. reload in each theme: no flash of the other theme.
- Run a contrast check script for the hero text and card text (report the ratios).
- The dev server: run `npx vite --port 5174 --strictPort` inside `/home/dipu/Documents/Portfolio-Web/portfolio` (the browser pane's saved "portfolio" preview points at an old copy; don't use it). Stop it before you finish.
- Report: files changed, screenshots' observations, contrast numbers, bundle sizes per theme, anything skipped, and any copy that needs the owner's confirmation (e.g. the `{{availability}}` line).
