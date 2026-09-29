// Turns a stream of screen readings into game events.
//
// Each reading is the set of cards visible in the hand and field slots. A reading is only
// used once it has been identical for `stableFrames` frames. Changes against the tracked
// hand become events:
//   - new cards              -> draws
//   - 3 cards gone together, forming a combo -> a play
//   - 1 card gone            -> a discard
// Anything else is reported as "unclear" and left for the player to fix.

import { bit, cardsIn, popcount } from '../engine/cards.ts';
import type { Card, CardSet } from '../engine/cards.ts';
import { COMBOS } from '../engine/scoring.ts';
import type { Combo } from '../engine/scoring.ts';

export type TrackerEvent =
  | { type: 'draw'; card: Card }
  | { type: 'play'; combo: Combo }
  | { type: 'discard'; card: Card }
  | { type: 'unclear'; reason: string };

export class ScreenTracker {
  private last: CardSet | null = null;
  private streak = 0;
  private emitted = '';
  constructor(public stableFrames = 3) {}

  /**
   * Feed one frame. `visible` is the set of recognised cards, or null if any slot was
   * unreadable (the frame is then ignored). `hand` and `gone` are the current game state.
   * Once a reading is stable, any difference from the tracked hand is reported, once per
   * (reading, hand) pair, so events aren't lost if the player was not following at the time.
   */
  observe(visible: CardSet | null, hand: CardSet, gone: CardSet): TrackerEvent[] {
    if (visible === null) {
      this.streak = 0;
      return [];
    }
    if (visible === this.last) this.streak++;
    else {
      this.last = visible;
      this.streak = 1;
    }
    if (this.streak < this.stableFrames || visible === hand) return [];
    const tag = `${visible}:${hand}:${gone}`;
    if (tag === this.emitted) return [];
    this.emitted = tag;
    return diff(visible, hand, gone);
  }

  reset() {
    this.last = null;
    this.streak = 0;
    this.emitted = '';
  }
}

export const diff = (visible: CardSet, hand: CardSet, gone: CardSet): TrackerEvent[] => {
  const events: TrackerEvent[] = [];
  const removed = hand & ~visible;
  const added = visible & ~hand;
  const n = popcount(removed);
  if (n === 3) {
    const combo = COMBOS.find(c => c.mask === removed);
    if (combo) events.push({ type: 'play', combo });
    else events.push({ type: 'unclear', reason: 'Three cards left the hand but they are not a valid combo.' });
  } else if (n === 1) {
    events.push({ type: 'discard', card: cardsIn(removed)[0] });
  } else if (n > 0) {
    events.push({ type: 'unclear', reason: `${n} cards left the hand at once.` });
  }
  for (const card of cardsIn(added)) {
    if (gone & bit(card)) events.push({ type: 'unclear', reason: 'A card that already left the game appeared again. Check the reading.' });
    else events.push({ type: 'draw', card });
  }
  return events;
};
