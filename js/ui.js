// Tiny DOM helpers + control widgets.
export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

const fmt = (v, step) => { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3; return (+v).toFixed(d); };

// Slider row: label | range | number | (optional keyframe diamond)
export function slider({ label, value, min, max, step = 0.01, onInput, onChange, key, testid }) {
  const range = h('input', { type: 'range', min, max, step, value, 'data-testid': testid });
  const fill = () => range.style.setProperty('--p', ((+range.value - min) / ((max - min) || 1) * 100).toFixed(2) + '%');
  fill(); range.addEventListener('input', fill);
  const num = h('input', { type: 'number', min, max, step, value: fmt(value, step), class: 'num', inputmode: 'decimal' });
  range.addEventListener('input', () => { num.value = fmt(range.value, step); onInput?.(+range.value); });
  range.addEventListener('change', () => onChange?.(+range.value));
  num.addEventListener('change', () => { const v = +num.value; if (!isNaN(v)) { range.value = v; onInput?.(v); onChange?.(v); } });
  const row = h('div', { class: 'ctl' }, h('label', {}, label), range, num);
  if (key) {
    const d = h('button', { class: 'kd' + (key.state === 2 ? ' on' : key.state === 1 ? ' anim' : ''), title: 'Keyframe', 'data-testid': testid ? testid + '-key' : null, onclick: key.toggle },
      h('span'));
    row.append(d);
  }
  row.set = v => { range.value = v; num.value = fmt(v, step); fill(); };
  return row;
}

export function color({ label, value, onChange, onInput }) {
  const inp = h('input', { type: 'color', value });
  inp.addEventListener('input', () => onInput?.(inp.value));
  inp.addEventListener('change', () => onChange?.(inp.value));
  return h('div', { class: 'ctl ctl-color' }, h('label', {}, label), inp, h('code', {}, value));
}

export function toggle({ label, value, onChange, testid }) {
  const b = h('button', { class: 'tog' + (value ? ' on' : ''), 'data-testid': testid, onclick: () => { value = !value; b.classList.toggle('on', value); onChange(value); } }, h('i'));
  return h('div', { class: 'ctl ctl-tog' }, h('label', {}, label), b);
}

export function select({ label, value, options, onChange, testid }) {
  const s = h('select', { 'data-testid': testid }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  s.addEventListener('change', () => onChange(s.value));
  return h('div', { class: 'ctl' }, h('label', {}, label), s);
}

export function chips(options, value, onPick, cls = '') {
  return h('div', { class: 'chips ' + cls }, options.map(([v, t, tid]) =>
    h('button', { class: 'chip' + (v === value ? ' on' : ''), 'data-testid': tid, onclick: () => onPick(v) }, t)));
}

export function section(title, ...kids) { return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, title), ...kids); }

