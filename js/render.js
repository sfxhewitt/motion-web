// Canvas compositor: draws layers, runs the WebGL effect chain, applies blend modes.
import { valueAt, evalNs, mediaTime } from './state.js';
import { loadProject } from './storage.js';
import { FXEngine, EFFECTS, activeFx, evalParams, isShaderFx, applyTransformEffects, applyTextEffects, shapeEffects } from './effects.js';

export const BLEND_MODES = [
  ['normal', 'Normal', 'source-over'], ['add', 'Add', 'lighter'], ['screen', 'Screen', 'screen'], ['lighten', 'Lighten', 'lighten'],
  ['color-dodge', 'Dodge', 'color-dodge'], ['multiply', 'Multiply', 'multiply'], ['darken', 'Darken', 'darken'],
  ['color-burn', 'Burn', 'color-burn'], ['overlay', 'Overlay', 'overlay'], ['soft-light', 'Soft Light', 'soft-light'],
  ['hard-light', 'Hard Light', 'hard-light'], ['difference', 'Difference', 'difference'], ['exclusion', 'Exclusion', 'exclusion'],
  ['hue', 'Hue', 'hue'], ['saturation', 'Saturation', 'saturation'], ['color', 'Color', 'color'], ['luminosity', 'Luminosity', 'luminosity'],
  ['clip', 'Clip to Below', 'source-atop'], ['mask', 'Alpha Mask', 'destination-in'], ['cut', 'Cut Out', 'destination-out'],
];
const OPS = Object.fromEntries(BLEND_MODES.map(b => [b[0], b[2]]));
const D = Math.PI / 180;

export const FONTS = {
  system: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  serif: '"New York", Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  condensed: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif',
  impact: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
  futura: 'Futura, "Century Gothic", "Trebuchet MS", sans-serif',
  avenir: '"Avenir Next", Avenir, "Segoe UI", sans-serif',
  gill: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif',
  optima: 'Optima, Candara, "Segoe UI", sans-serif',
  didot: 'Didot, "Bodoni 72", "Bodoni MT", Georgia, serif',
  baskerville: 'Baskerville, "Baskerville Old Face", Georgia, serif',
  typewriter: '"American Typewriter", "Courier New", Courier, monospace',
  script: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive',
  marker: '"Marker Felt", "Chalkboard SE", "Comic Neue", fantasy',
};
// imported fonts are stored as 'f:<id>' and registered as the FontFace family kf_<id>
export const fontStack = f => FONTS[f] || (String(f).startsWith('f:') ? `kf_${f.slice(2)}, ${FONTS.system}` : FONTS.system);

export const media = new Map(); // id -> { type, el, url }
let lastProject = null, lastT = 0;
const measureCtx = () => (measureCtx.c || (measureCtx.c = document.createElement('canvas').getContext('2d')));

// keyframed shape geometry (Width / Height / Corner etc. may be animated: rounded square -> circle morphs)
export function evalShape(L, t) { return evalNs(L, 'shape', t); }
// world-space outline of a layer (for Move Along Path / Repeat Along Path)
function pathOfLayer(project, id, t) {
  const L = project?.layers.find(l => l.id === id); if (!L || L.type !== 'shape') return null;
  const s = evalShape(L, t), pts = shapePoints(s, 96), m = layerMatrix(L, t, project);
  return { pts: pts.map(([px, py]) => { const q = m.transformPoint({ x: px, y: py }); return [q.x, q.y]; }), closed: s.kind !== 'path' || s.closed !== false };
}
function fxCtx(L, t, project, extra = {}) {
  return { t, lt: t - L.start, dur: Math.max(0.01, L.end - L.start), fps: project?.fps || 30, pathOf: project ? id => pathOfLayer(project, id, t) : null, ...extra };
}
export function evalTransform(L, t, project = lastProject) {
  const tr = { sx: 1, sy: 1 };
  for (const p of ['x', 'y', 'scale', 'rotation', 'opacity']) tr[p] = valueAt(L, p, t);
  if (!L.effects?.length) return tr;
  const b = L.type === 'shape' ? evalShape(L, t) : null;
  const c = fxCtx(L, t, project, { base: { x: tr.x, y: tr.y }, bh: b ? b.h : L.type === 'text' ? textLayout(measureCtx(), L.text).h : L.media ? L.media.h : project?.h || 0 });
  return applyTransformEffects(L, tr, t, c);
}
// local content coords -> composition coords:
// parent's matrix · T(x, y) · R(rotation) · S(scale · Scale X/Y · flips) · skew · T(-pivot)
// flip=false leaves flips out (selection box / handles stay upright). Parents never apply their flips to children.
export function layerMatrix(L, t, project = lastProject, flip = true, depth = 0) {
  const tr = evalTransform(L, t, project), v = p => valueAt(L, p, t);
  let m = new DOMMatrix().translate(tr.x, tr.y).rotate(tr.rotation)
    .scale(tr.scale * tr.sx * v('scaleX') * (flip && L.flipX ? -1 : 1), tr.scale * tr.sy * v('scaleY') * (flip && L.flipY ? -1 : 1));
  const sk = v('skew'); if (sk) m = m.skewX(sk);
  const ax = v('anchorX'), ay = v('anchorY'); if (ax || ay) m = m.translate(-ax, -ay);
  const par = L.parent && depth < 16 && project?.layers.find(l => l.id === L.parent);
  return par ? layerMatrix(par, t, project, false, depth + 1).multiply(m) : m;
}
export function evalText(L, t, project = lastProject) {
  const tx = { ...evalNs(L, 'text', t) };
  if (L.effects?.length) applyTextEffects(L, tx, t, fxCtx(L, t, project));
  return tx;
}

