// 3D effects: the layer is used as the surface texture of a ray-marched solid (signed distance fields), lit with a key light.
import { def, shader, num, px, pct, ang, col, bool, sel, vec2, vec3, hex3 } from './core.js';
import { pos, dir } from './color.js';
import { rotM } from './distort.js';
const D = Math.PI / 180;
const SHAPES = { box: 1, cube: 2, cylinder: 3, ellipsoid: 4, flip: 5, heart: 6, hexprism: 7, hollowbox: 8, octahedron: 9, pyramid: 10, ring: 11, starpoly: 12, starprism: 13, cross3: 14, torus: 15 };
const SDF = `uniform float u_shape, u_sz, u_th, u_in, u_pts, u_shade, u_bop; uniform vec3 u_m0,u_m1,u_m2, u_base; uniform vec2 u_ax;
vec3 toObj(vec3 v){ return vec3(dot(v,u_m0),dot(v,u_m1),dot(v,u_m2)); } vec3 toW(vec3 v){ return mat3(u_m0,u_m1,u_m2)*v; }
float dot2(vec2 v){ return dot(v,v); }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdFrame(vec3 p, vec3 b, float e){ p=abs(p)-b; vec3 q=abs(p+e)-e; return min(min(length(max(vec3(p.x,q.y,q.z),0.))+min(max(p.x,max(q.y,q.z)),0.), length(max(vec3(q.x,p.y,q.z),0.))+min(max(q.x,max(p.y,q.z)),0.)), length(max(vec3(q.x,q.y,p.z),0.))+min(max(q.x,max(q.y,p.z)),0.)); }
float ext(float d2, float z, float h){ vec2 w=vec2(d2, abs(z)-h); return min(max(w.x,w.y),0.)+length(max(w,0.)); }
float sdStar(vec2 p, float r, float n, float m){ float an=PI/n, en=PI/m; vec2 acs=vec2(cos(an),sin(an)), ecs=vec2(cos(en),sin(en)); float bn=mod(atan(p.x,p.y),2.*an)-an;
  p=length(p)*vec2(cos(bn),abs(sin(bn))); p-=r*acs; p+=ecs*clamp(-dot(p,ecs),0.,r*acs.y/ecs.y); return length(p)*sign(p.x); }
float sdHeart(vec2 p){ p.x=abs(p.x); if(p.y+p.x>1.) return sqrt(dot2(p-vec2(0.25,0.75)))-0.35355339; return sqrt(min(dot2(p-vec2(0.,1.)), dot2(p-0.5*max(p.x+p.y,0.))))*sign(p.x-p.y); }
float sdHex(vec2 p, float r){ const vec3 k=vec3(-0.866025404,0.5,0.577350269); p=abs(p); p-=2.*min(dot(k.xy,p),0.)*k.xy; p-=vec2(clamp(p.x,-k.z*r,k.z*r),r); return length(p)*sign(p.y); }
float sdPyr(vec3 p, float h){ float m2=h*h+0.25; p.xz=abs(p.xz); p.xz=(p.z>p.x)?p.zx:p.xz; p.xz-=0.5; vec3 q=vec3(p.z,h*p.y-0.5*p.x,h*p.x+0.5*p.y);
  float s=max(-q.x,0.); float t=clamp((q.y-0.5*p.z)/(m2+0.25),0.,1.); float a=m2*(q.x+s)*(q.x+s)+q.y*q.y; float b=m2*(q.x+0.5*t)*(q.x+0.5*t)+(q.y-m2*t)*(q.y-m2*t);
  float d2=min(q.y,-q.x*m2-q.y*0.5)>0.?0.:min(a,b); return sqrt((d2+q.z*q.z)/m2)*sign(max(q.z,-p.y)); }
float map(vec3 p){ float s=u_shape; float th=max(u_th,0.002);
  if(s<1.5) return sdBox(p, vec3(u_ax, th))-0.004;
  if(s<2.5) return sdBox(p, vec3(0.62))-0.01;
  if(s<3.5){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(0.55,0.8); return min(max(d.x,d.y),0.)+length(max(d,0.)); }
  if(s<4.5){ vec3 r=vec3(u_ax*0.95, max(min(u_ax.x,u_ax.y)*th*4.,0.05)); float k0=length(p/r), k1=length(p/(r*r)); return k0*(k0-1.)/k1; }
  if(s<5.5) return sdBox(p, vec3(u_ax, 0.004));
  if(s<6.5){ vec2 q=p.xy*1.15+vec2(0.,0.62); return ext(sdHeart(q)/1.15, p.z, th)-0.04; }
  if(s<7.5) return ext(sdHex(p.yx, 0.78), p.z, th)-0.01;
  if(s<8.5) return sdFrame(p, vec3(0.62), 0.09*max(u_in,0.1)*2.)-0.005;
  if(s<9.5){ vec3 q=abs(p); return (q.x+q.y+q.z-0.95)*0.57735027; }
  if(s<10.5) return sdPyr((p+vec3(0.,0.6,0.))/1.3, 1.)*1.3;
  if(s<11.5){ float d2=abs(length(p.xy)-0.68)-0.22*max(u_in,0.05)*2.; return ext(d2, p.z, th)-0.02; }
  if(s<12.5){ float d2=sdStar(p.xy,0.95,u_pts,max(2.,u_pts*0.55)); float k=1./max(th*2.5,0.02); return (d2+abs(p.z)*k)/sqrt(1.+k*k); }
  if(s<13.5) return ext(sdStar(p.xy,0.95,u_pts,max(2.,u_pts*0.55)), p.z, th)-0.01;
  if(s<14.5){ float w=0.22*max(u_in,0.1)*2.; return min(min(sdBox(p,vec3(0.85,w,w)),sdBox(p,vec3(w,0.85,w))),sdBox(p,vec3(w,w,0.85)))-0.01; }
  vec2 q=vec2(length(p.xy)-0.62, p.z); return length(q)-0.3*max(u_in,0.05)*2.; }
vec3 nrm(vec3 p){ const vec2 k=vec2(1.,-1.); float e=0.0015; return normalize(k.xyy*map(p+k.xyy*e)+k.yyx*map(p+k.yyx*e)+k.yxy*map(p+k.yxy*e)+k.xxx*map(p+k.xxx*e)); }
vec2 uvOf(vec3 p, vec3 n){ float s=u_shape; vec3 a=abs(n);
  if(s>3.5&&s<4.5){ vec3 q=normalize(p); return vec2(atan(q.x,q.z)/PI, asin(clamp(q.y,-1.,1.))/(PI*0.5)); }
  if(s>2.5&&s<3.5){ if(a.y>0.9) return p.xz/0.55; return vec2(atan(p.x,p.z)/PI, p.y/0.8); }
  if(s>14.5) return vec2(atan(p.y,p.x)/PI, atan(p.z,length(p.xy)-0.62)/PI);
  vec2 fe = (s<1.5||(s>4.5&&s<5.5)) ? u_ax : (s>1.5&&s<2.5)||(s>7.5&&s<8.5) ? vec2(0.62) : vec2(0.95);
  bool box = (s>1.5&&s<2.5)||(s>7.5&&s<8.5)||(s>9.5&&s<10.5)||(s>8.5&&s<9.5)||(s>13.5&&s<14.5);
  if(box){ if(a.x>a.y&&a.x>a.z) return vec2(-sign(n.x)*p.z, p.y)/fe; if(a.y>a.z) return vec2(p.x, -sign(n.y)*p.z)/fe; }
  return vec2(n.z<0.?-p.x:p.x, p.y)/fe; }
vec4 surf(vec2 s){ if(abs(s.x)>1.001||abs(s.y)>1.001){ return vec4(u_base*u_bop,u_bop); } vec4 t=Tp(u_c+s*u_hs); return t+vec4(u_base*u_bop,u_bop)*(1.-t.a); }
vec3 light(vec3 col, vec3 n, vec3 rd){ vec3 L=normalize(vec3(-0.45,0.6,0.75)); float d=max(dot(n,L),0.); float sp=pow(max(dot(reflect(rd,n),L),0.),36.)*0.45; float rim=pow(1.-max(dot(n,-rd),0.),3.)*0.15;
  vec3 lit=col*(0.32+0.78*d)+sp+rim; return mix(col,lit,u_shade); }
void main(){ float Rl=max(u_hs.x,u_hs.y); float R=Rl*u_sz; vec2 X=(v_uv*u_res-u_c)/R; float F=5.; vec3 ro=toObj(vec3(0.,0.,F)), rd=toObj(normalize(vec3(X,-F)));
  float b=dot(ro,rd), c=dot(ro,ro)-3.4; float h=b*b-c; if(h<0.){ gl_FragColor=vec4(0.); return; } h=sqrt(h); float t=max(-b-h,0.), tmax=-b+h; float md=1e9, mt=t; bool hit=false; float px=1./R;
  for(int i=0;i<110;i++){ vec3 p=ro+rd*t; float d=map(p); if(d<md){ md=d; mt=t; } if(d<px*0.25){ hit=true; break; } t+=d*0.85; if(t>tmax) break; }
  float cov = hit ? 1. : clamp(1.-md/(px*1.2),0.,1.); if(cov<=0.){ gl_FragColor=vec4(0.); return; }
  vec3 p=ro+rd*mt; vec3 n=nrm(p); vec4 s=surf(uvOf(p,n)); vec3 col=light(unp(s), toW(n), normalize(vec3(X,-F))); float a=s.a*cov; gl_FragColor=vec4(clamp(col,0.,1.)*a,a); }`;
