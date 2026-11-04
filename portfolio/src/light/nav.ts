import { t } from '../i18n';

/**
 * Floating nav: current section indicator (IntersectionObserver) and the mobile
 * menu (full height panel, links arrive 60 ms apart; the CSS does the motion).
 */

/** Page block id -> the nav link (data-section) it belongs to. Blocks that map to null clear the indicator. */
const SECTIONS: Record<string, string | null> = {
  hero: null,
  'tagline-band': null,
  projects: 'projects',
  'more-projects': 'projects',
  'sling-right': 'sling-right',
  'sling-left': 'sling-right', // education sits beside experience
  skills: 'skills',
  languages: 'skills',
  contact: 'contact',
};
const root = document.documentElement;

export class Nav {
  private io: IntersectionObserver | null = null;
  private io2: IntersectionObserver | null = null;
  private stops: Array<() => void> = [];
  private readonly bar = document.getElementById('lnav');
  private readonly btn = document.getElementById('lmenu-btn') as HTMLButtonElement | null;
  private readonly menu = document.getElementById('lmenu');

  start(): void {
    this.track();
    this.menuSetup();
  }

  private track(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.lnav-links a[data-section]'));
    const set = (id: string | null): void => {
      links.forEach((a) => {
        if (a.dataset.section === id) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });
    };
    // a thin band at 40 to 45 percent of the viewport decides which section is current
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) set(SECTIONS[e.target.id] ?? null);
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    Object.keys(SECTIONS)
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e)
      .forEach((e) => this.io!.observe(e));
    // the last section never reaches the band on a short page: the footer coming into view means Contact
    const footer = document.getElementById('lfooter');
    if (footer) {
      this.io2 = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) set('contact');
      });
      this.io2.observe(footer);
    }
  }

  private menuSetup(): void {
    const { bar, btn, menu } = this;
    if (!bar || !btn || !menu) return;
    const isOpen = (): boolean => bar.hasAttribute('data-open');
    const label = (): void => {
      btn.setAttribute('aria-label', isOpen() ? t('nav.closeMenu', 'Close menu') : t('nav.openMenu', 'Open menu'));
    };
    const open = (): void => {
      bar.setAttribute('data-open', '');
      menu.removeAttribute('inert');
      btn.setAttribute('aria-expanded', 'true');
      label();
      root.classList.add('menu-open');
      menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    };
    const close = (refocus = false): void => {
      bar.removeAttribute('data-open');
      menu.setAttribute('inert', '');
      btn.setAttribute('aria-expanded', 'false');
      label();
      root.classList.remove('menu-open');
      if (refocus) btn.focus({ preventScroll: true });
    };
    const onBtn = (): void => (isOpen() ? close() : open());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen()) close(true);
    };
    const onMenuClick = (e: Event): void => {
      // following a link, or switching theme from the panel, closes it
      if ((e.target as HTMLElement).closest('a, button')) close();
    };
    const onResize = (): void => {
      if (window.innerWidth >= 1000 && isOpen()) close();
    };
    btn.addEventListener('click', onBtn);
    menu.addEventListener('click', onMenuClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('langchange', label);
    this.stops.push(() => {
      document.removeEventListener('langchange', label);
      btn.removeEventListener('click', onBtn);
      menu.removeEventListener('click', onMenuClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      close();
    });
  }

  stop(): void {
    this.io?.disconnect();
    this.io = null;
    this.io2?.disconnect();
    this.io2 = null;
    this.stops.forEach((s) => s());
    this.stops = [];
  }
}