function gradient(ctx, w, h, c1, c2, angle) {
  const a = angle * Math.PI / 180, r = Math.hypot(w, h) / 2;
  const g = ctx.createLinearGradient(-Math.cos(a) * r, -Math.sin(a) * r, Math.cos(a) * r, Math.sin(a) * r);
  g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
}

// Vector path points are [x, y] (corner) or [x, y, hx, hy] (smooth: out-handle offset, the in-handle mirrors it).
// Smooth paths are sampled as cubic beziers; all-corner paths stay as their points.
export function pathSample(pts, closed, per = 16) {
  if (!pts.some(p => p.length > 2)) return pts.map(p => [p[0], p[1]]);
  const out = [], n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c1x = a[0] + (a[2] || 0), c1y = a[1] + (a[3] || 0), c2x = b[0] - (b[2] || 0), c2y = b[1] - (b[3] || 0);
    for (let j = 0; j < per; j++) {
      const u = j / per, v = 1 - u, A = v * v * v, B = 3 * v * v * u, C = 3 * v * u * u, D_ = u * u * u;
      out.push([A * a[0] + B * c1x + C * c2x + D_ * b[0], A * a[1] + B * c1y + C * c2y + D_ * b[1]]);
    }
  }
  if (!closed && n) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
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
    case 'path': out.push(...pathSample(s.pts || [], s.closed !== false)); break;
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
const plen = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
// sample a polyline into evenly spaced points (for tapered strokes)
function resample(pts, step) {
  const out = [pts[0].slice()]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); let d = step - acc;
    while (d <= l) { out.push([a[0] + (b[0] - a[0]) * d / l, a[1] + (b[1] - a[1]) * d / l]); d += step; } acc = (acc + l) % step; }
  const z = pts[pts.length - 1]; if (out.length < 2 || Math.hypot(out[out.length - 1][0] - z[0], out[out.length - 1][1] - z[1]) > 0.01) out.push(z.slice());
  return out;
}
// variable-width stroke along evenly spaced points: filled circles + quads between samples (smooth taper, no seams)
function taperPath(ctx, pts, w0, tap) {
  const n = pts.length - 1, mn = Math.max(0, Math.min(100, tap.min)) / 100;
  const wf = i => { const u = n ? i / n : 0; let f = 1; if (tap.start > 0) f = Math.min(f, u / (tap.start / 100)); if (tap.end > 0) f = Math.min(f, (1 - u) / (tap.end / 100)); f = Math.max(0, Math.min(1, f)); f = f * f * (3 - 2 * f); return (mn + (1 - mn) * f) * w0 / 2; };
  ctx.beginPath();
  for (let i = 0; i <= n; i++) { const r = wf(i); if (r > 0.05) { ctx.moveTo(pts[i][0] + r, pts[i][1]); ctx.arc(pts[i][0], pts[i][1], r, 0, Math.PI * 2); } }
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, ra = wf(i), rb = wf(i + 1);
    ctx.moveTo(a[0] + nx * ra, a[1] + ny * ra); ctx.lineTo(b[0] + nx * rb, b[1] + ny * rb); ctx.lineTo(b[0] - nx * rb, b[1] - ny * rb); ctx.lineTo(a[0] - nx * ra, a[1] - ny * ra); ctx.closePath(); }
  ctx.fill('nonzero');
}
// Freehand drawing strokes (local coords). Eraser strokes cut through the layer only (drawn on the layer canvas).
// sfx: { drawprogress: {start,end}, stroketaper: {start,end,min} } evaluated shape effects
function drawStrokes(ctx, L, project, sfx) {
  const prog = sfx?.drawprogress, tap = sfx?.stroketaper;
  const strokes = L.draw.strokes.filter(st => st.pts.length);
  const lens = strokes.map(st => plen(st.pts)), total = lens.reduce((a, b) => a + b, 0) || 1;
  let a0 = 0, a1 = total;
  if (prog) { const s0 = Math.max(0, Math.min(100, prog.start)), s1 = Math.max(0, Math.min(100, prog.end)); a0 = Math.min(s0, s1) / 100 * total; a1 = Math.max(s0, s1) / 100 * total; }
  let acc = 0;
  strokes.forEach((st, si) => {
    const len = lens[si], from = acc, to = acc + len; acc = to;
    if (prog && (to < a0 || from > a1 || a1 - a0 <= 0)) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lw = brushWidth(st, project);
    ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = st.tool === 'eraser' ? '#000' : st.color;
    if (st.tool === 'brush') { ctx.globalAlpha *= 0.85; ctx.shadowColor = st.color; ctx.shadowBlur = lw * 0.6 * (ctx.getTransform().a || 1); }
    ctx.lineWidth = st.tool === 'brush' ? lw * 0.7 : lw;
    let pts = st.pts;
    if (st.tool === 'smudge') { // drag the pixels under the brush along the stroke (reads what this layer drew so far)
      const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1, r = lw / 2, R = r * k, sp = resample(pts, Math.max(1, r * 0.25));
      for (let i = 1; i < sp.length; i++) {
        const a = m.transformPoint({ x: sp[i - 1][0], y: sp[i - 1][1] }), b = sp[i];
        ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.globalAlpha = 0.65;
        ctx.beginPath(); ctx.arc(b[0], b[1], r, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(ctx.canvas, a.x - R, a.y - R, 2 * R, 2 * R, b[0] - r, b[1] - r, 2 * r, 2 * r); ctx.restore();
      }
      ctx.restore(); return;
    }
    if (pts.length === 1) { if (!prog || a1 > from) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); return; }
    if (prog || tap) pts = resample(pts, Math.max(0.5, Math.min(lw * 0.25, len / 400)));
    if (prog) { const n = pts.length - 1, u0 = Math.max(0, (a0 - from) / len), u1 = Math.min(1, (a1 - from) / len); pts = pts.slice(Math.floor(u0 * n), Math.ceil(u1 * n) + 1); if (pts.length < 2) { ctx.restore(); return; } }
    if (tap && (tap.start > 0 || tap.end > 0)) {
      taperPath(ctx, pts, ctx.lineWidth, tap);
    } else {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      if (prog) for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      else { for (let i = 1; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); } const z = pts[pts.length - 1]; ctx.lineTo(z[0], z[1]); }
      ctx.stroke();
    }
    ctx.restore();
  });
}

