// Drawing & Edge effects.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, evo, hex3 } from './core.js';
import { pos, dir, bloom } from './color.js';
const D = Math.PI / 180;

def('cmykhalftone', { name: 'CMYK Halftone Dots', cat: 'draw', desc: 'Prints the layer as overlapping cyan, magenta, yellow and black dot screens.',
  params: { size: px('Dot Size', 9, 2, 120, { step: 0.1 }), angle: ang('Angle', 0), paper: col('Paper', '#fbf8f0'), mix: pct('Opacity', 100) },
  fs: `uniform float u_sz, u_ang, u_mix; uniform vec3 u_paper;
float dotc(vec2 P, float a, float v){ vec2 q=rot2(a)*(P-u_c); vec2 cell=floor(q/u_sz)+0.5; vec2 ce=cell*u_sz; float r=sqrt(clamp(v,0.,1.))*u_sz*0.62; return aa(distance(q,ce)-r); }
float chan(vec2 P, float a, int k){ vec2 q=rot2(a)*(P-u_c); vec2 ce=(floor(q/u_sz)+0.5)*u_sz; vec2 S=u_c+rot2(-a)*ce; vec3 r=unp(Tp(S)); float K=1.-max(r.r,max(r.g,r.b));
  float v = k==0 ? (1.-r.r-K)/(1.-K+1e-4) : k==1 ? (1.-r.g-K)/(1.-K+1e-4) : k==2 ? (1.-r.b-K)/(1.-K+1e-4) : K; return dotc(P,a,v); }
void main(){ vec2 P=v_uv*u_res; vec4 c=T(v_uv); float C=chan(P,u_ang+0.2618,0), M=chan(P,u_ang+1.309,1), Y=chan(P,u_ang,2), K=chan(P,u_ang+0.7854,3);
  vec3 ink=u_paper*(1.-C*vec3(1.,0.,0.)*0.95)*(1.-M*vec3(0.,1.,0.)*0.95)*(1.-Y*vec3(0.,0.,1.)*0.95)*(1.-K*0.9); gl_FragColor=pm(mix(unp(c),ink,u_mix),c.a); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_ang: p.angle * D, u_paper: hex3(p.paper), u_mix: p.mix / 100 }) });

shader('contourgrad', `uniform sampler2D u_b; uniform vec3 u_c1, u_c2; uniform float u_rep, u_mix; void main(){ vec4 c=T(v_uv); float d=texture2D(u_b,v_uv).a; float t=clamp((d-0.5)*2.,0.,1.);
  t = u_rep>1.01 ? abs(fract(t*u_rep*0.5)*2.-1.) : t; vec3 g=mix(u_c2,u_c1,smoothstep(0.,1.,t)); gl_FragColor=pm(mix(unp(c),g,u_mix),c.a); }`);
def('contourgrad', { name: 'Contour Gradient', cat: 'draw', desc: 'Fills the layer with a gradient that follows its outline inward.',
  params: { w: px('Width', 60, 1, 600), c1: col('Inner Color', '#ffe36e'), c2: col('Edge Color', '#ff3d7f'), rep: num('Repeat', 1, 1, 20, { step: 0.1 }), mix: pct('Opacity', 100) },
  run(g, cur, p, c) { const b = g.blur(cur, p.w * c.s); return g.pass('contourgrad', { u_tex: cur, u_b: b }, { u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_rep: p.rep, u_mix: p.mix / 100 }); } });

shader('contourlines', `uniform sampler2D u_b; uniform float u_lv, u_w, u_bg; uniform vec3 u_col; float L(vec2 uv){ return luma(unp(texture2D(u_b,uv)))*u_lv; }
void main(){ vec4 c=T(v_uv); vec2 e=1./u_res; float v=L(v_uv); vec2 gr=vec2(L(v_uv+vec2(e.x,0.))-L(v_uv-vec2(e.x,0.)), L(v_uv+vec2(0.,e.y))-L(v_uv-vec2(0.,e.y)))*0.5;
  float d=abs(fract(v+0.5)-0.5)/max(length(gr),1e-4); float k=aa(d-u_w*0.5)*c.a; vec4 base = u_bg<0.5 ? c : u_bg<1.5 ? vec4(0.) : vec4(0.,0.,0.,c.a);
  gl_FragColor=over(vec4(u_col*k,k), base); }`);
def('contourlines', { name: 'Contour Lines', cat: 'draw', desc: 'Draws topographic lines along equal-brightness levels of the layer.',
  params: { lv: num('Levels', 10, 1, 64, { step: 1 }), w: px('Line Width', 1.6, 0.3, 20, { step: 0.1 }), smooth: px('Smoothness', 3, 0, 60, { step: 0.1 }), color: col('Color', '#ffffff'),
    bg: sel('Background', 'original', [['original', 'Original'], ['none', 'Transparent'], ['black', 'Black']]) },
  run(g, cur, p, c) { const b = g.blur(cur, p.smooth * c.s); return g.pass('contourlines', { u_tex: cur, u_b: b }, { u_lv: p.lv, u_w: p.w * c.s, u_col: hex3(p.color), u_bg: ['original', 'none', 'black'].indexOf(p.bg) }); } });

def('drawprogress', { name: 'Drawing Progress', cat: 'draw', desc: 'Draws freehand strokes and shape outlines on progressively, as if being drawn.', kind: 'shape',
  params: { start: pct('Start', 0), end: pct('End', 65), fill: bool('Show Fill When Complete', true) }, sample: 'draw' });

shader('edgedet', `uniform float u_luma; void main(){ vec2 e=1./u_res; float tl=0.,t=0.,tr=0.,l=0.,r=0.,bl=0.,b=0.,br=0.;
  #define S(o) (Tc(v_uv+(o)*e).a + u_luma*luma(Tc(v_uv+(o)*e).rgb))
  tl=S(vec2(-1,1)); t=S(vec2(0,1)); tr=S(vec2(1,1)); l=S(vec2(-1,0)); r=S(vec2(1,0)); bl=S(vec2(-1,-1)); b=S(vec2(0,-1)); br=S(vec2(1,-1));
  float gx=(tr+2.*r+br)-(tl+2.*l+bl), gy=(tl+2.*t+tr)-(bl+2.*b+br); float m=clamp(length(vec2(gx,gy))*0.5,0.,1.); gl_FragColor=vec4(m); }`);
shader('tintmask', `uniform vec3 u_col; void main(){ float m=T(v_uv).a; gl_FragColor=vec4(u_col*m,m); }`);
def('edgeglow', { name: 'Edge Glow', cat: 'draw', desc: 'Traces the edges of the layer with glowing neon light.',
  params: { color: col('Color', '#00f0ff'), r: px('Radius', 24, 0, 300), int: pct('Intensity', 180, 0, 600), w: px('Edge Width', 2, 0.5, 20, { step: 0.1 }), luma: pct('Inner Edges', 30) },
  run(g, cur, p, c) { let e = g.run('edgedet', { u_luma: p.luma / 100 }); if (p.w * c.s > 1.2) e = g.blur(e, p.w * c.s * 0.6); const t = g.pass('tintmask', { u_tex: e }, { u_col: hex3(p.color) });
    const core = g.pass('addover', { u_tex: cur, u_g: t }, { u_int: Math.min(2, p.int / 100), u_tint: [1, 1, 1], u_tmix: 0 });
    return bloom(g, core, t, p.r * c.s, p.int / 100); } });

shader('electric', `uniform float u_turb, u_spd, u_w, u_sc; void main(){ vec2 P=v_uv*u_res; float t=u_time*u_spd; vec2 q=P/u_sc;
  vec2 off=vec2(fbm(vec3(q*1.0,t),4.)-0.5, fbm(vec3(q*1.0+7.3,t*1.1),4.)-0.5)*u_turb*u_sc*0.9; vec2 Q=P+off;
  float a0=Tp(Q).a; float dx=Tp(Q+vec2(1.5,0.)).a-Tp(Q-vec2(1.5,0.)).a, dy=Tp(Q+vec2(0.,1.5)).a-Tp(Q-vec2(0.,1.5)).a;
  float edge=clamp(length(vec2(dx,dy))*1.4,0.,1.); float bolt=smoothstep(0.62,0.98,1.-abs(fbm(vec3(q*3.,t*2.),3.)-0.5)*2.); float m=clamp(edge*(0.35+1.4*bolt),0.,1.);
  gl_FragColor=vec4(m); }`);
def('electricedges', { name: 'Electric Edges', cat: 'draw', desc: 'Wraps the edges of the layer in crackling animated electricity.',
  params: { color: col('Color', '#7fd8ff'), int: pct('Intensity', 220, 0, 800), turb: pct('Turbulence', 40), sc: px('Scale', 60, 5, 600), spd: num('Speed', 2, 0, 20, { step: 0.01 }), r: px('Glow', 18, 0, 200) },
  run(g, cur, p, c) { let e = g.run('electric', { u_turb: p.turb / 100, u_spd: p.spd, u_sc: p.sc * c.s }); e = g.blur(e, 0.8 * c.s);
    const t = g.pass('tintmask', { u_tex: e }, { u_col: hex3(p.color) }); const core = g.pass('addover', { u_tex: cur, u_g: t }, { u_int: 1.6, u_tint: [1, 1, 1], u_tmix: 0.5 });
    return bloom(g, core, t, p.r * c.s, p.int / 100, p.color, 0.4); } });

def('findedges', { name: 'Find Edges', cat: 'draw', desc: 'Detects edges and draws them as dark lines on white, or glowing on black.',
  params: { inv: bool('Invert', false), mix: pct('Opacity', 100), str: pct('Strength', 150, 10, 500) },
  fs: `uniform float u_inv, u_mix, u_str; void main(){ vec2 e=vec2(max(1.,3.*u_s))/u_res; vec3 tl=unp(T(v_uv+vec2(-e.x,e.y))), t=unp(T(v_uv+vec2(0.,e.y))), tr=unp(T(v_uv+e)), l=unp(T(v_uv-vec2(e.x,0.))),
  r=unp(T(v_uv+vec2(e.x,0.))), bl=unp(T(v_uv-e)), b=unp(T(v_uv-vec2(0.,e.y))), br=unp(T(v_uv+vec2(e.x,-e.y))); vec3 gx=(tr+2.*r+br)-(tl+2.*l+bl), gy=(tl+2.*t+tr)-(bl+2.*b+br);
  vec3 m=clamp(sqrt(gx*gx+gy*gy)*0.5*u_str,0.,1.); vec3 o = u_inv>0.5 ? m : 1.-m; vec4 c=T(v_uv); gl_FragColor=pm(mix(unp(c),o,u_mix),c.a); }`,
  u: p => ({ u_inv: p.inv, u_mix: p.mix / 100, u_str: p.str / 100 }) });

def('glow', { name: 'Glow', cat: 'draw', desc: 'Adds a soft glow around the whole layer.',
  params: { r: px('Radius', 40, 0, 500), int: pct('Intensity', 120, 0, 600), color: col('Color', '#00ffa8'), tint: pct('Color Amount', 0) },
  run(g, cur, p, c) { return bloom(g, cur, cur, p.r * c.s, p.int / 100, p.color, p.tint / 100); } });

shader('scanband', `uniform vec2 u_d; uniform float u_pos, u_w; uniform vec3 u_col; void main(){ vec4 c=T(v_uv); vec2 q=toL(v_uv*u_res); float x=dot(q,u_d); float b=exp(-pow((x-u_pos)/max(u_w,1e-3),2.)*2.)*c.a;
  gl_FragColor=vec4(u_col*b,b); }`);
def('glowscan', { name: 'Glow Scan', cat: 'draw', desc: 'Sweeps a glowing band of light across the layer.',
  params: { angle: ang('Angle', 30), w: pct('Width', 18, 1, 200), pos: pct('Position', -100, -200, 200), spd: num('Speed', 0.6, -10, 10, { step: 0.01, unit: 'Hz' }), color: col('Color', '#ffffff'), int: pct('Intensity', 160, 0, 600), r: px('Glow', 20, 0, 200) },
  run(g, cur, p, c) { const d = dir(p.angle); let ps = p.pos / 100; if (p.spd) ps += ((c.lt * p.spd) % 1) * 3.4 - 0.2;
    const b = g.run('scanband', { u_d: d, u_pos: ps > 1.7 ? ps - 3.4 : ps, u_w: p.w / 100, u_col: hex3(p.color) });
    const core = g.pass('addover', { u_tex: cur, u_g: b }, { u_int: p.int / 100, u_tint: [1, 1, 1], u_tmix: 0 }); return bloom(g, core, b, p.r * c.s, p.int / 200); } });

def('halftone', { name: 'Halftone Dots', cat: 'draw', desc: 'Re-draws the layer as a pattern of dots sized by brightness.',
  params: { size: px('Dot Size', 12, 2, 200, { step: 0.1 }), angle: ang('Angle', 45), orig: bool('Use Layer Colors', true), color: col('Dot Color', '#111111'), bg: col('Background', '#ffffff'), bgop: pct('Background Opacity', 0), inv: bool('Invert', false) },
  fs: `uniform float u_sz, u_ang, u_orig, u_bgop, u_inv; uniform vec3 u_col, u_bg; void main(){ vec2 P=v_uv*u_res; vec2 q=rot2(u_ang)*(P-u_c); vec2 ce=(floor(q/u_sz)+0.5)*u_sz;
  vec4 s=Tp(u_c+rot2(-u_ang)*ce); vec3 r=unp(s); float l=luma(r); float v=u_inv>0.5?l:1.-l; v=u_orig>0.5?max(v,0.25)*s.a:v*s.a; float rad=sqrt(v)*u_sz*0.71; float k=aa(distance(q,ce)-rad);
  vec3 dc=u_orig>0.5?r:u_col; vec4 c=T(v_uv); vec4 bg=vec4(u_bg,1.)*u_bgop*c.a; gl_FragColor=over(vec4(dc*k,k), bg); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_ang: p.angle * D, u_orig: p.orig, u_col: hex3(p.color), u_bg: hex3(p.bg), u_bgop: p.bgop / 100, u_inv: p.inv }) });

