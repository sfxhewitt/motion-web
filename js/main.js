import { newProject, makeLayer, ASPECTS, RESOLUTIONS, sizeFor, ANIM_PROPS, XFORM_PROPS, PROP_META, valueAt, hasKeys, findKey, setKey, removeKey, writeProp, allKeys, shiftLayer, setStart, History, clone, uid } from './state.js';
import { EASE_PRESETS, makeEase, applyEase } from './easing.js';
import { EFFECTS, makeEffect, migrateProject, migrateLayer, searchEffects, presetsFor, applyPreset } from './effects.js';
import { initFxUI, panelFx, panelEase as fxPanelEase, easeTick, propLabel, renewFxIds, openBrowser, closeBrowser, openEaseFor, keyframesRequired, fxEaseTarget } from './fxui.js';
import { Renderer, BLEND_MODES, FONTS, media, evalTransform, layerMatrix, evalShape, layerBounds, syncVideos, shapePoints, brushWidth } from './render.js';
import * as store from './storage.js';
import { exportVideo, supportedFormats, exportSize } from './export.js';
import { $, h, slider, color, toggle, select, chips, section, toast, icon } from './ui.js';

// ---------------- state ----------------
// tab: null (nothing / tile grid when a layer is selected) | 'add' (add sheet) | a sub panel id (see SUB_TITLE)
const S = { project: null, t: 0, playing: false, sel: null, multi: new Set(), selKeys: new Set(), tab: null, addTab: 'shape', pps: 60, autoFit: false, loop: true, fxCat: 'All',
  draw: { tool: 'pencil', size: 16, color: '#0000ff' }, cursor: null, picking: false, full: false,
  vz: { k: 1, x: 0, y: 0 },  // preview zoom (1 = fit) + pan offset in css px
  sizeMode: localStorage.getItem('kntc.sizeMode') || 'center', // handle drags: 'center' | 'edge' | 'free'
  guides: [] };            // red snap guides while dragging a layer
const SIZE_MODES = [['center', 'Size from center', 'sz-center'], ['edge', 'Size from edge', 'sz-edge'], ['free', 'Resize Freely', 'sz-free']];
const history = new History();
const renderer = new Renderer();
const view = $('#view'), overlay = $('#overlay'), stage = $('#stage');
let viewScale = 1; // css px per project px
const PILL_W = 70, HEAD_H = 48, ROW_H = 32; // timeline: layer pill width, ruler+timecode band, row pitch
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

function refreshAll() { if (layerMenu && !selLayer()) closeLayerMenu(); closeCopyMenu(); layoutChrome(); layoutStage(); drawFrame(); renderTimeline(); renderPanel(); updateTransport(); updateHeader(); renderSizeModes(); }

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
  migrateProject(p); closeBrowser();
  S.project = p; S.sel = null; S.multi.clear(); S.selKeys.clear(); S.vz = { k: 1, x: 0, y: 0 }; S.tab = null; S.t = Math.min(S.t, p.duration); G.extT = 0; G.lastSel = null;
  if (resetHistory) history.reset(p);
  store.saveProject(p); hydrateMedia(p); refreshAll();
}
// new layers go on TOP of the stack (index 0 = top of the layer list = rendered last / in front)
function addLayer(L, { tab = null } = {}) {
  P().layers.unshift(L); S.sel = L.id; S.multi.clear(); S.selKeys.clear(); S.tab = tab;
  commit();
}
function selectLayer(id) {
  S.sel = id; S.multi.clear(); S.selKeys.clear();
  if (S.tab === 'add' || ['project', 'points', 'draw', 'edit'].includes(S.tab)) S.tab = null;
  refreshAll();
}
function deselect() { S.sel = null; S.multi.clear(); S.selKeys.clear(); if (S.tab !== 'project') S.tab = null; refreshAll(); }
function goBack() {
  if (S.full) { S.full = false; return refreshAll(); }
  if (S.tab === 'add') { S.tab = null; return refreshAll(); }
  if (S.tab === 'ease' && S.easeBack) { S.tab = S.easeBack; S.easeBack = null; return refreshAll(); }
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
  const c = clone(L); c.id = uid(); c.name = L.name + ' copy'; for (const p in c.keys) c.keys[p].forEach(k => (k.id = uid())); renewFxIds(c);
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
  if (how === 'start') setStart(L, t);
  else if (how === 'end') L.end = t;
  else {
    const c = clone(L); c.id = uid(); for (const p in c.keys) c.keys[p].forEach(k => (k.id = uid())); renewFxIds(c);
    setStart(c, t); L.end = t; P().layers.splice(P().layers.indexOf(L), 0, c);
  }
  commit();
}
function demoProject(aspect = '9:16') {
  const p = newProject(aspect, 'Neon Demo');
  const fx = (L, id, over = {}) => { const f = makeEffect(id, over); L.effects.push(f); return f; };
  const bg = makeLayer(p, 'solid', { color: '#07051a' }); bg.name = 'Backdrop'; bg.solid.gradient = true; bg.solid.fill2 = '#1a0230'; bg.solid.gradAngle = 90;
  const ring = makeLayer(p, 'shape', { kind: 'ring' }); ring.shape.fill = '#00f0ff'; ring.shape.thickness = 0.12; ring.name = 'Halo';
  setKey(ring, 'scale', 0, 0.2, makeEase('backOut')); setKey(ring, 'scale', 1.2, 1.4);
  setKey(ring, 'rotation', 0, 0, makeEase('linear')); setKey(ring, 'rotation', 6, 360);
  fx(ring, 'glow', { r: 36, int: 160, color: '#00f0ff', tint: 40 });
  const star = makeLayer(p, 'shape', { kind: 'star' }); star.shape.fill = '#ff2bd6'; star.shape.w = star.shape.h = Math.min(p.w, p.h) * 0.22; star.name = 'Spark';
  setKey(star, 'y', 0, p.h * 0.8, makeEase('expoOut')); setKey(star, 'y', 1.5, p.h * 0.32);
  setKey(star, 'rotation', 0, -180, makeEase('easeInOut')); setKey(star, 'rotation', 1.5, 0);
  fx(star, 'pulsesize', { amt: 8, freq: 1.5 }); fx(star, 'glow', { r: 30, int: 150, color: '#ff2bd6', tint: 60 });
  const txt = makeLayer(p, 'text', { content: 'KINETIC' }); txt.text.fill = '#eafcff'; txt.name = 'Title';
  setKey(txt, 'opacity', 0.6, 0, makeEase('easeOut')); setKey(txt, 'opacity', 1.4, 1);
  setKey(txt, 'scale', 0.6, 1.6, makeEase('expoOut')); setKey(txt, 'scale', 1.6, 1);
  txt.props.y = p.h * 0.62;
  const rgb = fx(txt, 'rgbsplit', { amt: 8 });
  setKey(txt, `fx.${rgb.id}.amt`, 0.6, 40, makeEase('expoOut')); setKey(txt, `fx.${rgb.id}.amt`, 1.6, 6);
  fx(txt, 'glow', { r: 24, int: 110, color: '#9ff6ff', tint: 30 });
  const adj = makeLayer(p, 'adjust'); adj.name = 'Grade'; fx(adj, 'vignette', { amt: 55, size: 60 }); fx(adj, 'noise', { amt: 8 });
  p.layers = [adj, txt, star, ring, bg];
  return p;
}


// ---------------- stage ----------------
function layoutStage() {
  const wrap = $('#stageWrap'), r = wrap.getBoundingClientRect();
  const p = P(); if (!p || r.width < 2 || r.height < 2) return;
  const sc = Math.min(r.width / p.w, r.height / p.h), k = S.vz.k;
  const cw = Math.max(40, Math.round(p.w * sc * k)), ch = Math.max(40, Math.round(p.h * sc * k));
  viewScale = cw / p.w;
  stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
  stage.style.translate = `${S.vz.x}px ${S.vz.y}px`;
  const zoomed = k !== 1 || S.vz.x || S.vz.y;
  wrap.classList.toggle('zoomed', !!zoomed);
  wrap.style.background = zoomed ? p.bg : ''; // zoomed / panned: the area outside the composition shows the project background
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.min(p.w, Math.round(cw * dpr)), bh = Math.round(bw * p.h / p.w);
  if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
  const cap = Math.min(1, 4096 / Math.max(cw * dpr, ch * dpr)), ow = Math.round(cw * dpr * cap), oh = Math.round(ch * dpr * cap);
  if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
}
// ---- preview zoom / pan (pinch on the preview, one-finger drag while zoomed, magnifier resets to fit) ----
const VZ_MIN = 0.25, VZ_MAX = 8;
let hudT = 0;
function showZoomHud() {
  const hud = $('#zoomHud'); hud.lastChild.textContent = Math.round(S.vz.k * 100) + '%';
  hud.classList.add('show'); clearTimeout(hudT); hudT = setTimeout(() => hud.classList.remove('show'), 1100);
}
function setZoom(k, x, y, hud = true) {
  S.vz.k = Math.max(VZ_MIN, Math.min(VZ_MAX, k)); S.vz.x = x; S.vz.y = y;
  if (Math.abs(S.vz.k - 1) < 0.02 && hud === 'snap') { S.vz.k = 1; }
  layoutStage(); drawFrame(); if (hud) showZoomHud();
}
function resetZoom() { setZoom(1, 0, 0); }
// a centre point C (client) of the stage; keeping the content point under the fingers fixed while scaling
function stageCentre() { const r = $('#stageWrap').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
const VP = { ptrs: new Map(), pinch: null, pan: null };
function bindPreviewZoom() {
  const wrap = $('#stageWrap');
  wrap.addEventListener('pointerdown', e => {
    if (!P() || e.target.closest('button')) return;
    VP.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (VP.ptrs.size === 1) VP.hadSel = !!S.sel; // (the first finger may select a layer on its way down)
    if (VP.ptrs.size === 2 && !['draw', 'points'].includes(S.tab)) {
      // a selected layer under either finger -> the layer pinch (scale/rotate) runs instead; otherwise the view zooms
      const L = selLayer(), r = stage.getBoundingClientRect();
      const onL = VP.hadSel && L && [...VP.ptrs.values()].some(q => hitTest((q.x0 - r.left) / viewScale, (q.y0 - r.top) / viewScale) === L);
      if (!onL) {
        const [a, b] = [...VP.ptrs.values()], C = stageCentre();
        VP.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], k0: S.vz.k, c0: [C[0] + S.vz.x, C[1] + S.vz.y] };
        VP.pan = null; cancelStageGesture();
        if (!VP.hadSel && S.sel) { S.sel = null; S.selKeys.clear(); refreshAll(); } // nothing was selected: the pinch only zooms
      }
    }
  }, true);
  wrap.addEventListener('pointermove', e => {
    const q = VP.ptrs.get(e.pointerId); if (!q) return;
    q.x = e.clientX; q.y = e.clientY;
    if (VP.pinch) {
      if (VP.ptrs.size < 2) return;
      const [a, b] = [...VP.ptrs.values()], pz = VP.pinch, C = stageCentre();
      const k = Math.max(VZ_MIN, Math.min(VZ_MAX, pz.k0 * Math.hypot(a.x - b.x, a.y - b.y) / pz.d0)), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      // content point under the starting midpoint follows the fingers
      const cx = m[0] - (pz.m0[0] - pz.c0[0]) * k / pz.k0, cy = m[1] - (pz.m0[1] - pz.c0[1]) * k / pz.k0;
      setZoom(k, cx - C[0], cy - C[1]);
      return;
    }
    // one finger while zoomed: pan, unless it is moving / drawing / editing something on the canvas
    const zoomed = S.vz.k !== 1 || S.vz.x || S.vz.y;
    if (VP.ptrs.size === 1 && zoomed && (!gesture || gesture.mode === 'tap')) {
      if (!VP.pan) { if (Math.hypot(q.x - q.x0, q.y - q.y0) < TAP_SLOP) return; VP.pan = { x0: S.vz.x, y0: S.vz.y }; if (gesture) gesture.cancel = true; }
      setZoom(S.vz.k, VP.pan.x0 + q.x - q.x0, VP.pan.y0 + q.y - q.y0, false);
    }
  });
  const up = e => { if (!VP.ptrs.delete(e.pointerId)) return; if (VP.ptrs.size < 2 && VP.pinch) { VP.pinch = null; if (Math.abs(S.vz.k - 1) < 0.04) setZoom(1, S.vz.x, S.vz.y); } if (!VP.ptrs.size) VP.pan = null; };
  wrap.addEventListener('pointerup', up, true); wrap.addEventListener('pointercancel', up, true); wrap.addEventListener('lostpointercapture', up, true);
  // desktop: ctrl / trackpad-pinch wheel over the preview zooms around the cursor
  wrap.addEventListener('wheel', e => {
    if (!e.ctrlKey || !P()) return; e.preventDefault();
    const C = stageCentre(), k0 = S.vz.k, k = Math.max(VZ_MIN, Math.min(VZ_MAX, k0 * Math.exp(-e.deltaY * 0.01)));
    const c0 = [C[0] + S.vz.x, C[1] + S.vz.y], cx = e.clientX - (e.clientX - c0[0]) * k / k0, cy = e.clientY - (e.clientY - c0[1]) * k / k0;
    setZoom(k, cx - C[0], cy - C[1]);
  }, { passive: false });
}
function cancelStageGesture() {
  if (gesture && gesture.moved && gesture.snap0) { const g = gesture.snap0; writeProp(g.L, 'x', S.t, g.x); writeProp(g.L, 'y', S.t, g.y); }
  gesture = null; S.guides = []; drawFrame();
}

