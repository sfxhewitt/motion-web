// Blur effects.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, evo, seed, hex3 } from './core.js';
import { pos, dir, zoomBlur } from './color.js';
const D = Math.PI / 180;
const dirSel = () => sel('Direction', 'both', [['both', 'Both'], ['h', 'Horizontal'], ['v', 'Vertical']]);
const DV = { both: null, h: [1, 0], v: [0, 1] };

shader('boxb', `uniform vec2 u_d; uniform float u_r; void main(){ float st=max(1.,u_r/24.); vec4 acc=T(v_uv); float n=1.; for(int i=1;i<=24;i++){ float x=float(i)*st; if(x>u_r+0.01) break; vec2 o=u_d*x/u_res; acc+=T(v_uv+o)+T(v_uv-o); n+=2.; } gl_FragColor=acc/n; }`);
def('boxblur', { name: 'Box Blur', cat: 'blur', desc: 'Blurs with a box filter; more iterations look smoother.',
  params: { r: px('Radius', 16, 0, 400, { step: 0.1 }), it: num('Iterations', 2, 1, 4, { step: 1 }), dir: dirSel() },
  run(g, cur, p, c) { let r = p.r * c.s; if (r < 0.3) return cur; let o = cur; const dv = DV[p.dir];
    for (let i = 0; i < Math.round(p.it); i++) { if (!dv || dv[0]) o = g.pass('boxb', { u_tex: o }, { u_d: [1, 0], u_r: r }); if (!dv || dv[1]) o = g.pass('boxb', { u_tex: o }, { u_d: [0, 1], u_r: r }); }
    return o; } });

shader('chromzoom', `uniform vec2 u_cen; uniform float u_amt, u_sp; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.); float j=h12(P);
  for(int i=0;i<40;i++){ float f=(float(i)+j)/40.; vec4 r=Tp(u_cen+(P-u_cen)*(1.-u_amt*f*(1.+u_sp))), gg=Tp(u_cen+(P-u_cen)*(1.-u_amt*f)), b=Tp(u_cen+(P-u_cen)*(1.-u_amt*f*(1.-u_sp)));
    acc+=vec4(r.r,gg.g,b.b,(r.a+gg.a+b.a)/3.); } acc/=40.; acc.a=max(acc.a, max(acc.r,max(acc.g,acc.b))); gl_FragColor=acc; }`);
def('chromzoom', { name: 'Chromatic Zoom Blur', cat: 'blur', desc: 'A zoom blur whose colour channels spread apart like a lens.',
  params: { amt: pct('Amount', 18, 0, 100), center: vec2('Center', [0, 0]), sp: pct('Spread', 60, 0, 100) },
  run(g, cur, p, c) { const cen = pos(c, p.center); const a = g.pass('chromzoom', { u_tex: cur }, { u_cen: cen, u_amt: p.amt / 100, u_sp: p.sp / 100 }); return g.pass('zoomsamp', { u_tex: a }, { u_cen: cen, u_amt: p.amt / 100 / 30 }); } });

shader('lineb', `uniform vec2 u_v; uniform float u_side; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.); float j=h12(P+fract(u_time)*17.);
  for(int i=0;i<48;i++){ float f=(float(i)+j)/48.; f = u_side>0.5 ? f : f-0.5; acc+=Tp(P+u_v*f); } gl_FragColor=acc/48.; }`);
export function lineBlur(g, inp, v, side = 0) { const a = g.pass('lineb', { u_tex: inp }, { u_v: v, u_side: side }); return g.pass('lineb', { u_tex: a }, { u_v: [v[0] / 40, v[1] / 40], u_side: 0 }); }
def('dirblur', { name: 'Directional Blur', cat: 'blur', desc: 'Smears the layer along one direction.',
  params: { len: px('Length', 40, 0, 1500), angle: ang('Direction', 0) },
  run(g, cur, p, c) { if (p.len <= 0) return cur; const d = dir(p.angle), L = p.len * c.s; return lineBlur(g, cur, [d[0] * L, d[1] * L]); } });

def('gaussblur', { name: 'Gaussian Blur', cat: 'blur', desc: 'Smooth, high-quality blur.',
  params: { r: px('Blurriness', 20, 0, 1000, { step: 0.1 }), dir: dirSel() },
  run(g, cur, p, c) { return g.blur(cur, p.r * c.s * 1.3, { dir: DV[p.dir] }); } }); // Blurriness ~ 2 sigma

