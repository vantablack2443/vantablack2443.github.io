import { applyDom, setLang, t } from './i18n';
import { Lights, prefersReducedMotion } from './lights';
import { Modal } from './modal';
import { buildBoard, buildRails } from './svg-rails';
import { Spotlight } from './spotlight';
import { positionElements, watchScale, metrics, type StageMetrics } from './stage';
import type { Game } from './game/game';

/**
 * Bootstrap: language, theme, reader/table mode, scaling, and wiring of the game.
 *
 * Two themes share one DOM:
 *   dark   the pinball table. The game (and planck) is loaded with a dynamic
 *          import, only when the dark theme is active and table mode is on.
 *   light  "Backwaters", a scrolling page over a looping video. Its runtime
 *          lives in src/light/ and is dynamically imported the first time light
 *          mode is entered.
 * The head script in index.html always starts in light (the arcade is opt in, per
 * visit) and picks the language before paint; applyTheme / enterDark / enterLight
 * switch at runtime without a reload, setLang swaps the text the same way.
 */

type Theme = 'light' | 'dark';

const root = document.documentElement;
const MODE_KEY = 'portfolio-mode';
const THEME_COLOR: Record<Theme, string> = { light: '#EAF3FA', dark: '#000000' };

let game: Game | null = null;
let gameLoading: Promise<void> | null = null;
let lights: Lights | null = null;
let spotlight: Spotlight | null = null;
let unwatch: (() => void) | null = null;
let latest: StageMetrics = metrics();
/** Bumped whenever the table is torn down, so a game import that finishes late knows it is stale. */
let tableGen = 0;
let lightApi: { enterLight(): void; leaveLight(): void } | null = null;
let lightLoading: Promise<void> | null = null;

const getTheme = (): Theme => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/* ---------------- email: assembled in JS (light anti-scraper) ---------------- */

function mountEmail(): void {
  const user = ['dipu', 'balamurugan2k'].join('');
  const host = ['gmail', 'com'].join('.');
  const addr = `${user}@${host}`;
  const link = $<HTMLAnchorElement>('link-email');
  if (link) {
    link.href = `mailto:${addr}`;
    link.hidden = false;
  }
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
  document.querySelectorAll<HTMLElement>('#link-email, a[data-mailto]').forEach((a) => {
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
  });
}

/* ---------------- modal ---------------- */

const modal = new Modal({
  onOpen: () => game?.setPaused('modal', true),
  onClose: () => game?.setPaused('modal', false),
});

function wireOpenButtons(): void {
  document.querySelectorAll<HTMLElement>('.card, .sling').forEach((obj) => {
    const btn = obj.querySelector<HTMLButtonElement>('button.open');
    const open = (): void => {
      if (!root.classList.contains('table')) return;
      if (game?.isRunning()) {
        game.say('TAP CARDS AFTER THE GAME, OR PRESS READ CV', 2600);
        return;
      }
      modal.openFor(obj, btn ?? undefined);
    };
    btn?.addEventListener('click', open);
  });
}

/* ---------------- table / reader mode ---------------- */

function setMode(mode: 'table' | 'reader', persist = true): void {
  if (getTheme() !== 'dark') return; // light mode is always the scrolling page
  if (persist) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }
  if (mode === 'reader') {
    game?.endGame();
    game?.setPaused('reader', true);
    lights?.reset();
    modal.close();
    root.classList.remove('table');
    updateBanner();
    window.scrollTo({ top: 0 });
    return;
  }
  root.classList.add('table');
  game?.setPaused('reader', false);
  void bootTable();
  updateBanner();
}

function updateBanner(): void {
  const banner = $('small-banner');
  if (!banner) return;
  banner.hidden = !(root.classList.contains('table') && document.documentElement.clientWidth < 380);
}

/* ---------------- table boot ---------------- */

/** The synchronous part: position the DOM, build the board, start the lights, spotlight and scale watcher. */
function setupTable(): void {
  const stage = $('stage')!;
  if (!lights) {
    positionElements();
    buildBoard(document.getElementById('board') as unknown as SVGSVGElement);
    buildRails(document.getElementById('rails') as unknown as SVGSVGElement);
    lights = new Lights(stage);
  }
  spotlight ??= new Spotlight($('spot-body')!, stage);
  unwatch ??= watchScale((m) => {
    latest = m;
    game?.resize(m);
    updateBanner();
  });
  root.classList.add('ready');
}

async function bootTable(): Promise<void> {
  if (!root.classList.contains('table')) return;
  if (getTheme() !== 'dark') return; // light mode never loads planck
  setupTable();
  const stage = $('stage')!;

  if (game) return;
  const gen = tableGen;
  gameLoading ??= import('./game/game').then(({ createGame }) => {
    // the visitor may have switched to light (or reader mode) while the chunk loaded
    if (gen !== tableGen || game || getTheme() !== 'dark') return;
    game = createGame({
      stage,
      canvas: $('game-canvas') as HTMLCanvasElement,
      lights: lights!,
      isModalOpen: () => modal.isOpen,
      metrics: latest,
      onCardHit: (id) => spotlight?.hit(id),
    });
  });
  await gameLoading;
}

/** Leaving dark: end the game, dispose it (loop, listeners, audio) and release the table's watchers. */
function teardownTable(): void {
  tableGen++;
  gameLoading = null;
  modal.close();
  if (game) {
    game.endGame();
    game.dispose();
    game = null;
  }
  lights?.reset();
  spotlight?.dispose();
  spotlight = null;
  unwatch?.();
  unwatch = null;
}

/* ---------------- themes ---------------- */

const readerPreferred = (): boolean => {
  try {
    return localStorage.getItem(MODE_KEY) === 'reader';
  } catch {
    return false;
  }
};

function setMeta(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  document.title =
    theme === 'light'
      ? t('title.light', 'Dipu Balamurugan | Portfolio')
      : t('title.dark', 'Dipu Balamurugan | Portfolio pinball table');
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
  if (readerPreferred()) root.classList.remove('table');
  else root.classList.add('table');
  updateBanner();
  void bootTable(); // its synchronous part positions the table before the next paint
}

function enterLight(): void {
  teardownTable();
  root.classList.remove('table', 'lit', 'flicker');
  updateBanner();
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
  const sel = getTheme() === 'dark' ? '#btn-back' : '.lnav-toggle, #lmenu-btn';
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

function ensureRailsContainer(): void {
  // the SVG layers are generated entirely from layout.ts: the PCB under the
  // objects (#board) and the hardware over them (#rails)
  const stage = document.getElementById('stage')!;
  const make = (id: string): void => {
    if (document.getElementById(id)) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = id;
    stage.append(svg);
  };
  make('board');
  make('rails');
  stage.insertBefore(document.getElementById('board')!, document.getElementById('content'));
}

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
  ensureRailsContainer();
  wireOpenButtons();
  wireThemeToggles();
  updateToggles();

  $('btn-reader')?.addEventListener('click', () => setMode('reader'));
  $('banner-read')?.addEventListener('click', () => setMode('reader'));
  $('to-table')?.addEventListener('click', () => setMode('table'));

  window.addEventListener('resize', updateBanner);
  if (getTheme() === 'light') void bootLight();
  else void bootTable();
  updateBanner();
  window.addEventListener('pagehide', () => unwatch?.());
}

init();
