// Procedural effects: generate patterns inside the layer (masked by its alpha) or add light over it.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, evo, seed, hex3 } from './core.js';
import { pos, dir, bloom } from './color.js';
const D = Math.PI / 180;
const OUT = `uniform float u_op; vec4 outp(vec3 pat){ vec4 c=T(v_uv); return mix(c, pm(pat,c.a), u_op); }`;
const op = () => pct('Opacity', 100);
const ev = (p, c) => p.evo * 0.1 + c.lt * (p.spd || 0);

def('blocknoise', { name: 'Block Noise', cat: 'proc', desc: 'Fills the layer with a grid of randomly coloured blocks.',
  params: { size: px('Block Size', 40, 2, 1000), mode: sel('Colors', 'rand', [['rand', 'Random Colors'], ['gray', 'Grayscale'], ['two', 'Two Colors']]), c1: col('Color 1', '#00ffa8'), c2: col('Color 2', '#1d2140'),
    aspect: pct('Aspect', 100, 10, 1000), evo: evo(), spd: num('Speed', 4, 0, 60, { unit: 'Hz', step: 0.01 }), seed: seed(), op: op() },
  fs: OUT + `uniform vec2 u_sz; uniform float u_mode, u_ev, u_seed; uniform vec3 u_c1, u_c2; void main(){ vec2 id=floor((v_uv*u_res-u_c)/u_sz); float t=floor(u_ev);
  vec3 r=h33(vec3(id, t+u_seed*7.)); vec3 pat = u_mode<0.5 ? r : u_mode<1.5 ? vec3(r.x) : mix(u_c2,u_c1,step(0.5,r.x)); gl_FragColor=outp(pat); }`,
  u: (p, c) => ({ u_sz: [p.size * c.s, p.size * c.s * p.aspect / 100], u_mode: ['rand', 'gray', 'two'].indexOf(p.mode), u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_ev: p.evo + c.lt * p.spd, u_seed: p.seed, u_op: p.op / 100 }) });

def('checker', { name: 'Checker', cat: 'proc', desc: 'Fills the layer with a checkerboard.',
  params: { size: px('Size', 50, 2, 1000), c1: col('Color 1', '#ffffff'), c2: col('Color 2', '#1d2140'), angle: ang('Angle', 0), offset: vec2('Offset', [0, 0]), op: op() },
  fs: OUT + `uniform float u_sz, u_an; uniform vec2 u_off; uniform vec3 u_c1, u_c2; void main(){ vec2 q=rot2(u_an)*(v_uv*u_res-u_c-u_off)/u_sz; vec2 f=fract(q)-0.5; vec2 id=floor(q);
  float sx=clamp((abs(fract(q.x*0.5)-0.5)-0.25)*u_sz*2.,-1.,1.), sy=clamp((abs(fract(q.y*0.5)-0.5)-0.25)*u_sz*2.,-1.,1.); gl_FragColor=outp(mix(u_c1,u_c2,0.5+0.5*sx*sy)); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_an: p.angle * D, u_off: [p.offset[0] * c.s, -p.offset[1] * c.s], u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_op: p.op / 100 }) });

def('clouds', { name: 'Clouds', cat: 'proc', desc: 'Generates soft, billowing fractal clouds.',
  params: { sc: px('Scale', 260, 10, 4000), cx: num('Complexity', 6, 1, 8, { step: 1 }), ct: pct('Contrast', 120, 10, 400), c1: col('Sky Color', '#2a5bd7'), c2: col('Cloud Color', '#ffffff'), evo: evo(), spd: num('Speed', 0.15, 0, 10, { step: 0.01 }), drift: vec2('Drift', [20, 0], 2000), op: op() },
  fs: OUT + `uniform float u_sc, u_cx, u_ct, u_ev; uniform vec2 u_dr; uniform vec3 u_c1, u_c2; void main(){ vec2 P=v_uv*u_res-u_c+u_dr; float n=fbm(vec3(P/u_sc,u_ev),u_cx);
  n=clamp((n-0.5)*u_ct+0.5,0.,1.); gl_FragColor=outp(mix(u_c1,u_c2,smoothstep(0.3,0.85,n))); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_cx: p.cx, u_ct: p.ct / 100 * 1.6, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_ev: ev(p, c), u_dr: [-p.drift[0] * c.s * c.lt, p.drift[1] * c.s * c.lt], u_op: p.op / 100 }) });

