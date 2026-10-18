import { newProject, makeLayer, ASPECTS, ANIM_PROPS, PROP_META, valueAt, hasKeys, findKey, setKey, removeKey, writeProp, allKeys, shiftLayer, History, clone, uid } from './state.js';
import { EASE_PRESETS, makeEase, applyEase } from './easing.js';
import { EFFECTS, makeEffect } from './effects.js';
import { Renderer, BLEND_MODES, FONTS, media, evalTransform, layerBounds, syncVideos, shapePoints, brushWidth } from './render.js';
import * as store from './storage.js';
import { exportVideo, supportedFormats, exportSize } from './export.js';
import { $, h, slider, color, toggle, select, chips, section, toast, icon } from './ui.js';

// ---------------- state ----------------
// tab: null (nothing / tile grid when a layer is selected) | 'add' (add sheet) | a sub panel id (see SUB_TITLE)
const S = { project: null, t: 0, playing: false, sel: null, selKeys: new Set(), tab: null, addTab: 'shape', pps: 60, autoFit: false, loop: true, fxCat: 'All',
  draw: { tool: 'pencil', size: 16, color: '#0000ff' }, cursor: null, picking: false, full: false };
const history = new History();
const renderer = new Renderer();
const view = $('#view'), overlay = $('#overlay'), stage = $('#stage');
let viewScale = 1; // css px per project px
const PILL_W = 70, HEAD_H = 48, ROW_H = 40; // timeline: layer pill width, ruler+timecode band, row pitch
const ACCENT = '#00ffa8';

const P = () => S.project;
const selLayer = () => P()?.layers.find(l => l.id === S.sel) || null;
const isSub = () => !!S.tab && S.tab !== 'add';
const mode = () => (isSub() ? 'sub' : S.sel ? 'sel' : 'none');
const soon = what => () => toast((what ? what + ': ' : '') + 'coming soon');

function commit(opts = {}) {
  history.push(P());
  scheduleSave();
  if (!opts.silent) refreshAll();
}
let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!store.saveProject(P())) toast('Storage full — export JSON to keep work'); }, 350); }

function refreshAll() { layoutChrome(); layoutStage(); drawFrame(); renderTimeline(); renderPanel(); updateTransport(); updateHeader(); }

// body[data-mode] drives the top bar / bottom zone (none: timeline + FAB, sel: tile grid, sub: property panel)
function layoutChrome() {
  const m = mode(), b = document.body;
  b.dataset.mode = m;
  b.classList.toggle('panel-open', m !== 'none');
  b.classList.toggle('sheet-open', S.tab === 'add');
  b.classList.toggle('full', S.full);
  b.dataset.sub = isSub() ? S.tab : '';
  $('#sheet').hidden = S.tab !== 'add';
  if (S.tab === 'add') renderSheet();
}

// ---------------- media ----------------
async function registerMedia(id, blob, type) {
  const url = URL.createObjectURL(blob);
  let el;
  if (type === 'image') {
    el = new Image(); el.decoding = 'async'; el.src = url;
    await new Promise((r, j) => { el.onload = r; el.onerror = j; });
  } else if (type === 'audio') {
    el = new Audio(); el.preload = 'auto'; el.src = url;
    await new Promise((r, j) => { el.onloadedmetadata = r; el.onerror = j; });
  } else {
    el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.src = url;
    await new Promise((r, j) => { el.onloadeddata = r; el.onerror = j; });
    el.addEventListener('seeked', () => { if (!S.playing) drawFrame(); });
  }
  media.set(id, { type, el, url });
  return el;
}
async function hydrateMedia(project) {
  let any = false;
  for (const L of project.layers) {
    if ((L.type === 'image' || L.type === 'video' || L.type === 'audio') && !media.has(L.media.id)) {
      try { const b = await store.getMedia(L.media.id); if (b) { await registerMedia(L.media.id, b, L.type); any = true; } } catch (e) { console.warn(e); }
    }
  }
  drawFrame(); if (any) renderTimeline();
}
async function importMediaFile(file) {
  const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : null;
  if (!type) return toast('Unsupported file');
  const id = uid();
  try {
    await store.putMedia(id, file);
    const el = await registerMedia(id, file, type);
    const w = type === 'image' ? el.naturalWidth : el.videoWidth, hh = type === 'image' ? el.naturalHeight : el.videoHeight;
    addLayer(makeLayer(P(), type, { mediaId: id, w, h: hh, name: file.name.slice(0, 24), mediaDuration: type === 'video' ? el.duration : 0 }));
  } catch (e) { console.error(e); toast('Import failed'); }
}
async function importAudioFile(file) {
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|wav|aac|ogg)$/i.test(file.name)) return toast('Unsupported audio file');
  const id = uid();
  try {
    await store.putMedia(id, file);
    const el = await registerMedia(id, file, 'audio');
    addLayer(makeLayer(P(), 'audio', { mediaId: id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), mediaDuration: isFinite(el.duration) ? el.duration : 0 }));
  } catch (e) { console.error(e); toast('Audio import failed'); }
}

// ---------------- project ops ----------------
function setProject(p, { resetHistory = true } = {}) {
  S.project = p; S.sel = null; S.selKeys.clear(); S.tab = null; S.t = Math.min(S.t, p.duration); G.extT = 0; G.lastSel = null;
  if (resetHistory) history.reset(p);
  store.saveProject(p); hydrateMedia(p); refreshAll();
}
// new layers go on TOP of the stack (index 0 = top of the layer list = rendered last / in front)
function addLayer(L, { tab = null } = {}) {
  P().layers.unshift(L); S.sel = L.id; S.selKeys.clear(); S.tab = tab;
  commit();
}
function selectLayer(id) {
  S.sel = id; S.selKeys.clear();
  if (S.tab === 'add' || ['project', 'points', 'draw', 'edit'].includes(S.tab)) S.tab = null;
  refreshAll();
}
function deselect() { S.sel = null; S.selKeys.clear(); if (S.tab !== 'project') S.tab = null; refreshAll(); }
function goBack() {
  if (S.full) { S.full = false; return refreshAll(); }
  if (S.tab === 'add') { S.tab = null; return refreshAll(); }
  if (isSub()) { S.tab = null; S.picking = false; return refreshAll(); }
  if (S.sel) return deselect();
  showHome();
}
function openSub(id) {
  const L = selLayer();
  if (id === 'edit' && L) {
    if (L.type === 'shape' && L.shape.kind === 'path') id = 'points';
    else if (L.type === 'draw') id = 'draw';
    else if (L.type === 'solid') id = 'style';
    else if (L.type === 'adjust') id = 'fx';
  }
  S.tab = id; refreshAll();
}
function duplicateLayer(L) {
  if (!L) return toast('Select a layer to duplicate');
  const ix = P().layers.indexOf(L);
  const c = clone(L); c.id = uid(); c.name = L.name + ' copy'; for (const p in c.keys) c.keys[p].forEach(k => (k.id = uid())); c.effects.forEach(f => (f.id = uid()));
  P().layers.splice(ix, 0, c); S.sel = c.id; commit();
}
function deleteLayer(L) {
  if (!L) return; P().layers.splice(P().layers.indexOf(L), 1); S.sel = null; S.selKeys.clear(); S.tab = null; commit();
}
function moveLayer(L, d) {
  const ls = P().layers, ix = ls.indexOf(L), j = ix + d; if (j < 0 || j >= ls.length) return;
  ls.splice(ix, 1); ls.splice(j, 0, L); commit();
}
function splitAt(L, how) {
  const t = snapT(S.t);
  if (!(t > L.start + 1e-3 && t < L.end - 1e-3)) return toast('Move the playhead over the clip first');
  if (how === 'start') L.start = t;
  else if (how === 'end') L.end = t;
  else {
    const c = clone(L); c.id = uid(); for (const p in c.keys) c.keys[p].forEach(k => (k.id = uid())); c.effects.forEach(f => (f.id = uid()));
    c.start = t; L.end = t; P().layers.splice(P().layers.indexOf(L), 0, c);
  }
  commit();
}
function demoProject(aspect = '9:16') {
  const p = newProject(aspect, 'Neon Demo');
  const bg = makeLayer(p, 'solid', { color: '#07051a' }); bg.name = 'Backdrop'; bg.solid.gradient = true; bg.solid.fill2 = '#1a0230'; bg.solid.gradAngle = 90;
  const ring = makeLayer(p, 'shape', { kind: 'ring' }); ring.shape.fill = '#00f0ff'; ring.shape.thickness = 0.12; ring.name = 'Halo';
  setKey(ring, 'scale', 0, 0.2, makeEase('backOut')); setKey(ring, 'scale', 1.2, 1.4);
  setKey(ring, 'rotation', 0, 0, makeEase('linear')); setKey(ring, 'rotation', 6, 360);
  ring.effects.push(makeEffect('glow'));
  const star = makeLayer(p, 'shape', { kind: 'star' }); star.shape.fill = '#ff2bd6'; star.shape.w = star.shape.h = Math.min(p.w, p.h) * 0.22; star.name = 'Spark';
  setKey(star, 'y', 0, p.h * 0.8, makeEase('expoOut')); setKey(star, 'y', 1.5, p.h * 0.32);
  setKey(star, 'rotation', 0, -180, makeEase('easeInOut')); setKey(star, 'rotation', 1.5, 0);
  const pulseFx = makeEffect('pulse'); pulseFx.params.amount = 0.08; star.effects.push(pulseFx, makeEffect('glow'));
  star.effects[1].params.tint = '#ff2bd6';
  const txt = makeLayer(p, 'text', { content: 'KINETIC' }); txt.text.fill = '#eafcff'; txt.name = 'Title';
  setKey(txt, 'opacity', 0.6, 0, makeEase('easeOut')); setKey(txt, 'opacity', 1.4, 1);
  setKey(txt, 'scale', 0.6, 1.6, makeEase('expoOut')); setKey(txt, 'scale', 1.6, 1);
  txt.props.y = p.h * 0.62;
  const rgb = makeEffect('rgbsplit'); rgb.params.amount = 8; rgb.params.pulse = 1.5; txt.effects.push(rgb, makeEffect('glow'));
  const adj = makeLayer(p, 'adjust'); adj.name = 'CRT Grade'; adj.effects.push(makeEffect('scanlines'), makeEffect('vignette'));
  adj.effects[0].params.intensity = 0.25;
  p.layers = [adj, txt, star, ring, bg];
  return p;
}


// ---------------- stage ----------------
function layoutStage() {
  const wrap = $('#stageWrap'), r = wrap.getBoundingClientRect();
  const p = P(); if (!p || r.width < 2 || r.height < 2) return;
  const sc = Math.min(r.width / p.w, r.height / p.h);
  const cw = Math.max(40, Math.floor(p.w * sc)), ch = Math.max(40, Math.floor(p.h * sc));
  viewScale = cw / p.w;
  stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.min(p.w, Math.round(cw * dpr)), bh = Math.round(bw * p.h / p.w);
  if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
  const ow = Math.round(cw * dpr), oh = Math.round(ch * dpr);
  if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
}

function drawFrame() {
  if (!P()) return;
  syncVideos(P(), S.t, S.playing);
  renderer.render(P(), S.t, view);
  drawOverlay();
}

function toLocal(L, px, py) {
  const tr = evalTransform(L, S.t), a = -tr.rotation * Math.PI / 180, dx = px - tr.x, dy = py - tr.y, s = tr.scale || 1e-6;
  return [(dx * Math.cos(a) - dy * Math.sin(a)) / s, (dx * Math.sin(a) + dy * Math.cos(a)) / s];
}
function toWorld(L, lx, ly) {
  const tr = evalTransform(L, S.t), a = tr.rotation * Math.PI / 180;
  return [tr.x + (lx * Math.cos(a) - ly * Math.sin(a)) * tr.scale, tr.y + (lx * Math.sin(a) + ly * Math.cos(a)) * tr.scale];
}
function layerCorners(L) {
  const tr = evalTransform(L, S.t), b = layerBounds(L, P(), view.getContext('2d'));
  const pt = (lx, ly) => toWorld(L, lx, ly);
  return { tr, b, pt, corners: [pt(-b.w / 2, -b.h / 2), pt(b.w / 2, -b.h / 2), pt(b.w / 2, b.h / 2), pt(-b.w / 2, b.h / 2)], rotH: pt(0, -b.h / 2 - 60 / (tr.scale * viewScale || 1)) };
}

