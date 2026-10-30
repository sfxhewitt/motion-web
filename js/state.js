// Project model, layer factories, keyframe evaluation, undo history.
import { applyEase, makeEase } from './easing.js';

export const ANIM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
export const PROP_META = {
  x:        { label: 'Pos X',   min: -2000, max: 4000, step: 1 },
  y:        { label: 'Pos Y',   min: -2000, max: 4000, step: 1 },
  scale:    { label: 'Scale',   min: 0,     max: 5,    step: 0.01 },
  rotation: { label: 'Rotate',  min: -720,  max: 720,  step: 0.5 },
  opacity:  { label: 'Opacity', min: 0,     max: 1,    step: 0.01 },
};

export const ASPECTS = {
  '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350], '4:3': [1440, 1080],
};

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clone = o => JSON.parse(JSON.stringify(o));

// Resolution presets (short side of the composition, as in Alight's Create sheet)
export const RESOLUTIONS = [[480, '480p (SD)'], [720, '720p (HD)'], [1080, '1080p (FHD)'], [1440, '1440p (QHD)'], [2160, '2160p (4K UHD)']];
// aspect '16:9' / custom 'a:b' + short side -> even composition size
export function sizeFor(aspect, short = 1080) {
  const [a, b] = String(aspect).split(':').map(Number);
  if (!(a > 0 && b > 0)) return [short, short];
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  return a >= b ? [even(short * a / b), short] : [short, even(short * b / a)];
}

export function newProject(aspect = '9:16', name = 'Untitled', { res, fps = 30, bg = '#05060a' } = {}) {
  const [w, h] = res ? sizeFor(aspect, res) : (ASPECTS[aspect] || sizeFor(aspect, 1080));
  return {
    id: uid(), name, aspect, w, h, fps, duration: 6, bg,
    created: Date.now(), modified: Date.now(), layers: [], version: 1,
  };
}

const NEON = ['#00f0ff', '#ff2bd6', '#c6ff00', '#ff7a00', '#8a5cff', '#ffffff'];
let colorIx = 0;
const nextColor = () => NEON[(colorIx++) % NEON.length];

function baseLayer(p, type, name) {
  return {
    id: uid(), type, name, visible: true, locked: false,
    start: 0, end: p.duration, blend: 'normal',
    props: { x: p.w / 2, y: p.h / 2, scale: 1, rotation: 0, opacity: 1 },
    keys: {}, effects: [],
  };
}

export function makeLayer(p, type, opts = {}) {
  const short = Math.min(p.w, p.h);
  let L;
  switch (type) {
    case 'shape': {
      const kind = opts.kind || 'rect';
      L = baseLayer(p, 'shape', opts.name || 'Shape ' + (p.layers.filter(l => l.type === 'shape').length + 1));
      L.shape = {
        kind, w: short * 0.4, h: short * 0.4, radius: kind === 'rect' ? short * 0.02 : 0,
        points: kind === 'polygon' ? 6 : 5, inner: 0.45, thickness: 0.25,
        fill: opts.fill || nextColor(), fill2: '#ff2bd6', gradient: false, gradAngle: 45,
        stroke: '#ffffff', strokeW: 0, fillOn: true,
        ...(opts.shape || {}),
      };
      if (kind === 'line') { L.shape.h = short * 0.02; L.shape.w = short * 0.6; }
      if (kind === 'path') { L.shape.pts = opts.pts || []; L.shape.closed = true; L.shape.fill = opts.fill || '#d8d8d8'; }
      break;
    }
    case 'text': {
      L = baseLayer(p, 'text', 'Text');
      L.text = {
        content: opts.content || 'NEON', size: Math.round(short * 0.14), font: 'system', weight: 800,
        fill: nextColor(), stroke: '#000000', strokeW: 0, align: 'center', tracking: 0.05, lineHeight: 1.1, italic: false,
      };
      break;
    }
    case 'solid': {
      L = baseLayer(p, 'solid', 'Solid');
      L.solid = { color: opts.color || '#12131c', fill2: '#2a0a3a', gradient: false, gradAngle: 90 };
      break;
    }
    case 'draw': {
      L = baseLayer(p, 'draw', 'Drawing ' + (p.layers.filter(l => l.type === 'draw').length + 1));
      L.draw = { strokes: [] };
      break;
    }
    case 'audio': {
      L = baseLayer(p, 'audio', opts.name || 'Audio');
      L.media = { id: opts.mediaId, volume: 1, offset: 0, duration: opts.mediaDuration || 0 };
      if (opts.mediaDuration) L.end = Math.min(p.duration, opts.mediaDuration);
      break;
    }
    case 'adjust': {
      L = baseLayer(p, 'adjust', 'Adjustment');
      break;
    }
    case 'image': case 'video': {
      L = baseLayer(p, type, opts.name || (type === 'image' ? 'Image' : 'Video'));
      L.media = { id: opts.mediaId, w: opts.w || p.w, h: opts.h || p.h, volume: 1, offset: 0 };
      const fit = Math.min(p.w / L.media.w, p.h / L.media.h);
      L.props.scale = +fit.toFixed(3);
      if (type === 'video' && opts.mediaDuration) L.end = Math.min(p.duration, opts.mediaDuration);
      break;
    }
    default: throw new Error('unknown layer ' + type);
  }
  return L;
}