def('contourstrips', { name: 'Contour Strips', cat: 'proc', desc: 'Fills the layer with flowing, wavy strips.',
  params: { count: num('Strips', 14, 1, 200, { step: 0.1 }), th: pct('Thickness', 50, 1, 99), wav: pct('Waviness', 35, 0, 300), angle: ang('Angle', 0), c1: col('Color 1', '#ffffff'), c2: col('Color 2', '#2b6fff'), spd: num('Speed', 0.3, -10, 10, { step: 0.01 }), evo: evo(), op: op() },
  fs: OUT + `uniform float u_n, u_th, u_wv, u_an, u_ev, u_ph; uniform vec3 u_c1, u_c2; void main(){ vec2 q=rot2(u_an)*toL(v_uv*u_res); float w=(fbm(vec3(q*1.3,u_ev),4.)-0.5)*u_wv;
  float v=(q.y*0.5+w)*u_n+u_ph; float f=fract(v); float px=u_n/max(u_hs.y,1.)*0.5*1.5; float k=smoothstep(u_th-px,u_th+px,f)*(1.-smoothstep(1.-px,1.,f)); gl_FragColor=outp(mix(u_c1,u_c2,1.-k)); }`,
  u: (p, c) => ({ u_n: p.count, u_th: p.th / 100, u_wv: p.wav / 100, u_an: p.angle * D, u_ev: p.evo * 0.1 + c.lt * 0.2, u_ph: c.lt * p.spd, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_op: p.op / 100 }) });

def('dots', { name: 'Dots', cat: 'proc', desc: 'Fills the layer with a regular pattern of dots.',
  params: { sp: px('Spacing', 44, 2, 1000), size: pct('Dot Size', 55, 1, 150), c1: col('Dot Color', '#ffffff'), c2: col('Background', '#2b6fff'), stag: bool('Staggered', true), angle: ang('Angle', 0), op: op() },
  fs: OUT + `uniform float u_sp, u_sz, u_st, u_an; uniform vec3 u_c1, u_c2; void main(){ vec2 q=rot2(u_an)*(v_uv*u_res-u_c)/u_sp; if(u_st>0.5) q.x+=0.5*mod(floor(q.y),2.);
  vec2 f=fract(q)-0.5; float d=(length(f)-u_sz*0.5)*u_sp; gl_FragColor=outp(mix(u_c2,u_c1,aa(d))); }`,
  u: (p, c) => ({ u_sp: p.sp * c.s, u_sz: p.size / 100, u_st: p.stag, u_an: p.angle * D, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_op: p.op / 100 }) });

shader('beam', `uniform vec2 u_a, u_b; uniform float u_w, u_jit, u_ph; uniform vec3 u_col, u_core; uniform float u_int;
void main(){ vec2 P=v_uv*u_res; vec2 ab=u_b-u_a; float L=max(length(ab),1.); vec2 d=ab/L; vec2 n=vec2(-d.y,d.x); float t=dot(P-u_a,d)/L; float y=dot(P-u_a,n);
  float env=smoothstep(0.,0.04,t)*smoothstep(1.,0.96,t); float o=(fbm(vec3(t*6.,u_ph,0.5),4.)-0.5)*u_jit*u_w*6.*env; float dd=abs(y-o);
  float w=u_w*(0.85+0.3*fbm(vec3(t*20.-u_ph*3.,0.,2.),2.)); float core=exp(-pow(dd/(w*0.45),2.)); float glow=w/(dd+w)*0.6+exp(-dd/(w*3.))*0.5; float m=(t>0.&&t<1.)?1.:exp(-min(abs(t),abs(t-1.))*L/w*0.7);
  vec3 g=(u_core*core*1.2+u_col*glow)*m*u_int; gl_FragColor=addGlow(T(v_uv), g); }`);
def('energybeam', { name: 'Energy Beam', cat: 'proc', desc: 'Fires a crackling beam of energy between two points.',
  params: { a: vec2('Start Point', [-320, 0]), b: vec2('End Point', [320, 0]), w: px('Thickness', 14, 1, 300), color: col('Color', '#2f8cff'), core: col('Core Color', '#ffffff'), jit: pct('Jitter', 35, 0, 300), spd: num('Speed', 2, 0, 30, { step: 0.01 }), int: pct('Intensity', 100, 0, 400) },
  run(g, cur, p, c) { return g.run('beam', { u_a: pos(c, p.a), u_b: pos(c, p.b), u_w: p.w * c.s, u_jit: p.jit / 100, u_ph: c.lt * p.spd, u_col: hex3(p.color), u_core: hex3(p.core), u_int: p.int / 100 }); } });

