// Distortion / Warp effects. All sampling is done in pixels so the look is identical at any render size.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, vec3, lay, evo, seed, hex3 } from './core.js';
import { pos, dir } from './color.js';
const D = Math.PI / 180;
const rotM = (y, p, r) => { // yaw (Y), pitch (X), roll (Z) -> column-major mat3
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy], Rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp], Rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  const mul = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
  return mul(Ry, mul(Rx, Rz));
};
export { rotM };
const M3 = `uniform vec3 u_m0, u_m1, u_m2; vec3 RM(vec3 v){ return mat3(u_m0,u_m1,u_m2)*v; }`;
const m3u = m => ({ u_m0: m.slice(0, 3), u_m1: m.slice(3, 6), u_m2: m.slice(6, 9) });
const HEX = `vec4 hexc(vec2 uv){ vec2 r=vec2(1.,1.7320508); vec2 h=r*.5; vec2 a=mod(uv,r)-h; vec2 b=mod(uv-h,r)-h; vec2 gv=dot(a,a)<dot(b,b)?a:b; return vec4(gv, uv-gv); }
float hexd(vec2 g){ g=abs(g); return max(dot(g,normalize(vec2(1.,1.7320508))), g.x); }`;

def('reorient360', { name: '360° Reorient Sphere', cat: 'distort', desc: 'Rotates a 360° equirectangular image as if turning the sphere.',
  params: { yaw: ang('Yaw', 60), pitch: ang('Pitch', 15), roll: ang('Roll', 0) },
  fs: M3 + `void main(){ vec2 q=toL(v_uv*u_res); if(abs(q.x)>1.||abs(q.y)>1.){ gl_FragColor=T(v_uv); return; } float lon=q.x*PI, lat=q.y*PI*0.5;
  vec3 d=vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon)); d=RM(d); float lo=atan(d.x,d.z), la=asin(clamp(d.y,-1.,1.)); vec2 s=vec2(lo/PI, la/(PI*0.5));
  gl_FragColor=Tp(fromL(s)); }`, u: p => m3u(rotM(p.yaw * D, p.pitch * D, p.roll * D)) });

def('viewer360', { name: '360° Viewer', cat: 'distort', desc: 'Looks around inside a 360° equirectangular image with a virtual camera.',
  params: { yaw: ang('Pan', 0), pitch: ang('Tilt', 0), roll: ang('Roll', 0), fov: num('Field of View', 90, 10, 170, { unit: '°', step: 0.1 }) },
  fs: M3 + `uniform float u_tf; void main(){ vec2 q=toL(v_uv*u_res); if(abs(q.x)>1.||abs(q.y)>1.){ gl_FragColor=vec4(0.); return; } float asp=u_hs.x/max(u_hs.y,1.);
  vec3 d=normalize(vec3(q.x*asp*u_tf, q.y*u_tf, 1.)); d=RM(d); float lo=atan(d.x,d.z), la=asin(clamp(d.y,-1.,1.)); vec2 s=vec2(lo/PI, la/(PI*0.5)); gl_FragColor=Tp(fromL(s)); }`,
  u: p => ({ ...m3u(rotM(p.yaw * D, p.pitch * D, p.roll * D)), u_tf: Math.tan(p.fov * D / 2) }) });

def('bend', { name: 'Bend', cat: 'distort', desc: 'Bends the layer along an arc.',
  params: { amt: num('Bend', 90, -360, 360, { unit: '°', step: 0.1 }), axis: sel('Direction', 'h', [['h', 'Horizontal'], ['v', 'Vertical']]) },
  fs: `uniform float u_th, u_vert; void main(){ vec2 q=toL(v_uv*u_res)*u_hs; vec2 hs=u_hs; if(u_vert>0.5){ q=q.yx; hs=hs.yx; } float sg=sign(u_th+1e-6); q.y*=sg; float th=abs(u_th);
  if(th<1e-3){ gl_FragColor=T(v_uv); return; } float R=2.*hs.x/th; vec2 v=q-vec2(0.,-R); float r=length(v); float ph=atan(v.x,v.y); vec2 s=vec2(ph*R, (r-R));
  if(abs(ph)>PI){ gl_FragColor=vec4(0.); return; } s.y*=sg; if(u_vert>0.5) s=s.yx; gl_FragColor=Tp(fromL(s/u_hs)); }`,
  u: p => ({ u_th: p.amt * D, u_vert: p.axis === 'v' }) });

