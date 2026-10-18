// KINETIC effects core: registry, parameter specs, keyframe-aware evaluation and the WebGL multi-pass engine.
// Every shader in js/fx/ is original code written for KINETIC.

export const CATS = [
  ['color', 'Color & Light'], ['draw', 'Drawing & Edge'], ['blur', 'Blur'], ['distort', 'Distortion/Warp'], ['proc', 'Procedural'],
  ['3d', '3D'], ['move', 'Move/Transform'], ['repeat', 'Repeat'], ['matte', 'Matte/Mask/Key'], ['opacity', 'Opacity/Visibility'],
  ['text', 'Text'], ['other', 'Other'],
];
export const CAT_NAME = Object.fromEntries(CATS);
export const EFFECTS = {};
export const SHADERS = {};
const CAT_TAGS = { color: ['Color', 'Light'], draw: ['Stylize', 'Edge'], blur: ['Blur'], distort: ['Distort', 'Warp'], proc: ['Generate', 'Pattern'],
  '3d': ['3D', 'Lighting', 'Raster', 'Shape'], move: ['Auto', 'Transform', 'Property Adjust'], repeat: ['Repeat', 'Transform'], matte: ['Key', 'Mask'],
  opacity: ['Opacity', 'Transition'], text: ['Text', 'Auto'], other: ['Utility'] };

// def(id, {name, cat, desc, params, fs | run | xf | text | ...})
export function def(id, d) {
  const e = { id, tags: d.tags || CAT_TAGS[d.cat] || [], params: {}, ...d };
  if (d.fs) SHADERS[id] = d.fs;
  EFFECTS[id] = e;
  return e;
}
export function shader(name, src) { SHADERS[name] = src; }

// ---- parameter specs ----
// t: num | color | bool | select | vec2 | vec3 | layer.  unit: '' | px | % | ° | Hz | s | x
function niceStep(range) { const r = range / 200; const p = Math.pow(10, Math.floor(Math.log10(r || 1))); const m = r / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p; }
export const num = (label, d, min, max, o = {}) => ({ t: 'num', label, def: d, min, max, step: o.step ?? niceStep(max - min), unit: o.unit || '', ...o });
export const px = (label, d, min, max, o = {}) => num(label, d, min, max, { unit: 'px', ...o });
export const pct = (label, d, min = 0, max = 100, o = {}) => num(label, d, min, max, { unit: '%', step: 0.1, ...o });
export const ang = (label, d = 0, o = {}) => num(label, d, -720, 720, { unit: '°', step: 0.1, ...o });
export const hz = (label, d = 1, max = 30) => num(label, d, 0, max, { unit: 'Hz', step: 0.01 });
export const sec = (label, d = 1, max = 30) => num(label, d, 0, max, { unit: 's', step: 0.01 });
export const col = (label, d) => ({ t: 'color', label, def: d });
export const bool = (label, d) => ({ t: 'bool', label, def: !!d });
export const sel = (label, d, opts) => ({ t: 'select', label, def: d, opts: opts.map(o => (Array.isArray(o) ? o : [o, o])) });
export const vec2 = (label, d = [0, 0], range = 2000, o = {}) => ({ t: 'vec2', label, def: d, min: -range, max: range, step: o.step ?? 1, unit: o.unit ?? 'px', ...o });
export const vec3 = (label, d = [0, 0, 0], o = {}) => ({ t: 'vec3', label, def: d, min: -720, max: 720, step: 0.1, unit: '°', ...o });
export const lay = (label = 'Source Layer') => ({ t: 'layer', label, def: '' });
export const evo = (label = 'Evolution') => num(label, 0, -1000, 1000, { step: 0.1 });
export const seed = (label = 'Seed') => num(label, 0, 0, 1000, { step: 1 });

export const hex3 = h => { const n = parseInt(String(h || '#000000').slice(1, 7), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const uid = () => Math.random().toString(36).slice(2, 9);

export function defaults(type) {
  const d = EFFECTS[type], o = {};
  for (const [k, p] of Object.entries(d.params)) o[k] = Array.isArray(p.def) ? p.def.slice() : p.def;
  return o;
}
export function makeEffect(type, over = {}) {
  if (!EFFECTS[type]) throw new Error('unknown effect ' + type);
  return { id: uid(), type, on: true, open: true, params: { ...defaults(type), ...over } };
}
export const fxKey = (fx, k) => `fx.${fx.id}.${k}`;

// smooth 1D noise for transform effects (same values in preview + export)
function hash1(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); }
export function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10); return (hash1(i) * (1 - u) + hash1(i + 1) * u) * 2 - 1; }
export const rand1 = hash1;
export function fbm1(x, oct = 3) { let s = 0, a = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * noise1(x + i * 19.19); n += a; x *= 2.02; a *= 0.5; } return s / n; }
export function wave(type, ph) { // ph in cycles
  const f = ph - Math.floor(ph);
  switch (type) { case 'triangle': return 1 - 4 * Math.abs(f - 0.5); case 'square': return f < 0.5 ? 1 : -1; case 'sawtooth': return 2 * f - 1; default: return Math.sin(ph * Math.PI * 2); }
}