def('fractalridges', { name: 'Fractal Ridges', cat: 'proc', desc: 'Generates sharp ridged fractal noise, like mountains or veins.',
  params: { sc: px('Scale', 260, 10, 4000), cx: num('Complexity', 6, 1, 8, { step: 1 }), c1: col('Color 1', '#0b0d17'), c2: col('Color 2', '#d9dde8'), evo: evo(), spd: num('Speed', 0.1, 0, 10, { step: 0.01 }), op: op() },
  fs: OUT + `uniform float u_sc, u_cx, u_ev; uniform vec3 u_c1, u_c2; void main(){ float n=ridge(vec3((v_uv*u_res-u_c)/u_sc,u_ev),u_cx); gl_FragColor=outp(mix(u_c1,u_c2,clamp(n*1.15,0.,1.))); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_cx: p.cx, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_ev: ev(p, c), u_op: p.op / 100 }) });

def('grid', { name: 'Grid', cat: 'proc', desc: 'Draws a grid of lines over the layer.',
  params: { sp: px('Spacing', 60, 2, 1000), w: px('Line Width', 3, 0.2, 100, { step: 0.1 }), color: col('Line Color', '#ffffff'), bg: col('Background', '#2b6fff'), bgop: pct('Background Opacity', 100), angle: ang('Angle', 0), offset: vec2('Offset', [0, 0]) },
  fs: `uniform float u_sp, u_w, u_an, u_bo; uniform vec2 u_off; uniform vec3 u_col, u_bg; void main(){ vec4 c=T(v_uv); vec2 q=rot2(u_an)*(v_uv*u_res-u_c-u_off); vec2 f=abs(fract(q/u_sp+0.5)-0.5)*u_sp;
  float k=aa(min(f.x,f.y)-u_w*0.5); vec4 bg=mix(c, vec4(u_bg*c.a,c.a), u_bo); gl_FragColor=mix(bg, vec4(u_col*c.a,c.a), k); }`,
  u: (p, c) => ({ u_sp: p.sp * c.s, u_w: p.w * c.s, u_an: p.angle * D, u_bo: p.bgop / 100, u_off: [p.offset[0] * c.s, -p.offset[1] * c.s], u_col: hex3(p.color), u_bg: hex3(p.bg) }) });

def('grunge', { name: 'Grunge', cat: 'proc', desc: 'Distresses the layer with worn, scratched and dirty texture.',
  params: { amt: pct('Amount', 45), sc: px('Scale', 140, 5, 3000), mode: sel('Mode', 'erode', [['erode', 'Erode'], ['dirt', 'Dirt']]), color: col('Dirt Color', '#2b2118'), evo: evo(), seed: seed() },
  fs: `uniform float u_a, u_sc, u_mode, u_ev; uniform vec3 u_col; void main(){ vec4 c=T(v_uv); vec2 P=v_uv*u_res-u_c; vec3 q=vec3(P/u_sc,u_ev);
  float n=fbm(q,6.)*0.75+ridge(q*3.1,3.)*0.25; float sp=step(0.985,h12(floor(P/1.5)+u_ev))*0.6; float scr=smoothstep(0.985,1.,1.-abs(fbm(vec3(P.x/u_sc*0.15,P.y/u_sc*6.,u_ev),3.)-0.5)*2.)*0.8; float g=clamp(n-sp*0.4-scr*0.5,0.,1.);
  if(u_mode<0.5){ float k=smoothstep(u_a*0.8-0.06,u_a*0.8+0.06,g); gl_FragColor=c*k; } else { float k=1.-smoothstep(u_a*0.7-0.1,u_a*0.7+0.1,g); gl_FragColor=pm(mix(unp(c),u_col,k*0.85),c.a); } }`,
  u: (p, c) => ({ u_a: p.amt / 100, u_sc: p.sc * c.s, u_mode: p.mode === 'dirt', u_col: hex3(p.color), u_ev: p.evo * 0.1 + p.seed * 1.7 }) });

def('hexarray', { name: 'Hexagon Array', cat: 'proc', desc: 'Fills the layer with a honeycomb of hexagons.',
  params: { size: px('Size', 46, 3, 1000), gap: pct('Gap', 12, 0, 90), c1: col('Color 1', '#ffffff'), c2: col('Background', '#2b6fff'), vary: pct('Variation', 30), evo: evo(), op: op() },
  fs: OUT + `uniform float u_sz, u_gap, u_var, u_ev; uniform vec3 u_c1, u_c2; vec4 hexc(vec2 uv){ vec2 r=vec2(1.,1.7320508); vec2 h=r*.5; vec2 a=mod(uv,r)-h; vec2 b=mod(uv-h,r)-h; vec2 gv=dot(a,a)<dot(b,b)?a:b; return vec4(gv, uv-gv); }
  void main(){ vec4 h=hexc((v_uv*u_res-u_c)/u_sz); vec2 g=abs(h.xy); float d=max(dot(g,normalize(vec2(1.,1.7320508))),g.x); float k=aa((d-0.5*(1.-u_gap))*u_sz); float r=h13(vec3(h.zw,floor(u_ev)));
  vec3 cc=u_c1*mix(1.,0.55+r*0.6,u_var); gl_FragColor=outp(mix(u_c2,cc,k)); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_gap: p.gap / 100, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_var: p.vary / 100, u_ev: p.evo, u_op: p.op / 100 }) });