shader('sdf3d', SDF);
const o3 = (d = [-20, 30, 0]) => ({ ori: vec3('Orientation', d), rot: vec3('Rotation', [0, 0, 0]) });
const common = (o = {}) => ({ ...o3(o.ori), size: num('Size', 100, 1, 1000, { step: 0.1 }), ...(o.th === false ? {} : { th: num('Thickness', o.th ?? 20, 0, 200, { step: 0.1 }) }), ...(o.extra || {}),
  shade: pct('Shading', 80), base: col('Base Color', '#a9adbb'), bop: pct('Base Opacity', o.bop ?? 100) });
const mats = p => rotM((p.ori[1] + p.rot[1]) * D, (p.ori[0] + p.rot[0]) * D, -(p.ori[2] + p.rot[2]) * D);
function solid(id, name, desc, o = {}) {
  def(id, { name, cat: '3d', desc, params: common(o), tags: ['3D', 'Lighting', 'Raster', 'Shape'],
    run(g, cur, p, c) { const m = mats(p), mx = Math.max(c.hw, c.hh, 1);
      return g.run('sdf3d', { u_shape: SHAPES[o.shape || id], u_sz: p.size / 100, u_th: (p.th ?? 20) / 100, u_in: (p.inner ?? 50) / 100, u_pts: p.pts ?? 5, u_shade: p.shade / 100, u_bop: p.bop / 100, u_base: hex3(p.base),
        u_m0: m.slice(0, 3), u_m1: m.slice(3, 6), u_m2: m.slice(6, 9), u_ax: [c.hw / mx, c.hh / mx] }); } });
}
solid('box', 'Box', 'Turns the layer into a 3D box with the layer on its faces.');
solid('cube', 'Cube', 'Wraps the layer around every face of a 3D cube.', { th: false });
solid('cylinder', 'Cylinder', 'Wraps the layer around a 3D cylinder.', { th: false });
solid('ellipsoid', 'Ellipsoid', 'Wraps the layer around a 3D ellipsoid.', { th: 25 });
solid('flip', 'Flip Layer', 'Rotates the layer in 3D like a flipping card.', { th: false, ori: [0, 35, 0], bop: 0 });
solid('heart', 'Heart', 'Renders a puffy 3D heart using the layer as its surface.', { th: 22 });
solid('hexprism', 'Hexagonal Prism', 'Renders a 3D hexagonal prism using the layer as its surface.', { th: 25 });
solid('hollowbox', 'Hollow Box', 'Renders the frame of a hollow 3D box textured with the layer.', { th: false, extra: { inner: pct('Frame Width', 50, 5, 100) } });
solid('octahedron', 'Octahedron', 'Renders a 3D octahedron textured with the layer.', { th: false });
solid('pyramid', 'Pyramid', 'Renders a 3D pyramid textured with the layer.', { th: false });
solid('ring', 'Ring', 'Renders a thick 3D ring using the layer as its surface.', { th: 18, extra: { inner: pct('Ring Width', 50, 5, 100) } });
solid('starpoly', 'Star Polyhedron', 'Renders a faceted 3D star with pointed faces.', { th: 30, extra: { pts: num('Points', 5, 3, 16, { step: 1 }) } });
solid('starprism', 'Star Prism', 'Renders a faux-3D star prism using the layer as a surface texture.', { th: 20, ori: [0, 0, 0], extra: { pts: num('Points', 5, 3, 16, { step: 1 }) } });
solid('cross3', 'Three-axis Cross', 'Renders a 3D cross of three bars textured with the layer.', { th: false, extra: { inner: pct('Bar Width', 50, 5, 100) } });
solid('torus', 'Torus', 'Wraps the layer around a 3D doughnut.', { th: false, extra: { inner: pct('Tube Size', 50, 5, 100) } });

