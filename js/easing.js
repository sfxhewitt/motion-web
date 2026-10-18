// Easing engine: cubic-bezier (CSS-style), hold, steps, bounce, elastic.
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
  bounce:     { label: 'Bounce',      type: 'bounce' },
  elastic:    { label: 'Elastic',     type: 'elastic' },
  steps:      { label: 'Steps',       type: 'steps', n: 5 },
  hold:       { label: 'Hold',        type: 'hold' },
};

export function makeEase(name) {
  const p = EASE_PRESETS[name] || EASE_PRESETS.linear;
  const e = { preset: name, type: p.type };
  if (p.bz) e.bz = p.bz.slice();
  if (p.n) e.n = p.n;
  return e;
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

function bounceOut(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export function applyEase(e, t) {
  if (!e) return t;
  switch (e.type) {
    case 'hold': return t >= 1 ? 1 : 0;
    case 'steps': { const n = Math.max(1, e.n || 5); return Math.min(1, Math.floor(t * n) / (n - 1 || 1)); }
    case 'bounce': return bounceOut(t);
    case 'elastic': {
      if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
    default: { const b = e.bz || [0, 0, 1, 1]; return bezierFn(b[0], b[1], b[2], b[3])(t); }
  }
}
