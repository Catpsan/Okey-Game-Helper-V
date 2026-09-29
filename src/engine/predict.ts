// Draw predictions. Unseen cards are exactly the deck, so draw odds are exact.

import { cardsIn, popcount, bit } from './cards.ts';
import type { Card, CardSet } from './cards.ts';
import { COMBOS_BY_CARD } from './scoring.ts';
import type { Combo } from './scoring.ts';

export interface DrawOutlook {
  card: Card;
  /** Probability this card is the very next draw. */
  next: number;
  /** Probability it arrives within the next 3 draws. */
  withinThree: number;
  /** Combos this card would complete with two cards already in hand, best first. */
  completes: Combo[];
}

export const drawOutlook = (hand: CardSet, unseen: CardSet): DrawOutlook[] => {
  const n = popcount(unseen);
  if (n === 0) return [];
  return cardsIn(unseen)
    .map(card => ({
      card,
      next: 1 / n,
      withinThree: Math.min(3, n) / n,
      completes: COMBOS_BY_CARD[card].filter(c => (c.mask & ~bit(card) & ~hand) === 0),
    }))
    .sort((a, b) => (b.completes[0]?.score ?? 0) - (a.completes[0]?.score ?? 0));
};

export interface Draw {
  /** Combo you are building. */
  combo: Combo;
  /** Cards of it you hold. */
  held: Card[];
  /** Unseen cards still needed. */
  missing: Card[];
}

/** Combos that are one card away, i.e. two cards held and the third still unseen. */
export const oneAway = (hand: CardSet, unseen: CardSet): Draw[] => {
  const seen = new Set<number>();
  const out: Draw[] = [];
  for (const card of cardsIn(unseen)) {
    for (const combo of COMBOS_BY_CARD[card]) {
      if (seen.has(combo.mask)) continue;
      const rest = combo.mask & ~bit(card);
      if ((rest & hand) !== rest) continue;
      seen.add(combo.mask);
      out.push({ combo, held: cardsIn(rest), missing: [card] });
    }
  }
  return out.sort((a, b) => b.combo.score - a.combo.score);
};
