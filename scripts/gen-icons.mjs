/**
 * 生成 Tauri 需要的全套应用图标（纯 Node，无外部依赖）：
 *   src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png + icon.ico + icon.icns
 * 图案：靛紫渐变圆角方块 + 白色对话气泡 + 三个圆点。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// ---------- PNG 编码 ----------

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// 圆角矩形 SDF
function roundedRectSdf(px, py, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(px - cx) - (halfW - r);
  const dy = Math.abs(py - cy) - (halfH - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}

// 点到线段距离
function distToSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  const dx = px - (x1 + t * vx), dy = py - (y1 + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

function drawIcon(size) {
  const s = size / 1024;
  const rgba = Buffer.alloc(size * size * 4);
  const AA = 1.5 * s;
  const cx = size / 2, cy = size / 2;
  const bubbleR = 250 * s;
  const bubbleY = cy - 42 * s;
  const dots = [
    [512 - 118, 462],
    [512, 462],
    [512 + 118, 462],
  ].map(([x, y]) => [x * s, y * s]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景圆角方块：对角渐变 靛#4f46e5 → 紫#7c3aed
      const dRect = roundedRectSdf(x + 0.5, y + 0.5, cx, cy, size / 2 - 8 * s, size / 2 - 8 * s, 190 * s);
      let a = clamp(dRect < -AA ? 1 : 0.5 - dRect / (2 * AA), 0, 1);
      if (a <= 0) continue;
      const t = clamp((x + y) / (2 * size), 0, 1);
      let r = Math.round(79 + (124 - 79) * t);
      let g = Math.round(70 + (58 - 70) * t);
      let b = Math.round(229 + (237 - 229) * t);

      // 白色对话气泡：圆 + 尾巴（两条线段围成的三角区域）
      const db = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - bubbleY) ** 2) - bubbleR;
      const tail =
        Math.min(
          distToSeg(x + 0.5, y + 0.5, 420 * s, 600 * s, 238 * s, 840 * s),
          distToSeg(x + 0.5, y + 0.5, 238 * s, 840 * s, 600 * s, 690 * s),
        );
      const dBubble = Math.min(db, tail);
      const ab = clamp(dBubble < -AA ? 1 : 0.5 - dBubble / (2 * AA), 0, 1);

      // 气泡内三个靛色圆点（画在白色之上）
      let ad = 0;
      for (const [dx0, dy0] of dots) {
        const dd = Math.sqrt((x + 0.5 - dx0) ** 2 + (y + 0.5 - dy0) ** 2) - 38 * s;
        ad = Math.max(ad, clamp(dd < -AA ? 1 : 0.5 - dd / (2 * AA), 0, 1));
      }
      if (ab > 0) {
        r = Math.round(r * (1 - ab) + 255 * ab);
        g = Math.round(g * (1 - ab) + 255 * ab);
        b = Math.round(b * (1 - ab) + 255 * ab);
      }
      if (ad > 0 && ab > 0) {
        r = Math.round(r * (1 - ad) + 79 * ad);
        g = Math.round(g * (1 - ad) + 70 * ad);
        b = Math.round(b * (1 - ad) + 229 * ad);
      }
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, rgba);
}

// ---------- ICO / ICNS 容器 ----------

function makeIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, png256]);
}

function makeIcns(pngs) {
  // pngs: [type, buffer][]
  const chunks = pngs.map(([type, buf]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(buf.length + 8, 4);
    return Buffer.concat([head, buf]);
  });
  const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

// ---------- 输出 ----------

const png1024 = drawIcon(1024);
fs.writeFileSync(path.join(outDir, 'icon.png'), png1024);
fs.writeFileSync(path.join(outDir, 'icon.icns'), makeIcns([
  ['ic07', drawIcon(128)],
  ['ic08', drawIcon(256)],
  ['ic09', drawIcon(512)],
  ['ic10', png1024],
]));
fs.writeFileSync(path.join(outDir, 'icon.ico'), makeIco(drawIcon(256)));
fs.writeFileSync(path.join(outDir, '32x32.png'), drawIcon(32));
fs.writeFileSync(path.join(outDir, '128x128.png'), drawIcon(128));
fs.writeFileSync(path.join(outDir, '128x128@2x.png'), drawIcon(256));

console.log('icons written to', outDir);
