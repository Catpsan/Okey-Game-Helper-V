// "Optimized" goal: decide early whether this game is a gold game.
// On the first CHECKS decisions it measures the gold chance while playing gold-first; if it is
// below THRESHOLD, the game is committed to silver for the rest (best chance of 300+).

import type { Goal } from './advisor.ts';

export type Plan = 'gold' | 'silver';

export interface PlanRule { threshold: number; checks: number }
export const OPTIMIZED: PlanRule = { threshold: 0.1, checks: 1 };

export const GOLD_FIRST: Goal = { kind: 'chest', weights: { gold: 3, silver: 1 } };
export const SILVER_ONLY: Goal = { kind: 'chest', weights: { gold: 0, silver: 1 } };

export const goalFor = (plan: Plan): Goal => (plan === 'gold' ? GOLD_FIRST : SILVER_ONLY);

/** Plan after seeing the gold chance at decision number `decision` (0 = first). */
export const nextPlan = (plan: Plan, decision: number, goldChance: number, rule: PlanRule = OPTIMIZED): Plan =>
  plan === 'silver' || decision >= rule.checks ? plan : goldChance < rule.threshold ? 'silver' : 'gold';
