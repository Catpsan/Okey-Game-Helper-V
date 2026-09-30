// Keeps the hand in the same left-to-right order as the game shows it.
// The engine stores the hand as a set; this remembers which slot each card sits in.

import { bit, cardsIn, HAND_SIZE } from '../engine/cards.ts';
import type { Card, CardSet } from '../engine/cards.ts';

export type Slots = (Card | null)[];

export const emptySlots = (): Slots => Array<Card | null>(HAND_SIZE).fill(null);

/**
 * Cards that left the hand leave their slot empty; new cards go to the first empty slot,
 * like the game does when you draw. Cards already in a slot never move.
 */
export const arrange = (slots: Slots, hand: CardSet): Slots => {
  const out = emptySlots();
  let placed = 0;
  slots.slice(0, HAND_SIZE).forEach((c, i) => {
    if (c !== null && hand & bit(c) && !(placed & bit(c))) {
      out[i] = c;
      placed |= bit(c);
    }
  });
  for (const c of cardsIn(hand & ~placed)) {
    const i = out.indexOf(null);
    if (i < 0) break;
    out[i] = c;
  }
  return out;
};
