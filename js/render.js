// Canvas compositor: draws layers, runs effect chains, applies blend modes.
import { valueAt } from './state.js';
import { FX, applyTransformEffects } from './effects.js';

export const BLEND_MODES = [
  ['normal', 'Normal', 'source-over'], ['add', 'Add', 'lighter'], ['screen', 'Screen', 'screen'], ['lighten', 'Lighten', 'lighten'],
  ['color-dodge', 'Dodge', 'color-dodge'], ['multiply', 'Multiply', 'multiply'], ['darken', 'Darken', 'darken'],
  ['color-burn', 'Burn', 'color-burn'], ['overlay', 'Overlay', 'overlay'], ['soft-light', 'Soft Light', 'soft-light'],
  ['hard-light', 'Hard Light', 'hard-light'], ['difference', 'Difference', 'difference'], ['exclusion', 'Exclusion', 'exclusion'],
  ['hue', 'Hue', 'hue'], ['saturation', 'Saturation', 'saturation'], ['color', 'Color', 'color'], ['luminosity', 'Luminosity', 'luminosity'],
  ['clip', 'Clip to Below', 'source-atop'], ['mask', 'Alpha Mask', 'destination-in'], ['cut', 'Cut Out', 'destination-out'],
];
const OPS = Object.fromEntries(BLEND_MODES.map(b => [b[0], b[2]]));

export const FONTS = {
  system: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  serif: '"New York", Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  condensed: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif',
  impact: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
  futura: 'Futura, "Century Gothic", "Trebuchet MS", sans-serif',
};

export const media = new Map(); // id -> { type, el, url }

export function evalTransform(L, t) {
  const tr = {};
  for (const p of ['x', 'y', 'scale', 'rotation', 'opacity']) tr[p] = valueAt(L, p, t);
  return applyTransformEffects(L, tr, t);
}

function gradient(ctx, w, h, c1, c2, angle) {
  const a = angle * Math.PI / 180, r = Math.hypot(w, h) / 2;
  const g = ctx.createLinearGradient(-Math.cos(a) * r, -Math.sin(a) * r, Math.cos(a) * r, Math.sin(a) * r);
  g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
}

function shapePath(ctx, s) {
  const w = s.w, h = s.h;
  ctx.beginPath();
  switch (s.kind) {
    case 'ellipse': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'ring': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.ellipse(0, 0, w / 2 * (1 - s.thickness), h / 2 * (1 - s.thickness), 0, Math.PI * 2, 0, true); break;
    case 'triangle': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); break;
    case 'star': case 'polygon': {
      const n = Math.max(3, Math.round(s.points)), star = s.kind === 'star', steps = star ? n * 2 : n;
      for (let i = 0; i < steps; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / steps, rr = star && i % 2 ? s.inner : 1;
        const x = Math.cos(a) * w / 2 * rr, y = Math.sin(a) * h / 2 * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); break;
    }
    case 'line': ctx.rect(-w / 2, -h / 2, w, h); break;
    default: {
      const r = Math.min(s.radius || 0, w / 2, h / 2);
      if (ctx.roundRect && r > 0) ctx.roundRect(-w / 2, -h / 2, w, h, r); else ctx.rect(-w / 2, -h / 2, w, h);
    }
  }
}

export function textLayout(ctx, tx) {
  const font = `${tx.italic ? 'italic ' : ''}${tx.weight} ${tx.size}px ${FONTS[tx.font] || FONTS.system}`;
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (tx.tracking * tx.size) + 'px';
  const lines = String(tx.content).split('\n');
  const widths = lines.map(l => ctx.measureText(l).width);
  const lh = tx.size * tx.lineHeight;
  return { font, lines, widths, lh, w: Math.max(1, ...widths), h: lh * lines.length };
}

// Local-space bounds (w,h centered at origin) for hit-testing / overlay
export function layerBounds(L, project, ctx) {
  switch (L.type) {
    case 'shape': return { w: L.shape.w, h: L.shape.h };
    case 'text': { const m = textLayout(ctx, L.text); return { w: m.w, h: m.h }; }
    case 'image': case 'video': return { w: L.media.w, h: L.media.h };
    default: return { w: project.w, h: project.h };
  }
}