function drawOverlay() {
  const ctx = overlay.getContext('2d'), dpr = overlay.width / parseFloat(stage.style.width || 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, overlay.width, overlay.height);
  const L = selLayer(); if (!L || L.type === 'adjust' || L.type === 'audio' || S.playing) return;
  const k = viewScale * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const dot = (x, y, r = 5) => { ctx.beginPath(); ctx.arc(x, y, r / k * dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); };
  if (S.tab === 'points' && L.type === 'shape' && L.shape.kind === 'path') {
    const pts = (L.shape.pts || []).map(p => toWorld(L, p[0], p[1]));
    ctx.lineWidth = 1.5 / k * dpr; ctx.strokeStyle = '#fff';
    if (pts.length > 1) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); if (L.shape.closed !== false) ctx.closePath(); ctx.stroke(); }
    pts.forEach((p, i) => { const s = (i === pts.length - 1 ? 7 : 5) / k * dpr; ctx.fillStyle = i === pts.length - 1 ? ACCENT : '#fff'; ctx.fillRect(p[0] - s, p[1] - s, s * 2, s * 2); });
    const c = S.cursor || [P().w / 2, P().h / 2], g = 4 / k * dpr, l = 9 / k * dpr;
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2 / k * dpr; ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(c[0] + dx * g, c[1] + dy * g); ctx.lineTo(c[0] + dx * l, c[1] + dy * l); }
    ctx.stroke(); ctx.beginPath(); ctx.arc(c[0], c[1], 1.6 / k * dpr, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
    return;
  }
  if (S.tab === 'draw') return;
  // motion path
  if (hasKeys(L, 'x') || hasKeys(L, 'y')) {
    ctx.beginPath(); ctx.lineWidth = 1.2 / k * dpr; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([4 / k * dpr, 4 / k * dpr]);
    for (let i = 0; i <= 60; i++) { const t = L.start + (L.end - L.start) * i / 60; const x = valueAt(L, 'x', t), y = valueAt(L, 'y', t); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.t < L.start || S.t >= L.end) return;
  const g = layerCorners(L), c = g.corners;
  ctx.lineWidth = 1.6 / k * dpr; ctx.strokeStyle = '#fff';
  ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke();
  const top = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
  ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...g.rotH); ctx.stroke();
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; dot(...a); dot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  dot(...g.rotH, 7); ctx.beginPath(); ctx.arc(...g.rotH, 7 / k * dpr, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / k * dpr; ctx.stroke();
  const sh = 7 / k * dpr; ctx.fillStyle = '#fff'; ctx.fillRect(c[2][0] - sh, c[2][1] - sh, sh * 2, sh * 2); ctx.strokeStyle = '#000'; ctx.strokeRect(c[2][0] - sh, c[2][1] - sh, sh * 2, sh * 2);
}

function stagePoint(e) { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / viewScale, (e.clientY - r.top) / viewScale]; }

function hitTest(px, py) {
  const ctx = view.getContext('2d');
  let fullHit = null;
  for (const L of P().layers) {
    if (!L.visible || L.locked || L.type === 'adjust' || L.type === 'audio' || S.t < L.start || S.t >= L.end) continue;
    const tr = evalTransform(L, S.t), b = layerBounds(L, P(), ctx);
    const [lx, ly] = toLocal(L, px, py);
    const pad = 12 / (viewScale * (tr.scale || 1));
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) { if (L.type === 'solid' || L.type === 'draw') { fullHit = fullHit || L; continue; } return L; }
  }
  return fullHit;
}

const ptrs = new Map(); let gesture = null;
stage.addEventListener('pointerdown', e => {
  if (!P()) return;
  stage.setPointerCapture(e.pointerId);
  const [px, py] = stagePoint(e); ptrs.set(e.pointerId, [px, py]);
  if (S.playing) togglePlay(false);
  const L = selLayer();
  if (S.picking) { // eyedropper
    S.picking = false;
    const d = view.getContext('2d').getImageData(Math.floor(px / P().w * view.width), Math.floor(py / P().h * view.height), 1, 1).data;
    S.draw.color = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); renderPanel(); gesture = null; return;
  }
  if (S.tab === 'draw' && L?.type === 'draw') {
    if (ptrs.size > 1) { if (gesture?.mode === 'stroke') { L.draw.strokes.pop(); drawFrame(); } gesture = null; return; }
    if (S.draw.tool === 'smudge') { toast('Smudge: coming soon'); return; }
    const st = { tool: S.draw.tool, color: S.draw.color, size: S.draw.size, pts: [toLocal(L, px, py).map(v => +v.toFixed(1))] };
    L.draw.strokes.push(st); gesture = { mode: 'stroke', L, st }; drawFrame(); return;
  }
  if (S.tab === 'points' && L?.type === 'shape' && L.shape.kind === 'path') {
    if (ptrs.size > 1) return;
    const pts = L.shape.pts, tol = 22 / viewScale;
    const i = pts.findIndex(p => { const w = toWorld(L, p[0], p[1]); return Math.hypot(w[0] - px, w[1] - py) < tol; });
    if (i >= 0) gesture = { mode: 'point', L, i, moved: false };
    else { S.cursor = [px, py]; pts.push(toLocal(L, px, py).map(v => +v.toFixed(1))); gesture = { mode: 'point', L, i: pts.length - 1, moved: true }; }
    drawFrame(); renderPanel(); return;
  }
  if (S.tab === 'points' || S.tab === 'draw') return;
  if (ptrs.size === 2 && L) {
    const [a, b] = [...ptrs.values()];
    gesture = { mode: 'pinch', L, d0: Math.hypot(b[0] - a[0], b[1] - a[1]), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), s0: valueAt(L, 'scale', S.t), r0: valueAt(L, 'rotation', S.t) };
    return;
  }
  if (ptrs.size > 1) return;
  if (L && L.type !== 'adjust' && L.type !== 'audio' && S.t >= L.start && S.t < L.end) {
    const g = layerCorners(L), tol = 22 / viewScale;
    if (Math.hypot(px - g.rotH[0], py - g.rotH[1]) < tol) { gesture = { mode: 'rotate', L, r0: valueAt(L, 'rotation', S.t), a0: Math.atan2(py - g.tr.y, px - g.tr.x) }; return; }
    if (Math.hypot(px - g.corners[2][0], py - g.corners[2][1]) < tol) { gesture = { mode: 'scale', L, s0: valueAt(L, 'scale', S.t), d0: Math.hypot(px - g.tr.x, py - g.tr.y) }; return; }
  }
  const hit = hitTest(px, py);
  if (hit) {
    if (hit.id !== S.sel) selectLayer(hit.id);
    gesture = { mode: 'move', L: hit, x0: valueAt(hit, 'x', S.t), y0: valueAt(hit, 'y', S.t), px, py, moved: false };
  } else { gesture = null; if (S.sel) deselect(); }
  drawOverlay();
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = stagePoint(e); ptrs.set(e.pointerId, [px, py]);
  if (!gesture) return;
  const { L } = gesture;
  if (gesture.mode === 'stroke') {
    const lp = toLocal(L, px, py), last = gesture.st.pts[gesture.st.pts.length - 1];
    if (Math.hypot(lp[0] - last[0], lp[1] - last[1]) > 2 / viewScale) { gesture.st.pts.push(lp.map(v => +v.toFixed(1))); drawFrame(); }
    return;
  }
  if (gesture.mode === 'point') { L.shape.pts[gesture.i] = toLocal(L, px, py).map(v => +v.toFixed(1)); S.cursor = [px, py]; gesture.moved = true; drawFrame(); updateCursorBoxes(); return; }
  if (gesture.mode === 'move') {
    let nx = gesture.x0 + px - gesture.px, ny = gesture.y0 + py - gesture.py;
    const snap = 10 / viewScale;
    if (Math.abs(nx - P().w / 2) < snap) nx = P().w / 2;
    if (Math.abs(ny - P().h / 2) < snap) ny = P().h / 2;
    writeProp(L, 'x', S.t, Math.round(nx)); writeProp(L, 'y', S.t, Math.round(ny)); gesture.moved = true;
  } else if (gesture.mode === 'rotate') {
    const tr = evalTransform(L, S.t), a = Math.atan2(py - tr.y, px - tr.x);
    let r = gesture.r0 + (a - gesture.a0) * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15;
    writeProp(L, 'rotation', S.t, +r.toFixed(1)); gesture.moved = true;
  } else if (gesture.mode === 'scale') {
    const tr = evalTransform(L, S.t), d = Math.hypot(px - tr.x, py - tr.y);
    writeProp(L, 'scale', S.t, +Math.max(0.01, gesture.s0 * d / (gesture.d0 || 1)).toFixed(3)); gesture.moved = true;
  } else if (gesture.mode === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]);
    writeProp(L, 'scale', S.t, +Math.max(0.01, gesture.s0 * d / (gesture.d0 || 1)).toFixed(3));
    writeProp(L, 'rotation', S.t, +(gesture.r0 + (an - gesture.a0) * 180 / Math.PI).toFixed(1)); gesture.moved = true;
  }
  drawFrame();
});
const endPtr = e => {
  ptrs.delete(e.pointerId);
  if (gesture && ptrs.size === 0) { if (gesture.moved || gesture.mode === 'stroke') commit(); gesture = null; }
};
stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);

// ---------------- playback ----------------
let lastTs = 0;
function togglePlay(force) {
  S.playing = force ?? !S.playing;
  if (S.playing && S.t >= P().duration - 1e-3) S.t = 0;
  lastTs = performance.now(); updateTransport();
  if (S.playing) requestAnimationFrame(loop); else { drawFrame(); renderPanelIfTime(); }
}
function loop(ts) {
  if (!S.playing) return;
  const dt = Math.min(0.25, (ts - lastTs) / 1000); lastTs = ts;
  S.t += dt;
  if (S.t >= P().duration) { if (S.loop) S.t = 0; else { S.t = P().duration; togglePlay(false); } }
  drawFrame(); syncScroll(); updateTC();
  requestAnimationFrame(loop);
}
function seek(t) {
  S.t = Math.max(0, Math.min(P().duration, t));
  drawFrame(); syncScroll(); updateTC(); renderPanelIfTime(); updateHeader();
}
let panelTimer;
function renderPanelIfTime() { if (['layer', 'ease', 'blend'].includes(S.tab)) { clearTimeout(panelTimer); panelTimer = setTimeout(renderPanel, 60); } }

const pad2 = n => String(n).padStart(2, '0');
const tc = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${pad2(m)}:${s.toFixed(2).padStart(5, '0')}`; };
const tcF = t => { const f = P().fps, tot = Math.round(t * f), s = Math.floor(tot / f); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}:${pad2(tot % f)}`; };
function updateTC() { $('#tcPill').textContent = tcF(S.t); }
function updateTransport() {
  $('#btnPlay').replaceChildren(icon(S.playing ? 'pause' : 'play'));
  $('#btnPlay').classList.toggle('on', S.playing);
  $('#btnUndo').disabled = !history.canUndo(); $('#btnRedo').disabled = !history.canRedo();
  $('#btnFit').classList.toggle('on', S.full);
  updateTC();
}
const SUB_TITLE = { layer: 'Move & Transform', style: 'Color & Fill', border: 'Border & Shadow', fx: 'Effects', blend: 'Blending & Opacity', ease: 'Easing', project: 'Project Settings', points: 'Edit Points', draw: 'Drawing' };
const EDIT_TITLE = { text: 'Edit Text', image: 'Edit Image', video: 'Edit Video', audio: 'Edit Audio', shape: 'Edit Shape' };
function updateHeader() {
  const p = P(), L = selLayer();
  if (document.activeElement !== $('#projName')) $('#projName').value = p.name;
  if (document.activeElement !== $('#layerName')) $('#layerName').value = L ? L.name : '';
  $('#topTitle').textContent = S.tab === 'edit' ? (EDIT_TITLE[L?.type] || 'Edit') : SUB_TITLE[S.tab] || '';
  const keyable = L && isSub() && !['project', 'draw'].includes(S.tab) && L.type !== 'audio';
  $('#btnKey').hidden = !keyable; $('#btnPtAdd').hidden = S.tab !== 'points';
  $('#btnKey').classList.toggle('on', !!(keyable && ANIM_PROPS.some(pr => findKey(L, pr, S.t))));
  $('#btnMore').disabled = !L;
}

function toggleKeyAll() {
  const L = selLayer(); if (!L) return toast('Select a layer first');
  const existing = ANIM_PROPS.filter(p => findKey(L, p, S.t));
  if (existing.length) existing.forEach(p => removeKey(L, p, findKey(L, p, S.t).id));
  else ANIM_PROPS.forEach(p => setKey(L, p, S.t, valueAt(L, p, S.t)));
  commit();
}

