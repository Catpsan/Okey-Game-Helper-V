import { describe, expect, it } from 'vitest';
import { readSlot, teachGlyph } from '../src/vision/recognize.ts';
import type { Pixels, GlyphBook } from '../src/vision/recognize.ts';
import { diff, ScreenTracker } from '../src/vision/tracker.ts';
import { cardOf, maskOf, bit } from '../src/engine/cards.ts';

const RGB = { red: [210, 30, 30], blue: [30, 70, 220], yellow: [230, 200, 20] } as const;

// Paint a 40x60 slot: beige background with a crude glyph drawn from '#' cells on a 4x6 grid.
const slot = (pattern: string[], color: keyof typeof RGB | null): Pixels => {
  const width = 40, height = 60;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const on = color && pattern[Math.floor(y / 10)]?.[Math.floor(x / 10)] === '#';
    const [r, g, b] = on ? RGB[color!] : [225, 215, 190];
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width, height };
};

const ONE = ['.#..', '##..', '.#..', '.#..', '.#..', '###.'];
const SEVEN = ['####', '...#', '..#.', '.#..', '.#..', '.#..'];

describe('slot recognition', () => {
  const book: GlyphBook = { 1: [teachGlyph(slot(ONE, 'red'))!], 7: [teachGlyph(slot(SEVEN, 'blue'))!] };

  it('reads color and number, whatever color the number was taught in', () => {
    expect(readSlot(slot(ONE, 'yellow'), book).card).toBe(cardOf('yellow', 1));
    expect(readSlot(slot(SEVEN, 'red'), book).card).toBe(cardOf('red', 7));
    expect(readSlot(slot(SEVEN, 'blue'), book).card).toBe(cardOf('blue', 7));
  });

  it('reports empty slots', () => {
    const r = readSlot(slot(ONE, null), book);
    expect(r.empty).toBe(true);
    expect(r.card).toBeNull();
  });
});

describe('screen tracker', () => {
  const r = (n: number) => cardOf('red', n);
  it('turns hand changes into draws, plays and discards', () => {
    const hand = maskOf([r(1), r(2), r(3), r(5)]);
    expect(diff(maskOf([r(5), r(8)]), hand, 0)).toEqual([
      expect.objectContaining({ type: 'play' }),
      { type: 'draw', card: r(8) },
    ]);
    expect(diff(maskOf([r(1), r(2), r(3)]), hand, 0)).toEqual([{ type: 'discard', card: r(5) }]);
  });

  it('flags impossible readings', () => {
    const events = diff(bit(r(4)), 0, bit(r(4)));
    expect(events[0].type).toBe('unclear');
  });

  it('waits for a stable reading', () => {
    const t = new ScreenTracker(3);
    const seen = bit(r(1));
    expect(t.observe(seen, 0, 0)).toEqual([]);
    expect(t.observe(seen, 0, 0)).toEqual([]);
    expect(t.observe(seen, 0, 0)).toEqual([{ type: 'draw', card: r(1) }]);
    expect(t.observe(seen, bit(r(1)), 0)).toEqual([]);
  });
});

import { detectCards } from '../src/vision/detect.ts';
import { reconcile } from '../src/vision/tracker.ts';

// A 400x240 "game window": dark background, a row of 5 cards, a row of 3 field cards
// above it, and a stray coloured icon that must be ignored.
const frame = (hand: [keyof typeof RGB, string[]][], field: [keyof typeof RGB, string[]][]): Pixels => {
  const width = 400, height = 240;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, [r, g, b]: readonly number[]) => {
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, [30, 34, 40]);
  const card = (x0: number, y0: number, color: keyof typeof RGB, pattern: string[]) => {
    for (let y = 0; y < 60; y++) for (let x = 0; x < 40; x++) {
      const on = pattern[Math.floor(y / 10)]?.[Math.floor(x / 10)] === '#';
      put(x0 + x, y0 + y, on ? RGB[color] : [225, 215, 190]);
    }
  };
  hand.forEach(([c, p], i) => card(20 + i * 70, 160, c, p));
  field.forEach(([c, p], i) => card(90 + i * 70, 40, c, p));
  for (let y = 5; y < 15; y++) for (let x = 370; x < 395; x++) put(x, y, RGB.blue); // icon
  return { data, width, height };
};