export function textLayout(ctx, tx) {
  const font = `${tx.italic ? 'italic ' : ''}${tx.weight} ${tx.size}px ${fontStack(tx.font)}`;
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (tx.tracking * tx.size) + 'px';
  const lines = String(tx.content).split('\n');
  const widths = lines.map(l => ctx.measureText(l).width);
  const lh = tx.size * tx.lineHeight;
  return { font, lines, widths, lh, w: Math.max(1, ...widths), h: lh * lines.length };
}

// Local-space bounds (w,h centered at origin) for hit-testing / overlay
export function layerBounds(L, project, ctx, t) {
  switch (L.type) {
    case 'shape': {
      if (L.shape.kind !== 'path') { const s = evalShape(L, t ?? lastT); return { w: s.w, h: s.h }; }
      let mx = 1, my = 1; for (const p of L.shape.pts || []) { mx = Math.max(mx, Math.abs(p[0])); my = Math.max(my, Math.abs(p[1])); }
      return { w: mx * 2, h: my * 2 };
    }
    case 'audio': return { w: 0, h: 0 };
    case 'text': { const m = textLayout(ctx || measureCtx(), t != null ? evalText(L, t, project) : L.text); return { w: m.w, h: m.h }; }
    case 'image': case 'video': return { w: L.media.w, h: L.media.h };
    case 'null': case 'camera': return { w: 120, h: 120 };
    case 'comp': { const sub = compProject(L.comp.id); return sub ? { w: sub.w, h: sub.h } : { w: 100, h: 100 }; }
    case 'group': { // members' corners in the group's local space (the box stays centred on the group's origin)
      const tt = t ?? lastT, inv = layerMatrix(L, tt, project).inverse(); let mx = 60, my = 60;
      for (const m of project.layers) if (m.group === L.id && m.type !== 'audio' && m.type !== 'group') {
        const b = layerBounds(m, project, ctx, tt), mm = inv.multiply(layerMatrix(m, tt, project));
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = mm.transformPoint({ x: x * b.w / 2, y: y * b.h / 2 }); mx = Math.max(mx, Math.abs(q.x)); my = Math.max(my, Math.abs(q.y)); }
      }
      return { w: Math.min(mx * 2, project.w * 4), h: Math.min(my * 2, project.h * 4) };
    }
    default: return { w: project.w, h: project.h };
  }
}

