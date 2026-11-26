import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

function color(x, y, size) {
  const pad = size * 0.08;
  const radius = size * 0.22;
  const left = pad;
  const top = pad;
  const right = size - pad;
  const bottom = size - pad;
  const inside = x >= left && x < right && y >= top && y < bottom;
  if (!inside) return [0, 0, 0, 0];
  const dx = Math.min(x - left, right - x);
  const dy = Math.min(y - top, bottom - y);
  if (dx < radius && dy < radius && (radius - dx) ** 2 + (radius - dy) ** 2 > radius ** 2) return [0, 0, 0, 0];
  const cx = size * 0.43;
  const cy = size * 0.5;
  const half = size * 0.22;
  const inTriangle = x >= size * 0.36 && x <= size * 0.68 && Math.abs(y - cy) <= half * ((size * 0.68 - x) / (size * 0.32));
  if (inTriangle) return [255, 255, 255, 255];
  return [23, 92, 211, 255];
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const [red, green, blue, alpha] = color(x, y, size);
      const offset = 1 + x * 4;
      row[offset] = red;
      row[offset + 1] = green;
      row[offset + 2] = blue;
      row[offset + 3] = alpha;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const directory = path.resolve('icons');
await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(path.join(directory, `icon${size}.png`), png(size));
}
