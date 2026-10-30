// Minimal animated GIF89a encoder: fixed 6×7×6 colour cube (252 colours) + one transparent index, LZW, looping.
const R = 6, G = 7, B = 6, TRANSP = 255;
const PALETTE = (() => {
  const p = new Uint8Array(256 * 3);
  for (let r = 0; r < R; r++) for (let g = 0; g < G; g++) for (let b = 0; b < B; b++) {
    const i = (r * G + g) * B + b;
    p[i * 3] = Math.round(r * 255 / (R - 1)); p[i * 3 + 1] = Math.round(g * 255 / (G - 1)); p[i * 3 + 2] = Math.round(b * 255 / (B - 1));
  }
  return p;
})();

// RGBA -> palette indices (ordered 4×4 dither keeps gradients from banding)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.5));
function indexFrame(rgba, w, h, transparent) {
  const out = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const o = i * 4;
    if (transparent && rgba[o + 3] < 128) { out[i] = TRANSP; continue; }
    const d = BAYER[(y & 3) * 4 + (x & 3)];
    const q = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v / 255 * (n - 1) + d)));
    out[i] = (q(rgba[o], R) * G + q(rgba[o + 1], G)) * B + q(rgba[o + 2], B);
  }
  return out;
}

function lzw(indices, out) {
  const minBits = 8, clear = 1 << minBits, eoi = clear + 1;
  let dict = new Map(), next = eoi + 1, bits = minBits + 1;
  let acc = 0, nacc = 0; const bytes = [];
  const emit = code => { acc |= code << nacc; nacc += bits; while (nacc >= 8) { bytes.push(acc & 255); acc >>= 8; nacc -= 8; } };
  emit(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = cur * 4096 + k, hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << bits) && bits < 12) bits++; }
    else { emit(clear); dict = new Map(); next = eoi + 1; bits = minBits + 1; }
    cur = k;
  }
  emit(cur); emit(eoi);
  if (nacc > 0) bytes.push(acc & 255);
  out.push(minBits);
  for (let i = 0; i < bytes.length; i += 255) { const n = Math.min(255, bytes.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(bytes[i + j]); }
  out.push(0);
}

export class GifEncoder {
  constructor(w, h, { transparent = false } = {}) {
    this.w = w; this.h = h; this.transparent = transparent; this.parts = [];
    const b = [], u16 = v => b.push(v & 255, v >> 8);
    b.push(...'GIF89a'.split('').map(c => c.charCodeAt(0))); u16(w); u16(h);
    b.push(0xf7, 0, 0); for (const v of PALETTE) b.push(v);                                    // global 256-colour table
    b.push(0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
    this.parts.push(new Uint8Array(b));
  }
  // rgba: ImageData.data of a w×h frame; delay in 1/100 s
  addFrame(rgba, delay) {
    const b = [], u16 = v => b.push(v & 255, v >> 8);
    b.push(0x21, 0xf9, 4, this.transparent ? 0x09 : 0x04); u16(delay); b.push(TRANSP, 0);      // disposal: restore bg when transparent
    b.push(0x2c); u16(0); u16(0); u16(this.w); u16(this.h); b.push(0);
    lzw(indexFrame(rgba, this.w, this.h, this.transparent), b);
    this.parts.push(new Uint8Array(b));
  }
  finish() { this.parts.push(new Uint8Array([0x3b])); return new Blob(this.parts, { type: 'image/gif' }); }
}