// ---------------- timeline ----------------
// Alight-style: the playhead is fixed at the horizontal centre of the timeline and the tracks scroll underneath it, so
// scrollLeft == t * pps (t = 0 sits at the centre when scrollLeft is 0). Panning the timeline scrubs; seeking / playback
// scroll it. The virtual canvas extends past the project end (shaded, draggable END marker) and grows while panning.
const tl = $('#tlScroll');
const tlOriginX = () => Math.round(tl.clientWidth / 2); // content x of t = 0
function syncScroll() {
  const x = S.t * S.pps;
  if (x > tl.scrollWidth - tl.clientWidth) roomFor(x, false);
  if (Math.abs(tl.scrollLeft - x) >= 0.5) tl.scrollLeft = x;
}
let syncRaf = 0;
function onTlScroll() {
  if (!P() || G.rendering) return;
  if (S.playing && !(G.g || G.mom || G.pinch)) return; // playback drives the scroll, not the other way round
  const want = S.t * S.pps, dur = P().duration;
  if (Math.abs(tl.scrollLeft - want) < 1) return;
  if (S.t >= dur - 1e-9 && tl.scrollLeft > want) return; // panned past the end: the playhead stays at the end
  S.t = Math.max(0, Math.min(dur, tl.scrollLeft / S.pps));
  updateTC();
  if (!syncRaf) syncRaf = requestAnimationFrame(() => { syncRaf = 0; drawFrame(); updateHeader(); renderPanelIfTime(); });
}
const viewT = () => Math.max(1, tl.clientWidth) / S.pps; // one screen of time
function contentEnd(p = P()) {
  let e = p.duration;
  for (const L of p.layers) { e = Math.max(e, L.end); for (const { k } of allKeys(L)) e = Math.max(e, k.t); }
  return e;
}
const MAX_INNER_PX = 400000;
const majStep = () => (S.pps >= 24 ? 1 : S.pps >= 8 ? 5 : 10);
const minStep = () => (S.pps >= 50 ? 0.1 : S.pps >= 24 ? 0.25 : majStep() / 5);
function addTicks(ruler, from, to) {
  const step = majStep();
  for (let i = Math.ceil(from / step - 1e-6); i * step <= to + 1e-6; i++) {
    const t = i * step; if (t <= (ruler._tickTo ?? -1) + 1e-6) continue;
    ruler.append(h('i', { class: 'maj', style: { left: t * S.pps + 'px' } }, String(Math.round(t)) + 's'));
  }
  ruler._tickTo = Math.max(ruler._tickTo ?? -1, to);
}
// grow the virtual extent (seconds) without re-rendering (so in-flight drags keep their elements)
function setExtent(T) {
  T = Math.min(T, (MAX_INNER_PX - tlOriginX()) / S.pps);
  if (T <= G.extT + 1e-6) return;
  G.extT = T;
  const inner = $('#tlInner'); if (!inner) return;
  inner.style.width = tlOriginX() + T * S.pps + 'px';
  const ruler = inner.querySelector('.tl-ruler'); if (ruler) addTicks(ruler, 0, T);
  G.updBars?.();
}
// make room so scrollLeft can reach x (pan: capped to content end + 4 screens; drag auto-scroll: uncapped)
function roomFor(x, pan) {
  let T = (x + tl.clientWidth - tlOriginX()) / S.pps + 0.25 * viewT();
  if (pan) T = Math.min(T, G.panCapT);
  setExtent(T);
}
function placeEnd() {
  const p = P(), x = p.duration * S.pps;
  const past = $('#tlPast'), rp = $('#tlPastR'), hd = $('#tlEndH');
  if (past) past.style.left = tlOriginX() + x + 'px';
  if (rp) rp.style.left = x + 'px';
  if (hd) hd.style.left = x + 'px';
}
// small per-layer preview (pill thumbnail / media clip frames), cached by layer content
const THUMB = { r: null, cache: new Map() };
function layerThumb(L) {
  if (L.type === 'audio' || L.type === 'adjust') return null;
  const p = P(), key = JSON.stringify([p.w, p.h, L.type, L.shape, L.text, L.solid, L.media, L.draw, L.props, media.has(L.media?.id)]);
  if (THUMB.cache.has(key)) return THUMB.cache.get(key);
  let url = null;
  try {
    const k = 64 / Math.max(p.w, p.h), c = document.createElement('canvas');
    c.width = Math.max(4, Math.round(p.w * k)); c.height = Math.max(4, Math.round(p.h * k));
    THUMB.r = THUMB.r || new Renderer();
    THUMB.r.render({ ...p, bg: '#2b2f42', layers: [{ ...L, effects: [], keys: {}, visible: true, start: 0, end: 1e9, blend: 'normal', shadow: null }] }, 0, c);
    url = c.toDataURL();
  } catch (e) { console.warn(e); }
  if (THUMB.cache.size > 300) THUMB.cache.clear();
  THUMB.cache.set(key, url);
  return url;
}
const TYPE_ICON = { shape: 'shapes', text: 'text', solid: 'solid', image: 'image', video: 'media', adjust: 'adjust', draw: 'freehand', audio: 'audio' };
function renderTimeline() {
  const p = P(); if (!p) return;
  const ox = tlOriginX();
  if (S.autoFit && tl.clientWidth > 0) S.pps = Math.max(12, (tl.clientWidth / 2 - 24) / p.duration);
  const vt = viewT(), ce = contentEnd(p);
  G.panCapT = ce + 4 * vt;
  G.extT = Math.max(ce + 1.5 * vt, G.extT || 0);
  G.extT = Math.min(G.extT, (MAX_INNER_PX - ox) / S.pps);
  const inner = h('div', { id: 'tlInner', style: { width: ox + G.extT * S.pps + 'px', '--ox': ox + 'px', '--rb': '0px' } });
  // head: ruler (minor ticks as a gradient, major ticks as elements) + the band the timecode pill sits in
  const mpx = minStep() * S.pps;
  const ruler = h('div', { class: 'tl-ruler', 'data-testid': 'ruler', style: { backgroundSize: `${mpx}px 6px` } });
  ruler.append(h('div', { class: 'tl-past r', id: 'tlPastR' }));
  addTicks(ruler, 0, G.extT);
  const endH = h('div', { class: 'tl-end-h', id: 'tlEndH', 'data-testid': 'end-marker', title: 'Drag to change the project duration' }, h('span', {}, 'END'));
  bindEnd(endH); ruler.append(endH);
  inner.append(h('div', { class: 'tl-head' }, ruler));
  bindScrub(ruler);
  for (const L of p.layers) {
    const sel = L.id === S.sel, th = layerThumb(L);
    const label = h('div', { class: 'tl-label', onclick: () => selectLayer(L.id) },
      h('button', { class: 'vis' + (L.visible ? '' : ' off'), title: 'Visibility', 'data-testid': 'vis', onclick: ev => { ev.stopPropagation(); L.visible = !L.visible; commit(); } }, icon(L.visible ? 'eye' : 'eyeoff')),
      th ? h('img', { class: 'th', src: th, alt: '' }) : icon(TYPE_ICON[L.type] || 'layer', 'th ti'));
    const track = h('div', { class: 'tl-track' });
    track.addEventListener('click', e => { if (e.target === track && S.sel) deselect(); });
    const strip = (L.type === 'image' || L.type === 'video') && th ? { backgroundImage: `url(${th})` } : {};
    const clip = h('div', { class: 'clip t-' + L.type + (sel ? ' sel' : '') + (L.visible ? '' : ' hidden') + (strip.backgroundImage ? ' strip' : ''), style: { left: L.start * S.pps + 'px', width: Math.max(4, (L.end - L.start) * S.pps) + 'px', ...strip } },
      h('b', { class: 'trim l' }), h('span', { class: 'cn' }, strip.backgroundImage ? '' : L.name), h('b', { class: 'trim r' }));
    bindClip(clip, L);
    track.append(clip);
    // merged keyframe diamonds (one per time)
    const times = new Map();
    for (const { prop, k } of allKeys(L)) { const key = k.t.toFixed(3); if (!times.has(key)) times.set(key, []); times.get(key).push({ prop, k }); }
    for (const [tk, list] of times) {
      const on = list.some(x => S.selKeys.has(x.k.id));
      const d = h('i', { class: 'kf' + (on ? ' on' : ''), style: { left: (+tk) * S.pps + 'px' }, 'data-testid': 'kf' });
      bindKey(d, L, list); track.append(d);
    }
    inner.append(h('div', { class: 'tl-row' + (sel ? ' sel' : ''), 'data-layer': L.id }, label, track));
  }
  if (!p.layers.length) inner.append(h('div', { class: 'tl-empty' }, 'Tap + to add a layer'));
  // empty space below the last track (pannable)
  inner.append(h('div', { class: 'tl-row tl-pad', 'data-testid': 'tl-pad', style: { height: Math.max(44, Math.round(tl.clientHeight * 0.45)) + 'px' } },
    h('div', { class: 'tl-label pad' }), h('div', { class: 'tl-track pad', onclick: () => S.sel && deselect() })));
  inner.append(h('div', { class: 'tl-past', id: 'tlPast' }));
  const sl = tl.scrollLeft, st = tl.scrollTop;
  G.rendering = true;
  tl.replaceChildren(inner);
  const want = S.t * S.pps;
  if (want > tl.scrollWidth - tl.clientWidth) roomFor(want, false);
  // keep a pan that is parked past the project end; otherwise the playhead time decides the scroll position
  tl.scrollLeft = S.t >= p.duration - 1e-9 && sl > want && !G.zoomed ? sl : want;
  tl.scrollTop = st;
  if (S.sel && G.lastSel !== S.sel) { const row = inner.querySelector(`.tl-row[data-layer="${S.sel}"]`); if (row) tl.scrollTop = row.offsetTop - HEAD_H; }
  G.lastSel = S.sel; G.zoomed = false;
  G.rendering = false;
  placeEnd(); G.updBars?.();
}
// desktop mouse on the ruler: drag to scrub (= pan, the playhead is fixed)
function bindScrub(el) {
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return; // touch/pen: handled by the timeline gesture controller below
    el.setPointerCapture(e.pointerId); if (S.playing) togglePlay(false);
    const x0 = e.clientX, sl0 = tl.scrollLeft;
    const mv = ev => panX(sl0 - (ev.clientX - x0));
    const up = () => { releaseRb(); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
// Mouse: drag immediately (desktop). Touch/pen: the spec is stored on the element and driven by the gesture controller,
// which only starts a drag after a long press or when the item is already selected.
function bindDrag(el, spec) {
  const { onStart, onMove, onEnd } = spec;
  el._drag = spec;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    e.stopPropagation(); el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, sl0 = tl.scrollLeft; let lx = x0, moved = false; const ctx = onStart?.(e) || {};
    const apply = ev => { const dx = lx - x0 + tl.scrollLeft - sl0; if (Math.abs(dx) > 3) moved = true; if (moved) onMove(dx / S.pps, ctx, ev); };
    const mv = ev => { lx = ev.clientX; apply(ev); if (moved) autoScroll(lx, () => apply(ev)); };
    const up = ev => { stopAutoScroll(); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd?.(moved, ctx, ev); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}


// ---------------- timeline touch gestures ----------------
// One controller for every touch/pen pointer on the timeline (touch-action: none, so the browser never scrolls it):
//  * swipe anywhere (ruler, pills, clips, keyframes, empty space below / past the end) -> pan x/y with axis lock + momentum;
//    horizontal panning scrubs (fixed centre playhead); the virtual extent grows to the right and rubber-bands left of 0
//  * long press (300ms, <8px) on a clip / trim handle / keyframe -> grab it (visual pop + vibrate), then drag;
//    dragging near the left/right edge auto-scrolls the timeline (clips/keys can go past the project end)
//  * trim handles of the selected clip and the END marker drag right away; clips and keyframes always need the long press
//  * while a layer is selected, panning is horizontal only (tap empty track space to deselect and unlock vertical)
//  * tap -> select (clips/keys/pills) or deselect (empty track); two fingers anywhere -> pinch-zoom time around the playhead
const SLOP = 8, HOLD_MS = 300, ZMIN = 12, ZMAX = 800;
const G = { ptrs: new Map(), g: null, pinch: null, mom: 0, raf: 0, noClick: false, extT: 0, panCapT: 0, rb: 0, lastSel: null, rendering: false, zoomed: false };
function zoomTo(pps) {
  pps = Math.max(ZMIN, Math.min(ZMAX, pps));
  S.autoFit = false; S.pps = pps; G.zoomed = true; renderTimeline();
}
function stopMomentum() { cancelAnimationFrame(G.mom); G.mom = 0; }
// rubber band left of t=0: the time content (ruler, tracks, past-end shade) is translated by --rb with resistance
function setRb(v) { G.rb = v; const inner = $('#tlInner'); if (inner) { inner.classList.remove('rb-back'); inner.classList.toggle('rb', v > 0); inner.style.setProperty('--rb', v + 'px'); } }
function releaseRb() {
  if (!G.rb) return; const inner = $('#tlInner'); G.rb = 0;
  if (!inner) return; inner.classList.add('rb-back'); inner.style.setProperty('--rb', '0px');
  setTimeout(() => { if (!G.rb) inner.classList.remove('rb-back', 'rb'); }, 380);
}
function panX(x) {
  if (x < 0) { tl.scrollLeft = 0; const d = -x; setRb(Math.min(120, d * 0.5 / (1 + d / 400))); return; }
  if (G.rb) setRb(0);
  if (x > tl.scrollWidth - tl.clientWidth) roomFor(x, true);
  tl.scrollLeft = x;
}
// edge auto-scroll while dragging a clip / trim / keyframe / END marker
const AS = { raf: 0, x: 0, fn: null, ts: 0 };
function edgeK(x) {
  const r = tl.getBoundingClientRect(), E = Math.min(56, r.width * 0.12), lo = r.left + PILL_W, hi = r.right;
  if (x > hi - E) return Math.min(1, (x - (hi - E)) / E);
  if (x < lo + E) return -Math.min(1, (lo + E - x) / E);
  return 0;
}
function autoScroll(x, fn) { AS.x = x; AS.fn = fn; if (!AS.raf) { AS.ts = performance.now(); AS.raf = requestAnimationFrame(asStep); } }
function asStep(ts) {
  AS.raf = 0; if (!AS.fn) return;
  const k = edgeK(AS.x); if (!k) return;
  const dt = Math.min(0.1, Math.max(0, (ts - AS.ts) / 1000)); AS.ts = ts;
  const v = Math.sign(k) * (180 + 1300 * k * k) * dt; // time-based: 180..1480 px/s deeper into the edge zone
  const before = tl.scrollLeft, target = Math.max(0, before + v);
  if (v > 0 && target > tl.scrollWidth - tl.clientWidth) roomFor(target, false);
  tl.scrollLeft = target;
  if (tl.scrollLeft !== before) AS.fn();
  AS.raf = requestAnimationFrame(asStep);
}
function stopAutoScroll() { cancelAnimationFrame(AS.raf); AS.raf = 0; AS.fn = null; }
function startMomentum(g) {
  const s = g.samples, b = s[s.length - 1], now = performance.now();
  const a = s.find(q => b.t - q.t <= 100) || s[0], dt = b.t - a.t;
  if (s.length < 2 || dt < 8 || now - b.t > 80) return;
  let vx = g.axis === 'y' ? 0 : -(b.x - a.x) / dt * 16.67, vy = g.axis === 'x' ? 0 : -(b.y - a.y) / dt * 16.67; // px per frame
  let px = tl.scrollLeft, py = tl.scrollTop, last = now;
  const step = t => {
    const f = Math.min(4, (t - last) / 16.67); last = t;
    const mx = tl.scrollWidth - tl.clientWidth, my = tl.scrollHeight - tl.clientHeight;
    px = Math.max(0, Math.min(mx, px + vx * f)); py = Math.max(0, Math.min(my, py + vy * f));
    tl.scrollLeft = px; tl.scrollTop = py;
    if (px <= 0 || px >= mx) vx = 0; if (py <= 0 || py >= my) vy = 0;
    const k = Math.pow(0.95, f); vx *= k; vy *= k;
    G.mom = Math.hypot(vx, vy) > 0.25 ? requestAnimationFrame(step) : 0;
  };
  G.mom = requestAnimationFrame(step);
}
function grab(g, x) {
  g.mode = 'drag'; g.gx = x; g.gsl = tl.scrollLeft; g.ctx = g.spec.onStart?.({ target: g.target, clientX: x }) || {};
  g.item.classList.add('grabbed'); tl.classList.add('grabbing');
  try { navigator.vibrate?.(12); } catch {}
}
function endDrag(g, ev) {
  stopAutoScroll(); g.item.classList.remove('grabbed'); tl.classList.remove('grabbing');
  g.spec.onEnd?.(g.moved, g.ctx, ev);
}
function pinchState() {
  const [a, b] = [...G.ptrs.values()];
  return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}
function bindTimelineGestures() {
  tl.addEventListener('scroll', onTlScroll, { passive: true });
  tl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault(); stopMomentum(); G.noClick = false;
    if (S.playing) togglePlay(false);
    try { tl.setPointerCapture(e.pointerId); } catch {}
    G.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (G.ptrs.size === 2) { // second finger -> pinch; abandon whatever the first finger was doing
      const g = G.g; G.g = null;
      if (g) { clearTimeout(g.hold); if (g.mode === 'drag') endDrag(g, e); }
      G.pinch = { ...pinchState(), pps0: S.pps, st0: tl.scrollTop };
      G.noClick = true; return;
    }
    if (G.ptrs.size > 2 || G.pinch) return;
    const hit = e.target.closest('.kf, .clip, .tl-end-h');
    const g = G.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sl: tl.scrollLeft, st: tl.scrollTop, mode: 'pending', target: e.target,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }], moved: false };
    if (hit?._drag) {
      g.item = hit; g.spec = hit._drag; g.isKey = hit.classList.contains('kf'); g.isTrim = e.target.classList.contains('trim') || hit.classList.contains('tl-end-h');
      // only trim handles of the selected clip and the END marker drag straight away; moving a clip or a keyframe always needs a long press
      g.armed = (g.isTrim && hit.classList.contains('sel')) || hit.classList.contains('tl-end-h');
      g.hold = setTimeout(() => { if (G.g === g && g.mode === 'pending') grab(g, g.lx ?? g.x0); }, HOLD_MS);
    }
  });
  tl.addEventListener('pointermove', e => {
    const p = G.ptrs.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (G.pinch) {
      if (G.ptrs.size < 2 || G.raf) return;
      G.raf = requestAnimationFrame(() => {
        G.raf = 0; if (!G.pinch || G.ptrs.size < 2) return;
        const ps = pinchState(), pz = G.pinch;
        const pps = Math.max(ZMIN, Math.min(ZMAX, pz.pps0 * ps.d / pz.d));
        if (Math.abs(pps - S.pps) > 0.01) zoomTo(pps);
        if (!S.sel) tl.scrollTop = pz.st0 - (ps.my - pz.my);
      });
      return;
    }
    const g = G.g; if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, now = performance.now();
    g.lx = e.clientX; g.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 150) g.samples.shift();
    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimeout(g.hold);
      if (g.item && g.armed) { grab(g, g.x0); }
      else { g.mode = 'pan'; G.noClick = true; const ax = Math.abs(dx), ay = Math.abs(dy); g.axis = S.sel ? 'x' : ax > 2 * ay ? 'x' : ay > 2 * ax ? 'y' : 'xy'; } // a selection locks panning to horizontal (Alight)
    }
    if (g.mode === 'pan') {
      if (g.axis !== 'y') panX(g.sl - dx);
      if (g.axis !== 'x') tl.scrollTop = g.st - dy;
    } else if (g.mode === 'drag') {
      const apply = () => { const ddx = g.lx - g.gx + tl.scrollLeft - g.gsl; if (Math.abs(ddx) > 2) g.moved = true; if (g.moved) g.spec.onMove(ddx / S.pps, g.ctx, e); };
      apply(); if (g.moved) autoScroll(e.clientX, apply);
    }
  });
  const up = e => {
    if (!G.ptrs.has(e.pointerId)) return;
    G.ptrs.delete(e.pointerId);
    if (G.pinch) { if (G.ptrs.size < 2) { G.pinch = null; renderTimeline(); } return; }
    const g = G.g; if (!g || g.id !== e.pointerId) return;
    G.g = null; clearTimeout(g.hold);
    if (g.mode === 'drag') { G.noClick = true; endDrag(g, e); }
    else if (g.mode === 'pan') { if (G.rb) { releaseRb(); if (g.axis !== 'x') startMomentum({ ...g, axis: 'y' }); } else startMomentum(g); }
    else if (g.mode === 'pending' && g.item && e.type === 'pointerup') { G.noClick = true; g.spec.onEnd?.(false, g.spec.onStart?.({ target: g.target, clientX: e.clientX }) || {}, e); }
  };
  tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', up);
  tl.addEventListener('lostpointercapture', up);
  // a pan / drag / pinch must not end in a click (deselect on empty track, select on a pill)
  tl.addEventListener('click', e => { if (G.noClick) { G.noClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  tl.addEventListener('contextmenu', e => e.preventDefault());
  // desktop: ctrl/trackpad-pinch wheel zooms time around the playhead
  tl.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(S.pps * Math.exp(-e.deltaY * 0.01)); }, { passive: false });
  // scroll indicators (iOS hides native ones on a JS-panned box)
  const bx = h('div', { class: 'tl-sb x' }, h('i')), by = h('div', { class: 'tl-sb y' }, h('i'));
  $('#timeline').append(bx, by);
  let hideT;
  const upd = () => {
    const W = tl.scrollWidth, cw = tl.clientWidth, H = tl.scrollHeight, ch = tl.clientHeight;
    bx.hidden = W <= cw + 1; by.hidden = H <= ch + 1;
    if (!bx.hidden) { const w = Math.max(24, cw * cw / W); bx.firstChild.style.cssText = `width:${w}px;transform:translateX(${(cw - w) * tl.scrollLeft / (W - cw)}px)`; }
    if (!by.hidden) { const hh = Math.max(16, ch * ch / H); by.firstChild.style.cssText = `height:${hh}px;transform:translateY(${(ch - hh) * tl.scrollTop / (H - ch)}px)`; }
  };
  tl.addEventListener('scroll', () => { upd(); if (!(G.g || G.mom || G.pinch || AS.raf)) return; $('#timeline').classList.add('scrolling'); clearTimeout(hideT); hideT = setTimeout(() => $('#timeline').classList.remove('scrolling'), 700); }, { passive: true });
  new ResizeObserver(upd).observe(tl);
  G.updBars = upd;
}
// Lock the app shell: nothing outside real scroll areas may scroll, rubber-band or page-zoom.
function lockPage() {
  const scrollable = t => t.closest?.('#panelBody, .tiles, .sh-body, .h-list, dialog, textarea, select, input');
  document.addEventListener('touchmove', e => { if (e.cancelable && (e.touches.length > 1 || !scrollable(e.target))) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
}
const snapT = t => { const f = P().fps; return Math.round(t * f) / f; };
function bindClip(clip, L) {
  bindDrag(clip, {
    onStart: e => ({ mode: e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm', s0: L.start, e0: L.end, snap: clone(L.keys) }),
    onMove: (dt, c) => {
      // start never goes below 0; the end may run past the project duration (not rendered there, like Alight)
      if (c.mode === 'l') L.start = Math.min(L.end - 0.05, Math.max(0, snapT(c.s0 + dt)));
      else if (c.mode === 'r') L.end = Math.max(L.start + 0.05, snapT(c.e0 + dt));
      else { const d = Math.max(-c.s0, snapT(dt)); L.keys = clone(c.snap); L.start = c.s0; L.end = c.e0; shiftLayer(L, d); }
      clip.style.left = L.start * S.pps + 'px'; clip.style.width = (L.end - L.start) * S.pps + 'px';
      setExtent(L.end + viewT()); drawFrame();
    },
    onEnd: moved => { if (moved) commit(); else selectLayer(L.id); },
  });
}
function bindKey(d, L, list) {
  bindDrag(d, {
    onStart: () => ({ t0: list[0].k.t }),
    onMove: (dt, c) => { const nt = Math.max(0, snapT(c.t0 + dt)); for (const { k } of list) k.t = nt; d.style.left = nt * S.pps + 'px'; setExtent(nt + viewT()); },
    onEnd: (moved, c, ev) => {
      S.sel = L.id;
      if (moved) { for (const p of new Set(list.map(x => x.prop))) L.keys[p].sort((a, b) => a.t - b.t); }
      else { if (!ev.shiftKey && !ev.metaKey) S.selKeys.clear(); list.forEach(x => S.selKeys.add(x.k.id)); S.t = Math.min(P().duration, list[0].k.t); if (!['layer', 'ease'].includes(S.tab)) S.tab = 'ease'; }
      commit();
    },
  });
}

// END marker: drag to change the project duration (frame-snapped, 0.5s .. 600s)
function bindEnd(el) {
  bindDrag(el, {
    onStart: () => ({ d0: P().duration }),
    onMove: (dt, c) => {
      P().duration = Math.max(0.5, Math.min(600, snapT(c.d0 + dt)));
      placeEnd(); setExtent(P().duration + viewT());
    },
    onEnd: moved => { if (!moved) return; S.autoFit = false; if (S.t > P().duration) S.t = P().duration; commit(); },
  });
}

// ---------------- bottom panel: tile grid (layer selected) / property sub-panels ----------------
function liveSet(fn) { return v => { fn(v); drawFrame(); }; }
function renderPanel() {
  const panel = $('#panel'); if (!P()) return;
  const m = mode(), L = selLayer();
  const keepScroll = sel => { const el = panel.querySelector(sel); return el ? el.scrollTop : 0; };
  if (m === 'none') { panel.replaceChildren(); return; }
  if (m === 'sel') { const st = keepScroll('.tiles'); panel.replaceChildren(tileGrid(L)); panel.querySelector('.tiles').scrollTop = st; return; }
  const st = keepScroll('#panelBody');
  const need = msg => h('div', { class: 'hint' }, msg);
  let content, left = [], right = null;
  switch (S.tab) {
    case 'layer': content = L ? panelLayer(L) : need('Select a layer.'); break;
    case 'style': content = L ? panelStyle(L) : need('Select a layer.'); break;
    case 'edit': content = L ? panelEdit(L) : need('Select a layer.'); break;
    case 'border': content = L ? panelBorder(L) : need('Select a layer.'); break;
    case 'fx': content = L ? panelFx(L) : need('Select a layer.'); break;
    case 'blend': content = L ? panelBlend(L) : need('Select a layer.'); break;
    case 'ease': content = panelEase(L); break;
    case 'project': content = panelProject(); break;
    case 'points': ({ content, left } = panelPoints(L)); break;
    case 'draw': ({ content, right } = panelDraw(L)); break;
    default: content = h('div');
  }
  const body = h('div', { id: 'panelBody', class: 'sub-body' + (S.tab === 'points' || S.tab === 'draw' ? ' tool' : '') }, content);
  panel.replaceChildren(h('div', { class: 'sub' },
    h('div', { class: 'sub-l' }, h('button', { class: 'ib', title: 'Back', 'data-testid': 'panel-back', onclick: goBack }, icon('chevl')), ...left),
    body, right));
  body.scrollTop = st;
}

function tileGrid(L) {
  const T = (id, ic, label, fn, cls = '') => h('button', { class: 'tile ' + cls, 'data-testid': 'tab-' + id, title: label || id, onclick: fn }, icon(ic), label ? h('span', {}, label) : null);
  const open = id => () => openSub(id);
  const hasSound = L.type === 'video' || L.type === 'audio', muted = hasSound && L.media.volume === 0;
  const visual = L.type !== 'audio', drawable = !['audio', 'adjust'].includes(L.type);
  const editIc = { text: 'edittext', image: 'editmedia', video: 'editmedia', audio: 'audio', draw: 'freehand', solid: 'fill', adjust: 'effects' }[L.type] || 'editshape';
  const editLabel = { text: 'Edit Text', image: 'Edit Image', video: 'Edit Video', audio: 'Edit Audio', draw: 'Edit Drawing', solid: 'Edit Solid', adjust: 'Edit Effects' }[L.type] || 'Edit Shape';
  return h('div', { class: 'tiles' },
    h('div', { class: 'trow small' },
      T('speed', 'speed', '', soon('Speed'), 'sm corner'),
      h('div', { class: 'tgroup' }, T('trim-start', 'splitl', '', () => splitAt(L, 'start'), 'sm'), T('split', 'split', '', () => splitAt(L, 'split'), 'sm'), T('trim-end', 'splitr', '', () => splitAt(L, 'end'), 'sm')),
      T('mute', muted ? 'mute' : hasSound ? 'sound' : 'mute', '', () => { if (!hasSound) return toast('This layer has no sound'); L.media.volume = muted ? 1 : 0; commit(); }, 'sm corner' + (hasSound ? '' : ' off'))),
    h('div', { class: 'trow three' },
      T('style', 'fill', 'Color & Fill', visual ? open('style') : soon(), visual ? '' : 'off'),
      T('border', 'border', 'Border & Shadow', drawable ? open('border') : soon(), drawable ? '' : 'off'),
      T('blend', 'blend', 'Blending & Opacity', visual ? open('blend') : soon(), visual ? '' : 'off')),
    h('div', { class: 'trow four' },
      T('layer', 'move', 'Move & Transform', open('layer'), visual ? '' : 'off'),
      T('edit', editIc, editLabel, open('edit')),
      T('presets', 'presets', 'Presets', soon('Presets')),
      T('fx', 'effects', 'Effects', open('fx'), visual ? '' : 'off')),
    h('div', { class: 'trow four' },
      T('ease', 'ease', 'Easing', open('ease')),
      T('up', 'up', 'Move Up', () => moveLayer(L, -1)),
      T('down', 'down', 'Move Down', () => moveLayer(L, 1)),
      T('lock', L.locked ? 'lock' : 'unlock', L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; commit(); })));
}

function propKeyState(L, prop) { return findKey(L, prop, S.t) ? 2 : hasKeys(L, prop) ? 1 : 0; }

function panelLayer(L) {
  const out = h('div', {});
  const rows = ANIM_PROPS.map(prop => {
    const m = PROP_META[prop];
    const isPos = prop === 'x' || prop === 'y';
    return slider({
      label: m.label, value: valueAt(L, prop, S.t), min: isPos ? -P()[prop === 'x' ? 'w' : 'h'] * 0.5 : m.min, max: isPos ? P()[prop === 'x' ? 'w' : 'h'] * 1.5 : m.max, step: m.step,
      testid: 'prop-' + prop,
      onInput: liveSet(v => writeProp(L, prop, S.t, v)), onChange: () => { commit({ silent: true }); renderTimeline(); updateHeader(); },
      key: { state: propKeyState(L, prop), toggle: () => { const k = findKey(L, prop, S.t); if (k) removeKey(L, prop, k.id); else setKey(L, prop, S.t, valueAt(L, prop, S.t)); commit(); } },
    });
  });
  out.append(section('Transform  ·  ◆ = keyframe at playhead', ...rows));
  out.append(section('Timing',
    slider({ label: 'In', value: L.start, min: 0, max: Math.max(P().duration, L.end), step: 0.01, onInput: liveSet(v => { L.start = Math.min(v, L.end - 0.05); }), onChange: () => commit() }),
    slider({ label: 'Out', value: L.end, min: 0, max: Math.max(P().duration, L.end), step: 0.01, onInput: liveSet(v => { L.end = Math.max(v, L.start + 0.05); }), onChange: () => commit() })));
  const act = (ic, label, fn) => h('button', { class: 'act', onclick: fn }, icon(ic), label);
  out.append(h('div', { class: 'acts' },
    act('center', 'Center', () => { writeProp(L, 'x', S.t, P().w / 2); writeProp(L, 'y', S.t, P().h / 2); commit(); }),
    act('up', 'Up', () => moveLayer(L, -1)), act('down', 'Down', () => moveLayer(L, 1)),
    act(L.locked ? 'lock' : 'unlock', L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; commit(); })));
  return out;
}

const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'ring', 'line', 'cross', 'arrow', 'heart', 'pie', 'half', 'trapezoid', 'flower'];
function fieldMakers(L) {
  const C = (label, obj, k) => color({ label, value: obj[k], onInput: liveSet(v => (obj[k] = v)), onChange: v => { obj[k] = v; commit(); } });
  const N = (label, obj, k, min, max, step = 1, tid) => slider({ label, value: obj[k], min, max, step, testid: tid, onInput: liveSet(v => (obj[k] = v)), onChange: () => { commit({ silent: true }); renderTimeline(); } });
  const T = (label, obj, k) => toggle({ label, value: obj[k], onChange: v => { obj[k] = v; commit(); } });
  return { C, N, T };
}
function panelStyle(L) {
  const out = h('div', {}), { C, N, T } = fieldMakers(L);
  if (L.type === 'shape') {
    const s = L.shape;
    out.append(section('Fill', T('Fill', s, 'fillOn'), C('Color', s, 'fill'), T('Gradient', s, 'gradient'), s.gradient ? C('Color 2', s, 'fill2') : null, s.gradient ? N('Angle', s, 'gradAngle', 0, 360) : null));
  } else if (L.type === 'text') out.append(section('Color', C('Fill', L.text, 'fill')));
  else if (L.type === 'solid') {
    const s = L.solid;
    out.append(section('Solid', C('Color', s, 'color'), T('Gradient', s, 'gradient'), s.gradient ? C('Color 2', s, 'fill2') : null, s.gradient ? N('Angle', s, 'gradAngle', 0, 360) : null));
  } else if (L.type === 'draw') out.append(h('div', { class: 'hint' }, 'Drawing colours are picked per stroke in Edit Drawing.'), h('button', { class: 'act', onclick: () => openSub('draw') }, icon('freehand'), 'Edit Drawing'));
  else if (L.type === 'image' || L.type === 'video') out.append(h('div', { class: 'hint' }, 'Media layers keep their own colours — try Effects › Color Adjust.'));
  else out.append(h('div', { class: 'hint' }, 'Adjustment layers have no fill — add effects; they apply to everything below.'));
  return out;
}
function panelEdit(L) {
  const out = h('div', {}), { N } = fieldMakers(L);
  const big = Math.max(P().w, P().h) * 1.5;
  if (L.type === 'shape') {
    const s = L.shape;
    out.append(section('Shape', chips(SHAPE_KINDS.map(k => [k, k]), s.kind, v => { s.kind = v; commit(); }),
      N('Width', s, 'w', 1, big), N('Height', s, 'h', 1, big),
      s.kind === 'rect' ? N('Corner', s, 'radius', 0, 600) : null,
      s.kind === 'star' || s.kind === 'polygon' ? N('Points', s, 'points', 3, 24) : null,
      s.kind === 'star' ? N('Inner', s, 'inner', 0.05, 1, 0.01) : null,
      s.kind === 'ring' ? N('Thickness', s, 'thickness', 0.02, 1, 0.01) : null),
      h('div', { class: 'acts' }, h('button', { class: 'act', 'data-testid': 'to-points', onclick: () => {
        const n = s.kind === 'ellipse' || s.kind === 'ring' ? 24 : 16;
        s.pts = shapePoints(s, n).map(p => p.map(v => +v.toFixed(1))); s.kind = 'path'; s.closed = true; S.tab = 'points'; commit();
      } }, icon('node'), 'Convert to Points')));
  } else if (L.type === 'text') {
    const t = L.text;
    const ta = h('textarea', { class: 'txt', rows: 2, 'data-testid': 'text-content' }, t.content);
    ta.addEventListener('input', () => { t.content = ta.value; drawFrame(); });
    ta.addEventListener('change', () => { L.name = t.content.split('\n')[0].slice(0, 18) || 'Text'; commit(); });
    out.append(section('Text', ta,
      select({ label: 'Font', value: t.font, options: Object.keys(FONTS).map(f => [f, f]), onChange: v => { t.font = v; commit(); } }),
      N('Size', t, 'size', 8, 800), N('Weight', t, 'weight', 100, 900, 100), N('Tracking', t, 'tracking', -0.2, 1, 0.01), N('Line Ht', t, 'lineHeight', 0.6, 3, 0.05),
      chips([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], t.align, v => { t.align = v; commit(); }),
      toggle({ label: 'Italic', value: t.italic, onChange: v => { t.italic = v; commit(); } })));
  } else if (L.type === 'image' || L.type === 'video') {
    const m = L.media;
    out.append(section('Media', h('div', { class: 'hint' }, `${m.w}×${m.h} source`),
      h('div', { class: 'acts' },
        h('button', { class: 'act', onclick: () => { writeProp(L, 'scale', S.t, +Math.min(P().w / m.w, P().h / m.h).toFixed(3)); commit(); } }, 'Fit'),
        h('button', { class: 'act', onclick: () => { writeProp(L, 'scale', S.t, +Math.max(P().w / m.w, P().h / m.h).toFixed(3)); commit(); } }, 'Fill')),
      L.type === 'video' ? N('Volume', m, 'volume', 0, 1, 0.01) : null,
      L.type === 'video' ? N('Offset s', m, 'offset', 0, 600, 0.05) : null));
  } else if (L.type === 'audio') {
    const m = L.media;
    out.append(section('Audio', h('div', { class: 'hint' }, m.duration ? `Source ${tc(m.duration)}` : ''), N('Volume', m, 'volume', 0, 1, 0.01, 'audio-volume'), N('Offset s', m, 'offset', 0, 600, 0.05)));
  }
  return out;
}
function panelBorder(L) {
  const out = h('div', {});
  const C = (label, obj, k) => color({ label, value: obj[k], onInput: liveSet(v => (obj[k] = v)), onChange: v => { obj[k] = v; commit(); } });
  const N = (label, obj, k, min, max, step = 1, tid) => slider({ label, value: obj[k], min, max, step, testid: tid, onInput: liveSet(v => (obj[k] = v)), onChange: () => commit({ silent: true }) });
  if (L.type === 'shape') out.append(section('Border', N('Width', L.shape, 'strokeW', 0, 120, 1, 'border-width'), C('Color', L.shape, 'stroke')));
  else if (L.type === 'text') out.append(section('Border', N('Width', L.text, 'strokeW', 0, 60, 1, 'border-width'), C('Color', L.text, 'stroke')));
  if (L.type === 'adjust') { out.append(h('div', { class: 'hint' }, 'Adjustment layers have no border or shadow.')); return out; }
  const sh = L.shadow || (L.shadow = { on: false, color: '#000000', blur: 24, dx: 0, dy: 16, alpha: 0.6 });
  out.append(section('Shadow', toggle({ label: 'Shadow', value: sh.on, testid: 'shadow-on', onChange: v => { sh.on = v; commit(); } }),
    sh.on ? C('Color', sh, 'color') : null, sh.on ? N('Blur', sh, 'blur', 0, 200) : null,
    sh.on ? N('Offset X', sh, 'dx', -200, 200) : null, sh.on ? N('Offset Y', sh, 'dy', -200, 200) : null,
    sh.on ? N('Opacity', sh, 'alpha', 0, 1, 0.01) : null));
  return out;
}

function panelFx(L) {
  const out = h('div', {});
  const list = h('div', { class: 'fxlist' });
  L.effects.forEach((f, i) => {
    const def = EFFECTS[f.type]; if (!def) return;
    const params = Object.entries(def.params).map(([k, d]) => {
      if (d[0] === 'color') return color({ label: d[2], value: f.params[k], onInput: liveSet(v => (f.params[k] = v)), onChange: v => { f.params[k] = v; commit({ silent: true }); } });
      if (d[0] === 'bool') return toggle({ label: d[2], value: f.params[k], onChange: v => { f.params[k] = v; commit({ silent: true }); drawFrame(); } });
      if (d[0] === 'select') return select({ label: d[2], value: f.params[k], options: d[3].map(o => [o, o]), onChange: v => { f.params[k] = v; commit({ silent: true }); drawFrame(); } });
      return slider({ label: d[3], value: f.params[k], min: d[0], max: d[1], step: (d[1] - d[0]) > 20 ? 1 : 0.01, onInput: liveSet(v => (f.params[k] = v)), onChange: () => commit({ silent: true }) });
    });
    list.append(h('div', { class: 'fx' + (f.on ? '' : ' off'), 'data-testid': 'fx-' + f.type },
      h('div', { class: 'fx-h' },
        h('button', { class: 'tog sm' + (f.on ? ' on' : ''), onclick: () => { f.on = !f.on; commit(); } }, h('i')),
        h('b', {}, def.name), h('em', {}, def.cat),
        h('button', { class: 'mini', title: 'Move up', onclick: () => { if (i > 0) { L.effects.splice(i, 1); L.effects.splice(i - 1, 0, f); commit(); } } }, icon('up')),
        h('button', { class: 'mini', title: 'Remove', onclick: () => { L.effects.splice(i, 1); commit(); } }, icon('trash'))),
      ...params));
  });
  if (L.effects.length) out.append(section(`Stack (${L.effects.length}) · top → bottom`, list));
  const cats = ['All', ...new Set(Object.values(EFFECTS).map(e => e.cat))];
  out.append(section('Add Effect', chips(cats.map(c => [c, c]), S.fxCat, v => { S.fxCat = v; renderPanel(); }, 'sm'),
    h('div', { class: 'grid fxgrid' }, Object.entries(EFFECTS).filter(([, d]) => S.fxCat === 'All' || d.cat === S.fxCat).map(([k, d]) =>
      h('button', { class: 'fx-add', 'data-testid': 'addfx-' + k, onclick: () => { L.effects.push(makeEffect(k)); commit(); } }, h('b', {}, d.name), h('em', {}, d.cat))))));
  return out;
}


function panelBlend(L) {
  return h('div', {},
    slider({ label: 'Opacity', value: valueAt(L, 'opacity', S.t), min: 0, max: 1, step: 0.01, testid: 'opacity', onInput: liveSet(v => writeProp(L, 'opacity', S.t, v)), onChange: () => commit({ silent: true }) }),
    section('Blend Mode', chips(BLEND_MODES.map(([id, label]) => [id, label, 'blend-' + id]), L.blend, v => { L.blend = v; commit(); }, 'blend')));
}

// ---- Edit Points (vector path): trackpad cursor + tap to place, or tap / drag directly on the preview ----
function updateCursorBoxes() {
  const c = S.cursor; if (!c) return;
  const x = $('[data-testid=cursor-x]'), y = $('[data-testid=cursor-y]');
  if (x && document.activeElement !== x) x.value = c[0].toFixed(1);
  if (y && document.activeElement !== y) y.value = c[1].toFixed(1);
}
function placePoint() {
  const L = selLayer(); if (!L || L.type !== 'shape' || L.shape.kind !== 'path') return;
  const c = S.cursor || [P().w / 2, P().h / 2];
  L.shape.pts.push(toLocal(L, c[0], c[1]).map(v => +v.toFixed(1))); commit();
}
function panelPoints(L) {
  if (!L || L.type !== 'shape' || L.shape.kind !== 'path') return { content: h('div', { class: 'hint' }, 'Select a vector shape.'), left: [] };
  const c = S.cursor || (S.cursor = [P().w / 2, P().h / 2]);
  const box = (axis, i) => h('label', { class: 'pt-box' }, h('input', { type: 'number', step: 0.1, value: c[i].toFixed(1), 'data-testid': 'cursor-' + axis, inputmode: 'decimal',
    onchange: e => { const v = +e.target.value; if (!isNaN(v)) { S.cursor[i] = v; drawOverlay(); } } }), h('em', {}, axis.toUpperCase()));
  const padEl = h('div', { class: 'trackpad', 'data-testid': 'trackpad' }, h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }),
    h('div', { class: 'pt-xy' }, box('x', 0), box('y', 1)),
    h('div', { class: 'pt-hint' }, 'Swipe here to position next point; tap here to place it.'),
    h('div', { class: 'pt-count' }, `${L.shape.pts.length} point${L.shape.pts.length === 1 ? '' : 's'}`));
  let tp = null;
  padEl.addEventListener('pointerdown', e => { if (e.target.closest('input')) return; padEl.setPointerCapture(e.pointerId); tp = { x: e.clientX, y: e.clientY, c0: S.cursor.slice(), moved: false }; });
  padEl.addEventListener('pointermove', e => {
    if (!tp) return; const dx = e.clientX - tp.x, dy = e.clientY - tp.y;
    if (Math.hypot(dx, dy) > 4) tp.moved = true;
    if (tp.moved) { S.cursor = [Math.round((tp.c0[0] + dx / viewScale) * 10) / 10, Math.round((tp.c0[1] + dy / viewScale) * 10) / 10]; drawOverlay(); updateCursorBoxes(); }
  });
  padEl.addEventListener('pointerup', () => { if (tp && !tp.moved) placePoint(); tp = null; });
  padEl.addEventListener('pointercancel', () => { tp = null; });
  const left = [
    h('button', { class: 'ib' + (L.shape.closed !== false ? ' on' : ''), title: 'Closed path', 'data-testid': 'pt-close', onclick: () => { L.shape.closed = L.shape.closed === false; commit(); } }, icon('node')),
    h('button', { class: 'ib dim', title: 'Curves (coming soon)', onclick: soon('Curved points') }, icon('bezier')),
    h('button', { class: 'ib', title: 'Add point at cursor', onclick: placePoint }, icon('pluscircle')),
  ];
  return { content: padEl, left };
}

