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
