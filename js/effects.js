// Effect catalogue glue: keyframe-aware parameter evaluation, transform / text hooks, presets, search and legacy migration.
export * from './fx/index.js';
import { EFFECTS, CATS, makeEffect, defaults, fxKey } from './fx/index.js';
import { valueAt } from './state.js';
import { makeEase } from './easing.js';

export const isShaderFx = d => !!(d && (d.fs || d.run) && !d.kind);
export const activeFx = L => (L.effects || []).filter(f => f.on && EFFECTS[f.type]);
export function evalParams(L, fx, t) {
  const d = EFFECTS[fx.type], o = {};
  for (const [k, spec] of Object.entries(d.params)) {
    const key = fxKey(fx, k);
    let v = L.keys?.[key]?.length ? valueAt(L, key, t) : fx.params[k];
    if (v === undefined) v = Array.isArray(spec.def) ? spec.def.slice() : spec.def;
    o[k] = v;
  }
  return o;
}
// transform effects (Move/Transform + opacity animators) run in stack order on the evaluated transform
export function applyTransformEffects(L, tr, t, c) {
  for (const f of activeFx(L)) { const d = EFFECTS[f.type]; if (d.xf) d.xf(tr, evalParams(L, f, t), c); }
  return tr;
}
export function applyTextEffects(L, tx, t, c) {
  for (const f of activeFx(L)) { const d = EFFECTS[f.type]; if (d.text) d.text(tx, evalParams(L, f, t), c); }
  return tx;
}
export function shapeEffects(L, t) {
  let out = null;
  for (const f of activeFx(L)) { if (f.type === 'drawprogress' || f.type === 'stroketaper') (out || (out = {}))[f.type] = evalParams(L, f, t); }
  return out;
}

// ---- suggestions / search ----
export const SUGGESTED_BIG = ['tiles', 'chromakey', 'exposure', 'reorient360', 'lightglow'];
export const SUGGESTED_SMALL = ['autoshake', 'contourstrips', 'oscillate'];
export const SEARCH_TAGS = ['Auto', 'Camera', 'Layer Parenting', 'Property Adjust', 'Transform', 'Blur', 'Glow', 'Transition', '3D', 'Key'];
export function searchEffects(q, tag) {
  q = (q || '').trim().toLowerCase();
  const all = Object.values(EFFECTS).filter(e => !tag || e.tags.includes(tag) || (tag === 'Glow' && /glow/i.test(e.name)));
  if (!q) return tag ? all.sort((a, b) => a.name.localeCompare(b.name)) : [];
  const wordAt = n => n.toLowerCase().split(/[^a-z0-9]+/).some(w => w.startsWith(q));
  const named = all.filter(e => e.name.toLowerCase().includes(q))
    .sort((a, b) => (wordAt(b.name) - wordAt(a.name)) || (a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q)) || a.name.localeCompare(b.name));
  const more = q.length >= 4 ? all.filter(e => !named.includes(e) && (e.desc.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q)))) : [];
  return named.concat(more.sort((a, b) => a.name.localeCompare(b.name)));
}
export const byCat = cat => Object.values(EFFECTS).filter(e => e.cat === cat).sort((a, b) => a.name.localeCompare(b.name));

// ---- presets ----
// keys: { param: [[time, value, ease?], ...] } with time in seconds from the layer start, or 'e-0.5' = 0.5 s before the layer end
// [param, value when "off" (start of In / end of Out), value when "on" (default = Standard Settings)]
const TRANS = { autoshake: ['mag', 160, , 0], gaussblur: ['r', 120, , 0], dirblur: ['len', 300, , 0], zoomblur: ['amt', 80, , 0], spinblur: ['angle', 90, , 0], boxblur: ['r', 80, , 0], lensblur: ['r', 60, , 0],
  chromzoom: ['amt', 60, , 0], mosaic: ['size', 120, , 1], pixelate: ['size', 120, , 1], swirl: ['angle', 720, , 0], rgbsplit: ['amt', 120, , 0], wavewarp: ['h', 120, , 0], turbdisp: ['amt', 200, , 0],
  fractalwarp: ['amt', 200, , 0], ripple: ['amp', 120, , 0], pinch: ['amt', -100, , 0], warpblur: ['amt', 150, , 0], exposure: ['exp', -6, , 0], brightcontrast: ['b', -100, , 0],
  glow: ['int', 0], lightglow: ['int', 0], softglow: ['amt', 0], hueshift: ['hue', 360, , 0],
  dissolve: ['comp', 100, , 0], blockdissolve: ['comp', 100, , 0], wipe: ['comp', 100, , 0], radialwipe: ['comp', 100, , 0], pagecurl: ['amt', 100, , 0], curl: ['amt', 100, , 0],
  polar: ['amt', 0], spherize: ['amt', 0], flip: ['rot', [0, 180, 0]], cube: ['rot', [0, 90, 0]], tunnel: ['spd', 3],
  textprogress: ['prog', 0, , 100], texttransform: ['prog', 0, , 100], countupdown: ['prog', 0, , 100], textrandom: ['prog', 0, , 100] };
