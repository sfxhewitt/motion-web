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
  row.set = v => { range.value = v; num.value = fmt(v, step); };
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
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="7"/>',
  triangle: '<path d="M12 4 21 19H3Z"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7Z"/>',
  polygon: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9Z"/>',
  ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  line: '<path d="M4 18 20 6"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  solid: '<rect x="3" y="3" width="18" height="18"/><path d="M3 15l6-6 5 5 3-3 4 4"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M10 9.5v5l4.5-2.5Z"/>',
  adjust: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16A8 8 0 0 0 12 4Z" fill="currentColor"/>',
  demo: '<path d="M4 20 10 4l4 10 2-4 4 10"/>',
  play: '<path d="M7 4.5v15L19.5 12Z" fill="currentColor"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
  start: '<path d="M6 5v14M19 5v14L8 12Z" fill="currentColor"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h2"/>',
  menu: '<path d="M4 7h16M4 12h10M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layer: '<path d="M12 3 21 8l-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  style: '<circle cx="8" cy="9" r="4"/><rect x="11" y="11" width="9" height="9"/>',
  fx: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  blend: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  ease: '<path d="M3 20C10 20 9 4 21 4"/><circle cx="3" cy="20" r="1.5"/><circle cx="21" cy="4" r="1.5"/>',
  project: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M8 4v5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.1 6.6C3.6 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  dup: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  key: '<path d="M12 3 21 12 12 21 3 12Z"/>',
  loop: '<path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1"/>',
  zin: '<circle cx="11" cy="11" r="6"/><path d="M8 11h6M11 8v6M16 16l4 4"/>',
  zout: '<circle cx="11" cy="11" r="6"/><path d="M8 11h6M16 16l4 4"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 14v6h16v-6"/>',
  center: '<circle cx="12" cy="12" r="2"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
};
export const icon = (n, cls = '') => h('span', { class: 'ico ' + cls, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>` });
