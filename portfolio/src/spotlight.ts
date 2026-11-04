import { stripI18n, t } from './i18n';
import { CARD_IDS } from './layout';

/**
 * Project spotlight (right panel). It shows the full detail of the card the
 * ball last hit, or the card the pointer or keyboard focus is on. Until a game
 * starts it shows a short "how to play" note, then cycles through the projects
 * every 6 seconds. All text is read from the real card markup in <main>.
 */

const CYCLE_MS = 6000;
const FADE_MS = 300;
const RUNNING = new Set(['LIGHTS_ON', 'PLUNGER', 'PLAYING', 'DRAINED']);

type Slot = 'howto' | (typeof CARD_IDS)[number];
const SLOTS: Slot[] = ['howto', ...CARD_IDS];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Spotlight {
  private readonly body: HTMLElement;
  private readonly stage: HTMLElement;
  private current: Slot | null = null;
  private lastTouch = 0; // time of the last hover / hit / focus
  private hovering = false;
  private swapTimer = 0;
  private cycleTimer = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(body: HTMLElement, stage: HTMLElement) {
    this.body = body;
    this.stage = stage;
    this.lastTouch = performance.now(); // the how-to note stays for a full cycle, also when the table is re-entered later
    this.render('howto');

    for (const id of CARD_IDS) {
      const card = document.getElementById(id);
      if (!card) continue;
      const on = (type: string, fn: () => void): void => {
        card.addEventListener(type, fn);
        this.disposers.push(() => card.removeEventListener(type, fn));
      };
      on('pointerenter', () => {
        this.hovering = true;
        this.show(id);
      });
      on('pointerleave', () => {
        this.hovering = false;
        this.lastTouch = performance.now();
      });
      on('focusin', () => this.show(id));
    }

    // the shown slot is rebuilt from the page text, which has just been translated
    const onLang = (): void => {
      window.clearTimeout(this.swapTimer);
      this.body.classList.remove('out');
      this.render(this.current ?? 'howto');
    };
    document.addEventListener('langchange', onLang);
    this.disposers.push(() => document.removeEventListener('langchange', onLang));

    this.cycleTimer = window.setInterval(() => this.tick(), 1000);
  }

  private get running(): boolean {
    return RUNNING.has(this.stage.getAttribute('data-state') ?? '');
  }

  /** The ball hit a card. */
  hit(id: string): void {
    this.show(id as Slot);
  }

  show(slot: Slot): void {
    this.lastTouch = performance.now();
    this.swap(slot);
  }

  private tick(): void {
    if (this.running || this.hovering || document.hidden) return;
    if (performance.now() - this.lastTouch < CYCLE_MS) return;
    const i = this.current ? SLOTS.indexOf(this.current) : -1;
    this.lastTouch = performance.now();
    this.swap(SLOTS[(i + 1) % SLOTS.length]);
  }

  /** Fade out, replace, fade in (opacity only). */
  private swap(slot: Slot): void {
    if (slot === this.current) return;
    window.clearTimeout(this.swapTimer);
    this.body.classList.add('out');
    this.swapTimer = window.setTimeout(() => {
      this.render(slot);
      this.body.classList.remove('out');
    }, FADE_MS);
  }

  private render(slot: Slot): void {
    this.current = slot;
    this.body.replaceChildren(slot === 'howto' ? this.howTo() : this.card(slot));
  }

  private howTo(): HTMLElement {
    const a = make('article', 'spot');
    a.append(make('h3', 'title-3', t('spot.howto', 'How to play')));
    const ul = make('ul', 'spot-list body-6');
    for (const line of [
      t('spot.howto.1', 'Press Start. The first ball launches itself.'),
      t('spot.howto.2', 'Flip with the arrow keys (or touch the lower half).'),
      t('spot.howto.3', 'Hit a project card and its full story appears here.'),
      t('spot.howto.4', 'Light all four language lanes to raise the bonus.'),
      t('spot.howto.5', 'Rather not play? Tap a card, or choose Read CV.'),
    ]) {
      ul.append(make('li', '', line));
    }
    a.append(ul);
    return a;
  }

  private card(id: string): HTMLElement {
    const src = document.getElementById(id);
    const a = make('article', 'spot');
    if (!src) return a;
    const name = src.querySelector('.t')?.textContent?.trim() ?? '';
    const sub = (src.querySelector('.sub')?.textContent ?? '').replace(/^[\s—-]+/, '').trim();
    a.dataset.neon = src.getAttribute('data-neon') ?? 'cyan';
    a.append(make('h3', 'title-2', name));
    if (sub) a.append(make('p', 'body-6 dim', sub));
    const stack = src.querySelector(':scope > .stack')?.textContent?.trim();
    if (stack) a.append(make('p', 'stack mono caption-4', stack));
    const list = src.querySelector('.detail ul');
    if (list) {
      const ul = list.cloneNode(true) as HTMLElement;
      ul.className = 'spot-list body-6';
      stripI18n(ul);
      a.append(ul);
    }
    const link = src.querySelector<HTMLAnchorElement>('.detail .links a');
    if (link) {
      const l = document.createElement('a');
      l.className = 'btn btn-ghost';
      l.href = link.href;
      l.rel = 'noopener';
      l.target = '_blank';
      l.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-github" /></svg>';
      l.append(t('spot.github', 'View on GitHub'));
      a.append(l);
    }
    return a;
  }

  dispose(): void {
    window.clearInterval(this.cycleTimer);
    window.clearTimeout(this.swapTimer);
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }
}