const P = (code, name, params = {}, keys = null) => ({ code, name, params, keys });
const SPECIFIC = {
  autoshake: [P('HO', 'Horizontal', { ya: 0 }), P('VE', 'Vertical', { xa: 0 }), P('CS', 'Camera Shake', { mag: 18, freq: 6, rot: 1.5 }), P('EQ', 'Earthquake', { mag: 90, freq: 12, rot: 4 })],
  oscillate: [P('VE', 'Vertical Bob', { angle: 90, mag: 40, freq: 1 }), P('FL', 'Float', { angle: 90, mag: 20, freq: 0.5 }), P('BN', 'Bounce Horizontal', { mag: 200, freq: 0.5, type: 'triangle' })],
  starprism: [P('HF', 'Horizontal Flip', {}, { rot: [[0, [0, 0, 0], 'easeInOut'], [1.2, [0, 180, 0]]] }), P('AB', 'Award Badge', { ori: [-15, 25, 0], th: 30 }, { rot: [[0, [0, 0, 0], 'linear'], ['e-0', [0, 360, 0]]] })],
  gaussblur: [P('LT', 'Light', { r: 6 }), P('HV', 'Heavy', { r: 80 }), P('HZ', 'Horizontal', { dir: 'h', r: 40 }), P('VT', 'Vertical', { dir: 'v', r: 40 })],
  glow: [P('NE', 'Neon', { r: 30, int: 220, tint: 60, color: '#00f0ff' }), P('SO', 'Soft', { r: 80, int: 70 }), P('PU', 'Pulse', {}, { int: [[0, 40, 'easeInOut'], [0.5, 220, 'easeInOut'], [1, 40]] })],
  spin: [P('SL', 'Slow', { spd: 30 }), P('FA', 'Fast', { spd: 720 }), P('RV', 'Reverse', { spd: -90 })],
  pulsesize: [P('HB', 'Heartbeat', { beat: true, freq: 1.2, amt: 18 }), P('SU', 'Subtle', { amt: 5 })],
  swing: [P('SI', 'Sign Swing', { amp: 12, freq: 0.8 }), P('DC', 'Settle', { amp: 40, decay: 40 })],
  chromakey: [P('BL', 'Blue Screen', { key: '#2357e8' })], advchromakey: [P('BL', 'Blue Screen', { key: '#2357e8' })],
  hueshift: [P('CY', 'Cycle Colors', {}, { hue: [[0, 0, 'linear'], ['e-0', 360]] })],
  lensflare: [P('SW', 'Sweep', {}, { posn: [[0, [-500, -400], 'easeInOut'], ['e-0', [500, -200]]] })],
  vignette: [P('ST', 'Strong', { amt: 100, size: 35 }), P('WH', 'White Fade', { color: '#ffffff' })],
  linearrepeat: [P('VT', 'Vertical', { off: [0, 150] }), P('ST', 'Shrinking Trail', { sc: 85, op: 10 })],
  radialrepeat: [P('CL', 'Clock', { n: 12 }), P('FL', 'Flower', { n: 6, r: 120 })],
  textprogress: [P('WO', 'By Word', { unit: 'word' }), P('TY', 'Typewriter', { fade: 0 })],
  fillbehind: [P('PL', 'Pill', { r: 400 }), P('BX', 'Box', { r: 0 })],
};
export function presetsFor(id) {
  const out = [P('', 'Standard Settings')];
  const tr = TRANS[id];
  if (tr) { const d = defaults(id), [k, off, , onv] = tr, on = onv ?? d[k];
    const inn = (dur, code, name) => P(code, name, {}, { [k]: [[0, off, 'easeOut'], [dur, on]] });
    const out_ = (dur, code, name) => P(code, name, {}, { [k]: [['e-' + dur, on, 'easeIn'], ['e-0', off]] });
    out.push(out_(0.25, 'TF', 'Transition Out: Fast'), inn(0.25, 'NF', 'Transition In: Fast'), inn(0.6, 'IN', 'Transition In'), out_(0.6, 'OU', 'Transition Out')); }
  const all = out.concat(SPECIFIC[id] || []);
  // text animators default to "over layer duration"; keyframed presets drive Progress manually
  if ('timing' in defaults(id)) for (const p of all) if (p.keys) p.params = { timing: 'manual', ...p.params };
  return all;
}
export function applyPreset(L, id, preset) {
  const fx = makeEffect(id, preset?.params || {});
  if (preset?.keys) for (const [k, list] of Object.entries(preset.keys)) {
    L.keys[fxKey(fx, k)] = list.map(([tt, v, ez]) => { const t = typeof tt === 'string' ? Math.max(L.start, L.end - parseFloat(tt.slice(2)) - 1e-3) : L.start + tt;
      return { id: Math.random().toString(36).slice(2, 10), t: +t.toFixed(4), v: Array.isArray(v) ? v.slice() : v, ease: makeEase(ez || 'easeInOut') }; }).sort((a, b) => a.t - b.t);
  }
  return fx;
}

