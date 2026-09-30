// Minimal PNG reader for test fixtures (8-bit RGB/RGBA/grey/palette, no interlace).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Pixels } from '../src/vision/recognize.ts';

export const readPng = (file: string): Pixels => {
  const buf = readFileSync(file);
  let pos = 8, width = 0, height = 0, depth = 0, type = 0;
  let palette: Buffer | null = null;
  const chunks: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('ascii', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; }
    else if (name === 'PLTE') palette = body;
    else if (name === 'IDAT') chunks.push(body);
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`Unsupported PNG bit depth ${depth}`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8ClampedArray(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c, pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + p) & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, s = x * channels;
      if (type === 3 && palette) {
        data[i] = palette[line[s] * 3]; data[i + 1] = palette[line[s] * 3 + 1]; data[i + 2] = palette[line[s] * 3 + 2];
      } else if (channels >= 3) {
        data[i] = line[s]; data[i + 1] = line[s + 1]; data[i + 2] = line[s + 2];
      } else {
        data[i] = data[i + 1] = data[i + 2] = line[s];
      }
      data[i + 3] = 255;
    }
    prev = line;
  }
  return { data, width, height };
};