def('iridescence', { name: 'Iridescence', cat: 'proc', desc: 'Adds a shimmering, oil-slick rainbow sheen.',
  params: { sc: px('Scale', 220, 10, 4000), int: pct('Intensity', 80), shift: ang('Shift', 0), spd: num('Speed', 0.2, -10, 10, { step: 0.01 }), mode: sel('Blend', 'soft', [['soft', 'Soft Light'], ['screen', 'Screen'], ['normal', 'Normal']]) },
  fs: `uniform float u_sc, u_int, u_sh, u_mode, u_ev; void main(){ vec4 c=T(v_uv); vec3 r=unp(c); vec2 P=v_uv*u_res-u_c; float n=fbm(vec3(P/u_sc,u_ev),4.);
  float ph=n*2.2+luma(r)*0.8+u_sh; vec3 ir=0.5+0.5*cos(TAU*(ph+vec3(0.,0.33,0.67))); ir=mix(ir,vec3(1.),0.15);
  vec3 o = u_mode<0.5 ? blendm(r,ir,4.) : u_mode<1.5 ? blendm(r,ir,2.) : ir; gl_FragColor=pm(mix(r,o,u_int),c.a); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_int: p.int / 100, u_sh: p.shift / 360, u_mode: ['soft', 'screen', 'normal'].indexOf(p.mode), u_ev: c.lt * p.spd }) });

shader('flare', `uniform vec2 u_lp, u_cen; uniform float u_br, u_sz, u_gh; uniform vec3 u_tint; void main(){ vec2 P=v_uv*u_res; vec2 d=P-u_lp; float R=u_sz; float r=length(d)/R; float a=atan(d.y,d.x);
  vec3 col=vec3(0.); col+=u_tint*exp(-r*3.)*1.2 + vec3(1.)*exp(-r*14.)*1.5;
  float rays=pow(abs(sin(a*6.+0.3)),40.)*0.6+pow(abs(sin(a*3.7+1.1)),80.)*0.5; rays*=n3(vec3(a*4.,0.,1.))*0.7+0.5; col+=u_tint*rays*exp(-r*1.4)*0.9;
  float ring=exp(-pow((r-1.4)*9.,2.))*0.18; col+=vec3(ring*1.1,ring*0.8,ring*1.3);
  float hb=exp(-pow(d.y/(R*0.012),2.))*exp(-abs(d.x)/(R*3.))*0.6; col+=mix(u_tint,vec3(0.6,0.8,1.),0.5)*hb;
  if(u_gh>0.5){ vec2 ax=u_cen-u_lp; for(int i=0;i<6;i++){ float k=float(i); float t=0.35+k*0.3-(k>3.5?2.1:0.); vec2 gp=u_lp+ax*t*2.; float gs=R*(0.08+0.07*h11(k*3.1)+k*0.02);
    float gd=length(P-gp)/gs; vec3 gc=hsv2rgb(vec3(fract(0.08+k*0.17),0.6,1.)); col+=gc*(smoothstep(1.,0.85,gd)*0.10+exp(-pow((gd-1.)*7.,2.))*0.08); } }
  gl_FragColor=addGlow(T(v_uv), col*u_br); }`);
def('lensflare', { name: 'Lens Flare', cat: 'proc', desc: 'Simulates the glare, rays and ghosts of bright light hitting a lens.',
  params: { posn: vec2('Flare Center', [-180, -280]), br: pct('Brightness', 100, 0, 400), size: pct('Size', 100, 5, 500), tint: col('Color', '#ffc88a'), ghosts: bool('Ghosts', true) },
  run(g, cur, p, c) { return g.run('flare', { u_lp: pos(c, p.posn), u_cen: [g.W / 2, g.H / 2], u_br: p.br / 100, u_sz: p.size / 100 * Math.min(g.W, g.H) * 0.35, u_tint: hex3(p.tint), u_gh: p.ghosts }); } });

shader('bolt', `uniform vec2 u_a, u_b; uniform float u_w, u_br, u_ph, u_amp; uniform vec3 u_col;
float boltD(vec2 P, vec2 A, vec2 B, float sd, float amp){ vec2 ab=B-A; float L=max(length(ab),1.); vec2 d=ab/L; vec2 n=vec2(-d.y,d.x); float t=dot(P-A,d)/L; float y=dot(P-A,n);
  float env=sin(clamp(t,0.,1.)*PI); float o=((fbm(vec3(t*5.,sd,u_ph),5.)-0.5)*1.6+(fbm(vec3(t*22.,sd+3.,u_ph),3.)-0.5)*0.35)*L*amp*env; float dd=abs(y-o);
  if(t<0.) dd=length(P-A); if(t>1.) dd=length(P-B); return dd; }
void main(){ vec2 P=v_uv*u_res; float d=boltD(P,u_a,u_b,1.,u_amp); vec2 ab=u_b-u_a; vec2 n=vec2(-ab.y,ab.x);
  for(int i=0;i<3;i++){ if(float(i)>=u_br) break; float k=float(i); float t0=0.25+0.22*k+0.1*h11(u_ph+k); vec2 s=u_a+ab*t0; vec2 e=s+ab*(0.25+0.15*h11(k+u_ph*1.3))+n*(h11(k*7.+u_ph)-0.5)*0.8;
    d=min(d, boltD(P,s,e,7.+k*5.,u_amp*0.8)*1.6); }
  float core=exp(-pow(d/(u_w*0.5),2.)); float glow=u_w*1.2/(d+u_w*1.2)*0.55; vec3 g=vec3(1.)*core*1.3+u_col*glow; gl_FragColor=addGlow(T(v_uv), g); }`);
def('lightning', { name: 'Lightning', cat: 'proc', desc: 'Strikes animated, branching lightning between two points.',
  params: { a: vec2('Start Point', [-60, -480]), b: vec2('End Point', [80, 420]), w: px('Width', 4, 0.5, 60, { step: 0.1 }), color: col('Glow Color', '#7f9dff'), br: num('Branches', 2, 0, 3, { step: 1 }), amp: pct('Wildness', 18, 0, 100), spd: num('Speed', 10, 0, 60, { unit: 'Hz', step: 0.01 }), r: px('Glow', 26, 0, 300), seed: seed() },
  run(g, cur, p, c) { const ph = Math.floor(c.lt * p.spd) * 1.37 + p.seed * 0.71; const b = g.run('bolt', { u_a: pos(c, p.a), u_b: pos(c, p.b), u_w: p.w * c.s, u_br: p.br, u_ph: ph, u_amp: p.amp / 100, u_col: hex3(p.color) });
    return p.r > 0 ? bloom(g, b, b, p.r * c.s, 0.35, p.color, 0.6) : b; } });

def('noise', { name: 'Noise', cat: 'proc', desc: 'Adds film-like grain or fills the layer with random noise.',
  params: { amt: pct('Amount', 35), sc: px('Grain Size', 1, 0.5, 50, { step: 0.1 }), color: bool('Color Noise', false), anim: bool('Animated', true), seed: seed() },
  fs: `uniform float u_a, u_sc, u_cn, u_t; void main(){ vec4 c=T(v_uv); vec2 P=floor((v_uv*u_res-u_c)/u_sc); vec3 n = u_cn>0.5 ? h33(vec3(P,u_t)) : vec3(h13(vec3(P,u_t)));
  vec3 r=unp(c); vec3 o=r+(n-0.5)*u_a*1.6; o=mix(o, n, max(u_a-0.6,0.)*2.5); gl_FragColor=pm(o,c.a); }`,
  u: (p, c) => ({ u_a: p.amt / 100, u_sc: Math.max(0.5, p.sc * c.s), u_cn: p.color, u_t: (p.anim ? Math.floor(c.t * 30) : 0) + p.seed * 13.1 }) });

def('ominodiff', { name: 'Omino Diffusion+', cat: 'proc', desc: 'Generates soft, diffusing smoke-like colour fields.',
  params: { sc: px('Scale', 240, 10, 4000), c1: col('Color 1', '#0b1a3a'), c2: col('Color 2', '#3fc9ff'), c3: col('Color 3', '#ffffff'), diff: pct('Diffusion', 60), spd: num('Speed', 0.25, 0, 10, { step: 0.01 }), evo: evo(), op: op() },
  fs: OUT + `uniform float u_sc, u_df, u_ev; uniform vec3 u_c1, u_c2, u_c3; void main(){ vec2 P=(v_uv*u_res-u_c)/u_sc; vec3 q=vec3(P,u_ev);
  vec2 w=vec2(fbm(q,5.),fbm(q+vec3(4.1,1.7,0.),5.)); vec2 w2=vec2(fbm(q+vec3(w*3.5*u_df,0.)+vec3(1.,7.,0.),5.), fbm(q+vec3(w*3.5*u_df,0.)+vec3(8.,2.,0.),5.)); float n=fbm(q+vec3(w2*4.*u_df,0.),5.);
  vec3 col=mix(u_c1,u_c2,smoothstep(0.25,0.7,n)); col=mix(col,u_c3,smoothstep(0.62,0.9,n*w2.x*1.6)); gl_FragColor=outp(col); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_df: p.diff / 100, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_c3: hex3(p.c3), u_ev: ev(p, c), u_op: p.op / 100 }) });