function drawContent(ctx, L, project) {
  switch (L.type) {
    case 'solid': {
      const s = L.solid;
      ctx.fillStyle = s.gradient ? gradient(ctx, project.w, project.h, s.color, s.fill2, s.gradAngle) : s.color;
      ctx.fillRect(-project.w / 2, -project.h / 2, project.w, project.h); break;
    }
    case 'shape': {
      const s = L.shape; shapePath(ctx, s);
      if (s.fillOn) { ctx.fillStyle = s.gradient ? gradient(ctx, s.w, s.h, s.fill, s.fill2, s.gradAngle) : s.fill; ctx.fill('evenodd'); }
      if (s.strokeW > 0) { ctx.lineWidth = s.strokeW; ctx.strokeStyle = s.stroke; ctx.lineJoin = 'round'; ctx.stroke(); }
      break;
    }
    case 'text': {
      const tx = L.text, m = textLayout(ctx, tx);
      ctx.textBaseline = 'middle'; ctx.textAlign = tx.align;
      const x = tx.align === 'left' ? -m.w / 2 : tx.align === 'right' ? m.w / 2 : 0;
      m.lines.forEach((ln, i) => {
        const y = -m.h / 2 + m.lh * (i + 0.5);
        if (tx.strokeW > 0) { ctx.lineWidth = tx.strokeW; ctx.strokeStyle = tx.stroke; ctx.lineJoin = 'round'; ctx.strokeText(ln, x, y); }
        ctx.fillStyle = tx.fill; ctx.fillText(ln, x, y);
      });
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      break;
    }
    case 'image': case 'video': {
      const m = media.get(L.media.id);
      if (m && m.el && (m.type === 'image' ? m.el.complete : m.el.readyState >= 2)) ctx.drawImage(m.el, -L.media.w / 2, -L.media.h / 2, L.media.w, L.media.h);
      else { ctx.fillStyle = '#1b1d2a'; ctx.fillRect(-L.media.w / 2, -L.media.h / 2, L.media.w, L.media.h); }
      break;
    }
  }
}

export class Renderer {
  constructor() { this.fx = new FX(); this.layerCanvas = document.createElement('canvas'); this.tmp = document.createElement('canvas'); this.errors = []; }
  _size(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }

  render(project, t, target, { skipMediaSync = false } = {}) {
    const ctx = target.getContext('2d');
    const W = target.width, H = target.height, s = W / project.w;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = project.bg; ctx.fillRect(0, 0, W, H);
    const lc = this.layerCanvas; this._size(lc, W, H);
    const lctx = lc.getContext('2d');
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const L = project.layers[i];
      if (!L.visible || t < L.start || t >= L.end) continue;
      const tr = evalTransform(L, t);
      if (tr.opacity <= 0 && L.type !== 'adjust') continue;
      const op = OPS[L.blend] || 'source-over';
      const shaderFx = this.fx.ok && this.fx.hasShaderFx(L.effects);
      try {
        if (L.type === 'adjust') {
          if (!shaderFx) continue;
          this._size(this.tmp, W, H); const tctx = this.tmp.getContext('2d');
          tctx.clearRect(0, 0, W, H); tctx.drawImage(target, 0, 0);
          const out = this.fx.apply(this.tmp, L.effects, t, s);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity));
          ctx.globalCompositeOperation = op === 'source-over' ? 'source-atop' : op; ctx.drawImage(out, 0, 0);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          continue;
        }
        const drawTo = (c) => {
          c.setTransform(s, 0, 0, s, 0, 0);
          c.translate(tr.x, tr.y); c.rotate(tr.rotation * Math.PI / 180); c.scale(tr.scale, tr.scale);
          drawContent(c, L, project);
        };
        if (!shaderFx && op === 'source-over' && L.type !== 'text' && !(L.type === 'shape' && L.shape.strokeW > 0 && tr.opacity < 1)) {
          ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity)); drawTo(ctx); ctx.restore();
        } else {
          lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, W, H);
          lctx.save(); drawTo(lctx); lctx.restore();
          const src = shaderFx ? this.fx.apply(lc, L.effects, t, s) : lc;
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity)); ctx.globalCompositeOperation = op;
          ctx.drawImage(src, 0, 0); ctx.restore();
        }
      } catch (e) { if (this.errors.length < 20) this.errors.push(String(e)); console.error(e); }
    }
  }
}

// Keep <video> elements in step with the timeline.
export function syncVideos(project, t, playing) {
  for (const L of project.layers) {
    if (L.type !== 'video') continue;
    const m = media.get(L.media.id); if (!m || !m.el) continue;
    const v = m.el, active = L.visible && t >= L.start && t < L.end;
    const local = Math.max(0, t - L.start + (L.media.offset || 0));
    if (!active) { if (!v.paused) v.pause(); continue; }
    if (v.duration && local > v.duration) { if (!v.paused) v.pause(); continue; }
    if (playing) {
      if (Math.abs(v.currentTime - local) > 0.3) v.currentTime = local;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - local) > 0.04 && !v.seeking) v.currentTime = local;
    }
  }
}
