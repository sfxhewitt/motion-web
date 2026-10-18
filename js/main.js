import { newProject, makeLayer, ASPECTS, ANIM_PROPS, PROP_META, valueAt, hasKeys, findKey, setKey, removeKey, writeProp, allKeys, shiftLayer, History, clone, uid } from './state.js';
import { EASE_PRESETS, makeEase, applyEase } from './easing.js';
import { EFFECTS, makeEffect } from './effects.js';
import { Renderer, BLEND_MODES, FONTS, media, evalTransform, layerBounds, syncVideos } from './render.js';
import * as store from './storage.js';
import { exportVideo, supportedFormats, exportSize } from './export.js';
import { $, h, slider, color, toggle, select, chips, section, toast, icon } from './ui.js';

// ---------------- state ----------------
const S = { project: null, t: 0, playing: false, sel: null, selKeys: new Set(), tab: 'add', pps: 70, autoFit: true, loop: true, fxCat: 'All' };
const history = new History();
const renderer = new Renderer();
const view = $('#view'), overlay = $('#overlay'), stage = $('#stage');
let viewScale = 1; // css px per project px
const LABEL_W = () => (window.innerWidth < 600 ? 84 : 120);

const P = () => S.project;
const selLayer = () => P()?.layers.find(l => l.id === S.sel) || null;

function commit(opts = {}) {
  history.push(P());
  scheduleSave();
  if (!opts.silent) refreshAll();
}
let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!store.saveProject(P())) toast('Storage full — export JSON to keep work'); }, 350); }

function refreshAll() { layoutStage(); drawFrame(); renderTimeline(); renderPanel(); updateTransport(); updateHeader(); }