def('ripple', { name: 'Circular Ripple', cat: 'distort', desc: 'Sends circular ripples out from a centre point, like a drop in water.',
  params: { center: vec2('Center', [0, 0]), amp: px('Amplitude', 14, 0, 300, { step: 0.1 }), wl: px('Wavelength', 70, 2, 2000), spd: num('Speed', 1, -20, 20, { unit: 'Hz', step: 0.01 }), radius: px('Radius', 700, 1, 5000), phase: ang('Phase', 0), shade: pct('Highlights', 30) },
  fs: `uniform vec2 u_cen; uniform float u_amp, u_wl, u_ph, u_rad, u_sh; void main(){ vec2 P=v_uv*u_res; vec2 d=P-u_cen; float r=length(d); float f=1.-smoothstep(u_rad*0.5,u_rad,r);
  float w=sin(TAU*(r/u_wl)-u_ph); vec2 n=d/max(r,1e-3); vec4 c=Tp(P-n*w*u_amp*f); float hl=cos(TAU*(r/u_wl)-u_ph)*f*u_sh*min(u_amp/10.,1.); c.rgb=clamp(c.rgb+hl*0.25*c.a,0.,1.); c.rgb=min(c.rgb,vec3(c.a)); gl_FragColor=c; }`,
  u: (p, c) => ({ u_cen: pos(c, p.center), u_amp: p.amp * c.s, u_wl: p.wl * c.s, u_ph: (p.phase * D) + c.lt * p.spd * Math.PI * 2, u_rad: p.radius * c.s, u_sh: p.shade / 100 }) });

// shared cylinder curl (Curl + Page Curl)
shader('curl', `uniform vec2 u_d; uniform float u_f, u_r, u_backmix, u_shadow, u_light; uniform vec3 u_back;
vec4 smp(vec2 lp){ return Tp(fromL(lp/u_hs)); }
void main(){ vec2 q=toL(v_uv*u_res)*u_hs; vec2 n=vec2(-u_d.y,u_d.x); float x=dot(q,u_d), y=dot(q,n); float f=u_f, r=max(u_r,1.);
  vec4 top=vec4(0.), bot=vec4(0.); float shade=1.;
  if(x>f+r){ top=vec4(0.); bot=vec4(0.); }
  else if(x>f){ float s1=r*asin(clamp((x-f)/r,-1.,1.)); float s2=r*PI-s1; vec2 p2=u_d*(f+s2)+n*y; vec2 p1=u_d*(f+s1)+n*y;
    vec4 b=smp(p2); vec3 bc=mix(unp(b), u_back, u_backmix); float lt=mix(1., 0.55+0.45*cos(s1/r), u_light); top=pm(bc*lt*1.05,b.a);
    vec4 fr=smp(p1); bot=vec4(fr.rgb*mix(1.,0.45+0.55*cos(s1/r),u_light), fr.a); }
  else { vec2 pb=u_d*(f+r*PI+(f-x))+n*y; vec4 b=smp(pb); vec3 bc=mix(unp(b),u_back,u_backmix); top=pm(bc*mix(1.,0.92,u_light),b.a);
    bot=smp(q); float sd=1.-u_shadow*exp(-(f-x)/(r*0.9))*0.75; bot.rgb*=sd; }
  gl_FragColor=over(top,bot); }`);
const curlU = (p, c, back, backmix, shadow) => { const d = dir(p.angle); const ex = Math.abs(d[0]) * c.hw + Math.abs(d[1]) * c.hh; const r = Math.max(2, p.radius / 100 * Math.min(c.hw, c.hh)), a = p.amt / 100;
  return { u_d: d, u_f: ex * (1 - a) + (-ex - Math.PI * r) * a, u_r: r, u_back: hex3(back), u_backmix: backmix, u_shadow: shadow, u_light: 0.9 }; };
def('curl', { name: 'Curl', cat: 'distort', desc: 'Rolls the layer up from one edge like a scroll of paper.',
  params: { amt: pct('Curl', 35), angle: ang('Direction', 0), radius: pct('Radius', 18, 1, 200) },
  run(g, cur, p, c) { return g.run('curl', curlU(p, c, '#ffffff', 0, 0.4)); } });

