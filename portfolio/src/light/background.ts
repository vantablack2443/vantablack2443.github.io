import { finePointer, onFrameScroll, reducedMotion, saveData } from './frame';

/**
 * The painted backwater: a fixed layer (#lbg, poster as CSS background) with
 * the looping video on top, a white scrim that grows with scroll, and a tiny
 * pointer parallax. The poster alone is shown under reduced motion or data saver.
 */

const MAX_SHIFT = 10; // px
const SCRIM_MAX = 0.35;

export class Background {
  private readonly layer = document.getElementById('lbg');
  private video: HTMLVideoElement | null = null;
  private scrim: HTMLDivElement | null = null;
  private stops: Array<() => void> = [];
  private idleHandle = 0;
  private raf = 0;
  private cur = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };

  start(): void {
    if (!this.layer) return;
    this.scrim = document.createElement('div');
    this.scrim.id = 'lscrim';
    this.scrim.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.scrim);

    // scrim: opacity only, driven by scroll (rAF throttled)
    this.stops.push(
      onFrameScroll((y) => {
        const span = Math.max(1, window.innerHeight * 0.9);
        const t = Math.min(1, Math.max(0, y / span));
        if (this.scrim) this.scrim.style.opacity = String((t * SCRIM_MAX).toFixed(3));
      }),
    );

    const motion = !reducedMotion();
    if (motion && !saveData()) this.scheduleVideo();
    if (motion && finePointer()) this.bindParallax();

    const onVis = (): void => {
      const v = this.video;
      if (!v) return;
      if (document.hidden) v.pause();
      else void v.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    this.stops.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  /** Create the video once the page has settled, so the poster (not the video) is what the first paint waits for. */
  private scheduleVideo(): void {
    const go = (): void => {
      this.idleHandle = 0;
      this.createVideo();
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    const kick = (): void => {
      this.idleHandle = ric ? ric(go, { timeout: 1500 }) : window.setTimeout(go, 300);
    };
    if (document.readyState === 'complete') kick();
    else {
      window.addEventListener('load', kick, { once: true });
      this.stops.push(() => window.removeEventListener('load', kick));
    }
    this.stops.push(() => {
      if (!this.idleHandle) return;
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(this.idleHandle);
      else window.clearTimeout(this.idleHandle);
      this.idleHandle = 0;
    });
  }

  private createVideo(): void {
    if (!this.layer || this.video || document.getElementById('lbg')?.querySelector('video')) return;
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.disablePictureInPicture = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('disablepictureinpicture', '');
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.poster = 'light/poster.webp';
    v.preload = 'auto';
    for (const [src, type] of [
      ['light/bg.webm', 'video/webm'],
      ['light/bg.mp4', 'video/mp4'],
    ] as const) {
      const s = document.createElement('source');
      s.src = src;
      s.type = type;
      v.append(s);
    }
    const show = (): void => v.classList.add('on');
    v.addEventListener('canplay', show, { once: true });
    v.addEventListener('playing', show, { once: true });
    this.layer.append(v);
    this.video = v;
    if (!document.hidden) void v.play().catch(() => undefined); // autoplay blocked: the poster stays
  }

  private bindParallax(): void {
    const layer = this.layer;
    if (!layer) return;
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      this.target.x = -(e.clientX / window.innerWidth - 0.5) * 2 * MAX_SHIFT;
      this.target.y = -(e.clientY / window.innerHeight - 0.5) * 2 * MAX_SHIFT;
      if (!this.raf) this.raf = requestAnimationFrame(tick);
    };
    const tick = (): void => {
      this.raf = 0;
      this.cur.x += (this.target.x - this.cur.x) * 0.06;
      this.cur.y += (this.target.y - this.cur.y) * 0.06;
      layer.style.transform = `translate3d(${this.cur.x.toFixed(2)}px, ${this.cur.y.toFixed(2)}px, 0) scale(1.04)`;
      const settled = Math.abs(this.target.x - this.cur.x) < 0.05 && Math.abs(this.target.y - this.cur.y) < 0.05;
      if (!settled) this.raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    this.stops.push(() => window.removeEventListener('pointermove', onMove));
  }

  stop(): void {
    this.stops.forEach((s) => s());
    this.stops = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cur = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    if (this.layer) this.layer.style.transform = '';
    // dark mode must not keep decoding or downloading a video
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.querySelectorAll('source').forEach((s) => s.remove());
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this.scrim?.remove();
    this.scrim = null;
  }
}
