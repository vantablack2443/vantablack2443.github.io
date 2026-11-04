import { DE } from './de';

/**
 * English / German, no backend. English lives in index.html (and in the t() calls);
 * German is the flat dictionary in de.ts. The head script in index.html has already
 * put the chosen language on <html lang>; this module swaps the text.
 *
 * Markup attributes:
 *   data-i18n="key"                  replaces textContent
 *   data-i18n-html="key"             replaces innerHTML (inline markup only; our own strings, never user input)
 *   data-i18n-attr="attr:key; ..."   replaces attributes
 * The first time an element is translated its English is kept in a WeakMap, so
 * switching back restores it exactly. Text built in TS goes through t() and
 * re-renders on the `langchange` event.
 */

export type Lang = 'en' | 'de';

const KEY = 'lang';
const root = document.documentElement;

interface Original {
  text?: string;
  html?: string;
  attrs: Record<string, string | null>;
}
const originals = new WeakMap<Element, Original>();

export function getLang(): Lang {
  return root.lang === 'de' ? 'de' : 'en';
}

/** The text for `key` in the current language; English is the fallback passed by the caller. */
export function t(key: string, en: string): string {
  return getLang() === 'de' ? (DE[key] ?? en) : en;
}

function original(el: Element): Original {
  let o = originals.get(el);
  if (!o) {
    o = { attrs: {} };
    originals.set(el, o);
  }
  return o;
}

function translate(el: Element, lang: Lang): void {
  const key = el.getAttribute('data-i18n');
  if (key) {
    const o = original(el);
    if (lang === 'de') {
      if (o.text === undefined) o.text = el.textContent ?? '';
      if (DE[key] !== undefined) el.textContent = DE[key];
    } else if (o.text !== undefined) {
      el.textContent = o.text;
    }
  }
  const htmlKey = el.getAttribute('data-i18n-html');
  if (htmlKey) {
    const o = original(el);
    if (lang === 'de') {
      if (o.html === undefined) o.html = el.innerHTML;
      if (DE[htmlKey] !== undefined) el.innerHTML = DE[htmlKey];
    } else if (o.html !== undefined) {
      el.innerHTML = o.html;
    }
  }
  const attrSpec = el.getAttribute('data-i18n-attr');
  if (attrSpec) {
    const o = original(el);
    for (const pair of attrSpec.split(';')) {
      const [attr, attrKey] = pair.split(':').map((s) => s.trim());
      if (!attr || !attrKey) continue;
      if (lang === 'de') {
        if (!(attr in o.attrs)) o.attrs[attr] = el.getAttribute(attr);
        if (DE[attrKey] !== undefined) el.setAttribute(attr, DE[attrKey]);
      } else if (attr in o.attrs) {
        const en = o.attrs[attr];
        if (en === null) el.removeAttribute(attr);
        else el.setAttribute(attr, en);
      }
    }
  }
}

/** Translate everything marked up under `scope` (the whole document by default) into the current language. */
export function applyDom(scope: ParentNode = document): void {
  const lang = getLang();
  scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach((el) => translate(el, lang));
  syncSwitches();
}

/** Copies of translated markup (the dock dialog) are snapshots: they must not be translated again. */
export function stripI18n(scope: Element): void {
  scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach((el) => {
    el.removeAttribute('data-i18n');
    el.removeAttribute('data-i18n-html');
    el.removeAttribute('data-i18n-attr');
  });
}

/** Every EN | DE switch on the page shows the same pressed state. */
function syncSwitches(): void {
  const lang = getLang();
  document.querySelectorAll<HTMLElement>('.lang-switch [data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
}

/** Switch language: remember it, swap the text, tell the TS-built pieces to re-render. */
export function setLang(lang: Lang): void {
  if (lang === getLang()) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  root.lang = lang;
  applyDom(document);
  document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}