def('dispmap', { name: 'Displacement Map', cat: 'distort', desc: 'Pushes pixels around using the brightness of another layer (or itself).',
  params: { map: lay('Displacement Map'), ch: sel('Map Channel', 'luma', [['luma', 'Luminance'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['a', 'Alpha']]), hx: px('Horizontal', 40, -1000, 1000), vy: px('Vertical', 40, -1000, 1000), soft: px('Map Softness', 4, 0, 100) },
  fs: `uniform sampler2D u_map; uniform float u_ch; uniform vec2 u_amt; float mv(vec2 uv){ vec4 m=texture2D(u_map,uv); vec3 r=unp(m);
  return u_ch<0.5?luma(r)*m.a+(1.-m.a)*0.5 : u_ch<1.5?r.r : u_ch<2.5?r.g : u_ch<3.5?r.b : m.a; }
  void main(){ vec2 P=v_uv*u_res; float v=mv(v_uv)-0.5; gl_FragColor=Tp(P+u_amt*v*2.*vec2(1.,-1.)); }`,
  run(g, cur, p, c) { let m = g.layer(p.map) || cur; if (p.soft > 0) m = g.blur(m, p.soft * c.s);
    return g.pass('dispmap', { u_tex: cur, u_map: m }, { u_ch: ['luma', 'r', 'g', 'b', 'a'].indexOf(p.ch), u_amt: [p.hx * c.s, p.vy * c.s] }); } });

def('fractalwarp', { name: 'Fractal Warp', cat: 'distort', desc: 'Warps the layer with layered fractal noise, like heat haze or liquid.',
  params: { amt: px('Amount', 40, 0, 600), sc: px('Scale', 220, 5, 3000), cx: num('Complexity', 4, 1, 8, { step: 1 }), evo: evo(), spd: num('Speed', 0.3, 0, 20, { step: 0.01 }) },
  fs: `uniform float u_a, u_sc, u_cx, u_ev; void main(){ vec2 P=v_uv*u_res; vec3 q=vec3(P/u_sc,u_ev); vec2 w=vec2(fbm(q,u_cx),fbm(q+vec3(5.2,1.3,0.),u_cx));
  vec2 w2=vec2(fbm(q+vec3(w*3.,0.)+vec3(1.7,9.2,0.),u_cx), fbm(q+vec3(w*3.,0.)+vec3(8.3,2.8,0.),u_cx)); gl_FragColor=Tp(P+(w2-0.5)*2.*u_a); }`,
  u: (p, c) => ({ u_a: p.amt * c.s, u_sc: p.sc * c.s, u_cx: p.cx, u_ev: p.evo * 0.1 + c.lt * p.spd }) });

shader('glass', `uniform sampler2D u_h, u_bd; uniform float u_ref, u_hi, u_tint; uniform vec2 u_l; uniform vec3 u_tc; void main(){ vec4 c=T(v_uv); vec2 e=1.5/u_res;
  float dx=texture2D(u_h,v_uv+vec2(e.x,0.)).a-texture2D(u_h,v_uv-vec2(e.x,0.)).a, dy=texture2D(u_h,v_uv+vec2(0.,e.y)).a-texture2D(u_h,v_uv-vec2(0.,e.y)).a; vec2 g=vec2(dx,dy)/3.;
  float hgt=texture2D(u_h,v_uv).a; vec2 off=-g*u_ref*40.; vec4 b=texture2D(u_bd, v_uv+off/u_res); vec3 col=mix(unp(b), unp(b)*u_tc, u_tint);
  vec3 nrm=normalize(vec3(-g*30.,1.)); float spec=pow(max(dot(normalize(vec3(u_l,1.2)),nrm),0.),24.)*u_hi; float rim=(1.-smoothstep(0.,0.9,hgt))*0.18;
  vec3 o=col+spec+rim; gl_FragColor=pm(o, c.a); }`);
def('glass', { name: 'Glass', cat: 'distort', desc: 'Turns the layer into a piece of glass that refracts whatever is behind it.',
  params: { ref: pct('Refraction', 60, 0, 300), bevel: px('Bevel Size', 26, 1, 300), frost: px('Frost', 0, 0, 100), angle: num('Light Angle', 135, -360, 360, { unit: '°' }), hi: pct('Highlight', 70, 0, 300), tint: col('Tint', '#bfe9ff'), tamt: pct('Tint Amount', 15) },
  sample: 'stack',
  run(g, cur, p, c) { const h = g.blur(cur, p.bevel * c.s); let bd = g.backdrop(); if (p.frost > 0) bd = g.blur(bd, p.frost * c.s); const d = dir(p.angle);
    return g.pass('glass', { u_tex: cur, u_h: h, u_bd: bd }, { u_ref: p.ref / 100 * p.bevel * c.s / 26, u_hi: p.hi / 100, u_tint: p.tamt / 100, u_tc: hex3(p.tint), u_l: [-d[0], -d[1]] }); } });

def('hextilerot', { name: 'Hexagon Tile Rotate', cat: 'distort', desc: 'Cuts the layer into hexagons and rotates the contents of each one.',
  params: { size: px('Tile Size', 70, 4, 1000), rot: ang('Rotation', 60), alt: bool('Alternate', true), rnd: pct('Random', 0) },
  fs: HEX + `uniform float u_sz, u_tr, u_alt, u_rnd; void main(){ vec2 P=v_uv*u_res; vec4 h=hexc((P-u_c)/u_sz); float r=h12(h.zw*7.13); float a=u_tr*mix(1.,r*2.-1.,u_rnd);
  if(u_alt>0.5 && mod(floor(h.z*2.+0.5)+floor(h.w/1.7320508*2.+0.5),2.)>0.5) a=-a; gl_FragColor=Tp(u_c+(h.zw+rot2(a)*h.xy)*u_sz); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_tr: p.rot * D, u_alt: p.alt, u_rnd: p.rnd / 100 }) });

def('hextileshift', { name: 'Hexagon Tile Shift', cat: 'distort', desc: 'Cuts the layer into hexagons and shifts each one by a random amount.',
  params: { size: px('Tile Size', 60, 4, 1000), amt: px('Shift', 24, 0, 1000), evo: evo(), spd: num('Speed', 0, 0, 30, { step: 0.01 }), seed: seed() },
  fs: HEX + `uniform float u_sz, u_amt, u_ev, u_seed; void main(){ vec2 P=v_uv*u_res; vec4 h=hexc((P-u_c)/u_sz); vec2 id=h.zw+u_seed*1.37; float e=floor(u_ev), f=smoothstep(0.,1.,fract(u_ev));
  vec2 o=mix(h22(id+e)-0.5, h22(id+e+1.)-0.5, f)*2.; gl_FragColor=Tp(P+o*u_amt); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_amt: p.amt * c.s, u_ev: p.evo + c.lt * p.spd, u_seed: p.seed }) });

