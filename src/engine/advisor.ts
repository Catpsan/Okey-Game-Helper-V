// The advisor: ranks every legal action from the current position.
//
// - Few cards left (<= exactThreshold): exact solve, so values are true expectations/probabilities.
// - Earlier: Monte Carlo rollouts with the heuristic policy. Every action is evaluated on the
//   same random draw sequences (common random numbers), so differences between actions are
//   much less noisy than the raw estimates.

import { popcount } from './cards.ts';
import type { CardSet } from './cards.ts';
import { ExactSolver, legalActions, applyAction } from './solver.ts';
import type { Action } from './solver.ts';
import { seededRng } from './policy.ts';
import { playOut } from './forecast.ts';

export type Goal = { kind: 'points' } | { kind: 'target'; target: number };

export interface RankedAction {
  action: Action;
  /** Expected final score if you take this action and then play well. */
  expectedScore: number;
  /** Probability of reaching the goal target (only for target goals). */
  reachProbability?: number;
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
    return ranked.sort((a, b) =>
      o.goal.kind === 'target'
        ? (b.reachProbability! - a.reachProbability!) || (b.expectedScore - a.expectedScore)
        : b.expectedScore - a.expectedScore,
    );
  }

  best(hand: CardSet, unseen: CardSet, score: number, opts: Partial<AdvisorOptions> = {}): Action {
    return this.rank(hand, unseen, score, opts)[0]?.action ?? { type: 'stop' };
  }

  reset() {
    this.solver.clear();
  }

  private exact(actions: Action[], hand: CardSet, unseen: CardSet, score: number, o: AdvisorOptions): RankedAction[] {
    return actions.map(action => {
      const gain = action.type === 'play' ? action.combo.score : 0;
      const after = applyAction(hand, action);
      const future = action.type === 'stop' ? 0 : this.solver.expected(after, unseen);
      const r: RankedAction = { action, expectedScore: score + gain + future, exact: true };
      if (o.goal.kind === 'target') {
        const need = o.goal.target - score - gain;
        r.reachProbability = action.type === 'stop' ? (need <= 0 ? 1 : 0) : this.solver.reach(after, unseen, need);
      }
      return r;
    });
  }

  private sampled(actions: Action[], hand: CardSet, unseen: CardSet, score: number, o: AdvisorOptions): RankedAction[] {
    return actions.map(action => {
      const gain = action.type === 'play' ? action.combo.score : 0;
      const after = applyAction(hand, action);
      const rng = seededRng(o.seed); // same draw sequences for every action
      let total = 0, hits = 0;
      for (let i = 0; i < o.rollouts; i++) {
        const final = score + gain + playOut(after, unseen, rng, this.solver, o.rolloutExactAt);
        total += final;
        if (o.goal.kind === 'target' && final >= o.goal.target) hits++;
      }
      const r: RankedAction = { action, expectedScore: total / o.rollouts, exact: false };
      if (o.goal.kind === 'target') r.reachProbability = hits / o.rollouts;
      return r;
    });
  }
}
