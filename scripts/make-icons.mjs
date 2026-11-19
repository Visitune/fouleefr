// Génère les icônes PWA (PNG) sans dépendance : node scripts/make-icons.mjs
// Les PNG produits sont versionnés dans public/icons/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GREEN = [5, 150, 105];
const WHITE = [255, 255, 255];

// Tracé « foulée » (même courbe que l'icône de l'onglet), dans un repère 32×32.
function bezier(p0, p1, p2, p3, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}
const curve = [
  ...bezier([8, 22], [12, 22], [13, 10], [17, 10]),
  ...bezier([17, 10], [21, 10], [20, 22], [24, 22]),
];
const segs = [];
for (let i = 1; i < curve.length; i++) segs.push([curve[i - 1], curve[i]]);
const HALF_STROKE = 1.45;

function distToSeg(px, py, [a, b]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function onGlyph(u, v) {
  if (u < 5 || u > 27 || v < 6 || v > 26) return false;
  for (const s of segs) if (distToSeg(u, v, s) <= HALF_STROKE) return true;
  return false;
}

function inRoundedRect(x, y, size, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function render(size, { rounded, glyphScale }) {
  const SS = 3;
  const radius = size * 0.22;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!rounded || inRoundedRect(x, y, size, radius)) {
            bg++;
            const u = ((x / size) * 32 - 16) / glyphScale + 16;
            const v = ((y / size) * 32 - 16) / glyphScale + 16;
            if (onGlyph(u, v)) fg++;
          }
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const w = bg === 0 ? 0 : fg / bg;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(GREEN[0] * (1 - w) + WHITE[0] * w);
      buf[i + 1] = Math.round(GREEN[1] * (1 - w) + WHITE[1] * w);
      buf[i + 2] = Math.round(GREEN[2] * (1 - w) + WHITE[2] * w);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return buf;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
const jobs = [
  ['icon-192.png', 192, { rounded: true, glyphScale: 1.3 }],
  ['icon-512.png', 512, { rounded: true, glyphScale: 1.3 }],
  // maskable : fond plein cadre, glyphe dans la zone de sécurité (cercle central de 80 %)
  ['maskable-512.png', 512, { rounded: false, glyphScale: 1.05 }],
  // iOS applique lui-même les coins arrondis : carré plein, opaque
  ['apple-touch-icon.png', 180, { rounded: false, glyphScale: 1.3 }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(`public/icons/${name}`, png(size, render(size, opts)));
  console.log('écrit', name);
}
