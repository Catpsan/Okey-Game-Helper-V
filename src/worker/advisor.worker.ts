// Runs all heavy analysis off the UI thread.
import { FULL_MASK } from '../engine/cards.ts';
import { Advisor } from '../engine/advisor.ts';
import type { Goal, RankedAction } from '../engine/advisor.ts';
import { explain } from '../engine/explain.ts';
import { forecast } from '../engine/forecast.ts';
import type { Forecast } from '../engine/forecast.ts';
import { drawOutlook, oneAway } from '../engine/predict.ts';
import type { DrawOutlook, Draw } from '../engine/predict.ts';
import { silverOut, goldOut } from '../engine/outlook.ts';

export interface AnalyzeRequest {
  id: number;
  hand: number;
  gone: number;
  score: number;
  goal: Goal;
  /** Skip action ranking (hand still needs draws); predictions are still computed. */
  drawing: boolean;
}

export interface AnalyzeResponse {
  id: number;
  ranked: RankedAction[];
  explanation: string;
  forecast: Forecast;
  outlook: DrawOutlook[];
  oneAway: Draw[];
  /** Proven: no draw order can reach 300 (or 400) any more. */
  silverOut: boolean;
  goldOut: boolean;
  millis: number;
}

const advisor = new Advisor();
let lastGone = -1;

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const t = performance.now();
  const { id, hand, gone, score, goal, drawing } = e.data;
  // The solver cache stays valid while cards only ever leave the game.
  if (lastGone === -1 || (gone & lastGone) !== lastGone) advisor.reset();
  lastGone = gone;
  const unseen = FULL_MASK & ~hand & ~gone;
  const ranked = drawing ? [] : advisor.rank(hand, unseen, score, { goal });
  const res: AnalyzeResponse = {
    id,
    ranked,
    explanation: drawing ? 'Draw cards until your hand is full.' : explain(ranked, hand, unseen, goal),
    forecast: forecast(hand, unseen, score, advisor.solver, {
      exactThreshold: 14,
      samples: 400,
      seed: 7,
      weights: goal.kind === 'chest' ? goal.weights : undefined,
    }),
    outlook: drawOutlook(hand, unseen),
    oneAway: oneAway(hand, unseen),
    silverOut: silverOut(hand, unseen, score, advisor.solver),
    goldOut: goldOut(hand, unseen, score, advisor.solver),
    millis: performance.now() - t,
  };
  (self as unknown as Worker).postMessage(res);
};
