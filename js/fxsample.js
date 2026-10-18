// Procedural sample scenes for effect thumbnails, the contact sheet and the per-effect visual tests (no external assets).
import { newProject, makeLayer, setKey } from './state.js';
import { makeEase } from './easing.js';
import { media } from './render.js';
import { EFFECTS, makeEffect } from './effects.js';

const cache = {};
function cv(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }
// a colourful "photo": sunset sky, sun, layered hills, flowers
export function samplePhoto(n = 512) {
  if (cache.photo) return cache.photo;
  const c = cv(n), g = c.getContext('2d'), k = n / 512;
  let gr = g.createLinearGradient(0, 0, 0, n); gr.addColorStop(0, '#2b4c9b'); gr.addColorStop(0.45, '#c86a8a'); gr.addColorStop(0.7, '#ffb36b'); g.fillStyle = gr; g.fillRect(0, 0, n, n);
  const sun = g.createRadialGradient(330 * k, 250 * k, 0, 330 * k, 250 * k, 160 * k); sun.addColorStop(0, 'rgba(255,240,190,1)'); sun.addColorStop(0.28, 'rgba(255,222,140,1)'); sun.addColorStop(0.3, 'rgba(255,200,120,.55)'); sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse((40 + i * 97 % 470) * k, (40 + (i * 53) % 150) * k, (30 + i % 4 * 12) * k, (8 + i % 3 * 3) * k, 0, 0, 7); g.fill(); }
  const hill = (y, amp, f, ph, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, n); for (let x = 0; x <= n; x += 4) g.lineTo(x, (y + Math.sin(x / n * f + ph) * amp + Math.sin(x / n * f * 2.7 + ph * 2) * amp * 0.35) * k); g.lineTo(n, n); g.fill(); };
  hill(330, 34, 6, 0.5, '#5a3d7a'); hill(370, 26, 8, 2, '#3b6e7a'); hill(420, 22, 5, 4, '#2f9a5a');
  g.fillStyle = '#237a45'; g.fillRect(0, 460 * k, n, 52 * k);
  const cols = ['#ff3b5c', '#ffd23f', '#ffffff', '#ff8a3d', '#b14cff'];
  for (let i = 0; i < 26; i++) { const x = (12 + i * 41 % 500) * k, y = (440 + (i * 29) % 60) * k, r = (7 + i % 3 * 3) * k; g.strokeStyle = '#1d5a33'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 26 * k); g.stroke();
    g.fillStyle = cols[i % cols.length]; for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(x + Math.cos(p * 1.256) * r * 0.7, y + Math.sin(p * 1.256) * r * 0.7, r * 0.55, 0, 7); g.fill(); } g.fillStyle = '#ffcf33'; g.beginPath(); g.arc(x, y, r * 0.35, 0, 7); g.fill(); }
  return (cache.photo = c);
}
// a dancer silhouette on a green screen
export function sampleGreen(n = 512) {
  if (cache.green) return cache.green;
  const c = cv(n), g = c.getContext('2d'), k = n / 512;
  const gr = g.createRadialGradient(256 * k, 240 * k, 40 * k, 256 * k, 256 * k, 380 * k); gr.addColorStop(0, '#2fe066'); gr.addColorStop(1, '#14b84a'); g.fillStyle = gr; g.fillRect(0, 0, n, n);
  g.fillStyle = '#1a1a22'; g.strokeStyle = '#1a1a22'; g.lineCap = 'round'; g.lineWidth = 34 * k;
  g.beginPath(); g.arc(250 * k, 120 * k, 40 * k, 0, 7); g.fill();
  g.beginPath(); g.moveTo(250 * k, 170 * k); g.lineTo(262 * k, 300 * k); g.stroke();
  g.lineWidth = 24 * k; g.beginPath(); g.moveTo(252 * k, 190 * k); g.lineTo(170 * k, 120 * k); g.lineTo(130 * k, 60 * k); g.moveTo(256 * k, 190 * k); g.lineTo(350 * k, 150 * k); g.lineTo(410 * k, 90 * k);
  g.moveTo(262 * k, 300 * k); g.lineTo(190 * k, 380 * k); g.lineTo(170 * k, 470 * k); g.moveTo(262 * k, 300 * k); g.lineTo(350 * k, 370 * k); g.lineTo(420 * k, 340 * k); g.stroke();
  g.fillStyle = '#e8b48f'; g.beginPath(); g.arc(250 * k, 120 * k, 30 * k, 0, 7); g.fill();
  return (cache.green = c);
}
function reg(id, canvas) { media.set(id, { type: 'image', el: canvas, url: '' }); }
const KIND_SAMPLE = { '3d': 'small', move: 'dot', repeat: 'dot', matte: 'small', opacity: 'small' };
// effects that need a layer with transparent surroundings to show (shadows, outlines, glows)
const STAR = ['longshadow', 'radialshadow', 'strokecolor', 'innerglow', 'bevel', 'edgeglow', 'glow', 'roughen', 'smoothedges', 'electricedges', 'matechoker', 'feather', 'solidmatte', 'softglow', 'lightglow', 'contourgrad'];
const SMALL = ['innerblur', 'mattefringe', 'spin'];
export const sampleKind = id => { const d = EFFECTS[id]; return SMALL.includes(id) ? 'small' : d?.sample || (STAR.includes(id) ? 'star' : KIND_SAMPLE[d?.cat]) || 'photo'; };
// per-effect sample tweaks: parameters scaled to the sample size, and effects that need a prepared input
const SAMPLE_PARAMS = { movealongpath: s => ({ radius: s * 0.3 }), repeatpath: s => ({ radius: s * 0.32, n: 10 }) };
const SAMPLE_PRE = { mattefringe: s => [['feather', { r: s * 0.05 }]] };
export const SAMPLE_T = 1;
// Project + the layer the effect goes on. size = composition side (square)
export function sampleProject(id, { fx = true, size = 540, params = {} } = {}) {
  const p = newProject('1:1', 'fx-sample', { res: size }); p.bg = '#141720'; p.duration = 4;
  reg('__photo', samplePhoto()); reg('__green', sampleGreen());
  const kind = sampleKind(id), s = size;
  const photo = (o = {}) => { const L = makeLayer(p, 'image', { mediaId: '__photo', w: 512, h: 512, name: 'Photo' }); L.props.scale = s / 512 * (o.scale ?? 1); return L; };
  const solid = c => makeLayer(p, 'solid', { color: c });
  let target, layers;
  switch (kind) {
    case 'green': target = makeLayer(p, 'image', { mediaId: '__green', w: 512, h: 512, name: 'Green' }); target.props.scale = s / 512; layers = [target, photo()]; break;
    case 'text': { target = makeLayer(p, 'text', { content: 'Text\nEffect' }); target.text.fill = '#ffffff'; target.text.size = Math.round(s * 0.2); target.text.lineHeight = 1.05; layers = [target, photo()]; break; }
    case 'moving': { target = makeLayer(p, 'shape', { kind: 'ellipse', fill: '#ff4d8d', shape: { w: s * 0.26, h: s * 0.26 } });
      setKey(target, 'x', 0.2, s * 0.18, makeEase('easeInOut')); setKey(target, 'x', 1.8, s * 0.82, makeEase('easeInOut'));
      setKey(target, 'y', 0.2, s * 0.7, makeEase('easeInOut')); setKey(target, 'y', 1.8, s * 0.3, makeEase('easeInOut')); layers = [target, solid('#1d2140')]; break; }
    case 'stack': target = makeLayer(p, 'shape', { kind: 'rect', fill: '#ffffff', shape: { w: s * 0.56, h: s * 0.56, radius: s * 0.08 } }); layers = [target, photo()]; break;
    case 'draw': { target = makeLayer(p, 'draw'); const pts = []; for (let i = 0; i <= 80; i++) { const u = i / 80; pts.push([(u - 0.5) * s * 0.75, Math.sin(u * Math.PI * 3) * s * 0.18 - s * 0.08]); }
      const pts2 = []; for (let i = 0; i <= 50; i++) { const a = i / 50 * Math.PI * 1.7; pts2.push([Math.cos(a) * s * 0.12 - s * 0.1, Math.sin(a) * s * 0.12 + s * 0.24]); }
      target.draw.strokes = [{ tool: 'pen', color: '#00ffa8', size: 22, pts }, { tool: 'pen', color: '#ff4d8d', size: 22, pts: pts2 }]; layers = [target, solid('#1d2140')]; break; }
    case 'dot': target = makeLayer(p, 'shape', { kind: 'ellipse', fill: '#7b4dff', shape: { w: s * 0.16, h: s * 0.16 } }); layers = [target, solid('#f2f3f7')]; break;
    case 'small': target = photo({ scale: 0.5 }); layers = [target, solid('#e9eaef')]; break;
    case 'star': target = makeLayer(p, 'shape', { kind: 'star', fill: '#ffd23f', shape: { w: s * 0.62, h: s * 0.62, inner: 0.48, gradient: true, fill2: '#ff4d8d', gradAngle: 60 } }); layers = [target, photo()]; break;
    default: target = photo(); layers = [target];
  }
  p.layers = layers;
  for (const [pid, pp] of SAMPLE_PRE[id]?.(s) || []) if (EFFECTS[pid]) target.effects.push(makeEffect(pid, pp));
  if (fx && EFFECTS[id]) target.effects.push(makeEffect(id, { ...(SAMPLE_PARAMS[id]?.(s) || {}), ...params }));
  return { project: p, layer: target };
}