shader('innerb', `uniform sampler2D u_b; void main(){ vec4 c=T(v_uv); vec4 b=texture2D(u_b,v_uv); gl_FragColor=vec4(unp(b)*c.a, c.a); }`);
def('innerblur', { name: 'Inner Blur', cat: 'blur', desc: 'Blurs the inside of the layer while keeping its outline sharp.',
  params: { r: px('Blurriness', 20, 0, 600, { step: 0.1 }) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('innerb', { u_tex: cur, u_b: b }); } });

shader('bokeh', `uniform float u_r, u_boost, u_thr; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.); float ws=0.; float rot=h12(P)*TAU;
  for(int i=0;i<72;i++){ float fi=float(i)+0.5; float a=fi*2.39996+rot; float rr=sqrt(fi/72.)*u_r; vec4 s=Tp(P+vec2(cos(a),sin(a))*rr);
    float l=luma(unp(s)); float w=1.+u_boost*smoothstep(u_thr,1.,l)*12.; acc+=s*w; ws+=w; } gl_FragColor=acc/ws; }`);
def('lensblur', { name: 'Lens Blur', cat: 'blur', desc: 'Camera-like defocus blur where highlights bloom into round bokeh.',
  params: { r: px('Radius', 16, 0, 300, { step: 0.1 }), boost: pct('Highlight Boost', 60, 0, 300), thr: pct('Highlight Threshold', 70) },
  run(g, cur, p, c) { const r = p.r * c.s; if (r < 0.5) return cur; let ds = 1; while (r / ds > 14 && ds < 8) ds *= 2;
    let s = cur, w = g.W, h = g.H; for (let k = 1; k < ds; k *= 2) { w = Math.ceil(w / 2); h = Math.ceil(h / 2); s = g.pass('down2', { u_tex: s }, {}, w, h); }
    let b = g.pass('bokeh', { u_tex: s }, { u_r: r / ds, u_boost: p.boost / 100, u_thr: p.thr / 100 }, w, h);
    if (ds > 1) b = g.pass('up', { u_tex: b }, {}); return b; } });

def('linearstreaks', { name: 'Linear Streaks', cat: 'blur', desc: 'Stretches the highlights into long light streaks, like an anamorphic lens.',
  params: { angle: ang('Angle', 0), len: px('Length', 260, 0, 3000), thr: pct('Threshold', 72), int: pct('Intensity', 90, 0, 600), color: col('Color', '#7fc8ff'), tint: pct('Color Amount', 60) },
  run(g, cur, p, c) { const bp = g.run('brightpass', { u_thr: p.thr / 100, u_knee: 0.12, u_tint: [1, 1, 1], u_tmix: 0 }); const d = dir(p.angle), L = p.len * c.s;
    const s = lineBlur(g, bp, [d[0] * L, d[1] * L]); return g.pass('addover', { u_tex: cur, u_g: s }, { u_int: p.int / 100 * 2.2, u_tint: hex3(p.color), u_tmix: p.tint / 100 }); } });

shader('maskmix', `uniform sampler2D u_b; uniform vec2 u_cen, u_d; uniform float u_focus, u_fea, u_rad, u_inv; void main(){ vec2 P=v_uv*u_res; vec2 d=(P-u_cen)/max(u_hs.y,1.);
  float x = u_rad>0.5 ? length(d) : abs(dot(d,vec2(-u_d.y,u_d.x))); float m=smoothstep(u_focus, u_focus+u_fea+1e-3, x); if(u_inv>0.5) m=1.-m; gl_FragColor=mix(T(v_uv),texture2D(u_b,v_uv),m); }`);
def('maskblur', { name: 'Mask Blur', cat: 'blur', desc: 'Blurs outside a sharp focus band or circle (tilt-shift).',
  params: { r: px('Blurriness', 24, 0, 600), type: sel('Shape', 'linear', [['linear', 'Linear'], ['radial', 'Radial']]), center: vec2('Center', [0, 0]), angle: ang('Angle', 0),
    focus: pct('Focus Size', 25, 0, 200), fea: pct('Feather', 40, 0, 200), inv: bool('Invert', false) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('maskmix', { u_tex: cur, u_b: b }, { u_cen: pos(c, p.center), u_d: dir(p.angle), u_focus: p.focus / 100, u_fea: p.fea / 100, u_rad: p.type === 'radial', u_inv: p.inv }); } });