function shapePerimeter(s) {
  if (s.kind === 'ellipse' || s.kind === 'ring') { const a = s.w / 2, b = s.h / 2, h = ((a - b) / (a + b || 1)) ** 2; return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h))); }
  if (s.kind === 'rect' || s.kind === undefined) { const r = Math.min(s.radius || 0, s.w / 2, s.h / 2); return 2 * (s.w + s.h) - (8 - 2 * Math.PI) * r; }
  const p = shapePoints(s, 96); return plen(p) + (s.kind !== 'path' || s.closed !== false ? Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) : 0);
}
// ev: { shape, tx, sfx } = evaluated (keyframed / effect-modified) content for this frame
function drawContent(ctx, L, project, ev = {}) {
  switch (L.type) {
    case 'comp': { const sub = compProject(L.comp.id); if (ev.gimg && sub) ctx.drawImage(ev.gimg, -sub.w / 2, -sub.h / 2, sub.w, sub.h); break; }
    case 'group': { // members were rendered in composition space (they inherit the group's transform as their parent)
      if (!ev.gimg) break;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ev.gimg, 0, 0); ctx.restore(); break;
    }
    case 'solid': {
      const s = ev.solid || L.solid;
      ctx.fillStyle = s.gradient ? gradient(ctx, project.w, project.h, s.color, s.fill2, s.gradAngle) : s.color;
      ctx.fillRect(-project.w / 2, -project.h / 2, project.w, project.h); break;
    }
    case 'shape': {
      const s = ev.shape || L.shape, prog = ev.sfx?.drawprogress; shapePath(ctx, s);
      if (prog) {
        // Draw Progress: trace the outline, fill fades in as the outline closes
        const per = shapePerimeter(s), s0 = Math.max(0, Math.min(100, Math.min(prog.start, prog.end))) / 100, s1 = Math.max(0, Math.min(100, Math.max(prog.start, prog.end))) / 100;
        const done = s1 - s0, fa = prog.fill ? Math.max(0, Math.min(1, (done - 0.85) / 0.15)) : 0;
        if (s.fillOn && fa > 0) { ctx.save(); ctx.globalAlpha *= fa; ctx.fillStyle = s.gradient ? gradient(ctx, s.w, s.h, s.fill, s.fill2, s.gradAngle) : s.fill; ctx.fill('evenodd'); ctx.restore(); }
        if (done > 0) { ctx.lineWidth = s.strokeW > 0 ? s.strokeW : Math.max(3, Math.min(s.w, s.h) * 0.05); ctx.strokeStyle = s.strokeW > 0 ? s.stroke : s.fill; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.setLineDash([per * done, per * 2]); ctx.lineDashOffset = -per * s0; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; }
        break;
      }
      if (s.fillOn) { ctx.fillStyle = s.gradient ? gradient(ctx, s.w, s.h, s.fill, s.fill2, s.gradAngle) : s.fill; ctx.fill('evenodd'); }
      const tap = ev.sfx?.stroketaper;
      if (s.strokeW > 0 && tap && (tap.start > 0 || tap.end > 0)) {
        const p0 = shapePoints(s, 160), closed = s.kind !== 'path' || s.closed !== false; if (closed) p0.push(p0[0].slice());
        ctx.fillStyle = s.stroke; taperPath(ctx, resample(p0, Math.max(0.5, s.strokeW * 0.25)), s.strokeW, tap);
      } else if (s.strokeW > 0) { ctx.lineWidth = s.strokeW; ctx.strokeStyle = s.stroke; ctx.lineJoin = 'round'; ctx.stroke(); }
      break;
    }
    case 'text': {
      const tx = ev.tx || L.text, m = textLayout(ctx, tx);
      ctx.textBaseline = 'middle';
      if (!tx.alpha && !tx.chars) {
        ctx.textAlign = tx.align;
        const x = tx.align === 'left' ? -m.w / 2 : tx.align === 'right' ? m.w / 2 : 0;
        m.lines.forEach((ln, i) => {
          const y = -m.h / 2 + m.lh * (i + 0.5);
          if (tx.strokeW > 0) { ctx.lineWidth = tx.strokeW; ctx.strokeStyle = tx.stroke; ctx.lineJoin = 'round'; ctx.strokeText(ln, x, y); }
          ctx.fillStyle = tx.fill; ctx.fillText(ln, x, y);
        });
      } else {
        // per-character drawing (Text Progress / Text Transform)
        ctx.textAlign = 'left'; let gi = 0; const base = ctx.globalAlpha;
        m.lines.forEach((ln, li) => {
          const y = -m.h / 2 + m.lh * (li + 0.5), lw = m.widths[li];
          const x0 = tx.align === 'left' ? -m.w / 2 : tx.align === 'right' ? m.w / 2 - lw : -lw / 2;
          let prefix = '';
          for (const ch of ln) {
            const px = prefix ? ctx.measureText(prefix).width : 0, cw = ctx.measureText(ch).width; prefix += ch;
            const T = tx.chars?.[gi], a = (tx.alpha ? tx.alpha[gi] ?? 1 : 1) * (T ? T.op : 1); gi++;
            if (a <= 0.002 || ch === ' ') continue;
            ctx.save(); ctx.globalAlpha = base * Math.min(1, a);
            ctx.translate(x0 + px + cw / 2 + (T?.dx || 0), y + (T?.dy || 0)); if (T) { ctx.rotate((T.rot || 0) * D); ctx.scale(T.sc ?? 1, T.sc ?? 1); }
            if (tx.strokeW > 0) { ctx.lineWidth = tx.strokeW; ctx.strokeStyle = tx.stroke; ctx.lineJoin = 'round'; ctx.strokeText(ch, -cw / 2, 0); }
            ctx.fillStyle = tx.fill; ctx.fillText(ch, -cw / 2, 0); ctx.restore();
          }
          gi++; // the newline
        });
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      break;
    }
    case 'draw': drawStrokes(ctx, L, project, ev.sfx); break;
    case 'image': case 'video': {
      const m = media.get(L.media.id);
      if (m && m.el && (m.type === 'image' ? (m.el.complete ?? true) : m.el.readyState >= 2)) ctx.drawImage(m.el, -L.media.w / 2, -L.media.h / 2, L.media.w, L.media.h);
      else { ctx.fillStyle = '#1b1d2a'; ctx.fillRect(-L.media.w / 2, -L.media.h / 2, L.media.w, L.media.h); }
      break;
    }
  }
}

