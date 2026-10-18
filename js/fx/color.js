// Color & Light effects.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, vec3, lay, hex3, BLENDS } from './core.js';
const D = Math.PI / 180;
export const pos = (c, v) => [c.cx + v[0] * c.s, c.cy - v[1] * c.s];       // comp-px offset from the layer centre -> GL px
export const dir = a => [Math.cos(a * D), -Math.sin(a * D)];                 // 0° = right, 90° = down (clockwise, like the canvas)
const blendSel = (d = 0) => sel('Blend Mode', d, BLENDS);
const bnum = b => (typeof b === 'number' ? b : +b);

def('brightcontrast', { name: 'Brightness / Contrast', cat: 'color', desc: 'Adjusts the overall brightness and contrast of the layer.',
  params: { b: num('Brightness', 20, -100, 100, { step: 0.1 }), c: num('Contrast', 25, -100, 100, { step: 0.1 }) },
  fs: `uniform float u_b, u_k; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); r=(r-0.5)*u_k+0.5; r+=u_b; gl_FragColor=pm(r,c.a); }`,
  u: p => ({ u_b: p.b / 200, u_k: p.c >= 0 ? 1 / Math.max(0.02, 1 - p.c / 100 * 0.98) : 1 + p.c / 100 }) });

shader('bumpmap', `uniform sampler2D u_map; uniform vec2 u_l; uniform float u_el, u_depth, u_inv;
float hgt(vec2 uv){ vec4 m=texture2D(u_map,uv); float h=luma(unp(m))*m.a; return u_inv>0.5?1.-h:h; }
void main(){ vec2 e=1./u_res; float dx=(hgt(v_uv+vec2(e.x,0.))-hgt(v_uv-vec2(e.x,0.)))*0.5, dy=(hgt(v_uv+vec2(0.,e.y))-hgt(v_uv-vec2(0.,e.y)))*0.5;
  float k=u_depth*u_s; vec3 n=normalize(vec3(-dx*k, -dy*k, 1.)); vec3 L=normalize(vec3(u_l*cos(u_el), sin(u_el)));
  float d=dot(n,L)/max(L.z,0.05); vec3 H=normalize(L+vec3(0.,0.,1.)); float sp=pow(max(dot(n,H),0.),48.)*0.3*clamp(length(vec2(dx,dy))*k*2.,0.,1.);
  vec4 c=T(v_uv); vec3 r=unp(c)*clamp(mix(1.,d,0.75),0.,2.)+sp; gl_FragColor=pm(clamp(r,0.,1.),c.a); }`);
def('bumpmap', { name: 'Bump Map', cat: 'color', desc: 'Lights the layer as if its surface were embossed by a height map (another layer or itself).',
  params: { map: lay('Height Map'), angle: num('Light Angle', 135, -360, 360, { unit: '°' }), el: num('Elevation', 35, 1, 90, { unit: '°' }), depth: num('Depth', 6, 0, 60, { step: 0.1 }),
    soft: px('Softness', 3, 0, 40, { step: 0.1 }), inv: bool('Invert', false) },
  run(g, cur, p, c) { const m = g.layer(p.map) || cur; const b = p.soft > 0 ? g.blur(m, p.soft * c.s) : m;
    return g.pass('bumpmap', { u_tex: cur, u_map: b }, { u_l: dir(p.angle).map(v => -v), u_el: p.el * D, u_depth: p.depth, u_inv: p.inv }); } });

def('colorbalance', { name: 'Color Balance', cat: 'color', desc: 'Shifts the colour of the shadows, midtones and highlights separately.',
  params: { sh: vec3('Shadows', [0, 0, 25], { min: -100, max: 100, step: 1, unit: '', labels: ['R', 'G', 'B'] }), mid: vec3('Midtones', [10, 0, -10], { min: -100, max: 100, step: 1, unit: '', labels: ['R', 'G', 'B'] }),
    hi: vec3('Highlights', [20, 5, -15], { min: -100, max: 100, step: 1, unit: '', labels: ['R', 'G', 'B'] }), keep: bool('Preserve Luminosity', true) },
  fs: `uniform vec3 u_sh, u_mid, u_hi; uniform float u_keep;
void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r); float ws=1.-smoothstep(0.,0.55,l), wh=smoothstep(0.45,1.,l), wm=1.-ws-wh;
  vec3 o=r+(u_sh*ws+u_mid*wm+u_hi*wh)*0.6; o=clamp(o,0.,1.); if(u_keep>0.5) o=setLum(o,l); gl_FragColor=pm(o,c.a); }`,
  u: p => ({ u_sh: p.sh.map(v => v / 100), u_mid: p.mid.map(v => v / 100), u_hi: p.hi.map(v => v / 100), u_keep: p.keep }) });

