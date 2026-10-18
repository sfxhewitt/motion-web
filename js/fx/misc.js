// Move/Transform, Repeat, Matte/Mask/Key, Opacity/Visibility, Text and Other.
import { def, shader, num, px, pct, ang, hz, sec, col, bool, sel, vec2, lay, evo, seed, hex3, noise1, fbm1, rand1, wave } from './core.js';
import { pos, dir } from './color.js';
const D = Math.PI / 180;
const waveSel = (d = 'sine') => sel('Wave Type', d, [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Sawtooth']]);
const timing = () => sel('Timing', 'layer', [['layer', 'Over Layer Duration'], ['manual', 'Manual (Progress)']]);
const progOf = (p, c) => (p.timing === 'manual' ? p.prog / 100 : Math.max(0, Math.min(1, c.lt / Math.max(0.01, c.dur * 0.8))));

// ---------------- Move / Transform ----------------
def('autoshake', { name: 'Auto-Shake', cat: 'move', desc: 'Moves the layer randomly over time within specified parameters.', tags: ['Auto', 'Camera', 'Layer Parenting', 'Property Adjust'],
  params: { mag: num('Magnitude', 50, 0, 2000, { step: 0.1 }), freq: hz('Frequency', 2), evo: num('Evolution', 0, -1000, 1000, { step: 0.01 }), seed: num('Seed', 0, 0, 1000, { step: 0.01 }),
    xa: pct('Horizontal', 100, 0, 200), ya: pct('Vertical', 100, 0, 200), rot: num('Rotation', 0, 0, 180, { unit: '°', step: 0.1 }) },
  xf(tr, p, c) { const t = c.lt * p.freq + p.evo, s = p.seed * 31.7;
    tr.x += fbm1(t + s, 2) * p.mag * p.xa / 100; tr.y += fbm1(t + s + 71.3, 2) * p.mag * p.ya / 100; tr.rotation += fbm1(t + s + 19.1, 2) * p.rot; } });

function pathPoint(pts, closed, u) {
  const segs = []; let L = 0; const n = pts.length; if (n < 2) return { x: pts[0]?.[0] || 0, y: pts[0]?.[1] || 0, a: 0 };
  for (let i = 0; i < (closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); L += l; }
  let d = ((u % 1) + 1) % 1 * L; if (!closed) d = Math.max(0, Math.min(1, u)) * L;
  for (const [a, b, l] of segs) { if (d <= l || l === segs[segs.length - 1][2]) { const f = l ? Math.min(1, d / l) : 0; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, a: Math.atan2(b[1] - a[1], b[0] - a[0]) / D }; } d -= l; }
  const z = segs[segs.length - 1]; return { x: z[1][0], y: z[1][1], a: Math.atan2(z[1][1] - z[0][1], z[1][0] - z[0][0]) / D };
}
function builtinPath(kind, cx, cy, r, n = 96) {
  const out = [];
  for (let i = 0; i < n; i++) { const u = i / n, a = u * Math.PI * 2;
    if (kind === 'wave') out.push([cx - r + 2 * r * i / (n - 1), cy + Math.sin(u * Math.PI * 4) * r * 0.35]);
    else if (kind === 'line') out.push([cx - r + 2 * r * i / (n - 1), cy]);
    else if (kind === 'spiral') { const rr = r * (0.15 + 0.85 * u); out.push([cx + Math.cos(a * 2.5) * rr, cy + Math.sin(a * 2.5) * rr]); }
    else if (kind === 'heart') { const t = a; out.push([cx + 16 * Math.sin(t) ** 3 / 16 * r, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 * r]); }
    else out.push([cx + Math.cos(a - Math.PI / 2) * r, cy + Math.sin(a - Math.PI / 2) * r]); }
  return { pts: out, closed: kind === 'circle' || kind === 'heart' };
}
export function getPath(p, c, cx, cy) { const lp = p.path && c.pathOf ? c.pathOf(p.path) : null; return lp || builtinPath(p.shape || 'circle', cx, cy, p.radius ?? 300); }
const pathShape = () => sel('Path Shape', 'circle', [['circle', 'Circle'], ['wave', 'Wave'], ['line', 'Line'], ['spiral', 'Spiral'], ['heart', 'Heart']]);
def('movealongpath', { name: 'Move Along Path', cat: 'move', desc: 'Moves the layer along the outline of another shape layer (or a built-in path).', tags: ['Transform', 'Path', 'Layer Parenting'],
  params: { path: lay('Path Layer'), shape: pathShape(), radius: px('Path Size', 320, 1, 5000), prog: pct('Progress', 0, -1000, 1000), spd: num('Speed', 0.25, -10, 10, { unit: 'Hz', step: 0.01 }), orient: bool('Orient to Path', true) },
  xf(tr, p, c) { const base = c.base || tr; const P = getPath(p, c, base.x, base.y); const q = pathPoint(P.pts, P.closed, p.prog / 100 + c.lt * p.spd);
    tr.x = q.x; tr.y = q.y; if (p.orient) tr.rotation += q.a + (p.shape === 'circle' && !p.path ? 0 : 0); } });

def('offset', { name: 'Offset', cat: 'move', desc: 'Scrolls the contents of the layer, wrapping around its edges.', tags: ['Transform', 'Loop'],
  params: { shift: vec2('Shift', [120, 60]), spd: vec2('Speed', [0, 0], 4000, { unit: 'px/s' }), mix: pct('Blend with Original', 0) },
  fs: `uniform vec2 u_sh; uniform float u_mix; void main(){ vec2 q=toL(v_uv*u_res); if(abs(q.x)>1.||abs(q.y)>1.){ gl_FragColor=T(v_uv); return; } vec2 s=fract((q-u_sh+1.)*0.5)*2.-1.; gl_FragColor=mix(Tp(fromL(s)),T(v_uv),u_mix); }`,
  u: (p, c) => ({ u_sh: [(p.shift[0] + p.spd[0] * c.lt) * c.s / Math.max(1, c.hw) , -(p.shift[1] + p.spd[1] * c.lt) * c.s / Math.max(1, c.hh)], u_mix: p.mix / 100 }) });

def('oscillate', { name: 'Oscillate', cat: 'move', desc: 'Moves the layer back and forth in a smooth repeating wave.', tags: ['Auto', 'Transform', 'Property Adjust'],
  params: { angle: ang('Direction', 0), mag: px('Magnitude', 120, 0, 4000), freq: hz('Frequency', 1), phase: ang('Phase', 0), type: waveSel(), decay: pct('Decay', 0, 0, 100) },
  xf(tr, p, c) { const w = wave(p.type, c.lt * p.freq + p.phase / 360) * p.mag * Math.exp(-c.lt * p.decay / 25); tr.x += Math.cos(p.angle * D) * w; tr.y += Math.sin(p.angle * D) * w; } });

def('pulsesize', { name: 'Pulse Size', cat: 'move', desc: 'Makes the layer grow and shrink rhythmically, like a heartbeat.', tags: ['Auto', 'Transform', 'Property Adjust'],
  params: { amt: pct('Amount', 15, 0, 500), freq: hz('Frequency', 2), phase: ang('Phase', 0), type: waveSel(), beat: bool('Heartbeat', false) },
  xf(tr, p, c) { let w; const ph = c.lt * p.freq + p.phase / 360;
    if (p.beat) { const f = ph - Math.floor(ph); w = Math.exp(-Math.pow((f - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((f - 0.3) / 0.05, 2)); } else w = (wave(p.type, ph) + 1) / 2;
    tr.scale *= 1 + w * p.amt / 100; } });

def('randdisp', { name: 'Random Displacement', cat: 'move', desc: 'Jumps the layer to new random positions at a steady rate.', tags: ['Auto', 'Transform'],
  params: { mag: vec2('Magnitude', [160, 160], 4000), rate: hz('Rate', 2), smooth: bool('Smooth', true), seed: seed() },
  xf(tr, p, c) { const t = c.lt * p.rate, i = Math.floor(t), f = t - i, s = p.seed * 13.1; const r = k => [rand1(k * 7.13 + s) * 2 - 1, rand1(k * 3.71 + s + 50) * 2 - 1];
    let a = r(i); if (p.smooth) { const b = r(i + 1), e = f * f * (3 - 2 * f); a = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; }
    tr.x += a[0] * p.mag[0]; tr.y += a[1] * p.mag[1]; } });

def('jitter', { name: 'Random Jitter', cat: 'move', desc: 'Adds jerky, stop-motion style jitter to position, rotation and scale.', tags: ['Auto', 'Transform'],
  params: { posn: px('Position', 14, 0, 1000), rot: num('Rotation', 4, 0, 180, { unit: '°', step: 0.1 }), sc: pct('Scale', 4, 0, 100), rate: num('Rate', 12, 0.1, 60, { unit: 'fps', step: 0.1 }), seed: seed() },
  xf(tr, p, c) { const i = Math.floor(c.lt * p.rate) + p.seed * 101, r = k => rand1(i * 1.618 + k) * 2 - 1;
    tr.x += r(1) * p.posn; tr.y += r(2) * p.posn; tr.rotation += r(3) * p.rot; tr.scale *= 1 + r(4) * p.sc / 100; } });

def('rastertransform', { name: 'Raster Transform', cat: 'move', desc: 'Moves, scales and rotates the rendered layer after its other effects.', tags: ['Transform', 'Raster'],
  params: { off: vec2('Offset', [0, 0]), sc: pct('Scale', 80, 0, 2000), rot: ang('Rotation', 15), anchor: vec2('Anchor', [0, 0]) },
  fs: `uniform vec2 u_off, u_an; uniform float u_sc, u_r; void main(){ vec2 P=v_uv*u_res; vec2 S=u_an+rot2(-u_r)*(P-u_an-u_off)/max(u_sc,1e-4); gl_FragColor=Tp(S); }`,
  u: (p, c) => ({ u_off: [p.off[0] * c.s, -p.off[1] * c.s], u_an: pos(c, p.anchor), u_sc: p.sc / 100, u_r: -p.rot * D }) });

def('scaleassist', { name: 'Scale Assist', cat: 'move', desc: 'Scales the layer with separate horizontal and vertical amounts.', tags: ['Transform', 'Property Adjust'],
  params: { u: pct('Scale', 100, 0, 2000), x: pct('Scale X', 130, -2000, 2000), y: pct('Scale Y', 85, -2000, 2000) },
  xf(tr, p) { tr.scale *= p.u / 100; tr.sx *= p.x / 100; tr.sy *= p.y / 100; } });

def('spin', { name: 'Spin', cat: 'move', desc: 'Spins the layer continuously.', tags: ['Auto', 'Transform', 'Loop'],
  params: { spd: num('Speed', 90, -3600, 3600, { unit: '°/s', step: 0.1 }), angle: ang('Start Angle', 0) },
  xf(tr, p, c) { tr.rotation += p.angle + p.spd * c.lt; } });

def('stretchaxis', { name: 'Stretch Axis', cat: 'move', desc: 'Stretches the layer along any angle.', tags: ['Transform', 'Raster'],
  params: { angle: ang('Angle', 30), amt: pct('Stretch', 150, 1, 1000), keep: bool('Preserve Area', true) },
  fs: `uniform vec2 u_d; uniform float u_a, u_k; void main(){ vec2 d=v_uv*u_res-u_c; vec2 n=vec2(-u_d.y,u_d.x); float x=dot(d,u_d)/u_a, y=dot(d,n)/u_k; gl_FragColor=Tp(u_c+u_d*x+n*y); }`,
  u: p => ({ u_d: dir(p.angle), u_a: p.amt / 100, u_k: p.keep ? 1 / Math.sqrt(p.amt / 100) : 1 }) });

def('swing', { name: 'Swing', cat: 'move', desc: 'Swings the layer back and forth like a pendulum.', tags: ['Auto', 'Transform', 'Property Adjust'],
  params: { amp: num('Angle', 25, 0, 360, { unit: '°', step: 0.1 }), freq: hz('Frequency', 1), phase: ang('Phase', 0), decay: pct('Decay', 0), pivot: sel('Pivot', 'top', [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]) },
  xf(tr, p, c) { const a = Math.sin((c.lt * p.freq + p.phase / 360) * Math.PI * 2) * p.amp * Math.exp(-c.lt * p.decay / 25); const h = (c.bh || 0) / 2 * tr.scale * tr.sy;
    const py = p.pivot === 'top' ? -h : p.pivot === 'bottom' ? h : 0; if (py) { const r0 = tr.rotation * D, r1 = (tr.rotation + a) * D;
      const px0 = -Math.sin(r0) * py, py0 = Math.cos(r0) * py, px1 = -Math.sin(r1) * py, py1 = Math.cos(r1) * py; tr.x += px0 - px1; tr.y += py0 - py1; }
    tr.rotation += a; } });

// ---------------- Repeat (GPU copies) ----------------
shader('copies', `uniform vec4 u_m[48]; uniform vec4 u_t[48]; uniform float u_n; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.);
  for(int i=0;i<48;i++){ if(float(i)>=u_n) break; vec4 m=u_m[i], t=u_t[i]; vec2 S=vec2(m.x*P.x+m.z*P.y, m.y*P.x+m.w*P.y)+t.xy; vec4 s=Tp(S)*t.z; acc+=s*(1.-acc.a); if(acc.a>0.997) break; }
  gl_FragColor=acc; }`);
// copies: [{dx, dy (comp px, y down), rot (deg clockwise), sc, op, ax, ay (pivot, comp px offset)}] front first
function runCopies(g, cur, c, copies) {
  const n = Math.min(48, copies.length), M = new Float32Array(48 * 4), Tt = new Float32Array(48 * 4);
  for (let i = 0; i < n; i++) { const k = copies[i]; const a = k.rot * D, s = Math.max(1e-4, k.sc), ca = Math.cos(a) / s, sa = Math.sin(a) / s; // GL inverse rotation of a clockwise turn
    const m = [ca, -sa, sa, ca]; const cx = c.cx + (k.ax || 0) * c.s, cy = c.cy - (k.ay || 0) * c.s; const ox = cx + k.dx * c.s, oy = cy - k.dy * c.s;
    // S = M (P - O) + C  -> t = C - M O ; mat2 columns (m.x m.y) (m.z m.w)
    M.set([m[0], m[1], m[2], m[3]], i * 4); Tt.set([cx - (m[0] * ox + m[2] * oy), cy - (m[1] * ox + m[3] * oy), k.op ?? 1, 0], i * 4); }
  return g.run('copies', { u_m: { f4: M }, u_t: { f4: Tt }, u_n: n });
}
const order = () => sel('Order', 'front', [['front', 'First on Top'], ['back', 'Last on Top']]);
const ord = (list, p) => (p.order === 'back' ? list.reverse() : list);

def('gridrepeat', { name: 'Grid Repeat', cat: 'repeat', desc: 'Repeats the layer in a grid of rows and columns.',
  params: { cols: num('Columns', 4, 1, 40, { step: 1 }), rows: num('Rows', 4, 1, 40, { step: 1 }), sp: vec2('Spacing', [180, 180], 4000), stagger: pct('Row Offset', 0, -100, 100), sc: pct('Copy Scale', 100, 1, 400) },
  fs: `uniform vec2 u_n, u_sp; uniform float u_stg, u_sc; void main(){ vec2 d=v_uv*u_res-u_c; vec2 h=(u_n-1.)*0.5; vec4 acc=vec4(0.); vec2 kk=ceil(u_hs*u_sc/max(abs(u_sp),vec2(1.)))+0.;
  float jy0=floor(d.y/u_sp.y+h.y+0.5); for(int y=-3;y<=3;y++){ float j=jy0+float(y); if(j<0.||j>u_n.y-1.||abs(float(y))>kk.y) continue; float ox=u_stg*mod(j,2.)*u_sp.x;
    float ix0=floor((d.x-ox)/u_sp.x+h.x+0.5); for(int x=-3;x<=3;x++){ float i=ix0+float(x); if(i<0.||i>u_n.x-1.||abs(float(x))>kk.x) continue; vec2 o=vec2((i-h.x)*u_sp.x+ox,(j-h.y)*u_sp.y);
      vec4 s=Tp(u_c+(d-o)/u_sc); acc+=s*(1.-acc.a); } } gl_FragColor=acc; }`,
  u: (p, c) => ({ u_n: [Math.round(p.cols), Math.round(p.rows)], u_sp: [p.sp[0] * c.s, -p.sp[1] * c.s], u_stg: p.stagger / 100, u_sc: p.sc / 100 }) });

def('linearrepeat', { name: 'Linear Repeat', cat: 'repeat', desc: 'Repeats the layer in a line, each copy offset from the last.',
  params: { n: num('Count', 5, 1, 48, { step: 1 }), off: vec2('Offset', [150, 0], 4000), sc: pct('Scale per Copy', 100, 1, 400), rot: ang('Rotation per Copy', 0), op: pct('End Opacity', 100), align: sel('Alignment', 'center', [['start', 'Start'], ['center', 'Center']]), order: order() },
  run(g, cur, p, c) { const n = Math.round(p.n), list = []; const sh = p.align === 'center' ? (n - 1) / 2 : 0;
    for (let i = 0; i < n; i++) { const k = i - sh; list.push({ dx: p.off[0] * k, dy: p.off[1] * k, rot: p.rot * k, sc: Math.pow(p.sc / 100, i), op: n > 1 ? 1 + (p.op / 100 - 1) * i / (n - 1) : 1 }); }
    return runCopies(g, cur, c, ord(list, p)); } });

def('radialrepeat', { name: 'Radial Repeat', cat: 'repeat', desc: 'Repeats the layer evenly around a circle.',
  params: { n: num('Count', 8, 1, 48, { step: 1 }), r: px('Radius', 260, 0, 5000), start: ang('Start Angle', 0), sweep: num('Sweep', 360, -720, 720, { unit: '°', step: 0.1 }), orient: bool('Rotate Copies', true), sc: pct('Copy Scale', 100, 1, 400), order: order() },
  run(g, cur, p, c) { const n = Math.round(p.n), full = Math.abs(Math.abs(p.sweep) - 360) < 1e-3, list = [];
    for (let i = 0; i < n; i++) { const a = p.start + p.sweep * (full ? i / n : n > 1 ? i / (n - 1) : 0); list.push({ dx: Math.cos((a - 90) * D) * p.r, dy: Math.sin((a - 90) * D) * p.r, rot: p.orient ? a : 0, sc: p.sc / 100 }); }
    return runCopies(g, cur, c, ord(list, p)); } });

def('repeat', { name: 'Repeat', cat: 'repeat', desc: 'Repeats the layer with a compounding offset, scale and rotation (like a repeater).',
  params: { n: num('Copies', 6, 1, 48, { step: 1 }), off: vec2('Position', [60, 0], 4000), sc: pct('Scale', 88, 1, 400), rot: ang('Rotation', 18), op: pct('Opacity Falloff', 10), anchor: vec2('Anchor', [0, 0]), order: order() },
  run(g, cur, p, c) { const n = Math.round(p.n), list = []; let x = 0, y = 0, a = 0, s = 1, o = 1;
    for (let i = 0; i < n; i++) { list.push({ dx: x, dy: y, rot: a, sc: s, op: o, ax: p.anchor[0], ay: p.anchor[1] });
      const ar = a * D, rx = p.off[0] * Math.cos(ar) - p.off[1] * Math.sin(ar), ry = p.off[0] * Math.sin(ar) + p.off[1] * Math.cos(ar); x += rx * s; y += ry * s; a += p.rot; s *= p.sc / 100; o *= 1 - p.op / 100; }
    return runCopies(g, cur, c, ord(list, p)); } });

def('repeatpath', { name: 'Repeat Along Path', cat: 'repeat', desc: 'Places copies of the layer along a path.', tags: ['Repeat', 'Path', 'Layer Parenting'],
  params: { n: num('Count', 12, 1, 48, { step: 1 }), path: lay('Path Layer'), shape: pathShape(), radius: px('Path Size', 300, 1, 5000), start: pct('Start', 0), end: pct('End', 100), off: pct('Offset', 0, -1000, 1000), spd: num('Speed', 0, -10, 10, { unit: 'Hz', step: 0.01 }), orient: bool('Orient to Path', true), sc: pct('Copy Scale', 50, 1, 400) },
  run(g, cur, p, c) { const P = getPath(p, c, c.base.x, c.base.y); const n = Math.round(p.n), list = [];
    for (let i = 0; i < n; i++) { const u = (p.start + (p.end - p.start) * (P.closed && p.end - p.start >= 100 ? i / n : n > 1 ? i / (n - 1) : 0) + p.off) / 100 + c.lt * p.spd;
      const q = pathPoint(P.pts, P.closed, u); list.push({ dx: q.x - c.base.x, dy: q.y - c.base.y, rot: p.orient ? q.a : 0, sc: p.sc / 100 }); }
    return runCopies(g, cur, c, list); } });

def('scatterfield', { name: 'Scatter Field', cat: 'repeat', desc: 'Scatters many copies of the layer over a field, drifting with random size and spin.',
  params: { n: num('Count', 30, 1, 48, { step: 1 }), w: px('Field Width', 1000, 1, 8000), h: px('Field Height', 1700, 1, 8000), smin: pct('Min Scale', 25, 1, 400), smax: pct('Max Scale', 70, 1, 400), rot: num('Random Rotation', 180, 0, 360, { unit: '°', step: 0.1 }),
    drift: vec2('Drift', [0, -60], 4000, { unit: 'px/s' }), spin: num('Spin', 20, -720, 720, { unit: '°/s', step: 0.1 }), seed: seed() },
  run(g, cur, p, c) { const n = Math.round(p.n), list = [], r = k => rand1(k * 12.9898 + p.seed * 78.233);
    for (let i = 0; i < n; i++) { const fx = r(i * 4 + 1), fy = r(i * 4 + 2), s = p.smin + (p.smax - p.smin) * r(i * 4 + 3), sd = r(i * 4 + 4) * 2 - 1;
      let x = fx * p.w + p.drift[0] * c.lt * (0.6 + 0.8 * fy), y = fy * p.h + p.drift[1] * c.lt * (0.6 + 0.8 * fx); x = ((x % p.w) + p.w) % p.w - p.w / 2; y = ((y % p.h) + p.h) % p.h - p.h / 2;
      list.push({ dx: x, dy: y, rot: sd * p.rot + p.spin * c.lt * sd, sc: s / 100 }); }
    list.sort((a, b) => b.sc - a.sc); return runCopies(g, cur, c, list); } });

def('scatterrepeat', { name: 'Scatter Repeat', cat: 'repeat', desc: 'Scatters copies of the layer randomly around it.',
  params: { n: num('Count', 12, 1, 48, { step: 1 }), r: px('Radius', 380, 0, 5000), sv: pct('Scale Variance', 50), rv: num('Rotation Variance', 90, 0, 360, { unit: '°', step: 0.1 }), ov: pct('Opacity Variance', 0), sc: pct('Copy Scale', 60, 1, 400), seed: seed() },
  run(g, cur, p, c) { const n = Math.round(p.n), list = [], r = k => rand1(k * 7.77 + p.seed * 3.3 + 0.5);
    for (let i = 0; i < n; i++) { const a = r(i * 5 + 1) * Math.PI * 2, d = Math.sqrt(r(i * 5 + 2)) * p.r; list.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, rot: (r(i * 5 + 3) * 2 - 1) * p.rv,
      sc: p.sc / 100 * (1 - p.sv / 100 * r(i * 5 + 4)), op: 1 - p.ov / 100 * r(i * 5 + 5) }); }
    return runCopies(g, cur, c, list); } });

// ---------------- Matte / Mask / Key ----------------
const KEY = `vec2 cbcr(vec3 c){ return vec2(-0.168736*c.r-0.331264*c.g+0.5*c.b, 0.5*c.r-0.418688*c.g-0.081312*c.b); }`;
shader('keyer', KEY + `uniform vec3 u_key; uniform float u_tol, u_soft, u_spill, u_adv; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec2 k=cbcr(u_key), q=cbcr(r);
  float d=distance(q,k); float kl=length(k); if(u_adv>0.5){ float al=dot(q,k)/max(kl,1e-4); float pe=length(q-k*al/max(kl,1e-4)); d=mix(d, max(kl-al,0.)+pe*0.6, 0.6); }
  float a=smoothstep(u_tol, u_tol+u_soft+1e-4, d); vec3 o=r; if(u_spill>0.){ vec2 kn=k/max(kl,1e-4); float sp=max(dot(q,kn),0.)*(1.-a*0.5); vec2 q2=q-kn*sp*u_spill;
    float y=dot(r,vec3(0.299,0.587,0.114)); o=vec3(y+1.402*q2.y, y-0.344136*q2.x-0.714136*q2.y, y+1.772*q2.x); }
  float na=c.a*a; gl_FragColor=vec4(clamp(o,0.,1.)*na, na); }`);
shader('choke', `uniform sampler2D u_b; uniform float u_lv, u_w; void main(){ vec4 c=T(v_uv); vec4 b=texture2D(u_b,v_uv); float a=smoothstep(u_lv-u_w,u_lv+u_w,b.a); vec3 col = c.a>0.01 ? unp(c) : unp(b); gl_FragColor=vec4(col*a,a); }`);
function choke(g, cur, c, amt, soft) { const r = Math.abs(amt) * c.s + soft * c.s + 1; const b = g.blur(cur, r); return g.pass('choke', { u_tex: cur, u_b: b }, { u_lv: 0.5 + Math.sign(amt) * Math.min(0.45, Math.abs(amt) * c.s / (2 * r) * 1.6), u_w: Math.max(0.02, soft * c.s / (2 * r) + 0.5 / r) }); }
def('advchromakey', { name: 'Advanced Chroma Key', cat: 'matte', desc: 'Pulls a clean key from a green or blue screen, with spill suppression and matte choke.',
  params: { key: col('Key Color', '#1fd655'), tol: pct('Tolerance', 22), soft: pct('Softness', 14), spill: pct('Spill Suppression', 70), chk: px('Matte Choke', 0, -50, 50, { step: 0.1 }), msoft: px('Matte Softness', 1, 0, 50, { step: 0.1 }) },
  sample: 'green',
  run(g, cur, p, c) { const k = g.run('keyer', { u_key: hex3(p.key), u_tol: p.tol / 100 * 0.5, u_soft: p.soft / 100 * 0.5, u_spill: p.spill / 100, u_adv: 1 }); return p.chk || p.msoft > 1 ? choke(g, k, c, p.chk, p.msoft) : k; } });
def('chromakey', { name: 'Chroma Key', cat: 'matte', desc: 'Makes one colour transparent (green screen).', sample: 'green',
  params: { key: col('Key Color', '#1fd655'), tol: pct('Tolerance', 25), soft: pct('Softness', 10) },
  run(g, cur, p) { return g.run('keyer', { u_key: hex3(p.key), u_tol: p.tol / 100 * 0.5, u_soft: p.soft / 100 * 0.5, u_spill: 0, u_adv: 0 }); } });
def('spillcleaner', { name: 'Key Spill Cleaner', cat: 'matte', desc: 'Removes the green or blue colour cast that a screen leaves on the subject.', sample: 'green',
  params: { key: col('Key Color', '#1fd655'), amt: pct('Amount', 100, 0, 200) },
  run(g, cur, p) { return g.run('keyer', { u_key: hex3(p.key), u_tol: -1, u_soft: 0.0001, u_spill: p.amt / 100, u_adv: 0 }); } });
def('lumakey', { name: 'Luma Key', cat: 'matte', desc: 'Makes dark or bright areas transparent.',
  params: { mode: sel('Key Out', 'dark', [['dark', 'Darker Areas'], ['bright', 'Brighter Areas']]), thr: pct('Threshold', 35), soft: pct('Softness', 10) },
  fs: `uniform float u_br, u_t, u_sf; void main(){ vec4 c=T(v_uv); float l=luma(unp(c)); float a=smoothstep(u_t-u_sf*0.5-1e-3,u_t+u_sf*0.5+1e-3,l); if(u_br>0.5) a=1.-a; gl_FragColor=c*a; }`,
  u: p => ({ u_br: p.mode === 'bright', u_t: p.thr / 100, u_sf: p.soft / 100 }) });
def('lumastamp', { name: 'Luma Stamper', cat: 'matte', desc: 'Stamps the brightness of the layer into its transparency (luma matte).',
  params: { inv: bool('Invert', false), mode: sel('Color', 'keep', [['keep', 'Keep Colors'], ['solid', 'Solid Color']]), color: col('Solid Color', '#ffffff'), gamma: num('Gamma', 1, 0.1, 5, { step: 0.01 }) },
  fs: `uniform float u_inv, u_mode, u_g; uniform vec3 u_col; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=pow(luma(r),u_g); if(u_inv>0.5) l=1.-l; float a=c.a*l; vec3 o=u_mode>0.5?u_col:r; gl_FragColor=vec4(o*a,a); }`,
  u: p => ({ u_inv: p.inv, u_mode: p.mode === 'solid', u_col: hex3(p.color), u_g: p.gamma }) });
def('matechoker', { name: 'Matte Choker', cat: 'matte', desc: 'Shrinks or spreads the edges of the layer’s transparency.',
  params: { amt: px('Choke', 6, -100, 100, { step: 0.1 }), soft: px('Softness', 1, 0, 100, { step: 0.1 }) },
  run(g, cur, p, c) { return choke(g, cur, c, p.amt, p.soft); } });
shader('fringe', `uniform sampler2D u_b; uniform float u_mix, u_sh; void main(){ vec4 c=T(v_uv); vec4 b=texture2D(u_b,v_uv); float e=(1.-c.a)*step(0.001,c.a); vec3 col=mix(unp(c), unp(b), clamp(e*2.,0.,1.)*u_mix); float a=clamp((c.a-u_sh)/(1.-u_sh),0.,1.); gl_FragColor=vec4(col*a,a); }`);
def('mattefringe', { name: 'Matte Fringe', cat: 'matte', desc: 'Cleans coloured fringes from soft edges by pulling colour in from inside.',
  params: { w: px('Width', 4, 0.5, 100, { step: 0.1 }), mix: pct('Amount', 100), shrink: pct('Edge Shrink', 10, 0, 90) }, sample: 'green',
  run(g, cur, p, c) { const b = g.blur(cur, p.w * c.s); return g.pass('fringe', { u_tex: cur, u_b: b }, { u_mix: p.mix / 100, u_sh: p.shrink / 100 }); } });
def('radialwipe', { name: 'Radial Wipe', cat: 'matte', desc: 'Reveals or hides the layer with a sweeping clock wipe.', tags: ['Mask', 'Transition'],
  params: { comp: pct('Completion', 40), start: ang('Start Angle', 0), center: vec2('Center', [0, 0]), fea: num('Feather', 2, 0, 180, { unit: '°', step: 0.1 }), dirn: sel('Direction', 'cw', [['cw', 'Clockwise'], ['ccw', 'Counterclockwise'], ['both', 'Both']]) },
  fs: `uniform float u_comp, u_st, u_fe, u_dir; uniform vec2 u_cen; void main(){ vec4 c=T(v_uv); vec2 d=v_uv*u_res-u_cen; float a=atan(d.x,d.y); float f=fract((-(a)+PI-u_st)/TAU);
  if(u_dir>0.5&&u_dir<1.5) f=1.-f; if(u_dir>1.5) f=abs(f-0.5)*2.; float fe=max(u_fe,1e-3); float k=smoothstep(u_comp-fe, u_comp+fe, f); if(u_comp<=0.) k=1.; if(u_comp>=1.) k=0.; gl_FragColor=c*k; }`,
  u: (p, c) => ({ u_comp: p.comp / 100, u_st: p.start * D, u_fe: p.fea / 360, u_dir: ['cw', 'ccw', 'both'].indexOf(p.dirn), u_cen: pos(c, p.center) }) });
def('solidmatte', { name: 'Solid Matte', cat: 'matte', desc: 'Removes partial transparency so the matte is fully solid or fully clear.',
  params: { thr: pct('Threshold', 50), soft: pct('Softness', 2) },
  fs: `uniform float u_t, u_sf; void main(){ vec4 c=T(v_uv); float a=smoothstep(u_t-u_sf-1e-3,u_t+u_sf+1e-3,c.a); gl_FragColor=vec4(unp(c)*a,a); }`, u: p => ({ u_t: p.thr / 100, u_sf: p.soft / 200 }) });
def('vignette', { name: 'Vignette', cat: 'matte', desc: 'Darkens or fades the edges of the layer.',
  params: { amt: pct('Amount', 70, 0, 100), size: pct('Size', 55, 0, 150), round: pct('Roundness', 60), fea: pct('Feather', 60, 1, 100), color: col('Color', '#000000'), mode: sel('Mode', 'color', [['color', 'Color'], ['alpha', 'Transparency']]) },
  fs: `uniform float u_a, u_sz, u_rd, u_fe, u_mode; uniform vec3 u_col; void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res); vec2 asp=mix(vec2(1.), normalize(u_hs)*1.41421, u_rd); q*=asp;
  float e=mix(max(abs(q.x),abs(q.y)), length(q), u_rd); float k=smoothstep(u_sz, u_sz+u_fe, e)*u_a; gl_FragColor = u_mode>0.5 ? c*(1.-k) : vec4(mix(c.rgb, u_col*c.a, k), c.a); }`,
  u: p => ({ u_a: p.amt / 100, u_sz: p.size / 100, u_rd: p.round / 100, u_fe: p.fea / 100, u_col: hex3(p.color), u_mode: p.mode === 'alpha' }) });
def('wipe', { name: 'Wipe', cat: 'matte', desc: 'Reveals or hides the layer with a straight wipe.', tags: ['Mask', 'Transition'],
  params: { comp: pct('Completion', 40), angle: ang('Wipe Angle', 0), fea: px('Feather', 20, 0, 2000) },
  fs: `uniform float u_comp, u_fe; uniform vec2 u_d; void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res)*u_hs; float ex=abs(u_d.x)*u_hs.x+abs(u_d.y)*u_hs.y+u_fe; float x=dot(q,u_d);
  float edge=-ex+2.*ex*u_comp; float k=smoothstep(edge-u_fe*0.5-0.5, edge+u_fe*0.5+0.5, x); gl_FragColor=c*k; }`,
  u: (p, c) => ({ u_comp: p.comp / 100, u_fe: p.fea * c.s, u_d: dir(p.angle) }) });

// ---------------- Opacity / Visibility ----------------
def('blink', { name: 'Blink', cat: 'opacity', desc: 'Switches the layer on and off at a steady rate.', tags: ['Auto', 'Opacity'],
  params: { freq: hz('Frequency', 2), duty: pct('On Time', 50, 1, 99), min: pct('Off Opacity', 0), smooth: pct('Smoothness', 0) },
  xf(tr, p, c) { const f = (c.lt * p.freq) % 1, s = Math.max(0.0001, p.smooth / 200), d = p.duty / 100; const on = f < d ? Math.min(1, f / s, (d - f) / s) : 0;
    tr.opacity *= p.min / 100 + (1 - p.min / 100) * Math.max(0, Math.min(1, p.smooth ? on : f < d ? 1 : 0)); } });
def('blockdissolve', { name: 'Block Dissolve', cat: 'opacity', desc: 'Makes the layer disappear in random blocks.', tags: ['Transition', 'Opacity'],
  params: { comp: pct('Completion', 45), bw: px('Block Width', 32, 1, 1000), bh: px('Block Height', 32, 1, 1000), fea: pct('Feather', 0), seed: seed() },
  fs: `uniform float u_comp, u_fe, u_seed; uniform vec2 u_b; void main(){ vec4 c=T(v_uv); vec2 id=floor((v_uv*u_res-u_c)/u_b); float r=h12(id+u_seed*3.1); float f=max(u_fe,1e-3)*0.5;
  float k=smoothstep(u_comp-f,u_comp+f,r*(1.-f*2.)+f); gl_FragColor=c*(u_comp<=0.?1.:u_comp>=1.?0.:k); }`,
  u: (p, c) => ({ u_comp: p.comp / 100, u_fe: p.fea / 100, u_b: [p.bw * c.s, p.bh * c.s], u_seed: p.seed }) });
def('dissolve', { name: 'Dissolve', cat: 'opacity', desc: 'Dissolves the layer away in a noisy pattern.', tags: ['Transition', 'Opacity'],
  params: { comp: pct('Completion', 45), size: px('Grain Size', 3, 0.5, 400, { step: 0.1 }), soft: pct('Softness', 10), pat: sel('Pattern', 'noise', [['noise', 'Grain'], ['smooth', 'Smooth Noise']]), edge: col('Edge Color', '#ff9a3c'), ew: pct('Edge Glow', 0), seed: seed() },
  fs: `uniform float u_comp, u_sz, u_soft, u_pat, u_seed, u_ew; uniform vec3 u_ec; void main(){ vec4 c=T(v_uv); vec2 P=(v_uv*u_res-u_c)/u_sz; float r = u_pat<0.5 ? h12(floor(P)+u_seed) : fbm(vec3(P*0.05,u_seed),5.);
  if(u_pat>0.5) r=clamp((r-0.5)*2.2+0.5,0.,1.); float s=u_soft*0.5+1e-3; float v=mix(-s,1.+s,u_comp); float k=smoothstep(v-s,v+s,r); float edge=(1.-smoothstep(0.,s*1.5+0.02,abs(r-v)))*u_ew*step(0.001,u_comp);
  vec4 o=c*k; o.rgb=min(o.rgb+u_ec*edge*c.a*k*1.5, vec3(o.a)); gl_FragColor=o; }`,
  u: (p, c) => ({ u_comp: p.comp / 100, u_sz: Math.max(0.5, p.size * c.s), u_soft: p.soft / 100, u_pat: p.pat === 'smooth', u_seed: p.seed, u_ew: p.ew / 100, u_ec: hex3(p.edge) }) });
def('fadeinout', { name: 'Fade In/Out', cat: 'opacity', desc: 'Fades the layer in at its start and out at its end.', tags: ['Transition', 'Opacity', 'Auto'],
  params: { fin: sec('Fade In', 0.6, 30), fout: sec('Fade Out', 0.6, 30), ease: bool('Ease', true) },
  xf(tr, p, c) { const e = v => (p.ease ? v * v * (3 - 2 * v) : v); let k = 1; if (p.fin > 0) k *= e(Math.max(0, Math.min(1, c.lt / p.fin))); if (p.fout > 0) k *= e(Math.max(0, Math.min(1, (c.dur - c.lt) / p.fout))); tr.opacity *= k; } });
shader('feather', `uniform sampler2D u_b; void main(){ vec4 c=T(v_uv); float b=texture2D(u_b,v_uv).a; float k=clamp((b-0.5)*2.,0.,1.); k=k*k*(3.-2.*k); gl_FragColor=c*k; }`);
def('feather', { name: 'Feather', cat: 'opacity', desc: 'Softens the edges of the layer inward.', tags: ['Opacity', 'Mask'],
  params: { r: px('Feather', 30, 0, 1000) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('feather', { u_tex: cur, u_b: b }); } });
def('flicker', { name: 'Flicker', cat: 'opacity', desc: 'Flickers the opacity of the layer like a faulty light.', tags: ['Auto', 'Opacity'],
  params: { amt: pct('Amount', 70), freq: hz('Frequency', 8, 60), smooth: pct('Smoothness', 30), seed: seed() },
  xf(tr, p, c) { const t = c.lt * p.freq, i = Math.floor(t), f = t - i, s = p.seed * 17.7; const a = rand1(i + s), b = rand1(i + 1 + s); const e = p.smooth / 100, u = e > 0 ? Math.min(1, f / e) : 1;
    const v = a + (b - a) * (u * u * (3 - 2 * u)); const r = v > 0.5 ? 1 : v * 2; tr.opacity *= 1 - p.amt / 100 * (1 - r); } });
def('pulseopacity', { name: 'Pulse Opacity', cat: 'opacity', desc: 'Pulses the opacity of the layer up and down.', tags: ['Auto', 'Opacity'],
  params: { min: pct('Minimum', 15), max: pct('Maximum', 100), freq: hz('Frequency', 1), phase: ang('Phase', 0), type: waveSel() },
  xf(tr, p, c) { const w = (wave(p.type, c.lt * p.freq + p.phase / 360) + 1) / 2; tr.opacity *= (p.min + (p.max - p.min) * w) / 100; } });

// ---------------- Text (operate on the text before it is drawn) ----------------
const fmtNum = (v, dec, sep) => { const s = v.toFixed(Math.max(0, Math.round(dec))); if (!sep) return s; const [i, d] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
def('countupdown', { name: 'Count Up/Down', cat: 'text', desc: 'Turns the text into a number that counts from one value to another.', kind: 'text', sample: 'text',
  params: { from: num('Start Value', 0, -1e6, 1e6, { step: 1 }), to: num('End Value', 100, -1e6, 1e6, { step: 1 }), dec: num('Decimal Places', 0, 0, 6, { step: 1 }), sep: bool('Thousands Separator', true), timing: timing(), prog: pct('Progress', 100) },
  text(tx, p, c) { const u = progOf(p, c), v = p.from + (p.to - p.from) * u; const n = fmtNum(v, p.dec, p.sep); tx.content = tx.content.includes('#') ? tx.content.replace(/#+/, n) : n; } });
def('textprogress', { name: 'Text Progress', cat: 'text', desc: 'Types the text on character by character (or by word or line).', kind: 'text', sample: 'text',
  params: { timing: timing(), prog: pct('Progress', 60), unit: sel('Unit', 'char', [['char', 'Characters'], ['word', 'Words'], ['line', 'Lines']]), fade: num('Fade', 2, 0, 20, { step: 0.1 }), rev: bool('Reverse', false) },
  text(tx, p, c) { const u = progOf(p, c), s = tx.content, chars = [...s]; let groups = [];
    if (p.unit === 'char') groups = chars.map((_, i) => i); else { let g = 0; chars.forEach((ch, i) => { groups.push(g); if ((p.unit === 'word' && ch === ' ') || ch === '\n') g++; }); }
    const n = Math.max(1, groups[groups.length - 1] + 1); const f = Math.max(0.0001, p.fade); const pos_ = u * (n + f);
    tx.alpha = groups.map(gi => { const k = p.rev ? n - 1 - gi : gi; return Math.max(0, Math.min(1, (pos_ - k) / f)); }); } });
const CHARSETS = { letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', numbers: '0123456789', symbols: '#$%&@*+=?!<>/\\', binary: '01', mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@' };
def('textrandom', { name: 'Text Randomizer', cat: 'text', desc: 'Scrambles the text into random characters that settle into the real text.', kind: 'text', sample: 'text',
  params: { timing: timing(), prog: pct('Progress', 50), set: sel('Characters', 'mixed', Object.keys(CHARSETS).map(k => [k, k[0].toUpperCase() + k.slice(1)])), rate: num('Rate', 18, 1, 60, { unit: 'fps', step: 0.1 }), seed: seed() },
  text(tx, p, c) { const u = progOf(p, c), chars = [...tx.content], n = chars.length, cs = CHARSETS[p.set] || CHARSETS.mixed, fr = Math.floor(c.lt * p.rate);
    tx.content = chars.map((ch, i) => (/\s/.test(ch) || i < u * (n + 1) - 0.5 ? ch : cs[Math.floor(rand1(i * 13.1 + fr * 7.7 + p.seed) * cs.length)])).join(''); } });
def('textspacing', { name: 'Text Spacing', cat: 'text', desc: 'Animates the letter spacing and line spacing of the text.', kind: 'text', sample: 'text',
  params: { tr: num('Letter Spacing', 40, -100, 500, { step: 0.1 }), lh: pct('Line Spacing', 100, 10, 500) },
  text(tx, p) { tx.tracking = (tx.tracking || 0) + p.tr / 100; tx.lineHeight = tx.lineHeight * p.lh / 100; } });
def('texttransform', { name: 'Text Transform', cat: 'text', desc: 'Animates each character in turn from an offset position, rotation, scale and opacity.', kind: 'text', sample: 'text',
  params: { timing: timing(), prog: pct('Progress', 50), off: vec2('Position', [0, -80], 4000), rot: ang('Rotation', 0), sc: pct('Scale', 100, 0, 1000), op: pct('Opacity', 0), spread: num('Spread', 4, 0.1, 50, { step: 0.1 }), order: sel('Order', 'fwd', [['fwd', 'Forward'], ['back', 'Backward'], ['rand', 'Random']]) },
  text(tx, p, c) { const u = progOf(p, c), n = [...tx.content].length, sp = Math.max(0.1, p.spread); const pos_ = u * (n + sp);
    tx.chars = [...tx.content].map((_, i) => { const k = p.order === 'back' ? n - 1 - i : p.order === 'rand' ? Math.floor(rand1(i * 9.1) * n) : i; let e = Math.max(0, Math.min(1, (pos_ - k) / sp)); e = 1 - Math.pow(1 - e, 3); const r = 1 - e;
      return { dx: p.off[0] * r, dy: p.off[1] * r, rot: p.rot * r, sc: 1 + (p.sc / 100 - 1) * r, op: 1 + (p.op / 100 - 1) * r }; }); } });
def('timecode', { name: 'Timecode', cat: 'text', desc: 'Displays the current time as a running timecode.', kind: 'text', sample: 'text',
  params: { fmt: sel('Format', 'tc', [['tc', 'HH:MM:SS:FF'], ['mmss', 'MM:SS.ms'], ['sec', 'Seconds'], ['frames', 'Frames']]), src: sel('Time Source', 'project', [['project', 'Project Time'], ['layer', 'Layer Time']]), off: num('Offset', 0, -3600, 3600, { unit: 's', step: 0.01 }) },
  text(tx, p, c) { const fps = c.fps || 30, t = Math.max(0, (p.src === 'layer' ? c.lt : c.t) + p.off), z = (v, n = 2) => String(Math.floor(v)).padStart(n, '0'); let s;
    if (p.fmt === 'tc') s = `${z(t / 3600)}:${z(t / 60 % 60)}:${z(t % 60)}:${z(Math.floor(t * fps + 1e-6) % fps)}`; else if (p.fmt === 'mmss') s = `${z(t / 60)}:${z(t % 60)}.${z((t % 1) * 100)}`;
    else if (p.fmt === 'sec') s = t.toFixed(2) + 's'; else s = String(Math.floor(t * fps + 1e-6)); tx.content = s; } });

// ---------------- Other ----------------
const SRC = [['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['a', 'Alpha'], ['l', 'Luminance'], ['h', 'Hue'], ['s', 'Saturation'], ['v', 'Value'], ['0', 'Zero'], ['1', 'Full']];
const SI = Object.fromEntries(SRC.map((s, i) => [s[0], i]));
const PICK = `float pick(float k, vec3 r, float a, vec3 h){ if(k<0.5) return r.r; if(k<1.5) return r.g; if(k<2.5) return r.b; if(k<3.5) return a; if(k<4.5) return luma(r); if(k<5.5) return h.x; if(k<6.5) return h.y; if(k<7.5) return h.z; if(k<8.5) return 0.; return 1.; }`;
def('chremaphsv', { name: 'Channel Remap (HSV)', cat: 'other', desc: 'Rebuilds hue, saturation and value from any channel of the layer.',
  params: { h: sel('Hue From', 'l', SRC), s: sel('Saturation From', 's', SRC), v: sel('Value From', 'v', SRC), hoff: ang('Hue Offset', 0) },
  fs: PICK + `uniform vec3 u_k; uniform float u_ho; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec3 h=rgb2hsv(r); vec3 o=vec3(pick(u_k.x,r,c.a,h)+u_ho, pick(u_k.y,r,c.a,h), pick(u_k.z,r,c.a,h)); gl_FragColor=pm(hsv2rgb(vec3(fract(o.x),clamp(o.yz,0.,1.))),c.a); }`,
  u: p => ({ u_k: [SI[p.h], SI[p.s], SI[p.v]], u_ho: p.hoff / 360 }) });
def('chremaprgb', { name: 'Channel Remap (RGB)', cat: 'other', desc: 'Rebuilds the red, green, blue and alpha channels from any channel of the layer.',
  params: { r: sel('Red From', 'b', SRC), g: sel('Green From', 'g', SRC), b: sel('Blue From', 'r', SRC), a: sel('Alpha From', 'a', SRC), inv: bool('Invert Color', false) },
  fs: PICK + `uniform vec4 u_k; uniform float u_inv; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec3 h=rgb2hsv(r); vec3 o=vec3(pick(u_k.x,r,c.a,h),pick(u_k.y,r,c.a,h),pick(u_k.z,r,c.a,h)); if(u_inv>0.5) o=1.-o;
  float a=pick(u_k.w,r,c.a,h); a=u_k.w>2.5&&u_k.w<3.5?a:a*step(0.001,c.a)*0.+a; gl_FragColor=pm(o,clamp(a,0.,1.)); }`,
  u: p => ({ u_k: [SI[p.r], SI[p.g], SI[p.b], SI[p.a]], u_inv: p.inv }) });
shader('copybg', `uniform sampler2D u_bd; uniform float u_op; uniform vec2 u_off; void main(){ vec4 c=T(v_uv); vec4 b=texture2D(u_bd, v_uv-u_off/u_res); gl_FragColor=mix(c, vec4(unp(b)*c.a,c.a), u_op); }`);
def('copybg', { name: 'Copy Background', cat: 'other', desc: 'Fills the layer with whatever is behind it.', sample: 'stack',
  params: { op: pct('Opacity', 100), off: vec2('Offset', [0, 0]), blur: px('Blur', 0, 0, 300) },
  run(g, cur, p, c) { let b = g.backdrop(); if (p.blur > 0) b = g.blur(b, p.blur * c.s); return g.pass('copybg', { u_tex: cur, u_bd: b }, { u_op: p.op / 100, u_off: [p.off[0] * c.s, -p.off[1] * c.s] }); } });
def('echo', { name: 'Echo Keyframes', cat: 'other', desc: 'Leaves fading echoes of the layer trailing behind its keyframed motion.', kind: 'time', sample: 'moving',
  params: { n: num('Echoes', 5, 1, 24, { step: 1 }), delay: num('Delay', 0.08, -2, 2, { unit: 's', step: 0.001 }), decay: pct('Decay', 65), front: bool('Echoes in Front', false) } });
def('fillbehind', { name: 'Fill Behind', cat: 'other', desc: 'Puts a coloured (rounded) box behind the layer, great for captions.', sample: 'text',
  params: { color: col('Color', '#00ffa8'), padx: px('Padding X', 36, -1000, 2000), pady: px('Padding Y', 20, -1000, 2000), r: px('Corner Radius', 22, 0, 2000), op: pct('Opacity', 100), full: bool('Fill Whole Frame', false) },
  fs: `uniform vec3 u_col; uniform vec2 u_pad; uniform float u_r, u_op, u_full; void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res)*u_hs; vec2 b=max(u_hs+u_pad,vec2(1.)); float r=min(u_r,min(b.x,b.y));
  vec2 d=abs(q)-b+r; float sd=length(max(d,0.))+min(max(d.x,d.y),0.)-r; float k=(u_full>0.5?1.:aa(sd))*u_op; gl_FragColor=over(c, vec4(u_col*k,k)); }`,
  u: (p, c) => ({ u_col: hex3(p.color), u_pad: [p.padx * c.s, p.pady * c.s], u_r: p.r * c.s, u_op: p.op / 100, u_full: p.full }) });
shader('magbg', `uniform sampler2D u_bd; uniform float u_z, u_op; uniform vec2 u_cen; void main(){ vec4 c=T(v_uv); vec2 P=v_uv*u_res; vec4 b=texture2D(u_bd, (u_cen+(P-u_cen)/u_z)/u_res); gl_FragColor=mix(c, vec4(unp(b)*c.a,c.a), u_op); }`);
def('magbg', { name: 'Magnify Background', cat: 'other', desc: 'Turns the layer into a magnifying glass over what is behind it.', sample: 'stack',
  params: { zoom: pct('Magnification', 200, 10, 2000), center: vec2('Center', [0, 0]), op: pct('Opacity', 100) },
  run(g, cur, p, c) { return g.pass('magbg', { u_tex: cur, u_bd: g.backdrop() }, { u_z: p.zoom / 100, u_cen: pos(c, p.center), u_op: p.op / 100 }); } });
def('timequant', { name: 'Time Quantization', cat: 'other', desc: 'Steps the layer’s animation at a lower frame rate for a stop-motion feel.', kind: 'time', sample: 'moving',
  params: { fps: num('Frame Rate', 8, 0.5, 60, { unit: 'fps', step: 0.1 }) } });