// ---- keyframes ----
export function hasKeys(L, prop) { return !!(L.keys[prop] && L.keys[prop].length); }

// Nested layer objects whose values can be keyframed as '<ns>.<key>' (shape.fill, text.size, shadow.blur, media.volume …)
export const NS = ['shape', 'text', 'solid', 'shadow', 'media'];
// a copy of L[ns] with its keyframed values evaluated at t (the object itself when nothing in it is animated)
export function evalNs(L, ns, t) {
  const o = L[ns]; if (!o) return o;
  let out = null;
  for (const k in L.keys) if (k.startsWith(ns + '.') && L.keys[k].length) { out = out || { ...o }; out[k.slice(ns.length + 1)] = valueAt(L, k, t); }
  return out || o;
}

// Animated values may be numbers, vectors (arrays), hex colours or discrete values (bool / select / layer id).
export function baseGet(L, prop) {
  if (prop in L.props) return L.props[prop];
  const i = prop.indexOf('.'); if (i < 0) return L.props[prop];
  const ns = prop.slice(0, i), rest = prop.slice(i + 1);
  if (NS.includes(ns)) return L[ns]?.[rest];
  if (ns === 'fx') { const j = rest.indexOf('.'), f = (L.effects || []).find(e => e.id === rest.slice(0, j)); return f ? f.params[rest.slice(j + 1)] : undefined; }
  return undefined;
}
export function baseSet(L, prop, v) {
  const i = prop.indexOf('.'); if (i < 0) { L.props[prop] = v; return; }
  const ns = prop.slice(0, i), rest = prop.slice(i + 1);
  if (NS.includes(ns)) { if (L[ns]) L[ns][rest] = v; }
  else if (ns === 'fx') { const j = rest.indexOf('.'), f = (L.effects || []).find(e => e.id === rest.slice(0, j)); if (f) f.params[rest.slice(j + 1)] = v; }
}
const hexRe = /^#[0-9a-f]{6}$/i;
const hx = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export function lerpV(a, b, e) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * e;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => x + ((b[i] ?? x) - x) * e);
  if (typeof a === 'string' && hexRe.test(a) && typeof b === 'string' && hexRe.test(b)) {
    const A = hx(a), B = hx(b); return '#' + A.map((x, i) => Math.round(Math.min(255, Math.max(0, x + (B[i] - x) * e))).toString(16).padStart(2, '0')).join('');
  }
  return e >= 1 ? b : a; // hold
}
export function valueAt(L, prop, t) {
  const ks = L.keys[prop];
  if (!ks || !ks.length) return baseGet(L, prop);
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t < b.t) {
      const u = (t - a.t) / (b.t - a.t || 1);
      return lerpV(a.v, b.v, applyEase(a.ease, u));
    }
  }
  return last.v;
}

export function findKey(L, prop, t, eps = 1 / 120) {
  const ks = L.keys[prop] || [];
  return ks.find(k => Math.abs(k.t - t) < eps);
}

export function setKey(L, prop, t, v, ease) {
  const ks = L.keys[prop] || (L.keys[prop] = []);
  let k = findKey(L, prop, t);
  if (k) { k.v = v; if (ease) k.ease = ease; }
  else {
    k = { id: uid(), t: +t.toFixed(4), v, ease: ease || makeEase('easeInOut') };
    ks.push(k); ks.sort((a, b) => a.t - b.t);
  }
  return k;
}

export function removeKey(L, prop, id) {
  const ks = L.keys[prop]; if (!ks) return;
  const i = ks.findIndex(k => k.id === id);
  if (i >= 0) ks.splice(i, 1);
  if (!ks.length) delete L.keys[prop];
}

// Set a property honoring animation: if animated, write a key at t; else static.
export function writeProp(L, prop, t, v) {
  if (hasKeys(L, prop)) setKey(L, prop, t, v); else baseSet(L, prop, v);
}

export function allKeys(L) {
  const out = [];
  for (const p of Object.keys(L.keys)) for (const k of L.keys[p]) out.push({ prop: p, k });
  return out;
}

// Move a clip's in-point; media layers slide their source offset with it so a trim cuts into the media
// (never before the source's first frame).
export function setStart(L, s) {
  if (L.media && (L.type === 'video' || L.type === 'audio')) {
    const o = L.media.offset || 0;
    s = Math.max(s, L.start - o);
    L.media.offset = +(o + s - L.start).toFixed(4);
  }
  L.start = s;
}

export function shiftLayer(L, dt) {
  L.start += dt; L.end += dt;
  for (const p of Object.keys(L.keys)) for (const k of L.keys[p]) k.t = +(k.t + dt).toFixed(4);
}

// ---- history ----
export class History {
  constructor(limit = 60) { this.stack = []; this.ix = -1; this.limit = limit; }
  push(state) {
    const s = JSON.stringify(state);
    if (this.stack[this.ix] === s) return;
    this.stack = this.stack.slice(0, this.ix + 1);
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.ix = this.stack.length - 1;
  }
  canUndo() { return this.ix > 0; }
  canRedo() { return this.ix < this.stack.length - 1; }
  undo() { if (!this.canUndo()) return null; this.ix--; return JSON.parse(this.stack[this.ix]); }
  redo() { if (!this.canRedo()) return null; this.ix++; return JSON.parse(this.stack[this.ix]); }
  reset(state) { this.stack = []; this.ix = -1; this.push(state); }
}
