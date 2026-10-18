// Easing engine: cubic-bezier (CSS-style), hold, steps, physical bounce, springs (overshoot), elastic.
const cache = new Map();

export const EASE_PRESETS = {
  linear:     { label: 'Linear',      type: 'bezier', bz: [0, 0, 1, 1] },
  easeIn:     { label: 'Ease In',     type: 'bezier', bz: [0.42, 0, 1, 1] },
  easeOut:    { label: 'Ease Out',    type: 'bezier', bz: [0, 0, 0.58, 1] },
  easeInOut:  { label: 'In & Out',    type: 'bezier', bz: [0.42, 0, 0.58, 1] },
  expoOut:    { label: 'Expo Out',    type: 'bezier', bz: [0.16, 1, 0.3, 1] },
  expoInOut:  { label: 'Expo In/Out', type: 'bezier', bz: [0.87, 0, 0.13, 1] },
  backOut:    { label: 'Back Out',    type: 'bezier', bz: [0.34, 1.56, 0.64, 1] },
  backIn:     { label: 'Back In',     type: 'bezier', bz: [0.36, 0, 0.66, -0.56] },
  snap:       { label: 'Snap',        type: 'bezier', bz: [0.9, 0, 0.1, 1] },
  bounce:     { label: 'Bounce',      type: 'bounce', n: 6, r: 0.55 },
  overshoot:  { label: 'Overshoot',   type: 'spring', f: 0.75, d: 3 },
  elastic:    { label: 'Elastic',     type: 'elastic' },
  spring:     { label: 'Spring',      type: 'spring', f: 2.6, d: 4 },
  steps:      { label: 'Steps',       type: 'steps', n: 5 },
  hold:       { label: 'Hold',        type: 'hold' },
};

export function makeEase(name) {
  const p = EASE_PRESETS[name] || EASE_PRESETS.linear;
  const e = { preset: name, type: p.type };
  if (p.bz) e.bz = p.bz.slice();
  for (const k of ['n', 'r', 'f', 'd']) if (p[k] != null) e[k] = p[k];
  return e;
}
// preset groups for the Easing Curve panel (right-hand column)
export const EASE_GROUPS = [
  ['curve', 'Curve', ['linear', 'easeIn', 'easeOut', 'easeInOut', 'expoOut', 'expoInOut', 'backOut', 'backIn', 'snap']],
  ['physics', 'Physics', ['bounce', 'overshoot', 'elastic', 'spring']],
  ['steps', 'Steps', ['steps', 'hold']],
];
export const easeGroupOf = e => (e?.type === 'steps' || e?.type === 'hold' ? 'steps' : e?.type === 'bounce' || e?.type === 'elastic' || e?.type === 'spring' ? 'physics' : 'curve');
export function easeLabel(e) {
  if (!e) return 'Linear';
  if (e.preset && EASE_PRESETS[e.preset] && e.preset !== 'custom') return EASE_PRESETS[e.preset].label;
  return { bezier: 'Cubic Bezier Easing', bounce: 'Bounce', elastic: 'Elastic', spring: 'Spring', steps: 'Steps', hold: 'Hold' }[e.type] || 'Custom';
}
// mirror an ease in time (ease-in <-> ease-out)
export function reverseEase(e) {
  const o = { ...e };
  if (!e.type || e.type === 'bezier') { const b = e.bz || [0, 0, 1, 1]; o.bz = [+(1 - b[2]).toFixed(3), +(1 - b[3]).toFixed(3), +(1 - b[0]).toFixed(3), +(1 - b[1]).toFixed(3)]; o.type = 'bezier'; o.preset = 'custom'; }
  else o.rev = !e.rev;
  return o;
}

function bezierFn(x1, y1, x2, y2) {
  const key = x1 + ',' + y1 + ',' + x2 + ',' + y2;
  if (cache.has(key)) return cache.get(key);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dsx = t => (3 * ax * t + 2 * bx) * t + cx;
  const solve = x => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  const fn = x => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
  cache.set(key, fn);
  return fn;
}

// physical bounce: falls onto the target, then n bounces whose heights shrink by r each time; ends exactly on 1
function bounceN(t, n = 3, r = 0.25) {
  n = Math.max(1, Math.round(n)); r = Math.max(0.01, Math.min(0.95, r));
  const q = Math.sqrt(r); let sum = 0; for (let i = 1; i <= n; i++) sum += Math.pow(q, i);
  const T0 = 1 / (1 + 2 * sum);
  if (t < T0) { const u = t / T0; return u * u; }
  let a = T0;
  for (let i = 1; i <= n; i++) { const Ti = 2 * T0 * Math.pow(q, i); if (t < a + Ti || i === n) { const u = (t - a) / Ti * 2 - 1, hgt = Math.pow(r, i); return 1 - hgt * Math.max(0, 1 - u * u); } a += Ti; }
  return 1;
}
function spring(t, f = 1, d = 5) {
  const y = u => 1 - Math.exp(-d * u) * Math.cos(2 * Math.PI * f * u);
  return y(t) + (1 - y(1)) * t; // exact at both ends
}
function base(e, t) {
  switch (e.type) {
    case 'hold': return t >= 1 ? 1 : 0;
    case 'steps': { const n = Math.max(1, e.n || 5); return Math.min(1, Math.floor(t * n) / (n - 1 || 1)); }
    case 'bounce': return bounceN(t, e.n ?? 3, e.r ?? 0.25);
    case 'spring': return spring(t, e.f ?? 1, e.d ?? 5);
    case 'elastic': {
      if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
    default: { const b = e.bz || [0, 0, 1, 1]; return bezierFn(b[0], b[1], b[2], b[3])(t); }
  }
}
export function applyEase(e, t) {
  if (!e) return t;
  t = Math.max(0, Math.min(1, t));
  return e.rev && e.type !== 'bezier' && e.type ? 1 - base(e, 1 - t) : base(e, t);
}