// ---- Freehand drawing: size slider, colour bar + swatches, tool column ----
const SWATCHES = ['#ff4444', '#f5b546', '#fae965', '#1fd91e', '#17e1e1', '#3e4cf5', '#dd44dd', '#ffffff', '#bebebe', '#888888', '#444444', '#000000', '#5eb69d', '#98c99c'];
function openColorPicker() { const pc = $('#pickColor'); pc.value = S.draw.color; pc.click(); }
function panelDraw(L) {
  if (!L || L.type !== 'draw') return { content: h('div', { class: 'hint' }, 'Select a drawing layer.') };
  const d = S.draw;
  const range = h('input', { type: 'range', min: 1, max: 100, step: 1, value: d.size, class: 'mint', 'data-testid': 'draw-size' });
  const num = h('input', { type: 'number', min: 1, max: 100, value: d.size, class: 'dr-num' });
  const dot = h('i', { class: 'dr-dot' });
  const setSize = v => { d.size = Math.max(1, Math.min(100, Math.round(v))); range.value = d.size; num.value = d.size; range.style.setProperty('--p', (d.size - 1) / 99 * 100 + '%'); dot.style.setProperty('--s', 6 + d.size / 100 * 12 + 'px'); };
  range.addEventListener('input', () => setSize(+range.value)); num.addEventListener('change', () => setSize(+num.value)); setSize(d.size);
  const n = parseInt(d.color.slice(1), 16), lum = ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11);
  const content = h('div', { class: 'draw' },
    h('div', { class: 'dr-size' }, dot, range, num),
    h('div', { class: 'dr-colors' },
      h('div', { class: 'dr-left' },
        h('div', { class: 'dr-hex', 'data-testid': 'draw-color', style: { background: d.color, color: lum > 150 ? '#000' : '#fff' } }, h('span', {}, `${d.color.toUpperCase()} (100%)`),
          h('button', { class: 'dr-add', title: 'Custom colour', onclick: openColorPicker }, icon('plus'))),
        h('div', { class: 'dr-sw' }, SWATCHES.map(c => h('button', { class: c === d.color ? 'on' : '', style: { background: c }, title: c, 'data-testid': 'swatch', onclick: () => { d.color = c; renderPanel(); } })))),
      h('div', { class: 'dr-side' },
        h('button', { class: 'ib' + (S.picking ? ' on' : ''), title: 'Pick a colour from the preview', onclick: () => { S.picking = !S.picking; if (S.picking) toast('Tap the preview to pick a colour'); renderPanel(); } }, icon('dropper')),
        h('button', { class: 'ib', title: 'Clear drawing', 'data-testid': 'draw-clear', onclick: () => { if (L.draw.strokes.length && confirm('Clear this drawing?')) { L.draw.strokes = []; commit(); } } }, icon('canvas')),
        h('button', { class: 'ib', title: 'Colour picker', onclick: openColorPicker }, icon('palette')))));
  const right = h('div', { class: 'sub-r' }, ['pencil', 'brush', 'smudge', 'eraser'].map(t =>
    h('button', { class: 'ib' + (d.tool === t ? ' on' : '') + (t === 'smudge' ? ' dim' : ''), title: t[0].toUpperCase() + t.slice(1), 'data-testid': 'tool-' + t,
      onclick: () => { if (t === 'smudge') return toast('Smudge: coming soon'); d.tool = t; renderPanel(); } }, icon(t))));
  return { content, right };
}

