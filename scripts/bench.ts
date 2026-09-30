// Benchmark: play many random games with different decision makers and compare results.
// Usage: node scripts/bench.ts <games> [player index] [first game]
// Game g always uses the same deck (seed 12345 + g), so runs can be split across processes
// and every player faces exactly the same decks.
import { FULL_MASK, cardsIn, colorOf, numberOf } from '../src/engine/cards.ts';
import type { CardSet } from '../src/engine/cards.ts';
import { applyAction } from '../src/engine/solver.ts';
import type { Action } from '../src/engine/solver.ts';
import { refill, seededRng } from '../src/engine/policy.ts';
import type { Rng } from '../src/engine/policy.ts';
import { Advisor } from '../src/engine/advisor.ts';
import type { Goal } from '../src/engine/advisor.ts';
import { bestComboIn } from '../src/engine/scoring.ts';
import * as v1 from './v1/gameLogic.ts';
import { silverOut } from '../src/engine/outlook.ts';
import { nextPlan, goalFor, GOLD_FIRST } from '../src/engine/plan.ts';
import type { Plan, PlanRule } from '../src/engine/plan.ts';
import { popcount } from '../src/engine/cards.ts';

type Decide = (hand: CardSet, unseen: CardSet, score: number) => Action;

const toV1 = (c: number) => ({ id: `${colorOf(c)}-${numberOf(c)}`, color: colorOf(c), number: numberOf(c) }) as any;
const fromV1 = (id: string) => cardsIn(FULL_MASK).find(c => `${colorOf(c)}-${numberOf(c)}` === id)!;

// V1 behaviour: play the best combo if one exists, else take V1's top discard.
const v1Decide: Decide = (hand, unseen) => {
  const combo = bestComboIn(hand);
  if (combo) return { type: 'play', combo };
  if (unseen === 0) return { type: 'stop' };
  const removed = new Set(cardsIn(FULL_MASK & ~hand & ~unseen).map(c => toV1(c).id));
  const s = v1.analyzeDiscards(cardsIn(hand).map(toV1), removed, 0, false);
  return s.length ? { type: 'discard', card: fromV1(s[0].cardToRemove.id) } : { type: 'stop' };
};

// Deck size at the first moment silver was provably out of reach (-1 = never).
let deadAt = -1;
const playGame = (decide: Decide, rng: Rng): number => {
  let hand = 0, unseen = FULL_MASK, score = 0;
  deadAt = -1;
  for (;;) {
    [hand, unseen] = refill(hand, unseen, rng);
    if (deadAt < 0 && silverOut(hand, unseen, score)) deadAt = popcount(unseen);
    const a = decide(hand, unseen, score);
    if (a.type === 'stop') return score;
    if (a.type === 'play') score += a.combo.score;
    hand = applyAction(hand, a);
    if (hand === 0 && unseen === 0) return score;
  }
};

const ROLLOUTS = Number(process.env.ROLLOUTS ?? 200);
const advisorPlayer = (goal: Goal) => {
  const advisor = new Advisor();
  return (h: CardSet, u: CardSet, s: number) => advisor.best(h, u, s, { rollouts: ROLLOUTS, goal });
};
// Optimized: check the gold chance on the first moves, then commit to gold-first or silver.
const optimizedPlayer = (rule: PlanRule) => {
  const advisor = new Advisor();
  let plan: Plan = 'gold', decision = 0;
  return (h: CardSet, u: CardSet, s: number) => {
    if (plan === 'gold' && decision < rule.checks) {
      const ranked = advisor.rank(h, u, s, { rollouts: ROLLOUTS, goal: GOLD_FIRST });
      plan = nextPlan(plan, decision++, ranked[0]?.gold ?? 0, rule);
      if (plan === 'gold') return ranked[0]?.action ?? { type: 'stop' };
    }
    decision++;
    return advisor.best(h, u, s, { rollouts: ROLLOUTS, goal: goalFor(plan) });
  };
};
const chest = (gold: number, silver: number): Goal => ({ kind: 'chest', weights: { gold, silver } });

export const PLAYERS: [string, () => Decide][] = [
  ['V1 logic', () => v1Decide],
  ['V2 highest average score', () => advisorPlayer({ kind: 'points' })],
  ['V2 gold only', () => advisorPlayer(chest(1, 0))],
  ['V2 silver only', () => advisorPlayer(chest(0, 1))],
  ['V2 gold first, silver fallback (3:1)', () => advisorPlayer(chest(3, 1))],
  ['V2 gold first, silver fallback (10:1)', () => advisorPlayer(chest(10, 1))],
  ['V2 gold first, silver fallback (100:1)', () => advisorPlayer(chest(100, 1))],
  ['V2 optimized: 1st move gold check, under 10% -> silver', () => optimizedPlayer({ threshold: 0.1, checks: 1 })],
  ['V2 optimized: 1st move gold check, under 5% -> silver', () => optimizedPlayer({ threshold: 0.05, checks: 1 })],
  ['V2 optimized: first 3 moves gold check, under 10% -> silver', () => optimizedPlayer({ threshold: 0.1, checks: 3 })],
  ['V2 optimized: 1st move gold check, under 15% -> silver', () => optimizedPlayer({ threshold: 0.15, checks: 1 })],
];

const games = Number(process.argv[2] ?? 300);
const only = process.argv[3];
const first = Number(process.argv[4] ?? 0);
for (const [i, [name, make]] of PLAYERS.entries()) {
  if (only !== undefined && String(i) !== only) continue;
  const t = performance.now();
  const scores: number[] = [], dead: number[] = [];
  for (let g = first; g < first + games; g++) {
    const decide = make(); // fresh solver cache per game
    scores.push(playGame(decide, seededRng(12345 + g)));
    dead.push(deadAt);
  }
  // One JSON line per run, so shards can be merged with scripts/bench-report.ts.
  console.log(JSON.stringify({ player: i, name, first, scores, dead, msPerGame: (performance.now() - t) / games }));
}
