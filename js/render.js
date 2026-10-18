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

// Polygon outline (local coords, centred) for every shape kind; curves are sampled. Used for drawing the polygonal
// kinds and for "Convert to points" (Edit Points).
export function shapePoints(s, n = 48) {
  const w = s.w, h = s.h, rx = w / 2, ry = h / 2, out = [];
  const polar = (fn, m = n, a0 = 0, a1 = Math.PI * 2, close = false) => { for (let i = 0; i < m + (close ? 1 : 0); i++) { const a = a0 + (a1 - a0) * i / m; const r = fn(a); out.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]); } };
  switch (s.kind) {
    case 'ellipse': case 'ring': polar(() => 1); break;
    case 'triangle': out.push([0, -ry], [rx, ry], [-rx, ry]); break;
    case 'star': case 'polygon': {
      const k = Math.max(3, Math.round(s.points)), star = s.kind === 'star', steps = star ? k * 2 : k;
      for (let i = 0; i < steps; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / steps, rr = star && i % 2 ? s.inner : 1; out.push([Math.cos(a) * rx * rr, Math.sin(a) * ry * rr]); }
      break;
    }
    case 'cross': { const tx = rx / 3, ty = ry / 3; out.push([-tx, -ry], [tx, -ry], [tx, -ty], [rx, -ty], [rx, ty], [tx, ty], [tx, ry], [-tx, ry], [-tx, ty], [-rx, ty], [-rx, -ty], [-tx, -ty]); break; }
    case 'arrow': out.push([-rx, -ry * 0.28], [rx * 0.15, -ry * 0.28], [rx * 0.15, -ry * 0.75], [rx, 0], [rx * 0.15, ry * 0.75], [rx * 0.15, ry * 0.28], [-rx, ry * 0.28]); break;
    case 'trapezoid': out.push([-rx * 0.55, -ry], [rx * 0.55, -ry], [rx, ry], [-rx, ry]); break;
    case 'pie': out.push([0, 0]); polar(() => 1, n, 0, Math.PI * 1.5, true); break;
    case 'half': polar(() => 1, n, Math.PI, Math.PI * 2, true); for (const p of out) p[1] += ry / 2; break;
    case 'flower': polar(a => 0.62 + 0.38 * Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), n * 2); break;
    case 'heart': for (let i = 0; i < n * 2; i++) { const t = i / (n * 2) * Math.PI * 2; const x = 16 * Math.sin(t) ** 3, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); out.push([x / 17 * rx, (y + 2.5) / 15 * ry]); } break;
    case 'path': for (const p of s.pts || []) out.push([p[0], p[1]]); break;
    case 'line': out.push([-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]); break;
    default: out.push([-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]);
  }
  return out;
}

function shapePath(ctx, s) {
  const w = s.w, h = s.h;
  ctx.beginPath();
  switch (s.kind) {
    case 'ellipse': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'ring': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.ellipse(0, 0, w / 2 * (1 - s.thickness), h / 2 * (1 - s.thickness), 0, Math.PI * 2, 0, true); break;
    case 'rect': case undefined: {
      const r = Math.min(s.radius || 0, w / 2, h / 2);
      if (ctx.roundRect && r > 0) ctx.roundRect(-w / 2, -h / 2, w, h, r); else ctx.rect(-w / 2, -h / 2, w, h);
      break;
    }
    default: {
      const pts = shapePoints(s);
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      if (s.kind !== 'path' || s.closed !== false) ctx.closePath();
    }
  }
}

// Freehand drawing strokes (local coords). Eraser strokes cut through the layer only (drawn on the layer canvas).
export const brushWidth = (st, project) => st.size * project.w / 540;
function drawStrokes(ctx, L, project) {
  for (const st of L.draw.strokes) {
    if (!st.pts.length) continue;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lw = brushWidth(st, project);
    ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = st.tool === 'eraser' ? '#000' : st.color;
    if (st.tool === 'brush') { ctx.globalAlpha *= 0.85; ctx.shadowColor = st.color; ctx.shadowBlur = lw * 0.6 * (ctx.getTransform().a || 1); }
    ctx.lineWidth = st.tool === 'brush' ? lw * 0.7 : lw;
    ctx.beginPath();
    if (st.pts.length === 1) { ctx.arc(st.pts[0][0], st.pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.moveTo(st.pts[0][0], st.pts[0][1]);
      for (let i = 1; i < st.pts.length - 1; i++) { const a = st.pts[i], b = st.pts[i + 1]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      const z = st.pts[st.pts.length - 1]; ctx.lineTo(z[0], z[1]); ctx.stroke();
    }
    ctx.restore();
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
    case 'shape': {
      if (L.shape.kind !== 'path') return { w: L.shape.w, h: L.shape.h };
      let mx = 1, my = 1; for (const p of L.shape.pts || []) { mx = Math.max(mx, Math.abs(p[0])); my = Math.max(my, Math.abs(p[1])); }
      return { w: mx * 2, h: my * 2 };
    }
    case 'audio': return { w: 0, h: 0 };
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
    case 'draw': drawStrokes(ctx, L, project); break;
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
      if (!L.visible || t < L.start || t >= L.end || L.type === 'audio') continue;
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
          if (L.shadow?.on && L.type !== 'adjust') { const sh = L.shadow, n = parseInt(sh.color.slice(1), 16); c.shadowColor = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${sh.alpha ?? 0.6})`; c.shadowBlur = sh.blur * s; c.shadowOffsetX = sh.dx * s; c.shadowOffsetY = sh.dy * s; }
          drawContent(c, L, project);
        };
        if (!shaderFx && op === 'source-over' && L.type !== 'text' && L.type !== 'draw' && !L.shadow?.on && !(L.type === 'shape' && L.shape.strokeW > 0 && tr.opacity < 1)) {
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
    if (L.type !== 'video' && L.type !== 'audio') continue;
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