def('colortemp', { name: 'Color Temperature', cat: 'color', desc: 'Warms or cools the layer and corrects green / magenta tint.',
  params: { temp: num('Temperature', 35, -100, 100, { step: 0.1 }), tint: num('Tint', 0, -100, 100, { step: 0.1 }) },
  fs: `uniform float u_t, u_g; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec3 lin=toLin(r); float l=luma(lin);
  vec3 w = vec3(1.+0.42*u_t, 1.+0.06*u_t-0.28*u_g, 1.-0.48*u_t); w = max(w, 0.05); lin*=w; lin*= l/max(luma(lin),1e-4);
  gl_FragColor=pm(toSrgb(lin),c.a); }`, u: p => ({ u_t: p.temp / 100, u_g: p.tint / 100 }) });

def('colortune', { name: 'Color Tune', cat: 'color', desc: 'Grades the layer with lift, gamma, gain, saturation and hue controls.',
  params: { lift: num('Lift', 0, -100, 100, { step: 0.1 }), gamma: num('Gamma', 1.2, 0.1, 4, { step: 0.01 }), gain: pct('Gain', 105, 0, 400),
    sat: num('Saturation', 15, -100, 100, { step: 0.1 }), hue: ang('Hue', 0), bright: num('Brightness', 0, -100, 100, { step: 0.1 }), contrast: num('Contrast', 0, -100, 100, { step: 0.1 }) },
  fs: `uniform float u_lift, u_gam, u_gain, u_sat, u_hue, u_br, u_ct;
void main(){ vec4 c=T(v_uv); vec3 r=unp(c); r=r*u_gain; r=r+u_lift*(1.-r); r=pow(max(r,0.),vec3(1./u_gam)); r+=u_br; r=(r-0.5)*u_ct+0.5;
  float l=luma(r); r=mix(vec3(l),r,u_sat); r=hueRot(r,u_hue); gl_FragColor=pm(r,c.a); }`,
  u: p => ({ u_lift: p.lift / 200, u_gam: p.gamma, u_gain: p.gain / 100, u_sat: 1 + p.sat / 100, u_hue: p.hue * D, u_br: p.bright / 200, u_ct: p.contrast >= 0 ? 1 / Math.max(0.02, 1 - p.contrast / 100 * 0.98) : 1 + p.contrast / 100 }) });

def('colorize', { name: 'Colorize', cat: 'color', desc: 'Tints the layer with a single colour while keeping its light and shade.',
  params: { color: col('Color', '#ff6a3d'), amt: pct('Amount', 100), sat: pct('Saturation', 100, 0, 200) },
  fs: `uniform vec3 u_col; uniform float u_amt, u_sat; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r);
  vec3 tint=setLum(mix(vec3(luma(u_col)),u_col,u_sat), l); gl_FragColor=pm(mix(r,tint,u_amt),c.a); }`,
  u: p => ({ u_col: hex3(p.color), u_amt: p.amt / 100, u_sat: p.sat / 100 }) });

shader('darkpass', `uniform float u_thr; void main(){ vec4 c=T(v_uv); float l=luma(unp(c)); float d=(1.-smoothstep(u_thr-0.25,u_thr+0.05,l))*c.a; gl_FragColor=vec4(d); }`);
shader('darkmix', `uniform sampler2D u_g1, u_g2; uniform float u_int; void main(){ vec4 c=T(v_uv); float d=texture2D(u_g1,v_uv).a*0.5+texture2D(u_g2,v_uv).a*0.5;
  float k=clamp(d*u_int,0.,1.); vec4 o=vec4(c.rgb*(1.-k), max(c.a, k*0.85)); gl_FragColor=o; }`);
