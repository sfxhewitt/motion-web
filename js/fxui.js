// Effects UI: effect cards (Effects panel), the Add Effect browser (search, carousel, categories, preset sheet),
// the "Keyframes Required" popup and the Easing Curve panel.
import { h, icon, toast } from './ui.js';
import { valueAt, hasKeys, findKey, setKey, removeKey, writeProp, clone, uid, PROP_META } from './state.js';
import { EASE_PRESETS, EASE_GROUPS, makeEase, applyEase, easeGroupOf, easeLabel, reverseEase } from './easing.js';
import { EFFECTS, CATS, CAT_NAME, defaults, makeEffect, fxKey, presetsFor, applyPreset, searchEffects, byCat, SUGGESTED_BIG, SUGGESTED_SMALL, SEARCH_TAGS } from './effects.js';
import { THUMBS } from './fx/thumbs.js';

let X = null; // app context from main.js
export function initFxUI(ctx) { X = ctx; }
const S = () => X.S, L_ = () => X.selLayer();

// ---------- labels ----------
const SHAPE_LABEL = { w: 'Width', h: 'Height', radius: 'Corner', points: 'Points', inner: 'Inner', thickness: 'Thickness', fill: 'Color', fill2: 'Color 2', gradAngle: 'Gradient Angle', stroke: 'Border Color', strokeW: 'Border Width' };
const NS_LABEL = {
  text: { fill: 'Text Color', stroke: 'Border Color', strokeW: 'Border Width', size: 'Text Size', tracking: 'Tracking', lineHeight: 'Line Height' },
  solid: { color: 'Color', fill2: 'Color 2', gradAngle: 'Gradient Angle' },
  shadow: { color: 'Shadow Color', blur: 'Shadow Blur', dx: 'Shadow X', dy: 'Shadow Y', alpha: 'Shadow Opacity' },
  media: { volume: 'Volume' },
};
export function propLabel(L, prop) {
  if (PROP_META[prop]) return PROP_META[prop].label;
  if (prop.startsWith('shape.')) return SHAPE_LABEL[prop.slice(6)] || prop.slice(6);
  const [ns, k] = prop.split('.'); if (NS_LABEL[ns]) return NS_LABEL[ns][k] || k;
  if (prop.startsWith('fx.')) { const [, id, k] = prop.split('.'); const f = L?.effects.find(e => e.id === id), d = f && EFFECTS[f.type]; return d ? `${d.name} · ${d.params[k]?.label || k}` : k; }
  return prop;
}
// new effect ids for a copied layer; keyframes follow their effect
export function renewFxIds(L) {
  for (const f of L.effects || []) {
    const old = f.id; f.id = uid();
    for (const k of Object.keys(L.keys)) if (k.startsWith(`fx.${old}.`)) { L.keys[`fx.${f.id}.` + k.slice(old.length + 4)] = L.keys[k]; delete L.keys[k]; }
  }
  return L;
}
function dropFxKeys(L, f) { for (const k of Object.keys(L.keys)) if (k.startsWith(`fx.${f.id}.`)) delete L.keys[k]; }