def('radialrays', { name: 'Radial Rays', cat: 'proc', desc: 'Fills the layer with a sunburst of alternating rays.',
  params: { n: num('Rays', 16, 2, 200, { step: 1 }), c1: col('Color 1', '#ffffff'), c2: col('Color 2', '#2b6fff'), rot: ang('Rotation', 0), spd: num('Speed', 10, -720, 720, { unit: '°/s', step: 0.1 }), center: vec2('Center', [0, 0]), ratio: pct('Ratio', 50, 1, 99), op: op() },
  fs: OUT + `uniform float u_n, u_rt, u_ra; uniform vec2 u_cen; uniform vec3 u_c1, u_c2; void main(){ vec2 d=v_uv*u_res-u_cen; float a=atan(d.y,d.x)+u_rt; float f=fract(a/TAU*u_n); float r=length(d);
  float w=max(r*TAU/u_n,1.); float k=clamp(min(f,u_ra-f)*w+0.5,0.,1.)*step(f,u_ra+0.5/w)+clamp((f-1.)*w+0.5,0.,1.); gl_FragColor=outp(mix(u_c2,u_c1,clamp(k,0.,1.))); }`,
  u: (p, c) => ({ u_n: Math.round(p.n), u_rt: -(p.rot + p.spd * c.lt) * D, u_ra: p.ratio / 100, u_cen: pos(c, p.center), u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_op: p.op / 100 }) });

