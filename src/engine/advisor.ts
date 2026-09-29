// The advisor: ranks every legal action from the current position.
//
// - Few cards left (<= exactThreshold): exact solve, so values are true expectations/probabilities.
// - Earlier: Monte Carlo rollouts. Every action is evaluated on the same random draw sequences
//   (common random numbers), so differences between actions are much less noisy than the raw
//   estimates. Rollouts play heuristically, then exactly (for the same goal) near the end.

import { popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { ExactSolver, legalActions, applyAction, chestUtility } from './solver.ts';
import type { Action, ChestWeights } from './solver.ts';
import { seededRng } from './policy.ts';
import { playOut } from './forecast.ts';
import { GOLD, SILVER } from './scoring.ts';

/**
 * What to play for.
 * - points: highest average final score.
 * - chest: maximise gold * P(400+) + silver * P(300+). {gold: 1, silver: 0} is "best gold
 *   chance"; {gold: 0, silver: 1} is "best chance of silver or better"; a large gold weight
 *   with silver 1 is "gold first, silver as the fallback".
 */
export type Goal = { kind: 'points' } | { kind: 'chest'; weights: ChestWeights };

export interface RankedAction {
  action: Action;
  /** Expected final score if you take this action and then play for the goal. */
  expectedScore: number;
  /** Chance of gold (400+). Exact mode: best achievable chance after this action. */
  gold: number;
  /** Chance of silver or better (300+). Exact mode: best achievable chance after this action. */
  silver: number;
  /** The value the ranking uses (points or chest utility). */
  value: number;
  /** true when values come from the exact solve rather than sampling. */
  exact: boolean;
}

export interface AdvisorOptions {
  goal: Goal;
  exactThreshold: number;
  rollouts: number;
  /** Rollouts switch to exact play once this many cards (or fewer) remain. */
  rolloutExactAt: number;
  seed: number;
}

export const DEFAULT_OPTIONS: AdvisorOptions = {
  goal: { kind: 'points' },
  exactThreshold: 14,
  rollouts: 400,
  rolloutExactAt: 8,
  seed: 1,
};

export class Advisor {
  readonly solver = new ExactSolver();

  /**
   * Rank actions for a refilled hand. `score` is the points already banked this game.
   * Call reset() when a new game starts: the solver cache only grows within a game.
   */
  rank(hand: CardSet, unseen: CardSet, score: number, opts: Partial<AdvisorOptions> = {}): RankedAction[] {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    const actions = legalActions(hand, unseen).filter(a => a.type !== 'stop' || unseen === 0 || popcount(hand) === 0);
    const left = popcount(hand) + popcount(unseen);
    const ranked = left <= o.exactThreshold ? this.exact(actions, hand, unseen, score, o) : this.sampled(actions, hand, unseen, score, o);
    return ranked.sort((a, b) => b.value - a.value || b.expectedScore - a.expectedScore);
  }

  best(hand: CardSet, unseen: CardSet, score: number, opts: Partial<AdvisorOptions> = {}): Action {
    return this.rank(hand, unseen, score, opts)[0]?.action ?? { type: 'stop' };
  }

  reset() {
    this.solver.clear();
  }

  private exact(actions: Action[], hand: CardSet, unseen: CardSet, score: number, o: AdvisorOptions): RankedAction[] {
    const s = this.solver;
    return actions.map(action => {
      const gain = action.type === 'play' ? action.combo.score : 0;
      const banked = score + gain;
      if (action.type === 'stop') {
        const hit = (t: number) => (banked >= t ? 1 : 0);
        return {
          action, expectedScore: banked, gold: hit(GOLD), silver: hit(SILVER), exact: true,
          value: o.goal.kind === 'chest' ? chestUtility(banked, o.goal.weights) : banked,
        };
      }
      const after = applyAction(hand, action);
      const expectedScore = banked + s.expected(after, unseen);
      return {
        action,
        expectedScore,
        gold: s.reach(after, unseen, GOLD - banked),
        silver: s.reach(after, unseen, SILVER - banked),
        value: o.goal.kind === 'chest' ? s.utility(after, unseen, banked, o.goal.weights) : expectedScore,
        exact: true,
      };
    });
  }

  private sampled(actions: Action[], hand: CardSet, unseen: CardSet, score: number, o: AdvisorOptions): RankedAction[] {
    const w = o.goal.kind === 'chest' ? o.goal.weights : undefined;
    return actions.map(action => {
      const gain = action.type === 'play' ? action.combo.score : 0;
      const after = applyAction(hand, action);
      const rng = seededRng(o.seed); // same draw sequences for every action
      let total = 0, gold = 0, silver = 0, utility = 0;
      for (let i = 0; i < o.rollouts; i++) {
        const final = playOut(after, unseen, score + gain, rng, this.solver, o.rolloutExactAt, w);
        total += final;
        if (final >= GOLD) gold++;
        if (final >= SILVER) silver++;
        if (w) utility += chestUtility(final, w);
      }
      const n = o.rollouts;
      return {
        action,
        expectedScore: total / n,
        gold: gold / n,
        silver: silver / n,
        value: w ? utility / n : total / n,
        exact: false,
      };
    });
  }
}
