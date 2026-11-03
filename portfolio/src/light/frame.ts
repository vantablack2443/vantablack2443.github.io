/**
 * One passive scroll/resize listener that only schedules a requestAnimationFrame;
 * subscribers (scrim, tagline words, motes) run once per frame at most. Nothing
 * here does work on the raw scroll event.
 */

type Sub = (scrollY: number) => void;

const subs = new Set<Sub>();
let queued = 0;
let attached = false;

function run(): void {
  queued = 0;
  const y = window.scrollY;
  subs.forEach((cb) => cb(y));
}

function schedule(): void {
  if (!queued) queued = requestAnimationFrame(run);
}

export function onFrameScroll(cb: Sub): () => void {
  subs.add(cb);
  if (!attached) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    attached = true;
  }
  cb(window.scrollY);
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && attached) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      attached = false;
      if (queued) {
        cancelAnimationFrame(queued);
        queued = 0;
      }
    }
  };
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Data saver on: poster only, no video. */
export const saveData = (): boolean =>
  Boolean((navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData);

/** Pointer parallax only on devices with a real hover pointer. */
export const finePointer = (): boolean => matchMedia('(hover: hover) and (pointer: fine)').matches;