shader('ribbon', `uniform float u_n, u_w, u_amp, u_fr, u_ph, u_int; uniform vec3 u_c1, u_c2; void main(){ vec2 q=toL(v_uv*u_res); vec3 col=vec3(0.); float pxs=1./max(u_hs.y,1.);
  for(int i=0;i<8;i++){ if(float(i)>=u_n) break; float k=float(i); float y=sin(q.x*u_fr*PI+u_ph+k*1.3)*u_amp*(0.6+0.4*sin(k*2.1))+sin(q.x*u_fr*2.3*PI-u_ph*1.7+k)*u_amp*0.25+(k-(u_n-1.)*0.5)*u_amp*0.18;
    float th=u_w*pxs*(0.55+0.45*sin(q.x*3.+u_ph+k*0.7)); float d=abs(q.y-y); float core=smoothstep(th,th*0.2,d); float glow=th*0.9/(d+th*0.9)*0.35;
    vec3 cc=mix(u_c1,u_c2,0.5+0.5*sin(q.x*2.+k+u_ph*0.5)); col+=cc*(core*0.85+glow); }
  gl_FragColor=addGlow(T(v_uv), col*u_int); }`);
def('ribbon', { name: 'Ribbon', cat: 'proc', desc: 'Draws flowing, glowing ribbons of light.',
  params: { n: num('Count', 3, 1, 8, { step: 1 }), w: px('Width', 26, 1, 400), amp: pct('Amplitude', 30, 0, 200), fr: num('Frequency', 1.2, 0.1, 10, { step: 0.01 }), spd: num('Speed', 0.6, -10, 10, { step: 0.01 }), c1: col('Color 1', '#7b5cff'), c2: col('Color 2', '#00e0ff'), int: pct('Intensity', 100, 0, 400) },
  run(g, cur, p, c) { return g.run('ribbon', { u_n: p.n, u_w: p.w * c.s, u_amp: p.amp / 100, u_fr: p.fr, u_ph: c.lt * p.spd * Math.PI * 2, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_int: p.int / 100 }); } });