def('mosaic', { name: 'Mosaic', cat: 'blur', desc: 'Breaks the layer into averaged blocks of colour.',
  params: { size: px('Block Size', 24, 1, 400, { step: 0.1 }), sharp: bool('Sharp Colors', false), aspect: pct('Aspect', 100, 10, 1000) },
  fs: `uniform vec2 u_sz; uniform float u_sharp; void main(){ vec2 P=v_uv*u_res; vec2 cell=floor((P-u_c)/u_sz); vec2 o=u_c+cell*u_sz; vec4 acc=vec4(0.);
  if(u_sharp>0.5) acc=Tp(o+u_sz*0.5); else { for(int y=0;y<4;y++) for(int x=0;x<4;x++) acc+=Tp(o+u_sz*(vec2(float(x),float(y))+0.5)/4.); acc/=16.; }
  gl_FragColor=acc; }`, u: (p, c) => ({ u_sz: [Math.max(1, p.size * c.s), Math.max(1, p.size * c.s * p.aspect / 100)], u_sharp: p.sharp }) });

def('motionblur', { name: 'Motion Blur', cat: 'blur', desc: 'Real motion blur: blends the layer over the shutter time as it moves.', kind: 'time',
  params: { shutter: num('Shutter Angle', 180, 0, 720, { unit: '°', step: 1 }), samples: num('Samples', 12, 2, 32, { step: 1 }) }, sample: 'moving' });

def('sharpen', { name: 'Sharpen', cat: 'blur', desc: 'Crisps up fine detail.',
  params: { amt: pct('Amount', 80, 0, 500) },
  fs: `uniform float u_a; void main(){ vec2 e=1./u_res; vec4 c=T(v_uv); vec4 n=T(v_uv+vec2(e.x,0.))+T(v_uv-vec2(e.x,0.))+T(v_uv+vec2(0.,e.y))+T(v_uv-vec2(0.,e.y));
  vec4 o=c+(c*4.-n)*u_a; o=clamp(o,0.,1.); o.a=c.a; o.rgb=min(o.rgb,vec3(o.a)); gl_FragColor=o; }`, u: p => ({ u_a: p.amt / 100 }) });

shader('spinsamp', `uniform vec2 u_cen; uniform float u_ang, u_side; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.); float j=h12(P+fract(u_time)*13.); vec2 d=P-u_cen;
  for(int i=0;i<40;i++){ float f=(float(i)+j)/40.; f=u_side>0.5?f:f-0.5; acc+=Tp(u_cen+rot2(u_ang*f)*d); } gl_FragColor=acc/40.; }`);
export function spinBlur(g, inp, cen, a) { const x = g.pass('spinsamp', { u_tex: inp }, { u_cen: cen, u_ang: a, u_side: 0 }); return g.pass('spinsamp', { u_tex: x }, { u_cen: cen, u_ang: a / 36, u_side: 0 }); }
def('spinblur', { name: 'Spin Blur', cat: 'blur', desc: 'Blurs in circles around a centre point.',
  params: { angle: num('Angle', 20, 0, 360, { unit: '°', step: 0.1 }), center: vec2('Center', [0, 0]) },
  run(g, cur, p, c) { return p.angle ? spinBlur(g, cur, pos(c, p.center), p.angle * D) : cur; } });

def('spinstreaks', { name: 'Spin Streaks', cat: 'blur', desc: 'Swirls the highlights into circular light trails.',
  params: { angle: num('Angle', 50, 0, 360, { unit: '°', step: 0.1 }), center: vec2('Center', [0, 0]), thr: pct('Threshold', 72), int: pct('Intensity', 130, 0, 600), color: col('Color', '#ffd27f'), tint: pct('Color Amount', 40) },
  run(g, cur, p, c) { const bp = g.run('brightpass', { u_thr: p.thr / 100, u_knee: 0.12, u_tint: [1, 1, 1], u_tmix: 0 }); const s = spinBlur(g, bp, pos(c, p.center), p.angle * D);
    return g.pass('addover', { u_tex: cur, u_g: s }, { u_int: p.int / 100, u_tint: hex3(p.color), u_tmix: p.tint / 100 }); } });

