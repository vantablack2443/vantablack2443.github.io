import { Background } from './background';
import { Buddy } from './buddy';
import { enhanceContent } from './content';
import { Motes } from './motes';
import { Nav } from './nav';
import { Reveals } from './reveal';

/**
 * Light theme runtime ("Backwaters"). Dynamically imported by main.ts the first
 * time light mode is entered, so dark-mode visitors never download it.
 * enterLight() / leaveLight() are idempotent; leaving removes the video, the
 * canvas and every listener.
 */

const root = document.documentElement;
const bg = new Background();
const motes = new Motes();
const reveals = new Reveals();
const nav = new Nav();
const buddy = new Buddy();

let active = false;
let motionMql: MediaQueryList | null = null;

function startAll(): void {
  enhanceContent();
  bg.start();
  motes.start();
  reveals.start();
  nav.start();
  buddy.start();
}

function stopAll(): void {
  bg.stop();
  motes.stop();
  reveals.stop();
  nav.stop();
  buddy.stop();
}

/** Reduced motion toggled while the page is open: rebuild with the new preference. */
const onMotionChange = (): void => {
  if (!active) return;
  stopAll();
  startAll();
};

export function enterLight(): void {
  if (active) return;
  active = true;
  startAll();
  root.classList.add('light-ready');
  motionMql = matchMedia('(prefers-reduced-motion: reduce)');
  motionMql.addEventListener('change', onMotionChange);
}

export function leaveLight(): void {
  if (!active) return;
  active = false;
  motionMql?.removeEventListener('change', onMotionChange);
  motionMql = null;
  stopAll();
  root.classList.remove('light-ready', 'menu-open');
}