// ---- legacy (v1-v10) effect ids -> new ones ----
const LEGACY = {
  blur: f => ['gaussblur', { r: f.radius }], dirblur: f => ['dirblur', { len: f.radius, angle: f.angle }], zoomblur: f => ['zoomblur', { amt: (f.amount ?? 0.25) * 100, center: [0, 0] }],
  glow: f => ['glow', { r: f.radius, int: (f.intensity ?? 1.6) * 100, color: f.tint, tint: (f.tintMix ?? 0.4) * 100 }],
  coloradj: f => ['colortune', { bright: (f.brightness || 0) * 100, contrast: (f.contrast || 0) * 100, sat: (f.saturation || 0) * 100, hue: f.hue || 0, gamma: 1, gain: 100 }],
  duotone: f => ['gradmap', { c1: f.a, c2: f.b, c3: f.b, mix: (f.mix ?? 1) * 100 }], invert: f => ['invert', { mix: (f.mix ?? 1) * 100 }], posterize: f => ['posterize', { levels: f.levels }],
  rgbsplit: f => ['rgbsplit', { amt: f.amount, angle: f.angle }], pixelate: f => ['pixelate', { size: f.size }], noise: f => ['noise', { amt: (f.amount ?? 0.25) * 100, color: f.mono === false }],
  vignette: f => ['vignette', { amt: Math.min(100, (f.amount ?? 0.6) * 100), fea: (f.softness ?? 0.5) * 100 }], wave: f => ['wavewarp', { h: f.amp, w: f.length, spd: f.speed, angle: f.vertical ? 0 : 90 }],
  swirl: f => ['swirl', { angle: f.angle, radius: (f.radius ?? 0.5) * 1000 }], kaleido: f => ['kaleido', { seg: f.segments, rot: f.rotate }],
  mirror: f => ['mirror', { angle: f.mode === 'vertical' ? 90 : 0 }], shake: f => ['autoshake', { mag: f.mag, freq: f.freq, rot: f.rot, seed: f.seed }],
  pulse: f => ['pulsesize', { amt: (f.amount ?? 0.15) * 100, freq: f.freq }], spin: f => ['spin', { spd: f.speed }],
  glitch: f => ['tileshift', { mode: 'rnd', size: 40, sx: (f.amount ?? 0.5) * 60, sy: 0 }], scanlines: f => ['halftonelines', { sp: 6, angle: 0, orig: true }],
};
export function migrateLayer(L) {
  L.effects = (L.effects || []).map(f => {
    if (EFFECTS[f.type] && !(f.type in LEGACY && !('open' in f) && legacyShape(f))) return f;
    const m = LEGACY[f.type]; if (!m) return null;
    const [type, p] = m(f.params || {}); const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    return { id: f.id, type, on: f.on !== false, open: true, params: { ...defaults(type), ...clean } };
  }).filter(Boolean);
  return L;
}
// old effects stored their params as flat numbers with old names; detect by a param key the new definition does not have
function legacyShape(f) { const d = EFFECTS[f.type]; return Object.keys(f.params || {}).some(k => !(k in d.params)); }
export function migrateProject(p) { for (const L of p.layers || []) migrateLayer(L); return p; }
export { CATS };