def('hextiling', { name: 'Hexagon Tiling', cat: 'distort', desc: 'Rebuilds the layer as a honeycomb of flat-coloured hexagons.',
  params: { size: px('Tile Size', 34, 3, 600), border: px('Border', 2, 0, 50, { step: 0.1 }), bcol: col('Border Color', '#0b0d17'), bop: pct('Border Opacity', 100) },
  fs: HEX + `uniform float u_sz, u_bw, u_bop; uniform vec3 u_bc; void main(){ vec2 P=v_uv*u_res; vec4 h=hexc((P-u_c)/u_sz); vec2 ce=u_c+h.zw*u_sz; vec4 acc=Tp(ce)*2.;
  for(int i=0;i<6;i++){ float a=float(i)*TAU/6.; acc+=Tp(ce+vec2(cos(a),sin(a))*u_sz*0.3); } acc/=8.; float ed=(0.5-hexd(h.xy))*u_sz; float k=(1.-aa(ed-u_bw))*u_bop*acc.a;
  gl_FragColor=mix(acc, vec4(u_bc*acc.a,acc.a), k); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_bw: p.border * c.s * 0.5, u_bc: hex3(p.bcol), u_bop: p.bop / 100 }) });

def('innerpinch', { name: 'Inner Pinch/Bulge', cat: 'distort', desc: 'Pinches or bulges the inside of the layer while its edges stay put.',
  params: { amt: num('Amount', 50, -100, 100, { step: 0.1 }), radius: pct('Radius', 100, 1, 200) },
  fs: `uniform float u_a, u_r; void main(){ vec2 q=toL(v_uv*u_res); float r=length(q)/u_r; if(r>=1.){ gl_FragColor=T(v_uv); return; }
  float k=pow(max(r,1e-4), u_a*(u_a>0.?1.3:0.75)); gl_FragColor=Tp(fromL(q*k)); }`,
  u: p => ({ u_a: p.amt / 100, u_r: p.radius / 100 }) });

def('kaleido', { name: 'Kaleidoscope', cat: 'distort', desc: 'Mirrors a wedge of the layer around a centre into a kaleidoscope.',
  params: { seg: num('Segments', 6, 2, 48, { step: 1 }), rot: ang('Rotation', 0), center: vec2('Center', [0, 0]), offset: ang('Source Angle', 0) },
  fs: `uniform float u_seg, u_tr, u_off; uniform vec2 u_cen; void main(){ vec2 d=v_uv*u_res-u_cen; float r=length(d); float a=atan(d.y,d.x)-u_tr; float s=TAU/u_seg;
  a=mod(a,s); a=abs(a-s*0.5); a+=u_off; gl_FragColor=Tp(u_cen+vec2(cos(a),sin(a))*r); }`,
  u: (p, c) => ({ u_seg: Math.max(2, Math.round(p.seg)), u_tr: p.rot * D, u_off: p.offset * D, u_cen: pos(c, p.center) }) });

def('mirror', { name: 'Mirror', cat: 'distort', desc: 'Reflects one side of the layer onto the other across a line.',
  params: { angle: ang('Angle', 0), center: vec2('Reflection Center', [0, 0]), flip: bool('Flip Side', false) },
  fs: `uniform vec2 u_n, u_cen; uniform float u_fl; void main(){ vec2 P=v_uv*u_res; float d=dot(P-u_cen,u_n); if(u_fl>0.5) d=-d; vec2 S = d>0. ? P - 2.*dot(P-u_cen,u_n)*u_n : P; gl_FragColor=Tp(S); }`,
  u: (p, c) => { const d = dir(p.angle); return { u_n: d, u_cen: pos(c, p.center), u_fl: p.flip }; } });

def('ominoglass', { name: 'Omino Glass', cat: 'distort', desc: 'Views the layer through a wall of glass blocks, each one a small lens.',
  params: { size: px('Cell Size', 70, 4, 1000), ref: pct('Refraction', 45, -200, 200), shape: sel('Shape', 'square', [['square', 'Square'], ['hex', 'Hexagon']]), hi: pct('Highlight', 50, 0, 200), rot: ang('Rotation', 0) },
  fs: HEX + `uniform float u_sz, u_ref, u_hex, u_hi, u_ro; void main(){ vec2 P=v_uv*u_res; vec2 q=rot2(u_ro)*(P-u_c)/u_sz; vec2 gv, id; float ed;
  if(u_hex>0.5){ vec4 h=hexc(q); gv=h.xy; id=h.zw; ed=0.5-hexd(gv); } else { id=floor(q)+0.5; gv=q-id; ed=0.5-max(abs(gv.x),abs(gv.y)); }
  float r2=dot(gv,gv)*4.; vec2 sq=id+gv*(1.-u_ref*(1.-r2*0.6)); vec4 c=Tp(u_c+rot2(-u_ro)*sq*u_sz); float rim=(1.-smoothstep(0.,0.12,ed)); float sp=smoothstep(0.08,0.,abs(ed-0.06))*0.0;
  vec3 hl=vec3(rim*0.35+pow(max(0.,1.-length(gv-vec2(-0.18,0.2))*3.),3.)*0.6)*u_hi; c.rgb=min(c.rgb+hl*c.a, vec3(c.a)); gl_FragColor=c; }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_ref: p.ref / 100, u_hex: p.shape === 'hex', u_hi: p.hi / 100, u_ro: p.rot * D }) });