function drawFrame() {
  if (!P()) return;
  syncVideos(P(), S.t, S.playing);
  renderer.render(P(), S.t, view);
  drawOverlay();
  easeTick();
}

// composition coords -> the space a layer's x / y live in (its parent's local space, or the composition)
function parentInverse(L) {
  const par = L.parent && P().layers.find(l => l.id === L.parent);
  return par ? layerMatrix(par, S.t, P(), false).inverse() : new DOMMatrix();
}
// where the layer's pivot sits on the stage (rotation / pinch centre)
function pivotWorld(L) { return toWorld(L, valueAt(L, 'anchorX', S.t), valueAt(L, 'anchorY', S.t)); }
function toLocal(L, px, py) {
  const q = layerMatrix(L, S.t, P()).inverse().transformPoint({ x: px, y: py });
  return [q.x, q.y];
}
// local (content) -> stage coords; flip=false for the selection box/handles (symmetric, so the knob stays on top)
function toWorld(L, lx, ly, flip = true) {
  const q = layerMatrix(L, S.t, P(), flip).transformPoint({ x: lx, y: ly });
  return [q.x, q.y];
}
function layerCorners(L) {
  const tr = evalTransform(L, S.t), b = layerBounds(L, P(), view.getContext('2d'));
  const pt = (lx, ly) => toWorld(L, lx, ly, false);
  const corners = [pt(-b.w / 2, -b.h / 2), pt(b.w / 2, -b.h / 2), pt(b.w / 2, b.h / 2), pt(-b.w / 2, b.h / 2)];
  const mids = [0, 1, 2, 3].map(i => { const a = corners[i], c = corners[(i + 1) % 4]; return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; }); // top, right, bottom, left
  // Alight: a detached green rotation knob below the box on a thin stem
  const sgn = Math.sign(tr.scale) || 1;
  return { tr, b, pt, corners, mids, rotH: pt(0, b.h / 2 + sgn * 38 / (Math.abs(tr.scale) * viewScale || 1)) };
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
  // thin stem from the bottom edge to the green rotation knob
  ctx.lineWidth = 1.2 / k * dpr; ctx.beginPath(); ctx.moveTo(...g.mids[2]); ctx.lineTo(...g.rotH); ctx.stroke();
  // 8 white circular handles (corners + edge midpoints) with a soft dark rim
  const knob = (x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r / k * dpr, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3 * dpr; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 1 / k * dpr; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(); };
  [...c, ...g.mids].forEach(p => knob(p[0], p[1], 6, '#fff'));
  knob(...g.rotH, 8, ACCENT);
  drawGuides(ctx, k, dpr);
}
// red full-span snap guides (composition centre / edges, other layers' edges)
function drawGuides(ctx, k, dpr) {
  if (!S.guides.length) return;
  const p = P(); ctx.save(); ctx.strokeStyle = '#ff2d55'; ctx.lineWidth = 1.2 / k * dpr; ctx.beginPath();
  for (const gd of S.guides) { if (gd.x != null) { ctx.moveTo(gd.x, 0); ctx.lineTo(gd.x, p.h); } else { ctx.moveTo(0, gd.y); ctx.lineTo(p.w, gd.y); } }
  ctx.stroke(); ctx.restore();
}
// world-space AABB of a layer (optionally with its centre moved to cx, cy)
function layerAABB(L) {
  const g = layerCorners(L), xs = g.corners.map(q => q[0]), ys = g.corners.map(q => q[1]);
  const c = pivotWorld(L);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), cx: c[0], cy: c[1] };
}
// magnetic snapping: returns the snapped centre and the guides to draw
function snapMove(L, nx, ny) {
  const p = P(), box = layerAABB(L), thr = 8 / viewScale;
  const offX = [box.l - box.cx, (box.l + box.r) / 2 - box.cx, box.r - box.cx], offY = [box.t - box.cy, (box.t + box.b) / 2 - box.cy, box.b - box.cy];
  const tx = [0, p.w / 2, p.w], ty = [0, p.h / 2, p.h];
  for (const o of p.layers) {
    if (o === L || !o.visible || !visualLayer(o) || o.type === 'solid' || S.t < o.start || S.t >= o.end) continue;
    const ob = layerAABB(o); tx.push(ob.l, ob.cx, ob.r); ty.push(ob.t, ob.cy, ob.b);
  }
  const best = (c, offs, ts) => { let m = null; for (const of of offs) for (const t of ts) { const d = t - (c + of); if (Math.abs(d) < thr && (!m || Math.abs(d) < Math.abs(m.d))) m = { d, v: t }; } return m; };
  const bx = best(nx, offX, tx), by = best(ny, offY, ty), guides = [];
  if (bx) { nx += bx.d; for (const of of offX) for (const t of tx) if (Math.abs(nx + of - t) < 0.5) guides.push({ x: t }); }
  if (by) { ny += by.d; for (const of of offY) for (const t of ty) if (Math.abs(ny + of - t) < 0.5) guides.push({ y: t }); }
  return { nx, ny, guides };
}
// ---- handle drags: corners scale (uniform; free = per axis), edges scale one axis; size from centre / from edge / freely ----
const HANDLES = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]; // corners (tl tr br bl), then mids (top right bottom left)
function dimsOf(L) {
  if (L.type === 'shape' && L.shape.kind !== 'path') return { get: () => [valueAt(L, 'shape.w', S.t), valueAt(L, 'shape.h', S.t)], set: (w, h) => { writeProp(L, 'shape.w', S.t, w); writeProp(L, 'shape.h', S.t, h); } };
  if (L.type === 'shape') { const p0 = L.shape.pts.map(q => q.slice()), b = layerBounds(L, P(), null);
    return { get: () => [b.w, b.h], set: (w, h) => { const fx = w / b.w, fy = h / b.h; L.shape.pts = p0.map(([x, y]) => [+(x * fx).toFixed(1), +(y * fy).toFixed(1)]); } }; }
  if (L.type === 'image' || L.type === 'video') return { get: () => [L.media.w, L.media.h], set: (w, h) => { L.media.w = w; L.media.h = h; } };
  return null; // text / solid / drawing: one uniform scale
}
function startHandle(L, hi, px, py) {
  const g = layerCorners(L), tr = g.tr, d = dimsOf(L), [w0, h0] = d ? d.get() : [g.b.w, g.b.h], m0 = layerMatrix(L, S.t, P(), false), inv = m0.inverse();
  return { mode: 'handle', L, hi, sx: HANDLES[hi][0], sy: HANDLES[hi][1], x0: tr.x, y0: tr.y, s0: valueAt(L, 'scale', S.t), m0, inv, w0, h0, dims: d, bw: g.b.w, bh: g.b.h,
    p0: handleLocal(inv, px, py), moved: false };
}
// pointer -> local units of the box at the start of the drag (unflipped, unscaled content units)
function handleLocal(inv, px, py) { const q = inv.transformPoint({ x: px, y: py }); return [q.x, q.y]; }
function moveHandle(g, px, py) {
  const { L, sx, sy, s0 } = g, [lx, ly] = handleLocal(g.inv, px, py), mode = S.sizeMode;
  const fromEdge = mode !== 'center', corner = sx && sy, hw = g.bw / 2, hh = g.bh / 2;
  // anchor (local): the centre, or the opposite corner / edge
  const ax = fromEdge ? -sx * hw : 0, ay = fromEdge ? -sy * hh : 0;
  const ext = (v, a, sgn, half) => Math.max(1e-3, ((v - a) * sgn) / ((sgn * half - a) * sgn || 1)); // new/old extent from the anchor along one axis
  let fx = 1, fy = 1;
  if (sx) fx = ext(lx, ax, sx, hw);
  if (sy) fy = ext(ly, ay, sy, hh);
  const free = mode === 'free' || !corner;
  if (corner && !free) { const f = Math.max(1e-3, Math.hypot(lx - ax, ly - ay) / Math.hypot(sx * hw - ax, sy * hh - ay)); fx = fy = f; }
  if (!g.dims && (free || !corner)) { const f = sx && sy ? Math.sqrt(fx * fy) : sx ? fx : fy; fx = fy = f; } // no per-axis size: uniform
  // apply: per-axis -> dims; uniform -> the scale prop
  let cxl, cyl; // new centre in local units (relative to the old centre)
  if (g.dims && (fx !== fy || !corner || mode === 'free')) {
    g.dims.set(Math.max(1, Math.round(g.w0 * fx)), Math.max(1, Math.round(g.h0 * fy)));
    writeProp(L, 'scale', S.t, s0); cxl = ax + (0 - ax) * fx; cyl = ay + (0 - ay) * fy;
  } else {
    if (g.dims) g.dims.set(g.w0, g.h0);
    writeProp(L, 'scale', S.t, +Math.max(0.01, s0 * fx).toFixed(4)); cxl = ax * (1 - fx); cyl = ay * (1 - fy);
  }
  // move the layer so the box centre lands where it should (works with any pivot, skew or parent)
  writeProp(L, 'x', S.t, g.x0); writeProp(L, 'y', S.t, g.y0);
  const want = g.m0.transformPoint({ x: cxl, y: cyl }), cur = layerMatrix(L, S.t, P(), false).transformPoint({ x: 0, y: 0 });
  const toPar = parentInverse(L), a = toPar.transformPoint(want), b = toPar.transformPoint(cur); // x / y live in the parent's space
  writeProp(L, 'x', S.t, +(g.x0 + a.x - b.x).toFixed(2)); writeProp(L, 'y', S.t, +(g.y0 + a.y - b.y).toFixed(2));
  g.moved = true;
}
function setSizeMode(m) {
  S.sizeMode = m; localStorage.setItem('kntc.sizeMode', m); renderSizeModes();
  const badge = $('#modeBadge'); badge.textContent = SIZE_MODES.find(x => x[0] === m)[1];
  badge.classList.remove('show'); void badge.offsetWidth; badge.classList.add('show'); clearTimeout(badge._t); badge._t = setTimeout(() => badge.classList.remove('show'), 1200);
}
function renderSizeModes() {
  const box = $('#sizeModes'); if (!box) return;
  const L = selLayer(), show = !!(L && visualLayer(L) && !['draw', 'points', 'project'].includes(S.tab) && !S.full);
  box.hidden = !show;
  if (!box.firstChild) box.append(...SIZE_MODES.map(([m, label, ic]) => h('button', { class: 'szm', 'data-mode': m, title: label, 'aria-label': label, 'data-testid': 'size-mode-' + m, onclick: () => setSizeMode(m) }, icon(ic))));
  for (const b of box.children) b.classList.toggle('on', b.dataset.mode === S.sizeMode);
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
// a "tap" = released within TAP_MS and within TAP_SLOP px of where it went down (pans, long-presses and pinches never count)
const TAP_SLOP = 8, TAP_MS = 450;
const isTap = (g, e) => !g.cancel && performance.now() - g.t0 < TAP_MS && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= TAP_SLOP;
// the dark area around the preview canvas: a short tap deselects
function bindStageWrapTap() {
  const wrap = $('#stageWrap'); let g = null;
  wrap.addEventListener('pointerdown', e => { g = e.target === wrap && e.isPrimary && S.sel ? { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now() } : null; if (!e.isPrimary) g = null; });
  wrap.addEventListener('pointermove', e => { if (g && g.id === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_SLOP) g.cancel = true; });
  wrap.addEventListener('pointerup', e => { const t = g; g = null; if (t && t.id === e.pointerId && e.target === wrap && isTap(t, e) && S.sel) deselect(); });
  wrap.addEventListener('pointercancel', () => (g = null));
}
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
  if (ptrs.size === 2 && L && !VP.pinch) {
    const [a, b] = [...ptrs.values()];
    gesture = { mode: 'pinch', L, d0: Math.hypot(b[0] - a[0], b[1] - a[1]), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), s0: valueAt(L, 'scale', S.t), r0: valueAt(L, 'rotation', S.t) };
    return;
  }
  if (ptrs.size > 1) { if (gesture?.mode === 'tap') gesture = null; return; }
  if (L && L.type !== 'adjust' && L.type !== 'audio' && S.t >= L.start && S.t < L.end) {
    const g = layerCorners(L), tol = 22 / viewScale;
    if (Math.hypot(px - g.rotH[0], py - g.rotH[1]) < tol) { gesture = { mode: 'rotate', L, r0: valueAt(L, 'rotation', S.t), a0: (c => Math.atan2(py - c[1], px - c[0]))(pivotWorld(L)) }; return; }
    const hs = [...g.corners, ...g.mids], hi = hs.map((q, i) => [Math.hypot(px - q[0], py - q[1]), i]).filter(([d]) => d < tol).sort((a, b) => a[0] - b[0])[0];
    if (hi) { gesture = startHandle(L, hi[1], px, py); return; }
  }
  const hit = hitTest(px, py);
  if (hit) {
    if (hit.id !== S.sel) selectLayer(hit.id);
    gesture = { mode: 'move', L: hit, x0: valueAt(hit, 'x', S.t), y0: valueAt(hit, 'y', S.t), px, py, moved: false };
    gesture.snap0 = { L: hit, x: gesture.x0, y: gesture.y0 };
  } else gesture = S.sel ? { mode: 'tap', x: e.clientX, y: e.clientY, t0: performance.now() } : null; // deselect on release if it stays a short tap
  drawOverlay();
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = stagePoint(e); ptrs.set(e.pointerId, [px, py]);
  if (!gesture) return;
  if (gesture.mode === 'tap') { if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > TAP_SLOP) gesture.cancel = true; return; }
  const { L } = gesture;
  if (gesture.mode === 'stroke') {
    const lp = toLocal(L, px, py), last = gesture.st.pts[gesture.st.pts.length - 1];
    if (Math.hypot(lp[0] - last[0], lp[1] - last[1]) > 2 / viewScale) { gesture.st.pts.push(lp.map(v => +v.toFixed(1))); drawFrame(); }
    return;
  }
  if (gesture.mode === 'point') { L.shape.pts[gesture.i] = toLocal(L, px, py).map(v => +v.toFixed(1)); S.cursor = [px, py]; gesture.moved = true; drawFrame(); updateCursorBoxes(); return; }
  if (gesture.mode === 'move') {
    if (!gesture.moved && Math.hypot(px - gesture.px, py - gesture.py) * viewScale < 2) return;
    let sn;
    if (L.parent) { // x / y are in the parent's space: map the drag through it (no snapping)
      const m = parentInverse(L), a = m.transformPoint({ x: px, y: py }), b = m.transformPoint({ x: gesture.px, y: gesture.py });
      sn = { nx: gesture.x0 + a.x - b.x, ny: gesture.y0 + a.y - b.y, guides: [] };
    } else sn = snapMove(L, gesture.x0 + px - gesture.px, gesture.y0 + py - gesture.py);
    S.guides = sn.guides;
    writeProp(L, 'x', S.t, +sn.nx.toFixed(2)); writeProp(L, 'y', S.t, +sn.ny.toFixed(2)); gesture.moved = true;
  } else if (gesture.mode === 'handle') { moveHandle(gesture, px, py);
  } else if (gesture.mode === 'rotate') {
    const c = pivotWorld(L), a = Math.atan2(py - c[1], px - c[0]);
    let r = gesture.r0 + (a - gesture.a0) * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15;
    writeProp(L, 'rotation', S.t, +r.toFixed(1)); gesture.moved = true;
  } else if (gesture.mode === 'scale') {
    const c = pivotWorld(L), d = Math.hypot(px - c[0], py - c[1]);
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
  if (gesture?.mode === 'tap') { const g = gesture; gesture = null; if (e.type === 'pointerup' && ptrs.size === 0 && isTap(g, e)) deselect(); return; }
  if (gesture && ptrs.size === 0) { const g = gesture; gesture = null; const hadGuides = S.guides.length; S.guides = []; if (g.moved || g.mode === 'stroke') commit(); else if (hadGuides) drawFrame(); }
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
  drawFrame(); syncScroll(); updateTC(); renderPanelIfTime(); updateHeader(); updKfNav();
}
let kfNavRaf = 0;
function updKfNav() { if (kfNavRaf) return; kfNavRaf = requestAnimationFrame(() => { kfNavRaf = 0; if (!P()) return; const ks = keyTimes(); $('#btnKPrev').disabled = !ks.some(t => t < S.t - 1e-4); $('#btnKNext').disabled = !ks.some(t => t > S.t + 1e-4); }); }
let panelTimer;
function renderPanelIfTime() { if (['layer', 'ease', 'blend', 'fx'].includes(S.tab) && !(S.tab === 'fx' && document.activeElement?.closest?.('#panel .fx-num'))) { clearTimeout(panelTimer); panelTimer = setTimeout(renderPanel, 60); } }