function panelProject() {
  const p = P();
  const out = h('div', {});
  out.append(section('Canvas', chips(Object.keys(ASPECTS).map(a => [a, a, 'aspect-' + a]), p.aspect, v => changeAspect(v)),
    select({ label: 'FPS', value: String(p.fps), options: [['24', '24'], ['25', '25'], ['30', '30'], ['60', '60']], onChange: v => { p.fps = +v; commit(); } }),
    slider({ label: 'Duration', value: p.duration, min: 1, max: 60, step: 0.5, testid: 'duration', onInput: v => { p.duration = v; }, onChange: v => { p.duration = v; S.t = Math.min(S.t, v); commit(); } }), // clips are not clamped: anything past the end just isn't rendered
    color({ label: 'Background', value: p.bg, onInput: liveSet(v => (p.bg = v)), onChange: v => { p.bg = v; commit(); } })));
  out.append(section('Project', h('div', { class: 'acts' },
    h('button', { class: 'act', onclick: openProjects, 'data-testid': 'open-projects' }, icon('menu'), 'Projects'),
    h('button', { class: 'act', onclick: () => newProjectFlow(), 'data-testid': 'new-project' }, icon('plus'), 'New'),
    h('button', { class: 'act', onclick: exportJSON, 'data-testid': 'export-json' }, icon('export'), 'Save JSON'),
    h('button', { class: 'act', onclick: () => $('#fileJson').click(), 'data-testid': 'import-json' }, icon('up'), 'Load JSON'),
    h('button', { class: 'act', onclick: exportPNG, 'data-testid': 'export-png' }, icon('image'), 'Frame PNG'))));
  out.append(h('div', { class: 'hint small' }, 'Autosaves to this device. Media lives in IndexedDB; JSON export embeds it. Add to Home Screen from Safari’s share menu for full-screen use.'));
  return out;
}

