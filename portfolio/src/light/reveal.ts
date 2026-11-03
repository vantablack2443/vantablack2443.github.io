import { onFrameScroll, reducedMotion } from './frame';

/**
 * Scroll reveals. Each section rises 32 px and fades in once (IntersectionObserver),
 * grid cards stagger 60 ms apart (capped at 400 ms). The tagline's words go from
 * 30% to full ink one at a time as they cross a trigger line (one rAF throttled
 * scroll handler). The CSS does the movement; here we only toggle classes.
 */

const SELECTORS = [
  '#projects > h2',
  '#projects .card',
  '#more-projects',
  '#sling-right',
  '#sling-left',
  '#skills',
  '#languages',
  '#contact',
  '#tagline-band',
  '#lfooter',
];

const STEP_MS = 60;
const CAP_MS = 400;

export class Reveals {
  private io: IntersectionObserver | null = null;
  private stops: Array<() => void> = [];

  start(): void {
    this.reveals();
    this.tagline();
  }

  private reveals(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const els = SELECTORS.flatMap((s) => Array.from(document.querySelectorAll<HTMLElement>(s)));
    const pending = els.filter((e) => !e.classList.contains('in'));
    pending.forEach((e) => e.classList.add('reveal'));
    this.io = new IntersectionObserver(
      (entries) => {
        const hits = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        hits.forEach((entry, k) => {
          const el = entry.target as HTMLElement;
          this.io?.unobserve(el);
          el.style.transitionDelay = `${Math.min(k * STEP_MS, CAP_MS)}ms`;
          // force a style flush so the transition starts from the hidden state
          void el.offsetWidth;
          el.classList.add('in');
          const done = (): void => {
            el.classList.add('done');
            el.style.transitionDelay = '';
          };
          const fallback = window.setTimeout(done, 700 + CAP_MS + 100);
          el.addEventListener(
            'transitionend',
            (ev) => {
              if (ev.target !== el || ev.propertyName !== 'opacity') return;
              window.clearTimeout(fallback);
              done();
            },
            { once: false },
          );
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    pending.forEach((e) => this.io!.observe(e));
  }

  private tagline(): void {
    const p = document.getElementById('tagline-text');
    if (!p) return;
    // wrap words once (idempotent); the text itself is untouched
    if (!p.querySelector('.w')) {
      p.querySelectorAll<HTMLElement>('.tl-line').forEach((line) => {
        const words = (line.textContent ?? '').trim().split(/\s+/);
        line.replaceChildren(
          ...words.flatMap((w, i) => {
            const span = document.createElement('span');
            span.className = 'w';
            span.textContent = w;
            return i < words.length - 1 ? [span, document.createTextNode(' ')] : [span];
          }),
        );
      });
    }
    const words = Array.from(p.querySelectorAll<HTMLElement>('.w'));
    if (reducedMotion()) {
      words.forEach((w) => w.classList.add('on'));
      return;
    }
    const update = (): void => {
      const trigger = window.innerHeight * 0.72;
      let k = 0;
      for (const w of words) {
        const on = w.getBoundingClientRect().top < trigger;
        if (on === w.classList.contains('on')) continue;
        // words that switch together go one after another, in reading order
        w.style.transitionDelay = on ? `${Math.min(k * 45, CAP_MS)}ms` : '0ms';
        if (on) k++;
        w.classList.toggle('on', on);
      }
    };
    this.stops.push(onFrameScroll(update));
  }

  stop(): void {
    this.io?.disconnect();
    this.io = null;
    this.stops.forEach((s) => s());
    this.stops = [];
  }
}
