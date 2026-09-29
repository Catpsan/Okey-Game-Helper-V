import { describe, expect, it } from 'vitest';
import { cardOf, maskOf, bit } from '../src/engine/cards.ts';
import { ExactSolver } from '../src/engine/solver.ts';
import { Advisor } from '../src/engine/advisor.ts';

const r = (n: number) => cardOf('red', n);
const b = (n: number) => cardOf('blue', n);
const y = (n: number) => cardOf('yellow', n);

describe('exact solver', () => {
  it('with an empty deck, plays the best disjoint combos in hand', () => {
    const s = new ExactSolver();
    // red 6-7-8 flush (100) and nothing else
    expect(s.expected(maskOf([r(6), r(7), r(8), b(1), y(3)]), 0)).toBe(100);
  });

  it('computes a one-draw expectation by hand', () => {
    const s = new ExactSolver();
    // Hand red 6, red 7 plus two junk cards; deck holds red 8 and blue 1.
    // Best line: keep 6-7, draw. Hand has room for 1 more card (4 in hand), so we draw one of
    // the two at random. Red 8 (p=1/2) -> 100 now, then the other card arrives but adds nothing.
    // Blue 1 (p=1/2) -> hand full, discard junk, draw red 8 -> 100. So the value is 100.
    const hand = maskOf([r(6), r(7), y(1), y(3)]);
    const unseen = maskOf([r(8), b(1)]);
    expect(s.expected(hand, unseen)).toBe(100);
  });

  it('gold-first goal takes a gold chance over a safe silver, and silver when gold is gone', () => {
    const s = new ExactSolver();
    const w = { gold: 10, silver: 1 };
    // Banked 290, deck empty, red 1-2-3 flush (50) in hand: silver is certain, gold impossible.
    expect(s.utility(maskOf([r(1), r(2), r(3)]), 0, 290, w)).toBeCloseTo(1, 3);
    // Banked 350 with red 6, red 7 in hand; deck holds red 8 and junk: gold (via 100) is certain
    // if we keep drawing, so the value is gold + silver.
    expect(s.utility(maskOf([r(6), r(7)]), maskOf([r(8), b(1)]), 350, w)).toBeCloseTo(11, 3);
  });

  it('reach probability is 1 when the target is already met and 0 when impossible', () => {
    const s = new ExactSolver();
    expect(s.reach(maskOf([r(1)]), 0, 0)).toBe(1);
    expect(s.reach(maskOf([r(1), r(2)]), 0, 10)).toBe(0);
  });

  it('advisor holds for a flush instead of playing a mixed run when that is worth more', () => {
    // Hand: red 6, red 7, blue 8, yellow 1, yellow 2. Unseen: red 8 only.
    // Playing 6-7-8 mixed now = 60. Discarding junk and drawing the red 8 gives the 100 flush.
    const hand = maskOf([r(6), r(7), b(8), y(1), y(2)]);
    const unseen = bit(r(8));
    const ranked = new Advisor().rank(hand, unseen, 0);
    const top = ranked[0].action;
    expect(top.type).toBe('discard');
    expect(ranked[0].expectedScore).toBe(100);
  });

  it('target goal prefers the line that reaches the target', () => {
    // Need 100 more for gold. Only the flush line gets there.
    const hand = maskOf([r(6), r(7), b(8), y(1), y(2)]);
    const unseen = bit(r(8));
    const ranked = new Advisor().rank(hand, unseen, 300, { goal: { kind: 'chest', weights: { gold: 1, silver: 0 } } });
    expect(ranked[0].gold).toBe(1);
  });
});