// ---------------- add sheet (+) ----------------
const SHEET_TABS = [['shape', 'Shape', 'shapes'], ['media', 'Media', 'media'], ['audio', 'Audio', 'audio'], ['object', 'Object /\nElement', 'object'], ['template', 'Template', 'template']];
// [kind, testid suffix, shape overrides (radius as a fraction of the size)]
const SHAPE_GRID = [
  ['ellipse'], ['rect'], ['cross'], ['ring'], ['triangle'],
  ['pie'], ['polygon'], ['flower'], ['arrow'], ['trapezoid'],
  ['rect', 'roundrect', { radius: 0.25 }], ['star'], ['line'], ['heart'], ['half'],
  ['polygon', 'pentagon', { points: 5 }], ['polygon', 'diamond', { points: 4 }], ['polygon', 'octagon', { points: 8 }], ['star', 'star4', { points: 4, inner: 0.42 }], ['star', 'burst', { points: 12, inner: 0.72 }],
];
function shapeIconSvg(kind, o = {}) {
  const wrap = inner => `<svg viewBox="-12 -12 24 24">${inner}</svg>`;
  if (kind === 'line') return wrap('<path d="M-8.5 8.5 8.5-8.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>');
  if (kind === 'ring') return wrap('<circle r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/>');
  if (kind === 'ellipse') return wrap('<circle r="10" fill="currentColor"/>');
  if (kind === 'rect') { const r = o.radius != null ? o.radius * 20 : 2.2; return wrap(`<rect x="-9.5" y="-9.5" width="19" height="19" rx="${r}" fill="currentColor"/>`); }
  const pts = shapePoints({ kind, w: 21, h: 21, points: o.points ?? (kind === 'polygon' ? 6 : 5), inner: o.inner ?? 0.45, thickness: 0.25 }, 40);
  return wrap(`<path d="M${pts.map(p => p.map(v => v.toFixed(2)).join(' ')).join('L')}Z" fill="currentColor"/>`);
}
function addShape(kind, o = {}) {
  const short = Math.min(P().w, P().h), ov = { ...o };
  if (ov.radius != null) ov.radius *= short * 0.4;
  addLayer(makeLayer(P(), 'shape', { kind, shape: ov }));
}
function addDrawing() { addLayer(makeLayer(P(), 'draw'), { tab: 'draw' }); }
function addVector() { S.cursor = [P().w / 2, P().h / 2]; addLayer(makeLayer(P(), 'shape', { kind: 'path' }), { tab: 'points' }); }
const mediaSources = type => { const seen = new Set(); return P().layers.filter(L => (type === 'audio' ? L.type === 'audio' : L.type === 'image' || L.type === 'video') && L.media && !seen.has(L.media.id) && seen.add(L.media.id)); };
function sheetContent() {
  const tile = (ic, label, fn, tid, extra = '') => h('button', { class: 'sh-item ' + extra, 'data-testid': tid, onclick: fn }, icon(ic), h('span', {}, label));
  switch (S.addTab) {
    case 'media': return h('div', { class: 'sh-media' },
      h('div', { class: 'sh-mleft' }, h('button', { class: 'sh-mbtn', title: 'Browse photos & videos', 'data-testid': 'add-media', onclick: () => $('#fileMedia').click() }, icon('grid')),
        h('button', { class: 'sh-mbtn txt', onclick: () => $('#fileMedia').click() }, 'Recents')),
      h('div', { class: 'sh-mgrid' }, ...mediaSources('media').map(L => h('button', { class: 'sh-thumb', title: L.name, onclick: () => addLayer(makeLayer(P(), L.type, { mediaId: L.media.id, w: L.media.w, h: L.media.h, name: L.name })) },
        h('img', { src: layerThumb(L) || '', alt: '' }), L.type === 'video' ? h('em', {}, tc(L.end - L.start)) : null)),
        h('button', { class: 'sh-thumb add', onclick: () => $('#fileMedia').click() }, icon('plus'), h('span', {}, 'Import'))));
    case 'audio': return h('div', { class: 'sh-audio' },
      h('button', { class: 'sh-viewall', 'data-testid': 'add-audio', onclick: () => $('#fileAudio').click() }, icon('grid'), h('span', {}, 'Import Audio')),
      ...mediaSources('audio').map(L => h('button', { class: 'sh-acard', onclick: () => addLayer(makeLayer(P(), 'audio', { mediaId: L.media.id, name: L.name, mediaDuration: L.media.duration })) },
        h('b', {}, L.name), h('em', {}, tc(L.media.duration || L.end - L.start)), icon('plus'))),
      mediaSources('audio').length ? null : h('div', { class: 'sh-note' }, 'Add your own music or sound effects (MP3, M4A, WAV). They play with the timeline and are mixed into the export.'));
    case 'object': return h('div', { class: 'sh-obj' },
      tile('solid', 'Solid Color', () => addLayer(makeLayer(P(), 'solid')), 'add-solid'),
      tile('adjust', 'Adjustment', () => { const L = makeLayer(P(), 'adjust'); L.effects.push(makeEffect('coloradj')); addLayer(L, { tab: 'fx' }); }, 'add-adjust'),
      tile('camera', 'Camera', soon('Camera'), 'add-camera'),
      tile('group', 'Empty Group', soon('Groups'), 'add-group'),
      tile('nullobj', 'Null', soon('Null objects'), 'add-null'),
      tile('element', 'Element / Project', soon('Elements'), 'add-element'));
    case 'template': return h('div', { class: 'sh-tpl' },
      tile('grid', 'View All', soon('Templates'), 'tpl-all'),
      tile('demo', 'KINETIC Neon Demo', () => { if (confirm('Replace this project with the KINETIC demo?')) setProject(demoProject(P().aspect)); }, 'add-demo'));
    default: {
      const pages = [];
      for (let i = 0; i < SHAPE_GRID.length; i += 15) pages.push(h('div', { class: 'sh-page' }, SHAPE_GRID.slice(i, i + 15).map(([k, id, o]) =>
        h('button', { class: 'sh-shape', title: id || k, 'data-testid': 'add-' + (id || k), html: shapeIconSvg(k, o), onclick: () => addShape(k, o) }))));
      const dots = h('div', { class: 'sh-dots' }, pages.map((_, i) => h('i', { class: i ? '' : 'on' })));
      const wrap = h('div', { class: 'sh-pages' }, pages);
      wrap.addEventListener('scroll', () => { const i = Math.round(wrap.scrollLeft / (wrap.clientWidth || 1)); [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i)); }, { passive: true });
      return h('div', { class: 'sh-shapes' }, wrap, dots);
    }
  }
}
function renderSheet() {
  const side = (ic, label, fn, tid) => h('button', { class: 'sh-sbtn', 'data-testid': tid, title: label || 'Close', onclick: fn }, icon(ic), label ? h('span', {}, label) : null);
  $('#sheet').replaceChildren(
    h('div', { class: 'sh-tabs' }, SHEET_TABS.map(([id, label, ic]) => h('button', { class: 'sh-tab' + (S.addTab === id ? ' on' : ''), 'data-testid': 'sheet-' + id, onclick: () => { S.addTab = id; renderSheet(); } }, icon(ic), h('span', {}, label)))),
    h('div', { class: 'sh-body' }, sheetContent()),
    h('div', { class: 'sh-side' },
      side('freehand', 'Freehand\nDrawing', addDrawing, 'add-draw'),
      side('vector', 'Vector\nDrawing', addVector, 'add-vector'),
      side('textaa', 'Text', () => addLayer(makeLayer(P(), 'text')), 'add-text'),
      side('close', '', () => { S.tab = null; refreshAll(); }, 'sheet-close')));
}
function openSheet(tabId) { if (S.sel) { S.sel = null; S.selKeys.clear(); } S.tab = 'add'; if (tabId) S.addTab = tabId; refreshAll(); }