// ---------------- GLSL ----------------
const VERT = 'attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.,1.); }';
export const HEAD = `precision highp float;
varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time, u_lt, u_s; uniform vec2 u_c, u_hs; uniform float u_rot;
#define PI 3.14159265359
#define TAU 6.28318530718
vec4 T(vec2 uv){ return texture2D(u_tex, uv); }
vec4 Tc(vec2 uv){ return (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? vec4(0.) : texture2D(u_tex, uv); }
vec4 Tp(vec2 p){ return Tc(p/u_res); }
vec3 unp(vec4 c){ return c.a>0.0001 ? clamp(c.rgb/c.a,0.,1.) : vec3(0.); }
vec4 pm(vec3 c, float a){ return vec4(clamp(c,0.,1.)*a, a); }
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
mat2 rot2(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
vec2 toL(vec2 P){ vec2 d=P-u_c; float c=cos(u_rot), s=sin(u_rot); return vec2(c*d.x+s*d.y, -s*d.x+c*d.y)/u_hs; }
vec2 fromL(vec2 q){ q*=u_hs; float c=cos(u_rot), s=sin(u_rot); return u_c+vec2(c*q.x-s*q.y, s*q.x+c*q.y); }
float h11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float h13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec3 h33(vec3 p3){ p3=fract(p3*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
float gn3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*f*(f*(f*6.-15.)+10.);
  float a=dot(h33(i)*2.-1.,f), b=dot(h33(i+vec3(1,0,0))*2.-1.,f-vec3(1,0,0)), c=dot(h33(i+vec3(0,1,0))*2.-1.,f-vec3(0,1,0)), d=dot(h33(i+vec3(1,1,0))*2.-1.,f-vec3(1,1,0));
  float e=dot(h33(i+vec3(0,0,1))*2.-1.,f-vec3(0,0,1)), g=dot(h33(i+vec3(1,0,1))*2.-1.,f-vec3(1,0,1)), h=dot(h33(i+vec3(0,1,1))*2.-1.,f-vec3(0,1,1)), k=dot(h33(i+vec3(1,1,1))*2.-1.,f-vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z); }
float n3(vec3 p){ return clamp(gn3(p)*0.9+0.5,0.,1.); }
float fbm(vec3 p, float oct){ float s=0., a=.5, n=0.; for(int i=0;i<8;i++){ if(float(i)>=oct) break; s+=a*gn3(p); n+=a; p=p*2.03+vec3(17.1,9.2,3.7); a*=.5; } return clamp(s/n*0.95+0.5,0.,1.); }
float ridge(vec3 p, float oct){ float s=0., a=.5, n=0., w=1.; for(int i=0;i<8;i++){ if(float(i)>=oct) break; float r=1.-abs(gn3(p)*1.6); r*=r*w; w=clamp(r*1.5,0.,1.); s+=a*r; n+=a; p=p*2.07+vec3(5.3,1.7,8.1); a*=.5; } return s/n; }
float turb(vec3 p, float oct){ float s=0., a=.5, n=0.; for(int i=0;i<8;i++){ if(float(i)>=oct) break; s+=a*abs(gn3(p)*1.6); n+=a; p=p*2.01+vec3(3.1,7.7,1.3); a*=.5; } return clamp(s/n,0.,1.); }
vec3 vor(vec2 p, float jit, float t){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.; vec2 id=vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=h22(i+g); o=0.5+0.5*sin(t+TAU*o); vec2 r=g+mix(vec2(.5),o,jit)-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=i+g; } else if(d<d2) d2=d; }
  return vec3(sqrt(d1), sqrt(d2), h12(id)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
vec3 hueRot(vec3 c, float a){ const vec3 k=vec3(0.57735); float co=cos(a); return c*co+cross(k,c)*sin(a)+k*dot(k,c)*(1.-co); }
vec3 toLin(vec3 c){ return pow(max(c,0.),vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c,0.),vec3(1./2.2)); }
vec4 over(vec4 top, vec4 bot){ return top + bot*(1.-top.a); }
float aa(float d){ return clamp(0.5-d,0.,1.); } // d in px: signed distance -> coverage
vec3 clipC(vec3 c){ float l=luma(c), n=min(c.r,min(c.g,c.b)), x=max(c.r,max(c.g,c.b)); if(n<0.) c=l+(c-l)*l/(l-n+1e-5); if(x>1.) c=l+(c-l)*(1.-l)/(x-l+1e-5); return c; }
vec3 setLum(vec3 c, float l){ return clipC(c + (l - luma(c))); }
vec3 blendm(vec3 b, vec3 s, float m){
  if(m<0.5) return s; if(m<1.5) return b*s; if(m<2.5) return 1.-(1.-b)*(1.-s);
  if(m<3.5) return mix(2.*b*s, 1.-2.*(1.-b)*(1.-s), step(0.5,b));
  if(m<4.5) return mix(b-(1.-2.*s)*b*(1.-b), b+(2.*s-1.)*(sqrt(max(b,0.))-b), step(0.5,s));
  if(m<5.5) return min(b+s,1.); return setLum(s, luma(b)); }
vec4 addGlow(vec4 base, vec3 g){ vec4 o = vec4(base.rgb + g, base.a); o.a = clamp(max(o.a, max(o.r,max(o.g,o.b))),0.,1.); o.rgb = min(o.rgb, vec3(o.a)); return o; }
`;
export const BLENDS = [[0, 'Normal'], [1, 'Multiply'], [2, 'Screen'], [3, 'Overlay'], [4, 'Soft Light'], [5, 'Add'], [6, 'Color']];