def('pinch', { name: 'Pinch/Bulge', cat: 'distort', desc: 'Pulls the layer toward a point or bulges it outward like a lens.',
  params: { amt: num('Amount', 50, -100, 100, { step: 0.1 }), radius: px('Radius', 320, 1, 4000), center: vec2('Center', [0, 0]) },
  fs: `uniform float u_a, u_r; uniform vec2 u_cen; void main(){ vec2 P=v_uv*u_res; vec2 d=P-u_cen; float r=length(d)/u_r; if(r>=1.){ gl_FragColor=T(v_uv); return; }
  float k=pow(max(r,1e-4), u_a*(u_a>0.?1.2:0.7)); gl_FragColor=Tp(u_cen+d*k); }`,
  u: (p, c) => ({ u_a: p.amt / 100, u_r: p.radius * c.s, u_cen: pos(c, p.center) }) });

def('pixelate', { name: 'Pixelate', cat: 'distort', desc: 'Turns the layer into big square pixels.',
  params: { size: px('Cell Size', 20, 1, 500, { step: 0.1 }) },
  fs: `uniform float u_sz; void main(){ vec2 P=v_uv*u_res; vec2 o=u_c+floor((P-u_c)/u_sz)*u_sz; vec4 a=Tp(o+u_sz*vec2(.25,.25))+Tp(o+u_sz*vec2(.75,.25))+Tp(o+u_sz*vec2(.25,.75))+Tp(o+u_sz*vec2(.75,.75)); gl_FragColor=a*0.25; }`,
  u: (p, c) => ({ u_sz: Math.max(1, p.size * c.s) }) });

