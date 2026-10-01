import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { readOkey, findOkeyWindow, findCardFaces, digitShape, plausibleSample } from '../src/vision/okey.ts';
import { crop } from '../src/vision/detect.ts';
import { readCapture } from '../src/vision/reader.ts';
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

/** Copy a rectangle of `src` into `dst` at (ox, oy). */
const paste = (dst: Pixels, src: Pixels, sx: number, sy: number, sw: number, sh: number, ox: number, oy: number): Pixels => {
  const data = new Uint8ClampedArray(dst.data);
  for (let y = 0; y < sh; y++) data.set(src.data.subarray(((sy + y) * src.width + sx) * 4, ((sy + y) * src.width + sx + sw) * 4), ((oy + y) * dst.width + ox) * 4);
  return { ...dst, data };
};

/** Like capture.regionPixels: crop, then scale down to at most maxW wide. */
const regionOf = (px: Pixels) => (sx: number, sy: number, sw: number, sh: number, maxW = 1280): Pixels => {
  const x0 = Math.round(sx), y0 = Math.round(sy), w = Math.round(sw), h = Math.round(sh);
  const cut = paste({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, px, x0, y0, w, h, 0, 0);
  return w > maxW ? resize(cut, maxW / w) : cut;
};

const capture = (px: Pixels, hint = null as Parameters<typeof readCapture>[5]) => {
  const r = readCapture(null as unknown as CanvasImageSource, px.width, px.height, {}, regionOf(px), hint);
  return { ...r, cards: r.slots.map(s => (s.reading.card === null ? '?' : cardName(s.reading.card))) };
};

// Whole Metin 2 client (sent by Alex) with the Okey window open before the first draw,
// skill bar, potions and buffs around it. The window sits at (377, 185).
describe('Okey window inside the whole game screen', () => {
  const game = load('window-empty-24.png');
  const shot = load('start-67152.png');
  const withCards = paste(game, shot, 0, 0, shot.width, shot.height, 377, 185);

  it('finds the window by its title bar and deck', () => {
    expect(findOkeyWindow(game)).toEqual({ x: 377, y: 185, w: 325, h: 306 });
    expect(findOkeyWindow(shot)).toEqual({ x: 0, y: 0, w: 325, h: 306 });
  });

  it('reads no cards before the first draw', () => {
    const r = capture(game);
    expect(r.window).not.toBeNull();
    expect(r.cards).toEqual([]);
  });

  it('reads only the hand inside the window', () => {
    expect(capture(withCards).cards).toEqual(EXPECTED);
  });

  it('ignores card-like shapes outside the window (skill bar, potions)', () => {
    // Fake cards at the bottom of the screen, where the skill bar is.
    const noisy = paste(withCards, shot, 20, 52, 290, 66, 330, 690);
    expect(readOkey(noisy).length).toBeGreaterThan(5); // the old whole-screen search saw both rows
    expect(capture(noisy).cards).toEqual(EXPECTED);
  });

  it.each([0.6, 1.5, 2.5])('works when the game is shown at x%s', k => {
    expect(capture(resize(withCards, k)).cards).toEqual(EXPECTED);
  });

  it('stays locked on the window it found', () => {
    const first = capture(withCards);
    expect(capture(withCards, first.window).cards).toEqual(EXPECTED);
  });
});

describe('2 and 5 never swap', () => {
  const shot = load('start-67152.png');
  const shapes = () => findCardFaces(shot)[0].map(f => digitShape(crop(shot, f))!);
  // Hand on the fixture: yellow 6, blue 7, yellow 1, red 5, yellow 2.

  it('reads 2 and 5 right even from a blurry, low-resolution share', () => {
    for (const k of [0.5, 0.6, 0.7, 0.8]) {
      const cards = read(resize(resize(shot, k), 1 / k));
      expect(cards[3]).toBe('red 5');
      expect(cards[4]).toBe('yellow 2');
    }
  });

  it('refuses to learn a 2 as a 5 or a 5 as a 2', () => {
    const [, , , five, two] = shapes();
    expect(plausibleSample(two, 5)).toBe(false);
    expect(plausibleSample(five, 2)).toBe(false);
    expect(plausibleSample(two, 2)).toBe(true);
    expect(plausibleSample(five, 5)).toBe(true);
  });

  it('a wrongly saved sample does not flip the reading', () => {
    const [, , , five, two] = shapes();
    const polluted = { '5': [two.glyph], '2': [five.glyph] };
    expect(readOkey(shot, polluted).filter(c => c.row === 0).map(c => cardName(c.reading.card!))).toEqual(EXPECTED);
  });
});