def('halftonelines', { name: 'Halftone Lines', cat: 'draw', desc: 'Re-draws the layer as engraved lines whose thickness follows brightness.',
  params: { sp: px('Line Spacing', 9, 2, 200, { step: 0.1 }), angle: ang('Angle', 30), orig: bool('Use Layer Colors', true), color: col('Line Color', '#111111'), wav: pct('Waviness', 0) },
  fs: `uniform float u_sp, u_ang, u_orig, u_wav; uniform vec3 u_col; void main(){ vec2 P=v_uv*u_res; vec4 c=T(v_uv); vec3 r=unp(c); float l=luma(r); vec2 q=rot2(u_ang)*(P-u_c);
  float y=q.y+sin(q.x/u_sp*0.7)*u_sp*u_wav; float d=abs(fract(y/u_sp)-0.5)*u_sp; float w=(1.-l)*u_sp*0.5; float k=aa(d-w)*c.a; vec3 lc=u_orig>0.5?r*0.85:u_col; gl_FragColor=vec4(lc*k,k); }`,
  u: (p, c) => ({ u_sp: p.sp * c.s, u_ang: p.angle * D, u_orig: p.orig, u_col: hex3(p.color), u_wav: p.wav / 100 }) });

shader('innerglow', `uniform sampler2D u_b; uniform vec3 u_col; uniform float u_int, u_ch; void main(){ vec4 c=T(v_uv); float d=texture2D(u_b,v_uv).a; float k=clamp((1.-d)*2.*u_int - u_ch,0.,1.)*c.a;
  vec3 r=unp(c); vec3 o=mix(r, 1.-(1.-r)*(1.-u_col), k); gl_FragColor=pm(o,c.a); }`);