// ---------------- engine ----------------
let ctxCount = 0;
export class FXEngine {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false, depth: false, stencil: false });
    this.gl = gl; this.ok = !!gl; this.progs = {}; this.pool = []; this.errors = [];
    if (!gl) return;
    ctxCount++;
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.srcTex = this._tex(); this.bdTex = this._tex(); this.layTex = {};
    this.w = this.h = 0;
  }
  _tex() {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  rt(w = this.w, h = this.h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const i = this.pool.findIndex(r => r.w === w && r.h === h);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl, tex = this._tex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  free(r) {
    if (!r || !r.fbo || this.pool.includes(r)) return;
    this.pool.push(r);
    if (this.pool.length > 14) { const o = this.pool.shift(); this.gl.deleteTexture(o.tex); this.gl.deleteFramebuffer(o.fbo); }
  }
  prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, src = SHADERS[name];
    if (!src) throw new Error('no shader ' + name);
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('shader ' + name + ': ' + gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + src));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
    const loc = {}; const u = n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n)));
    return (this.progs[name] = { p, u });
  }
  // draw shader `name` into target rt (null = canvas) with inputs {uniformName: rt|texture}
  draw(name, inputs, target, uni = {}) {
    const gl = this.gl, pr = this.prog(name);
    gl.useProgram(pr.p);
    const tw = target ? target.w : this.w, th = target ? target.h : this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, tw, th);
    let unit = 0;
    for (const [k, v] of Object.entries(inputs)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex || v); gl.uniform1i(pr.u(k), unit);
      if (v.w) { const l = pr.u(k + '_res'); if (l) gl.uniform2f(l, v.w, v.h); }
      unit++;
    }
    gl.activeTexture(gl.TEXTURE0);
    const c = this.c;
    gl.uniform2f(pr.u('u_res'), tw, th); gl.uniform1f(pr.u('u_time'), c.t); gl.uniform1f(pr.u('u_lt'), c.lt); gl.uniform1f(pr.u('u_s'), c.s * (tw / this.w));
    const k = tw / this.w;
    gl.uniform2f(pr.u('u_c'), c.cx * k, c.cy * k); gl.uniform2f(pr.u('u_hs'), c.hw * k, c.hh * k); gl.uniform1f(pr.u('u_rot'), c.rot);
    for (const [n, v] of Object.entries(uni)) {
      const l = pr.u(n); if (!l) continue;
      if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
      else if (v.f3) gl.uniform3fv(l, v.f3); else if (v.f2) gl.uniform2fv(l, v.f2); else if (v.f4) gl.uniform4fv(l, v.f4); else if (v.f1) gl.uniform1fv(l, v.f1);
      else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  upload(tex, src) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
  // items: [{ def, p, fx }]; c: context (t, lt, s, cx, cy, hw, hh, rot in GL px); hooks: { backdrop: canvas, layer: id => canvas }
  apply(src, items, c, hooks = {}) {
    const gl = this.gl;
    if (src.width !== this.w || src.height !== this.h) { this.w = this.canvas.width = src.width; this.h = this.canvas.height = src.height; for (const r of this.pool.splice(0)) { gl.deleteTexture(r.tex); gl.deleteFramebuffer(r.fbo); } }
    this.c = c;
    this.upload(this.srcTex, src);
    const srcR = { tex: this.srcTex, w: this.w, h: this.h, fixed: true };
    let cur = srcR, bd = null; const layUp = {};
    for (const it of items) {
      const live = [];
      const g = {
        W: this.w, H: this.h, src: srcR, c, eng: this,
        rt: (w, h) => { const r = this.rt(w, h); live.push(r); return r; },
        pass: (name, inputs, uni, w, h) => { const r = g.rt(w, h); this.draw(name, inputs, r, uni); return r; },
        run: (name, uni, inp = cur) => g.pass(name, { u_tex: inp }, uni),
        backdrop: () => { if (!bd) { if (!hooks.backdrop) return { tex: this.srcTex, w: this.w, h: this.h, fixed: true }; this.upload(this.bdTex, hooks.backdrop); bd = { tex: this.bdTex, w: this.w, h: this.h, fixed: true }; } return bd; },
        layer: id => { if (!id || !hooks.layer) return null; if (layUp[id]) return layUp[id]; const cv = hooks.layer(id); if (!cv) return null;
          const t = this.layTex[id] || (this.layTex[id] = this._tex()); this.upload(t, cv); return (layUp[id] = { tex: t, w: this.w, h: this.h, fixed: true }); },
        blur: (inp, r, o) => blurRT(this, g, inp, r, o),
      };
      let out;
      try {
        out = it.def.run ? it.def.run(g, cur, it.p, c) : g.run(it.def.id, it.def.u ? it.def.u(it.p, c, g) : {});
      } catch (e) { if (this.errors.length < 20) this.errors.push(String(e)); console.error(e); out = cur; }
      for (const r of live) if (r !== out) this.free(r);
      if (out !== cur && !cur.fixed) this.free(cur);
      cur = out || cur;
    }
    this.draw('copy', { u_tex: cur }, null, {});
    if (!cur.fixed) this.free(cur);
    return this.canvas;
  }
}

