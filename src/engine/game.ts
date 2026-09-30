// Game state as the player sees it, with undo history.
// Every card is in exactly one place: in hand (hand + field slots), gone (played or
// discarded), or unseen (still in the deck).

import { FULL_MASK, bit, popcount, HAND_SIZE, cardName } from './cards.ts';
import type { Card, CardSet } from './cards.ts';
import { COMBOS, describeCombo } from './scoring.ts';
import type { Combo } from './scoring.ts';

export interface GameState {
  hand: CardSet;
  gone: CardSet;
  score: number;
  log: string[];
  /** Optimized goal: what this game plays for, decided on the first move. */
  plan?: 'gold' | 'silver';
}

export const newGame = (): GameState => ({ hand: 0, gone: 0, score: 0, log: [] });

export const unseenOf = (s: GameState): CardSet => FULL_MASK & ~s.hand & ~s.gone;

export const isOver = (s: GameState): boolean => {
  const unseen = unseenOf(s);
  if (unseen !== 0) return false;
  return !COMBOS.some(c => (c.mask & s.hand) === c.mask);
};

/** Hand is waiting for draws before the next decision. */
export const needsDraw = (s: GameState): boolean => unseenOf(s) !== 0 && popcount(s.hand) < HAND_SIZE;

const withLog = (s: GameState, patch: Partial<GameState>, line: string): GameState => ({
  ...s,
  ...patch,
  log: [...s.log, line],
});

export const draw = (s: GameState, card: Card): GameState => {
  if ((unseenOf(s) & bit(card)) === 0 || popcount(s.hand) >= HAND_SIZE) return s;
  return withLog(s, { hand: s.hand | bit(card) }, `Drew ${cardName(card)}`);
};

export const discard = (s: GameState, card: Card): GameState => {
  if ((s.hand & bit(card)) === 0) return s;
  return withLog(s, { hand: s.hand & ~bit(card), gone: s.gone | bit(card) }, `Discarded ${cardName(card)}`);
};

export const play = (s: GameState, combo: Combo): GameState => {
  if ((s.hand & combo.mask) !== combo.mask) return s;
  return withLog(
    s,
    { hand: s.hand & ~combo.mask, gone: s.gone | combo.mask, score: s.score + combo.score },
    `Played ${describeCombo(combo)} for ${combo.score}`,
  );
};

/** Manual correction: mark an unseen card as gone without it passing through the hand. */
export const markGone = (s: GameState, card: Card): GameState => {
  if ((s.hand | s.gone) & bit(card)) return s;
  return withLog(s, { gone: s.gone | bit(card) }, `Marked ${cardName(card)} as gone`);
};

/** Manual correction: put any card back to unseen. */
export const restore = (s: GameState, card: Card): GameState =>
  withLog(s, { hand: s.hand & ~bit(card), gone: s.gone & ~bit(card) }, `Reset ${cardName(card)} to unseen`);
