import { describe, it, expect } from 'vitest';
import { arrange } from '../src/ui/handOrder.ts';
import { bit, cardOf } from '../src/engine/cards.ts';

const set = (...cs: number[]) => cs.reduce((m, c) => m | bit(c), 0);
const y6 = cardOf('yellow', 6), b7 = cardOf('blue', 7), y1 = cardOf('yellow', 1), r5 = cardOf('red', 5), y2 = cardOf('yellow', 2), r8 = cardOf('red', 8);

describe('hand order', () => {
  it('keeps the screen order instead of sorting', () => {
    const screen = [y6, b7, y1, r5, y2];
    expect(arrange(screen, set(y6, b7, y1, r5, y2))).toEqual(screen);
  });
  it('leaves a gap where a card left and fills it with the next draw', () => {
    const after = arrange([y6, b7, y1, r5, y2], set(y6, b7, r5, y2));
    expect(after).toEqual([y6, b7, null, r5, y2]);
    expect(arrange(after, set(y6, b7, r5, y2, r8))).toEqual([y6, b7, r8, r5, y2]);
  });
  it('places cards with no known slot in order', () => {
    expect(arrange([null, null, null, null, null], set(b7, y1))).toEqual([b7, y1, null, null, null]);
  });
});
