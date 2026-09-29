// Fast heuristic policy. Used for rollouts in the early game, where the exact solve is too big.
// It scores each action by points gained now plus the "potential" of what is left:
// every combo that can still be completed from hand + unseen cards, weighted by how
// many of its cards are still missing.

import { HAND_SIZE, popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { COMBOS } from './scoring.ts';
import { legalActions, applyAction } from './solver.ts';
import type { Action } from './solver.ts';

export interface PolicyWeights {
  /** Weight for combos with 0, 1, 2, 3 cards still missing from the hand. */
  missing: [number, number, number, number];
}

export const DEFAULT_WEIGHTS: PolicyWeights = { missing: [0.9, 0.35, 0.08, 0.01] };

export const potential = (hand: CardSet, unseen: CardSet, w: PolicyWeights = DEFAULT_WEIGHTS): number => {
  const live = hand | unseen;
  const scale = unseen === 0 ? 0 : 1;
  let total = 0;
  for (const combo of COMBOS) {
    if ((combo.mask & live) !== combo.mask) continue;
    const missing = popcount(combo.mask & unseen);
    if (missing > 0 && scale === 0) continue;
    total += combo.score * w.missing[missing];
  }
  return total;
};

/**
 * Pick the heuristic's preferred action from a refilled hand: play a combo whenever one is
 * available (keeping the most promising leftovers), otherwise discard the card whose loss
 * hurts the remaining potential least. Holding a combo for a better one is left to the
 * advisor's search, which can afford to look ahead.
 */
export const heuristicAction = (hand: CardSet, unseen: CardSet, w: PolicyWeights = DEFAULT_WEIGHTS): Action => {
  const actions = legalActions(hand, unseen);
  const plays = actions.filter(a => a.type === 'play');
  const candidates = plays.length > 0 ? plays : actions.filter(a => a.type === 'discard');
  let best: Action = { type: 'stop' };
  let bestValue = -Infinity;
  for (const a of candidates) {
    const gain = a.type === 'play' ? a.combo.score : 0;
    const v = gain + potential(applyAction(hand, a), unseen, w);
    if (v > bestValue) {
      bestValue = v;
      best = a;
    }
  }
  return best;
};

export type Rng = () => number;

/** Draw random cards from `unseen` until the hand holds 5 (or the deck is empty). */
export const refill = (hand: CardSet, unseen: CardSet, rng: Rng): [CardSet, CardSet] => {
  while (unseen !== 0 && popcount(hand) < HAND_SIZE) {
    let pick = Math.floor(rng() * popcount(unseen));
    let m = unseen;
    while (pick-- > 0) m &= m - 1;
    const b = m & -m;
    hand |= b;
    unseen &= ~b;
  }
  return [hand, unseen];
};

/** Play out the rest of a game with the heuristic policy. Returns points scored from here. */
export const rollout = (hand: CardSet, unseen: CardSet, rng: Rng, w: PolicyWeights = DEFAULT_WEIGHTS): number => {
  let score = 0;
  for (;;) {
    [hand, unseen] = refill(hand, unseen, rng);
    const a = heuristicAction(hand, unseen, w);
    if (a.type === 'stop') return score;
    if (a.type === 'play') score += a.combo.score;
    hand = applyAction(hand, a);
  }
};

/** Small seeded PRNG (mulberry32) so benchmarks and tests are reproducible. */
export const seededRng = (seed: number): Rng => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
