// Quick tuning of the heuristic weights on many fast games.
import { FULL_MASK } from '../src/engine/cards.ts';
import { applyAction } from '../src/engine/solver.ts';
import { heuristicAction, refill, seededRng } from '../src/engine/policy.ts';
import type { PolicyWeights } from '../src/engine/policy.ts';
const games = Number(process.argv[2] ?? 3000);
const run = (w: PolicyWeights) => {
  const rng = seededRng(777);
  let total = 0, gold = 0;
  for (let g = 0; g < games; g++) {
    let hand = 0, unseen = FULL_MASK, score = 0;
    for (;;) {
      [hand, unseen] = refill(hand, unseen, rng);
      const a = heuristicAction(hand, unseen, w);
      if (a.type === 'stop') break;
      if (a.type === 'play') score += a.combo.score;
      hand = applyAction(hand, a);
    }
    total += score; if (score >= 400) gold++;
  }
  return [total / games, gold / games];
};
let best: [number, number[]] = [0, []];
for (const m0 of [0.5, 1]) for (const m1 of [0.15, 0.3, 0.5, 0.7]) for (const m2 of [0.02, 0.05, 0.1, 0.2]) for (const m3 of [0, 0.01, 0.03]) {
  const [avg, gold] = run({ missing: [m0, m1, m2, m3] });
  if (avg > best[0]) { best = [avg, [m0, m1, m2, m3]]; console.log(avg.toFixed(1), (gold * 100).toFixed(1) + '%', best[1].join(',')); }
}
