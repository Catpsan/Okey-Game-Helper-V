// Scoring rules from the official wiki:
// https://en-wiki.metin2.gameforge.com/index.php/Okey_Card_Game
//   Triple (same number, three colors): 1s = 20 ... 8s = 90   (n * 10 + 10)
//   Same-color run:                     1-2-3 = 50 ... 6-7-8 = 100 (low * 10 + 40)
//   Mixed-color run:                    1-2-3 = 10 ... 6-7-8 = 60  (low * 10)
// Chests: bronze < 300, silver 300-399, gold >= 400.

import { bit, cardOf, COLORS, colorIndexOf, numberOf } from './cards.ts';
import type { Card, CardSet } from './cards.ts';

export type ComboKind = 'triple' | 'flush-run' | 'run';

export interface Combo {
  mask: CardSet;
  cards: [Card, Card, Card];
  score: number;
  kind: ComboKind;
}

export const GOLD = 400;
export const SILVER = 300;

export type Chest = 'gold' | 'silver' | 'bronze';
export const chestFor = (score: number): Chest => (score >= GOLD ? 'gold' : score >= SILVER ? 'silver' : 'bronze');

const buildCombos = (): Combo[] => {
  const combos: Combo[] = [];
  for (let n = 1; n <= 8; n++) {
    const cards = COLORS.map(c => cardOf(c, n)) as [Card, Card, Card];
    combos.push({ mask: bit(cards[0]) | bit(cards[1]) | bit(cards[2]), cards, score: n * 10 + 10, kind: 'triple' });
  }
  for (let low = 1; low <= 6; low++) {
    for (const a of COLORS) for (const b of COLORS) for (const c of COLORS) {
      const cards: [Card, Card, Card] = [cardOf(a, low), cardOf(b, low + 1), cardOf(c, low + 2)];
      const flush = a === b && b === c;
      combos.push({
        mask: bit(cards[0]) | bit(cards[1]) | bit(cards[2]),
        cards,
        score: low * 10 + (flush ? 40 : 0),
        kind: flush ? 'flush-run' : 'run',
      });
    }
  }
  // Highest score first, so callers can stop at the first match when they only need the best.
  return combos.sort((x, y) => y.score - x.score);
};

/** All 170 valid combos, sorted by score descending. */
export const COMBOS: readonly Combo[] = buildCombos();

/** Combos indexed by card, for "which combos use this card" queries. */
export const COMBOS_BY_CARD: readonly Combo[][] = Array.from({ length: 24 }, (_, card) =>
  COMBOS.filter(c => (c.mask & bit(card)) !== 0),
);

export const combosIn = (hand: CardSet): Combo[] => COMBOS.filter(c => (c.mask & hand) === c.mask);

export const bestComboIn = (hand: CardSet): Combo | null => {
  for (const c of COMBOS) if ((c.mask & hand) === c.mask) return c;
  return null;
};

/** Score of an arbitrary 3-card selection, or 0 if it is not a valid combo. */
export const scoreOf = (cards: Card[]): number => {
  if (cards.length !== 3) return 0;
  const mask = bit(cards[0]) | bit(cards[1]) | bit(cards[2]);
  return COMBOS.find(c => c.mask === mask)?.score ?? 0;
};

export const describeCombo = (c: Combo): string => {
  const nums = c.cards.map(numberOf);
  if (c.kind === 'triple') return `triple ${nums[0]}s`;
  const color = COLORS[colorIndexOf(c.cards[0])];
  return c.kind === 'flush-run' ? `${color} run ${nums.join('-')}` : `mixed run ${nums.join('-')}`;
};