// ---------------- media ----------------
async function registerMedia(id, blob, type) {
  const url = URL.createObjectURL(blob);
  let el;
  if (type === 'image') {
    el = new Image(); el.decoding = 'async'; el.src = url;
    await new Promise((r, j) => { el.onload = r; el.onerror = j; });
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
  for (const L of project.layers) {
    if ((L.type === 'image' || L.type === 'video') && !media.has(L.media.id)) {
      try { const b = await store.getMedia(L.media.id); if (b) await registerMedia(L.media.id, b, L.type); } catch (e) { console.warn(e); }
    }
  }
  drawFrame();
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

// ---------------- project ops ----------------
function setProject(p, { resetHistory = true } = {}) {
  S.project = p; S.sel = null; S.selKeys.clear(); S.t = Math.min(S.t, p.duration);
  if (resetHistory) history.reset(p);
  store.saveProject(p); hydrateMedia(p); refreshAll();
}
function addLayer(L) {
  P().layers.unshift(L); S.sel = L.id; S.selKeys.clear();
  if (S.tab === 'add') S.tab = 'layer';
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
  const pad = 14, p = P(); if (!p) return;
  const sc = Math.min((r.width - pad * 2) / p.w, (r.height - pad * 2) / p.h);
  const cw = Math.max(40, Math.floor(p.w * sc)), ch = Math.max(40, Math.floor(p.h * sc));
  viewScale = cw / p.w;
  stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.min(p.w, Math.round(cw * dpr)), bh = Math.round(bw * p.h / p.w);
  if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
  const ow = Math.round(cw * dpr), oh = Math.round(ch * dpr);
  if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
  $('#hud').textContent = `${p.w}×${p.h} · ${p.fps}fps · ${p.aspect}`;
}

function drawFrame() {
  if (!P()) return;
  syncVideos(P(), S.t, S.playing);
  renderer.render(P(), S.t, view);
  drawOverlay();
}

function layerCorners(L) {
  const tr = evalTransform(L, S.t), b = layerBounds(L, P(), view.getContext('2d'));
  const a = tr.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const pt = (lx, ly) => [tr.x + (lx * c - ly * s) * tr.scale, tr.y + (lx * s + ly * c) * tr.scale];
  return { tr, b, pt, corners: [pt(-b.w / 2, -b.h / 2), pt(b.w / 2, -b.h / 2), pt(b.w / 2, b.h / 2), pt(-b.w / 2, b.h / 2)], rotH: pt(0, -b.h / 2 - 60 / (tr.scale * viewScale || 1)) };
}

function drawOverlay() {
  const ctx = overlay.getContext('2d'), dpr = overlay.width / parseFloat(stage.style.width || 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, overlay.width, overlay.height);
  const L = selLayer(); if (!L || L.type === 'adjust' || S.playing) return;
  const k = viewScale * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // motion path
  if (hasKeys(L, 'x') || hasKeys(L, 'y')) {
    ctx.beginPath(); ctx.lineWidth = 1.2 / k; ctx.strokeStyle = 'rgba(198,255,0,.55)'; ctx.setLineDash([4 / k, 4 / k]);
    for (let i = 0; i <= 60; i++) { const t = L.start + (L.end - L.start) * i / 60; const x = valueAt(L, 'x', t), y = valueAt(L, 'y', t); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.t < L.start || S.t >= L.end) return;
  const g = layerCorners(L);
  ctx.lineWidth = 1.4 / k; ctx.strokeStyle = '#00f0ff'; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 8;
  ctx.beginPath(); g.corners.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke();
  ctx.shadowBlur = 0;
  const top = [(g.corners[0][0] + g.corners[1][0]) / 2, (g.corners[0][1] + g.corners[1][1]) / 2];
  ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...g.rotH); ctx.stroke();
  const hs = 9 / k;
  ctx.fillStyle = '#05060a';
  ctx.beginPath(); ctx.arc(g.rotH[0], g.rotH[1], hs, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ff2bd6'; ctx.stroke();
  const c2 = g.corners[2]; ctx.fillRect(c2[0] - hs, c2[1] - hs, hs * 2, hs * 2); ctx.strokeStyle = '#00f0ff'; ctx.strokeRect(c2[0] - hs, c2[1] - hs, hs * 2, hs * 2);
  ctx.beginPath(); ctx.arc(g.tr.x, g.tr.y, 3 / k, 0, Math.PI * 2); ctx.fillStyle = '#c6ff00'; ctx.fill();
}

function stagePoint(e) { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / viewScale, (e.clientY - r.top) / viewScale]; }

function hitTest(px, py) {
  const ctx = view.getContext('2d');
  let solidHit = null;
  for (const L of P().layers) {
    if (!L.visible || L.locked || L.type === 'adjust' || S.t < L.start || S.t >= L.end) continue;
    const tr = evalTransform(L, S.t), b = layerBounds(L, P(), ctx);
    const a = -tr.rotation * Math.PI / 180, dx = px - tr.x, dy = py - tr.y;
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / (tr.scale || 1e-6), ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (tr.scale || 1e-6);
    const pad = 12 / (viewScale * (tr.scale || 1));
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) { if (L.type === 'solid') { solidHit = solidHit || L; continue; } return L; }
  }
  return solidHit;
}

const ptrs = new Map(); let gesture = null;
stage.addEventListener('pointerdown', e => {
  if (!P()) return;
  stage.setPointerCapture(e.pointerId);
  const [px, py] = stagePoint(e); ptrs.set(e.pointerId, [px, py]);
  if (S.playing) togglePlay(false);
  const L = selLayer();
  if (ptrs.size === 2 && L) {
    const [a, b] = [...ptrs.values()];
    gesture = { mode: 'pinch', L, d0: Math.hypot(b[0] - a[0], b[1] - a[1]), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), s0: valueAt(L, 'scale', S.t), r0: valueAt(L, 'rotation', S.t) };
    return;
  }
  if (ptrs.size > 1) return;
  if (L && L.type !== 'adjust' && S.t >= L.start && S.t < L.end) {
    const g = layerCorners(L), tol = 22 / viewScale;
    if (Math.hypot(px - g.rotH[0], py - g.rotH[1]) < tol) { gesture = { mode: 'rotate', L, r0: valueAt(L, 'rotation', S.t), a0: Math.atan2(py - g.tr.y, px - g.tr.x) }; return; }
    if (Math.hypot(px - g.corners[2][0], py - g.corners[2][1]) < tol) { gesture = { mode: 'scale', L, s0: valueAt(L, 'scale', S.t), d0: Math.hypot(px - g.tr.x, py - g.tr.y) }; return; }
  }
  const hit = hitTest(px, py);
  if (hit) {
    if (hit.id !== S.sel) { S.sel = hit.id; S.selKeys.clear(); renderTimeline(); renderPanel(); }
    gesture = { mode: 'move', L: hit, x0: valueAt(hit, 'x', S.t), y0: valueAt(hit, 'y', S.t), px, py, moved: false };
  } else { S.sel = null; S.selKeys.clear(); gesture = null; renderTimeline(); renderPanel(); }
  drawOverlay();
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = stagePoint(e); ptrs.set(e.pointerId, [px, py]);
  if (!gesture) return;
  const { L } = gesture;
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
  if (gesture && ptrs.size === 0) { if (gesture.moved) commit(); gesture = null; }
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
  drawFrame(); movePlayhead(); updateTC();
  requestAnimationFrame(loop);
}
function seek(t) {
  S.t = Math.max(0, Math.min(P().duration, t));
  drawFrame(); movePlayhead(); updateTC(); renderPanelIfTime();
}
let panelTimer;
function renderPanelIfTime() { if (['layer', 'ease'].includes(S.tab)) { clearTimeout(panelTimer); panelTimer = setTimeout(renderPanel, 60); } }

const tc = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
function updateTC() { $('#tc').textContent = tc(S.t); const f = Math.floor(S.t * P().fps); $('#frame').textContent = 'F' + String(f).padStart(3, '0'); }
function updateTransport() {
  $('#btnPlay').replaceChildren(icon(S.playing ? 'pause' : 'play'));
  $('#btnPlay').classList.toggle('on', S.playing);
  $('#btnLoop').classList.toggle('on', S.loop);
  $('#dur').textContent = tc(P().duration);
  const L = selLayer();
  const at = L && ANIM_PROPS.some(p => findKey(L, p, S.t));
  $('#btnKey').classList.toggle('on', !!at);
  $('#btnKey').disabled = !L || L.type === 'adjust' && false;
  updateTC();
}
function updateHeader() {
  $('#projName').value = P().name;
  $('#btnUndo').disabled = !history.canUndo(); $('#btnRedo').disabled = !history.canRedo();
}

function toggleKeyAll() {
  const L = selLayer(); if (!L) return toast('Select a layer first');
  const existing = ANIM_PROPS.filter(p => findKey(L, p, S.t));
  if (existing.length) existing.forEach(p => removeKey(L, p, findKey(L, p, S.t).id));
  else ANIM_PROPS.forEach(p => setKey(L, p, S.t, valueAt(L, p, S.t)));
  commit();
}

// ---------------- timeline ----------------
const tl = $('#tlScroll');
function movePlayhead() {
  const x = LABEL_W() + 12 + S.t * S.pps;
  $('#playhead').style.transform = `translateX(${x}px)`;
  if (S.playing) {
    const vw = tl.clientWidth;
    if (x > tl.scrollLeft + vw - 30 || x < tl.scrollLeft + LABEL_W()) tl.scrollLeft = Math.max(0, x - LABEL_W() - 20);
  }
}
function renderTimeline() {
  const p = P(); if (!p) return;
  const lw = LABEL_W();
  if (S.autoFit && tl.clientWidth > 0) S.pps = Math.max(12, (tl.clientWidth - lw - 48) / p.duration);
  const W = p.duration * S.pps;
  const inner = h('div', { id: 'tlInner', style: { width: lw + W + 72 + 'px', '--lw': lw + 'px' } });
  // ruler
  const ruler = h('div', { class: 'tl-ruler', 'data-testid': 'ruler' });
  const step = S.pps > 120 ? 0.25 : S.pps > 50 ? 0.5 : 1;
  for (let t = 0; t <= p.duration + 1e-6; t += step) {
    const major = Math.abs(t - Math.round(t)) < 1e-6;
    ruler.append(h('i', { class: major ? 'maj' : '', style: { left: t * S.pps + 'px' } }, major ? String(Math.round(t)) + 's' : ''));
  }
  inner.append(h('div', { class: 'tl-row tl-head' }, h('div', { class: 'tl-label corner' }, `${p.layers.length} LAYERS`), ruler));
  bindScrub(ruler);
  for (const L of p.layers) {
    const sel = L.id === S.sel;
    const label = h('div', { class: 'tl-label', onclick: () => { S.sel = L.id; S.selKeys.clear(); if (S.tab === 'add') S.tab = 'layer'; refreshAll(); } },
      h('button', { class: 'vis', title: 'Visibility', onclick: ev => { ev.stopPropagation(); L.visible = !L.visible; commit(); } }, icon(L.visible ? 'eye' : 'eyeoff')),
      h('span', { class: 'ln t-' + L.type }, L.name));
    const track = h('div', { class: 'tl-track' });
    track.addEventListener('click', e => { if (e.target === track) { const r = track.getBoundingClientRect(); seek((e.clientX - r.left) / S.pps); } });
    const clip = h('div', { class: 'clip t-' + L.type + (sel ? ' sel' : '') + (L.visible ? '' : ' hidden'), style: { left: L.start * S.pps + 'px', width: Math.max(4, (L.end - L.start) * S.pps) + 'px' } },
      h('b', { class: 'trim l' }), h('span', { class: 'cn' }, L.name), h('b', { class: 'trim r' }));
    bindClip(clip, L);
    track.append(clip);
    // merged diamonds
    const times = new Map();
    for (const { prop, k } of allKeys(L)) { const key = k.t.toFixed(3); if (!times.has(key)) times.set(key, []); times.get(key).push({ prop, k }); }
    for (const [tk, list] of times) {
      const on = list.some(x => S.selKeys.has(x.k.id));
      const d = h('i', { class: 'kf' + (on ? ' on' : ''), style: { left: (+tk) * S.pps + 'px' }, 'data-testid': 'kf' });
      bindKey(d, L, list); track.append(d);
    }
    inner.append(h('div', { class: 'tl-row' + (sel ? ' sel' : ''), 'data-layer': L.id }, label, track));
    if (sel) {
      for (const prop of ANIM_PROPS.filter(pp => hasKeys(L, pp))) {
        const st = h('div', { class: 'tl-track sub' });
        for (const k of L.keys[prop]) {
          const d = h('i', { class: 'kf sm' + (S.selKeys.has(k.id) ? ' on' : ''), style: { left: k.t * S.pps + 'px' } });
          bindKey(d, L, [{ prop, k }]); st.append(d);
        }
        inner.append(h('div', { class: 'tl-row subrow' }, h('div', { class: 'tl-label sub' }, PROP_META[prop].label), st));
      }
    }
  }
  if (!p.layers.length) inner.append(h('div', { class: 'tl-empty' }, 'Tap ＋ ADD to create a layer'));
  inner.append(h('div', { id: 'playhead' }, h('span')));
  const sl = tl.scrollLeft, st = tl.scrollTop;
  tl.replaceChildren(inner); tl.scrollLeft = sl; tl.scrollTop = st;
  movePlayhead(); G.updBars?.();
}
const scrubAt = (el, clientX) => seek((clientX - el.getBoundingClientRect().left) / S.pps);
function bindScrub(el) {
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return; // touch/pen: handled by the timeline gesture controller below
    el.setPointerCapture(e.pointerId); if (S.playing) togglePlay(false);
    const mv = ev => scrubAt(el, ev.clientX);
    mv(e);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
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
    const x0 = e.clientX; let moved = false; const ctx = onStart?.(e) || {};
    const mv = ev => { const dx = ev.clientX - x0; if (Math.abs(dx) > 3) moved = true; if (moved) onMove(dx / S.pps, ctx, ev); };
    const up = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd?.(moved, ctx, ev); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

// ---------------- timeline touch gestures ----------------
// One controller for every touch/pen pointer on the timeline (touch-action: none, so the browser never scrolls it):
//  * swipe anywhere (track, labels, clips, keyframes) -> pan x/y with axis lock + momentum
//  * long press (300ms, <8px) on a clip / trim handle / keyframe -> grab it (visual pop + vibrate), then drag
//  * touch on an already-selected clip / trim / keyframe -> drag right away (vertical swipe on a selected clip still pans)
//  * tap -> select (clips/keys) or the normal click (labels, empty track = seek)
//  * ruler -> scrub; two fingers anywhere -> pinch-zoom time around the fingers
const SLOP = 8, HOLD_MS = 300, ZMIN = 12, ZMAX = 800;
const G = { ptrs: new Map(), g: null, pinch: null, mom: 0, raf: 0, noClick: false };
const tlOriginX = () => LABEL_W() + 12; // content x of t=0
function zoomTo(pps, clientX, anchorT) {
  pps = Math.max(ZMIN, Math.min(ZMAX, pps));
  const r = tl.getBoundingClientRect(), vx = clientX - r.left;
  const t = anchorT ?? (vx + tl.scrollLeft - tlOriginX()) / S.pps;
  S.autoFit = false; S.pps = pps; renderTimeline();
  tl.scrollLeft = tlOriginX() + t * pps - vx;
}
function stopMomentum() { cancelAnimationFrame(G.mom); G.mom = 0; }
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
  g.mode = 'drag'; g.gx = x; g.ctx = g.spec.onStart?.({ target: g.target, clientX: x }) || {};
  g.item.classList.add('grabbed'); tl.classList.add('grabbing');
  try { navigator.vibrate?.(12); } catch {}
}
function endDrag(g, ev) {
  g.item.classList.remove('grabbed'); tl.classList.remove('grabbing');
  g.spec.onEnd?.(g.moved, g.ctx, ev);
}
function pinchState() {
  const [a, b] = [...G.ptrs.values()];
  return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}
function bindTimelineGestures() {
  tl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault(); stopMomentum(); G.noClick = false;
    try { tl.setPointerCapture(e.pointerId); } catch {}
    G.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (G.ptrs.size === 2) { // second finger -> pinch; abandon whatever the first finger was doing
      const g = G.g; G.g = null;
      if (g) { clearTimeout(g.hold); if (g.mode === 'drag') endDrag(g, e); }
      const ps = pinchState(), r = tl.getBoundingClientRect();
      G.pinch = { ...ps, pps0: S.pps, t: (ps.mx - r.left + tl.scrollLeft - tlOriginX()) / S.pps, st0: tl.scrollTop };
      G.noClick = true; return;
    }
    if (G.ptrs.size > 2 || G.pinch) return;
    const hit = e.target.closest('.kf, .clip, .tl-ruler');
    const g = G.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sl: tl.scrollLeft, st: tl.scrollTop, mode: 'pending', target: e.target,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }], moved: false };
    if (hit?.classList.contains('tl-ruler')) { g.mode = 'scrub'; g.ruler = hit; if (S.playing) togglePlay(false); scrubAt(hit, e.clientX); return; }
    if (hit?._drag) {
      g.item = hit; g.spec = hit._drag; g.isKey = hit.classList.contains('kf'); g.isTrim = e.target.classList.contains('trim');
      g.armed = hit.classList.contains(g.isKey ? 'on' : 'sel');
      g.hold = setTimeout(() => { if (G.g === g && g.mode === 'pending') { if (S.playing) togglePlay(false); grab(g, g.lx ?? g.x0); } }, HOLD_MS);
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
        if (Math.abs(pps - S.pps) > 0.01) zoomTo(pps, ps.mx, pz.t);
        else tl.scrollLeft = tlOriginX() + pz.t * S.pps - (ps.mx - tl.getBoundingClientRect().left);
        tl.scrollTop = pz.st0 - (ps.my - pz.my);
      });
      return;
    }
    const g = G.g; if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, now = performance.now();
    g.lx = e.clientX; g.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 150) g.samples.shift();
    if (g.mode === 'scrub') return scrubAt(g.ruler, e.clientX);
    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimeout(g.hold);
      if (g.item && g.armed && (g.isKey || g.isTrim || Math.abs(dx) >= Math.abs(dy))) { grab(g, g.x0); }
      else { g.mode = 'pan'; G.noClick = true; const ax = Math.abs(dx), ay = Math.abs(dy); g.axis = ax > 2 * ay ? 'x' : ay > 2 * ax ? 'y' : 'xy'; }
    }
    if (g.mode === 'pan') {
      if (g.axis !== 'y') tl.scrollLeft = g.sl - dx;
      if (g.axis !== 'x') tl.scrollTop = g.st - dy;
    } else if (g.mode === 'drag') {
      const ddx = e.clientX - g.gx; if (Math.abs(ddx) > 2) g.moved = true;
      if (g.moved) g.spec.onMove(ddx / S.pps, g.ctx, e);
    }
  });
  const up = e => {
    if (!G.ptrs.has(e.pointerId)) return;
    G.ptrs.delete(e.pointerId);
    if (G.pinch) { if (G.ptrs.size < 2) { G.pinch = null; renderTimeline(); } return; }
    const g = G.g; if (!g || g.id !== e.pointerId) return;
    G.g = null; clearTimeout(g.hold);
    if (g.mode === 'drag') { G.noClick = true; endDrag(g, e); }
    else if (g.mode === 'pan') startMomentum(g);
    else if (g.mode === 'pending' && g.item && e.type === 'pointerup') { G.noClick = true; g.spec.onEnd?.(false, g.spec.onStart?.({ target: g.target, clientX: e.clientX }) || {}, e); }
  };
  tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', up);
  tl.addEventListener('lostpointercapture', up);
  // a pan / drag / pinch must not end in a click (seek on empty track, select on label)
  tl.addEventListener('click', e => { if (G.noClick) { G.noClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  tl.addEventListener('contextmenu', e => e.preventDefault());
  // desktop: ctrl/trackpad-pinch wheel zooms time around the cursor
  tl.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(S.pps * Math.exp(-e.deltaY * 0.01), e.clientX); }, { passive: false });
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
  tl.addEventListener('scroll', () => { upd(); $('#timeline').classList.add('scrolling'); clearTimeout(hideT); hideT = setTimeout(() => $('#timeline').classList.remove('scrolling'), 700); }, { passive: true });
  new ResizeObserver(upd).observe(tl);
  G.updBars = upd;
}
// Lock the app shell: nothing outside real scroll areas may scroll, rubber-band or page-zoom.
function lockPage() {
  const scrollable = t => t.closest?.('#panelBody, dialog, textarea, select, input');
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || !scrollable(e.target)) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
}
const snapT = t => { const f = P().fps; return Math.round(t * f) / f; };
function bindClip(clip, L) {
  bindDrag(clip, {
    onStart: e => ({ mode: e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm', s0: L.start, e0: L.end, snap: clone(L.keys) }),
    onMove: (dt, c) => {
      if (c.mode === 'l') L.start = Math.min(L.end - 0.05, Math.max(0, snapT(c.s0 + dt)));
      else if (c.mode === 'r') L.end = Math.max(L.start + 0.05, Math.min(P().duration, snapT(c.e0 + dt)));
      else { const d = snapT(Math.max(-c.s0, Math.min(P().duration - c.e0, dt))); L.keys = clone(c.snap); L.start = c.s0; L.end = c.e0; shiftLayer(L, d); }
      clip.style.left = L.start * S.pps + 'px'; clip.style.width = (L.end - L.start) * S.pps + 'px'; drawFrame();
    },
    onEnd: moved => { if (moved) commit(); else { S.sel = L.id; S.selKeys.clear(); if (S.tab === 'add') S.tab = 'layer'; refreshAll(); } },
  });
}
function bindKey(d, L, list) {
  bindDrag(d, {
    onStart: () => ({ t0: list[0].k.t }),
    onMove: (dt, c) => { const nt = snapT(Math.max(0, Math.min(P().duration, c.t0 + dt))); for (const { k } of list) k.t = nt; d.style.left = nt * S.pps + 'px'; },
    onEnd: (moved, c, ev) => {
      S.sel = L.id;
      if (moved) { for (const p of new Set(list.map(x => x.prop))) L.keys[p].sort((a, b) => a.t - b.t); }
      else { if (!ev.shiftKey && !ev.metaKey) S.selKeys.clear(); list.forEach(x => S.selKeys.add(x.k.id)); S.t = list[0].k.t; if (!['layer', 'ease'].includes(S.tab)) S.tab = 'ease'; }
      commit();
    },
  });
}

// ---------------- panels ----------------
const TABS = [['add', 'Add', 'plus'], ['layer', 'Layer', 'layer'], ['style', 'Style', 'style'], ['fx', 'FX', 'fx'], ['blend', 'Blend', 'blend'], ['ease', 'Ease', 'ease'], ['project', 'Project', 'project']];
function renderTabs() {
  const mk = () => TABS.map(([id, label, ic]) => h('button', { class: 'tab' + (S.tab === id ? ' on' : ''), 'data-tab': id, 'data-testid': 'tab-' + id, onclick: () => { S.tab = S.tab === id && isMobile() ? null : id; renderTabs(); renderPanel(); requestAnimationFrame(() => { layoutStage(); drawFrame(); }); } }, icon(ic), h('span', {}, label)));
  $('#tabs').replaceChildren(...mk());
  document.body.classList.toggle('panel-open', !!S.tab);
}
const isMobile = () => window.innerWidth < 900;

function liveSet(fn) { return v => { fn(v); drawFrame(); }; }

function renderPanel() {
  const body = $('#panelBody'); if (!P()) return;
  const L = selLayer();
  const need = msg => h('div', { class: 'hint' }, msg);
  let content;
  switch (S.tab) {
    case 'add': content = panelAdd(); break;
    case 'layer': content = L ? panelLayer(L) : need('Select a layer on the canvas or timeline.'); break;
    case 'style': content = L ? panelStyle(L) : need('Select a layer to style it.'); break;
    case 'fx': content = L ? panelFx(L) : need('Select a layer (or add an Adjustment layer) to apply effects.'); break;
    case 'blend': content = L ? panelBlend(L) : need('Select a layer to change its blend mode.'); break;
    case 'ease': content = panelEase(L); break;
    case 'project': content = panelProject(); break;
    default: content = h('div');
  }
  const st = body.scrollTop; body.replaceChildren(content); body.scrollTop = st;
  renderTabs(); updateTransport();
}

function panelAdd() {
  const btn = (ic, label, fn, tid) => h('button', { class: 'add-btn', 'data-testid': tid, onclick: fn }, icon(ic), h('span', {}, label));
  return h('div', {},
    section('Shapes', h('div', { class: 'grid' },
      ...['rect', 'ellipse', 'triangle', 'star', 'polygon', 'ring', 'line'].map(k => btn(k, k, () => addLayer(makeLayer(P(), 'shape', { kind: k })), 'add-' + k)))),
    section('Layers', h('div', { class: 'grid' },
      btn('text', 'Text', () => addLayer(makeLayer(P(), 'text')), 'add-text'),
      btn('solid', 'Solid', () => addLayer(makeLayer(P(), 'solid')), 'add-solid'),
      btn('media', 'Image / Video', () => $('#fileMedia').click(), 'add-media'),
      btn('adjust', 'Adjustment', () => { const L = makeLayer(P(), 'adjust'); L.effects.push(makeEffect('coloradj')); addLayer(L); S.tab = 'fx'; renderTabs(); renderPanel(); }, 'add-adjust'),
      btn('demo', 'Load Demo', () => { if (confirm('Replace with a new demo project?')) setProject(demoProject(P().aspect)); }, 'add-demo'))));
}

function propKeyState(L, prop) { return findKey(L, prop, S.t) ? 2 : hasKeys(L, prop) ? 1 : 0; }

function panelLayer(L) {
  const out = h('div', {});
  out.append(h('div', { class: 'ctl' }, h('label', {}, 'Name'), h('input', { class: 'txt', value: L.name, onchange: e => { L.name = e.target.value; commit(); } })));
  if (L.type !== 'adjust' || true) {
    const rows = ANIM_PROPS.map(prop => {
      const m = PROP_META[prop];
      const isPos = prop === 'x' || prop === 'y';
      return slider({
        label: m.label, value: valueAt(L, prop, S.t), min: isPos ? -P()[prop === 'x' ? 'w' : 'h'] * 0.5 : m.min, max: isPos ? P()[prop === 'x' ? 'w' : 'h'] * 1.5 : m.max, step: m.step,
        testid: 'prop-' + prop,
        onInput: liveSet(v => writeProp(L, prop, S.t, v)), onChange: () => commit({ silent: true }) || renderTimeline(),
        key: { state: propKeyState(L, prop), toggle: () => { const k = findKey(L, prop, S.t); if (k) removeKey(L, prop, k.id); else setKey(L, prop, S.t, valueAt(L, prop, S.t)); commit(); } },
      });
    });
    out.append(section('Transform  ·  ◆ = keyframe at playhead', ...rows));
  }
  out.append(section('Timing',
    slider({ label: 'In', value: L.start, min: 0, max: P().duration, step: 0.01, onInput: liveSet(v => { L.start = Math.min(v, L.end - 0.05); }), onChange: () => commit() }),
    slider({ label: 'Out', value: L.end, min: 0, max: P().duration, step: 0.01, onInput: liveSet(v => { L.end = Math.max(v, L.start + 0.05); }), onChange: () => commit() })));
  const act = (ic, label, fn, tid) => h('button', { class: 'act', onclick: fn, 'data-testid': tid }, icon(ic), label);
  const ix = P().layers.indexOf(L);
  out.append(h('div', { class: 'acts' },
    act('center', 'Center', () => { writeProp(L, 'x', S.t, P().w / 2); writeProp(L, 'y', S.t, P().h / 2); commit(); }),
    act('up', 'Up', () => { if (ix > 0) { P().layers.splice(ix, 1); P().layers.splice(ix - 1, 0, L); commit(); } }),
    act('down', 'Down', () => { if (ix < P().layers.length - 1) { P().layers.splice(ix, 1); P().layers.splice(ix + 1, 0, L); commit(); } }),
    act('dup', 'Duplicate', () => { const c = clone(L); c.id = uid(); c.name = L.name + ' copy'; for (const p in c.keys) c.keys[p].forEach(k => (k.id = uid())); c.effects.forEach(f => (f.id = uid())); P().layers.splice(ix, 0, c); S.sel = c.id; commit(); }, 'dup-layer'),
    act(L.locked ? 'key' : 'key', L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; commit(); }),
    act('trash', 'Delete', () => { P().layers.splice(ix, 1); S.sel = null; S.selKeys.clear(); commit(); }, 'del-layer')));
  return out;
}

function panelStyle(L) {
  const out = h('div', {});
  const C = (label, obj, k) => color({ label, value: obj[k], onInput: liveSet(v => (obj[k] = v)), onChange: v => { obj[k] = v; commit(); } });
  const N = (label, obj, k, min, max, step = 1, tid) => slider({ label, value: obj[k], min, max, step, testid: tid, onInput: liveSet(v => (obj[k] = v)), onChange: () => commit({ silent: true }) });
  const T = (label, obj, k) => toggle({ label, value: obj[k], onChange: v => { obj[k] = v; commit(); } });
  const big = Math.max(P().w, P().h) * 1.5;
  if (L.type === 'shape') {
    const s = L.shape;
    out.append(section('Shape', chips(['rect', 'ellipse', 'triangle', 'star', 'polygon', 'ring', 'line'].map(k => [k, k]), s.kind, v => { s.kind = v; commit(); }),
      N('Width', s, 'w', 1, big), N('Height', s, 'h', 1, big),
      s.kind === 'rect' ? N('Corner', s, 'radius', 0, 600) : null,
      s.kind === 'star' || s.kind === 'polygon' ? N('Points', s, 'points', 3, 24) : null,
      s.kind === 'star' ? N('Inner', s, 'inner', 0.05, 1, 0.01) : null,
      s.kind === 'ring' ? N('Thickness', s, 'thickness', 0.02, 1, 0.01) : null));
    out.append(section('Fill', T('Fill', s, 'fillOn'), C('Color', s, 'fill'), T('Gradient', s, 'gradient'), s.gradient ? C('Color 2', s, 'fill2') : null, s.gradient ? N('Angle', s, 'gradAngle', 0, 360) : null));
    out.append(section('Stroke', N('Width', s, 'strokeW', 0, 120), C('Color', s, 'stroke')));
  } else if (L.type === 'text') {
    const t = L.text;
    const ta = h('textarea', { class: 'txt', rows: 2, 'data-testid': 'text-content' }, t.content);
    ta.addEventListener('input', () => { t.content = ta.value; drawFrame(); });
    ta.addEventListener('change', () => { L.name = t.content.split('\n')[0].slice(0, 18) || 'Text'; commit(); });
    out.append(section('Text', ta,
      select({ label: 'Font', value: t.font, options: Object.keys(FONTS).map(f => [f, f]), onChange: v => { t.font = v; commit(); } }),
      N('Size', t, 'size', 8, 800), N('Weight', t, 'weight', 100, 900, 100), N('Tracking', t, 'tracking', -0.2, 1, 0.01), N('Line Ht', t, 'lineHeight', 0.6, 3, 0.05),
      chips([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], t.align, v => { t.align = v; commit(); }),
      T('Italic', t, 'italic')));
    out.append(section('Color', C('Fill', t, 'fill'), N('Stroke', t, 'strokeW', 0, 60), C('Stroke Color', t, 'stroke')));
  } else if (L.type === 'solid') {
    const s = L.solid;
    out.append(section('Solid', C('Color', s, 'color'), T('Gradient', s, 'gradient'), s.gradient ? C('Color 2', s, 'fill2') : null, s.gradient ? N('Angle', s, 'gradAngle', 0, 360) : null));
  } else if (L.type === 'image' || L.type === 'video') {
    const m = L.media;
    out.append(section('Media', h('div', { class: 'hint' }, `${m.w}×${m.h} source`),
      h('div', { class: 'acts' },
        h('button', { class: 'act', onclick: () => { writeProp(L, 'scale', S.t, +Math.min(P().w / m.w, P().h / m.h).toFixed(3)); commit(); } }, 'Fit'),
        h('button', { class: 'act', onclick: () => { writeProp(L, 'scale', S.t, +Math.max(P().w / m.w, P().h / m.h).toFixed(3)); commit(); } }, 'Fill')),
      L.type === 'video' ? N('Volume', m, 'volume', 0, 1, 0.01) : null,
      L.type === 'video' ? N('Offset s', m, 'offset', 0, 600, 0.05) : null));
  } else out.append(h('div', { class: 'hint' }, 'Adjustment layers have no style — add effects in FX; they apply to everything below.'));
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
    section('Blend Mode', chips(BLEND_MODES.map(([id, label]) => [id, label, 'blend-' + id]), L.blend, v => { L.blend = v; commit(); }, 'blend')),
    slider({ label: 'Opacity', value: valueAt(L, 'opacity', S.t), min: 0, max: 1, step: 0.01, onInput: liveSet(v => writeProp(L, 'opacity', S.t, v)), onChange: () => commit({ silent: true }) }));
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
    ctx.strokeStyle = 'rgba(0,240,255,.12)'; ctx.lineWidth = 1;
    const [, y0] = toPx(0, 0), [, y1] = toPx(0, 1);
    for (let i = 0; i <= 4; i++) { const [x] = toPx(i / 4, 0); const [, y] = toPx(0, i / 4); ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(size - pad, y); ctx.stroke(); }
    const e = isBez ? { type: 'bezier', bz } : ease;
    ctx.beginPath(); ctx.strokeStyle = '#c6ff00'; ctx.lineWidth = 2; ctx.shadowColor = '#c6ff00'; ctx.shadowBlur = 6;
    for (let i = 0; i <= 100; i++) { const [x, y] = toPx(i / 100, applyEase(e, i / 100)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.shadowBlur = 0;
    if (isBez) {
      const [a, b] = [toPx(bz[0], bz[1]), toPx(bz[2], bz[3])];
      ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...toPx(0, 0)); ctx.lineTo(...a); ctx.moveTo(...toPx(1, 1)); ctx.lineTo(...b); ctx.stroke();
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fillStyle = '#05060a'; ctx.fill(); ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2; ctx.stroke(); }
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

function panelProject() {
  const p = P();
  const out = h('div', {});
  out.append(section('Canvas', chips(Object.keys(ASPECTS).map(a => [a, a, 'aspect-' + a]), p.aspect, v => changeAspect(v)),
    select({ label: 'FPS', value: String(p.fps), options: [['24', '24'], ['25', '25'], ['30', '30'], ['60', '60']], onChange: v => { p.fps = +v; commit(); } }),
    slider({ label: 'Duration', value: p.duration, min: 1, max: 60, step: 0.5, testid: 'duration', onInput: v => { p.duration = v; }, onChange: v => { p.duration = v; p.layers.forEach(L => { if (L.end > v) L.end = v; if (L.start >= v) L.start = Math.max(0, v - 0.5); }); S.t = Math.min(S.t, v); commit(); } }),
    color({ label: 'Background', value: p.bg, onInput: liveSet(v => (p.bg = v)), onChange: v => { p.bg = v; commit(); } })));
  out.append(section('Project', h('div', { class: 'acts' },
    h('button', { class: 'act', onclick: openProjects, 'data-testid': 'open-projects' }, icon('menu'), 'Projects'),
    h('button', { class: 'act', onclick: () => newProjectFlow(), 'data-testid': 'new-project' }, icon('plus'), 'New'),
    h('button', { class: 'act', onclick: exportJSON, 'data-testid': 'export-json' }, icon('export'), 'Save JSON'),
    h('button', { class: 'act', onclick: () => $('#fileJson').click(), 'data-testid': 'import-json' }, icon('up'), 'Load JSON'),
    h('button', { class: 'act', onclick: exportPNG, 'data-testid': 'export-png' }, icon('media'), 'Frame PNG'))));
  out.append(h('div', { class: 'hint small' }, 'Autosaves to this device. Media lives in IndexedDB; JSON export embeds it. Add to Home Screen from Safari’s share menu for full-screen use.'));
  return out;
}

function changeAspect(a) {
  const p = P(); const [w, hh] = ASPECTS[a]; const sx = w / p.w, sy = hh / p.h;
  for (const L of p.layers) {
    L.props.x *= sx; L.props.y *= sy;
    (L.keys.x || []).forEach(k => (k.v *= sx)); (L.keys.y || []).forEach(k => (k.v *= sy));
  }
  p.w = w; p.h = hh; p.aspect = a; commit();
}

// ---------------- dialogs ----------------
const dlg = $('#dlg');
function openDialog(title, body) {
  dlg.replaceChildren(h('div', { class: 'dlg-h' }, h('b', {}, title), h('button', { class: 'mini', onclick: () => dlg.close(), 'data-testid': 'dlg-close' }, '✕')), body);
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
      h('button', { class: 'add-btn aspect', 'data-testid': 'new-' + a, onclick: () => { const p = newProject(a, 'Project ' + (store.listProjects().length + 1)); setProject(p); dlg.close(); S.tab = 'add'; renderTabs(); renderPanel(); } },
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
    p.id = uid(); setProject(p); toast('Project loaded');
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
  $('#btnProjects').replaceChildren(icon('menu')); $('#btnUndo').replaceChildren(icon('undo')); $('#btnRedo').replaceChildren(icon('redo'));
  $('#btnExport').prepend(icon('export'));
  $('#btnStart').replaceChildren(icon('start')); $('#btnLoop').replaceChildren(icon('loop'));
  $('#btnKey').prepend(icon('key')); $('#zoomIn').replaceChildren(icon('zin')); $('#zoomOut').replaceChildren(icon('zout'));
  $('#btnProjects').onclick = openProjects;
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnExport').onclick = openExport;
  $('#btnPlay').onclick = () => togglePlay();
  $('#btnStart').onclick = () => seek(0);
  $('#btnLoop').onclick = () => { S.loop = !S.loop; updateTransport(); };
  $('#btnKey').onclick = toggleKeyAll;
  $('#zoomIn').onclick = () => { S.autoFit = false; S.pps = Math.min(ZMAX, S.pps * 1.4); renderTimeline(); };
  $('#zoomOut').onclick = () => { S.autoFit = false; S.pps = Math.max(12, S.pps / 1.4); renderTimeline(); };
  $('#projName').onchange = e => { P().name = e.target.value || 'Untitled'; commit(); };
  $('#fileMedia').onchange = e => { const f = e.target.files[0]; if (f) importMediaFile(f); e.target.value = ''; };
  $('#fileJson').onchange = e => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; };
  window.addEventListener('resize', () => { layoutStage(); drawFrame(); renderTimeline(); });
  new ResizeObserver(() => { layoutStage(); drawFrame(); }).observe($('#stageWrap'));
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key === 'k') toggleKeyAll();
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const ks = selectedKeyObjs();
      if (ks.length) { ks.forEach(({ L, prop, k }) => removeKey(L, prop, k.id)); S.selKeys.clear(); commit(); }
      else if (selLayer()) { P().layers.splice(P().layers.indexOf(selLayer()), 1); S.sel = null; commit(); }
    } else if (e.key === 'ArrowLeft') seek(S.t - 1 / P().fps);
    else if (e.key === 'ArrowRight') seek(S.t + 1 / P().fps);
  });
}
function undo() { const s = history.undo(); if (s) { S.project = s; hydrateMedia(s); scheduleSave(); refreshAll(); } }
function redo() { const s = history.redo(); if (s) { S.project = s; hydrateMedia(s); scheduleSave(); refreshAll(); } }

function boot() {
  buildChrome(); lockPage(); bindTimelineGestures();
  const last = store.lastProjectId();
  let p = last && store.loadProject(last);
  if (!p) p = demoProject('9:16');
  renderTabs();
  setProject(p);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // test / debug hook
  window.__app = { S, get project() { return P(); }, seek, togglePlay, renderer, commit, refreshAll, setProject, demoProject, exportVideo, supportedFormats, EFFECTS, makeEffect };
}
boot();
