// Can this game still reach a chest?
// maxPossible is an upper bound: the best set of non-overlapping combos among every card that
// is still available (hand + deck), as if you could draw them in any order you like.
// If even that can't reach 300, silver is impossible no matter what you draw.

import { popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { COMBOS_BY_CARD, SILVER, GOLD } from './scoring.ts';
import type { ExactSolver } from './solver.ts';

const best = new Map<number, number>();

export const maxPossible = (cards: CardSet): number => {
  if (cards === 0) return 0;
  const hit = best.get(cards);
  if (hit !== undefined) return hit;
  const low = cards & -cards;
  const card = 31 - Math.clz32(low);
  let v = maxPossible(cards & ~low); // this card is never used
  for (const c of COMBOS_BY_CARD[card]) if ((c.mask & cards) === c.mask) v = Math.max(v, c.score + maxPossible(cards & ~c.mask));
  if (best.size > 2_000_000) best.clear();
  best.set(cards, v);
  return v;
};

/** true when `target` points can no longer be reached, whatever you draw. */
export const outOfReach = (hand: CardSet, unseen: CardSet, score: number, target: number, solver?: ExactSolver, exactThreshold = 14): boolean => {
  if (score >= target) return false;
  if (score + maxPossible(hand | unseen) < target) return true;
  // Few cards left: the exact solver knows the order constraints (only 5 cards in hand at once).
  if (solver && popcount(hand) + popcount(unseen) <= exactThreshold) return solver.reach(hand, unseen, target - score) === 0;
  return false;
};

export const silverOut = (hand: CardSet, unseen: CardSet, score: number, solver?: ExactSolver) => outOfReach(hand, unseen, score, SILVER, solver);
export const goldOut = (hand: CardSet, unseen: CardSet, score: number, solver?: ExactSolver) => outOfReach(hand, unseen, score, GOLD, solver);