function openLayerMenu() {
  const L = selLayer(); if (!L) return;
  const it = (ic, label, fn) => h('button', { class: 'act wide', onclick: () => { dlg.close(); fn(); } }, icon(ic), label);
  openDialog(L.name || 'Layer', h('div', { class: 'plist' },
    it('center', 'Center on canvas', () => { writeProp(L, 'x', S.t, P().w / 2); writeProp(L, 'y', S.t, P().h / 2); commit(); }),
    it(L.visible ? 'eyeoff' : 'eye', L.visible ? 'Hide layer' : 'Show layer', () => { L.visible = !L.visible; commit(); }),
    it(L.locked ? 'unlock' : 'lock', L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; commit(); }),
    it('up', 'Move up', () => moveLayer(L, -1)), it('down', 'Move down', () => moveLayer(L, 1)),
    it('ease', 'Easing', () => openSub('ease')),
    it('text', 'Rename', () => { const n = $('#layerName'); n.focus(); n.select(); })));
}
function selectedKeyObjs() {
  const out = [];
  for (const L of P().layers) for (const { prop, k } of allKeys(L)) if (S.selKeys.has(k.id)) out.push({ L, prop, k });
  return out;
}

function panelEase(L) {
  const ks = selectedKeyObjs();
  if (!ks.length) return h('div', { class: 'hint' }, 'Tap a ◆ keyframe on the timeline to edit the easing of the motion leaving it.' + (L && allKeys(L).length ? '' : ' Add keyframes in the Layer tab first.'));
  const cur = ks[0].k.ease || makeEase('linear');
  const apply = e => { ks.forEach(({ k }) => (k.ease = clone(e))); commit(); };
  const out = h('div', {});
  out.append(h('div', { class: 'hint' }, `${ks.length} keyframe${ks.length > 1 ? 's' : ''} selected · ${[...new Set(ks.map(x => x.prop))].map(p => PROP_META[p].label).join(', ')} @ ${ks[0].k.t.toFixed(2)}s`));
  out.append(section('Presets', chips(Object.entries(EASE_PRESETS).map(([k, p]) => [k, p.label, 'ease-' + k]), cur.preset, v => apply(makeEase(v)))));
  out.append(section('Curve', bezierEditor(cur, e => apply(e))));
  if (cur.type === 'steps') out.append(slider({ label: 'Steps', value: cur.n, min: 2, max: 24, step: 1, onChange: v => apply({ ...cur, n: v }) }));
  out.append(h('div', { class: 'acts' },
    h('button', { class: 'act', onclick: () => { const lay = ks[0].L; allKeys(lay).forEach(({ k }) => (k.ease = clone(cur))); commit(); toast('Applied to all keys in layer'); } }, 'Apply to whole layer'),
    h('button', { class: 'act', onclick: () => { ks.forEach(({ L: lay, prop, k }) => removeKey(lay, prop, k.id)); S.selKeys.clear(); commit(); } }, icon('trash'), 'Delete keys')));
  return out;
}

