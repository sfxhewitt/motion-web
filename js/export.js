// Export. Frame-accurate offline rendering wherever WebCodecs exists: every frame is rendered at its exact time, encoded with
// VideoEncoder (H.264 -> MP4, VP9 -> WebM, with alpha for a transparent background) and the soundtrack is mixed offline.
// Otherwise falls back to real-time canvas.captureStream + MediaRecorder. Also: animated GIF and a ZIP of PNG frames.
import { Renderer, syncVideos, media, mediaGain } from './render.js';
import { mediaTime } from './state.js';
import { GifEncoder } from './gif.js';

const CANDIDATES = {
  mp4: ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
};
const VCODECS = { mp4: ['avc1.640033', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f'], webm: ['vp09.00.10.08', 'vp8'] };
const ACODECS = { mp4: [['mp4a.40.2', 'aac'], ['opus', 'opus']], webm: [['opus', 'A_OPUS']] };

// which containers WebCodecs can encode here (probed once at load; a small size is enough to learn the codec exists)
const encodable = { mp4: null, webm: null };
const probe = (async () => {
  if (typeof VideoEncoder === 'undefined') return;
  for (const k of ['mp4', 'webm']) for (const codec of VCODECS[k]) {
    try { if ((await VideoEncoder.isConfigSupported({ codec, width: 640, height: 360, bitrate: 2e6, framerate: 30 })).supported) { encodable[k] = codec; break; } } catch {}
  }
})();

export function supportedFormats() {
  const ok = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported;
  const out = {};
  for (const [k, list] of Object.entries(CANDIDATES)) out[k] = (encodable[k] && `video/${k}`) || (ok ? list.find(m => MediaRecorder.isTypeSupported(m)) || null : null);
  out.gif = 'image/gif'; out.png = 'application/zip';
  return out;
}
export const formatsReady = probe;

export function exportSize(project, shortSide) {
  const ar = project.w / project.h;
  let w, h;
  if (ar >= 1) { h = shortSide; w = Math.round(h * ar); } else { w = shortSide; h = Math.round(w / ar); }
  return { w: w - (w % 2), h: h - (h % 2) };
}

export async function exportVideo(project, opts = {}) {
  await probe;
  const { format = 'auto' } = opts;
  if (format === 'gif') return exportGif(project, opts);
  if (format === 'png') return exportPngs(project, opts);
  const fmt = format === 'auto' ? (encodable.mp4 || (!encodable.webm && supportedFormats().mp4) ? 'mp4' : 'webm') : format;
  if (encodable[fmt]) return exportEncoded(project, fmt, opts);
  return exportRealtime(project, { ...opts, format: fmt });
}

// ---------- offline frame stepping ----------
const frameCount = (project, fps) => Math.max(1, Math.round(project.duration * fps));
// put every visible video at its exact source time for t (waits for the seeks)
async function seekMedia(project, t) {
  const waits = [];
  for (const L of project.layers) {
    if (L.type !== 'video' || !L.visible || t < L.start || t >= L.end) continue;
    const m = media.get(L.media.id); if (!m?.el) continue;
    const v = m.el, want = mediaTime(L, t); if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - want) < 1e-3 && !v.seeking) continue;
    waits.push(new Promise(r => { const done = () => { v.removeEventListener('seeked', done); r(); }; v.addEventListener('seeked', done); setTimeout(done, 3000); }));
    v.currentTime = want;
  }
  await Promise.all(waits);
}
async function renderFrames(project, { shortSide = 1080, fps = 30, transparent = false, onProgress, signal }, each) {
  const { w, h } = exportSize(project, shortSide);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const renderer = new Renderer(), n = frameCount(project, fps);
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new Error('Export cancelled');
    const t = i / fps;
    await seekMedia(project, t);
    renderer.render(project, t, canvas, { skipMediaSync: true, transparent });
    await each(canvas, i, t);
    onProgress?.((i + 1) / n);
    if (i % 4 === 3) await new Promise(r => setTimeout(r)); // let the page breathe
  }
  syncVideos(project, 0, false);
  return { w, h, errors: renderer.errors };
}