def('innerglow', { name: 'Inner Glow', cat: 'draw', desc: 'Glows inward from the edges of the layer.',
  params: { color: col('Color', '#ffffff'), r: px('Radius', 30, 0, 400), int: pct('Intensity', 100, 0, 400), choke: pct('Choke', 0) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('innerglow', { u_tex: cur, u_b: b }, { u_col: hex3(p.color), u_int: p.int / 100, u_ch: p.choke / 100 }); } });

def('roughen', { name: 'Roughen Edges', cat: 'draw', desc: 'Makes the edges of the layer rough, torn or eroded.',
  params: { border: px('Border', 14, 0, 300, { step: 0.1 }), sc: px('Scale', 40, 2, 600), cx: num('Complexity', 4, 1, 8, { step: 1 }), sharp: pct('Sharpness', 70), evo: evo(), spd: num('Speed', 0, 0, 20, { step: 0.01 }) },
  fs: `uniform float u_b, u_sc, u_cx, u_sh, u_ev; void main(){ vec2 P=v_uv*u_res; vec3 q=vec3(P/u_sc, u_ev); vec2 o=vec2(fbm(q,u_cx)-0.5, fbm(q+vec3(5.2,1.3,2.7),u_cx)-0.5)*2.*u_b;
  vec4 s=Tp(P+o); float n=fbm(q*2.3+9.,3.)-0.5; float a=clamp((s.a-0.5+n*0.25*min(u_b/8.,1.))*mix(1.,12.,u_sh)+0.5,0.,1.); gl_FragColor=vec4(unp(s)*a,a); }`,
  u: (p, c) => ({ u_b: p.border * c.s, u_sc: p.sc * c.s, u_cx: p.cx, u_sh: p.sharp / 100, u_ev: p.evo * 0.1 + c.lt * p.spd }) });