export function toast(msg, ms = 1800) {
  const t = h('div', { class: 'toast' }, msg); document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export const ICONS = {
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  chevl: '<path d="M14 6l-6 6 6 6"/>',
  gear: '<path d="M10.3 3h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 8.5l1.7-2.9 2.3.8 1.7-1Z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8.5 10.5H6v9.5h12v-9.5h-2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  undo: '<path d="M8.5 5.5 4 10l4.5 4.5"/><path d="M4.5 10h10a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="M15.5 5.5 20 10l-4.5 4.5"/><path d="M19.5 10h-10a5 5 0 0 0 0 10H13"/>',
  start: '<path d="M5 5v14"/><path d="M19 12H8.5M13 7.5 8.5 12l4.5 4.5"/>',
  end: '<path d="M19 5v14"/><path d="M5 12h10.5M11 7.5l4.5 4.5-4.5 4.5"/>',
  play: '<path d="M7.5 4.8v14.4L19 12Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.8z" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="4" width="11" height="11" rx="1.5"/><path d="M15 15v3.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18.5V11.5A1.5 1.5 0 0 1 6.5 10H9"/><path d="M4 18.5h4M6 16.5v4" stroke-width="1.6"/>',
  fit: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  more: '<circle cx="12" cy="12" r="9.5"/><circle cx="7.8" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="16.2" cy="12" r=".9" fill="currentColor"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5"/><path d="M6.5 6.5l1 13.5h9l1-13.5"/><path d="M10 10v6.5M14 10v6.5"/>',
  dup: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5" stroke-dasharray="2.2 1.8"/><path d="M15.5 5.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.6M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.3-1.1"/>',
  // tile grid (layer selected)
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l3-5.5"/><path d="M12 7v1.5M7 9.5l1 1M17 9.5l-1 1M5 13.5h1.5M19 13.5h-1.5"/>',
  splitl: '<path d="M12 4v16"/><path d="M9 7H5v10h4" stroke-dasharray="2 1.8"/><path d="M15 7h4v10h-4"/>',
  split: '<path d="M12 4v16"/><path d="M9 7H5v10h4M15 7h4v10h-4"/>',
  splitr: '<path d="M12 4v16"/><path d="M9 7H5v10h4"/><path d="M15 7h4v10h-4" stroke-dasharray="2 1.8"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  fill: '<path d="M6.5 9.5 11 5l6.5 6.5-5 5a2.5 2.5 0 0 1-3.5 0l-2.5-2.5a2.5 2.5 0 0 1 0-3.5Z"/><path d="M6.5 9.5h11"/><path d="M8.5 3.5 11 5"/><path d="M19.5 15.5s-1.8 2.2-1.8 3.3a1.8 1.8 0 0 0 3.6 0c0-1.1-1.8-3.3-1.8-3.3Z"/>',
  border: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/><path d="M10 14l4-4v4Z" fill="currentColor"/>',
  blend: '<path d="M12 4 21 9l-9 5-9-5Z"/><path d="M3 13l9 5 9-5"/><path d="M8 7.5v4M10 6.5v6M12 5.5v7.5M14 6.5v6M16 7.5v4" stroke-width="1.2"/>',
  move: '<path d="M12 7v10M7 12h10M12 7l-1.8 1.8M12 7l1.8 1.8M12 17l-1.8-1.8M12 17l1.8-1.8M7 12l1.8-1.8M7 12l1.8 1.8M17 12l-1.8-1.8M17 12l-1.8 1.8"/><path d="M4.5 9.5a8 8 0 0 1 12.5-5.2M19.5 14.5a8 8 0 0 1-12.5 5.2"/><path d="M17.3 2.5v2.2h-2.2M6.7 21.5v-2.2h2.2"/>',
  editshape: '<circle cx="7.5" cy="7.5" r="3.5"/><path d="M16.5 4l3.8 6.5h-7.6Z"/><rect x="4" y="13.5" width="7" height="7" rx=".5"/><path d="M16.5 20.5l-3-3a1.8 1.8 0 0 1 3-2 1.8 1.8 0 0 1 3 2Z"/>',
  edittext: '<path d="M4 6V4.5h11V6M9.5 4.5v13M7.5 17.5h4"/><path d="M14 20l1-3.5 5-5 2.5 2.5-5 5Z"/>',
  editmedia: '<rect x="3.5" y="5" width="13" height="11" rx="1.5"/><path d="m4 14 3.5-3.5 3 2.5 2-2 3.5 3.5"/><path d="M14 20l1-3.5 5-5 2.5 2.5-5 5Z"/>',
  presets: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 17l-5.3 2.9 1.1-6-4.4-4.1 6-.8Z"/>',
  effects: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M5.6 18.4l3.2-3.2M15.2 8.8l3.2-3.2"/>',
  ease: '<path d="M3.5 19.5C11 19.5 10 4.5 20.5 4.5"/><circle cx="3.5" cy="19.5" r="1.5"/><circle cx="20.5" cy="4.5" r="1.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5"/>',
  center: '<circle cx="12" cy="12" r="2"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
  // add sheet
  shapes: '<circle cx="7.5" cy="7.5" r="3.5"/><path d="M16.5 4l3.8 6.5h-7.6Z"/><rect x="4" y="13.5" width="7" height="7" rx=".5"/><path d="M16.5 20.5l-3-3a1.8 1.8 0 0 1 3-2 1.8 1.8 0 0 1 3 2Z"/>',
  media: '<rect x="4.5" y="6.5" width="16" height="12.5" rx="1.5"/><path d="M3 15.5V5.5A1.5 1.5 0 0 1 4.5 4H18"/><path d="m5.5 17.5 4.5-4.5 3.5 3 2.5-2 3.5 3.5"/><circle cx="15.5" cy="10" r="1.3"/>',
  audio: '<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/><path d="M9 9l10-2"/>',
  object: '<path d="M14.5 3.5l4.3 2.5v5l-4.3 2.5-4.3-2.5v-5Z"/><circle cx="8.5" cy="14.5" r="4.5"/><circle cx="15.5" cy="16" r="4.5"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16M10 9v11"/>',
  freehand: '<path d="M3 17.5c2-1.5 3.5-1.5 4.5 0s2.5 1.5 4 0"/><path d="M13 14l1.2-3.6 6.1-6.1a1.7 1.7 0 0 1 2.4 2.4l-6.1 6.1Z"/><path d="M18.8 5.8l1.4 1.4"/><path d="M3 21h18"/>',
  vector: '<path d="M12 21v-4.5"/><path d="M8 13.5 12 3l4 10.5-4 3Z"/><circle cx="12" cy="11" r="1.4"/><path d="M4 7.5h4.5M15.5 7.5H20"/><circle cx="3" cy="7.5" r="1" fill="currentColor"/><circle cx="21" cy="7.5" r="1" fill="currentColor"/>',
  textaa: '<path d="M3 19 8 6l5 13M4.8 14.5h6.4"/><path d="M15.5 9.5a2.4 2.4 0 0 1 4.8 0V15M20.3 12.6c-3 0-4.8.8-4.8 2.2s2.2 2 4.8.2"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="4" y="4" width="4" height="4" fill="currentColor"/><rect x="10" y="4" width="4" height="4" fill="currentColor"/><rect x="16" y="4" width="4" height="4" fill="currentColor"/><rect x="4" y="10" width="4" height="4" fill="currentColor"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/><rect x="16" y="10" width="4" height="4" fill="currentColor"/><rect x="4" y="16" width="4" height="4" fill="currentColor"/><rect x="10" y="16" width="4" height="4" fill="currentColor"/><rect x="16" y="16" width="4" height="4" fill="currentColor"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
  group: '<rect x="5" y="5" width="14" height="14" stroke-dasharray="2 2"/><circle cx="5" cy="5" r="1.3" fill="currentColor"/><circle cx="19" cy="5" r="1.3" fill="currentColor"/><circle cx="5" cy="19" r="1.3" fill="currentColor"/><circle cx="19" cy="19" r="1.3" fill="currentColor"/>',
  nullobj: '<rect x="4.5" y="4.5" width="15" height="15"/><path d="M4.5 19.5 19.5 4.5"/>',
  element: '<path d="M9.5 4 16 15H3Z"/><circle cx="15" cy="15.5" r="5"/>',
  solid: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 14l5-5 4 4 2.5-2.5L20 15"/>',
  adjust: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16A8 8 0 0 0 12 4Z" fill="currentColor"/>',
  demo: '<path d="M4 20 10 4l4 10 2-4 4 10"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4"/>',
  recents: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  // drawing / points
  pencil: '<path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19Z"/><path d="M14.5 6l3.5 3.5"/>',
  brush: '<path d="M20.5 3.5 11 13"/><path d="M11 13c-3-1-5.5 1-5.5 3.5S4 20.5 3 20.5c3 1.2 8.5.8 9.5-3.5.3-1.4-.4-2.9-1.5-4Z"/>',
  smudge: '<path d="M14.5 3.5c-3 1-2.5 3.5-5.5 4.5M17.5 7c-3 1-5 4-8 5M16 12.5c-2.5 1-4 3.5-7 4.5"/><path d="M9 8l-1.5 5.5L9 17l3 3.5"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.5 15.5 14 6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L10 20H8.5Z"/><path d="M9 11l5 5"/>',
  dropper: '<path d="M14 4.5 19.5 10M12.5 6l5.5 5.5"/><path d="M15 8.5 6.5 17v2h2L17 10.5"/><path d="M17 4a2 2 0 0 1 3 3l-1.5 1.5L15.5 5.5Z"/>',
  canvas: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M14 4v4.5a1.5 1.5 0 0 0 1.5 1.5H20"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9Z"/><circle cx="7.5" cy="12" r="1.1"/><circle cx="9.5" cy="7.8" r="1.1"/><circle cx="14.5" cy="7.8" r="1.1"/>',
  node: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/>',
  bezier: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="4" cy="12" r="1.2"/><circle cx="20" cy="12" r="1.2"/><path d="M8 9.5c2-2 6-2 8 0"/>',
  pluscircle: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  key: '<path d="M12 3.5 19 12l-7 8.5L5 12Z"/><path d="M12 7.5v9" stroke-width="1.4"/>',
  diamond: '<path d="M12 3 21 12 12 21 3 12Z"/>',
  menu: '<path d="M4 7h16M4 12h10M4 17h16"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 14v6h16v-6"/>',
  loop: '<path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1"/>',
  layer: '<path d="M12 3 21 8l-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
};
export const icon = (n, cls = '') => h('span', { class: 'ico ' + cls, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>` });