def('polar', { name: 'Polar Coordinates', cat: 'distort', desc: 'Wraps the layer into a circle, or unwraps a circle into a strip.',
  params: { mode: sel('Type', 'r2p', [['r2p', 'Rect to Polar'], ['p2r', 'Polar to Rect']]), amt: pct('Interpolation', 100) },
  fs: `uniform float u_mode, u_amt; void main(){ vec2 q=toL(v_uv*u_res); vec2 s;
  if(u_mode<0.5){ float r=length(q)/1.; float a=atan(q.x,-q.y); s=vec2(a/PI, 1.-2.*r); } else { float a=q.x*PI; float r=(1.-q.y)*0.5; s=vec2(sin(a),-cos(a))*r; }
  vec2 m=mix(q,s,u_amt); gl_FragColor=(abs(m.x)>1.||abs(m.y)>1.)?vec4(0.):Tp(fromL(m)); }`, u: p => ({ u_mode: p.mode === 'p2r', u_amt: p.amt / 100 }) });

def('polardisp', { name: 'Polar Displacement Map', cat: 'distort', desc: 'Displaces the layer around a centre (in and out, and around) using a map.',
  params: { map: lay('Displacement Map'), center: vec2('Center', [0, 0]), rad: px('Radial', 40, -1000, 1000), angd: num('Angular', 12, -180, 180, { unit: '°', step: 0.1 }), soft: px('Map Softness', 4, 0, 100) },
  fs: `uniform sampler2D u_map; uniform vec2 u_cen; uniform float u_rd, u_ad; void main(){ vec2 P=v_uv*u_res; vec4 m=texture2D(u_map,v_uv); float v=(luma(unp(m))*m.a+(1.-m.a)*0.5)-0.5;
  vec2 d=P-u_cen; float r=length(d)-v*2.*u_rd; float a=atan(d.y,d.x)-v*2.*u_ad; gl_FragColor=Tp(u_cen+vec2(cos(a),sin(a))*max(r,0.)); }`,
  run(g, cur, p, c) { let m = g.layer(p.map) || cur; if (p.soft > 0) m = g.blur(m, p.soft * c.s); return g.pass('polardisp', { u_tex: cur, u_map: m }, { u_cen: pos(c, p.center), u_rd: p.rad * c.s, u_ad: p.angd * D }); } });

def('squeeze', { name: 'Squeeze', cat: 'distort', desc: 'Squeezes the middle of the layer into an hourglass, or swells it out.',
  params: { amt: num('Amount', 45, -100, 100, { step: 0.1 }), axis: sel('Direction', 'h', [['h', 'Horizontal'], ['v', 'Vertical']]) },
  fs: `uniform float u_a, u_v; void main(){ vec2 q=toL(v_uv*u_res); if(u_v>0.5) q=q.yx; float k=1.+u_a*(1.-q.y*q.y); q.x*=k; if(u_v>0.5) q=q.yx; gl_FragColor=Tp(fromL(q)); }`,
  u: p => ({ u_a: p.amt / 100, u_v: p.axis === 'v' }) });