def('darkglow', { name: 'Dark Glow', cat: 'color', desc: 'Spreads a soft dark halo out of the shadows of the layer.',
  params: { r: px('Radius', 40, 0, 400), int: pct('Intensity', 100, 0, 300), thr: pct('Threshold', 45) },
  run(g, cur, p, c) { const d = g.run('darkpass', { u_thr: p.thr / 100 }); const a = g.blur(d, p.r * c.s * 0.4), b = g.blur(d, p.r * c.s);
    return g.pass('darkmix', { u_tex: cur, u_g1: a, u_g2: b }, { u_int: p.int / 100 }); } });

def('exposure', { name: 'Exposure / Gamma', cat: 'color', desc: 'Adjusts exposure in stops, plus offset and gamma, in linear light.',
  params: { exp: num('Exposure', 0.8, -6, 6, { step: 0.01 }), offset: num('Offset', 0, -1, 1, { step: 0.001 }), gamma: num('Gamma', 1, 0.1, 5, { step: 0.01 }) },
  fs: `uniform float u_e, u_o, u_g; void main(){ vec4 c=T(v_uv); vec3 lin=toLin(unp(c))*u_e+u_o; vec3 r=pow(toSrgb(max(lin,0.)), vec3(1./u_g)); gl_FragColor=pm(r,c.a); }`,
  u: p => ({ u_e: Math.pow(2, p.exp), u_o: p.offset, u_g: p.gamma }) });

def('fourcolor', { name: 'Four-color Gradient', cat: 'color', desc: 'Fills the layer with a smooth blend of four colours placed at four points.',
  params: { c1: col('Color 1', '#ff3b6b'), p1: vec2('Point 1', [-60, -60], 200, { unit: '%' }), c2: col('Color 2', '#ffd23f'), p2: vec2('Point 2', [60, -60], 200, { unit: '%' }),
    c3: col('Color 3', '#3bceac'), p3: vec2('Point 3', [60, 60], 200, { unit: '%' }), c4: col('Color 4', '#5b5bff'), p4: vec2('Point 4', [-60, 60], 200, { unit: '%' }),
    blend: pct('Blend', 60, 1, 100), opacity: pct('Opacity', 100), mode: blendSel(0) },
  fs: `uniform vec3 u_c1,u_c2,u_c3,u_c4; uniform vec2 u_p1,u_p2,u_p3,u_p4; uniform float u_bl, u_op, u_mode;
void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res); float pw=mix(6.,1.2,u_bl);
  float w1=1./pow(distance(q,u_p1)+1e-3,pw), w2=1./pow(distance(q,u_p2)+1e-3,pw), w3=1./pow(distance(q,u_p3)+1e-3,pw), w4=1./pow(distance(q,u_p4)+1e-3,pw);
  vec3 g=(u_c1*w1+u_c2*w2+u_c3*w3+u_c4*w4)/(w1+w2+w3+w4); vec3 r=unp(c); gl_FragColor=pm(mix(r,blendm(r,g,u_mode),u_op),c.a); }`,
  u: p => ({ u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_c3: hex3(p.c3), u_c4: hex3(p.c4), u_p1: [p.p1[0] / 100, -p.p1[1] / 100], u_p2: [p.p2[0] / 100, -p.p2[1] / 100],
    u_p3: [p.p3[0] / 100, -p.p3[1] / 100], u_p4: [p.p4[0] / 100, -p.p4[1] / 100], u_bl: p.blend / 100, u_op: p.opacity / 100, u_mode: bnum(p.mode) }) });

def('gradmap', { name: 'Gradient Map', cat: 'color', desc: 'Maps the brightness of the layer onto a three-colour gradient.',
  params: { c1: col('Shadows', '#1b0b3a'), c2: col('Midtones', '#e0306a'), c3: col('Highlights', '#ffe9a8'), mix: pct('Opacity', 100), rev: bool('Reverse', false) },
  fs: `uniform vec3 u_c1,u_c2,u_c3; uniform float u_mix, u_rev; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r); if(u_rev>0.5) l=1.-l;
  vec3 g = l<0.5 ? mix(u_c1,u_c2,smoothstep(0.,0.5,l)) : mix(u_c2,u_c3,smoothstep(0.5,1.,l)); gl_FragColor=pm(mix(r,g,u_mix),c.a); }`,
  u: p => ({ u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_c3: hex3(p.c3), u_mix: p.mix / 100, u_rev: p.rev }) });