// ---------- thumbnails ----------
const liveThumbs = new Map(); let liveQ = [], liveBusy = false;
export function fxThumb(id, cls = '') {
  const el = h('i', { class: 'fxth ' + cls, 'data-fx': id });
  const i = THUMBS.ids.indexOf(id);
  if (i >= 0 && THUMBS.src) {
    const c = i % THUMBS.cols, r = Math.floor(i / THUMBS.cols);
    Object.assign(el.style, { backgroundImage: `url(${THUMBS.src})`, backgroundSize: `${THUMBS.cols * 100}% ${THUMBS.rows * 100}%`,
      backgroundPosition: `${THUMBS.cols > 1 ? c / (THUMBS.cols - 1) * 100 : 0}% ${THUMBS.rows > 1 ? r / (THUMBS.rows - 1) * 100 : 0}%` });
  } else if (liveThumbs.has(id)) el.style.backgroundImage = `url(${liveThumbs.get(id)})`;
  else { liveQ.push([id, el]); pumpLive(); }
  return el;
}
// fallback: render the thumbnail live (one per frame so the UI stays responsive)
async function pumpLive() {
  if (liveBusy) return; liveBusy = true;
  const { sampleProject, SAMPLE_T } = await import('./fxsample.js');
  const { Renderer } = await import('./render.js');
  const r = X.thumbRenderer || (X.thumbRenderer = new Renderer());
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const step = () => {
    const job = liveQ.shift(); if (!job) { liveBusy = false; return; }
    const [id, el] = job;
    if (!liveThumbs.has(id)) { try { const { project } = sampleProject(id, { size: 128 }); r.render(project, SAMPLE_T, c); liveThumbs.set(id, c.toDataURL('image/jpeg', 0.8)); } catch { liveThumbs.set(id, ''); } }
    if (el.isConnected) el.style.backgroundImage = `url(${liveThumbs.get(id)})`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- small widgets ----------
const decOf = st => (st >= 1 ? 0 : st >= 0.1 ? 1 : st >= 0.01 ? 2 : 3);
const unitTx = u => (u && u !== 'px' ? u : '');
export const fmtVal = (v, spec) => (+v).toFixed(spec.dec ?? Math.min(2, decOf(spec.step || 1))) + unitTx(spec.unit);
function niceTick(spec) {
  if (spec.tick) return spec.tick;
  if (spec.unit === '°') return 1;
  const raw = (spec.max - spec.min) / 400, base = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const t = [1, 2, 5, 10].map(m => m * base).find(m => m >= raw) || raw;
  return Math.max(spec.step || 0, t);
}
// horizontally scrolling tick ruler under a fixed mint centre line (Alight effect parameter rows)
function fxRuler({ value, spec, onInput, onChange, testid }) {
  const tick = niceTick(spec), PX = 7 / tick;
  const cv = h('canvas', { class: 'fr-cv' }), track = h('div', { class: 'fr-track', 'data-testid': testid }, cv, h('i', { class: 'fr-tick' }));
  let v = value;
  const draw = () => {
    const w = track.clientWidth, hh = track.clientHeight; if (!w) return;
    const dpr = Math.min(3, devicePixelRatio || 1); if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const c = w / 2, first = Math.floor((v - c / PX) / tick);
    for (let i = first; i <= first + w / 7 + 2; i++) {
      const u = i * tick; if (u < spec.min - 1e-9 || u > spec.max + 1e-9) continue;
      const x = Math.round(c + (u - v) * PX) + 0.5, major = i % 5 === 0;
      g.strokeStyle = major ? '#6c7088' : '#454a61'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, major ? hh * 0.2 : hh * 0.32); g.lineTo(x, hh * (major ? 0.8 : 0.68)); g.stroke();
    }
  };
  const set = (nv, fire) => { nv = Math.max(spec.min, Math.min(spec.max, nv)); if (spec.step >= 1) nv = Math.round(nv); if (nv === v) return; v = nv; draw(); if (fire) onInput?.(v); };
  let drag = null;
  track.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); track.setPointerCapture(e.pointerId); drag = { x: e.clientX, v0: v, moved: false, last: [{ x: e.clientX, t: performance.now() }] }; cancelAnimationFrame(track._mom); });
  track.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 2) drag.moved = true;
    drag.last.push({ x: e.clientX, t: performance.now() }); if (drag.last.length > 5) drag.last.shift(); set(drag.v0 - dx / PX, true); });
  const end = () => { if (!drag) return; const d = drag; drag = null; if (!d.moved) return;
    const a = d.last[0], b = d.last[d.last.length - 1], vel = (b.x - a.x) / Math.max(16, b.t - a.t); let sp = -vel / PX * 16;
    const st = () => { if (Math.abs(sp) < tick * 0.3) { onChange?.(v); return; } set(v + sp, true); sp *= 0.9; track._mom = requestAnimationFrame(st); };
    if (Math.abs(sp) > tick) track._mom = requestAnimationFrame(st); else onChange?.(v); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  new ResizeObserver(draw).observe(track); requestAnimationFrame(draw);
  track.set = nv => { v = nv; draw(); };
  return track;
}
// number box: tap to type, drag sideways to scrub
function numBox({ value, spec, onInput, onChange, testid, small }) {
  const tick = niceTick(spec);
  const i = h('input', { class: 'fx-num' + (small ? ' sm' : ''), type: 'text', inputmode: 'decimal', value: fmtVal(value, spec), 'data-testid': testid });
  let v = value, drag = null;
  const put = (nv, fire) => { nv = Math.max(spec.min ?? -1e9, Math.min(spec.max ?? 1e9, nv)); v = nv; i.value = fmtVal(v, spec); if (fire) onInput?.(v); };
  i.addEventListener('pointerdown', e => { if (document.activeElement === i) return; e.preventDefault(); i.setPointerCapture(e.pointerId); drag = { x: e.clientX, v0: v, moved: false }; });
  i.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; if (drag.moved) put(drag.v0 + Math.round(dx / 4) * tick, true); });
  const up = () => { if (!drag) return; const d = drag; drag = null; if (d.moved) onChange?.(v); else { i.focus(); i.select(); } };
  i.addEventListener('pointerup', up); i.addEventListener('pointercancel', () => { drag = null; });
  i.addEventListener('focus', () => { i.value = String(+(+v).toFixed(4)); i.select(); });
  i.addEventListener('change', () => { const n = parseFloat(i.value); if (!isNaN(n)) { put(n, true); onChange?.(v); } else i.value = fmtVal(v, spec); i.blur(); });
  i.addEventListener('blur', () => { i.value = fmtVal(v, spec); });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  i.set = nv => { v = nv; if (document.activeElement !== i) i.value = fmtVal(v, spec); };
  return i;
}
function popMenu(anchor, items, testid = 'fx-menu') {
  const wrap = h('div', { class: 'lm-wrap' }), scrim = h('div', { class: 'lm-scrim' });
  const close = () => wrap.remove();
  scrim.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); close(); });
  const m = h('div', { class: 'fxm', role: 'menu', 'data-testid': testid }, ...items.filter(Boolean).map(([label, tid, fn, off]) =>
    h('button', { class: 'fxm-it' + (off ? ' off' : ''), 'data-testid': tid, onclick: () => { if (off) return; close(); fn(); } }, label)));
  wrap.append(scrim, m); document.body.append(wrap);
  const r = anchor.getBoundingClientRect(), mw = 200;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px';
  const below = r.top < 240; m.classList.toggle('below', below);
  if (below) m.style.top = r.bottom + 10 + 'px'; else m.style.bottom = innerHeight - r.top + 10 + 'px';
  m.style.setProperty('--ax', (r.left + r.width / 2 - parseFloat(m.style.left)) + 'px');
  return close;
}
export function alertBox(title, text, testid = 'alert') {
  const wrap = h('div', { class: 'fxdlg-wrap', 'data-testid': testid });
  const ok = h('button', { class: 'fxdlg-ok', 'data-testid': testid + '-ok', onclick: () => wrap.remove() }, 'OK');
  wrap.append(h('div', { class: 'fxdlg' }, h('b', {}, title), typeof text === 'string' ? h('p', {}, text) : text, ok));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) wrap.remove(); });
  document.body.append(wrap); return wrap;
}
export const keyframesRequired = () => alertBox('Keyframes Required', 'Before adjusting animation easing you must first create at least two keyframes. Tap ◆ to add a keyframe, move the playhead to another time and change the value to add a second one.', 'kreq');
function effectDetails(def) {
  const rows = Object.values(def.params).map(p => h('li', {}, h('span', {}, p.label), h('em', {}, p.t === 'num' ? `${fmtVal(p.def, p)}  (${p.min} – ${p.max}${unitTx(p.unit)})` : p.t === 'select' ? p.opts.find(o => o[0] === p.def)?.[1] : p.t === 'vec3' || p.t === 'vec2' ? `[${p.def.join(', ')}]` : p.t === 'bool' ? (p.def ? 'On' : 'Off') : p.t === 'color' ? p.def : '—')));
  return alertBox(def.name, h('div', { class: 'fxdlg-body' }, h('small', {}, CAT_NAME[def.cat]), h('p', {}, def.desc), h('ul', {}, ...rows),
    h('p', { class: 'fxdlg-note' }, 'Every parameter can be keyframed: select it, then tap ◆.')), 'fxdetails');
}

