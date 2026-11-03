/**
 * Light-only pieces of the shared CV markup: the Details toggle on each project
 * card and the Programming / Tools chip groups. Everything is derived from the
 * existing DOM (no second copy of the CV text) and is hidden in dark by CSS.
 */

const TOOLS = new Set(['Git', 'GitLab', 'Docker']);

export function enhanceContent(): void {
  cards();
  skills();
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
    label.textContent = 'Details';
    btn.append(label);
    btn.setAttribute('aria-label', `Details: ${name}`);
    btn.addEventListener('click', () => {
      const open = !card.classList.contains('is-open');
      card.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Hide details' : 'Details';
      btn.setAttribute('aria-label', `${open ? 'Hide details' : 'Details'}: ${name}`);
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
    .replace(/^\s*Also:\s*/i, '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const programming = [...main, ...also.filter((s) => !TOOLS.has(s))];
  const tools = also.filter((s) => TOOLS.has(s));

  const groups = document.createElement('div');
  groups.className = 'skill-groups light-only';
  for (const [title, items] of [
    ['Programming', programming],
    ['Tools', tools],
  ] as const) {
    if (!items.length) continue;
    const g = document.createElement('div');
    g.className = 'skill-group';
    const h = document.createElement('h3');
    h.textContent = title;
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
  host.querySelector('h2')?.after(groups);
}