def('stretchseg', { name: 'Stretch Segment', cat: 'distort', desc: 'Freezes a slice of the layer and stretches it out to the edge (pixel stretch).',
  params: { posn: px('Position', 0, -3000, 3000), angle: ang('Angle', 0), w: px('Segment Width', 0, 0, 2000), side: sel('Side', 'fwd', [['fwd', 'Forward'], ['both', 'Both Sides'], ['back', 'Backward']]) },
  fs: `uniform vec2 u_d; uniform float u_p, u_w, u_side; void main(){ vec2 P=v_uv*u_res; float x=dot(P-u_c,u_d); float x2=x;
  if(u_side<0.5){ if(x>u_p) x2=u_p+mod(x-u_p,max(u_w,0.001))*step(0.5,u_w); } else if(u_side<1.5){ if(x>u_p+u_w*0.5) x2=u_p+u_w*0.5; if(x<u_p-u_w*0.5) x2=u_p-u_w*0.5; } else { if(x<u_p) x2=u_p; }
  if(u_side<0.5 && x>u_p && u_w<0.5) x2=u_p; gl_FragColor=Tp(P+u_d*(x2-x)); }`,
  u: (p, c) => ({ u_d: dir(p.angle), u_p: p.posn * c.s, u_w: p.w * c.s, u_side: ['fwd', 'both', 'back'].indexOf(p.side) }) });

def('swirl', { name: 'Swirl', cat: 'distort', desc: 'Twists the layer around a centre point.',
  params: { angle: ang('Angle', 180), radius: px('Radius', 360, 1, 5000), center: vec2('Center', [0, 0]) },
  fs: `uniform float u_a, u_r; uniform vec2 u_cen; void main(){ vec2 d=v_uv*u_res-u_cen; float r=length(d)/u_r; float k=1.-smoothstep(0.,1.,r); gl_FragColor=Tp(u_cen+rot2(-u_a*k*k)*d); }`,
  u: (p, c) => ({ u_a: p.angle * D, u_r: p.radius * c.s, u_cen: pos(c, p.center) }) });

def('tilerot', { name: 'Tile Rotate', cat: 'distort', desc: 'Cuts the layer into square tiles and rotates the contents of each.',
  params: { size: px('Tile Size', 90, 4, 1000), rot: ang('Rotation', 90), alt: bool('Alternate', true), rnd: pct('Random', 0) },
  fs: `uniform float u_sz, u_tr, u_alt, u_rnd; void main(){ vec2 P=v_uv*u_res; vec2 q=(P-u_c)/u_sz; vec2 id=floor(q)+0.5; vec2 gv=q-id; float a=u_tr*mix(1.,h12(id*3.7)*2.-1.,u_rnd);
  if(u_alt>0.5 && mod(id.x-0.5+id.y-0.5,2.)>0.5) a=-a; gl_FragColor=Tp(u_c+(id+rot2(a)*gv)*u_sz); }`,
  u: (p, c) => ({ u_sz: p.size * c.s, u_tr: p.rot * D, u_alt: p.alt, u_rnd: p.rnd / 100 }) });

def('tileshift', { name: 'Tile Shift', cat: 'distort', desc: 'Cuts the layer into tiles and offsets them in rows, columns or at random.',
  params: { size: px('Tile Size', 70, 4, 1000), sx: px('Shift X', 30, -1000, 1000), sy: px('Shift Y', 0, -1000, 1000), mode: sel('Mode', 'rows', [['rows', 'Alternate Rows'], ['cols', 'Alternate Columns'], ['rnd', 'Random']]), seed: seed() },
  fs: `uniform float u_sz, u_mode, u_seed; uniform vec2 u_sh; void main(){ vec2 P=v_uv*u_res; vec2 q=(P-u_c)/u_sz; vec2 o;
  if(u_mode<0.5){ float r=floor(q.y); o=u_sh*(mod(r,2.)*2.-1.); } else if(u_mode<1.5){ float cc=floor(q.x); o=u_sh*(mod(cc,2.)*2.-1.); } else { o=u_sh*(h22(floor(q)+u_seed)*2.-1.); }
  gl_FragColor=Tp(P+o); }`, u: (p, c) => ({ u_sz: p.size * c.s, u_sh: [p.sx * c.s, -p.sy * c.s], u_mode: ['rows', 'cols', 'rnd'].indexOf(p.mode), u_seed: p.seed }) });

