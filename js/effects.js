// Effect catalogue + WebGL multi-pass processor. All shaders are original.
export const EFFECTS = {
  blur:      { name: 'Gaussian Blur', cat: 'Blur',   params: { radius: [0, 120, 14, 'Radius'] } },
  dirblur:   { name: 'Motion Blur',   cat: 'Blur',   params: { radius: [0, 160, 24, 'Length'], angle: [0, 360, 0, 'Angle'] } },
  zoomblur:  { name: 'Zoom Blur',     cat: 'Blur',   params: { amount: [0, 1, 0.25, 'Amount'], cx: [0, 1, 0.5, 'Center X'], cy: [0, 1, 0.5, 'Center Y'] } },
  glow:      { name: 'Neon Glow',     cat: 'Light',  params: { radius: [0, 120, 26, 'Radius'], intensity: [0, 4, 1.6, 'Intensity'], tint: ['color', '#00f0ff', 'Tint'], tintMix: [0, 1, 0.4, 'Tint Mix'] } },
  coloradj:  { name: 'Color Adjust',  cat: 'Color',  params: { brightness: [-1, 1, 0, 'Brightness'], contrast: [-1, 1, 0, 'Contrast'], saturation: [-1, 1, 0, 'Saturation'], hue: [-180, 180, 0, 'Hue'], hueSpeed: [-360, 360, 0, 'Hue °/s'] } },
  duotone:   { name: 'Duotone',       cat: 'Color',  params: { a: ['color', '#1a0033', 'Shadows'], b: ['color', '#00f0ff', 'Highlights'], mix: [0, 1, 1, 'Mix'] } },
  invert:    { name: 'Invert',        cat: 'Color',  params: { mix: [0, 1, 1, 'Mix'] } },
  posterize: { name: 'Posterize',     cat: 'Color',  params: { levels: [2, 16, 4, 'Levels'] } },
  rgbsplit:  { name: 'Chromatic Split', cat: 'Stylize', params: { amount: [0, 80, 10, 'Amount'], angle: [0, 360, 0, 'Angle'], pulse: [0, 10, 0, 'Pulse Hz'] } },
  glitch:    { name: 'Glitch',        cat: 'Stylize', params: { amount: [0, 1, 0.5, 'Amount'], blocks: [2, 60, 18, 'Bands'], speed: [0, 30, 8, 'Speed'] } },
  pixelate:  { name: 'Pixelate',      cat: 'Stylize', params: { size: [1, 120, 16, 'Cell'] } },
  scanlines: { name: 'CRT Scanlines', cat: 'Stylize', params: { density: [50, 1200, 420, 'Lines'], intensity: [0, 1, 0.45, 'Intensity'], speed: [-20, 20, 2, 'Roll'] } },
  noise:     { name: 'Grain',         cat: 'Stylize', params: { amount: [0, 1, 0.25, 'Amount'], mono: ['bool', true, 'Mono'] } },
  vignette:  { name: 'Vignette',      cat: 'Stylize', params: { amount: [0, 1.5, 0.6, 'Amount'], softness: [0.05, 1, 0.5, 'Softness'] } },
  wave:      { name: 'Wave Warp',     cat: 'Distort', params: { amp: [0, 200, 24, 'Amplitude'], length: [10, 1200, 220, 'Wavelength'], speed: [-10, 10, 1.5, 'Speed'], vertical: ['bool', false, 'Vertical'] } },
  swirl:     { name: 'Swirl',         cat: 'Distort', params: { angle: [-1080, 1080, 180, 'Angle'], radius: [0.05, 1.5, 0.5, 'Radius'] } },
  kaleido:   { name: 'Kaleidoscope',  cat: 'Distort', params: { segments: [2, 24, 6, 'Segments'], rotate: [0, 360, 0, 'Rotate'] } },
  mirror:    { name: 'Mirror',        cat: 'Distort', params: { mode: ['select', 'horizontal', 'Mode', ['horizontal', 'vertical', 'quad']] } },
  shake:     { name: 'Shake',         cat: 'Motion', transform: true, params: { mag: [0, 300, 30, 'Magnitude'], freq: [0, 30, 8, 'Frequency'], rot: [0, 45, 3, 'Rotation'], seed: [0, 100, 1, 'Seed'] } },
  pulse:     { name: 'Pulse Scale',   cat: 'Motion', transform: true, params: { amount: [0, 1, 0.15, 'Amount'], freq: [0, 10, 2, 'Hz'] } },
  spin:      { name: 'Auto Spin',     cat: 'Motion', transform: true, params: { speed: [-720, 720, 90, '°/s'] } },
};