shader('bevel', `uniform sampler2D u_b; uniform vec2 u_l; uniform float u_int, u_w; uniform vec3 u_hi, u_sh; void main(){ vec4 c=T(v_uv); vec2 e=1./u_res;
  float dx=(texture2D(u_b,v_uv+vec2(e.x,0.)).a-texture2D(u_b,v_uv-vec2(e.x,0.)).a)*0.5, dy=(texture2D(u_b,v_uv+vec2(0.,e.y)).a-texture2D(u_b,v_uv-vec2(0.,e.y)).a)*0.5;
  vec3 n=normalize(vec3(-dx*u_w*1.2,-dy*u_w*1.2,1.)); vec3 L=normalize(vec3(u_l*0.7071,0.7071)); float s=(dot(n,L)-L.z)*u_int*1.6;
  vec3 r=unp(c); vec3 o = s>0. ? mix(r,u_hi,clamp(s,0.,0.9)) : mix(r,u_sh,clamp(-s,0.,0.8));
  float sp=pow(clamp(s,0.,1.),4.)*0.35; gl_FragColor=pm(clamp(o+sp,0.,1.),c.a); }`);
def('bevel', { name: 'Smooth Bevel', cat: 'draw', desc: 'Gives the layer smooth, rounded raised edges lit from one side.',
  params: { w: px('Width', 14, 1, 200), angle: num('Light Angle', 135, -360, 360, { unit: '°' }), int: pct('Intensity', 80, 0, 300), hi: col('Highlight', '#ffffff'), sh: col('Shadow', '#000000') },
  run(g, cur, p, c) { const b = g.blur(cur, p.w * c.s); const d = dir(p.angle); return g.pass('bevel', { u_tex: cur, u_b: b }, { u_l: [-d[0], -d[1]], u_w: p.w * c.s, u_int: p.int / 100, u_hi: hex3(p.hi), u_sh: hex3(p.sh) }); } });