shader('rextrude', `uniform float u_sz, u_th, u_shade; uniform vec3 u_m0,u_m1,u_m2, u_side; uniform vec2 u_ax; uniform float u_sop;
vec3 toObj(vec3 v){ return vec3(dot(v,u_m0),dot(v,u_m1),dot(v,u_m2)); } vec3 toW(vec3 v){ return mat3(u_m0,u_m1,u_m2)*v; }
float A(vec2 xy){ return Tp(u_c+xy/u_ax*u_hs).a; }
void main(){ float Rl=max(u_hs.x,u_hs.y); float R=Rl*u_sz; vec2 X=(v_uv*u_res-u_c)/R; float F=5.; vec3 ro=toObj(vec3(0.,0.,F)), rd=toObj(normalize(vec3(X,-F)));
  vec3 b=vec3(u_ax*1.01, max(u_th,0.003)); vec3 inv=1./(rd+sign(rd)*1e-6+vec3(equal(rd,vec3(0.)))*1e-6); vec3 t0=(-b-ro)*inv, t1=(b-ro)*inv; vec3 tn=min(t0,t1), tf=max(t0,t1);
  float ta=max(max(tn.x,tn.y),tn.z), tb=min(min(tf.x,tf.y),tf.z); if(ta>tb||tb<0.){ gl_FragColor=vec4(0.); return; }
  float dt=(tb-ta)/72.; float t=ta; bool hit=false; float tl=ta;
  for(int i=0;i<73;i++){ vec3 p=ro+rd*t; if(A(p.xy)>0.5){ hit=true; break; } tl=t; t+=dt; }
  if(!hit){ gl_FragColor=vec4(0.); return; }
  float lo=tl, hi=t; for(int i=0;i<6;i++){ float m=(lo+hi)*0.5; if(A((ro+rd*m).xy)>0.5) hi=m; else lo=m; } t=hi; vec3 p=ro+rd*t;
  vec3 n; vec4 s=Tp(u_c+p.xy/u_ax*u_hs); vec3 col=unp(s);
  if(abs(abs(p.z)-b.z)<1e-3+dt*0.6 && t-ta<dt*1.5){ n=vec3(0.,0.,sign(p.z)); } else { vec2 e=vec2(1.5/R,0.); vec2 gr=vec2(A(p.xy+e.xy)-A(p.xy-e.xy), A(p.xy+e.yx)-A(p.xy-e.yx)); n=normalize(vec3(-gr,0.)+1e-4); col=mix(col, col*u_side, u_sop); }
  vec3 wn=toW(n); vec3 L=normalize(vec3(-0.45,0.6,0.75)); float d=max(dot(wn,L),0.); vec3 lit=col*(0.35+0.75*d); col=mix(col,lit,u_shade); gl_FragColor=vec4(clamp(col,0.,1.),1.); }`);