// ---------- Effects panel ----------
const FXCLIP = 'kntc-fxclip';
function curParam(L) {
  const s = S().fxSel; const f = s && L.effects.find(e => e.id === s.id);
  if (f && EFFECTS[f.type]?.params[s.k]) return { f, k: s.k };
  const f0 = L.effects.find(e => EFFECTS[e.type] && Object.keys(EFFECTS[e.type].params).length);
  return f0 ? { f: f0, k: Object.keys(EFFECTS[f0.type].params)[0] } : null;
}
export function fxEaseTarget(L) { const c = curParam(L); return c ? fxKey(c.f, c.k) : null; }
// open the Easing Curve for the selected parameter (or explain that two keyframes are needed)
export function openEaseFor(L, prop, back) {
  const ks = (prop && L.keys[prop]) || [];
  if (ks.length < 2) { keyframesRequired(); return false; }
  const t = S().t; let i = ks.findIndex((k, j) => j < ks.length - 1 && t >= k.t && t < ks[j + 1].t);
  if (i < 0) i = t < ks[0].t ? 0 : ks.length - 2;
  S().selKeys.clear(); S().selKeys.add(ks[i].id); S().easeBack = back || null; S().easeGroup = easeGroupOf(ks[i].ease);
  S().tab = 'ease'; X.refreshAll(); return true;
}
export function panelFx(L) {
  const sel = curParam(L), cards = [];
  L.effects.forEach((f, i) => { const d = EFFECTS[f.type]; if (d) cards.push(fxCard(L, f, i, d, sel)); });
  const add = h('button', { class: 'fx-addbtn', 'data-testid': 'add-effect', onclick: () => openBrowser(L) }, '+ Add Effect');
  const content = h('div', { class: 'fx-panel' + (cards.length ? '' : ' empty') }, ...cards, add);
  const key = sel ? fxKey(sel.f, sel.k) : null;
  const kst = key ? (findKey(L, key, S().t) ? ' on' : hasKeys(L, key) ? ' anim' : '') : ' off';
  const left = [
    h('button', { class: 'ib fx-kbtn' + kst, title: 'Keyframe selected parameter', 'data-testid': 'fx-key', onclick: () => {
      if (!key) return toast('Add an effect first');
      const k = findKey(L, key, S().t); if (k) removeKey(L, key, k.id); else setKey(L, key, S().t, clone(valueAt(L, key, S().t)));
      X.commit(); } }, icon('key')),
    h('button', { class: 'ib fx-ebtn' + ((key && L.keys[key]?.length) > 1 ? '' : ' off'), title: 'Easing', 'data-testid': 'fx-ease', onclick: () => { if (!key) return keyframesRequired(); openEaseFor(L, key, 'fx'); } }, icon('graph')),
  ];
  return { content, left };
}
function fxCard(L, f, i, d, sel) {
  const rows = [];
  if (f.open !== false) for (const [k, spec] of Object.entries(d.params)) rows.push(paramRow(L, f, k, spec, sel && sel.f === f && sel.k === k));
  const more = h('button', { class: 'fx-more', title: 'More', 'data-testid': 'fx-more', onclick: e => fxMenu(e.currentTarget, L, f, i) }, icon('dots'));
  return h('div', { class: 'fxc' + (f.on ? '' : ' off') + (f.open === false ? ' closed' : ''), 'data-testid': 'fx-' + f.type, 'data-fxid': f.id },
    h('div', { class: 'fxc-h' },
      h('button', { class: 'fxc-tg', 'data-testid': 'fx-collapse', onclick: () => { f.open = f.open === false; X.commit({ silent: true }); X.renderPanel(); } }, h('i', { class: 'tri' }), h('b', {}, d.name)),
      f.on ? null : h('em', { class: 'fxc-offtag' }, 'Off'),
      more,
      h('button', { class: 'fx-del', title: 'Remove effect', 'data-testid': 'fx-del', onclick: () => { L.effects.splice(L.effects.indexOf(f), 1); dropFxKeys(L, f); X.commit(); } }, icon('trash'))),
    ...rows);
}
function fxMenu(anchor, L, f, i) {
  const d = EFFECTS[f.type], clip = (() => { try { return JSON.parse(localStorage.getItem(FXCLIP)); } catch { return null; } })();
  popMenu(anchor, [
    ['Reset to Defaults', 'fxm-reset', () => { f.params = defaults(f.type); dropFxKeys(L, f); X.commit(); }],
    ['Duplicate', 'fxm-dup', () => { const c = clone(f); c.id = uid(); for (const k of Object.keys(L.keys)) if (k.startsWith(`fx.${f.id}.`)) L.keys[`fx.${c.id}.` + k.slice(f.id.length + 4)] = clone(L.keys[k]).map(q => ({ ...q, id: uid() }));
      L.effects.splice(L.effects.indexOf(f) + 1, 0, c); X.commit(); toast('Effect duplicated'); }],
    ['Copy Effect', 'fxm-copy', () => { const keys = {}; for (const k of Object.keys(L.keys)) if (k.startsWith(`fx.${f.id}.`)) keys[k.slice(f.id.length + 4)] = L.keys[k].map(q => ({ ...q, t: q.t - L.start }));
      localStorage.setItem(FXCLIP, JSON.stringify({ fx: f, keys })); toast('Effect copied'); }],
    ['Effect Details', 'fxm-details', () => effectDetails(d)],
    clip?.fx && EFFECTS[clip.fx.type] ? ['Paste Effect', 'fxm-paste', () => pasteFx(L, clip, L.effects.indexOf(f) + 1)] : null,
    [f.on ? 'Disable Effect' : 'Enable Effect', 'fxm-toggle', () => { f.on = !f.on; X.commit(); }],
    i > 0 ? ['Move Up', 'fxm-up', () => { const j = L.effects.indexOf(f); L.effects.splice(j, 1); L.effects.splice(j - 1, 0, f); X.commit(); }] : null,
    i < L.effects.length - 1 ? ['Move Down', 'fxm-down', () => { const j = L.effects.indexOf(f); L.effects.splice(j, 1); L.effects.splice(j + 1, 0, f); X.commit(); }] : null,
  ]);
}
export function pasteFx(L, clip, at = L.effects.length) {
  const c = clone(clip.fx); c.id = uid(); c.params = { ...defaults(c.type), ...c.params };
  for (const [k, list] of Object.entries(clip.keys || {})) L.keys[`fx.${c.id}.${k}`] = list.map(q => ({ ...q, id: uid(), t: +(q.t + L.start).toFixed(4) }));
  L.effects.splice(at, 0, c); X.commit(); toast('Effect pasted');
}
function paramRow(L, f, k, spec, selected) {
  const key = fxKey(f, k), t = S().t, v = valueAt(L, key, t);
  const anim = hasKeys(L, key), onKey = anim && findKey(L, key, t);
  const pick = () => { if (S().fxSel?.id === f.id && S().fxSel?.k === k) return; S().fxSel = { id: f.id, k }; X.renderPanel(); X.renderTimeline(); };
  const label = h('button', { class: 'fxp-l' + (selected ? ' on' : ''), 'data-testid': 'fxp-' + k, onclick: pick }, anim ? h('i', { class: 'fxp-dot' + (onKey ? ' on' : '') }) : null, spec.label);
  const live = nv => { writeProp(L, key, S().t, nv); X.drawFrame(); };
  const done = () => { X.commit({ silent: true }); X.renderTimeline(); if (anim) X.renderPanel(); };
  const tid = 'fxv-' + k;
  let ctl;
  switch (spec.t) {
    case 'num': {
      const box = numBox({ value: v, spec, testid: tid, onInput: nv => { ruler.set(nv); live(nv); }, onChange: done });
      const ruler = fxRuler({ value: v, spec, testid: 'fxr-' + k, onInput: nv => { box.set(nv); live(nv); }, onChange: done });
      ruler.addEventListener('pointerdown', pick, true);
      ctl = [ruler, box]; break;
    }
    case 'vec2': case 'vec3': {
      const n = spec.t === 'vec2' ? 2 : 3, labs = spec.labels || ['x', 'y', 'z'], cur = v.slice();
      ctl = [h('div', { class: 'fxp-vec' }, ...Array.from({ length: n }, (_, j) => h('label', { class: 'fxp-vi' },
        numBox({ value: cur[j], spec: { ...spec, unit: spec.t === 'vec3' ? '' : '', dec: spec.t === 'vec3' ? 0 : 0 }, small: true, testid: `${tid}-${j}`, onInput: nv => { cur[j] = nv; live(cur.slice()); }, onChange: done }),
        h('small', {}, labs[j]))))];
      break;
    }
    case 'color': {
      const inp = h('input', { type: 'color', value: v, 'data-testid': tid });
      inp.addEventListener('input', () => live(inp.value)); inp.addEventListener('change', () => { live(inp.value); done(); });
      ctl = [h('span', { class: 'sp' }), h('label', { class: 'fxp-col', style: { '--c': v } }, inp, h('code', {}, v.toUpperCase()))]; break;
    }
    case 'bool': {
      const b = h('button', { class: 'tog' + (v ? ' on' : ''), 'data-testid': tid, onclick: () => { live(!valueAt(L, key, S().t)); done(); X.renderPanel(); } }, h('i'));
      ctl = [h('span', { class: 'sp' }), b]; break;
    }
    case 'select': {
      const s = h('select', { class: 'fxp-sel', 'data-testid': tid }, spec.opts.map(([ov, ot]) => h('option', { value: ov, selected: String(ov) === String(v) }, ot)));
      s.addEventListener('change', () => { const ov = spec.opts.find(o => String(o[0]) === s.value)?.[0] ?? s.value; live(ov); done(); });
      ctl = [s]; break;
    }
    case 'layer': {
      const s = h('select', { class: 'fxp-sel', 'data-testid': tid }, h('option', { value: '' }, 'None'),
        X.P().layers.filter(l => l.id !== L.id && l.type !== 'audio').map(l => h('option', { value: l.id, selected: l.id === v }, l.name)));
      s.addEventListener('change', () => { live(s.value); done(); });
      ctl = [s]; break;
    }
    default: ctl = [];
  }
  return h('div', { class: 'fxp' + (selected ? ' on' : '') + (spec.t === 'num' ? '' : ' alt'), 'data-param': k }, label, ...ctl);
}