def('tiles', { name: 'Tiles', cat: 'distort', desc: 'Repeats the layer as tiles across the frame (motion tile).',
  params: { size: pct('Tile Size', 50, 2, 400), mirror: bool('Mirror Edges', true), offset: vec2('Offset', [0, 0], 1000, { unit: '%', step: 0.1 }), range: num('Output Range', 20, 1, 50, { step: 1 }), gap: pct('Gap', 0, 0, 100) },
  fs: `uniform float u_sz, u_mir, u_rng, u_gap; uniform vec2 u_off; void main(){ vec2 q=toL(v_uv*u_res); vec2 t=(q-u_off)/u_sz; vec2 cell=floor((t+1.)*0.5); if(max(abs(cell.x),abs(cell.y))>u_rng){ gl_FragColor=vec4(0.); return; }
  vec2 f=(t+1.)*0.5-cell; if(u_mir>0.5){ if(mod(cell.x,2.)>0.5) f.x=1.-f.x; if(mod(cell.y,2.)>0.5) f.y=1.-f.y; } vec2 g=(f-0.5)*(1.+u_gap)+0.5; if(g.x<0.||g.y<0.||g.x>1.||g.y>1.){ gl_FragColor=vec4(0.); return; }
  gl_FragColor=Tp(fromL(g*2.-1.)); }`, u: p => ({ u_sz: p.size / 100, u_mir: p.mirror, u_rng: p.range, u_gap: p.gap / 100, u_off: [p.offset[0] / 100, -p.offset[1] / 100] }) });

def('turbdisp', { name: 'Turbulent Displace', cat: 'distort', desc: 'Displaces the layer with turbulent noise; animate Evolution for flowing motion.',
  params: { amt: px('Amount', 36, 0, 800), size: px('Size', 120, 4, 3000), cx: num('Complexity', 3, 1, 8, { step: 1 }), type: sel('Displacement', 'turb', [['turb', 'Turbulent'], ['smooth', 'Smooth'], ['twist', 'Twist'], ['bulge', 'Bulge']]), evo: evo(), spd: num('Speed', 0.5, 0, 20, { step: 0.01 }) },
  fs: `uniform float u_a, u_sz, u_cx, u_ty, u_ev; void main(){ vec2 P=v_uv*u_res; vec3 q=vec3(P/u_sz,u_ev); vec2 o;
  if(u_ty<0.5){ o=vec2(turb(q,u_cx),turb(q+vec3(3.1,7.7,0.),u_cx))*2.-0.6; } else if(u_ty<1.5){ o=vec2(fbm(q,u_cx),fbm(q+vec3(3.1,7.7,0.),u_cx))*2.-1.; }
  else if(u_ty<2.5){ float a=(fbm(q,u_cx)-0.5)*TAU*1.5; vec2 d=P-u_c; o=(rot2(a)*d-d)/max(u_a,1.)*0.5; } else { float n=fbm(q,u_cx)-0.5; o=normalize(P-u_c+1e-3)*n*2.; }
  gl_FragColor=Tp(P+o*u_a); }`, u: (p, c) => ({ u_a: p.amt * c.s, u_sz: p.size * c.s, u_cx: p.cx, u_ty: ['turb', 'smooth', 'twist', 'bulge'].indexOf(p.type), u_ev: p.evo * 0.1 + c.lt * p.spd }) });

def('wavewarp', { name: 'Wave Warp', cat: 'distort', desc: 'Ripples the layer with a travelling wave.',
  params: { type: sel('Wave Type', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Sawtooth'], ['smooth', 'Smooth Noise']]), h: px('Wave Height', 22, 0, 600, { step: 0.1 }),
    w: px('Wave Width', 160, 2, 4000), angle: ang('Direction', 90), spd: num('Wave Speed', 1, -20, 20, { unit: 'Hz', step: 0.01 }), phase: ang('Phase', 0) },
  fs: `uniform float u_ty, u_h, u_w, u_ph; uniform vec2 u_d; float wv(float x){ float f=fract(x); if(u_ty<0.5) return sin(x*TAU); if(u_ty<1.5) return 1.-4.*abs(f-0.5); if(u_ty<2.5) return smoothstep(0.45,0.55,f)*2.-1.-(smoothstep(0.95,1.,f)*2.); if(u_ty<3.5) return 2.*f-1.; return (n3(vec3(x*2.,0.,1.7))-0.5)*2.6; }
  void main(){ vec2 P=v_uv*u_res; vec2 n=vec2(-u_d.y,u_d.x); float x=dot(P-u_c,n); float d=wv(x/u_w-u_ph)*u_h; gl_FragColor=Tp(P-u_d*d); }`,
  u: (p, c) => ({ u_ty: ['sine', 'triangle', 'square', 'sawtooth', 'smooth'].indexOf(p.type), u_h: p.h * c.s, u_w: p.w * c.s, u_ph: p.phase / 360 + c.lt * p.spd, u_d: dir(p.angle) }) });