def('simplestarfield', { name: 'Simple Starfield', cat: 'proc', desc: 'Scatters twinkling stars over the layer.',
  params: { dens: pct('Density', 50), size: px('Star Size', 2.2, 0.3, 30, { step: 0.1 }), tw: pct('Twinkle', 50), color: col('Color', '#ffffff'), seed: seed() },
  fs: `uniform float u_den, u_sz, u_tw, u_seed; uniform vec3 u_col; void main(){ vec2 P=v_uv*u_res-u_c; vec3 col=vec3(0.); float cs=u_sz*14.;
  for(int l=0;l<2;l++){ float sc=cs*(1.+float(l)*0.6); vec2 id=floor(P/sc); vec2 f=P-id*sc; vec3 r=h33(vec3(id,u_seed+float(l)*9.)); if(r.z>u_den) continue;
    vec2 sp=(0.15+0.7*r.xy)*sc; float d=length(f-sp); float b=h13(vec3(id,7.+float(l))); float tw=1.-u_tw*0.5*(1.+sin(u_time*(2.+b*5.)+b*40.)); float s=u_sz*(0.5+b);
    col+=u_col*(aa(d-s*0.5)*0.9+exp(-d/(s*1.2))*0.35)*tw*(0.4+b*0.6); }
  gl_FragColor=addGlow(T(v_uv), col); }`, u: (p, c) => ({ u_den: p.dens / 100, u_sz: p.size * c.s, u_tw: p.tw / 100, u_col: hex3(p.color), u_seed: p.seed }) });

shader('sparkle', `uniform vec2 u_p; uniform float u_n, u_sz, u_gl, u_ro, u_int; uniform vec3 u_col; void main(){ vec2 d=rot2(u_ro)*(v_uv*u_res-u_p); float r=length(d); vec3 col=vec3(0.);
  for(int i=0;i<8;i++){ if(float(i)>=u_n) break; float a=float(i)*PI/u_n; vec2 dv=vec2(cos(a),sin(a)); float along=abs(dot(d,dv)), across=abs(dot(d,vec2(-dv.y,dv.x)));
    float len=u_sz*(mod(float(i),2.)<0.5?1.:0.6); col+=u_col*exp(-across/(u_sz*0.012+0.6))*max(0.,1.-along/len)*1.2; }
  col+=mix(u_col,vec3(1.),0.6)*exp(-r/(u_sz*0.05))*1.5 + u_col*exp(-r/(u_sz*0.3))*0.5*u_gl; gl_FragColor=addGlow(T(v_uv), col*u_int); }`);
def('star', { name: 'Star', cat: 'proc', desc: 'Adds a glinting, glowing star sparkle.',
  params: { posn: vec2('Position', [0, 0]), pts: num('Rays', 4, 1, 8, { step: 1 }), size: px('Size', 260, 2, 4000), glow: pct('Glow', 100, 0, 400), rot: ang('Rotation', 0), tw: pct('Twinkle', 30), color: col('Color', '#bfe8ff') },
  run(g, cur, p, c) { const tw = 1 - p.tw / 100 * 0.5 * (1 + Math.sin(c.lt * 7)); return g.run('sparkle', { u_p: pos(c, p.posn), u_n: Math.round(p.pts), u_sz: p.size * c.s * (0.7 + 0.3 * tw), u_gl: p.glow / 100, u_ro: p.rot * D, u_int: tw, u_col: hex3(p.color) }); } });

def('starfield', { name: 'Starfield', cat: 'proc', desc: 'Flies through a deep field of stars, with optional warp streaks.',
  params: { spd: num('Speed', 0.6, -10, 10, { step: 0.01 }), dens: pct('Density', 60), size: px('Star Size', 3, 0.3, 30, { step: 0.1 }), streak: pct('Streaks', 40, 0, 300), color: col('Color', '#ffffff'), center: vec2('Center', [0, 0]) },
  fs: `uniform float u_spd, u_den, u_sz, u_st; uniform vec2 u_cen; uniform vec3 u_col; void main(){ vec2 P=v_uv*u_res-u_cen; float H=max(u_res.y,1.); vec3 col=vec3(0.);
  for(int l=0;l<6;l++){ float z=fract(float(l)/6.+u_time*u_spd*0.12); float sc=mix(8.,0.4,z); vec2 q=P/H*sc*6.; vec2 id=floor(q); vec2 f=fract(q)-0.5; vec3 r=h33(vec3(id,float(l)*3.1+floor(float(l)/6.+u_time*u_spd*0.12)*7.));
    if(r.z>u_den) continue; vec2 sp=(r.xy-0.5)*0.8; vec2 dl=(f-sp)*H/(sc*6.); vec2 rd=normalize(P+1e-3); float al=dot(dl,rd), ac=dot(dl,vec2(-rd.y,rd.x)); al/=1.+u_st*z*z*6.;
    float d=length(vec2(al,ac)); float s=u_sz*(0.3+z*1.2); float fade=smoothstep(0.,0.25,z)*smoothstep(1.,0.85,z); col+=u_col*(aa(d-s*0.5)+exp(-d/(s*0.9))*0.4)*fade; }
  gl_FragColor=addGlow(T(v_uv), col); }`, u: (p, c) => ({ u_spd: p.spd, u_den: p.dens / 100, u_sz: p.size * c.s, u_st: p.streak / 100, u_col: hex3(p.color), u_cen: pos(c, p.center) }) });