// ---------- Add Effect browser ----------
const FAV = 'kntc-fxfav';
const favs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV) || '[]')); } catch { return new Set(); } };
let B = null; // { root, L, stack }
export function openBrowser(L) {
  closeBrowser();
  const root = h('div', { class: 'fxb', 'data-testid': 'fx-browser' });
  B = { root, L, stack: [] };
  document.body.append(root); document.body.classList.add('fxb-open');
  showPage(homePage());
}
export function closeBrowser() { if (!B) return; B.root.remove(); B = null; document.body.classList.remove('fxb-open'); }
function showPage(page, push = true) { if (push) B.stack.push(page); B.root.replaceChildren(page); }
function backPage() { B.stack.pop(); const p = B.stack[B.stack.length - 1]; if (p) B.root.replaceChildren(p); else closeBrowser(); }
const circleBtn = (ic, tid, fn, title) => h('button', { class: 'fxb-cb', 'data-testid': tid, title, onclick: fn }, icon(ic));
function homePage() {
  const big = h('div', { class: 'fxb-car fxb-scroll x', 'data-testid': 'fx-carousel' }, ...SUGGESTED_BIG.filter(id => EFFECTS[id]).map(id =>
    h('button', { class: 'fxb-big', 'data-testid': 'sugg-' + id, onclick: () => openPresets(id) }, fxThumb(id, 'big'), h('span', {}, EFFECTS[id].name))));
  const small = h('div', { class: 'fxb-small' }, ...SUGGESTED_SMALL.filter(id => EFFECTS[id]).map(id =>
    h('button', { class: 'fxb-sm', 'data-testid': 'sugg-' + id, onclick: () => openPresets(id) }, fxThumb(id, 'sm'), h('span', {}, EFFECTS[id].name))));
  const dots = h('div', { class: 'fxb-dots' }, h('i', { class: 'on' }));
  const cats = h('div', { class: 'fxb-cats' }, ...CATS.map(([id, name]) => {
    const first = byCat(id)[Math.min(2, byCat(id).length - 1)];
    return h('button', { class: 'fxb-cat', 'data-testid': 'cat-' + id, onclick: () => showPage(catPage(id)) }, first ? fxThumb(first.id, 'bg') : null, h('span', {}, name));
  }));
  return h('div', { class: 'fxb-page home' },
    h('div', { class: 'fxb-h' }, circleBtn('close', 'fxb-close', closeBrowser, 'Close'), h('b', {}, 'Add Effect'), circleBtn('zoom', 'fxb-search', () => showPage(searchPage()), 'Search')),
    h('div', { class: 'fxb-body fxb-scroll' }, h('div', { class: 'fxb-sugg' }, big, small, dots), cats));
}
function catPage(cat) {
  const list = byCat(cat), ix = CATS.findIndex(c => c[0] === cat);
  const go = d => { const j = (ix + d + CATS.length) % CATS.length; B.stack.pop(); showPage(catPage(CATS[j][0])); };
  return h('div', { class: 'fxb-page cat', 'data-testid': 'cat-page-' + cat },
    h('div', { class: 'fxb-h' }, circleBtn('chevl', 'fxb-back', backPage, 'Back'), h('b', {}, CAT_NAME[cat]), h('i', { class: 'fxb-sp' })),
    h('div', { class: 'fxb-body fxb-scroll' }, h('div', { class: 'fxb-grid' }, ...list.map(e => h('button', { class: 'fxb-it', 'data-testid': 'fxi-' + e.id, onclick: () => openPresets(e.id) }, fxThumb(e.id), h('span', {}, e.name))))),
    h('div', { class: 'fxb-foot' }, h('button', { class: 'fxb-arr', 'data-testid': 'cat-prev', onclick: () => go(-1) }, icon('chevl')), h('button', { class: 'fxb-arr', 'data-testid': 'cat-next', onclick: () => go(1) }, icon('chevr'))));
}
function searchPage() {
  const inp = h('input', { class: 'fxb-q', type: 'search', placeholder: 'Type Here to Search', 'data-testid': 'fx-search-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const body = h('div', { class: 'fxb-body fxb-scroll' });
  let tag = null;
  const hi = (name, q) => { const i = name.toLowerCase().indexOf(q); return i < 0 || !q ? name : [name.slice(0, i), h('mark', {}, name.slice(i, i + q.length)), name.slice(i + q.length)]; };
  const upd = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q && !tag) { body.replaceChildren(h('div', { class: 'fxb-tags' }, ...SEARCH_TAGS.slice(0, 5).map(t => h('button', { class: 'fxb-tag', 'data-testid': 'tag-' + t, onclick: () => { tag = t; upd(); } }, t)))); return; }
    const res = searchEffects(q, tag);
    body.replaceChildren(...[
      tag ? h('div', { class: 'fxb-tagon' }, h('button', { class: 'fxb-tag on', onclick: () => { tag = null; upd(); } }, tag, ' ×')) : null,
      ...(res.length ? res.map(e => h('button', { class: 'fxb-res', 'data-testid': 'res-' + e.id, onclick: () => openPresets(e.id) }, fxThumb(e.id, 'res'),
        h('span', {}, h('b', {}, ...[hi(e.name, q)].flat()), h('small', {}, e.desc)))) : [h('div', { class: 'fxb-none' }, 'No effects found')])].filter(Boolean));
  };
  inp.addEventListener('input', upd);
  upd(); setTimeout(() => inp.focus(), 50);
  return h('div', { class: 'fxb-page search', 'data-testid': 'fx-search' }, h('div', { class: 'fxb-h q' }, circleBtn('chevl', 'fxb-back', backPage, 'Back'), h('label', { class: 'fxb-qw' }, icon('zoom'), inp)), body);
}
function openPresets(id) {
  const d = EFFECTS[id], fav = favs();
  const wrap = h('div', { class: 'fxps-wrap', 'data-testid': 'preset-sheet' });
  const close = () => wrap.remove();
  const add = pr => {
    const L = B.L; const f = applyPreset(L, id, pr); L.effects.push(f);
    S().fxSel = { id: f.id, k: Object.keys(d.params)[0] }; closeBrowser();
    if (S().tab !== 'fx') S().tab = 'fx';
    X.commit(); toast(`${d.name} added`);
    requestAnimationFrame(() => { const el = document.querySelector(`.fxc[data-fxid="${f.id}"]`), body = document.getElementById('panelBody'); if (el && body) body.scrollTop = el.offsetTop - 6; });
  };
  const row = pr => { const fk = `${id}:${pr.code || 'std'}`;
    const star = h('button', { class: 'fxps-star' + (fav.has(fk) ? ' on' : ''), title: 'Favourite', onclick: e => { e.stopPropagation(); fav.has(fk) ? fav.delete(fk) : fav.add(fk); localStorage.setItem(FAV, JSON.stringify([...fav])); star.classList.toggle('on'); } }, icon('presets'));
    return h('div', { class: 'fxps-row', 'data-testid': 'preset-' + (pr.code || 'std'), onclick: () => add(pr) }, h('i', { class: 'fxps-plus' }, '+'),
      h('span', {}, pr.code ? h('small', {}, 'PRESET: ' + pr.code) : null, h('b', {}, pr.name)), star); };
  const sheet = h('div', { class: 'fxps' },
    h('div', { class: 'fxps-hero' }, fxThumb(id, 'hero'),
      h('div', { class: 'fxps-top' }, h('button', { class: 'fxps-x', 'data-testid': 'preset-close', onclick: close }, icon('close')), h('button', { class: 'fxps-guide', 'data-testid': 'preset-guide', onclick: () => effectDetails(d) }, 'Guide')),
      h('div', { class: 'fxps-info' }, h('b', {}, d.name), h('p', {}, d.desc), h('div', { class: 'fxps-tags fxb-scroll x' }, ...(d.tags.length ? d.tags : [CAT_NAME[d.cat]]).map(t => h('i', {}, t))))),
    h('div', { class: 'fxps-list fxb-scroll' }, ...presetsFor(id).map(row)));
  wrap.append(h('div', { class: 'fxps-scrim', onclick: close }), sheet);
  B.root.append(wrap);
}

