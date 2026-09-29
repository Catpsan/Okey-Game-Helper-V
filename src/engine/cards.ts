// Card model. A card is an index 0..23: color * 8 + (number - 1).
// Sets of cards are 24-bit masks, which keeps the solver fast and memo keys small.

export type Color = 'red' | 'blue' | 'yellow';
export const COLORS: readonly Color[] = ['red', 'blue', 'yellow'];
export const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const DECK_SIZE = 24;
export const HAND_SIZE = 5;
export const FULL_MASK = (1 << DECK_SIZE) - 1;

export type Card = number;
export type CardSet = number;

export const cardOf = (color: Color, number: number): Card => COLORS.indexOf(color) * 8 + (number - 1);
export const colorOf = (card: Card): Color => COLORS[Math.floor(card / 8)];
export const colorIndexOf = (card: Card): number => Math.floor(card / 8);
export const numberOf = (card: Card): number => (card % 8) + 1;
export const bit = (card: Card): CardSet => 1 << card;

export const cardName = (card: Card): string => `${colorOf(card)} ${numberOf(card)}`;

export const popcount = (mask: CardSet): number => {
  let m = mask - ((mask >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export const cardsIn = (mask: CardSet): Card[] => {
  const out: Card[] = [];
  for (let m = mask; m !== 0; m &= m - 1) out.push(31 - Math.clz32(m & -m));
  return out;
};

export const maskOf = (cards: Iterable<Card>): CardSet => {
  let m = 0;
  for (const c of cards) m |= bit(c);
  return m;
};
