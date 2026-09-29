// Chest forecast, final-score distribution, and the play-out used by rollouts.

import { popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { ExactSolver, legalActions, applyAction, chestUtility } from './solver.ts';
import type { Action, ChestWeights } from './solver.ts';
import { heuristicAction, refill, seededRng } from './policy.ts';
import type { Rng } from './policy.ts';
import { GOLD, SILVER } from './scoring.ts';

export interface Forecast {
  gold: number;
  silver: number; // silver or better
  expected: number;
  /** Counts of simulated final scores, bucketed by 50 points: [0-49, 50-99, ...]. */
  histogram: number[];
  exact: boolean;
}

/**
 * Best action by exact solve. With chest weights it maximises the chest objective,
 * otherwise expected points.
 */
export const exactBest = (solver: ExactSolver, hand: CardSet, unseen: CardSet, banked: number, w?: ChestWeights): Action => {
  let best: Action = { type: 'stop' };
  let bestV = -Infinity;
  for (const a of legalActions(hand, unseen)) {
    let v: number;
    if (a.type === 'stop') v = w ? chestUtility(banked, w) : 0;
    else {
      const gain = a.type === 'play' ? a.combo.score : 0;
      const after = applyAction(hand, a);
      v = w ? solver.utility(after, unseen, banked + gain, w) : gain + solver.expected(after, unseen);
    }
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
};

/**
 * Simulate the rest of one game: heuristic early, exact play once `exactAt` or fewer cards
 * remain. Returns the final score.
 */
export const playOut = (
  hand: CardSet,
  unseen: CardSet,
  banked: number,
  rng: Rng,
  solver: ExactSolver,
  exactAt: number,
  w?: ChestWeights,
): number => {
  let score = banked;
  for (;;) {
    [hand, unseen] = refill(hand, unseen, rng);
    const left = popcount(hand) + popcount(unseen);
    const a = left <= exactAt ? exactBest(solver, hand, unseen, score, w) : heuristicAction(hand, unseen);
    if (a.type === 'stop') return score;
    if (a.type === 'play') score += a.combo.score;
    hand = applyAction(hand, a);
    if (hand === 0 && unseen === 0) return score;
  }
};

export const forecast = (
  hand: CardSet,
  unseen: CardSet,
  score: number,
  solver: ExactSolver,
  opts: { exactThreshold: number; samples: number; seed: number; weights?: ChestWeights } = { exactThreshold: 14, samples: 400, seed: 7 },
): Forecast => {
  const left = popcount(hand) + popcount(unseen);
  const rng = seededRng(opts.seed);
  const histogram = new Array(12).fill(0);
  let total = 0, gold = 0, silver = 0;
  const exactAt = left <= opts.exactThreshold ? left : 8;
  for (let i = 0; i < opts.samples; i++) {
    const final = playOut(hand, unseen, score, rng, solver, exactAt, opts.weights);
    total += final;
    if (final >= GOLD) gold++;
    if (final >= SILVER) silver++;
    histogram[Math.min(11, Math.floor(final / 50))]++;
  }
  if (left <= opts.exactThreshold) {
    // Exact: best achievable chances when playing specifically for each chest.
    return {
      gold: solver.reach(hand, unseen, GOLD - score),
      silver: solver.reach(hand, unseen, SILVER - score),
      expected: score + solver.expected(hand, unseen),
      histogram,
      exact: true,
    };
  }
  return { gold: gold / opts.samples, silver: silver / opts.samples, expected: total / opts.samples, histogram, exact: false };
};
