# Phase 3: Quick fixes + English/German

Read with `PLAN.md`, `REDESIGN.md` and `LIGHT-MODE.md`. Where they disagree, this file wins. The design system is still `.claude/skills/landing-page-design/SKILL.md` (Part B; copy rules A5). The pinball game itself is out of scope (it will be replaced in a later phase): don't change physics, `layout.ts` or tests other than the new i18n test.

Project: `/home/dipu/Documents/Portfolio-Web/portfolio`. Git repo at the parent folder, deployed by GitHub Actions on push. **Do not commit or push.**

---

## 1. Always land on light mode

- The inline `<head>` script in `index.html` always sets `data-theme="light"` on page load. Stop reading `localStorage['theme']` and `prefers-color-scheme` there.
- `main.ts`: remove the `prefers-color-scheme` change listener in `wireThemeToggles()`, and stop writing `THEME_KEY` (remove the constant and the `persist` parameter of `setTheme` if nothing else needs them). Runtime switching to the arcade and back stays exactly as it works now.
- Reader mode persistence (`portfolio-mode`) inside dark stays as is.
- `og:title` becomes `Dipu Balamurugan | Portfolio`; check `og:description` and `meta description` describe the site (portfolio of a CS student), not just "a pinball table". No phone number anywhere.

## 2. Hero copy

- H1: **"Hey, I'm Dipu."** One line, keep the existing `hl` span and text gradient. Use a typographic apostrophe (’).
- Subheading (replaces the current one): "Computer science student in Saarbrücken. I build software from the processor up, with a focus on security, data networks and software engineering."
- Chip, CTAs, proof line unchanged.

## 3. Remove the Rust Book notes

Delete the `Rustbook-Notes` list item in the projects "More" list (around `index.html:402`). Search the whole project (`src/`, `index.html`, tests) for any other mention and remove it. The Django row stays.

## 4. Mode toggle in an obvious, consistent place

Both themes get the same **top-right cluster**: `[EN | DE]` language switch, then the mode button.

- **Light:** the floating nav becomes a bar across the content width (max 1120 px, centered, same cream glass): wordmark left, section links center, cluster right. The mode button reads **"Play the arcade"** (game-controller icon). Under the nav's mobile breakpoint: wordmark left, then the language switch and the menu button on the right; "Play the arcade" stays inside the menu panel. The footer toggle keeps working, also labelled "Play the arcade".
- **Dark (table and reader mode):** one fixed cluster at the top right (`#top-controls`, 16 px from the edges, above everything): language switch + a **filled** pill "Back to site" with the sun icon. Light cream fill `#FFFBF2`, ink text `#14212B`, height 40 px, Title-3/Body weight 600, full hover/active/focus states. It must be the most visible control on the page after Start.
  - Remove the old `#btn-theme` from the controls row and the separate `#theme-reader` button; this cluster replaces both.
  - Make room so it never covers the HUD (score boxes) or the name strip: reserve space at the top of the right panel on desktop, and in the name strip on narrow screens. Check at 1440×900, 1280×800, 1920×1080, 390×844.
- Keep `data-theme-toggle` / `data-target` so the existing wiring and `focusAfterSwitch()` work (update its selectors).

## 5. English / German

No backend; everything static.

### Language choice
- Head inline script: `lang = localStorage['lang']` if it is `en` or `de` (try/catch), else `de` when the first of `navigator.languages` (fallback `navigator.language`) starts with `de`, else `en`. Set `<html lang>` before paint.
- The switch: `role="group"` `aria-label` "Language" / "Sprache", two buttons `EN` and `DE` with `aria-pressed`, `lang` attributes on each (`lang="en"`, `lang="de"`), full states. Clicking saves `localStorage['lang']`, swaps text instantly (no reload, no view transition needed), updates `<html lang>`, `document.title`, `meta description`.
- **No flash of English for German visitors:** `main.ts` applies the dictionary synchronously as the first step of `init()`. As a guard, CSS hides the body with `opacity: 0` while `html[lang="de"]` lacks an `i18n-done` class, and the head script adds `i18n-done` after 1000 ms regardless (so a JS failure never leaves a blank page). Measure that German loads without a visible English frame.

### Mechanism (no duplicated English)
- English stays in `index.html` as now. German lives in `src/i18n/de.ts` as a flat `Record<string, string>` keyed by dot names (`hero.title`, `nav.projects`, `proj.orion.summary`, …).
- `src/i18n/index.ts`: `getLang()`, `setLang(lang)`, `t(key, en)` for strings created in TS, `applyDom(root)`, and a `langchange` event on `document`.
- Markup attributes:
  - `data-i18n="key"`: replaces `textContent`.
  - `data-i18n-html="key"`: replaces `innerHTML`, only for elements with inline markup (links, `<strong>`); dictionary strings are our own source code, never user input.
  - `data-i18n-attr="aria-label:key; title:key2"` for attributes.
  - The first time an element is translated, store its English (text/HTML/attribute) in a `WeakMap`, so switching back to English restores it exactly.
- Strings created in TS go through `t()` and re-render on `langchange`: card Details/Hide details labels and aria-labels (`light/content.ts`), menu open/close labels (`light/nav.ts`), email aria-label (`mountEmail`), mute button text and aria-label, the small-screen banner, the spotlight's idle "how to play" note, the modal close label, and the tagline word reveal (`light/reveal.ts` must re-split the words after a language change and keep the reveal state correct).
- **Out of scope:** canvas/lamp text and `game.say()` HUD messages stay English (the game is being replaced). List them in the report.
- Translate everything visible in both themes, including aria-labels, alt text, skip link, buttons, section headings, all CV content (projects, bullets, education, experience, skills group names, languages and levels), footer, and the page titles.

### German copy rules
- Natural, professional German for recruiters in Germany, not word for word. Sentence case per German rules (nouns capitalised). Avoid addressing the reader; where unavoidable use "Sie".
- Keep proper names, project names, tech names and "B.Sc. Informatik" as they are. "Saarland University" becomes "Universität des Saarlandes". "HiWi" stays. Standard terms: Werkstudentenstelle, Praktikum, Studienkolleg.
- Hero H1: "Hey, ich bin Dipu." Availability: "Offen für Werkstudentenstellen und Praktika in Deutschland."
- German is longer: check every button, chip, nav link and HUD label at 390 px and 1440 px for overflow or wrapping that breaks the layout.

### Test
Add `tests/i18n.test.ts`: read `index.html`, collect every key from `data-i18n`, `data-i18n-html`, `data-i18n-attr`, plus every `t('…'` key under `src/`; assert each exists in `de.ts`, and that `de.ts` has no unused keys.

---

## 6. Verification before reporting

- `npm run build` zero TS errors; `npx vitest run` all green.
- Dev server: `npx vite --port 5174 --strictPort` in the project folder (the pane's saved "portfolio" preview points at an old copy; don't use it). Stop it before you finish.
- Browser pane screenshots and checks:
  1. Fresh load with `localStorage` cleared: light mode, English. Set `localStorage.theme = 'dark'` and reload: still light.
  2. Light 1440×900 hero, EN and DE.
  3. Light 390×844 hero and menu open, DE (longest strings).
  4. Switch to the arcade: the cluster is top right, nothing overlaps at 1440×900, 1280×800, 390×844; "Back to site" returns to light; then arrow keys scroll the page.
  5. Language switch in the arcade works too; switching back to light keeps the language.
  6. Reload with `localStorage.lang = 'de'`: no English frame visible.
- No horizontal overflow at 390 px in either language.
- Report: files changed, the full German dictionary path, any strings left English and why, screenshot observations, anything skipped.