def('rextrude', { name: 'Raster Extrude', cat: '3d', desc: 'Extrudes the exact outline of the layer into a solid 3D slab.', tags: ['3D', 'Lighting', 'Raster', 'Shape'],
  params: { ...o3([-25, 35, 0]), size: num('Size', 100, 1, 1000, { step: 0.1 }), th: num('Thickness', 15, 0, 100, { step: 0.1 }), shade: pct('Shading', 80), side: col('Side Color', '#55596a'), sop: pct('Side Tint', 50) },
  run(g, cur, p, c) { const m = mats(p), mx = Math.max(c.hw, c.hh, 1);
    return g.run('rextrude', { u_sz: p.size / 100, u_th: p.th / 100, u_shade: p.shade / 100, u_m0: m.slice(0, 3), u_m1: m.slice(3, 6), u_m2: m.slice(6, 9), u_ax: [c.hw / mx, c.hh / mx], u_side: hex3(p.side), u_sop: p.sop / 100 }); } });

def('pagecurl', { name: 'Page Curl', cat: '3d', desc: 'Peels the layer back like the corner of a page, showing its back side.', tags: ['3D', 'Transition', 'Lighting'],
  params: { amt: pct('Curl', 30), angle: ang('Direction', -45), radius: pct('Radius', 14, 1, 200), back: col('Back Color', '#eef0f4'), bmix: pct('Back Opacity', 85), shadow: pct('Shadow', 60) },
  run(g, cur, p, c) { const d = dir(p.angle); const ex = Math.abs(d[0]) * c.hw + Math.abs(d[1]) * c.hh; const r = Math.max(2, p.radius / 100 * Math.min(c.hw, c.hh)), a = p.amt / 100;
    return g.run('curl', { u_d: d, u_f: ex * (1 - a) + (-ex - Math.PI * r) * a, u_r: r, u_back: hex3(p.back), u_backmix: p.bmix / 100, u_shadow: p.shadow / 100, u_light: 1 }); } });

