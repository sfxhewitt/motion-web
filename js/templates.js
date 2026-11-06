// Built-in starter templates (each builds a complete project for an aspect ratio) and the in-app tutorials.
import { newProject, makeLayer, setKey } from './state.js';
import { makeEase } from './easing.js';
import { makeEffect } from './effects.js';

const fx = (L, id, over) => L.effects.push(makeEffect(id, over));
const K = (L, prop, pairs, ease) => pairs.forEach(([t, v], i) => setKey(L, prop, t, v, i < pairs.length - 1 ? makeEase(ease) : undefined));
const text = (p, content, size, fill, y, over = {}) => { const L = makeLayer(p, 'text', { content }); Object.assign(L.text, { size: Math.round(Math.min(p.w, p.h) * size), fill, weight: 800 }, over); L.props.y = p.h * y; return L; };

export const TEMPLATES = [
  { id: 'title', name: 'Title Reveal', desc: 'Headline scales in over a dark gradient, subtitle fades up.', build(aspect) {
    const p = newProject(aspect, 'Title Reveal', { bg: '#0b0a1f' }); p.duration = 5;
    const bg = makeLayer(p, 'solid', { color: '#0b0a1f' }); bg.name = 'Backdrop'; bg.solid.gradient = true; bg.solid.fill2 = '#2a1157'; bg.solid.gradAngle = 45;
    const sub = text(p, 'A SHORT SUBTITLE', 0.045, '#c9c4ff', 0.6, { weight: 500, tracking: 0.3 }); sub.name = 'Subtitle';
    K(sub, 'opacity', [[0.8, 0], [1.6, 1]], 'easeOut'); K(sub, 'y', [[0.8, p.h * 0.66], [1.6, p.h * 0.6]], 'expoOut');
    const ttl = text(p, 'YOUR TITLE', 0.12, '#ffffff', 0.48); ttl.name = 'Title';
    K(ttl, 'scale', [[0, 1.8], [1, 1]], 'expoOut'); K(ttl, 'opacity', [[0, 0], [0.5, 1]], 'easeOut');
    fx(ttl, 'glow', { r: 24, int: 90, color: '#8a5cff', tint: 50 });
    p.layers = [ttl, sub, bg]; return p; } },
  { id: 'lower3', name: 'Lower Third', desc: 'Name bar slides in from the left with a role line beneath.', build(aspect) {
    const p = newProject(aspect, 'Lower Third', { bg: '#1e2230' }); p.duration = 5;
    const bar = makeLayer(p, 'shape', { kind: 'rect' }); bar.name = 'Bar'; bar.shape.fill = '#2ee39a'; bar.shape.w = p.w * 0.62; bar.shape.h = p.h * 0.075; bar.shape.radius = 0;
    bar.props.y = p.h * 0.78; K(bar, 'x', [[0, -p.w * 0.4], [0.7, p.w * 0.36]], 'expoOut'); K(bar, 'x', [[4.2, p.w * 0.36], [4.8, -p.w * 0.4]], 'easeIn');
    const name = text(p, 'FULL NAME', 0.05, '#101522', 0.78); name.name = 'Name'; name.props.x = p.w * 0.36;
    K(name, 'opacity', [[0.4, 0], [0.9, 1]], 'easeOut'); K(name, 'opacity', [[4.1, 1], [4.4, 0]], 'easeIn');
    const role = text(p, 'Role or caption', 0.034, '#ffffff', 0.845, { weight: 500 }); role.name = 'Role'; role.props.x = p.w * 0.36;
    K(role, 'opacity', [[0.7, 0], [1.2, 1]], 'easeOut'); K(role, 'x', [[0.7, p.w * 0.3], [1.2, p.w * 0.36]], 'expoOut'); K(role, 'opacity', [[4.0, 1], [4.3, 0]], 'easeIn');
    p.layers = [name, role, bar]; return p; } },
  { id: 'logopop', name: 'Logo Pop', desc: 'A badge bounces in, spins once and pulses with a neon glow.', build(aspect) {
    const p = newProject(aspect, 'Logo Pop', { bg: '#05060a' }); p.duration = 4;
    const ring = makeLayer(p, 'shape', { kind: 'ring' }); ring.name = 'Ring'; ring.shape.fill = '#00f0ff'; ring.shape.thickness = 0.14;
    K(ring, 'scale', [[0, 0], [0.9, 1.15], [1.3, 1]], 'backOut'); K(ring, 'rotation', [[1.3, 0], [3.5, 360]], 'easeInOut');
    fx(ring, 'glow', { r: 30, int: 140, color: '#00f0ff', tint: 40 });
    const star = makeLayer(p, 'shape', { kind: 'star' }); star.name = 'Badge'; star.shape.fill = '#ff2bd6'; star.shape.w = star.shape.h = Math.min(p.w, p.h) * 0.2;
    K(star, 'scale', [[0.3, 0], [1.1, 1]], 'backOut'); fx(star, 'pulsesize', { amt: 10, freq: 2 });
    const brand = text(p, 'BRAND', 0.07, '#ffffff', 0.68, { tracking: 0.25 }); brand.name = 'Brand';
    K(brand, 'opacity', [[1, 0], [1.6, 1]], 'easeOut'); K(brand, 'y', [[1, p.h * 0.72], [1.6, p.h * 0.68]], 'expoOut');
    p.layers = [star, ring, brand]; return p; } },
  { id: 'countdown', name: 'Countdown', desc: '3 · 2 · 1 · GO, one second each, each number punching in.', build(aspect) {
    const p = newProject(aspect, 'Countdown', { bg: '#111318' }); p.duration = 4;
    const ls = ['3', '2', '1', 'GO'].map((s, i) => { const L = text(p, s, s === 'GO' ? 0.22 : 0.34, ['#ff7a00', '#c6ff00', '#00f0ff', '#ff2bd6'][i], 0.5); L.name = 'Count ' + s; L.start = i; L.end = i + 1;
      K(L, 'scale', [[i, 2.2], [i + 0.35, 1]], 'expoOut'); K(L, 'opacity', [[i, 0], [i + 0.15, 1], [i + 0.8, 1], [i + 1, 0]], 'linear'); return L; });
    const disc = makeLayer(p, 'shape', { kind: 'ellipse' }); disc.name = 'Disc'; disc.shape.fill = '#1d2130'; disc.shape.w = disc.shape.h = Math.min(p.w, p.h) * 0.6;
    K(disc, 'rotation', [[0, 0], [4, 180]], 'linear'); K(disc, 'scale', [[0, 0.9], [4, 1.1]], 'easeInOut');
    p.layers = [...ls, disc]; return p; } },
  { id: 'glitch', name: 'Glitch Intro', desc: 'Text tears apart with RGB split and settles into a clean title.', build(aspect) {
    const p = newProject(aspect, 'Glitch Intro', { bg: '#000000' }); p.duration = 4;
    const t = text(p, 'GLITCH', 0.16, '#f4f4f8', 0.5); t.name = 'Title';
    const g = makeEffect('rgbsplit', { amt: 60 }); t.effects.push(g);
    K(t, `fx.${g.id}.amt`, [[0, 60], [0.5, 25], [1.4, 0]], 'linear');
    K(t, 'x', [[0, p.w * 0.46], [0.15, p.w * 0.54], [0.3, p.w * 0.48], [0.45, p.w * 0.52], [0.6, p.w * 0.5]], 'linear');
    K(t, 'opacity', [[0, 0], [0.1, 1]], 'linear');
    const stripe = makeLayer(p, 'shape', { kind: 'rect' }); stripe.name = 'Scan'; stripe.shape.fill = '#2ee39a'; stripe.shape.w = p.w; stripe.shape.h = p.h * 0.012; stripe.shape.radius = 0;
    K(stripe, 'y', [[0, 0], [1.2, p.h]], 'linear'); K(stripe, 'opacity', [[1.1, 0.8], [1.3, 0]], 'easeIn');
    p.layers = [stripe, t]; return p; } },
];