def('gradoverlay', { name: 'Gradient Overlay', cat: 'color', desc: 'Lays a linear or radial colour gradient over the layer.',
  params: { type: sel('Type', 'linear', [['linear', 'Linear'], ['radial', 'Radial']]), c1: col('Start Color', '#00ffa8'), c2: col('End Color', '#6a3dff'),
    angle: ang('Angle', 90), scale: pct('Scale', 100, 5, 400), offset: vec2('Offset', [0, 0], 200, { unit: '%' }), mode: blendSel(0), opacity: pct('Opacity', 100) },
  fs: `uniform vec3 u_c1,u_c2; uniform float u_rad, u_sc, u_op, u_mode; uniform vec2 u_dir, u_off;
void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res)-u_off; float t = u_rad>0.5 ? length(q)/(1.41421*u_sc) : dot(q,u_dir)/(2.*u_sc)+0.5; t=clamp(t,0.,1.);
  vec3 g=mix(u_c1,u_c2,smoothstep(0.,1.,t)); vec3 r=unp(c); gl_FragColor=pm(mix(r,blendm(r,g,u_mode),u_op),c.a); }`,
  u: p => ({ u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_rad: p.type === 'radial', u_sc: p.scale / 100, u_op: p.opacity / 100, u_mode: bnum(p.mode), u_dir: dir(p.angle), u_off: [p.offset[0] / 100, -p.offset[1] / 100] }) });

shader('hsmix', `uniform sampler2D u_b; uniform float u_sh, u_hi, u_mc; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float base=luma(unp(texture2D(u_b,v_uv)));
  float l=luma(r); float lift=u_sh*pow(1.-base,2.)*1.6, cut=u_hi*pow(base,2.)*0.8; vec3 o=r*(1.+lift)+lift*0.08; o=o-(o*cut);
  float detail=l-base; o+=detail*u_mc; gl_FragColor=pm(o,c.a); }`);
def('hilishadow', { name: 'Highlights and Shadows', cat: 'color', desc: 'Opens up dark areas and recovers bright areas using local tone mapping.',
  params: { sh: pct('Shadows', 40), hi: pct('Highlights', 20), r: px('Radius', 30, 1, 300), mc: num('Midtone Contrast', 0, -100, 100, { step: 0.1 }) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('hsmix', { u_tex: cur, u_b: b }, { u_sh: p.sh / 100, u_hi: p.hi / 100, u_mc: p.mc / 100 }); } });

def('hotcolor', { name: 'Hot Color', cat: 'color', desc: 'Maps brightness to a glowing thermal palette from black through red and yellow to white.',
  params: { mix: pct('Opacity', 100), shift: num('Shift', 0, -100, 100, { step: 0.1 }), contrast: pct('Contrast', 100, 10, 300) },
  fs: `uniform float u_mix, u_shift, u_ct; vec3 heat(float t){ t=clamp(t,0.,1.); return clamp(vec3(t*3., t*3.-1., t*3.-2.),0.,1.)*vec3(1.,0.95,1.) + vec3(0.,0.,0.35)*smoothstep(0.,0.15,t)*(1.-smoothstep(0.15,0.4,t)); }
void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=(luma(r)-0.5)*u_ct+0.5+u_shift; gl_FragColor=pm(mix(r,heat(l),u_mix),c.a); }`,
  u: p => ({ u_mix: p.mix / 100, u_shift: p.shift / 200, u_ct: p.contrast / 100 }) });

def('hueshift', { name: 'Hue Shift', cat: 'color', desc: 'Rotates every colour of the layer around the colour wheel.',
  params: { hue: ang('Hue Shift', 120), sat: num('Saturation', 0, -100, 100, { step: 0.1 }) },
  fs: `uniform float u_h, u_sat; void main(){ vec4 c=T(v_uv); vec3 r=unp(c);
  mat3 toY=mat3(0.299,0.596,0.211, 0.587,-0.274,-0.523, 0.114,-0.322,0.312); mat3 fromY=mat3(1.,1.,1., 0.956,-0.272,-1.106, 0.621,-0.647,1.703);
  vec3 y=toY*r; float co=cos(u_h), si=sin(u_h); y.yz=mat2(co,si,-si,co)*y.yz*u_sat; gl_FragColor=pm(fromY*y,c.a); }`,
  u: p => ({ u_h: p.hue * D, u_sat: 1 + p.sat / 100 }) });