def('spherize', { name: 'Spherize', cat: '3d', desc: 'Wraps the layer onto a lit 3D sphere that can spin.', tags: ['3D', 'Lighting', 'Distort'],
  params: { amt: pct('Amount', 100), radius: pct('Radius', 100, 1, 300), center: vec2('Center', [0, 0]), rot: vec3('Rotation', [0, 0, 0]), shade: pct('Shading', 70) },
  fs: `uniform float u_amt, u_r, u_shade; uniform vec2 u_cen; uniform vec3 u_m0,u_m1,u_m2; vec3 toObj(vec3 v){ return vec3(dot(v,u_m0),dot(v,u_m1),dot(v,u_m2)); }
  void main(){ vec2 d=(v_uv*u_res-u_cen)/u_r; float r=length(d); float cov=clamp((1.-r)*u_r+0.5,0.,1.); if(cov<=0.){ gl_FragColor=mix(T(v_uv),vec4(0.),u_amt); return; }
  vec3 n=vec3(d, sqrt(max(0.,1.-r*r))); vec3 o=toObj(n); vec2 s=vec2(atan(o.x,o.z)/PI, asin(clamp(o.y,-1.,1.))/(PI*0.5)); vec2 flat_=d; vec2 m=mix(flat_, s, u_amt);
  vec4 c=Tp(u_cen+m*u_hs*vec2(1.,1.)); vec3 L=normalize(vec3(-0.45,0.6,0.75)); float df=max(dot(n,L),0.); float sp=pow(max(dot(reflect(vec3(0.,0.,-1.),n),L),0.),30.)*0.4;
  vec3 col=unp(c); col=mix(col, col*(0.3+0.8*df)+sp, u_shade*u_amt); vec4 o2=pm(col,c.a)*cov; gl_FragColor=mix(T(v_uv), o2, u_amt); }`,
  u: (p, c) => { const m = rotM(p.rot[1] * D, p.rot[0] * D, -p.rot[2] * D); return { u_amt: p.amt / 100, u_r: p.radius / 100 * Math.min(c.hw, c.hh), u_shade: p.shade / 100, u_cen: pos(c, p.center), u_m0: m.slice(0, 3), u_m1: m.slice(3, 6), u_m2: m.slice(6, 9) }; } });

def('tunnel', { name: 'Tunnel', cat: '3d', desc: 'Repeats the layer down an endless 3D tunnel you fly through.', tags: ['3D', 'Auto', 'Loop'],
  params: { spd: num('Speed', 0.5, -10, 10, { step: 0.01 }), rep: num('Repeat', 3, 1, 24, { step: 1 }), twist: num('Twist', 0, -720, 720, { unit: '°/s', step: 0.1 }), fog: pct('Depth Fade', 60), center: vec2('Center', [0, 0]), mirror: bool('Mirror', true) },
  fs: `uniform float u_ph, u_rep, u_tw, u_fog, u_mir; uniform vec2 u_cen; void main(){ vec2 q=toL(v_uv*u_res); if(abs(q.x)>1.||abs(q.y)>1.){ gl_FragColor=vec4(0.); return; }
  vec2 d=(v_uv*u_res-u_cen)/max(min(u_hs.x,u_hs.y),1.); float r=max(length(d),1e-3); float a=atan(d.y,d.x)+u_tw; vec2 s=vec2(a/PI*u_rep*0.5, 0.35/r+u_ph);
  vec2 f=fract(s*0.5)*2.; if(u_mir>0.5) f=1.-abs(f-1.); else f=fract(s); vec4 c=Tp(fromL(f*2.-1.)); float fade=mix(1., smoothstep(0.,0.9,r), u_fog); gl_FragColor=vec4(c.rgb*fade, c.a); }`,
  u: (p, c) => ({ u_ph: c.lt * p.spd, u_rep: p.rep, u_tw: p.twist * D * c.lt, u_fog: p.fog / 100, u_cen: pos(c, p.center), u_mir: p.mirror }) });