// separable gaussian with a downsample pyramid for big radii (constant cost, no undersampling)
function blurRT(eng, g, inp, r, { dir = null, w = eng.w, h = eng.h } = {}) {
  if (!(r > 0.3)) return inp;
  let ds = 1; while (r / ds > 20 && ds < 32) ds *= 2;
  let cur = inp, cw = w, ch = h;
  for (let k = 1; k < ds; k *= 2) { cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2)); cur = g.pass('down2', { u_tex: cur }, {}, cw, ch); }
  const rr = r / ds;
  if (!dir || dir[0]) cur = g.pass('gauss', { u_tex: cur }, { u_d: [1, 0], u_r: rr * (dir ? Math.abs(dir[0]) : 1) }, cw, ch);
  if (!dir || dir[1]) cur = g.pass('gauss', { u_tex: cur }, { u_d: [0, 1], u_r: rr * (dir ? Math.abs(dir[1]) : 1) }, cw, ch);
  if (ds > 1) cur = g.pass('up', { u_tex: cur }, {}, w, h);
  return cur;
}
shader('copy', 'void main(){ gl_FragColor = texture2D(u_tex, v_uv); }');
shader('down2', 'uniform vec2 u_tex_res; void main(){ vec2 o = 0.75/u_tex_res; gl_FragColor = 0.25*(T(v_uv+vec2(-o.x,-o.y))+T(v_uv+vec2(o.x,-o.y))+T(v_uv+vec2(-o.x,o.y))+T(v_uv+vec2(o.x,o.y))); }');
// 9-tap tent upsample
shader('up', 'uniform vec2 u_tex_res; void main(){ vec2 o = 0.5/u_tex_res; vec4 s = T(v_uv)*4.; s += (T(v_uv+vec2(o.x,0.))+T(v_uv-vec2(o.x,0.))+T(v_uv+vec2(0.,o.y))+T(v_uv-vec2(0.,o.y)))*2.; s += T(v_uv+o)+T(v_uv-o)+T(v_uv+vec2(o.x,-o.y))+T(v_uv+vec2(-o.x,o.y)); gl_FragColor = s/16.; }');
shader('gauss', `uniform vec2 u_d; uniform float u_r;
void main(){ float sig = max(u_r/2.6, 0.35); float st = max(1., u_r/24.); vec4 acc = T(v_uv); float ws = 1.;
  for (int i = 1; i <= 24; i++) { float x = float(i)*st; if (x > u_r*1.05+0.5) break; float w = exp(-x*x/(2.*sig*sig));
    vec2 o = u_d*x/u_res; acc += (T(v_uv+o)+T(v_uv-o))*w; ws += 2.*w; }
  gl_FragColor = acc/ws; }`);
