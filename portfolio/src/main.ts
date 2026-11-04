import { applyDom, setLang, t } from './i18n';
import { Modal } from './modal';
import { prefersReducedMotion } from './motion';
import type { RiverGame } from './river';

/**
 * Bootstrap: language, theme, and wiring of the game.
 *
 * Two themes share one DOM:
 *   dark   "Lantern River", the night game. Its runtime (PixiJS and planck) lives in
 *          src/river/ and is loaded with a dynamic import, only when the dark theme is
 *          entered. The CV in #content is hidden in dark and is the text of the dock cards.
 *   light  "Backwaters", a scrolling page over a looping video. Its runtime
 *          lives in src/light/ and is dynamically imported the first time light
 *          mode is entered.
 * The head script in index.html always starts in light (the game is opt in, per
 * visit) and picks the language before paint; applyTheme / enterDark / enterLight
 * switch at runtime without a reload, setLang swaps the text the same way.
 */

type Theme = 'light' | 'dark';

const root = document.documentElement;
const THEME_COLOR: Record<Theme, string> = { light: '#EAF3FA', dark: '#02040C' };

let river: RiverGame | null = null;
let riverLoading: Promise<void> | null = null;
/** Bumped whenever the game is torn down, so an import that finishes late knows it is stale. */
let riverGen = 0;
let lightApi: { enterLight(): void; leaveLight(): void } | null = null;
let lightLoading: Promise<void> | null = null;

const getTheme = (): Theme => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/* ---------------- email: assembled in JS (light anti-scraper) ---------------- */

function mountEmail(): void {
  const user = ['dipu', 'balamurugan2k'].join('');
  const host = ['gmail', 'com'].join('.');
  const addr = `${user}@${host}`;
  document.querySelectorAll<HTMLAnchorElement>('a[data-mailto]').forEach((a) => {
    a.href = `mailto:${addr}`;
    a.hidden = false;
  });
  labelEmail();
  const slot = document.querySelector<HTMLElement>('#contact-email .email-slot');
  if (slot) {
    const a = document.createElement('a');
    a.href = `mailto:${addr}`;
    a.textContent = addr;
    slot.replaceChildren(a);
    $('contact-email')!.hidden = false;
  }
}

/** The accessible name of the email links follows the language. */
function labelEmail(): void {
  document.querySelectorAll<HTMLElement>('a[data-mailto]').forEach((a) => {
    a.setAttribute('aria-label', t('email.aria', 'Email Dipu'));
  });
}

/* ---------------- language ---------------- */

function wireLangSwitches(): void {
  document.querySelectorAll<HTMLElement>('.lang-switch [data-lang]').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang === 'de' ? 'de' : 'en'));
  });
  document.addEventListener('langchange', () => {
    labelEmail();
    setMeta(getTheme());
    modal.refresh();
  });
}

/* ---------------- modal (the dock card) ---------------- */

const modal = new Modal({
  // the night clock stops while a card is open; closing it casts off from the dock
  onOpen: () => river?.setPaused('modal', true),
  onClose: () => {
    river?.setPaused('modal', false);
    river?.castOff();
  },
});

/** The boat moored at a dock: show that project, built from the `.card` markup in #content. */
function openDock(cardId: string): void {
  const card = document.getElementById(cardId);
  if (card) modal.openFor(card);
}

/* ---------------- game boot ---------------- */

async function bootRiver(): Promise<void> {
  if (getTheme() !== 'dark' || river || riverLoading) return; // light mode never loads Pixi or planck
  const host = $('river-host');
  if (!host) return;
  const gen = riverGen;
  riverLoading = import('./river')
    .then(({ createRiver }) => createRiver({ host, onDock: openDock, isModalOpen: () => modal.isOpen }))
    .then((game) => {
      // the visitor may have switched to light while the chunk loaded
      if (gen !== riverGen || getTheme() !== 'dark') {
        game.dispose();
        return;
      }
      river = game;
      $<HTMLButtonElement>('r-start')?.removeAttribute('disabled');
    })
    .catch((err) => {
      // no WebGL, or the chunk failed: say so, and keep the way back to the site
      console.error('[portfolio] the river game failed to start', err);
      root.classList.add('river-failed');
    })
    .finally(() => {
      riverLoading = null;
    });
  await riverLoading;
}