// ---- 3D layers: each layer is a plane; its 2D composition-space content is tilted (Rotate X / Y about its pivot), pushed
// back by Z and seen through the camera (or a default one), then drawn as a perspective-warped triangle mesh ----
export function camera3d(project, t) {
  const C = project.layers.find(l => l.type === 'camera' && l.visible && t >= l.start && t < l.end), v = p => valueAt(C, p, t);
  const f = Math.hypot(project.w, project.h) * 1.2 * (C ? v('zoom') : 1);
  return C ? { x: v('x'), y: v('y'), z: v('z'), roll: v('rotation') * D, f, w: project.w, h: project.h } : { x: project.w / 2, y: project.h / 2, z: 0, roll: 0, f, w: project.w, h: project.h };
}
const is3d = L => !!L.is3d && L.type !== 'camera' && L.type !== 'adjust';
// composition point (x, y) of a 3D layer -> projected composition point, or null behind the camera
export function project3d(L, t, project, cam = camera3d(project, t)) {
  const piv = layerMatrix(L, t, project).transformPoint({ x: valueAt(L, 'anchorX', t), y: valueAt(L, 'anchorY', t) });
  const ax = valueAt(L, 'rotX', t) * D, ay = valueAt(L, 'rotY', t) * D, z0 = valueAt(L, 'z', t);
  const ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay), cr = Math.cos(-cam.roll), sr = Math.sin(-cam.roll);
  return (x, y) => {
    let vx = x - piv.x, vy = y - piv.y, vz = 0;
    [vy, vz] = [vy * ca - vz * sa, vy * sa + vz * ca];   // tilt about X
    [vx, vz] = [vx * cb + vz * sb, -vx * sb + vz * cb];  // turn about Y
    let X = piv.x + vx - cam.x, Y = piv.y + vy - cam.y; const Z = vz + z0 - cam.z + cam.f;
    if (Z < 1) return null;
    [X, Y] = [X * cr - Y * sr, X * sr + Y * cr];
    return [cam.w / 2 + X * cam.f / Z, cam.h / 2 + Y * cam.f / Z];
  };
}
// nested projects (Element / Project layers): read from storage at most every 1.5 s
const compCache = new Map();
export function compProject(id) {
  const c = compCache.get(id), now = performance.now();
  if (c && now - c.at < 1500) return c.p;
  const p = loadProject(id); compCache.set(id, { p, at: now }); return p;
}
const NOT_TEX = new Set(['path']); // layer params that are paths, not texture sources
export class Renderer {
  constructor() { this.layerCanvas = document.createElement('canvas'); this.tmp = document.createElement('canvas'); this.tmp2 = document.createElement('canvas'); this.refs = {}; this.errors = []; this._fx = null; }
  get fx() { return this._fx || (this._fx = new FXEngine()); } // lazy: one WebGL context per renderer, only when an effect needs it
  _size(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }

  render(project, t, target, { skipMediaSync = false, transparent = false } = {}) {
    lastProject = project; lastT = t; this.project = project;
    const ctx = target.getContext('2d');
    const W = target.width, H = target.height, s = W / project.w;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (transparent) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = project.bg; ctx.fillRect(0, 0, W, H); }
    this._size(this.layerCanvas, W, H);
    this._stack(ctx, project.layers.filter(L => !L.group), t, s, W, H, project, 0);
    lastProject = project; lastT = t; // a nested project's render may have replaced them
  }
  // composite a list of layers (top first) onto ctx; a group renders its members into its own canvas first
  _stack(ctx, Ls, t, s, W, H, project, depth) {
    const live = L => L.visible && t >= L.start && t < L.end && L.type !== 'audio' && L.type !== 'null' && L.type !== 'camera';
    const canClip = L => L.type !== 'adjust' && L.type !== 'audio' && L.type !== 'null';
    const pool = this.pool || (this.pool = []);
    const canvasAt = k => { const c = pool[k] || (pool[k] = document.createElement('canvas')); this._size(c, W, H);
      const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H); return x; };
    const draw = (x, L, op) => {
      if (L.type === 'comp') { // render the nested project at the layer's local time, at this output's pixel density
        const sub = compProject(L.comp.id); if (!sub || (this.nest || 0) > 3) return;
        const r = (this.subs || (this.subs = {}))[L.id] || (this.subs[L.id] = new Renderer()); r.nest = (this.nest || 0) + 1;
        const c = r.out || (r.out = document.createElement('canvas')); r._size(c, Math.max(2, Math.round(sub.w * s)), Math.max(2, Math.round(sub.h * s)));
        const lt = (t - L.start) * (L.comp.speed || 1) + (L.comp.offset || 0);
        r.render(sub, sub.loop === false ? Math.min(lt, sub.duration - 1e-3) : ((lt % sub.duration) + sub.duration) % sub.duration, c, { skipMediaSync: true, transparent: !L.comp.bg });
        (this.gimg || (this.gimg = {}))[L.id] = c;
      }
      if (L.type === 'group') {
        if (depth > 8) return;
        const gx = canvasAt(depth * 2 + 1);
        this._stack(gx, project.layers.filter(m => m.group === L.id), t, s, W, H, project, depth + 1);
        (this.gimg || (this.gimg = {}))[L.id] = gx.canvas;
      }
      this._layer(x, L, t, s, W, H, op, project);
    };
    for (let i = Ls.length - 1; i >= 0; i--) {
      const L = Ls[i];
      // clipping mask: the run of `clip` layers directly above L is drawn only where L is (L masks them)
      const clipped = [];
      if (canClip(L)) for (let j = i - 1; j >= 0 && Ls[j].clip && canClip(Ls[j]); j--) clipped.push(Ls[j]);
      if (clipped.length) {
        i -= clipped.length;
        if (!live(L)) continue; // hidden / inactive mask -> nothing of the group shows
        const gctx = canvasAt(depth * 2);
        draw(gctx, L, 'source-over');
        for (const C of clipped) if (live(C)) draw(gctx, C, 'source-atop');
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = OPS[L.blend] || 'source-over'; ctx.drawImage(gctx.canvas, 0, 0); ctx.restore();
        continue;
      }
      if (!live(L)) continue;
      draw(ctx, L, OPS[L.blend] || 'source-over');
    }
  }
  // draw a full-frame layer canvas onto ctx through its 3D projection (N×N mesh of affine triangles over the layer's box)
  _warp3d(ctx, src, L, t, s, project) {
    const P3 = project3d(L, t, project), m = layerMatrix(L, t, project), b = layerBounds(L, project, null, t);
    const N = 10, hw = b.w / 2 * 1.15, hh = b.h / 2 * 1.15, g = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const q = m.transformPoint({ x: -hw + 2 * hw * i / N, y: -hh + 2 * hh * j / N }), d = P3(q.x, q.y);
      g.push(d ? { sx: q.x * s, sy: q.y * s, dx: d[0] * s, dy: d[1] * s } : null);
    }
    const tri = (a, b_, c) => {
      if (!a || !b_ || !c) return;
      const den = (b_.sx - a.sx) * (c.sy - a.sy) - (c.sx - a.sx) * (b_.sy - a.sy); if (Math.abs(den) < 1e-9) return;
      // affine taking source triangle -> destination triangle
      const A = ((b_.dx - a.dx) * (c.sy - a.sy) - (c.dx - a.dx) * (b_.sy - a.sy)) / den, C_ = ((c.dx - a.dx) * (b_.sx - a.sx) - (b_.dx - a.dx) * (c.sx - a.sx)) / den;
      const B = ((b_.dy - a.dy) * (c.sy - a.sy) - (c.dy - a.dy) * (b_.sy - a.sy)) / den, D_ = ((c.dy - a.dy) * (b_.sx - a.sx) - (b_.dy - a.dy) * (c.sx - a.sx)) / den;
      const E = a.dx - A * a.sx - C_ * a.sy, F = a.dy - B * a.sx - D_ * a.sy;
      const cx = (a.dx + b_.dx + c.dx) / 3, cy = (a.dy + b_.dy + c.dy) / 3, grow = p => [p.dx + (p.dx - cx) * 0.02 + Math.sign(p.dx - cx) * 0.5, p.dy + (p.dy - cy) * 0.02 + Math.sign(p.dy - cy) * 0.5];
      ctx.save(); ctx.beginPath(); ctx.moveTo(...grow(a)); ctx.lineTo(...grow(b_)); ctx.lineTo(...grow(c)); ctx.closePath(); ctx.clip();
      ctx.setTransform(A, B, C_, D_, E, F); ctx.drawImage(src, 0, 0); ctx.restore();
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i; tri(g[k], g[k + 1], g[k + N + 1]); tri(g[k + 1], g[k + N + 2], g[k + N + 1]);
    }
  }
  // track matte: keep src only where the matte layer is (alpha) or bright (luma); invert keeps the rest
  _matte(src, L, t, s, W, H, project, depth) {
    const { layer, mode = 'alpha', invert = false } = L.matte;
    const m = layer !== L.id && this._refLayer(layer, t, s, W, H, project, depth); if (!m) return src;
    if (mode === 'luma') {
      const mx = m.getContext('2d'), img = mx.getImageData(0, 0, W, H), d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i + 3] = Math.round((d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) * d[i + 3] / 255); }
      mx.putImageData(img, 0, 0);
    }
    const c = this.mattec || (this.mattec = document.createElement('canvas')); this._size(c, W, H);
    const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H);
    x.drawImage(src, 0, 0); x.globalCompositeOperation = invert ? 'destination-out' : 'destination-in'; x.drawImage(m, 0, 0); x.globalCompositeOperation = 'source-over';
    return c;
  }
  // render one layer by itself (no blend) into a pooled canvas: texture source for Displacement Map, Bump Map etc.
  _refLayer(id, t, s, W, H, project, depth) {
    const L = project.layers.find(l => l.id === id); if (!L || L.type === 'audio') return null;
    const c = this.refs[id] || (this.refs[id] = document.createElement('canvas')); this._size(c, W, H);
    const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H);
    if (t >= L.start && t < L.end) this._layer(x, L, t, s, W, H, 'source-over', project, depth + 1);
    return c;
  }
  // draw one layer onto ctx with composite op `op`
  _layer(ctx, L, t0, s, W, H, op, project, depth = 0) {
    const fxs = L.effects?.length ? activeFx(L) : [];
    let t = t0;
    const tq = fxs.find(f => f.type === 'timequant');
    if (tq) { const fps = Math.max(0.5, evalParams(L, tq, t0).fps); t = L.start + Math.floor((t0 - L.start) * fps + 1e-6) / fps; }
    const tr = evalTransform(L, t, project);
    if (tr.opacity <= 0 && L.type !== 'adjust') return;
    const shaderFx = fxs.filter(f => isShaderFx(EFFECTS[f.type]));
    const useGL = shaderFx.length > 0 && this.fx.ok;
    const mbFx = fxs.find(f => f.type === 'motionblur'), echo = fxs.find(f => f.type === 'echo');
    // project-wide Motion Blur applies to every animated layer that has no Motion Blur effect of its own
    const pmb = project.motionBlur?.on && L.type !== 'adjust' && Object.keys(L.keys).length ? project.motionBlur : null;
    const mb = mbFx || pmb;
    const lc = this.layerCanvas, lctx = lc.getContext('2d');
    try {
      // texture sources referenced by layer params must be rendered before this layer uses the shared canvases
      const refs = {};
      if (useGL && depth < 2) for (const f of shaderFx) for (const [k, sp] of Object.entries(EFFECTS[f.type].params)) if (sp.t === 'layer' && !NOT_TEX.has(k)) {
        const id = evalParams(L, f, t)[k]; if (id && id !== L.id && !refs[id]) refs[id] = this._refLayer(id, t, s, W, H, project, depth); }
      const items = () => shaderFx.map(f => ({ def: EFFECTS[f.type], p: evalParams(L, f, t), fx: f }));
      const hooks = { backdrop: ctx.canvas, layer: id => refs[id] || null };
      if (L.type === 'adjust') {
        if (!useGL) return;
        this._size(this.tmp, W, H); const tctx = this.tmp.getContext('2d');
        tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalAlpha = 1; tctx.globalCompositeOperation = 'source-over';
        tctx.clearRect(0, 0, W, H); tctx.drawImage(ctx.canvas, 0, 0);
        const c = { ...fxCtx(L, t, project), t: t0, s, cx: W / 2, cy: H / 2, hw: W / 2, hh: H / 2, rot: 0, base: { x: project.w / 2, y: project.h / 2 }, bh: project.h };
        const out = this.fx.apply(this.tmp, items(), c, hooks);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity));
        ctx.globalCompositeOperation = op === 'source-over' ? 'source-atop' : op; ctx.drawImage(out, 0, 0); ctx.restore();
        return;
      }
      const evAt = tt => ({ shape: L.type === 'shape' ? evalShape(L, tt) : null, tx: L.type === 'text' ? evalText(L, tt, project) : null, solid: L.type === 'solid' ? evalNs(L, 'solid', tt) : null, gimg: L.type === 'group' || L.type === 'comp' ? this.gimg?.[L.id] : null, sfx: fxs.length ? shapeEffects(L, tt) : null });
      const drawTo = (c, tt = t, trr = tr) => {
        c.setTransform(s, 0, 0, s, 0, 0);
        const m = layerMatrix(L, tt, project); c.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        if (L.shadow?.on) { const sh = evalNs(L, 'shadow', tt), n = parseInt(sh.color.slice(1), 16); c.shadowColor = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${sh.alpha ?? 0.6})`; c.shadowBlur = sh.blur * s; c.shadowOffsetX = sh.dx * s; c.shadowOffsetY = sh.dy * s; }
        drawContent(c, L, project, evAt(tt));
      };
      const simple = !useGL && !mb && !echo && !L.matte?.layer && !is3d(L) && op === 'source-over' && L.type !== 'text' && L.type !== 'draw' && !L.shadow?.on && !(L.type === 'shape' && (L.shape.strokeW > 0 || fxs.length) && tr.opacity < 1);
      if (simple) { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity)); drawTo(ctx); ctx.restore(); return; }
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, W, H);
      const sample = (tt, alpha, comp = 'source-over') => { // draw the layer at another time into lc
        const tmp = this.tmp2; this._size(tmp, W, H); const x = tmp.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.clearRect(0, 0, W, H);
        const trr = tt === t ? tr : evalTransform(L, tt, project); x.save(); drawTo(x, tt, trr); x.restore();
        lctx.save(); lctx.globalAlpha = Math.max(0, Math.min(1, alpha * (tr.opacity > 0 ? trr.opacity / tr.opacity : 1))); lctx.globalCompositeOperation = comp; lctx.drawImage(tmp, 0, 0); lctx.restore(); };
      if (mb) {
        const p = mbFx ? evalParams(L, mbFx, t) : { samples: pmb.samples || 8, shutter: pmb.shutter ?? 180 }, n = Math.max(2, Math.min(64, Math.round(p.samples))), span = p.shutter / 360 / (project.fps || 30);
        for (let k = 0; k < n; k++) sample(t + (k / (n - 1) - 0.5) * span, 1 / n, 'lighter');
      } else if (echo) {
        const p = evalParams(L, echo, t), n = Math.max(1, Math.round(p.n)), dec = 1 - p.decay / 100;
        const echoes = () => { for (let i = n; i >= 1; i--) sample(t - i * p.delay, Math.pow(dec, i)); };
        if (!p.front) echoes(); sample(t, 1); if (p.front) echoes();
      } else { lctx.save(); drawTo(lctx); lctx.restore(); }
      let src = lc;
      if (useGL) {
        const b = layerBounds(L, project, lctx, t);
        const k = Math.abs(tr.scale) * s;
        const o = layerMatrix(L, t, project).transformPoint({ x: 0, y: 0 });
        const c = { ...fxCtx(L, t, project), t: t0, s, cx: o.x * s, cy: H - o.y * s, hw: Math.max(1, b.w * Math.abs(tr.sx) * k / 2), hh: Math.max(1, b.h * Math.abs(tr.sy) * k / 2), rot: -tr.rotation * D, base: { x: tr.x, y: tr.y }, bh: b.h };
        src = this.fx.apply(lc, items(), c, hooks);
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity)); ctx.globalCompositeOperation = op;
      if (L.matte?.layer && depth < 2) src = this._matte(src, L, t, s, W, H, project, depth);
      if (is3d(L)) this._warp3d(ctx, src, L, t, s, project); else ctx.drawImage(src, 0, 0);
      ctx.restore();
    } catch (e) { if (this.errors.length < 20) this.errors.push(String(e)); console.error(e); }
  }
}

// Loudness of a video / audio layer at t: keyframeable Volume × Fade In / Fade Out ramps (0..1)
export function mediaGain(L, t) {
  const m = L.media, fi = m.fadeIn || 0, fo = m.fadeOut || 0;
  let g = Math.max(0, valueAt(L, 'media.volume', t));
  if (fi > 0 && t - L.start < fi) g *= Math.max(0, (t - L.start) / fi);
  if (fo > 0 && L.end - t < fo) g *= Math.max(0, (L.end - t) / fo);
  return Math.min(1, g);
}

// Keep <video> elements in step with the timeline.
export function syncVideos(project, t, playing) {
  // Clips split from one source share its media element: the clip under the playhead drives it.
  const drive = new Map();
  for (const L of project.layers) {
    if (L.type !== 'video' && L.type !== 'audio') continue;
    const active = L.visible && t >= L.start && t < L.end;
    if (active || !drive.has(L.media.id)) drive.set(L.media.id, { L, active });
  }
  for (const [id, { L, active }] of drive) {
    const m = media.get(id); if (!m || !m.el) continue;
    const v = m.el;
    const local = mediaTime(L, t), sp = L.media.speed || 1, rev = !!L.media.reverse;
    if (!active) { if (!v.paused) v.pause(); continue; }
    if (v.duration && local > v.duration) { if (!v.paused) v.pause(); continue; }
    const g = mediaGain(L, t);
    if (m.gain) { m.gain.gain.value = rev ? 0 : g; v.volume = 1; } else v.volume = g; // after an export the element plays through its gain node
    if (playing && !rev) { // reversed clips can't play backwards: they seek frame by frame (silent)
      if (L.type === 'video') v.muted = g === 0;
      const rate = Math.max(0.0625, Math.min(16, sp)); if (v.playbackRate !== rate) v.playbackRate = rate;
      if (Math.abs(v.currentTime - local) > 0.3) v.currentTime = local;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - local) > 0.04 && !v.seeking) v.currentTime = local;
      if (rev && playing && L.type === 'audio') v.muted = true;
    }
  }
}