def('stripes', { name: 'Stripes', cat: 'proc', desc: 'Fills the layer with crisp, scrolling stripes.',
  params: { w: px('Width', 34, 1, 1000), ratio: pct('Ratio', 50, 1, 99), angle: ang('Angle', 45), c1: col('Color 1', '#ffffff'), c2: col('Color 2', '#2b6fff'), spd: num('Speed', 30, -2000, 2000, { unit: 'px/s', step: 0.1 }), op: op() },
  fs: OUT + `uniform float u_w, u_ra, u_an, u_ph; uniform vec3 u_c1, u_c2; void main(){ float x=dot(v_uv*u_res-u_c, vec2(cos(u_an),sin(u_an)))+u_ph; float f=fract(x/u_w)*u_w;
  float k=clamp(min(f, u_ra*u_w-f)+0.5,0.,1.)+clamp(f-u_w+0.5,0.,1.); gl_FragColor=outp(mix(u_c2,u_c1,clamp(k,0.,1.))); }`,
  u: (p, c) => ({ u_w: p.w * c.s, u_ra: p.ratio / 100, u_an: -p.angle * D, u_ph: p.spd * c.s * c.lt, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_op: p.op / 100 }) });

def('turbulence', { name: 'Turbulence', cat: 'proc', desc: 'Generates billowing turbulent noise.',
  params: { sc: px('Scale', 200, 10, 4000), cx: num('Complexity', 5, 1, 8, { step: 1 }), c1: col('Color 1', '#000000'), c2: col('Color 2', '#ffffff'), ct: pct('Contrast', 100, 10, 400), evo: evo(), spd: num('Speed', 0.2, 0, 10, { step: 0.01 }), op: op() },
  fs: OUT + `uniform float u_sc, u_cx, u_ct, u_ev; uniform vec3 u_c1, u_c2; void main(){ float n=turb(vec3((v_uv*u_res-u_c)/u_sc,u_ev),u_cx); n=clamp((n-0.35)*u_ct*1.6+0.35,0.,1.); gl_FragColor=outp(mix(u_c1,u_c2,n)); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_cx: p.cx, u_ct: p.ct / 100, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_ev: ev(p, c), u_op: p.op / 100 }) });

def('voronoi', { name: 'Voronoi Cells', cat: 'proc', desc: 'Generates organic Voronoi cells, edges or distance fields.',
  params: { sc: px('Cell Size', 90, 4, 2000), mode: sel('Mode', 'cells', [['cells', 'Cells'], ['edges', 'Edges'], ['dist', 'Distance']]), w: px('Edge Width', 3, 0.2, 60, { step: 0.1 }), c1: col('Color 1', '#2b6fff'), c2: col('Color 2', '#ffffff'),
    jit: pct('Randomness', 100), evo: evo(), spd: num('Speed', 0.5, 0, 20, { step: 0.01 }), op: op() },
  fs: OUT + `uniform float u_sc, u_mode, u_w, u_jit, u_ev; uniform vec3 u_c1, u_c2; void main(){ vec2 q=(v_uv*u_res-u_c)/u_sc; vec3 v=vor(q,u_jit,u_ev); float e=(v.y-v.x)*u_sc*0.5; vec3 col;
  if(u_mode<0.5){ col=mix(u_c1*(0.55+0.45*v.z), u_c2*(0.6+0.4*v.z), step(0.5,fract(v.z*7.))); col=mix(col,u_c2,aa(e-u_w*0.5)*0.0); } else if(u_mode<1.5){ col=mix(u_c1,u_c2,aa(e-u_w*0.5)); } else col=mix(u_c1,u_c2,clamp(v.x,0.,1.));
  gl_FragColor=outp(col); }`,
  u: (p, c) => ({ u_sc: p.sc * c.s, u_mode: ['cells', 'edges', 'dist'].indexOf(p.mode), u_w: p.w * c.s, u_c1: hex3(p.c1), u_c2: hex3(p.c2), u_jit: p.jit / 100, u_ev: p.evo + c.lt * p.spd, u_op: p.op / 100 }) });