// the whole soundtrack, mixed offline: speed, reverse, trims, keyframed volume and fades
async function mixAudio(project, rate = 48000) {
  const layers = project.layers.filter(L => (L.type === 'audio' || L.type === 'video') && L.visible && media.get(L.media.id)?.url && L.start < project.duration);
  if (!layers.length) return null;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(project.duration * rate), rate);
  const decoded = new Map(); let any = false;
  for (const L of layers) {
    const id = L.media.id;
    if (!decoded.has(id)) { try { decoded.set(id, await ctx.decodeAudioData(await (await fetch(media.get(id).url)).arrayBuffer())); } catch { decoded.set(id, null); } }
    let buf = decoded.get(id); if (!buf) continue;
    const m = L.media, sp = m.speed || 1, end = Math.min(L.end, project.duration), span = (end - L.start) * sp;
    let off = mediaTime(L, L.start);
    if (m.reverse) { // a reversed copy of the buffer; source time s maps to duration - s
      const r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
      buf = r; off = buf.duration - mediaTime(L, L.start);
    }
    if (off >= buf.duration || span <= 0) continue;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = sp; src.connect(gain); gain.connect(ctx.destination);
    for (let t = L.start; t <= end + 1e-6; t += 1 / 50) gain.gain.setValueAtTime(mediaGain(L, Math.min(t, end - 1e-4)), Math.max(0, t));
    src.start(Math.max(0, L.start), Math.max(0, off), Math.min(span, buf.duration - off));
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

async function exportEncoded(project, fmt, opts) {
  const { shortSide = 1080, fps = 30, bitrate = 8e6, audio = true, transparent = false } = opts;
  const { w, h } = exportSize(project, shortSide);
  const alpha = transparent && fmt === 'webm';
  let codec = null;
  for (const c of VCODECS[fmt]) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: w, height: h, bitrate, framerate: fps, ...(alpha ? { alpha: 'keep' } : {}) })).supported) { codec = c; break; } } catch {}
  }
  if (!codec) return exportRealtime(project, { ...opts, format: fmt });
  const lib = fmt === 'mp4' ? await import('./vendor/mp4-muxer.mjs') : await import('./vendor/webm-muxer.mjs');
  // soundtrack first (its codec decides the muxer's audio track)
  let mixed = null, acodec = null;
  if (audio && typeof AudioEncoder !== 'undefined') {
    mixed = await mixAudio(project);
    if (mixed) for (const [c, mux] of ACODECS[fmt]) {
      try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: mixed.sampleRate, numberOfChannels: 2, bitrate: 160000 })).supported) { acodec = [c, mux]; break; } } catch {}
    }
  }
  const target = new lib.ArrayBufferTarget();
  const muxer = new lib.Muxer(fmt === 'mp4'
    ? { target, fastStart: 'in-memory', video: { codec: codec.startsWith('avc') ? 'avc' : 'vp9', width: w, height: h, frameRate: fps }, ...(acodec ? { audio: { codec: acodec[1], numberOfChannels: 2, sampleRate: mixed.sampleRate } } : {}) }
    : { target, video: { codec: codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: w, height: h, frameRate: fps, alpha }, ...(acodec ? { audio: { codec: acodec[1], numberOfChannels: 2, sampleRate: mixed.sampleRate } } : {}) });
  let failed = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => (failed = e) });
  venc.configure({ codec, width: w, height: h, bitrate, framerate: fps, ...(alpha ? { alpha: 'keep' } : {}), ...(codec.startsWith('avc') ? { avc: { format: 'avc' } } : {}) });
  const res = await renderFrames(project, { ...opts, transparent: alpha }, async (canvas, i) => {
    if (failed) throw failed;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps), alpha: alpha ? 'keep' : 'discard' });
    venc.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 }); frame.close();
    while (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 2));
  });
  await venc.flush(); venc.close();
  if (failed) throw failed;
  if (acodec) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => (failed = e) });
    aenc.configure({ codec: acodec[0], sampleRate: mixed.sampleRate, numberOfChannels: 2, bitrate: 160000 });
    const L = mixed.getChannelData(0), R = mixed.getChannelData(1), N = 4800;
    for (let i = 0; i < mixed.length; i += N) {
      const n = Math.min(N, mixed.length - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: mixed.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / mixed.sampleRate), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
    if (failed) throw failed;
  }
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: 'video/' + fmt });
  return { blob, mime: `video/${fmt};codecs=${codec}`, ext: fmt, w, h, errors: res.errors, exact: true };
}

async function exportGif(project, opts) {
  const fps = Math.min(opts.fps || 15, 50), delay = Math.max(2, Math.round(100 / fps));
  const { w, h } = exportSize(project, opts.shortSide || 480), enc = new GifEncoder(w, h, { transparent: !!opts.transparent });
  const res = await renderFrames(project, { ...opts, fps }, canvas => enc.addFrame(canvas.getContext('2d').getImageData(0, 0, w, h).data, delay));
  return { blob: enc.finish(), mime: 'image/gif', ext: 'gif', w, h, errors: res.errors, exact: true };
}

// ---------- PNG sequence in a ZIP (stored, no compression: PNGs are compressed already) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipStore(files) { // [{ name, data: Uint8Array }] -> Blob
  const parts = [], dir = []; let off = 0;
  const hdr = (sig, fields) => { const b = new DataView(new ArrayBuffer(fields.reduce((s, [n]) => s + n, 4))); b.setUint32(0, sig, true); let o = 4; for (const [n, v] of fields) { n === 2 ? b.setUint16(o, v, true) : b.setUint32(o, v, true); o += n; } return new Uint8Array(b.buffer); };
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), n = f.data.length;
    const local = hdr(0x04034b50, [[2, 20], [2, 0], [2, 0], [2, 0], [2, 0x21], [4, crc], [4, n], [4, n], [2, name.length], [2, 0]]);
    parts.push(local, name, f.data);
    dir.push(hdr(0x02014b50, [[2, 20], [2, 20], [2, 0], [2, 0], [2, 0], [2, 0x21], [4, crc], [4, n], [4, n], [2, name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, off]]), name);
    off += local.length + name.length + n;
  }
  const size = dir.reduce((s, b) => s + b.length, 0);
  parts.push(...dir, hdr(0x06054b50, [[2, 0], [2, 0], [2, files.length], [2, files.length], [4, size], [4, off], [2, 0]]));
  return new Blob(parts, { type: 'application/zip' });
}
async function exportPngs(project, opts) {
  const files = [];
  const res = await renderFrames(project, opts, async (canvas, i) => {
    const b = await new Promise(r => canvas.toBlob(r, 'image/png'));
    files.push({ name: `frame_${String(i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
  });
  return { blob: zipStore(files), mime: 'application/zip', ext: 'zip', w: res.w, h: res.h, errors: res.errors, frames: files.length, exact: true };
}

// ---------- fallback: real-time recording ----------
let audioCtx;
async function exportRealtime(project, { format = 'auto', shortSide = 1080, fps = 30, bitrate = 8e6, audio = true, onProgress, signal } = {}) {
  const fmts = { mp4: null, webm: null };
  if (typeof MediaRecorder !== 'undefined') for (const [k, list] of Object.entries(CANDIDATES)) fmts[k] = list.find(m => MediaRecorder.isTypeSupported(m)) || null;
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