function bezierEditor(ease, onCommit) {
  const size = 220, pad = 34;
  const cv = h('canvas', { class: 'bez', width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' }, 'data-testid': 'bezier' });
  const ctx = cv.getContext('2d'); ctx.scale(2, 2);
  let bz = (ease.bz || [0.42, 0, 0.58, 1]).slice();
  const isBez = !ease.type || ease.type === 'bezier';
  const inner = size - pad * 2;
  const YMIN = -0.6, YMAX = 1.6, vpad = 10, vin = size - vpad * 2;
  const toPx = (x, y) => [pad + x * inner, vpad + (YMAX - y) / (YMAX - YMIN) * vin];
  const fromPx = (px, py) => [Math.max(0, Math.min(1, (px - pad) / inner)), Math.max(YMIN, Math.min(YMAX, YMAX - (py - vpad) / vin * (YMAX - YMIN)))];
  const draw = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    const [, y0] = toPx(0, 0), [, y1] = toPx(0, 1);
    for (let i = 0; i <= 4; i++) { const [x] = toPx(i / 4, 0); const [, y] = toPx(0, i / 4); ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(size - pad, y); ctx.stroke(); }
    const e = isBez ? { type: 'bezier', bz } : ease;
    ctx.beginPath(); ctx.strokeStyle = '#00ffa8'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
    for (let i = 0; i <= 100; i++) { const [x, y] = toPx(i / 100, applyEase(e, i / 100)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.shadowBlur = 0;
    if (isBez) {
      const [a, b] = [toPx(bz[0], bz[1]), toPx(bz[2], bz[3])];
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...toPx(0, 0)); ctx.lineTo(...a); ctx.moveTo(...toPx(1, 1)); ctx.lineTo(...b); ctx.stroke();
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fillStyle = '#141720'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(234,252,255,.5)'; ctx.font = '9px ui-monospace,monospace';
    ctx.fillText(isBez ? `cubic-bezier(${bz.map(v => v.toFixed(2)).join(', ')})` : ease.type, 6, 12);
  };
  draw();
  if (isBez) {
    let drag = -1;
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const a = toPx(bz[0], bz[1]), b = toPx(bz[2], bz[3]);
      const da = Math.hypot(px - a[0], py - a[1]), db = Math.hypot(px - b[0], py - b[1]);
      drag = da < db ? 0 : 1; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (drag < 0) return; const r = cv.getBoundingClientRect();
      const [x, y] = fromPx(e.clientX - r.left, e.clientY - r.top); bz[drag * 2] = +x.toFixed(3); bz[drag * 2 + 1] = +y.toFixed(3); draw();
    });
    const up = () => { if (drag >= 0) { drag = -1; onCommit({ preset: 'custom', type: 'bezier', bz: bz.slice() }); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  return h('div', { class: 'bezwrap' }, cv);
}

function changeAspect(a) {
  const p = P(); const [w, hh] = ASPECTS[a]; const sx = w / p.w, sy = hh / p.h;
  for (const L of p.layers) {
    L.props.x *= sx; L.props.y *= sy;
    (L.keys.x || []).forEach(k => (k.v *= sx)); (L.keys.y || []).forEach(k => (k.v *= sy));
  }
  p.w = w; p.h = hh; p.aspect = a; commit();
}


// ---------------- home (project list) ----------------
function thumbFor(p) {
  const c = document.createElement('canvas'), k = 96 / Math.max(p.w, p.h);
  c.width = Math.max(8, Math.round(p.w * k)); c.height = Math.max(8, Math.round(p.h * k));
  try { new Renderer().render(p, Math.min(1.5, p.duration / 2), c); } catch {}
  return c;
}
function showHome() {
  if (S.playing) togglePlay(false);
  if (P()) store.saveProject(P());
  const list = store.listProjects();
  $('#homeList').replaceChildren(...(list.length ? list.map(x => {
    const pr = store.loadProject(x.id);
    const open = () => { const q = store.loadProject(x.id); if (q) { setProject(q); hideHome(); } };
    return h('div', { class: 'pcard', 'data-testid': 'home-project' },
      h('button', { class: 'pc-main', onclick: open, 'data-testid': 'home-open' }, h('span', { class: 'pc-th' }, pr ? thumbFor(pr) : ''),
        h('span', { class: 'pc-tx' }, h('b', {}, x.name), h('em', {}, `${x.aspect} · ${pr ? pr.duration.toFixed(1) + 's' : ''} · ${new Date(x.modified).toLocaleDateString()}`))),
      h('button', { class: 'ib', title: 'Delete', onclick: () => { if (confirm('Delete ' + x.name + '?')) { store.deleteProject(x.id); if (P() && x.id === P().id) { const rest = store.listProjects()[0]; setProject((rest && store.loadProject(rest.id)) || newProject('9:16', 'Project 1')); } showHome(); } } }, icon('dots')));
  }) : [h('div', { class: 'h-empty' }, 'No projects yet. Tap + to create one.')]));
  $('#home').hidden = false; document.body.classList.add('home-open');
}
function hideHome() { $('#home').hidden = true; document.body.classList.remove('home-open'); requestAnimationFrame(() => { layoutStage(); drawFrame(); renderTimeline(); }); }
function openHomeSettings() {
  openDialog('Settings', h('div', { class: 'plist' },
    h('button', { class: 'act wide', onclick: () => { dlg.close(); $('#fileJson').click(); } }, icon('up'), 'Import project (.json)'),
    h('div', { class: 'hint small' }, 'KINETIC saves projects on this device. Add it to the Home Screen from Safari’s share menu for full-screen use.')));
}

// ---------------- dialogs ----------------
const dlg = $('#dlg');
function openDialog(title, body) {
  dlg.replaceChildren(h('div', { class: 'dlg-h' }, h('b', {}, title), h('button', { class: 'mini', onclick: () => dlg.close(), 'data-testid': 'dlg-close' }, icon('close'))), body);
  if (!dlg.open) dlg.showModal();
}
function openProjects() {
  const list = store.listProjects();
  openDialog('Projects', h('div', { class: 'plist' },
    h('button', { class: 'act wide', onclick: () => newProjectFlow() }, icon('plus'), 'New project'),
    ...list.map(x => h('div', { class: 'pitem' + (x.id === P().id ? ' cur' : '') },
      h('button', { class: 'pmain', onclick: () => { const pr = store.loadProject(x.id); if (pr) { setProject(pr); dlg.close(); } } },
        h('b', {}, x.name), h('em', {}, `${x.aspect} · ${x.layers} layers · ${new Date(x.modified).toLocaleString()}`)),
      h('button', { class: 'mini', title: 'Delete', onclick: () => { if (x.id === P().id) return toast('Open another project first'); if (confirm('Delete ' + x.name + '?')) { store.deleteProject(x.id); openProjects(); } } }, icon('trash'))))));
}
function newProjectFlow() {
  openDialog('New Project', h('div', { class: 'plist' },
    h('div', { class: 'hint' }, 'Pick an aspect ratio'),
    h('div', { class: 'grid' }, Object.entries(ASPECTS).map(([a, [w, hh]]) =>
      h('button', { class: 'add-btn aspect', 'data-testid': 'new-' + a, onclick: () => { const p = newProject(a, 'Project ' + (store.listProjects().length + 1)); setProject(p); dlg.close(); hideHome(); } },
        h('i', { style: { aspectRatio: `${w}/${hh}` } }), h('span', {}, a))))));
}
async function exportJSON() {
  const p = clone(P()); p.media = {};
  for (const L of p.layers) if (L.media && !p.media[L.media.id]) { const b = await store.getMedia(L.media.id); if (b) p.media[L.media.id] = await store.blobToDataURL(b); }
  download(new Blob([JSON.stringify(p)], { type: 'application/json' }), (p.name || 'project').replace(/\W+/g, '_') + '.kntc.json');
}
async function importJSON(file) {
  try {
    const p = JSON.parse(await file.text());
    if (!p.layers || !p.w) throw new Error('not a project');
    if (p.media) { for (const [id, url] of Object.entries(p.media)) await store.putMedia(id, await store.dataURLToBlob(url)); delete p.media; }
    p.id = uid(); setProject(p); hideHome(); toast('Project loaded');
  } catch (e) { console.error(e); toast('Invalid project file'); }
}
function exportPNG() {
  const c = document.createElement('canvas'); c.width = P().w; c.height = P().h;
  new Renderer().render(P(), S.t, c);
  c.toBlob(b => download(b, `frame_${Math.round(S.t * P().fps)}.png`), 'image/png');
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function openExport() {
  if (S.playing) togglePlay(false);
  const fm = supportedFormats(); const p = P();
  const opts = { format: fm.mp4 ? 'mp4' : 'webm', shortSide: 1080, fps: p.fps, mbps: 10, audio: true };
  const fmtOpts = [['auto', 'Auto'], ['mp4', 'MP4' + (fm.mp4 ? '' : ' ✕')], ['webm', 'WebM' + (fm.webm ? '' : ' ✕')]];
  const info = h('div', { class: 'hint' });
  const upd = () => { const s = exportSize(p, opts.shortSide); info.textContent = `${s.w}×${s.h} · ${opts.fps}fps · ${p.duration}s · ~${(opts.mbps * p.duration / 8).toFixed(1)} MB · renders in real time`; };
  const prog = h('div', { class: 'prog' }, h('i'));
  const result = h('div', { class: 'result' });
  const go = h('button', { class: 'primary wide', 'data-testid': 'export-start' }, icon('export'), 'Render');
  go.onclick = async () => {
    go.disabled = true; result.replaceChildren(); prog.classList.add('run');
    try {
      const r = await exportVideo(p, { format: opts.format, shortSide: opts.shortSide, fps: opts.fps, bitrate: opts.mbps * 1e6, audio: opts.audio,
        onProgress: f => (prog.firstChild.style.width = (f * 100).toFixed(1) + '%') });
      prog.firstChild.style.width = '100%';
      const name = `${p.name.replace(/\W+/g, '_')}_${r.w}x${r.h}.${r.ext}`;
      const file = new File([r.blob], name, { type: r.blob.type });
      window.__lastExport = { size: r.blob.size, mime: r.mime, name, w: r.w, h: r.h };
      const url = URL.createObjectURL(r.blob);
      result.append(h('div', { class: 'hint', 'data-testid': 'export-result' }, `${name} · ${(r.blob.size / 1048576).toFixed(2)} MB · ${r.mime}`),
        h('video', { src: url, controls: true, playsinline: true, muted: true, loop: true, class: 'preview' }),
        h('div', { class: 'acts' },
          h('a', { class: 'act', href: url, download: name, 'data-testid': 'export-download' }, icon('export'), 'Download'),
          navigator.canShare && navigator.canShare({ files: [file] }) ? h('button', { class: 'act', onclick: () => navigator.share({ files: [file], title: p.name }).catch(() => {}) }, icon('dup'), 'Share / Save to Photos') : null));
    } catch (e) { console.error(e); result.append(h('div', { class: 'hint err' }, 'Export failed: ' + (e.message || e))); }
    go.disabled = false; prog.classList.remove('run');
  };
  upd();
  openDialog('Export Video', h('div', { class: 'plist' },
    select({ label: 'Format', value: opts.format, options: fmtOpts, testid: 'export-format', onChange: v => (opts.format = v) }),
    chips([[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']].map(([v, t]) => [v, t]), opts.shortSide, v => { opts.shortSide = v; upd(); }),
    select({ label: 'FPS', value: String(opts.fps), options: [['24', '24'], ['25', '25'], ['30', '30'], ['60', '60']], onChange: v => { opts.fps = +v; upd(); } }),
    slider({ label: 'Mbps', value: opts.mbps, min: 1, max: 40, step: 1, onInput: v => { opts.mbps = v; upd(); } }),
    toggle({ label: 'Video audio', value: opts.audio, onChange: v => (opts.audio = v) }),
    info, go, prog, result,
    h('div', { class: 'hint small' }, 'Keep this tab in front while rendering. Safari records MP4 (H.264); Chrome/Firefox record WebM (Chrome 126+ may also offer MP4).')));
  // chip selection highlight
  dlg.querySelectorAll('.chips .chip').forEach(b => b.addEventListener('click', () => { dlg.querySelectorAll('.chips .chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); }));
}


// ---------------- wiring ----------------
function buildChrome() {
  const ic = (id, n) => $(id).replaceChildren(icon(n));
  ic('#btnBack', 'back'); ic('#btnSettings', 'gear'); ic('#btnExport', 'share'); ic('#btnDup', 'dup'); ic('#btnDel', 'trash'); ic('#btnMore', 'more');
  ic('#btnKey', 'key'); ic('#btnPtAdd', 'pluscircle');
  ic('#btnUndo', 'undo'); ic('#btnRedo', 'redo'); ic('#btnStart', 'start'); ic('#btnEnd', 'end'); ic('#btnCopy', 'copy'); ic('#btnFit', 'fit');
  ic('#fab', 'plus'); ic('#homeSettings', 'gear'); ic('#homeNew', 'plus');
  $('#btnBack').onclick = goBack;
  $('#btnSettings').onclick = () => openSub('project');
  $('#btnExport').onclick = openExport;
  $('#btnDup').onclick = () => duplicateLayer(selLayer());
  $('#btnDel').onclick = () => deleteLayer(selLayer());
  $('#btnMore').onclick = openLayerMenu;
  $('#btnKey').onclick = toggleKeyAll;
  $('#btnPtAdd').onclick = placePoint;
  $('#fab').onclick = () => openSheet();
  $('#homeNew').onclick = () => newProjectFlow(); $('#homeSettings').onclick = openHomeSettings;
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnPlay').onclick = () => togglePlay();
  $('#btnStart').onclick = () => seek(0);
  $('#btnEnd').onclick = () => seek(P().duration);
  $('#btnCopy').onclick = () => duplicateLayer(selLayer());
  $('#btnFit').onclick = () => { S.full = !S.full; refreshAll(); };
  $('#projName').onchange = e => { P().name = e.target.value || 'Untitled'; commit(); };
  $('#layerName').onchange = e => { const L = selLayer(); if (L) { L.name = e.target.value || L.name; commit(); } };
  for (const id of ['#projName', '#layerName']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#fileMedia').onchange = e => { const f = e.target.files[0]; if (f) importMediaFile(f); e.target.value = ''; };
  $('#fileAudio').onchange = e => { const f = e.target.files[0]; if (f) importAudioFile(f); e.target.value = ''; };
  $('#fileJson').onchange = e => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; };
  $('#pickColor').addEventListener('input', e => { S.draw.color = e.target.value; renderPanel(); });
  window.addEventListener('resize', () => { layoutStage(); drawFrame(); renderTimeline(); });
  new ResizeObserver(() => { layoutStage(); drawFrame(); }).observe($('#stageWrap'));
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key === 'k') toggleKeyAll();
    else if (e.key === 'Escape') goBack();
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const ks = selectedKeyObjs();
      if (ks.length) { ks.forEach(({ L, prop, k }) => removeKey(L, prop, k.id)); S.selKeys.clear(); commit(); }
      else if (selLayer()) deleteLayer(selLayer());
    } else if (e.key === 'ArrowLeft') seek(S.t - 1 / P().fps);
    else if (e.key === 'ArrowRight') seek(S.t + 1 / P().fps);
  });
}
function afterHistory(s) { S.project = s; if (S.sel && !s.layers.some(l => l.id === S.sel)) { S.sel = null; if (S.tab !== 'project') S.tab = null; } hydrateMedia(s); scheduleSave(); refreshAll(); }
function undo() { const s = history.undo(); if (s) afterHistory(s); }
function redo() { const s = history.redo(); if (s) afterHistory(s); }

function boot() {
  buildChrome(); lockPage(); bindTimelineGestures();
  const last = store.lastProjectId();
  let p = last && store.loadProject(last);
  if (!p) p = demoProject('9:16');
  setProject(p);
  if (!/[?&#]editor/.test(location.href)) showHome();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // test / debug hook
  window.__app = { showHome, hideHome, S, get project() { return P(); }, seek, togglePlay, renderer, commit, refreshAll, setProject, demoProject, exportVideo, supportedFormats, EFFECTS, makeEffect,
    selectLayer, deselect, openSub, openSheet, goBack, addLayer, makeLayer };
}
boot();