/** Leaving dark: close any card, dispose the game (loop, listeners, audio, canvas). */
function teardownRiver(): void {
  riverGen++;
  modal.close();
  if (river) {
    river.endGame();
    river.dispose();
    river = null;
  }
  $<HTMLButtonElement>('r-start')?.setAttribute('disabled', '');
  root.classList.remove('river-failed');
}

/* ---------------- themes ---------------- */

function setMeta(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  document.title =
    theme === 'light'
      ? t('title.light', 'Dipu Balamurugan | Portfolio')
      : t('title.dark', 'Dipu Balamurugan | Lantern River');
}

function updateToggles(): void {
  const theme = getTheme();
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((b) => {
    // pressed = the mode this button switches to is the current one (so, never the case where it is visible)
    b.setAttribute('aria-pressed', String(b.dataset.target === theme));
  });
}

function enterDark(): void {
  lightApi?.leaveLight();
  root.classList.remove('light-failed');
  void bootRiver();
}

function enterLight(): void {
  teardownRiver();
  void bootLight();
}

async function bootLight(): Promise<void> {
  try {
    lightLoading ??= import('./light').then((m) => {
      lightApi = m;
    });
    await lightLoading;
    if (getTheme() === 'light') lightApi?.enterLight();
  } catch (err) {
    // the CSS alone is a complete page: poster background, everything visible
    lightLoading = null;
    root.classList.add('light-failed');
    console.error('[portfolio] light mode runtime failed to load', err);
  }
}

/** Swap the theme in the DOM, synchronously. */
function applyTheme(theme: Theme): void {
  root.setAttribute('data-theme', theme);
  setMeta(theme);
  if (theme === 'dark') enterDark();
  else enterLight();
  updateToggles();
}

function focusAfterSwitch(): void {
  const sel = getTheme() === 'dark' ? '#r-start:not(:disabled), #btn-back' : '.lnav-toggle, #lmenu-btn';
  const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.offsetParent !== null);
  el?.focus({ preventScroll: true });
}

function setTheme(next: Theme, refocus = false): void {
  if (next === getTheme()) return;
  const after = (): void => {
    // keyboard users keep a place to be; for a mouse click focus is left alone (a lingering focused
    // toggle would turn the next Space press, meant to scroll, into another switch)
    if (refocus) focusAfterSwitch();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const swap = (): void => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    applyTheme(next);
  };
  if (prefersReducedMotion()) {
    swap();
    after();
    return;
  }
  const vt = (
    document as Document & {
      startViewTransition?: (cb: () => void) => {
        ready: Promise<void>;
        updateCallbackDone: Promise<void>;
        finished: Promise<void>;
      };
    }
  ).startViewTransition;
  if (typeof vt === 'function') {
    const t = vt.call(document, swap);
    // a quick second switch skips the first transition: that is fine, not an error
    const quiet = (): void => undefined;
    t.ready.catch(quiet);
    t.updateCallbackDone.catch(quiet);
    void t.finished.catch(quiet).then(after);
    return;
  }
  // fallback: fade the page out, swap, fade back in (opacity only, base curve)
  root.classList.add('theme-fading');
  window.setTimeout(() => {
    swap();
    root.classList.add('theme-fading-in');
    root.classList.remove('theme-fading');
    window.setTimeout(() => root.classList.remove('theme-fading-in'), 300);
    after();
  }, 260);
}

function wireThemeToggles(): void {
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((b) => {
    b.addEventListener('click', (e) =>
      setTheme(b.dataset.target === 'light' ? 'light' : 'dark', (e as MouseEvent).detail === 0),
    );
  });
}

/* ---------------- init ---------------- */

function init(): void {
  if (!root.classList.contains('js')) root.classList.add('js'); // safety net if the inline script was blocked
  // first thing: the German text goes in before anything else runs, then the guard that hides the body lifts
  applyDom(document);
  setMeta(getTheme());
  root.classList.add('i18n-done');
  // the switch's first paint already shows the right language: its colour transition only runs from the next click on
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('i18n-ready')));
  mountEmail();
  wireLangSwitches();
  wireThemeToggles();
  updateToggles();

  if (getTheme() === 'light') void bootLight();
  else void bootRiver();
}

init();