const pad2 = n => String(n).padStart(2, '0');
const tc = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${pad2(m)}:${s.toFixed(2).padStart(5, '0')}`; };
const tcF = t => { const f = P().fps, tot = Math.round(t * f), s = Math.floor(tot / f); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}:${pad2(tot % f)}`; };
function updateTC() { $('#tcPill').textContent = tcF(S.t); }
function updateTransport() {
  $('#btnPlay').replaceChildren(icon(S.playing ? 'pause' : 'play'));
  $('#btnPlay').classList.toggle('on', S.playing);
  $('#btnUndo').disabled = !history.canUndo(); $('#btnRedo').disabled = !history.canRedo();
  $('#btnFit').classList.toggle('on', S.full);
  const ks = keyTimes(); $('#btnKPrev').disabled = !ks.some(t => t < S.t - 1e-4); $('#btnKNext').disabled = !ks.some(t => t > S.t + 1e-4);
  updateTC();
}
// keyframe times of the selected layer (or of every layer when nothing is selected)
function keyTimes() {
  const p = P(); if (!p) return [];
  const ls = selLayer() ? [selLayer()] : p.layers, ts = new Set();
  for (const L of ls) for (const { k } of allKeys(L)) ts.add(+k.t.toFixed(4));
  return [...ts].sort((a, b) => a - b);
}
function jumpKey(dir) {
  const ks = keyTimes(), t = dir < 0 ? [...ks].reverse().find(x => x < S.t - 1e-4) : ks.find(x => x > S.t + 1e-4);
  if (t == null) return toast(dir < 0 ? 'No earlier keyframe' : 'No later keyframe');
  seek(t); updateTransport();
}
const SUB_TITLE = { layer: 'Move & Transform', style: 'Color & Fill', border: 'Border & Shadow', fx: 'Effects', blend: 'Blending & Opacity', ease: 'Easing Curve', presets: 'Presets', project: 'Project Settings', points: 'Edit Points', draw: 'Drawing' };
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
  updHandles();
  if (S.playing && !(G.g || G.mom || G.pinch)) return; // playback drives the scroll, not the other way round
  const want = S.t * S.pps, dur = P().duration;
  if (Math.abs(tl.scrollLeft - want) < 1) return;
  if (S.t >= dur - 1e-9 && tl.scrollLeft > want) return; // panned past the end: the playhead stays at the end
  S.t = Math.max(0, Math.min(dur, tl.scrollLeft / S.pps));
  updateTC();
  if (!syncRaf) syncRaf = requestAnimationFrame(() => { syncRaf = 0; drawFrame(); updateHeader(); renderPanelIfTime(); updKfNav(); });
}
const viewT = () => Math.max(1, tl.clientWidth) / S.pps; // one screen of time
function contentEnd(p = P()) {
  let e = p.duration;
  for (const L of p.layers) { e = Math.max(e, L.end); for (const { k } of allKeys(L)) e = Math.max(e, k.t); }
  return e;
}
const MAX_INNER_PX = 400000;
const majStep = () => (S.pps >= 24 ? 1 : S.pps >= 8 ? 5 : 10);
const minStep = () => (S.pps >= 150 ? 1 / (P()?.fps || 30) : S.pps >= 50 ? 0.1 : S.pps >= 24 ? 0.25 : majStep() / 5);
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
  const p = P(), key = JSON.stringify([p.w, p.h, L.type, L.shape, L.text, L.solid, L.media, L.draw, L.props, L.flipX, L.flipY, media.has(L.media?.id)]);
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
// pill icon (Alight): the layer's own shape / media in its real colours on a transparent tile, fitted to a square
function pillThumb(L) {
  if (L.type === 'audio' || L.type === 'adjust' || L.type === 'text') return null;
  const p = P(), key = 'pill' + JSON.stringify([p.w, p.h, L.type, L.shape, L.solid, L.media?.id, L.media?.w, L.media?.h, L.draw, L.flipX, L.flipY, media.has(L.media?.id)]);
  if (THUMB.cache.has(key)) return THUMB.cache.get(key);
  let url = null;
  try {
    const N = 60, c = document.createElement('canvas'); c.width = c.height = N;
    const b = L.type === 'shape' ? layerBounds(L, p, c.getContext('2d')) : L.type === 'image' || L.type === 'video' ? { w: L.media.w, h: L.media.h } : { w: p.w, h: p.h };
    const k = (L.type === 'shape' ? 0.94 : 1) * N / Math.max(1, b.w, b.h);
    if (L.type === 'solid') { const g = c.getContext('2d'); g.fillStyle = L.solid.color; g.beginPath(); g.roundRect?.(N * 0.1, N * 0.1, N * 0.8, N * 0.8, 6); g.fill(); }
    else {
      THUMB.r = THUMB.r || new Renderer();
      const q = { ...p, w: N, h: N, bg: 'rgba(0,0,0,0)', layers: [{ ...L, effects: [], keys: {}, visible: true, start: 0, end: 1e9, blend: 'normal', shadow: null, clip: false,
        props: L.type === 'draw' ? { x: N / 2 - p.w * k / 2, y: N / 2 - p.h * k / 2, scale: k, rotation: 0, opacity: 1 } : { x: N / 2, y: N / 2, scale: k, rotation: 0, opacity: 1 } }] };
      THUMB.r.render(q, 0, c);
    }
    url = c.toDataURL();
  } catch (e) { console.warn(e); }
  THUMB.cache.set(key, url);
  return url;
}
// filmstrip frame for photo / video clips: the media at its own aspect, clip height, with a dark gap between frames
function stripThumb(L) {
  const key = 'strip' + JSON.stringify([L.media?.id, L.media?.w, L.media?.h, media.has(L.media?.id)]);
  if (THUMB.cache.has(key)) return THUMB.cache.get(key);
  let url = null;
  try {
    const H = 52, ar = Math.max(0.3, Math.min(3, (L.media.w || 1) / (L.media.h || 1))), W = Math.round(H * ar), G = 3, c = document.createElement('canvas');
    c.width = W + G; c.height = H;
    const el = media.get(L.media?.id)?.el, g = c.getContext('2d');
    g.fillStyle = '#2b2f42'; g.fillRect(0, 0, W, H);
    if (el) try { g.drawImage(el, 0, 0, W, H); } catch {}
    url = c.toDataURL();
  } catch (e) { console.warn(e); }
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
    const sel = L.id === S.sel, msel = S.multi.has(L.id), th = pillThumb(L), isMedia = L.type === 'image' || L.type === 'video';
    const label = h('div', { class: 'tl-label', onclick: () => selectLayer(L.id) },
      h('button', { class: 'vis' + (L.visible ? '' : ' off'), title: 'Visibility', 'data-testid': 'vis', onclick: ev => { ev.stopPropagation(); L.visible = !L.visible; commit(); } }, icon(L.visible ? 'eye' : 'eyeoff')),
      th ? h('img', { class: 'th' + (isMedia ? ' m' : ''), src: th, alt: '' }) : icon(TYPE_ICON[L.type] || 'layer', 'th ti'));
    const track = h('div', { class: 'tl-track' });
    const st = isMedia ? stripThumb(L) : null, strip = st ? { backgroundImage: `url(${st})` } : {};
    const tag = L.tag ? { '--tag': L.tag } : {};
    const clip = h('div', { class: 'clip t-' + L.type + (sel ? ' sel' : '') + (msel ? ' msel' : '') + (L.visible ? '' : ' hidden') + (strip.backgroundImage ? ' strip' : '') + (L.tag ? ' tagged' + (isLight(L.tag) ? ' lt' : '') : ''),
      'data-tag': L.tag || null, style: { left: L.start * S.pps + 'px', width: Math.max(4, (L.end - L.start) * S.pps) + 'px', ...strip, ...tag } },
      h('b', { class: 'trim l' }), h('span', { class: 'cn' }, strip.backgroundImage ? '' : L.name), h('b', { class: 'trim r' }));
    bindClip(clip, L);
    track.append(clip);
    // merged keyframe diamonds (one per time); in Effects, only the selected parameter's diamonds are lit
    const focus = sel && S.tab === 'fx' ? fxEaseTarget(L) : null;
    const times = new Map();
    for (const { prop, k } of allKeys(L)) { const key = k.t.toFixed(3); if (!times.has(key)) times.set(key, []); times.get(key).push({ prop, k }); }
    for (const [tk, list] of times) {
      const on = list.some(x => S.selKeys.has(x.k.id));
      const lit = focus ? (list.some(x => x.prop === focus) ? ' hi' : ' lo') : '';
      const d = h('i', { class: 'kf' + (on ? ' on' : '') + lit, style: { left: (+tk) * S.pps + 'px' }, 'data-testid': 'kf' });
      bindKey(d, L, list); track.append(d);
    }
    // ☰ reorder handle: pinned to the right edge of the view (sticky), drawn dark over a clip and grey over empty track
    const hd = h('div', { class: 'tl-hd', title: 'Drag to reorder', 'data-testid': 'reorder' }, h('i'), h('i'), h('i'));
    bindReorderMouse(hd, L);
    inner.append(h('div', { class: 'tl-row' + (sel || msel ? ' sel' : '') + (L.clip && layerBelow(L) ? ' clipped' : ''), 'data-layer': L.id }, label, track, hd));
  }
  if (!p.layers.length) inner.append(h('div', { class: 'tl-empty' }, 'Tap + to add a layer'));
  // empty space below the last track (pannable)
  inner.append(h('div', { class: 'tl-row tl-pad', 'data-testid': 'tl-pad', style: { height: Math.max(44, Math.round(tl.clientHeight * 0.45)) + 'px' } },
    h('div', { class: 'tl-label pad' }), h('div', { class: 'tl-track pad' })));
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
  placeEnd(); G.updBars?.(); updHandles();
}
// the ☰ handles sit at a fixed spot on screen; colour them by whether the layer's clip is under them right now
function updHandles() {
  const p = P(), inner = $('#tlInner'); if (!p || !inner) return;
  const t = (tl.scrollLeft + tl.clientWidth - 20 - tlOriginX()) / S.pps;
  for (const row of inner.querySelectorAll('.tl-row[data-layer]')) {
    const L = p.layers.find(l => l.id === row.dataset.layer), hd = row.lastChild;
    if (L && hd?.classList.contains('tl-hd')) hd.classList.toggle('on', t >= L.start && t <= L.end);
  }
}
// ---- layer reorder by dragging the ☰ handle vertically (touch: via the gesture controller; mouse: directly) ----
function reorderStart(row, L) {
  const rows = [...$('#tlInner').querySelectorAll('.tl-row[data-layer]')], ix = P().layers.indexOf(L);
  row.classList.add('reorder'); tl.classList.add('reordering');
  return { row, L, rows, ix, to: ix, st0: tl.scrollTop };
}
function reorderMove(r, dy) {
  dy += tl.scrollTop - r.st0;
  const n = r.rows.length, to = Math.max(0, Math.min(n - 1, r.ix + Math.round(dy / ROW_H)));
  r.row.style.transform = `translateY(${dy}px)`;
  if (to !== r.to) {
    r.to = to;
    r.rows.forEach((el, i) => { if (el === r.row) return; const shift = i > r.ix && i <= to ? -ROW_H : i < r.ix && i >= to ? ROW_H : 0; el.style.transform = shift ? `translateY(${shift}px)` : ''; });
    navigator.vibrate?.(5);
  }
}
function reorderEnd(r) {
  r.rows.forEach(el => (el.style.transform = '')); r.row.classList.remove('reorder'); tl.classList.remove('reordering');
  if (r.to === r.ix) return;
  const ls = P().layers; ls.splice(r.ix, 1); ls.splice(r.to, 0, r.L); commit();
}
function bindReorderMouse(hd, L) {
  hd.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    e.stopPropagation(); e.preventDefault(); hd.setPointerCapture(e.pointerId);
    const y0 = e.clientY, r = reorderStart(hd.parentElement, L);
    const mv = ev => reorderMove(r, ev.clientY - y0);
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); reorderEnd(r); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
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
    const hit = e.target.closest('.kf, .clip, .tl-end-h'), hd = e.target.closest('.tl-hd');
    const g = G.g = { hd, id: e.pointerId, x0: e.clientX, y0: e.clientY, sl: tl.scrollLeft, st: tl.scrollTop, mode: 'pending', target: e.target,
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
      if (g.hd && Math.abs(dy) > Math.abs(dx)) { g.mode = 'reorder'; G.noClick = true; g.r = reorderStart(g.hd.parentElement, P().layers.find(l => l.id === g.hd.parentElement.dataset.layer)); navigator.vibrate?.(8); }
      else if (g.item && g.armed) { grab(g, g.x0); }
      else { g.mode = 'pan'; G.noClick = true; const ax = Math.abs(dx), ay = Math.abs(dy); g.axis = S.sel ? 'x' : ax > 2 * ay ? 'x' : ay > 2 * ax ? 'y' : 'xy'; } // a selection locks panning to horizontal (Alight)
    }
    if (g.mode === 'pan') {
      if (g.axis !== 'y') panX(g.sl - dx);
      if (g.axis !== 'x') tl.scrollTop = g.st - dy;
    } else if (g.mode === 'reorder') { reorderMove(g.r, dy);
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
    else if (g.mode === 'reorder') { G.noClick = true; reorderEnd(g.r); }
    else if (g.mode === 'pan') { if (G.rb) { releaseRb(); if (g.axis !== 'x') startMomentum({ ...g, axis: 'y' }); } else startMomentum(g); }
    else if (g.mode === 'pending' && g.item && e.type === 'pointerup') { G.noClick = true; G.swallow = performance.now() + 450; g.spec.onEnd?.(false, g.spec.onStart?.({ target: g.target, clientX: e.clientX }) || {}, e); }
  };
  tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', up);
  tl.addEventListener('lostpointercapture', up);
  // a pan / drag / pinch must not end in a click (deselect on empty track, select on a pill)
  // a tap that selects a clip / key re-lays out the bottom zone (panel opens); the synthetic click that follows must not
  // land on whatever is now under the finger (a tile of the new panel)
  window.addEventListener('click', e => { if (G.swallow && performance.now() < G.swallow && !tl.contains(e.target)) { G.swallow = 0; e.stopPropagation(); e.preventDefault(); } }, true);
  tl.addEventListener('click', e => { if (G.noClick) { G.noClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  // a short tap on empty timeline space (beside / below the rows, past the end; not the ruler band, pills, clips or keys) deselects
  let tapDown = null;
  tl.addEventListener('pointerdown', e => { if (e.isPrimary) tapDown = { x: e.clientX, y: e.clientY, t0: performance.now() }; }, true);
  tl.addEventListener('click', e => {
    if (!(S.sel || S.multi.size) || !tapDown || !isTap(tapDown, e)) return;
    if (e.target.closest('.clip, .kf, .tl-head, .tl-end-h, .tl-hd, button, .tl-label:not(.pad)')) return;
    deselect();
  });
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
  const scrollable = t => t.closest?.('.lm-in, .lm-tags, #panelBody, .tiles, .sh-body, .h-scroll, .h-pills, .cr-body, .fxb-scroll, dialog, textarea, select, input');
  document.addEventListener('touchmove', e => { if (e.cancelable && (e.touches.length > 1 || !scrollable(e.target))) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
}
const snapT = t => { const f = P().fps; return Math.round(t * f) / f; };
function bindClip(clip, L) {
  bindDrag(clip, {
    onStart: e => ({ mode: e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm', s0: L.start, e0: L.end, o0: L.media?.offset, snap: clone(L.keys) }),
    onMove: (dt, c) => {
      // start never goes below 0; the end may run past the project duration (not rendered there, like Alight)
      if (c.mode === 'l') { L.start = c.s0; if (L.media) L.media.offset = c.o0; setStart(L, Math.min(L.end - 0.05, Math.max(0, snapT(c.s0 + dt)))); }
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
      S.sel = L.id; S.multi.clear();
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
    case 'fx': if (L) ({ content, left } = panelFx(L)); else content = need('Select a layer.'); break;
    case 'blend': content = L ? panelBlend(L) : need('Select a layer.'); break;
    case 'ease': ({ content, left, right } = fxPanelEase(L)); break;
    case 'presets': content = L ? panelPresets(L) : need('Select a layer.'); break;
    case 'project': content = panelProject(); break;
    case 'points': ({ content, left } = panelPoints(L)); break;
    case 'draw': ({ content, right } = panelDraw(L)); break;
    default: content = h('div');
  }
  const body = h('div', { id: 'panelBody', class: 'sub-body' + (S.tab === 'points' || S.tab === 'draw' || S.tab === 'ease' ? ' tool' : '') + (S.tab === 'fx' ? ' fxbody' : '') + (S.tab === 'ease' ? ' ezbody' : '') }, content);
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
      T('presets', 'presets', 'Presets', open('presets')),
      T('fx', 'effects', 'Effects', open('fx'), visual ? '' : 'off')),
    h('div', { class: 'trow four' },
      T('ease', 'ease', 'Easing', open('ease')),
      T('up', 'up', 'Move Up', () => moveLayer(L, -1)),
      T('down', 'down', 'Move Down', () => moveLayer(L, 1)),
      T('lock', L.locked ? 'lock' : 'unlock', L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; commit(); })));
}

function propKeyState(L, prop) { return findKey(L, prop, S.t) ? 2 : hasKeys(L, prop) ? 1 : 0; }
const keyToggle = (L, prop) => ({ state: propKeyState(L, prop), toggle: () => { const q = findKey(L, prop, S.t); if (q) removeKey(L, prop, q.id); else setKey(L, prop, S.t, valueAt(L, prop, S.t)); commit(); } });
// keyframeable colour / number for a nested value ('text.fill', 'shadow.blur' …): ◆ keys it at the playhead,
// and once it is animated every edit writes a key
function keyColor(L, prop, label, testid) {
  return color({ label, value: valueAt(L, prop, S.t), key: keyToggle(L, prop), testid, onInput: liveSet(v => writeProp(L, prop, S.t, v)), onChange: v => { writeProp(L, prop, S.t, v); commit(); } });
}
function keyNum(L, prop, label, min, max, step = 1, testid) {
  return slider({ label, value: valueAt(L, prop, S.t), min, max, step, testid, key: keyToggle(L, prop),
    onInput: liveSet(v => writeProp(L, prop, S.t, v)), onChange: () => { commit({ silent: true }); renderTimeline(); } });
}

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
  out.append(section('Transform  ·  ◆ = keyframe at playhead', ...rows,
    ...XFORM_PROPS.map(prop => keyNum(L, prop, PROP_META[prop].label, PROP_META[prop].min, PROP_META[prop].max, PROP_META[prop].step, 'prop-' + prop))));
  out.append(section('Timing',
    slider({ label: 'In', value: L.start, min: 0, max: Math.max(P().duration, L.end), step: 0.01, onInput: liveSet(v => setStart(L, Math.min(v, L.end - 0.05))), onChange: () => commit() }),
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
  const N = (label, obj, k, min, max, step = 1, tid) => slider({ label, value: obj[k], min, max, step, testid: tid, onInput: liveSet(v => (obj[k] = v)), onChange: () => { commit({ silent: true }); renderTimeline(); } });
  const T = (label, obj, k) => toggle({ label, value: obj[k], onChange: v => { obj[k] = v; commit(); } });
  return { N, T };
}
function panelStyle(L) {
  const out = h('div', {}), { T } = fieldMakers(L);
  if (L.type === 'shape') {
    const s = L.shape;
    out.append(section('Fill', T('Fill', s, 'fillOn'), keyColor(L, 'shape.fill', 'Color', 'fill-color'), T('Gradient', s, 'gradient'), s.gradient ? keyColor(L, 'shape.fill2', 'Color 2') : null, s.gradient ? keyNum(L, 'shape.gradAngle', 'Angle', 0, 360) : null));
  } else if (L.type === 'text') out.append(section('Color', keyColor(L, 'text.fill', 'Fill', 'fill-color')));
  else if (L.type === 'solid') {
    const s = L.solid;
    out.append(section('Solid', keyColor(L, 'solid.color', 'Color', 'fill-color'), T('Gradient', s, 'gradient'), s.gradient ? keyColor(L, 'solid.fill2', 'Color 2') : null, s.gradient ? keyNum(L, 'solid.gradAngle', 'Angle', 0, 360) : null));
  } else if (L.type === 'draw') out.append(h('div', { class: 'hint' }, 'Drawing colours are picked per stroke in Edit Drawing.'), h('button', { class: 'act', onclick: () => openSub('draw') }, icon('freehand'), 'Edit Drawing'));
  else if (L.type === 'image' || L.type === 'video') out.append(h('div', { class: 'hint' }, 'Media layers keep their own colours — try Effects › Color Adjust.'));
  else out.append(h('div', { class: 'hint' }, 'Adjustment layers have no fill — add effects; they apply to everything below.'));
  return out;
}
// ---- Alight "Size" ruler: a horizontally scrolling scale under a fixed green centre tick (swipe anywhere on it) ----
// value moves under the tick: 8px per minor step, labels every 5 steps; X / Y number boxes on the right
function rulerSlider({ label, value, min, max, step = 10, onInput, onChange, right, testid }) {
  const PX = 8 / step; // css px per unit
  const cv = h('canvas', { class: 'rs-cv' }), val = h('b', { class: 'rs-val', 'data-testid': testid ? testid + '-value' : null });
  const track = h('div', { class: 'rs-track', 'data-testid': testid }, cv, h('i', { class: 'rs-tick' }));
  let v = value;
  const draw = () => {
    const w = track.clientWidth, hh = track.clientHeight; if (!w) return;
    const dpr = Math.min(3, devicePixelRatio || 1); if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const c = w / 2, first = Math.floor((v - c / PX) / step) * step;
    g.font = '600 10px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center'; g.fillStyle = '#7c7f91'; g.strokeStyle = '#5a5e72';
    for (let u = first; u <= v + c / PX + step; u += step) {
      if (u < min - 1e-9 || u > max + 1e-9) continue;
      const x = c + (u - v) * PX, major = Math.round(u / step) % 5 === 0;
      g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + .5, major ? 8 : 13); g.lineTo(Math.round(x) + .5, 22); g.stroke();
      if (major) g.fillText(String(Math.round(u)), x, hh - 3);
    }
    val.textContent = String(Math.round(v));
  };
  const set = (nv, fire) => { nv = Math.max(min, Math.min(max, nv)); if (nv === v) return; v = nv; draw(); if (fire) onInput?.(v); };
  let drag = null;
  track.addEventListener('pointerdown', e => { e.preventDefault(); track.setPointerCapture(e.pointerId); drag = { x: e.clientX, v0: v, moved: false, last: [{ x: e.clientX, t: performance.now() }] }; cancelAnimationFrame(track._mom); });
  track.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 2) drag.moved = true;
    drag.last.push({ x: e.clientX, t: performance.now() }); if (drag.last.length > 5) drag.last.shift();
    set(drag.v0 - dx / PX, true);
  });
  const end = () => {
    if (!drag) return; const d = drag; drag = null; if (!d.moved) return;
    const a = d.last[0], b = d.last[d.last.length - 1], vel = (b.x - a.x) / Math.max(16, b.t - a.t); // px/ms
    let sp = -vel / PX * 16; // units per frame
    const step_ = () => { if (Math.abs(sp) < 0.3) { onChange?.(v); return; } set(v + sp, true); sp *= 0.92; track._mom = requestAnimationFrame(step_); };
    if (Math.abs(sp) > 1) track._mom = requestAnimationFrame(step_); else onChange?.(v);
  };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  new ResizeObserver(draw).observe(track);
  const row = h('div', { class: 'rs' }, h('div', { class: 'rs-head' }, h('label', {}, label), val, h('span', { class: 'sp' }), right || ''), track);
  row.set = nv => { v = nv; draw(); };
  requestAnimationFrame(draw);
  return row;
}
function panelEdit(L) {
  const out = h('div', {}), { N } = fieldMakers(L);
  const big = Math.max(P().w, P().h) * 1.5;
  if (L.type === 'shape') {
    const s = L.shape;
    // keyframeable shape geometry (◆ = keyframe at playhead): Width / Height / Corner morph between keys
    const K = (label, k, min, max, tid) => { const prop = 'shape.' + k; return slider({ label, value: valueAt(L, prop, S.t), min, max, step: 1, testid: tid,
      onInput: liveSet(v => writeProp(L, prop, S.t, v)), onChange: () => { commit({ silent: true }); renderTimeline(); },
      key: { state: propKeyState(L, prop), toggle: () => { const q = findKey(L, prop, S.t); if (q) removeKey(L, prop, q.id); else setKey(L, prop, S.t, valueAt(L, prop, S.t)); commit(); } } }); };
    // Size ruler (keeps the aspect) + X / Y boxes on the right
    const xy = (k, tid) => { const i = h('input', { type: 'number', class: 'num rs-num', min: 1, max: big, step: 1, value: Math.round(valueAt(L, 'shape.' + k, S.t)), inputmode: 'numeric', 'data-testid': tid });
      i.onchange = () => { const v = Math.max(1, Math.min(big, Math.round(+i.value) || 1)); writeProp(L, 'shape.' + k, S.t, v); commit(); }; return i; };
    const nx = xy('w', 'size-x'), ny = xy('h', 'size-y');
    const sw = valueAt(L, 'shape.w', S.t), ar = valueAt(L, 'shape.h', S.t) / (sw || 1);
    const size = rulerSlider({ label: 'Size', value: Math.round(sw), min: 1, max: big, step: 10, testid: 'size-ruler',
      onInput: v => { writeProp(L, 'shape.w', S.t, Math.round(v)); writeProp(L, 'shape.h', S.t, Math.max(1, Math.round(v * ar))); nx.value = Math.round(v); ny.value = Math.max(1, Math.round(v * ar)); drawFrame(); }, onChange: () => { commit({ silent: true }); renderTimeline(); },
      right: h('span', { class: 'rs-xy' }, h('em', {}, 'X'), nx, h('em', {}, 'Y'), ny) });
    out.append(section('Size', size));
    out.append(section('Shape', chips(SHAPE_KINDS.map(k => [k, k]), s.kind, v => { s.kind = v; commit(); }),
      K('Width', 'w', 1, big, 'shape-w'), K('Height', 'h', 1, big, 'shape-h'),
      s.kind === 'rect' ? K('Corner', 'radius', 0, Math.max(1, Math.round(Math.min(valueAt(L, 'shape.w', S.t), valueAt(L, 'shape.h', S.t)) / 2)), 'shape-radius') : null,
      s.kind === 'star' || s.kind === 'polygon' ? N('Points', s, 'points', 3, 24) : null,
      s.kind === 'star' ? keyNum(L, 'shape.inner', 'Inner', 0.05, 1, 0.01) : null,
      s.kind === 'ring' ? keyNum(L, 'shape.thickness', 'Thickness', 0.02, 1, 0.01) : null),
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
      keyNum(L, 'text.size', 'Size', 8, 800, 1, 'text-size'), N('Weight', t, 'weight', 100, 900, 100), keyNum(L, 'text.tracking', 'Tracking', -0.2, 1, 0.01, 'text-tracking'), keyNum(L, 'text.lineHeight', 'Line Ht', 0.6, 3, 0.05),
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
  if (L.type === 'shape') out.append(section('Border', keyNum(L, 'shape.strokeW', 'Width', 0, 120, 1, 'border-width'), keyColor(L, 'shape.stroke', 'Color', 'border-color')));
  else if (L.type === 'text') out.append(section('Border', keyNum(L, 'text.strokeW', 'Width', 0, 60, 1, 'border-width'), keyColor(L, 'text.stroke', 'Color', 'border-color')));
  if (L.type === 'adjust') { out.append(h('div', { class: 'hint' }, 'Adjustment layers have no border or shadow.')); return out; }
  const sh = L.shadow || (L.shadow = { on: false, color: '#000000', blur: 24, dx: 0, dy: 16, alpha: 0.6 });
  out.append(section('Shadow', toggle({ label: 'Shadow', value: sh.on, testid: 'shadow-on', onChange: v => { sh.on = v; commit(); } }),
    sh.on ? keyColor(L, 'shadow.color', 'Color', 'shadow-color') : null, sh.on ? keyNum(L, 'shadow.blur', 'Blur', 0, 200, 1, 'shadow-blur') : null,
    sh.on ? keyNum(L, 'shadow.dx', 'Offset X', -200, 200) : null, sh.on ? keyNum(L, 'shadow.dy', 'Offset Y', -200, 200) : null,
    sh.on ? keyNum(L, 'shadow.alpha', 'Opacity', 0, 1, 0.01) : null));
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
    select({ label: 'Resolution', value: String(Math.min(p.w, p.h)), testid: 'proj-res', options: RESOLUTIONS.map(([v, t]) => [String(v), t]).concat(RESOLUTIONS.some(r => r[0] === Math.min(p.w, p.h)) ? [] : [[String(Math.min(p.w, p.h)), Math.min(p.w, p.h) + 'p']]), onChange: v => changeResolution(+v) }),
    select({ label: 'FPS', value: String(p.fps), testid: 'proj-fps', options: [['24', '24'], ['25', '25'], ['30', '30'], ['48', '48'], ['50', '50'], ['60', '60']], onChange: v => { p.fps = +v; commit(); } }),
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
      tile('adjust', 'Adjustment', () => { const L = makeLayer(P(), 'adjust'); addLayer(L, { tab: 'fx' }); }, 'add-adjust'),
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
function openSheet(tabId) { S.multi.clear(); if (S.sel) { S.sel = null; S.selKeys.clear(); } S.tab = 'add'; if (tabId) S.addTab = tabId; refreshAll(); }

// ---- ⋯ layer menu: Alight-style dropdown anchored under the ⋯ button (tap outside to close) ----
// colour tags shown on the layer's timeline clip (sampled from the reference swatches)
const TAGS = [null, '#e34829', '#c8495c', '#da8d57', '#faeb90', '#8be1d4', '#5aa9e6', '#7b6cf0', '#b66ee0', '#9a9ca8'];
const isLight = c => { const n = parseInt(c.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170; };
const visualLayer = L => L.type !== 'audio' && L.type !== 'adjust';
// Fit / Fill / Stretch to the composition: centred, unrotated, scaled relative to the canvas
function fitLayer(L, how) {
  const p = P(), b = layerBounds(L, p, view.getContext('2d'));
  if (!(b.w > 0 && b.h > 0)) return;
  let sc;
  if (how === 'stretch') {
    const kx = p.w / b.w, ky = p.h / b.h;
    if (L.type === 'shape' && L.shape.kind === 'path') L.shape.pts = L.shape.pts.map(([x, y]) => [+(x * kx).toFixed(1), +(y * ky).toFixed(1)]);
    else if (L.type === 'shape') { L.shape.w = p.w; L.shape.h = p.h; }
    else if (L.type === 'image' || L.type === 'video') { L.media.w = p.w; L.media.h = p.h; }
    sc = 1;
  } else sc = (how === 'fit' ? Math.min : Math.max)(p.w / b.w, p.h / b.h);
  writeProp(L, 'x', S.t, p.w / 2); writeProp(L, 'y', S.t, p.h / 2); writeProp(L, 'rotation', S.t, 0); writeProp(L, 'scale', S.t, +sc.toFixed(4));
  commit();
}
function convertToOutline(L) {
  const sh = L.shape; if (!sh.fillOn && sh.strokeW > 0) return toast('Already an outline');
  if (sh.fillOn) sh.stroke = sh.fill; // the outline takes the fill colour
  sh.fillOn = false; sh.strokeW = Math.max(sh.strokeW || 0, Math.round(Math.min(P().w, P().h) * 0.012)); commit();
}
const layerBelow = L => { const ls = P().layers; return ls[ls.indexOf(L) + 1] || null; };
function toggleClip(L) { L.clip = !L.clip; commit(); toast(L.clip ? 'Clipped to ' + (layerBelow(L)?.name || 'layer below') : 'Clipping mask released'); }
let layerMenu = null, lmWrap = null;
function closeLayerMenu() { if (!layerMenu) return; lmWrap.remove(); layerMenu = lmWrap = null; $('#btnMore').classList.remove('on'); }
function openLayerMenu() {
  const L = selLayer(); if (!L) return;
  if (layerMenu) return closeLayerMenu();
  const vis = visualLayer(L), below = layerBelow(L), clipOk = vis && below && visualLayer(below);
  const it = (label, tid, fn, why = '') => h('button', { class: 'lm-it' + (why ? ' off' : ''), 'data-testid': 'lm-' + tid, 'aria-disabled': why ? 'true' : null,
    onclick: () => { if (why) return toast(why); closeLayerMenu(); fn(); } }, h('span', {}, label));
  const hr = () => h('i', { class: 'lm-hr' });
  const noVis = vis ? '' : 'Not available for ' + (L.type === 'audio' ? 'audio' : 'adjustment') + ' layers';
  const tags = h('div', { class: 'lm-tags', 'data-testid': 'lm-tags' }, ...TAGS.map((c, i) => h('button', {
    class: 'lm-sw' + (c ? '' : ' none') + ((L.tag || null) === c ? ' on' : ''), style: c ? { '--c': c } : {}, title: c ? 'Colour tag' : 'No colour tag', 'aria-label': c ? 'Tag ' + c : 'No tag',
    'data-testid': 'lm-tag-' + i, onclick: () => { L.tag = c; if (!c) delete L.tag; closeLayerMenu(); commit(); } })));
  const lmIn = h('div', { class: 'lm-in' },
    it('Save to My Elements', 'save', soon('Save to My Elements')),
    it('Flip Horizontally', 'flip-h', () => { L.flipX = !L.flipX; commit(); }, noVis),
    it('Flip Vertically', 'flip-v', () => { L.flipY = !L.flipY; commit(); }, noVis),
    it('Fit Composition Area', 'fit', () => fitLayer(L, 'fit'), noVis),
    it('Fill Composition Area', 'fill', () => fitLayer(L, 'fill'), noVis),
    it('Stretch to Composition Area', 'stretch', () => fitLayer(L, 'stretch'), noVis || (L.type === 'text' ? 'Text can’t be stretched — use Fit or Fill' : '')),
    hr(),
    it(L.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', 'clip', () => toggleClip(L), L.clip || clipOk ? '' : 'Needs a visual layer below this one'),
    it('Convert to Outline', 'outline', () => convertToOutline(L), L.type === 'shape' ? '' : 'Convert to Outline works on shapes'),
    hr(), tags, hr(),
    it('Center on Canvas', 'center', () => { writeProp(L, 'x', S.t, P().w / 2); writeProp(L, 'y', S.t, P().h / 2); commit(); }),
    it(L.visible ? 'Hide Layer' : 'Show Layer', 'hide', () => { L.visible = !L.visible; commit(); }),
    it(L.locked ? 'Unlock' : 'Lock', 'lock', () => { L.locked = !L.locked; commit(); }),
    it('Move Up', 'up', () => moveLayer(L, -1)), it('Move Down', 'down', () => moveLayer(L, 1)),
    it('Easing', 'ease', () => openSub('ease')),
    it('Rename', 'rename', () => { const n = $('#layerName'); n.focus(); n.select(); }));
  layerMenu = h('div', { class: 'lm', role: 'menu', 'data-testid': 'layer-menu' }, lmIn);
  const scrim = h('div', { class: 'lm-scrim', 'data-testid': 'layer-menu-scrim' });
  // tap outside closes; the tap is swallowed (it does not deselect / hit what is underneath)
  const close = e => { e.preventDefault(); e.stopPropagation(); closeLayerMenu(); };
  scrim.addEventListener('pointerdown', close); scrim.addEventListener('click', e => e.stopPropagation());
  lmWrap = h('div', { class: 'lm-wrap' }, scrim, layerMenu);
  document.body.append(lmWrap);
  const r = $('#btnMore').getBoundingClientRect(), right = Math.max(8, innerWidth - r.right + 4 - 14);
  layerMenu.style.right = right + 'px'; layerMenu.style.top = r.bottom + 12 + 'px';
  layerMenu.style.setProperty('--ax', (innerWidth - right - (r.left + r.width / 2)) + 'px'); // arrow x from the menu's right edge
  lmIn.style.maxHeight = `calc(100dvh - ${Math.round(r.bottom + 12 + 10)}px - var(--safe-b))`;
  // iOS-style auto-shrink: labels that don't fit get a smaller font (Alight's "Stretch to Composition Area")
  for (const sp of layerMenu.querySelectorAll('.lm-it span')) { let f = 17; while (sp.scrollWidth > sp.clientWidth + 0.5 && f > 11) sp.style.fontSize = (f -= 0.5) + 'px'; }
  $('#btnMore').classList.add('on');
}
// ---- ⧉ copy menu (transport row): Select All / Duplicate / Copy / Save Preset / Paste Layer / Paste Style ----
// clipboard + presets live in localStorage so they work across projects (media blobs are shared in IndexedDB)
const CLIP_KEY = 'kntc.clipboard', PRESET_KEY = 'kntc.presets';
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const readClip = () => readJSON(CLIP_KEY, null);
const listPresets = () => readJSON(PRESET_KEY, []);
const savePresets = ps => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(ps)); return true; } catch { toast('Storage full'); return false; } };
const targets = () => (S.multi.size ? P().layers.filter(l => S.multi.has(l.id)) : selLayer() ? [selLayer()] : []);
function freshIds(c) { c.id = uid(); for (const p in c.keys || {}) c.keys[p].forEach(k => (k.id = uid())); c.keys = c.keys || {}; c.effects = c.effects || []; migrateLayer(c); renewFxIds(c); return c; }
// style = fill, border (stroke), shadow, effects, blending, opacity (incl. its keyframes)
const STYLE_PARTS = [['fill', 'Fill'], ['stroke', 'Border'], ['shadow', 'Shadow'], ['effects', 'Effects'], ['blend', 'Blending'], ['opacity', 'Opacity']];
function styleOf(L) {
  const st = { from: L.type, effects: clone(L.effects || []), blend: L.blend || 'normal', opacity: { v: L.props.opacity, keys: clone(L.keys?.opacity || []) } };
  if (L.type === 'shape') { const s = L.shape; st.fill = { fill: s.fill, fill2: s.fill2, gradient: s.gradient, gradAngle: s.gradAngle, fillOn: s.fillOn }; st.stroke = { stroke: s.stroke, strokeW: s.strokeW }; }
  else if (L.type === 'text') { st.fill = { fill: L.text.fill }; st.stroke = { stroke: L.text.stroke, strokeW: L.text.strokeW }; }
  else if (L.type === 'solid') st.fill = { fill: L.solid.color, fill2: L.solid.fill2, gradient: L.solid.gradient, gradAngle: L.solid.gradAngle };
  if (L.shadow) st.shadow = clone(L.shadow);
  return st;
}
function applyStyle(L, st, parts) {
  const want = k => parts.includes(k) && st[k] != null;
  if (want('fill')) {
    const f = st.fill;
    if (L.type === 'shape') Object.assign(L.shape, Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
    else if (L.type === 'text') L.text.fill = f.fill;
    else if (L.type === 'solid') { L.solid.color = f.fill; for (const k of ['fill2', 'gradient', 'gradAngle']) if (f[k] !== undefined) L.solid[k] = f[k]; }
  }
  if (want('stroke') && (L.type === 'shape' || L.type === 'text')) Object.assign(L[L.type], st.stroke);
  if (want('shadow') && visualLayer(L)) L.shadow = clone(st.shadow);
  if (want('effects') && L.type !== 'audio') L.effects = clone(st.effects).map(f => ((f.id = uid()), f));
  if (want('blend') && L.type !== 'audio') L.blend = st.blend;
  if (want('opacity') && L.type !== 'audio') {
    L.props.opacity = st.opacity.v;
    if (st.opacity.keys?.length) L.keys.opacity = clone(st.opacity.keys).map(k => ((k.id = uid()), k)); else delete L.keys.opacity;
  }
}
const ALL_PARTS = STYLE_PARTS.map(p => p[0]);
function selectAllLayers() {
  const ls = P().layers; if (!ls.length) return;
  S.sel = null; S.selKeys.clear(); S.tab = null; S.multi = new Set(ls.map(l => l.id));
  refreshAll(); toast(ls.length === 1 ? '1 layer selected' : `All ${ls.length} layers selected`);
}
function duplicateLayers() {
  const ts = targets(); if (!ts.length) return;
  if (ts.length === 1 && !S.multi.size) return duplicateLayer(ts[0]);
  const ls = P().layers, made = new Set();
  for (const L of ts) { const c = freshIds(clone(L)); c.name = L.name + ' copy'; ls.splice(ls.indexOf(L), 0, c); made.add(c.id); }
  S.multi = made; commit(); toast(`Duplicated ${ts.length} layers`);
}
function copyLayers() {
  const ts = targets(); if (!ts.length) return;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify({ layers: ts.map(clone), style: styleOf(ts[0]), at: Date.now() })); }
  catch { return toast('Storage full — could not copy'); }
  toast(ts.length === 1 ? `Copied “${ts[0].name}”` : `Copied ${ts.length} layers`);
}
function pasteLayers() {
  const c = readClip(); if (!c?.layers?.length) return toast('Nothing to paste');
  const p = P(), made = c.layers.map(L => { const n = freshIds(clone(L)); return n; });
  p.layers.unshift(...made); hydrateMedia(p);
  if (made.length === 1) { S.sel = made[0].id; S.multi.clear(); } else { S.sel = null; S.multi = new Set(made.map(l => l.id)); }
  S.selKeys.clear(); S.tab = null; commit(); toast(made.length === 1 ? `Pasted “${made[0].name}”` : `Pasted ${made.length} layers`);
}
function pasteStyle(parts) {
  const c = readClip(), ts = targets(); if (!c?.style || !ts.length) return;
  ts.forEach(L => applyStyle(L, c.style, parts)); commit();
  toast(parts.length === ALL_PARTS.length ? 'Style pasted' : STYLE_PARTS.filter(p => parts.includes(p[0])).map(p => p[1]).join(' + ') + ' pasted');
}
function savePreset() {
  const L = selLayer(); if (!L) return;
  const st = styleOf(L), ps = listPresets();
  let name = L.name, n = 2; while (ps.some(p => p.name === name)) name = `${L.name} ${n++}`;
  ps.unshift({ id: uid(), name, style: st, swatch: st.fill?.fill || '#65abcd', at: Date.now() });
  if (savePresets(ps)) toast(`Saved preset “${name}” — find it under Presets`);
}
function presetSummary(st) {
  const bits = [];
  if (st.fill) bits.push('Fill'); if (st.stroke?.strokeW > 0) bits.push('Border'); if (st.shadow?.on) bits.push('Shadow');
  if (st.effects?.length) bits.push(st.effects.length + (st.effects.length === 1 ? ' effect' : ' effects'));
  if (st.blend && st.blend !== 'normal') bits.push(st.blend); if (st.opacity && (st.opacity.v !== 1 || st.opacity.keys?.length)) bits.push('Opacity');
  return bits.join(' · ') || 'Default style';
}
function panelPresets(L) {
  const ps = listPresets();
  if (!ps.length) return h('div', { class: 'hint', 'data-testid': 'presets-empty' }, 'No presets yet. Open ⧉ in the play bar and tap Save Preset to keep a layer’s style (fill, border, shadow, effects, blending, opacity).');
  return h('div', { class: 'pre-list', 'data-testid': 'presets' }, ...ps.map(pr => h('div', { class: 'pre-it', 'data-testid': 'preset' },
    h('button', { class: 'pre-apply', 'data-testid': 'preset-apply', onclick: () => { applyStyle(L, pr.style, ALL_PARTS); commit(); toast(`Applied “${pr.name}”`); } },
      h('i', { class: 'pre-sw', style: { background: pr.swatch } }), h('span', {}, h('b', {}, pr.name), h('small', {}, presetSummary(pr.style)))),
    h('button', { class: 'ib pre-del', title: 'Delete preset', 'data-testid': 'preset-del', onclick: () => { savePresets(listPresets().filter(x => x.id !== pr.id)); renderPanel(); } }, icon('trash')))));
}
let copyMenu = null, cmWrap = null;
function closeCopyMenu() { if (!copyMenu) return; cmWrap.remove(); copyMenu = cmWrap = null; $('#btnCopy').classList.remove('on'); }
function openCopyMenu() {
  if (copyMenu) return closeCopyMenu();
  closeLayerMenu();
  const ts = targets(), clip = readClip(), single = !S.multi.size && selLayer();
  const it = (label, tid, ic, fn, ok, extra = {}) => h('button', { class: 'cm-it' + (ok ? '' : ' off'), 'data-testid': 'cm-' + tid, 'aria-disabled': ok ? null : 'true',
    onclick: () => { if (!ok) return; if (!extra.keep) closeCopyMenu(); fn(); } },
    icon(ic, 'cm-ic'), h('span', { class: 'cm-tx' }, label, extra.sub ? h('small', {}, extra.sub) : null), extra.badge ? h('i', { class: 'cm-new' }, extra.badge) : null, extra.chev ? icon('chevr', 'cm-chev') : null);
  const main = () => [
    it('Select All Layers', 'select-all', 'selall', selectAllLayers, P().layers.length > 0),
    it('Duplicate Layer', 'duplicate', 'cm-dup', duplicateLayers, ts.length > 0),
    it('Copy Layer', 'copy', 'cm-copy', copyLayers, ts.length > 0, { sub: '(including style)' }),
    it('Save Preset', 'preset', 'cm-preset', savePreset, !!(single && visualLayer(single)), { badge: 'NEW' }),
    it('Paste Layer', 'paste', 'cm-paste', pasteLayers, !!clip?.layers?.length),
    it('Paste Style', 'paste-style', 'cm-pstyle', () => cmIn.replaceChildren(...sub()), !!(clip?.style && ts.length), { chev: true, keep: true })];
  const sub = () => [
    h('button', { class: 'cm-it cm-back', 'data-testid': 'cm-back', onclick: () => cmIn.replaceChildren(...main()) }, icon('chevl', 'cm-ic'), h('span', { class: 'cm-tx' }, 'Paste Style')),
    it('All Style', 'ps-all', 'cm-pstyle', () => pasteStyle(ALL_PARTS), true),
    ...STYLE_PARTS.map(([k, label]) => it(label, 'ps-' + k, { fill: 'fill', stroke: 'border', shadow: 'border', effects: 'effects', blend: 'blend', opacity: 'blend' }[k], () => pasteStyle([k]), clip.style[k] != null))];
  const cmIn = h('div', { class: 'cm-in' }, ...main());
  copyMenu = h('div', { class: 'cm', role: 'menu', 'data-testid': 'copy-menu' }, cmIn);
  const scrim = h('div', { class: 'lm-scrim', 'data-testid': 'copy-menu-scrim' });
  const close = e => { e.preventDefault(); e.stopPropagation(); closeCopyMenu(); };
  scrim.addEventListener('pointerdown', close); scrim.addEventListener('click', e => e.stopPropagation());
  cmWrap = h('div', { class: 'lm-wrap' }, scrim, copyMenu);
  document.body.append(cmWrap);
  // above the button, right edge 10px from the screen edge, arrow pointing down at the button (reference/16)
  const r = $('#btnCopy').getBoundingClientRect(), right = 10;
  copyMenu.style.right = right + 'px'; copyMenu.style.bottom = innerHeight - r.top + 10 + 'px';
  copyMenu.style.setProperty('--ax', (innerWidth - right - (r.left + r.width / 2)) + 'px');
  cmIn.style.maxHeight = Math.round(r.top - 10 - 12 - 50) + 'px';
  $('#btnCopy').classList.add('on');
}
function selectedKeyObjs() {
  const out = [];
  for (const L of P().layers) for (const { prop, k } of allKeys(L)) if (S.selKeys.has(k.id)) out.push({ L, prop, k });
  return out;
}

function changeResolution(short) {
  const p = P(); const [w, hh] = sizeFor(p.aspect, short); const k = w / p.w;
  if (!isFinite(k) || k === 1) return;
  for (const L of p.layers) {
    L.props.x *= k; L.props.y *= k; (L.keys.x || []).forEach(q => (q.v *= k)); (L.keys.y || []).forEach(q => (q.v *= k));
    L.props.scale *= k; (L.keys.scale || []).forEach(q => (q.v *= k));
  }
  p.w = w; p.h = hh; commit();
}
function changeAspect(a) {
  const p = P(); const [w, hh] = sizeFor(a, Math.min(p.w, p.h)); const sx = w / p.w, sy = hh / p.h;
  for (const L of p.layers) {
    L.props.x *= sx; L.props.y *= sy;
    (L.keys.x || []).forEach(k => (k.v *= sx)); (L.keys.y || []).forEach(k => (k.v *= sy));
  }
  p.w = w; p.h = hh; p.aspect = a; commit();
}


// ---------------- home (project list, light theme like Alight's home screen) ----------------
const fmtDur = d => { const cs = Math.round(d * 100), sec = Math.floor(cs / 100); return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}:${pad2(cs % 100)}`; };
const fmtBytes = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'mb' : n >= 1024 ? (n / 1024).toFixed(1) + 'kb' : n + 'b');
function thumbFor(p) {
  const c = document.createElement('canvas'), k = 200 / Math.max(p.w, p.h);
  c.width = Math.max(8, Math.round(p.w * k)); c.height = Math.max(8, Math.round(p.h * k));
  try { THUMB.r = THUMB.r || new Renderer(); THUMB.r.render(p, Math.min(1.5, p.duration / 2), c); } catch {} // one shared renderer: a WebGL context per thumbnail would exhaust the browser's context limit
  return c;
}
function setThemeColor(c) { document.querySelector('meta[name=theme-color]')?.setAttribute('content', c); }
function showHome() {
  if (S.playing) togglePlay(false);
  if (P()) store.saveProject(P());
  closeHomeMenu();
  const list = store.listProjects();
  $('#homeBanner').hidden = localStorage.getItem('kntc.bannerX') === '1';
  $('#homeList').replaceChildren(...(list.length ? list.map(x => {
    const pr = store.loadProject(x.id);
    const open = () => { const q = store.loadProject(x.id); if (q) { setProject(q); hideHome(); } };
    const th = h('span', { class: 'pc-th' });
    if (pr) {
      const c = thumbFor(pr), blur = document.createElement('canvas');
      blur.width = c.width; blur.height = c.height; blur.getContext('2d').drawImage(c, 0, 0); blur.className = 'pc-blur';
      th.append(blur, c, h('span', { class: 'pc-dur', 'data-testid': 'home-dur' }, fmtDur(pr.duration)));
    }
    const meta = (ic, t, tid) => h('span', { class: 'pc-m', 'data-testid': tid }, icon(ic), t);
    return h('div', { class: 'pcard', 'data-testid': 'home-project' },
      h('button', { class: 'pc-main', onclick: open, 'data-testid': 'home-open' }, th,
        h('span', { class: 'pc-tx' }, h('b', { 'data-testid': 'home-name' }, x.name),
          pr ? h('span', { class: 'pc-meta' }, meta('ratio', pr.aspect, 'meta-ratio'), meta('resbox', Math.min(pr.w, pr.h) + 'p', 'meta-res'),
            meta('folder', fmtBytes(store.projectBytes(x.id)), 'meta-size'), meta('fps', pr.fps + 'fps', 'meta-fps')) : '')),
      h('button', { class: 'pc-more', title: 'More', 'aria-label': 'More', 'data-testid': 'home-more', onclick: e => { e.stopPropagation(); openHomeMenu(e.currentTarget, x); } }, icon('dots')));
  }) : [h('div', { class: 'h-empty' }, 'No projects yet. Tap + to create one.')]));
  $('#home').hidden = false; document.body.classList.add('home-open'); setThemeColor('#f5f5f5');
}
function hideHome() { closeHomeMenu(); $('#home').hidden = true; document.body.classList.remove('home-open'); setThemeColor('#191b27'); requestAnimationFrame(() => { layoutStage(); drawFrame(); renderTimeline(); }); }
let homeMenu = null;
function closeHomeMenu() { if (homeMenu) { homeMenu.remove(); homeMenu = null; } }
function openHomeMenu(btn, x) {
  closeHomeMenu();
  const act = (ic, t, tid, fn, cls = '') => h('button', { class: cls, 'data-testid': tid, onclick: () => { closeHomeMenu(); fn(); } }, icon(ic), t);
  homeMenu = h('div', { class: 'h-menu', 'data-testid': 'home-menu' },
    act('rename', 'Rename', 'home-rename', () => renameProject(x.id)),
    act('dup', 'Duplicate', 'home-duplicate', () => duplicateProject(x.id)),
    act('trash', 'Delete', 'home-delete', () => deleteProjectUI(x.id), 'danger'));
  const r = btn.getBoundingClientRect();
  homeMenu.style.right = Math.max(8, innerWidth - r.right) + 'px';
  $('#home').append(homeMenu);
  const below = r.bottom + 4 + homeMenu.offsetHeight < innerHeight - 90;
  homeMenu.style.top = (below ? r.bottom + 4 : r.top - 4 - homeMenu.offsetHeight) + 'px';
}
function renameProject(id) {
  const q = store.loadProject(id); if (!q) return;
  const inp = h('input', { class: 'h-input', value: q.name, 'data-testid': 'rename-input', maxlength: 60 });
  const save = () => { const v = inp.value.trim(); if (v) { q.name = v; store.saveProject(q); if (P() && P().id === id) P().name = v; } dlg.close(); showHome(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  openDialog('Rename project', h('div', { class: 'plist' }, inp, h('button', { class: 'primary wide', onclick: save, 'data-testid': 'rename-save' }, 'Save')));
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
function duplicateProject(id) {
  const q = store.loadProject(id); if (!q) return;
  const c = clone(q); c.id = uid(); c.name = q.name + ' copy'; c.created = Date.now();
  store.saveProject(c); if (P()) store.saveProject(P()); // keep the open project as the "last" one
  showHome(); toast('Project duplicated');
}
function deleteProjectUI(id) {
  const x = store.listProjects().find(v => v.id === id); if (!x || !confirm('Delete ' + x.name + '?')) return;
  store.deleteProject(id);
  if (P() && id === P().id) { const rest = store.listProjects()[0]; setProject((rest && store.loadProject(rest.id)) || newProject('9:16', nextProjectName(), { res: 1080, bg: BG_PRESETS[0][0] })); }
  showHome();
}
function openHomeSettings() {
  openDialog('Settings', h('div', { class: 'plist' },
    h('button', { class: 'act wide', onclick: () => { dlg.close(); $('#fileJson').click(); } }, icon('up'), 'Import project (.json)'),
    h('div', { class: 'hint small' }, 'KINETIC saves projects on this device. Add it to the Home Screen from Safari’s share menu for full-screen use.')));
}

// ---------------- Create sheet (+ on home): name, ratio, resolution, frame rate, background ----------------
const BG_PRESETS = [['#d9d9d9', 'Light Grey'], ['#ffffff', 'White'], ['#3a3b44', 'Dark Grey'], ['#000000', 'Black'], ['#05060a', 'Midnight']];
const CREATE_RATIOS = [['16:9', 56, 30], ['9:16', 31, 54], ['4:5', 36, 45], ['1:1', 36, 36], ['4:3', 50, 37]];
function nextProjectName() {
  const names = new Set(store.listProjects().map(x => x.name));
  let n = store.listProjects().length + 1; while (names.has('Project Name ' + n)) n++;
  return 'Project Name ' + n;
}
function openCreate() {
  if (dlg.open) dlg.close();
  const st = { name: nextProjectName(), aspect: '9:16', res: 1080, fps: 30, bg: BG_PRESETS[0][0], cw: 2, ch: 1 };
  const root = $('#create');
  const aspect = () => (st.aspect === 'custom' ? `${st.cw}:${st.ch}` : st.aspect);
  const sizeTx = h('small', { 'data-testid': 'create-size' });
  const updSize = () => { const [w, hh] = sizeFor(aspect(), st.res); sizeTx.replaceChildren('Composition Size', h('br'), `${w} × ${hh}`); };
  const name = h('input', { class: 'cr-name', value: st.name, 'aria-label': 'Project name', 'data-testid': 'create-name', maxlength: 60, spellcheck: 'false' });
  name.oninput = () => (st.name = name.value);
  const nameRow = h('div', { class: 'cr-namerow' }, name,
    h('button', { class: 'cr-clear', title: 'Clear', 'aria-label': 'Clear name', 'data-testid': 'create-name-clear', onclick: () => { name.value = st.name = ''; name.focus(); } }, icon('xcircle')));
  const num = (v, tid, on) => { const i = h('input', { type: 'number', min: 1, max: 99, value: v, inputmode: 'numeric', 'data-testid': tid }); i.oninput = () => { const n = Math.max(1, Math.min(99, Math.round(+i.value) || 1)); on(n); updSize(); }; return i; };
  const custom = h('div', { class: 'cr-custom', hidden: true, 'data-testid': 'create-custom' }, h('span', {}, 'Custom ratio'),
    num(st.cw, 'create-custom-w', n => (st.cw = n)), h('b', {}, ':'), num(st.ch, 'create-custom-h', n => (st.ch = n)));
  const ratioBtns = [];
  const pickRatio = a => { st.aspect = a; ratioBtns.forEach(b => b.classList.toggle('on', b.dataset.a === a)); custom.hidden = a !== 'custom'; updSize(); };
  const ratios = h('div', { class: 'cr-ratios' },
    CREATE_RATIOS.map(([a, w, hh]) => { const b = h('button', { class: 'cr-ratio', 'data-a': a, 'data-testid': 'create-ratio-' + a, style: { width: w + 'px', height: hh + 'px' }, onclick: () => pickRatio(a) }, h('span', {}, a)); ratioBtns.push(b); return b; }),
    (() => { const b = h('button', { class: 'cr-ratio cr-pen', 'data-a': 'custom', title: 'Custom ratio', 'aria-label': 'Custom ratio', 'data-testid': 'create-ratio-custom', onclick: () => pickRatio('custom') }, icon('pencil')); ratioBtns.push(b); return b; })());
  const dd = (tid, value, options, onChange, lead) => {
    const sel = h('select', { 'data-testid': tid }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
    sel.onchange = () => onChange(sel.value, sel);
    return h('label', { class: 'cr-dd' }, lead || '', sel, icon('chevd'));
  };
  const sw = h('i', { class: 'cr-sw', style: { background: st.bg } });
  const bgPick = h('input', { type: 'color', value: st.bg, hidden: true, 'data-testid': 'create-bg-color' });
  const bgOpts = [...BG_PRESETS, ['custom', 'Custom…']];
  const bgDD = dd('create-bg', st.bg, bgOpts, (v, sel) => {
    if (v === 'custom') { bgPick.click(); sel.value = BG_PRESETS.some(b => b[0] === st.bg) ? st.bg : 'custom'; return; }
    st.bg = v; sw.style.background = v;
  }, sw);
  bgPick.oninput = () => { st.bg = bgPick.value; sw.style.background = st.bg; const sel = bgDD.querySelector('select'); const o = sel.querySelector('option[value=custom]'); o.textContent = 'Custom ' + st.bg; sel.value = 'custom'; };
  const row = (label, sub, ctl) => h('div', { class: 'cr-row' }, h('div', { class: 'cr-lab' }, h('b', {}, label), sub || ''), ctl);
  const close = () => { root.classList.remove('show'); setTimeout(() => { if (!root.classList.contains('show')) root.hidden = true; }, 220); };
  const go = () => {
    const p = newProject(aspect(), (st.name || '').trim() || nextProjectName(), { res: st.res, fps: st.fps, bg: st.bg });
    root.classList.remove('show'); root.hidden = true;
    setProject(p); hideHome(); toast('Created ' + p.name);
  };
  root.replaceChildren(h('div', { class: 'cr-dim', onclick: close }),
    h('div', { class: 'cr-sheet', role: 'dialog', 'aria-label': 'Create' },
      h('div', { class: 'cr-head' }, h('button', { class: 'cr-x', title: 'Close', 'aria-label': 'Close', 'data-testid': 'create-close', onclick: close }, icon('close')), h('h2', {}, 'Create')),
      h('div', { class: 'cr-body' },
        h('div', { class: 'cr-seg' }, h('button', { class: 'on', 'data-testid': 'create-seg-project' }, 'Project'),
          h('button', { 'data-testid': 'create-seg-element', onclick: () => toast('Elements: coming soon') }, 'Element', icon('info'))),
        nameRow, ratios, custom,
        row('Resolution', sizeTx, dd('create-res', st.res, RESOLUTIONS, v => { st.res = +v; updSize(); })),
        row('Frame Rate', '', dd('create-fps', st.fps, [24, 25, 30, 48, 50, 60].map(f => [f, f + ' fps']), v => (st.fps = +v))),
        row('Background', '', bgDD), bgPick,
        h('button', { class: 'cr-go', 'data-testid': 'create-go', onclick: go }, 'Create from scratch'))));
  pickRatio(st.aspect);
  root.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('show')));
}

// ---- editor gear: Project Settings sheet, styled like the Create sheet; every change applies straight away ----
function openProjectSheet() {
  if (dlg.open) dlg.close();
  closeLayerMenu(); closeCopyMenu();
  const p = P(), root = $('#create');
  const isStd = a => CREATE_RATIOS.some(r => r[0] === a);
  const [cw0, ch0] = isStd(p.aspect) ? [2, 1] : (() => { const g = (a, b) => (b ? g(b, a % b) : a), d = g(p.w, p.h); return [p.w / d, p.h / d]; })();
  const st = { cw: Math.min(99, cw0), ch: Math.min(99, ch0) };
  const sizeTx = h('small', { 'data-testid': 'proj-size' });
  const updSize = () => sizeTx.replaceChildren('Composition Size', h('br'), `${P().w} × ${P().h}`);
  const name = h('input', { class: 'cr-name', value: p.name, 'aria-label': 'Project name', 'data-testid': 'proj-sheet-name', maxlength: 60, spellcheck: 'false' });
  name.onchange = () => { P().name = name.value.trim() || 'Untitled'; commit(); };
  const num = (v, tid, on) => { const i = h('input', { type: 'number', min: 1, max: 99, value: v, inputmode: 'numeric', 'data-testid': tid }); i.onchange = () => { on(Math.max(1, Math.min(99, Math.round(+i.value) || 1))); applyCustom(); }; return i; };
  const applyCustom = () => { changeAspect(`${st.cw}:${st.ch}`); updSize(); };
  const custom = h('div', { class: 'cr-custom', hidden: isStd(p.aspect), 'data-testid': 'proj-custom' }, h('span', {}, 'Custom ratio'),
    num(st.cw, 'proj-custom-w', n => (st.cw = n)), h('b', {}, ':'), num(st.ch, 'proj-custom-h', n => (st.ch = n)));
  const ratioBtns = [];
  const mark = a => ratioBtns.forEach(b => b.classList.toggle('on', b.dataset.a === a));
  const pickRatio = a => { mark(a); custom.hidden = a !== 'custom'; if (a === 'custom') applyCustom(); else if (a !== P().aspect) changeAspect(a); updSize(); };
  const ratios = h('div', { class: 'cr-ratios' },
    CREATE_RATIOS.map(([a, w, hh]) => { const b = h('button', { class: 'cr-ratio', 'data-a': a, 'data-testid': 'aspect-' + a, style: { width: w + 'px', height: hh + 'px' }, onclick: () => pickRatio(a) }, h('span', {}, a)); ratioBtns.push(b); return b; }),
    (() => { const b = h('button', { class: 'cr-ratio cr-pen', 'data-a': 'custom', title: 'Custom ratio', 'aria-label': 'Custom ratio', 'data-testid': 'aspect-custom', onclick: () => pickRatio('custom') }, icon('pencil')); ratioBtns.push(b); return b; })());
  const dd = (tid, value, options, onChange, lead) => {
    const sel = h('select', { 'data-testid': tid }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
    sel.onchange = () => onChange(sel.value, sel);
    return h('label', { class: 'cr-dd' }, lead || '', sel, icon('chevd'));
  };
  const short = Math.min(p.w, p.h), resOpts = RESOLUTIONS.map(([v, t]) => [String(v), t]).concat(RESOLUTIONS.some(r => r[0] === short) ? [] : [[String(short), short + 'p']]);
  const sw = h('i', { class: 'cr-sw', style: { background: p.bg } });
  const bgPick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(p.bg) ? p.bg : '#000000', hidden: true, 'data-testid': 'proj-bg-color' });
  const known = BG_PRESETS.some(b => b[0] === p.bg);
  const bgDD = dd('proj-bg', known ? p.bg : 'custom', [...BG_PRESETS, ['custom', known ? 'Custom…' : 'Custom ' + p.bg]], (v, sel) => {
    if (v === 'custom') { bgPick.click(); return; }
    P().bg = v; sw.style.background = v; commit();
  }, sw);
  bgPick.oninput = () => { P().bg = bgPick.value; sw.style.background = bgPick.value; layoutStage(); drawFrame(); const sel = bgDD.querySelector('select'); sel.querySelector('option[value=custom]').textContent = 'Custom ' + bgPick.value; sel.value = 'custom'; };
  bgPick.onchange = () => commit();
  const row = (label, sub, ctl) => h('div', { class: 'cr-row' }, h('div', { class: 'cr-lab' }, h('b', {}, label), sub || ''), ctl);
  const close = () => { root.classList.remove('show'); setTimeout(() => { if (!root.classList.contains('show')) root.hidden = true; }, 220); };
  const dur = h('input', { type: 'number', class: 'cr-num', min: 0.5, max: 600, step: 0.5, value: p.duration, 'data-testid': 'duration', inputmode: 'decimal' });
  dur.onchange = () => { const v = Math.max(0.5, Math.min(600, +dur.value || p.duration)); P().duration = v; S.t = Math.min(S.t, v); commit(); };
  const act = (ic, label, tid, fn) => h('button', { class: 'cr-act', 'data-testid': tid, onclick: fn }, icon(ic), h('span', {}, label));
  root.replaceChildren(h('div', { class: 'cr-dim', onclick: close }),
    h('div', { class: 'cr-sheet', role: 'dialog', 'aria-label': 'Project Settings', 'data-testid': 'project-sheet' },
      h('div', { class: 'cr-head' }, h('button', { class: 'cr-x', title: 'Close', 'aria-label': 'Close', 'data-testid': 'proj-close', onclick: close }, icon('close')), h('h2', {}, 'Project Settings')),
      h('div', { class: 'cr-body' },
        h('div', { class: 'cr-namerow first' }, name), ratios, custom,
        row('Resolution', sizeTx, dd('proj-res', String(short), resOpts, v => { changeResolution(+v); updSize(); })),
        row('Frame Rate', '', dd('proj-fps', p.fps, [24, 25, 30, 48, 50, 60].map(f => [f, f + ' fps']), v => { P().fps = +v; commit(); })),
        row('Background', '', bgDD), bgPick,
        row('Duration', h('small', {}, 'seconds'), dur),
        h('div', { class: 'cr-acts' },
          act('menu', 'Projects', 'open-projects', () => { close(); openProjects(); }), act('plus', 'New', 'new-project', () => openCreate()),
          act('export', 'Save JSON', 'export-json', exportJSON), act('up', 'Load JSON', 'import-json', () => $('#fileJson').click()), act('image', 'Frame PNG', 'export-png', exportPNG)))));
  mark(isStd(p.aspect) ? p.aspect : 'custom'); updSize();
  root.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('show')));
}

// ---------------- dialogs ----------------
const dlg = $('#dlg');
function openDialog(title, body) {
  dlg.classList.toggle('light', document.body.classList.contains('home-open'));
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
function newProjectFlow() { openCreate(); }
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
  const opts = { format: fm.mp4 ? 'mp4' : 'webm', shortSide: Math.min(p.w, p.h), fps: p.fps, mbps: 10, audio: true };
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
    chips([[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']].map(([v, t]) => [v, t, 'export-res-' + v]), opts.shortSide, v => { opts.shortSide = v; upd(); }),
    select({ label: 'FPS', value: String(opts.fps), testid: 'export-fps', options: [['24', '24'], ['25', '25'], ['30', '30'], ['48', '48'], ['50', '50'], ['60', '60']], onChange: v => { opts.fps = +v; upd(); } }),
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
  ic('#btnZoom', 'zoom'); $('#zoomHud .zi').replaceWith(icon('zoom')); ic('#btnKPrev', 'kfprev'); ic('#btnKNext', 'kfnext');
  $('#btnZoom').onclick = resetZoom; $('#btnKPrev').onclick = () => jumpKey(-1); $('#btnKNext').onclick = () => jumpKey(1);
  ic('#btnUndo', 'undo'); ic('#btnRedo', 'redo'); ic('#btnStart', 'start'); ic('#btnEnd', 'end'); ic('#btnCopy', 'copy'); ic('#btnFit', 'fit');
  ic('#fab', 'plus'); ic('#homeMenu', 'burger'); ic('#homeAvatar', 'user'); ic('#homeNew', 'plus'); ic('#homeBannerX', 'close');
  document.querySelectorAll('#home [data-ic]').forEach(e => e.replaceWith(icon(e.dataset.ic)));
  $('#btnBack').onclick = goBack;
  $('#btnSettings').onclick = openProjectSheet;
  $('#btnExport').onclick = openExport;
  $('#btnDup').onclick = () => duplicateLayer(selLayer());
  $('#btnDel').onclick = () => deleteLayer(selLayer());
  $('#btnMore').onclick = openLayerMenu;
  $('#btnKey').onclick = toggleKeyAll;
  $('#btnPtAdd').onclick = placePoint;
  $('#fab').onclick = () => openSheet();
  $('#homeNew').onclick = () => openCreate(); $('#homeMenu').onclick = openHomeSettings;
  $('#homeAvatar').onclick = soon('Account');
  $('#homeImport').onclick = () => $('#fileJson').click();
  $('#homeBannerX').onclick = () => { localStorage.setItem('kntc.bannerX', '1'); $('#homeBanner').hidden = true; };
  document.querySelectorAll('#home [data-soon]').forEach(b => (b.onclick = soon(b.dataset.soon)));
  document.querySelector('#home [data-nav=projects]').onclick = () => $('#homeScroll').scrollTo({ top: $('.h-head').offsetTop - 12, behavior: 'smooth' });
  document.querySelector('#home [data-nav=home]').onclick = () => $('#homeScroll').scrollTo({ top: 0, behavior: 'smooth' });
  $('#home').addEventListener('pointerdown', e => { if (homeMenu && !homeMenu.contains(e.target) && !e.target.closest('.pc-more')) closeHomeMenu(); });
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnPlay').onclick = () => togglePlay();
  $('#btnStart').onclick = () => seek(0);
  $('#btnEnd').onclick = () => seek(P().duration);
  $('#btnCopy').onclick = openCopyMenu;
  $('#btnFit').onclick = () => { S.full = !S.full; refreshAll(); };
  $('#projName').onchange = e => { P().name = e.target.value || 'Untitled'; commit(); };
  $('#layerName').onchange = e => { const L = selLayer(); if (L) { L.name = e.target.value || L.name; commit(); } };
  for (const id of ['#projName', '#layerName']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#fileMedia').onchange = e => { const f = e.target.files[0]; if (f) importMediaFile(f); e.target.value = ''; };
  $('#fileAudio').onchange = e => { const f = e.target.files[0]; if (f) importAudioFile(f); e.target.value = ''; };
  $('#fileJson').onchange = e => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; };
  $('#pickColor').addEventListener('input', e => { S.draw.color = e.target.value; renderPanel(); });
  window.addEventListener('resize', () => { closeLayerMenu(); closeCopyMenu(); layoutStage(); drawFrame(); renderTimeline(); });
  new ResizeObserver(() => { layoutStage(); drawFrame(); }).observe($('#stageWrap'));
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if ((!$('#home').hidden || !$('#create').hidden) && e.key !== 'Escape') return; // editor shortcuts only in the editor
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key === 'k') toggleKeyAll();
    else if (e.key === 'Escape') { if (!$('#create').hidden) $('[data-testid=create-close]').click(); else if (!$('#home').hidden) closeHomeMenu(); else if (layerMenu) closeLayerMenu(); else if (copyMenu) closeCopyMenu(); else goBack(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const ks = selectedKeyObjs();
      if (ks.length) { ks.forEach(({ L, prop, k }) => removeKey(L, prop, k.id)); S.selKeys.clear(); commit(); }
      else if (selLayer()) deleteLayer(selLayer());
    } else if (e.key === 'ArrowLeft') seek(S.t - 1 / P().fps);
    else if (e.key === 'ArrowRight') seek(S.t + 1 / P().fps);
  });
}
function afterHistory(s) { closeLayerMenu(); closeCopyMenu(); S.project = s; for (const id of S.multi) if (!s.layers.some(l => l.id === id)) S.multi.delete(id); if (S.sel && !s.layers.some(l => l.id === S.sel)) { S.sel = null; if (S.tab !== 'project') S.tab = null; } hydrateMedia(s); scheduleSave(); refreshAll(); }
function undo() { const s = history.undo(); if (s) afterHistory(s); }
function redo() { const s = history.redo(); if (s) afterHistory(s); }

function boot() {
  initFxUI({ S, P, selLayer, commit, renderPanel, drawFrame, renderTimeline, refreshAll, selectedKeyObjs });
  buildChrome(); lockPage(); bindTimelineGestures(); bindStageWrapTap(); bindPreviewZoom();
  const last = store.lastProjectId();
  let p = last && store.loadProject(last);
  if (!p) p = demoProject('9:16');
  setProject(p);
  if (!/[?&#]editor/.test(location.href)) showHome();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // test / debug hook
  window.__app = { showHome, hideHome, S, get project() { return P(); }, seek, togglePlay, renderer, commit, refreshAll, setProject, demoProject, exportVideo, supportedFormats, EFFECTS, makeEffect, searchEffects, presetsFor, applyPreset, openBrowser, openEaseFor, propLabel, evalShape,
    selectLayer, deselect, openSub, openSheet, goBack, addLayer, makeLayer, openCreate, store, setZoom, resetZoom,
    handlePoints() { const L = selLayer(); if (!L) return null; const g = layerCorners(L), r = stage.getBoundingClientRect(), f = q => [r.left + q[0] * viewScale, r.top + q[1] * viewScale];
      return { corners: g.corners.map(f), mids: g.mids.map(f), rot: f(g.rotH), center: f([g.tr.x, g.tr.y]), viewScale }; } };
}
boot();
