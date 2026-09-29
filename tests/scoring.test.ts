import { describe, expect, it } from 'vitest';
import { cardOf } from '../src/engine/cards.ts';
import { COMBOS, scoreOf, chestFor, bestComboIn } from '../src/engine/scoring.ts';
import { maskOf } from '../src/engine/cards.ts';

// Tables from https://en-wiki.metin2.gameforge.com/index.php/Okey_Card_Game
describe('scoring matches the official tables', () => {
  it('triples: 1s = 20 ... 8s = 90', () => {
    for (let n = 1; n <= 8; n++) {
      expect(scoreOf([cardOf('red', n), cardOf('blue', n), cardOf('yellow', n)])).toBe(n * 10 + 10);
    }
  });

  it('same-color runs: 1-2-3 = 50 ... 6-7-8 = 100', () => {
    const expected = [50, 60, 70, 80, 90, 100];
    expected.forEach((pts, i) => {
      for (const c of ['red', 'blue', 'yellow'] as const) {
        expect(scoreOf([cardOf(c, i + 1), cardOf(c, i + 2), cardOf(c, i + 3)])).toBe(pts);
      }
    });
  });

  it('mixed-color runs: 1-2-3 = 10 ... 6-7-8 = 60', () => {
    const expected = [10, 20, 30, 40, 50, 60];
    expected.forEach((pts, i) => {
      expect(scoreOf([cardOf('red', i + 1), cardOf('blue', i + 2), cardOf('red', i + 3)])).toBe(pts);
    });
  });

  it('rejects gaps, pairs of one color and wrong sizes', () => {
    expect(scoreOf([cardOf('red', 1), cardOf('red', 2), cardOf('red', 4)])).toBe(0);
    expect(scoreOf([cardOf('red', 1), cardOf('blue', 3), cardOf('yellow', 5)])).toBe(0);
    expect(scoreOf([cardOf('red', 1), cardOf('blue', 1)])).toBe(0);
  });

  it('has 170 combos: 8 triples + 6 runs x 27 color patterns', () => {
    expect(COMBOS.length).toBe(170);
  });

  it('chest thresholds', () => {
    expect(chestFor(299)).toBe('bronze');
    expect(chestFor(300)).toBe('silver');
    expect(chestFor(399)).toBe('silver');
    expect(chestFor(400)).toBe('gold');
  });

  it('finds the best combo in a hand', () => {
    const hand = maskOf([cardOf('red', 6), cardOf('red', 7), cardOf('red', 8), cardOf('blue', 8), cardOf('yellow', 8)]);
    expect(bestComboIn(hand)!.score).toBe(100);
  });
});
