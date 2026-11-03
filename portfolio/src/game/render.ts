import * as pl from 'planck';
import { BALL_R, LANE_FLOOR_Y, PLUNGER, STAGE_H, STAGE_W, toPx } from '../layout';
import type { StageMetrics } from '../stage';
import type { Flipper } from './flipper';
import type { Table } from './physics';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface DrawOptions {
  /** Lights are on: draw glowing, otherwise dull. */
  lit: boolean;
  debug: boolean;
}

/**
 * Canvas layer: ball, flippers, plunger, sparks and the `?debug` fixture
 * overlay. Drawing code works in LOGICAL units (600 x 940); the transform
 * maps them to the canvas's pixel resolution.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly table: Table;
  private scale = 1;
  private dpr = 1;
  private sparks: Spark[] = [];

  constructor(canvas: HTMLCanvasElement, table: Table) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.table = table;
  }

  resize(m: StageMetrics): void {
    this.scale = m.scale;
    this.dpr = m.dpr;
    this.canvas.width = Math.max(1, Math.round(STAGE_W * m.scale * m.dpr));
    this.canvas.height = Math.max(1, Math.round(STAGE_H * m.scale * m.dpr));
  }

  spark(x: number, y: number, color: string, n = 8, speed = 160): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.25,
        max: 0.6,
        color,
        size: 1.4 + Math.random() * 1.6,
      });
    }
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
  }

  clearSparks(): void {
    this.sparks.length = 0;
  }

  draw(dt: number, opt: DrawOptions): void {
    const ctx = this.ctx;
    const k = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    this.drawPlunger(ctx, opt.lit);
    this.drawFlipper(ctx, this.table.left, opt.lit);
    this.drawFlipper(ctx, this.table.right, opt.lit);
    this.drawSparks(ctx, dt);
    this.drawBall(ctx, opt.lit);
    if (opt.debug) this.drawDebug(ctx);
  }

  /* ---------------- parts ---------------- */

  private drawBall(ctx: CanvasRenderingContext2D, lit: boolean): void {
    const p = this.table.ballPos();
    if (!p) return;
    const [x, y] = p;
    const R = BALL_R;
    ctx.save();
    // soft shadow thrown towards the bottom of the table
    const sh = ctx.createRadialGradient(x + 2.5, y + 7, 1, x + 2.5, y + 7, R * 1.25);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(x + 2.5, y + 7, R * 1.25, R * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lit) {
      ctx.shadowColor = 'rgba(120,200,255,0.5)';
      ctx.shadowBlur = 9;
    }
    // chrome sphere
    const g = ctx.createRadialGradient(x - 3.6, y - 4.2, 0.6, x, y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.16, '#eef1f9');
    g.addColorStop(0.42, '#a3abc0');
    g.addColorStop(0.72, '#4f566b');
    g.addColorStop(1, '#171a26');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // reflected horizon: a darker band across the lower half, lighter underneath
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R - 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(10,12,24,0.38)';
    ctx.fillRect(x - R, y + 1.5, R * 2, 3.2);
    ctx.fillStyle = 'rgba(190,210,255,0.28)';
    ctx.fillRect(x - R, y + 6, R * 2, 4);
    ctx.restore();
    // specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(x - 3.7, y - 4.4, 2.5, 1.7, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper, lit: boolean): void {
    const def = f.def;
    const dir = def.side === 'left' ? 1 : -1;
    const pos = f.body.getPosition();
    const x = toPx(pos.x);
    const y = toPx(pos.y);
    const L = def.length;
    const rb = def.baseR;
    const rt = def.tipR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(f.body.getAngle());
    const outline = (): void => {
      ctx.beginPath();
      ctx.moveTo(0, -rb);
      ctx.lineTo(dir * L, -rt);
      ctx.arc(dir * L, 0, rt, -Math.PI / 2, Math.PI / 2, dir < 0);
      ctx.lineTo(0, rb);
      ctx.arc(0, 0, rb, Math.PI / 2, -Math.PI / 2, dir < 0);
      ctx.closePath();
    };
    // rubber edge
    if (lit) {
      ctx.shadowColor = f.held ? 'rgba(255,61,154,0.75)' : 'rgba(46,230,255,0.5)';
      ctx.shadowBlur = 9;
    }
    outline();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = lit ? '#c8374f' : '#6b2f3c';
    ctx.stroke();
    ctx.shadowBlur = 0;
    // body: a lit plastic / metal blade
    const g = ctx.createLinearGradient(0, -rb, 0, rb);
    g.addColorStop(0, lit ? '#f4f6ff' : '#a2a8c0');
    g.addColorStop(0.45, lit ? '#9aa2c8' : '#666c88');
    g.addColorStop(1, lit ? '#3d4468' : '#2d3350');
    ctx.fillStyle = g;
    outline();
    ctx.fill();
    // top highlight
    ctx.strokeStyle = lit ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(dir * rb * 0.6, -rb * 0.62);
    ctx.lineTo(dir * L * 0.9, -rt * 0.62);
    ctx.stroke();
    // lamp strip down the middle of the blade
    ctx.strokeStyle = f.held ? '#ff3d9a' : lit ? '#2ee6ff' : '#4a5173';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(dir * rb * 1.4, 1);
    ctx.lineTo(dir * L * 0.72, 0.6);
    ctx.stroke();
    // pivot cap
    const cap = ctx.createRadialGradient(-1, -1.5, 0.4, 0, 0, 5);
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.6, '#9ba2b8');
    cap.addColorStop(1, '#4a5066');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPlunger(ctx: CanvasRenderingContext2D, lit: boolean): void {
    const pl_ = this.table.plunger;
    const pull = pl_.pull;
    const cx = PLUNGER.x;
    const top = PLUNGER.restTop + pull;
    const bottom = top + PLUNGER.halfH * 2;
    ctx.save();
    // spring
    ctx.strokeStyle = lit ? '#8f8aae' : '#5d5972';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const coils = 7;
    const y0 = bottom;
    const y1 = LANE_FLOOR_Y - 2;
    ctx.moveTo(cx, y0);
    for (let i = 1; i <= coils; i++) {
      const yy = y0 + ((y1 - y0) * i) / coils;
      ctx.lineTo(cx + (i % 2 ? 9 : -9), yy - (y1 - y0) / coils / 2);
      ctx.lineTo(cx, yy);
    }
    ctx.stroke();
    // tip / knob
    const c = pl_.charge;
    ctx.fillStyle = lit ? `hsl(${42 - c * 36} 100% ${58 - c * 8}%)` : '#6f6a84';
    if (lit) {
      ctx.shadowColor = `hsl(${42 - c * 36} 100% 55%)`;
      ctx.shadowBlur = 10 + c * 10;
    }
    const w = PLUNGER.halfW * 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(cx - w / 2, top, w, PLUNGER.halfH * 2, 4);
    else ctx.rect(cx - w / 2, top, w, PLUNGER.halfH * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D, dt: number): void {
    if (!this.sparks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const alive: Spark[] = [];
    for (const s of this.sparks) {
      s.life -= dt;
      if (s.life <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 380 * dt;
      s.vx *= 0.985;
      const a = Math.max(0, s.life / s.max);
      ctx.globalAlpha = Math.min(1, a * 1.4);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      alive.push(s);
    }
    this.sparks = alive;
    ctx.restore();
  }

  /* ---------------- ?debug: draw every physics fixture ---------------- */

  private drawDebug(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineWidth = 1.25;
    for (let b = this.table.world.getBodyList(); b; b = b.getNext()) {
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        ctx.strokeStyle = f.isSensor() ? '#ffd400' : b.isDynamic() ? '#ff40ff' : '#00ff66';
        this.strokeShape(ctx, b, f);
      }
    }
    ctx.restore();
  }

  private strokeShape(ctx: CanvasRenderingContext2D, body: pl.Body, f: pl.Fixture): void {
    const shape = f.getShape();
    const P = (v: pl.Vec2): [number, number] => {
      const w = body.getWorldPoint(v);
      return [toPx(w.x), toPx(w.y)];
    };
    ctx.beginPath();
    switch (shape.getType()) {
      case 'circle': {
        const c = shape as pl.Circle;
        const [x, y] = P(c.getCenter());
        ctx.arc(x, y, toPx(c.getRadius()), 0, Math.PI * 2);
        break;
      }
      case 'polygon': {
        const poly = shape as pl.Polygon;
        const vs = poly.m_vertices;
        vs.forEach((v, i) => {
          const [x, y] = P(v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        break;
      }
      case 'edge': {
        const e = shape as pl.Edge;
        const [x1, y1] = P(e.m_vertex1);
        const [x2, y2] = P(e.m_vertex2);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        break;
      }
      case 'chain': {
        const ch = shape as pl.Chain;
        ch.m_vertices.forEach((v, i) => {
          const [x, y] = P(v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (ch.isLoop()) ctx.closePath();
        break;
      }
    }
    ctx.stroke();
  }
}
