import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { readOkey } from '../src/vision/okey.ts';
import type { Pixels } from '../src/vision/recognize.ts';
import { cardName } from '../src/engine/cards.ts';

// Real screenshot of the Okey window at game start (sent by Alex): yellow 6, blue 7, yellow 1, red 5, yellow 2.
const load = (file: string): Pixels => {
  const png = PNG.sync.read(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
};

/** Bilinear resize, like a browser scaling a capture. */
const resize = (px: Pixels, k: number): Pixels => {
  const W = Math.round(px.width * k), H = Math.round(px.height * k);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(px.width - 1.001, (x + 0.5) / k - 0.5), sy = Math.min(px.height - 1.001, (y + 0.5) / k - 0.5);
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), fx = Math.max(0, sx - x0), fy = Math.max(0, sy - y0);
    for (let c = 0; c < 4; c++) {
      const at = (xx: number, yy: number) => px.data[(yy * px.width + xx) * 4 + c];
      const v = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      data[(y * W + x) * 4 + c] = v;
    }
  }
  return { data, width: W, height: H };
};

/** Put the window on a big dark "desktop". */
const embed = (px: Pixels, W: number, H: number, ox: number, oy: number): Pixels => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 20; data[i * 4 + 1] = 24; data[i * 4 + 2] = 30; data[i * 4 + 3] = 255; }
  for (let y = 0; y < px.height; y++) data.set(px.data.subarray(y * px.width * 4, (y + 1) * px.width * 4), ((oy + y) * W + ox) * 4);
  return { data, width: W, height: H };
};

const read = (px: Pixels) => readOkey(px).filter(c => c.row === 0).map(c => (c.reading.card === null ? '?' : cardName(c.reading.card)));
const EXPECTED = ['yellow 6', 'blue 7', 'yellow 1', 'red 5', 'yellow 2'];

describe('real Okey window', () => {
  const shot = load('start-67152.png');

  it('reads the five hand cards', () => {
    expect(read(shot)).toEqual(EXPECTED);
    expect(readOkey(shot).every(c => c.reading.confidence > 0.5)).toBe(true);
  });

  it.each([0.75, 1.25, 1.5, 2, 3])('reads them when the window is scaled x%s', k => {
    expect(read(resize(shot, k))).toEqual(EXPECTED);
  });

  it('reads them inside a full desktop capture', () => {
    expect(read(embed(shot, 1280, 720, 700, 200))).toEqual(EXPECTED);
  });

  it('reads just the hand when that is all that was snipped', () => {
    const W = shot.width, y0 = 52, y1 = 118;
    const hand: Pixels = { data: shot.data.slice(y0 * W * 4, y1 * W * 4), width: W, height: y1 - y0 };
    expect(read(hand)).toEqual(EXPECTED);
  });
});
