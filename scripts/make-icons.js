"use strict";

// Renders the KIVO logo (rounded square, a bar and a chevron forming a "K")
// to PNG without any dependencies, using 4x4 supersampling for anti-aliasing.
// Usage: node scripts/make-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const VIOLET = [0x6c, 0x4d, 0xff];
const WHITE = [0xff, 0xff, 0xff];

// Geometry in the 32x32 design space of icons/kivo-file.svg
const RECT = { x: 2, y: 2, w: 28, h: 28, r: 7 };
const STROKE = 4;
const SEGMENTS = [
  [11, 9, 11, 23],
  [22, 9, 15, 16],
  [15, 16, 22, 23],
];

function inRoundedRect(x, y) {
  const { x: rx, y: ry, w, h, r } = RECT;
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function render(size) {
  const scale = size / 32;
  const S = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / scale;
          const y = (py + (sy + 0.5) / S) / scale;
          if (!inRoundedRect(x, y)) continue;
          const onStroke = SEGMENTS.some((seg) => distToSegment(x, y, seg) <= STROKE / 2);
          if (onStroke) fg++;
          else bg++;
        }
      }
      const total = S * S;
      const alpha = (bg + fg) / total;
      const i = (py * size + px) * 4;
      if (alpha === 0) continue;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round((VIOLET[c] * bg + WHITE[c] * fg) / (bg + fg));
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, pixels);
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const iconsDir = path.join(__dirname, "..", "packages", "vscode-kivo", "icons");
fs.writeFileSync(path.join(iconsDir, "kivo.png"), render(128));
fs.writeFileSync(path.join(__dirname, "..", "docs", "kivo-logo.png"), render(256));
console.log("wrote icons/kivo.png and docs/kivo-logo.png");
