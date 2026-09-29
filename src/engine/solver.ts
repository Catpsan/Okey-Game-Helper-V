// Exact solver for the Okey card game from the player's point of view.
//
// State: hand H (cards on the field) and unseen U (cards not yet seen: still in the deck).
// The hand is refilled to 5 from the deck at random. Each turn the player may
// play a valid combo from the hand, discard a card, or stop. Two objectives:
//   - 'points': maximise expected final score
//   - 'target': maximise the probability of reaching a target score (e.g. 400 for gold)
//
// The state space shrinks fast as cards leave the game, so the exact solve is used
// once few cards remain; earlier positions are evaluated by rollouts (see advisor.ts).

import { HAND_SIZE, bit, popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { COMBOS, GOLD, SILVER } from './scoring.ts';
import type { Combo } from './scoring.ts';

export type Action =
  | { type: 'play'; combo: Combo }
  | { type: 'discard'; card: number }
  | { type: 'stop' };

const TWO_24 = 16777216;

/** Weights of the chest objective. gold: value of reaching 400; silver: value of reaching 300. */
export interface ChestWeights {
  gold: number;
  silver: number;
}

/** Per-point tie-break, small enough never to outweigh a real chance difference. */
export const TIE = 1e-6;

export const chestUtility = (final: number, w: ChestWeights) =>
  (final >= GOLD ? w.gold : 0) + (final >= SILVER ? w.silver : 0) + TIE * final;
const key = (hand: CardSet, unseen: CardSet) => hand * TWO_24 + unseen;

/** Actions available from a (refilled) hand. Discards are pointless once the deck is empty. */
export const legalActions = (hand: CardSet, unseen: CardSet): Action[] => {
  const actions: Action[] = [];
  for (const combo of COMBOS) if ((combo.mask & hand) === combo.mask) actions.push({ type: 'play', combo });
  if (unseen !== 0) for (let m = hand; m !== 0; m &= m - 1) actions.push({ type: 'discard', card: 31 - Math.clz32(m & -m) });
  actions.push({ type: 'stop' });
  return actions;
};

export const applyAction = (hand: CardSet, a: Action): CardSet =>
  a.type === 'play' ? hand & ~a.combo.mask : a.type === 'discard' ? hand & ~bit(a.card) : hand;

export class ExactSolver {
  private points = new Map<number, number>();
  private target: Map<number, number>[] = [];
  nodes = 0;

  /** Expected future points from a hand that may still need refilling. */
  expected(hand: CardSet, unseen: CardSet): number {
    const k = key(hand, unseen);
    const hit = this.points.get(k);
    if (hit !== undefined) return hit;
    this.nodes++;
    let v: number;
    if (unseen !== 0 && popcount(hand) < HAND_SIZE) {
      let sum = 0, n = 0;
      for (let m = unseen; m !== 0; m &= m - 1) {
        const b = m & -m;
        sum += this.expected(hand | b, unseen & ~b);
        n++;
      }
      v = sum / n;
    } else {
      v = 0; // stop
      for (const combo of COMBOS) {
        if ((combo.mask & hand) !== combo.mask) continue;
        const x = combo.score + this.expected(hand & ~combo.mask, unseen);
        if (x > v) v = x;
      }
      if (unseen !== 0) {
        for (let m = hand; m !== 0; m &= m - 1) {
          const x = this.expected(hand & ~(m & -m), unseen);
          if (x > v) v = x;
        }
      }
    }
    this.points.set(k, v);
    return v;
  }

  /** Probability of scoring at least `need` more points (need in points, multiple of 10). */
  reach(hand: CardSet, unseen: CardSet, need: number): number {
    if (need <= 0) return 1;
    const level = need / 10;
    const memo = (this.target[level] ??= new Map());
    const k = key(hand, unseen);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    this.nodes++;
    let v: number;
    if (unseen !== 0 && popcount(hand) < HAND_SIZE) {
      let sum = 0, n = 0;
      for (let m = unseen; m !== 0; m &= m - 1) {
        const b = m & -m;
        sum += this.reach(hand | b, unseen & ~b, need);
        n++;
      }
      v = sum / n;
    } else {
      v = 0;
      for (const combo of COMBOS) {
        if ((combo.mask & hand) !== combo.mask) continue;
        const x = this.reach(hand & ~combo.mask, unseen, need - combo.score);
        if (x > v) v = x;
        if (v === 1) break;
      }
      if (unseen !== 0 && v < 1) {
        for (let m = hand; m !== 0; m &= m - 1) {
          const x = this.reach(hand & ~(m & -m), unseen, need);
          if (x > v) v = x;
        }
      }
    }
    memo.set(k, v);
    return v;
  }

  private chest = new Map<string, Map<number, number>[]>();

  /**
   * Expected chest utility of the final score, playing to maximise it:
   *   U(final) = w.gold * [final >= 400] + w.silver * [final >= 300] + TIE * final
   * `banked` is the score already made. The tiny points term only breaks ties.
   */
  utility(hand: CardSet, unseen: CardSet, banked: number, w: ChestWeights): number {
    const top = w.gold > 0 ? GOLD : w.silver > 0 ? SILVER : 0;
    if (banked >= top) return chestUtility(banked, w) + TIE * this.expected(hand, unseen);
    const wk = `${w.gold}:${w.silver}`;
    let levels = this.chest.get(wk);
    if (!levels) this.chest.set(wk, (levels = []));
    const memo = (levels[banked / 10] ??= new Map());
    const k = key(hand, unseen);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    this.nodes++;
    let v: number;
    if (unseen !== 0 && popcount(hand) < HAND_SIZE) {
      let sum = 0, n = 0;
      for (let m = unseen; m !== 0; m &= m - 1) {
        const b = m & -m;
        sum += this.utility(hand | b, unseen & ~b, banked, w);
        n++;
      }
      v = sum / n;
    } else {
      v = chestUtility(banked, w); // stop
      for (const combo of COMBOS) {
        if ((combo.mask & hand) !== combo.mask) continue;
        const x = this.utility(hand & ~combo.mask, unseen, banked + combo.score, w);
        if (x > v) v = x;
      }
      if (unseen !== 0) {
        for (let m = hand; m !== 0; m &= m - 1) {
          const x = this.utility(hand & ~(m & -m), unseen, banked, w);
          if (x > v) v = x;
        }
      }
    }
    memo.set(k, v);
    return v;
  }

  clear() {
    this.points.clear();
    this.target = [];
    this.chest.clear();
    this.nodes = 0;
  }
}

/** Cards left in the game (hand + unseen). The exact solve is cheap below roughly 14. */
export const cardsLeft = (hand: CardSet, unseen: CardSet) => popcount(hand) + popcount(unseen);