// ---------- Easing Curve panel ----------
function easeTargets() { return X.selectedKeyObjs(); }
function nextKey(L, prop, k) { const ks = L.keys[prop] || []; const i = ks.indexOf(k); return i >= 0 ? ks[i + 1] : null; }
let EZ = null; // live state for the yellow dot
export function panelEase(L) {
  const ks = easeTargets();
  const cur = ks[0]?.k.ease || makeEase('linear');
  const has = ks.length > 0;
  const grp = S().easeGroup || easeGroupOf(cur);
  const apply = e => { ks.forEach(({ k }) => (k.ease = clone(e))); X.commit(); X.drawFrame(); };
  // graph
  const cv = h('canvas', { class: 'ez-cv', 'data-testid': 'bezier' });
  const box = h('div', { class: 'ez-graph' + (has ? '' : ' empty') }, cv);
  let e = clone(cur); const isBez = () => !e.type || e.type === 'bezier';
  let range = [0, 1];
  const geo = () => { const w = box.clientWidth, hh = box.clientHeight, px = 18, py = 16; return { w, hh, px, py, iw: w - px * 2, ih: hh - py * 2 }; };
  const toPx = (x, y, G) => [G.px + x * G.iw, G.py + (range[1] - y) / (range[1] - range[0]) * G.ih];
  const fromPx = (X_, Y_, G) => [Math.max(0, Math.min(1, (X_ - G.px) / G.iw)), range[1] - (Y_ - G.py) / G.ih * (range[1] - range[0])];
  const calcRange = () => { let lo = 0, hi = 1; for (let i = 0; i <= 64; i++) { const y = applyEase(e, i / 64); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (isBez()) { lo = Math.min(lo, e.bz[1], e.bz[3]); hi = Math.max(hi, e.bz[1], e.bz[3]); } const m = (hi - lo) * 0.06; range = [lo - m, hi + m]; };
  const draw = () => {
    const G = geo(); if (!G.w) return; const dpr = Math.min(3, devicePixelRatio || 1);
    if (cv.width !== Math.round(G.w * dpr) || cv.height !== Math.round(G.hh * dpr)) { cv.width = Math.round(G.w * dpr); cv.height = Math.round(G.hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.hh);
    g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
    for (let x = 0; x <= G.w; x += 12) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, G.hh); g.stroke(); }
    for (let y = 0; y <= G.hh; y += 12) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(G.w, y + .5); g.stroke(); }
    if (!has) return;
    calcRange();
    const [, y1] = toPx(0, 1, G), [x0, y0] = toPx(0, 0, G), [x1] = toPx(1, 1, G);
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x0, y1 + .5); g.lineTo(x1, y1 + .5); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(x0, y0 + .5); g.lineTo(x1, y0 + .5); g.stroke();
    g.beginPath(); g.strokeStyle = '#1ff0a0'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
    const N = Math.max(120, Math.round(G.iw)); for (let i = 0; i <= N; i++) { const [x, y] = toPx(i / N, applyEase(e, i / N), G); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    for (const [x, y] of [[x0, y0], toPx(1, 1, G)]) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fillStyle = '#1ff0a0'; g.fill(); }
    if (isBez()) {
      const a = toPx(e.bz[0], e.bz[1], G), b = toPx(e.bz[2], e.bz[3], G);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(...a); g.moveTo(...toPx(1, 1, G)); g.lineTo(...b); g.stroke();
      for (const p of [a, b]) { g.beginPath(); g.arc(p[0], p[1], 9, 0, 7); g.fillStyle = '#fff'; g.fill(); }
    }
    // yellow dot: where the playhead is along this easing segment
    const u = EZ?.u;
    if (u != null) { const [x, y] = toPx(u, applyEase(e, u), G); g.setLineDash([2, 3]); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + .5, y1); g.lineTo(x + .5, y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = '#f7cc4a'; g.fill(); }
  };
  if (has) {
    let drag = -1;
    cv.addEventListener('pointerdown', ev => { if (!isBez()) return; ev.preventDefault(); const G = geo(), r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      const a = toPx(e.bz[0], e.bz[1], G), b = toPx(e.bz[2], e.bz[3], G); drag = Math.hypot(px - a[0], py - a[1]) <= Math.hypot(px - b[0], py - b[1]) ? 0 : 1; cv.setPointerCapture(ev.pointerId); });
    cv.addEventListener('pointermove', ev => { if (drag < 0) return; const G = geo(), r = cv.getBoundingClientRect(); const [x, y] = fromPx(ev.clientX - r.left, ev.clientY - r.top, G);
      e.bz[drag * 2] = +x.toFixed(3); e.bz[drag * 2 + 1] = +Math.max(-1.5, Math.min(2.5, y)).toFixed(3); e.preset = 'custom'; ks.forEach(({ k }) => (k.ease = clone(e))); X.drawFrame(); draw(); lab.firstChild.textContent = easeLabel(e); });
    const up = () => { if (drag >= 0) { drag = -1; apply(e); X.renderPanel(); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  new ResizeObserver(draw).observe(box); requestAnimationFrame(draw);
  EZ = { draw, ks, u: null }; easeTick();
  // label bar  < name >
  const group = EASE_GROUPS.find(g => g[0] === grp) || EASE_GROUPS[0];
  const cycle = d => { const list = group[2], i = list.indexOf(cur.preset); apply(makeEase(list[(i + d + list.length) % list.length] || list[0])); X.renderPanel(); };
  const extras = [];
  const pbox = (label, k, spec) => h('label', { class: 'ez-pb' }, h('small', {}, label), numBox({ value: e[k] ?? spec.def, spec, small: true, testid: 'ezp-' + k, onInput: v => { e[k] = v; ks.forEach(({ k: q }) => (q.ease = clone(e))); draw(); X.drawFrame(); }, onChange: () => apply(e) }));
  if (has && e.type === 'bounce') extras.push(pbox('Bounces', 'n', { min: 1, max: 12, step: 1, def: 3 }), pbox('Height', 'r', { min: 0.05, max: 0.9, step: 0.01, def: 0.25, dec: 2 }));
  if (has && e.type === 'spring') extras.push(pbox('Freq', 'f', { min: 0.25, max: 8, step: 0.05, def: 1, dec: 2 }), pbox('Damping', 'd', { min: 0.5, max: 20, step: 0.1, def: 5, dec: 1 }));
  if (has && e.type === 'steps') extras.push(pbox('Steps', 'n', { min: 2, max: 30, step: 1, def: 5 }));
  const lab = h('span', { class: 'ez-name', 'data-testid': 'ease-name' }, has ? easeLabel(cur) : '');
  const bar = h('div', { class: 'ez-bar' }, h('button', { class: 'ez-arr', 'data-testid': 'ease-prev', disabled: !has, onclick: () => cycle(-1) }, icon('chevl')), lab, ...extras,
    h('button', { class: 'ez-arr', 'data-testid': 'ease-next', disabled: !has, onclick: () => cycle(1) }, icon('chevr')));
  // presets of the current group (mini curves) + group column
  const mini = (name) => { const c = h('canvas', { width: 64, height: 64 }); const g = c.getContext('2d'), m = makeEase(name); let lo = 0, hi = 1; for (let i = 0; i <= 40; i++) { const y = applyEase(m, i / 40); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); for (let i = 0; i <= 40; i++) { const x = 10 + i / 40 * 44, y = 54 - (applyEase(m, i / 40) - lo) / (hi - lo || 1) * 44; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); return c; };
  const presets = h('div', { class: 'ez-pre fxb-scroll' }, ...group[2].map(n => h('button', { class: 'ez-p' + (has && cur.preset === n ? ' on' : ''), title: EASE_PRESETS[n].label, 'data-testid': 'ease-' + n, onclick: () => { if (!has) return keyframesRequired(); apply(makeEase(n)); X.renderPanel(); } }, mini(n))));
  const GI = { curve: 'easecurve', physics: 'easephys', steps: 'easesteps' };
  const groups = h('div', { class: 'ez-grp' }, ...EASE_GROUPS.map(([id, label]) => h('button', { class: 'ez-g' + (id === grp ? ' on' : ''), title: label, 'data-testid': 'eg-' + id, onclick: () => { S().easeGroup = id; X.renderPanel(); } }, icon(GI[id]))));
  const content = h('div', { class: 'ez' }, h('div', { class: 'ez-main' }, box, bar), presets, groups);
  const left = [
    h('button', { class: 'ib', title: 'Reverse', 'data-testid': 'ease-rev', disabled: !has, onclick: () => { apply(reverseEase(cur)); X.renderPanel(); } }, icon('swap')),
    h('button', { class: 'ib', title: 'More', 'data-testid': 'ease-more', onclick: ev => { popMenu(ev.currentTarget, [
      ['Copy Keyframes', 'ezm-copy', () => X.copySelectedKeys(), !has],
      ['Paste Keyframes', 'ezm-paste', () => X.pasteKeysHere()],
      ['Select All Keyframes', 'ezm-selall', () => X.selectAllKeys()],
      has && ['Apply to All Keyframes', 'ezm-all', () => { const lay = ks[0].L, prop = ks[0].prop; (lay.keys[prop] || []).forEach(k => (k.ease = clone(cur))); X.commit(); toast('Applied to all keyframes of this property'); }],
      has && ['Apply to Whole Layer', 'ezm-layer', () => { const lay = ks[0].L; for (const p in lay.keys) lay.keys[p].forEach(k => (k.ease = clone(cur))); X.commit(); toast('Applied to all keyframes in layer'); }],
      has && ['Reset to Linear', 'ezm-linear', () => { apply(makeEase('linear')); X.renderPanel(); }],
      has && ['Delete Keyframe', 'ezm-del', () => { ks.forEach(({ L: lay, prop, k }) => removeKey(lay, prop, k.id)); S().selKeys.clear(); X.commit(); }],
    ], 'ease-menu'); } }, icon('dots')),
  ];
  return { content, left, cls: 'ease' };
}
// called every rendered frame: moves the yellow dot along the selected easing segment
export function easeTick() {
  if (!EZ || !EZ.draw || S().tab !== 'ease') return;
  const it = EZ.ks?.[0]; let u = null;
  if (it) { const b = nextKey(it.L, it.prop, it.k), t = S().t; if (b && t >= it.k.t && t <= b.t) u = (t - it.k.t) / (b.t - it.k.t || 1); }
  if (u !== EZ.u) { EZ.u = u; EZ.draw(); }
}