// Short guided lessons; `project` names a template whose project the lesson opens (null: a fresh project)
export const TUTORIALS = [
  { id: 'start', title: 'Getting started', mins: 2, project: null, steps: ['Tap + on the home screen and create a project (pick a ratio, resolution and frame rate).', 'Tap + in the editor to add shapes, media, audio, text or drawings.', 'Drag a layer on the canvas to move it; the round handles scale it and the green knob rotates it.', 'Press play, then share with the arrow at the top right.'] },
  { id: 'keyframes', title: 'Animate with keyframes', mins: 3, project: 'title', steps: ['Select a layer and open Move & Transform.', 'Move the playhead, change a value and tap the ◇ key button: a keyframe records that value at that time.', 'Move the playhead again and change the value: a second keyframe is added automatically.', 'Keyframes show on the timeline; drag them to retime, tap one to jump to it.'] },
  { id: 'easing', title: 'Easing curves', mins: 2, project: 'logopop', steps: ['Select a layer with keyframes and open Easing.', 'Pick a curve (Ease Out, Expo, Back, Bounce…) or drag the bezier handles.', 'Physics and Steps give springy or stepped motion.', 'The playhead dot on the curve shows where you are in the move.'] },
  { id: 'effects', title: 'Add effects', mins: 3, project: 'glitch', steps: ['Select a layer and open Effects, then Add Effect.', 'Browse categories or search; every effect has presets.', 'Every effect parameter can be keyframed, just like position.', 'Use an Adjustment layer to apply effects to everything below it.'] },
  { id: 'groups', title: 'Groups and parenting', mins: 2, project: 'lower3', steps: ['Select several layers with ⧉ › Select All, then group them from the ⋯ menu.', 'A group moves, scales and rotates all its members together.', 'Parent to Layer makes one layer follow another without grouping.', 'Clipping masks hide a layer outside the one below it.'] },
  { id: 'export', title: 'Export and share', mins: 1, project: 'countdown', steps: ['Tap the share arrow at the top right of the editor.', 'Choose MP4, WebM, GIF or a PNG sequence, resolution and frame rate.', 'Render, then download or save to Photos.', 'Share a project file from Home › ⋯ to open it on another device.'] },
];
