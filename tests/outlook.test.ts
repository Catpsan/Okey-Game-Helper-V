import { describe, it, expect } from 'vitest';
import { maxPossible, silverOut } from '../src/engine/outlook.ts';
import { ExactSolver } from '../src/engine/solver.ts';
import { nextPlan } from '../src/engine/plan.ts';
import { bit, cardOf, FULL_MASK } from '../src/engine/cards.ts';

const set = (...cs: number[]) => cs.reduce((m, c) => m | bit(c), 0);

describe('outlook', () => {
  it('upper bound of a fresh deck is well above gold', () => {
    expect(maxPossible(FULL_MASK)).toBeGreaterThanOrEqual(400);
  });
  it('bound counts disjoint combos only', () => {
    const r = (n: number) => cardOf('red', n);
    expect(maxPossible(set(r(6), r(7), r(8)))).toBe(100);
    expect(maxPossible(set(r(5), r(6), r(7), r(8)))).toBe(100);
  });
  it('silver is out when the remaining cards cannot add up to 300', () => {
    const r = (n: number) => cardOf('red', n);
    const solver = new ExactSolver();
    expect(silverOut(set(r(1), r(2), r(3)), 0, 100, solver)).toBe(true);
    expect(silverOut(set(r(6), r(7), r(8)), 0, 200, solver)).toBe(false);
    expect(silverOut(0, FULL_MASK, 0, solver)).toBe(false);
  });
  it('optimized plan switches to silver only on an early low gold chance', () => {
    expect(nextPlan('gold', 0, 0.02)).toBe('silver');
    expect(nextPlan('gold', 0, 0.3)).toBe('gold');
    expect(nextPlan('gold', 5, 0.0)).toBe('gold');
    expect(nextPlan('silver', 0, 0.9)).toBe('silver');
  });
});
