# Benchmark

`node scripts/bench.ts <games> [player index]` plays the same random decks with each decision maker.
Results below: 300 games, seed 12345, 2026-09-29.

| # | Player | Avg | Gold | Silver | Bronze | Time per game |
|---|---|---|---|---|---|---|
| 0 | V1 logic: play best combo at once, else V1's discard ranking | 267.1 | 2.0% | 27.0% | 71.0% | 5 ms |
| 1 | V2 heuristic policy alone | 268.4 | 1.7% | 25.7% | 72.7% | <1 ms |
| 2 | V2 heuristic + exact endgame (14 cards or fewer) | 306.5 | 3.7% | 55.0% | 41.3% | 0.3 s |
| 3 | V2 advisor, highest average score | 320.5 | 5.7% | 64.7% | 29.7% | 1.5 s |
| 4 | V2 advisor, best chance of gold | 313.7 | 7.0% | 57.7% | 35.3% | 1.4 s |

Rows 3 and 4 used 200 rollouts per option in the early game; the app uses 400. Row 3 is the current code (rollouts finish with exact play at 8 cards or fewer). Row 4 was measured with the earlier rollout setting (heuristic play to the end); an earlier row-3 run with that setting scored 323.6 / 6.0% gold, so the two settings are within noise of each other.

## Takeaways

- Most of the gain comes from the exact endgame: once 14 or fewer cards remain, every line of
  play is evaluated exactly, including holding a combo for a better one.
- Early-game rollouts (row 3) add another ~14 points on average and cut bronze results from 41% to 30%.
- Playing for gold trades average score for a slightly higher gold rate. With a 300-game sample the
  gold difference (5.7% vs 7.0%) is within noise; the option matters most late in a game when you are
  close to 400.

## Ideas for more strength

- Learn a value function offline (self-play) to replace the heuristic in rollouts.
- Push the exact threshold higher using colour symmetry (the three colours are interchangeable).

## Goal comparison (2026-09-30)

400 games per strategy, same decks (seed 12345 + game number), 200 rollouts per option.
`node scripts/bench.ts 100 <player> <first game>` in shards, merged with `node scripts/bench-report.ts`.

| Strategy | Avg | Gold | Silver or better | Bronze |
|---|---|---|---|---|
| Highest average score | 322.0 | 8.5% ± 1.4% | 70.8% ± 2.3% | 29.3% |
| Gold only | 312.3 | 9.3% ± 1.4% | 62.5% ± 2.4% | 37.5% |
| Silver only | 316.4 | 6.5% ± 1.2% | 73.3% ± 2.2% | 26.7% |
| **Gold first, silver fallback 3:1 (default)** | 317.9 | 9.0% ± 1.4% | **75.3% ± 2.2%** | **24.8%** |
| Gold first, silver fallback 10:1 | 313.7 | 10.3% ± 1.5% | 68.0% ± 2.3% | 32.0% |
| Gold first, silver fallback 100:1 | 308.1 | 9.5% ± 1.5% | 64.5% ± 2.4% | 35.5% |

"Gold first, silver fallback" maximises 3 × P(gold) + P(silver or better). At 3:1 it keeps the gold
rate of "gold only" (within noise) and gets the best silver-or-better rate of all strategies,
so it is the default. Pushing harder for gold (10:1) gains little gold and loses 7 points of silver.

## Goals and "Optimized" (2026-09-30, 100 games)

100 games per strategy, same decks (seed 12345 + game 0-99), 200 rollouts per option.
"Silver ruled out early": games where 300 became provably impossible before the end
(`src/engine/outlook.ts`), and on average how many cards were left in the deck at that moment.
At 100 games the gaps between strategies are within noise (± about 3% gold, ± 4.5% silver).

| Strategy | Avg | Gold | Silver or better | Bronze | Silver ruled out early | Cards left then |
|---|---|---|---|---|---|---|
| Gold, else silver (3:1) | 320.1 | 11% | 73% | 27% | 27% | 6.1 |
| Most points | 324.6 | 11% | 72% | 28% | 28% | 6.0 |
| Gold only | 310.6 | 9% | 63% | 37% | 37% | 6.7 |
| Silver only | 321.1 | 9% | 75% | 25% | 25% | 5.6 |
| Optimized, 1st move check, gold under 10% -> silver | 320.4 | 9% | 74% | 26% | 26% | 5.5 |
| Optimized, under 5% | 321.4 | 9% | 74% | 26% | 26% | 5.8 |
| Optimized, first 3 moves, under 10% | 320.5 | 9% | 74% | 26% | 26% | 5.5 |
| Optimized, under 15% | 320.7 | 9% | 75% | 25% | 25% | 5.6 |

Decision (Alex, 2026-09-30): the app keeps one mode, "Optimized", which is the "Gold, else silver (3:1)" logic re-checked after every card. The first-move-only variant stays in the benchmark for comparison.

Takeaways: "Gold only" is clearly worse. The others are close. Optimized behaves like
"Silver only" (most first hands have a gold chance under 10%, so it switches to silver), while
"Gold, else silver" kept 2 more gold games out of 100 for 1-2 fewer silvers. A bronze game is
usually only provably lost with about 6 cards left, so the "start a new game" alert saves the
last few moves rather than whole games.
