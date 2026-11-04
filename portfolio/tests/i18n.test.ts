/**
 * Keeps the German dictionary and the page in sync: every key the markup or the TS code asks for
 * exists in src/i18n/de.ts, and de.ts has no key nobody uses.
 */
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import { DE } from '../src/i18n/de';

// every TS source under src/ except the dictionary itself, as text
const code = import.meta.glob<string>(['../src/**/*.ts', '!../src/i18n/de.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Keys the markup asks for: data-i18n, data-i18n-html and the `attr:key` pairs of data-i18n-attr. */
function markupKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.split(':')[1]?.trim();
      if (key) keys.add(key);
    }
  }
  return keys;
}

/** Keys the TS code asks for: t('key', 'English'). */
function codeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const text of Object.values(code)) {
    for (const m of text.matchAll(/(?<![\w$.])t\(\s*'([^']+)'/g)) keys.add(m[1]);
  }
  return keys;
}

describe('i18n', () => {
  const used = new Set([...markupKeys(), ...codeKeys()]);

  it('finds the keys it is meant to check', () => {
    expect(used.size).toBeGreaterThan(50);
  });

  it('has a German string for every key the page uses', () => {
    const missing = [...used].filter((k) => !(k in DE));
    expect(missing).toEqual([]);
  });

  it('has no unused German keys', () => {
    const unused = Object.keys(DE).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });

  it('has no empty German strings', () => {
    expect(Object.entries(DE).filter(([, v]) => !v.trim())).toEqual([]);
  });
});