describe('automatic card detection', () => {
  const TWO = ['###.', '...#', '..#.', '.#..', '#...', '####'];
  const book: GlyphBook = {
    1: [teachGlyph(slot(ONE, 'red'))!],
    2: [teachGlyph(slot(TWO, 'red'))!],
    7: [teachGlyph(slot(SEVEN, 'red'))!],
  };

  it('finds the hand and field rows without calibration', () => {
    const px = frame(
      [['red', ONE], ['blue', SEVEN], ['yellow', TWO], ['red', TWO], ['blue', ONE]],
      [['yellow', SEVEN], ['yellow', ONE]],
    );
    const found = detectCards(px, book);
    const cards = found.map(f => f.reading.card);
    expect(found.filter(f => f.row === 0).map(f => f.reading.card)).toEqual([
      cardOf('red', 1), cardOf('blue', 7), cardOf('yellow', 2), cardOf('red', 2), cardOf('blue', 1),
    ]);
    expect(cards).toContain(cardOf('yellow', 7));
    expect(cards).toContain(cardOf('yellow', 1));
    expect(found.length).toBe(7);
  });

  it('reconciles a pasted screenshot taken several moves later', () => {
    const r = (n: number) => cardOf('red', n);
    // Hand had red 1-2-3 + red 5 + red 7; now shows red 7, red 8: played 1-2-3, discarded 5, drew 8.
    const events = reconcile(maskOf([r(7), r(8)]), maskOf([r(1), r(2), r(3), r(5), r(7)]), 0);
    expect(events.map(e => e.type)).toEqual(['play', 'discard', 'draw']);
  });
});

import { CardMemory } from '../src/vision/learn.ts';

// Cards whose art is NOT the default colours: purple-ish "red", teal "blue", orange "yellow",
// white numbers on a coloured card with a border and an emblem. The learned reader must cope.
const ART = { red: [150, 40, 90], blue: [20, 120, 130], yellow: [220, 130, 20] } as const;
const artCard = (color: keyof typeof ART, pattern: string[] | null, shift = 0): Pixels => {
  const width = 44, height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    let c: readonly number[];
    if (pattern === null) c = [40, 36, 30]; // empty slot: dark wood
    else if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) c = [200, 170, 80]; // gold border
    else if (x > 32 && y > 50) c = [240, 240, 240]; // emblem
    else {
      const on = pattern[Math.floor((y - 2 - shift) / 10)]?.[Math.floor((x - 2) / 10)] === '#';
      c = on ? [250, 250, 250] : ART[color];
    }
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, width, height };
};

describe('learned card reader', () => {
  const TWO = ['###.', '...#', '..#.', '.#..', '#...', '####'];
  it('reads a card it has seen before, and new colour/number combinations', () => {
    const m = new CardMemory();
    m.learn(artCard('red', ONE), cardOf('red', 1));
    m.learn(artCard('blue', SEVEN), cardOf('blue', 7));
    m.learn(artCard('yellow', TWO), cardOf('yellow', 2));
    m.learn(artCard('red', null), 'empty');
    // Same card again, slightly shifted.
    expect(m.read(artCard('red', ONE, 1)).card).toBe(cardOf('red', 1));
    // Never seen: blue 1, yellow 7, red 2.
    expect(m.read(artCard('blue', ONE)).card).toBe(cardOf('blue', 1));
    expect(m.read(artCard('yellow', SEVEN)).card).toBe(cardOf('yellow', 7));
    expect(m.read(artCard('red', TWO)).card).toBe(cardOf('red', 2));
    expect(m.read(artCard('blue', null)).empty).toBe(true);
  });
});
