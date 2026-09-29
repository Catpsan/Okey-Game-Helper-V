// Chest forecast and final-score distribution from the current position.

import { popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { ExactSolver, legalActions, applyAction } from './solver.ts';
import type { Action } from './solver.ts';
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

/** Best action by exact expected value (used once few cards remain). */
const exactBest = (solver: ExactSolver, hand: CardSet, unseen: CardSet): Action => {
  let best: Action = { type: 'stop' };
  let bestV = 0;
  for (const a of legalActions(hand, unseen)) {
    if (a.type === 'stop') continue;
    const v = (a.type === 'play' ? a.combo.score : 0) + solver.expected(applyAction(hand, a), unseen);
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
};

/** Simulate the rest of one game: heuristic early, exact play once `exactAt` or fewer cards remain. */
export const playOut = (hand: CardSet, unseen: CardSet, rng: Rng, solver: ExactSolver, exactAt: number): number => {
  let score = 0;
  for (;;) {
    [hand, unseen] = refill(hand, unseen, rng);
    const left = popcount(hand) + popcount(unseen);
    const a = left <= exactAt ? exactBest(solver, hand, unseen) : heuristicAction(hand, unseen);
    if (a.type === 'stop') return score;
    if (a.type === 'play') score += a.combo.score;
    hand = applyAction(hand, a);
  }
};

export const forecast = (
  hand: CardSet,
  unseen: CardSet,
  score: number,
  solver: ExactSolver,
  opts: { exactThreshold: number; samples: number; seed: number } = { exactThreshold: 14, samples: 400, seed: 7 },
): Forecast => {
  const left = popcount(hand) + popcount(unseen);
  const rng = seededRng(opts.seed);
  const histogram = new Array(12).fill(0);
  let total = 0, gold = 0, silver = 0;
  const exactAt = left <= opts.exactThreshold ? left : 8;
  for (let i = 0; i < opts.samples; i++) {
    const final = score + playOut(hand, unseen, rng, solver, exactAt);
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
