/* Generates the PWA PNG icons with zero dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- minimal PNG encoder ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- drawing, in unit coordinates ---------- */
const bg = [0x1b, 0x19, 0x15];
const gold = [0xd9, 0xa4, 0x41];
const goldHi = [0xf0, 0xc9, 0x77];
const SS = 4; // supersampling

function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function dist(x, y, cx, cy) { return Math.hypot(x - cx, y - cy); }
function angleOf(x, y, cx, cy) {
  let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  return (a + 360) % 360;
}
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
function inRing(x, y, cx, cy, r0, r1) {
  const d = dist(x, y, cx, cy);
  return d >= r0 && d <= r1;
}
/** Returns [r,g,b,a] for a point in 0..1 space. */
function shade(x, y) {
  let col = bg;
  // soft warm vignette
  const d = dist(x, y, 0.5, 0.42);
  col = mix(col, [0x2c, 0x25, 0x18], Math.max(0, 1 - d / 0.8) * 0.55);

  const cx = 0.5, cy = 0.48;
  const outer = 0.288, inner = 0.205;
  const gapA = 34, gapB = 72; // gap in upper-right
  const ang = angleOf(x, y, cx, cy);

  let ring = inRing(x, y, cx, cy, inner, outer);
  if (ring) {
    if (ang > gapA && ang < gapB) ring = false;
    // rounded cap discs at both gap ends
    const mid = (inner + outer) / 2;
    const rad = (outer - inner) / 2;
    for (const a of [gapA, gapB]) {
      const ex = cx + Math.cos((a * Math.PI) / 180) * mid;
      const ey = cy + Math.sin((a * Math.PI) / 180) * mid;
      if (dist(x, y, ex, ey) <= rad) ring = true;
    }
  }
  if (ring) {
    // subtle gold gradient across the mark
    const t = Math.max(0, Math.min(1, (x + y - 0.45) / 0.6));
    col = mix(gold, goldHi, t * 0.55);
  }

  // clock hand pointing into the gap
  const a = (53 * Math.PI) / 180;
  const hx = cx + Math.cos(a) * 0.172;
  const hy = cy + Math.sin(a) * 0.172;
  if (segDist(x, y, cx, cy, hx, hy) <= 0.031 || dist(x, y, cx, cy) <= 0.043) {
    col = goldHi;
  }

  // tiny outer ticks at 12 / 3 / 6 / 9
  for (const t of [0, 90, 180, 270]) {
    const rad = (t * Math.PI) / 180;
    const tx = cx + Math.cos(rad) * 0.345;
    const ty = cy + Math.sin(rad) * 0.345;
    if (dist(x, y, tx, ty) <= 0.011) col = mix(gold, bg, 0.15);
  }
  return [...col, 255];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, size, buf);
}

let png192;
for (const size of [180, 192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  const png = render(size);
  if (size === 192) png192 = png;
  fs.writeFileSync(file, png);
  console.log('wrote', file);
}

/* Windows shortcut icon: single 192px PNG wrapped in an ICO container. */
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 192; ico[7] = 192; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png192.length, 14);
ico.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([ico, png192]));
console.log('wrote', path.join(OUT, 'icon.ico'));