export function makeEffect(type) {
  const def = EFFECTS[type];
  const params = {};
  for (const [k, v] of Object.entries(def.params)) params[k] = (v[0] === 'color' || v[0] === 'bool' || v[0] === 'select') ? v[1] : v[2];
  return { id: Math.random().toString(36).slice(2, 9), type, on: true, params };
}

// smooth value noise
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
}

// transform effects modify the evaluated transform
export function applyTransformEffects(L, tr, t) {
  for (const fx of L.effects) {
    if (!fx.on || !EFFECTS[fx.type]?.transform) continue;
    const p = fx.params;
    if (fx.type === 'shake') {
      const s = p.seed * 13.37, f = p.freq;
      tr.x += noise1(t * f + s) * p.mag;
      tr.y += noise1(t * f + s + 71.3) * p.mag;
      tr.rotation += noise1(t * f + s + 19.1) * p.rot;
    } else if (fx.type === 'pulse') {
      tr.scale *= 1 + Math.sin(t * p.freq * Math.PI * 2) * p.amount;
    } else if (fx.type === 'spin') {
      tr.rotation += t * p.speed;
    }
  }
  return tr;
}

const VERT = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`;
const HEAD = `precision highp float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time;
vec4 unpm(vec4 c){ return c.a>0.0001 ? vec4(c.rgb/c.a,c.a) : vec4(0.); }
vec4 pm(vec4 c){ return vec4(c.rgb*c.a,c.a); }
float rnd(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
`;
const FRAG = {
  copy: `void main(){ gl_FragColor = texture2D(u_tex,v_uv); }`,
  blur: `uniform vec2 u_dir; uniform float u_r;
    void main(){ vec4 acc=vec4(0.); float wsum=0.; float sigma=max(u_r/2.5,0.001);
      for(int i=-24;i<=24;i++){ float x=float(i)*u_r/24.0; float w=exp(-x*x/(2.*sigma*sigma));
        acc+=texture2D(u_tex, v_uv + u_dir*x/u_res)*w; wsum+=w; }
      gl_FragColor = acc/wsum; }`,
  zoomblur: `uniform float u_amt; uniform vec2 u_c;
    void main(){ vec4 acc=vec4(0.); vec2 d = v_uv-u_c;
      for(int i=0;i<32;i++){ float s = 1.0 - u_amt*float(i)/32.0; acc += texture2D(u_tex, u_c + d*s); }
      gl_FragColor = acc/32.0; }`,
  glowmix: `uniform sampler2D u_base; uniform float u_int; uniform vec3 u_tint; uniform float u_tmix;
    void main(){ vec4 g = texture2D(u_tex,v_uv); vec4 b = texture2D(u_base,v_uv);
      vec3 gc = mix(g.rgb, u_tint*g.a, u_tmix) * u_int; vec4 o = vec4(b.rgb + gc*(1.0-b.a*0.5), max(b.a, min(1.0,g.a*u_int)));
      gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a); }`,
  coloradj: `uniform float u_b,u_c,u_s,u_h;
    vec3 hueRot(vec3 c,float a){ float s=sin(a), co=cos(a); mat3 m = mat3(
      0.299+0.701*co+0.168*s, 0.587-0.587*co+0.330*s, 0.114-0.114*co-0.497*s,
      0.299-0.299*co-0.328*s, 0.587+0.413*co+0.035*s, 0.114-0.114*co+0.292*s,
      0.299-0.300*co+1.250*s, 0.587-0.588*co-1.050*s, 0.114+0.886*co-0.203*s); return c*m; }
    void main(){ vec4 c = unpm(texture2D(u_tex,v_uv)); vec3 r = c.rgb + u_b;
      r = (r-0.5)*(1.0+u_c*(u_c>0.?3.:1.))+0.5; float l = dot(r,vec3(0.299,0.587,0.114)); r = mix(vec3(l), r, 1.0+u_s);
      r = hueRot(r, u_h); gl_FragColor = pm(vec4(clamp(r,0.,1.),c.a)); }`,
  duotone: `uniform vec3 u_a,u_bb; uniform float u_mix;
    void main(){ vec4 c=unpm(texture2D(u_tex,v_uv)); float l=dot(c.rgb,vec3(0.299,0.587,0.114));
      gl_FragColor = pm(vec4(mix(c.rgb, mix(u_a,u_bb,l), u_mix), c.a)); }`,
  invert: `uniform float u_mix; void main(){ vec4 c=unpm(texture2D(u_tex,v_uv)); gl_FragColor = pm(vec4(mix(c.rgb,1.0-c.rgb,u_mix),c.a)); }`,
  posterize: `uniform float u_lv; void main(){ vec4 c=unpm(texture2D(u_tex,v_uv)); gl_FragColor = pm(vec4(floor(c.rgb*u_lv+0.5)/u_lv,c.a)); }`,
  rgbsplit: `uniform vec2 u_off;
    void main(){ vec2 o=u_off/u_res; vec4 r=texture2D(u_tex,v_uv+o), g=texture2D(u_tex,v_uv), b=texture2D(u_tex,v_uv-o);
      float a = max(max(r.a,g.a),b.a); gl_FragColor = vec4(r.r, g.g, b.b, a); }`,
  glitch: `uniform float u_amt,u_bands,u_spd;
    void main(){ float tt = floor(u_time*u_spd); float band = floor(v_uv.y*u_bands);
      float n = rnd(vec2(band, tt)); float on = step(1.0-u_amt*0.6, n);
      float sh = (rnd(vec2(band*3.1, tt+1.7))-0.5)*0.25*u_amt*on;
      vec2 uv = vec2(v_uv.x+sh, v_uv.y); float ca = 0.012*u_amt*(on+0.2);
      vec4 r=texture2D(u_tex,uv+vec2(ca,0.)), g=texture2D(u_tex,uv), b=texture2D(u_tex,uv-vec2(ca,0.));
      gl_FragColor = vec4(r.r,g.g,b.b,max(max(r.a,g.a),b.a)); }`,
  pixelate: `uniform float u_sz; void main(){ vec2 cell = u_sz/u_res; vec2 uv = (floor(v_uv/cell)+0.5)*cell; gl_FragColor = texture2D(u_tex,uv); }`,
  scanlines: `uniform float u_den,u_int,u_spd;
    void main(){ vec4 c=texture2D(u_tex,v_uv); float s = 0.5+0.5*sin((v_uv.y + u_time*u_spd*0.01)*u_den*3.14159);
      gl_FragColor = vec4(c.rgb*(1.0-u_int*s), c.a); }`,
  noise: `uniform float u_amt,u_mono;
    void main(){ vec4 c=unpm(texture2D(u_tex,v_uv)); vec2 p = v_uv*u_res + fract(u_time*7.13)*100.;
      vec3 n = u_mono>0.5 ? vec3(rnd(p)) : vec3(rnd(p),rnd(p+3.1),rnd(p+7.7));
      gl_FragColor = pm(vec4(clamp(c.rgb + (n-0.5)*u_amt,0.,1.), c.a)); }`,
  vignette: `uniform float u_amt,u_soft;
    void main(){ vec4 c=texture2D(u_tex,v_uv); vec2 d = v_uv-0.5; d.x *= u_res.x/u_res.y; float r = length(d)/0.75;
      float v = clamp(smoothstep(1.0-u_soft, 1.0+u_soft*0.5, r)*u_amt,0.,1.); gl_FragColor = vec4(c.rgb*(1.0-v), c.a); }`,
  wave: `uniform float u_amp,u_len,u_spd,u_vert;
    void main(){ vec2 px = v_uv*u_res; vec2 uv=v_uv;
      if(u_vert>0.5){ uv.y += sin((px.x/u_len + u_time*u_spd)*6.28318)*u_amp/u_res.y; }
      else { uv.x += sin((px.y/u_len + u_time*u_spd)*6.28318)*u_amp/u_res.x; }
      gl_FragColor = texture2D(u_tex,uv); }`,
  swirl: `uniform float u_ang,u_rad;
    void main(){ vec2 asp = vec2(u_res.x/u_res.y,1.); vec2 d=(v_uv-0.5)*asp; float r=length(d); float R=u_rad;
      float k = max(0.,1.-r/R); float a = u_ang*k*k; float s=sin(a), c=cos(a);
      d = mat2(c,-s,s,c)*d; gl_FragColor = texture2D(u_tex, d/asp+0.5); }`,
  kaleido: `uniform float u_seg,u_rot;
    void main(){ vec2 asp=vec2(u_res.x/u_res.y,1.); vec2 d=(v_uv-0.5)*asp; float r=length(d); float a=atan(d.y,d.x)+u_rot;
      float seg = 6.28318/u_seg; a = mod(a,seg); a = abs(a-seg*0.5); vec2 p = vec2(cos(a),sin(a))*r;
      gl_FragColor = texture2D(u_tex, p/asp+0.5); }`,
  mirror: `uniform float u_mode;
    void main(){ vec2 uv=v_uv; if(u_mode<0.5||u_mode>1.5) uv.x = uv.x>0.5 ? 1.0-uv.x : uv.x; if(u_mode>0.5) uv.y = uv.y>0.5 ? 1.0-uv.y : uv.y;
      gl_FragColor = texture2D(u_tex,uv); }`,
};

const hex3 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export class FX {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
    this.gl = gl; this.progs = {}; this.ok = !!gl;
    if (!gl) return;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tex = {}; this.fbo = {};
    for (const n of ['src', 'a', 'b', 'base']) this.tex[n] = this._tex();
    for (const n of ['a', 'b', 'base']) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); this.fbo[n] = f; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.w = 0; this.h = 0;
  }
  _tex() {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl; this.w = w; this.h = h; this.canvas.width = w; this.canvas.height = h;
    for (const n of ['a', 'b', 'base']) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[n]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[n]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex[n], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  _prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + FRAG[name]));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
    const loc = {}; const cache = n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n)));
    return (this.progs[name] = { p, u: cache });
  }
  _pass(name, inTex, outName, uni = {}, extraTex) {
    const gl = this.gl, pr = this._prog(name);
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outName ? this.fbo[outName] : null);
    gl.viewport(0, 0, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inTex); gl.uniform1i(pr.u('u_tex'), 0);
    if (extraTex) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, extraTex.tex); gl.uniform1i(pr.u(extraTex.name), 1); gl.activeTexture(gl.TEXTURE0); }
    gl.uniform2f(pr.u('u_res'), this.w, this.h); gl.uniform1f(pr.u('u_time'), this.time);
    for (const [k, v] of Object.entries(uni)) {
      const l = pr.u(k); if (!l) continue;
      if (Array.isArray(v)) (v.length === 2 ? gl.uniform2fv : gl.uniform3fv).call(gl, l, v); else gl.uniform1f(l, v);
    }
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  hasShaderFx(effects) { return effects.some(f => f.on && EFFECTS[f.type] && !EFFECTS[f.type].transform); }

  // Applies shader effects to src canvas; returns this.canvas holding the result.
  apply(src, effects, t, scale) {
    const gl = this.gl; this.time = t;
    this._resize(src.width, src.height);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    let cur = this.tex.src;
    const list = effects.filter(f => f.on && EFFECTS[f.type] && !EFFECTS[f.type].transform);
    const next = () => (cur === this.tex.a ? 'b' : 'a');
    const run = (name, uni, extra) => { const o = next(); this._pass(name, cur, o, uni, extra); cur = this.tex[o]; };
    const deg = Math.PI / 180;
    for (const f of list) {
      const p = f.params;
      switch (f.type) {
        case 'blur': if (p.radius > 0) { run('blur', { u_dir: [1, 0], u_r: p.radius * scale }); run('blur', { u_dir: [0, 1], u_r: p.radius * scale }); } break;
        case 'dirblur': if (p.radius > 0) run('blur', { u_dir: [Math.cos(p.angle * deg), Math.sin(p.angle * deg)], u_r: p.radius * scale }); break;
        case 'zoomblur': run('zoomblur', { u_amt: p.amount, u_c: [p.cx, 1 - p.cy] }); break;
        case 'glow': {
          this._pass('copy', cur, 'base'); 
          run('blur', { u_dir: [1, 0], u_r: p.radius * scale }); run('blur', { u_dir: [0, 1], u_r: p.radius * scale });
          run('glowmix', { u_int: p.intensity, u_tint: hex3(p.tint), u_tmix: p.tintMix }, { name: 'u_base', tex: this.tex.base });
          break;
        }
        case 'coloradj': run('coloradj', { u_b: p.brightness, u_c: p.contrast, u_s: p.saturation, u_h: (p.hue + p.hueSpeed * t) * deg }); break;
        case 'duotone': run('duotone', { u_a: hex3(p.a), u_bb: hex3(p.b), u_mix: p.mix }); break;
        case 'invert': run('invert', { u_mix: p.mix }); break;
        case 'posterize': run('posterize', { u_lv: Math.round(p.levels) }); break;
        case 'rgbsplit': {
          const amt = p.amount * scale * (p.pulse > 0 ? 0.5 + 0.5 * Math.sin(t * p.pulse * Math.PI * 2) : 1);
          run('rgbsplit', { u_off: [Math.cos(p.angle * deg) * amt, Math.sin(p.angle * deg) * amt] }); break;
        }
        case 'glitch': run('glitch', { u_amt: p.amount, u_bands: Math.round(p.blocks), u_spd: p.speed }); break;
        case 'pixelate': run('pixelate', { u_sz: Math.max(1, p.size * scale) }); break;
        case 'scanlines': run('scanlines', { u_den: p.density, u_int: p.intensity, u_spd: p.speed }); break;
        case 'noise': run('noise', { u_amt: p.amount, u_mono: p.mono ? 1 : 0 }); break;
        case 'vignette': run('vignette', { u_amt: p.amount, u_soft: p.softness }); break;
        case 'wave': run('wave', { u_amp: p.amp * scale, u_len: p.length * scale, u_spd: p.speed, u_vert: p.vertical ? 1 : 0 }); break;
        case 'swirl': run('swirl', { u_ang: p.angle * deg, u_rad: p.radius }); break;
        case 'kaleido': run('kaleido', { u_seg: Math.round(p.segments), u_rot: p.rotate * deg }); break;
        case 'mirror': run('mirror', { u_mode: { horizontal: 0, vertical: 1, quad: 2 }[p.mode] ?? 0 }); break;
      }
    }
    this._pass('copy', cur, null);
    return this.canvas;
  }
}
