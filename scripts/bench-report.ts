// Merge bench shard outputs (JSON lines on stdin or files) into a table.
// Usage: node scripts/bench-report.ts results/*.jsonl
import { readFileSync } from 'node:fs';

interface Run { player: number; name: string; first: number; scores: number[]; msPerGame: number }
const runs: Run[] = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
const byPlayer = new Map<number, { name: string; games: Map<number, number>; ms: number[] }>();
for (const r of runs) {
  const p = byPlayer.get(r.player) ?? { name: r.name, games: new Map<number, number>(), ms: [] as number[] };
  r.scores.forEach((s, i) => p.games.set(r.first + i, s));
  p.ms.push(r.msPerGame);
  byPlayer.set(r.player, p);
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const se = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n);
console.log('| Player | Games | Avg | Gold | Silver or better | Silver | Bronze | Time/game |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [, p] of [...byPlayer.entries()].sort((a, b) => a[0] - b[0])) {
  const s = [...p.games.values()];
  const n = s.length;
  const gold = s.filter(x => x >= 400).length / n;
  const silverPlus = s.filter(x => x >= 300).length / n;
  const avg = s.reduce((a, b) => a + b, 0) / n;
  const ms = p.ms.reduce((a, b) => a + b, 0) / p.ms.length;
  console.log(`| ${p.name} | ${n} | ${avg.toFixed(1)} | ${pct(gold)} ± ${pct(se(gold, n))} | ${pct(silverPlus)} ± ${pct(se(silverPlus, n))} | ${pct(silverPlus - gold)} | ${pct(1 - silverPlus)} | ${(ms / 1000).toFixed(2)} s |`);
}