def('streakstrips', { name: 'Streak Strips', cat: 'blur', desc: 'Slices the layer into strips and smears each by a random length.',
  params: { w: px('Strip Width', 14, 1, 400, { step: 0.1 }), angle: ang('Direction', 0), len: px('Length', 120, 0, 2000), rnd: pct('Randomness', 100), evo: evo(), spd: num('Speed', 0, 0, 30, { step: 0.01 }), seed: seed() },
  fs: `uniform float u_w, u_len, u_rnd, u_ev, u_seed; uniform vec2 u_d; void main(){ vec2 P=v_uv*u_res; vec2 n=vec2(-u_d.y,u_d.x); float s=floor(dot(P-u_c,n)/u_w);
  float r=h12(vec2(s,u_seed)+floor(u_ev)); float r2=h12(vec2(s,u_seed)+floor(u_ev)+1.); r=mix(r,r2,fract(u_ev)); float L=u_len*mix(1.,r*r,u_rnd);
  vec4 acc=vec4(0.); float j=h12(P); for(int i=0;i<40;i++){ float f=(float(i)+j)/40.; acc+=Tp(P-u_d*L*f); } gl_FragColor=acc/40.; }`,
  u: (p, c) => ({ u_w: p.w * c.s, u_len: p.len * c.s, u_rnd: p.rnd / 100, u_ev: p.evo + c.lt * p.spd, u_seed: p.seed, u_d: dir(p.angle) }) });

shader('unsharp', `uniform sampler2D u_b; uniform float u_a, u_thr; void main(){ vec4 c=T(v_uv), b=texture2D(u_b,v_uv); vec4 d=c-b; float m=step(u_thr, abs(luma(d.rgb)));
  vec4 o=clamp(c+d*u_a*m,0.,1.); o.a=c.a; o.rgb=min(o.rgb,vec3(o.a)); gl_FragColor=o; }`);
def('unsharp', { name: 'Unsharp Mask', cat: 'blur', desc: 'Classic sharpening: increases contrast along edges.',
  params: { amt: pct('Amount', 120, 0, 600), r: px('Radius', 4, 0.3, 100, { step: 0.1 }), thr: pct('Threshold', 0, 0, 50) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('unsharp', { u_tex: cur, u_b: b }, { u_a: p.amt / 100, u_thr: p.thr / 100 }); } });

def('warpblur', { name: 'Warp Blur', cat: 'blur', desc: 'Blurs along swirling flow lines for a painterly smear.',
  params: { amt: px('Amount', 30, 0, 400), sc: px('Scale', 160, 5, 2000), evo: evo(), spd: num('Speed', 0, 0, 10, { step: 0.01 }) },
  fs: `uniform float u_a, u_sc, u_ev; vec2 fl(vec2 p){ float a=fbm(vec3(p/u_sc,u_ev),3.)*TAU*2.; return vec2(cos(a),sin(a)); }
void main(){ vec2 P=v_uv*u_res; vec4 acc=T(v_uv); vec2 pf=P, pb=P; float st=u_a/12.; for(int i=0;i<12;i++){ pf+=fl(pf)*st; pb-=fl(pb)*st; acc+=Tp(pf)+Tp(pb); } gl_FragColor=acc/25.; }`,
  u: (p, c) => ({ u_a: p.amt * c.s, u_sc: p.sc * c.s, u_ev: p.evo * 0.1 + c.lt * p.spd }) });

def('zoomblur', { name: 'Zoom Blur', cat: 'blur', desc: 'Blurs outward from a centre point, like a fast zoom.',
  params: { amt: pct('Amount', 25, 0, 100), center: vec2('Center', [0, 0]) },
  run(g, cur, p, c) { return p.amt > 0 ? zoomBlur(g, cur, pos(c, p.center), p.amt / 100) : cur; } });

def('zoomstreaks', { name: 'Zoom Streaks', cat: 'blur', desc: 'Shoots the highlights outward from a centre point as light streaks.',
  params: { amt: pct('Amount', 45, 0, 100), center: vec2('Center', [0, 0]), thr: pct('Threshold', 72), int: pct('Intensity', 130, 0, 600), color: col('Color', '#ffffff'), tint: pct('Color Amount', 0) },
  run(g, cur, p, c) { const bp = g.run('brightpass', { u_thr: p.thr / 100, u_knee: 0.12, u_tint: [1, 1, 1], u_tmix: 0 }); const z = zoomBlur(g, bp, pos(c, p.center), p.amt / 100);
    return g.pass('addover', { u_tex: cur, u_g: z }, { u_int: p.int / 100, u_tint: hex3(p.color), u_tmix: p.tint / 100 }); } });
