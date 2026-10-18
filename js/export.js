// Real-time export via canvas.captureStream + MediaRecorder (MP4 on Safari, WebM elsewhere).
import { Renderer, syncVideos, media } from './render.js';

const CANDIDATES = {
  mp4: ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
};
export function supportedFormats() {
  const ok = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported;
  const out = {};
  for (const [k, list] of Object.entries(CANDIDATES)) out[k] = ok ? list.find(m => MediaRecorder.isTypeSupported(m)) || null : null;
  return out;
}

export function exportSize(project, shortSide) {
  const ar = project.w / project.h;
  let w, h;
  if (ar >= 1) { h = shortSide; w = Math.round(h * ar); } else { w = shortSide; h = Math.round(w / ar); }
  return { w: w - (w % 2), h: h - (h % 2) };
}

let audioCtx;
export async function exportVideo(project, { format = 'auto', shortSide = 1080, fps = 30, bitrate = 8e6, audio = true, onProgress, signal } = {}) {
  const fmts = supportedFormats();
  const mime = format === 'auto' ? (fmts.mp4 || fmts.webm) : fmts[format];
  if (!mime) throw new Error('This browser cannot record ' + (format === 'auto' ? 'video' : format.toUpperCase()));
  const { w, h } = exportSize(project, shortSide);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const renderer = new Renderer();
  renderer.render(project, 0, canvas);
  const stream = canvas.captureStream(fps);
  const vids = project.layers.filter(L => (L.type === 'video' || L.type === 'audio') && media.get(L.media.id));
  let dest;
  if (audio && vids.length) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.resume();
      dest = audioCtx.createMediaStreamDestination();
      for (const L of vids) {
        const m = media.get(L.media.id);
        if (!m.src) { m.src = audioCtx.createMediaElementSource(m.el); m.gain = audioCtx.createGain(); m.src.connect(m.gain); m.gain.connect(audioCtx.destination); }
        m.gain.connect(dest); m.el.muted = false; m.gain.gain.value = L.media.volume ?? 1;
      }
      dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    } catch (e) { console.warn('audio capture unavailable', e); }
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || e); });
  rec.start(250);
  const dur = project.duration;
  await new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (signal?.aborted || t >= dur) { renderer.render(project, Math.min(t, dur - 1e-3), canvas); resolve(); return; }
      syncVideos(project, t, true);
      renderer.render(project, t, canvas);
      onProgress?.(t / dur);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await new Promise(r => setTimeout(r, 120));
  rec.stop();
  await done;
  stream.getTracks().forEach(t => t.stop());
  if (dest) for (const L of vids) { const m = media.get(L.media.id); try { m.gain.disconnect(dest); } catch {} m.el.muted = m.type !== 'audio'; }
  syncVideos(project, 0, false);
  const type = mime.split(';')[0];
  const blob = new Blob(chunks, { type });
  return { blob, mime, ext: type.includes('mp4') ? 'mp4' : 'webm', w, h, errors: renderer.errors };
}