shader('smoothedge', `uniform sampler2D u_b; uniform float u_k; void main(){ vec4 b=texture2D(u_b,v_uv); float a=clamp((b.a-0.5)*u_k+0.5,0.,1.); gl_FragColor=vec4(unp(b)*a,a); }`);
def('smoothedges', { name: 'Smooth Edges', cat: 'draw', desc: 'Rounds off jagged corners and gives the outline a clean anti-aliased edge.',
  params: { r: px('Radius', 8, 0, 200, { step: 0.1 }), sharp: pct('Sharpness', 60) },
  run(g, cur, p, c) { const b = g.blur(cur, p.r * c.s); return g.pass('smoothedge', { u_tex: cur, u_b: b }, { u_k: 1 + p.sharp / 100 * Math.max(2, p.r * c.s * 0.8) }); } });

shader('dilate', `uniform float u_r, u_mode; void main(){ vec2 P=v_uv*u_res; float m=0.; float inner=1.;
  for(int i=0;i<32;i++){ float a=float(i)*TAU/32.; vec2 d=vec2(cos(a),sin(a)); m=max(m,max(Tp(P+d*u_r).a, max(Tp(P+d*u_r*0.66).a, Tp(P+d*u_r*0.33).a))); inner=min(inner,min(Tp(P+d*u_r).a, Tp(P+d*u_r*0.5).a)); }
  float a=T(v_uv).a; float ring = u_mode<0.5 ? m : u_mode<1.5 ? a*(1.-inner) : max(m*(1.-inner), 0.); gl_FragColor=vec4(clamp(ring,0.,1.)); }`);
shader('strokecomp', `uniform sampler2D u_m; uniform vec3 u_col; uniform float u_op, u_mode, u_only; void main(){ vec4 c=T(v_uv); float m=texture2D(u_m,v_uv).r*u_op; vec4 s=vec4(u_col*m,m);
  vec4 base = u_only>0.5 ? vec4(0.) : c; gl_FragColor = u_mode<0.5 ? over(base, s) : over(s, base); }`);
def('strokecolor', { name: 'Stroke Color', cat: 'draw', desc: 'Outlines the layer with a solid coloured stroke.',
  params: { color: col('Color', '#ffffff'), w: px('Width', 8, 0.5, 200, { step: 0.1 }), mode: sel('Position', 'outside', [['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Center']]), op: pct('Opacity', 100), only: bool('Stroke Only', false) },
  run(g, cur, p, c) { const m = ['outside', 'inside', 'center'].indexOf(p.mode); const r = p.w * c.s * (m === 2 ? 0.5 : 1);
    const mk = g.run('dilate', { u_r: r, u_mode: m }); return g.pass('strokecomp', { u_tex: cur, u_m: mk }, { u_col: hex3(p.color), u_op: p.op / 100, u_mode: m === 0 ? 0 : 1, u_only: p.only }); } });

def('stroketaper', { name: 'Stroke Taper', cat: 'draw', desc: 'Tapers the start and end of freehand strokes and shape outlines.', kind: 'shape',
  params: { start: pct('Start Taper', 35), end: pct('End Taper', 35), min: pct('Minimum Width', 0) }, sample: 'draw' });
