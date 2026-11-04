import { t } from '../i18n';

/**
 * Light-only pieces of the shared CV markup: the Details toggle on each project
 * card and the Programming / Tools chip groups. Everything is derived from the
 * existing DOM (no second copy of the CV text) and is hidden in dark by CSS.
 */

const TOOLS = new Set(['Git', 'GitLab', 'Docker']);

/** Labels built here are re-written when the language changes. */
const relabel: Array<() => void> = [];
let listening = false;

export function enhanceContent(): void {
  cards();
  skills();
  if (!listening) {
    listening = true;
    document.addEventListener('langchange', () => relabel.forEach((fn) => fn()));
  }
}

function cards(): void {
  document.querySelectorAll<HTMLElement>('#projects .card').forEach((card) => {
    if (card.querySelector('.card-toggle')) return;
    const list = card.querySelector<HTMLElement>('.detail ul');
    if (!list) return;
    list.id = `${card.id}-bullets`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost card-toggle light-only';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', list.id);
    const name = card.querySelector('.t')?.textContent?.trim() ?? 'project';
    const label = document.createElement('span');
    btn.append(label);
    const sync = (): void => {
      const open = card.classList.contains('is-open');
      const text = open ? t('card.hide', 'Hide details') : t('card.details', 'Details');
      label.textContent = text;
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', `${text}: ${name}`);
    };
    sync();
    relabel.push(sync);
    btn.addEventListener('click', () => {
      card.classList.toggle('is-open');
      sync();
    });
    const detail = card.querySelector('.detail');
    card.insertBefore(btn, detail);
  });
}

function skills(): void {
  const host = document.getElementById('skills');
  if (!host || host.querySelector('.skill-groups')) return;
  const main = Array.from(host.querySelectorAll('.bumper .lbl')).map((e) => (e.textContent ?? '').trim());
  const also = (document.getElementById('skills-also')?.textContent ?? '')
    .replace(/^[^:]*:\s*/, '') // the label in front ("Also:" / "Außerdem:")
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const programming = [...main, ...also.filter((s) => !TOOLS.has(s))];
  const tools = also.filter((s) => TOOLS.has(s));

  const groups = document.createElement('div');
  groups.className = 'skill-groups light-only';
  const titles = (): Record<'programming' | 'tools', string> => ({
    programming: t('skills.programming', 'Programming'),
    tools: t('skills.tools', 'Tools'),
  });
  const heads: Array<[HTMLElement, 'programming' | 'tools']> = [];
  for (const [which, items] of [
    ['programming', programming],
    ['tools', tools],
  ] as const) {
    if (!items.length) continue;
    const g = document.createElement('div');
    g.className = 'skill-group';
    const h = document.createElement('h3');
    h.textContent = titles()[which];
    heads.push([h, which]);
    const ul = document.createElement('ul');
    ul.className = 'chips';
    for (const it of items) {
      const li = document.createElement('li');
      li.textContent = it;
      ul.append(li);
    }
    g.append(h, ul);
    groups.append(g);
  }
  relabel.push(() => heads.forEach(([h, which]) => (h.textContent = titles()[which])));
  host.querySelector('h2')?.after(groups);
}
