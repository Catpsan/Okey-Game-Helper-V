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