def('invert', { name: 'Invert', cat: 'color', desc: 'Inverts the colours, the brightness only, the hue or a single channel.',
  params: { ch: sel('Channel', 'rgb', [['rgb', 'RGB'], ['luma', 'Luminance'], ['hue', 'Hue'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['a', 'Alpha']]), mix: pct('Blend', 100) },
  fs: `uniform float u_ch, u_mix; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec3 o=r; float a=c.a;
  if(u_ch<0.5) o=1.-r; else if(u_ch<1.5) o=setLum(r,1.-luma(r)); else if(u_ch<2.5) o=setLum(1.-r,luma(r)); else if(u_ch<3.5) o.r=1.-r.r; else if(u_ch<4.5) o.g=1.-r.g; else if(u_ch<5.5) o.b=1.-r.b; else a=mix(a,1.-a,u_mix);
  gl_FragColor=pm(mix(r,o,u_mix),a); }`,
  u: p => ({ u_ch: ['rgb', 'luma', 'hue', 'r', 'g', 'b', 'a'].indexOf(p.ch), u_mix: p.mix / 100 }) });

shader('brightpass', `uniform float u_thr, u_knee; uniform vec3 u_tint; uniform float u_tmix; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=max(luma(r), max(r.r,max(r.g,r.b))*0.7);
  float k=smoothstep(u_thr-u_knee, u_thr+u_knee, l); vec3 o=mix(r, u_tint*luma(r)*1.6, u_tmix)*k; gl_FragColor=vec4(o*c.a, c.a*k); }`);
shader('glowadd', `uniform sampler2D u_g1, u_g2, u_g3; uniform float u_int; uniform vec3 u_tint; uniform float u_tmix;
void main(){ vec4 c=T(v_uv); vec4 g=texture2D(u_g1,v_uv)*0.5+texture2D(u_g2,v_uv)*0.35+texture2D(u_g3,v_uv)*0.35; vec3 gc=mix(g.rgb, u_tint*max(g.a,luma(g.rgb)), u_tmix)*u_int; gl_FragColor=addGlow(c,gc); }`);
export function bloom(g, cur, src, r, int, tint = '#ffffff', tmix = 0) {
  const a = g.blur(src, r * 0.18), b = g.blur(src, r * 0.45), cc = g.blur(src, r);
  return g.pass('glowadd', { u_tex: cur, u_g1: a, u_g2: b, u_g3: cc }, { u_int: int, u_tint: hex3(tint), u_tmix: tmix });
}
def('lightglow', { name: 'Light Glow', cat: 'color', desc: 'Makes the brightest parts of the layer bloom with soft light.',
  params: { thr: pct('Threshold', 62), r: px('Radius', 60, 0, 500), int: pct('Intensity', 110, 0, 600), color: col('Color', '#ffffff'), tint: pct('Color Amount', 0) },
  run(g, cur, p, c) { const bp = g.run('brightpass', { u_thr: p.thr / 100, u_knee: 0.12, u_tint: [1, 1, 1], u_tmix: 0 }); return bloom(g, cur, bp, p.r * c.s, p.int / 100, p.color, p.tint / 100); } });

shader('lshadow1', `uniform vec2 u_d; uniform float u_len, u_fade; uniform float u_src;
void main(){ vec2 P=v_uv*u_res; float s=0.; for(int i=1;i<=32;i++){ float f=float(i)/32.; vec4 t=Tp(P-u_d*u_len*f); float a=u_src>0.5?t.a:t.r; s=max(s, a*(1.-u_fade*f)); } gl_FragColor=vec4(s); }`);
shader('lshadow2', `uniform vec2 u_d; uniform float u_len; void main(){ vec2 P=v_uv*u_res; float s=T(v_uv).r; for(int i=1;i<=32;i++){ float f=float(i)/32.; s=max(s, Tp(P-u_d*u_len*f).r); } gl_FragColor=vec4(s); }`);
shader('shadowcomp', `uniform sampler2D u_m; uniform vec3 u_col; uniform float u_op, u_only; void main(){ vec4 c=T(v_uv); float m=texture2D(u_m,v_uv).r*u_op; vec4 sh=vec4(u_col*m,m);
  gl_FragColor = u_only>0.5 ? sh*(1.-c.a) : over(c, sh); }`);
def('longshadow', { name: 'Long Shadow', cat: 'color', desc: 'Casts a long flat-design shadow from the layer in one direction.',
  params: { angle: ang('Angle', 45), len: px('Length', 220, 0, 3000), color: col('Color', '#000000'), op: pct('Opacity', 55), fade: pct('Fade', 60), only: bool('Shadow Only', false) },
  run(g, cur, p, c) { const L = p.len * c.s, d = dir(p.angle); const m1 = g.run('lshadow1', { u_d: d, u_len: L, u_fade: p.fade / 100, u_src: 1 });
    const m2 = g.pass('lshadow2', { u_tex: m1 }, { u_d: d, u_len: L / 32 });
    return g.pass('shadowcomp', { u_tex: cur, u_m: m2 }, { u_col: hex3(p.color), u_op: p.op / 100, u_only: p.only }); } });

def('palettemap', { name: 'Palette Map', cat: 'color', desc: 'Re-colours the layer using a palette of four colours chosen by brightness.',
  params: { c1: col('Color 1', '#14213d'), c2: col('Color 2', '#e63946'), c3: col('Color 3', '#f4a261'), c4: col('Color 4', '#f1faee'), smooth: pct('Smoothness', 15), mix: pct('Opacity', 100) },
  fs: `uniform vec3 u_c1,u_c2,u_c3,u_c4; uniform float u_sm, u_mix; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r)*4.; float s=max(u_sm,0.001)*0.5;
  vec3 o=u_c1; o=mix(o,u_c2,smoothstep(1.-s,1.+s,l)); o=mix(o,u_c3,smoothstep(2.-s,2.+s,l)); o=mix(o,u_c4,smoothstep(3.-s,3.+s,l)); gl_FragColor=pm(mix(r,o,u_mix),c.a); }`,
  u: p => ({ u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_c3: hex3(p.c3), u_c4: hex3(p.c4), u_sm: p.smooth / 100, u_mix: p.mix / 100 }) });

def('posterize', { name: 'Posterize', cat: 'color', desc: 'Reduces the number of tonal levels in each colour channel.',
  params: { levels: num('Levels', 5, 2, 64, { step: 1 }), gamma: num('Gamma', 1, 0.2, 4, { step: 0.01 }) },
  fs: `uniform float u_lv, u_g; void main(){ vec4 c=T(v_uv); vec3 r=pow(unp(c),vec3(u_g)); r=floor(r*(u_lv-1.)+0.5)/(u_lv-1.); gl_FragColor=pm(pow(r,vec3(1./u_g)),c.a); }`,
  u: p => ({ u_lv: Math.max(2, Math.round(p.levels)), u_g: p.gamma }) });

def('rgbsplit', { name: 'RGB Split', cat: 'color', desc: 'Offsets the red, green and blue channels for a chromatic aberration look.',
  params: { amt: px('Amount', 14, 0, 300, { step: 0.1 }), angle: ang('Angle', 0), mode: sel('Mode', 'rgb', [['rgb', 'Red / Blue'], ['rg', 'Red / Green'], ['radial', 'Radial']]) },
  fs: `uniform vec2 u_o; uniform float u_mode, u_amt; void main(){ vec2 P=v_uv*u_res; vec2 o=u_o; if(u_mode>1.5){ vec2 d=P-u_c; o=d/max(length(u_hs),1.)*u_amt; }
  vec4 r=Tp(P+o), gg=Tp(P), b=Tp(P-o); if(u_mode>0.5&&u_mode<1.5){ vec4 t=gg; gg=b; b=t; }
  float a=max(max(r.a,gg.a),b.a); gl_FragColor=vec4(r.r,gg.g,b.b,a); }`,
  u: (p, c) => { const d = dir(p.angle), a = p.amt * c.s; return { u_o: [d[0] * a, d[1] * a], u_mode: ['rgb', 'rg', 'radial'].indexOf(p.mode), u_amt: a }; } });

shader('radshadow', `uniform vec2 u_lp; uniform float u_k, u_soft; void main(){ vec2 P=v_uv*u_res; float s=0.;
  for(int i=0;i<16;i++){ float a=float(i)*2.39996; float r=sqrt((float(i)+0.5)/16.)*u_soft; vec2 j=vec2(cos(a),sin(a))*r; vec2 S=u_lp+(P+j-u_lp)/u_k; s+=Tp(S).a; }
  gl_FragColor=vec4(s/16.); }`);
def('radialshadow', { name: 'Radial Shadow', cat: 'color', desc: 'Casts a shadow from a point light, so the shadow grows away from the light.',
  params: { light: vec2('Light Position', [-260, -320]), dist: pct('Distance', 25, 0, 300), soft: px('Softness', 12, 0, 200), color: col('Color', '#000000'), op: pct('Opacity', 55), only: bool('Shadow Only', false) },
  run(g, cur, p, c) { const m = g.run('radshadow', { u_lp: pos(c, p.light), u_k: 1 + p.dist / 100, u_soft: p.soft * c.s });
    return g.pass('shadowcomp', { u_tex: cur, u_m: m }, { u_col: hex3(p.color), u_op: p.op / 100, u_only: p.only }); } });

// shared radial (zoom) sampler: used by Rays, Zoom Blur, Zoom Streaks, Chromatic Zoom Blur
shader('zoomsamp', `uniform vec2 u_cen; uniform float u_amt; void main(){ vec2 P=v_uv*u_res; vec4 acc=vec4(0.); float j=h12(P+fract(u_time)*31.);
  for(int i=0;i<32;i++){ float f=(float(i)+j)/32.; acc+=Tp(u_cen+(P-u_cen)*(1.-u_amt*f)); } gl_FragColor=acc/32.; }`);
export function zoomBlur(g, inp, cen, amt) { // two passes: 32 x 32 effective samples, no banding
  const a = g.pass('zoomsamp', { u_tex: inp }, { u_cen: cen, u_amt: amt });
  return g.pass('zoomsamp', { u_tex: a }, { u_cen: cen, u_amt: amt / 32 * 1.5 });
}
shader('addover', `uniform sampler2D u_g; uniform float u_int; uniform vec3 u_tint; uniform float u_tmix; void main(){ vec4 c=T(v_uv); vec4 g=texture2D(u_g,v_uv);
  vec3 gc=mix(g.rgb, u_tint*max(g.a,luma(g.rgb)), u_tmix)*u_int; gl_FragColor=addGlow(c,gc); }`);
def('rays', { name: 'Rays', cat: 'color', desc: 'Shines volumetric light rays out of the bright parts of the layer.',
  params: { center: vec2('Center', [0, 0]), len: pct('Length', 45, 0, 100), int: pct('Intensity', 100, 0, 500), thr: pct('Threshold', 70), color: col('Color', '#fff2c4'), tint: pct('Color Amount', 40) },
  run(g, cur, p, c) { const bp = g.run('brightpass', { u_thr: p.thr / 100, u_knee: 0.15, u_tint: [1, 1, 1], u_tmix: 0 }); const z = zoomBlur(g, bp, pos(c, p.center), p.len / 100);
    return g.pass('addover', { u_tex: cur, u_g: z }, { u_int: p.int / 100, u_tint: hex3(p.color), u_tmix: p.tint / 100 }); } });

const CHROMA = `vec2 chroma(vec3 c){ return vec2(-0.1146*c.r-0.3854*c.g+0.5*c.b, 0.5*c.r-0.4542*c.g-0.0458*c.b); }`;
def('replacecolor', { name: 'Replace Color', cat: 'color', desc: 'Swaps one colour in the layer for another, keeping light and shade.',
  params: { from: col('Target Color', '#e83f6f'), to: col('Replace Color', '#2bb3ff'), tol: pct('Tolerance', 30), soft: pct('Softness', 15) },
  fs: CHROMA + `uniform vec3 u_from, u_to; uniform float u_tol, u_soft; void main(){ vec4 c=T(v_uv); vec3 r=unp(c);
  float d=distance(chroma(r),chroma(u_from))*2.2+abs(luma(r)-luma(u_from))*0.35; float k=1.-smoothstep(u_tol, u_tol+u_soft+1e-3, d);
  vec3 o=setLum(u_to + (r-u_from)*0.25, luma(r)+ (luma(u_to)-luma(u_from))*0.5); gl_FragColor=pm(mix(r,o,k),c.a); }`,
  u: p => ({ u_from: hex3(p.from), u_to: hex3(p.to), u_tol: p.tol / 100 * 0.6, u_soft: p.soft / 100 * 0.6 }) });

def('satvib', { name: 'Saturation / Vibrance', cat: 'color', desc: 'Boosts or mutes colour; vibrance protects colours that are already saturated.',
  params: { sat: num('Saturation', 30, -100, 100, { step: 0.1 }), vib: num('Vibrance', 30, -100, 100, { step: 0.1 }) },
  fs: `uniform float u_s1, u_v; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r); float mx=max(r.r,max(r.g,r.b)), mn=min(r.r,min(r.g,r.b)); float sat=mx-mn;
  r=mix(vec3(l),r,1.+u_v*(1.-sat)*1.4); r=mix(vec3(l),r,1.+u_s1); gl_FragColor=pm(r,c.a); }`, u: p => ({ u_s1: p.sat / 100, u_v: p.vib / 100 }) });

shader('softmix', `uniform sampler2D u_b; uniform float u_amt, u_br; void main(){ vec4 c=T(v_uv); vec4 bb=texture2D(u_b,v_uv); vec3 r=unp(c), b=unp(bb)*(1.+u_br);
  vec3 sc=1.-(1.-r)*(1.-b); vec3 o=mix(r, sc, u_amt); float a=max(c.a, bb.a*u_amt*0.7); gl_FragColor=vec4(o*c.a + b*bb.a*u_amt*0.7*(1.-c.a), a); }`);
def('softglow', { name: 'Soft Glow', cat: 'color', desc: 'Gives the layer a dreamy, diffused glow.',
  params: { r: px('Radius', 30, 0, 400), amt: pct('Amount', 60), br: pct('Brightness', 15, 0, 200) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('softmix', { u_tex: cur, u_b: b }, { u_amt: p.amt / 100, u_br: p.br / 100 }); } });

def('solidcolor', { name: 'Solid Color', cat: 'color', desc: 'Fills the visible parts of the layer with a single colour.',
  params: { color: col('Color', '#00ffa8'), op: pct('Opacity', 100) },
  fs: `uniform vec3 u_col; uniform float u_op; void main(){ vec4 c=T(v_uv); gl_FragColor=pm(mix(unp(c),u_col,u_op),c.a); }`, u: p => ({ u_col: hex3(p.color), u_op: p.op / 100 }) });

def('spectral', { name: 'Spectral Map', cat: 'color', desc: 'Maps brightness onto a full rainbow spectrum.',
  params: { mix: pct('Opacity', 100), offset: ang('Offset', 0), cycles: num('Cycles', 1, 0.1, 10, { step: 0.01 }), keep: bool('Keep Brightness', false) },
  fs: `uniform float u_mix, u_off, u_cy, u_keep; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r); vec3 s=hsv2rgb(vec3(fract(l*u_cy*0.85+u_off), 0.85, 1.));
  if(u_keep>0.5) s=setLum(s,l); gl_FragColor=pm(mix(r,s,u_mix),c.a); }`, u: p => ({ u_mix: p.mix / 100, u_off: p.offset / 360, u_cy: p.cycles, u_keep: p.keep }) });

def('spotcolor', { name: 'Spot Color', cat: 'color', desc: 'Keeps one colour and turns the rest of the layer black and white.',
  params: { color: col('Color', '#e83f6f'), tol: pct('Tolerance', 30), soft: pct('Softness', 15), desat: pct('Desaturate', 100) },
  fs: CHROMA + `uniform vec3 u_col; uniform float u_tol, u_soft, u_ds; void main(){ vec4 c=T(v_uv); vec3 r=unp(c);
  float d=distance(chroma(r),chroma(u_col))*2.2; float k=1.-smoothstep(u_tol,u_tol+u_soft+1e-3,d); vec3 g=vec3(luma(r)); gl_FragColor=pm(mix(mix(r,g,u_ds),r,k),c.a); }`,
  u: p => ({ u_col: hex3(p.color), u_tol: p.tol / 100 * 0.6, u_soft: p.soft / 100 * 0.6, u_ds: p.desat / 100 }) });

def('threshold', { name: 'Threshold', cat: 'color', desc: 'Turns the layer into two colours split at a brightness level.',
  params: { level: pct('Level', 50), soft: pct('Softness', 2), dark: col('Dark Color', '#000000'), light: col('Light Color', '#ffffff') },
  fs: `uniform float u_lv, u_sf; uniform vec3 u_d, u_l; void main(){ vec4 c=T(v_uv); float l=luma(unp(c)); float k=smoothstep(u_lv-u_sf-0.002,u_lv+u_sf+0.002,l); gl_FragColor=pm(mix(u_d,u_l,k),c.a); }`,
  u: p => ({ u_lv: p.level / 100, u_sf: p.soft / 200, u_d: hex3(p.dark), u_l: hex3(p.light) }) });
