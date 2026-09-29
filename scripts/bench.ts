// Benchmark: play many random games with different decision makers and compare results.
// Usage: node scripts/bench.ts [games]
import { FULL_MASK, cardsIn, colorOf, numberOf, popcount } from '../src/engine/cards.ts';
import type { CardSet } from '../src/engine/cards.ts';
import { applyAction } from '../src/engine/solver.ts';
import type { Action } from '../src/engine/solver.ts';
import { heuristicAction, refill, seededRng } from '../src/engine/policy.ts';
import type { Rng } from '../src/engine/policy.ts';
import { Advisor } from '../src/engine/advisor.ts';
import { bestComboIn } from '../src/engine/scoring.ts';
import * as v1 from './v1/gameLogic.ts';

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

const playGame = (decide: Decide, rng: Rng, onNewGame?: () => void): number => {
  onNewGame?.();
  let hand = 0, unseen = FULL_MASK, score = 0;
  for (;;) {
    [hand, unseen] = refill(hand, unseen, rng);
    const a = decide(hand, unseen, score);
    if (a.type === 'stop') return score;
    if (a.type === 'play') score += a.combo.score;
    hand = applyAction(hand, a);
    if (hand === 0 && unseen === 0) return score;
  }
};

const games = Number(process.argv[2] ?? 300);
const only = process.argv[3];
const advisor = new Advisor();
const goldAdvisor = new Advisor();
const players: [string, Decide, (() => void)?][] = [
  ['V1 (greedy play + V1 discard)', v1Decide],
  ['V2 heuristic only', (h, u) => heuristicAction(h, u)],
  ['V2 heuristic + exact endgame', (h, u, s) => (popcount(h) + popcount(u) <= 14 ? advisor.best(h, u, s) : heuristicAction(h, u)), () => advisor.reset()],
  ['V2 advisor, max points', (h, u, s) => advisor.best(h, u, s, { rollouts: 200, rolloutExactAt: 8 }), () => advisor.reset()],
  ['V2 advisor, max gold chance', (h, u, s) => goldAdvisor.best(h, u, s, { rollouts: 200, rolloutExactAt: 8, goal: { kind: 'target', target: 400 } }), () => goldAdvisor.reset()],
];

for (const [name, decide, reset] of players.filter((_, i) => only === undefined || String(i) === only)) {
  const rng = seededRng(12345); // same decks for every player
  const t = performance.now();
  const scores = Array.from({ length: games }, () => playGame(decide, rng, reset));
  const avg = scores.reduce((a, b) => a + b, 0) / games;
  const gold = scores.filter(s => s >= 400).length / games;
  const silver = scores.filter(s => s >= 300 && s < 400).length / games;
  console.log(`${name.padEnd(32)} avg ${avg.toFixed(1)}  gold ${(gold * 100).toFixed(1)}%  silver ${(silver * 100).toFixed(1)}%  bronze ${((1 - gold - silver) * 100).toFixed(1)}%  (${((performance.now() - t) / games).toFixed(0)} ms/game)`);
}
