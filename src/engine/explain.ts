// One-line, human explanations for advisor output.

import { cardName, bit, cardsIn } from './cards.ts';
import type { CardSet } from './cards.ts';
import { describeCombo, bestComboIn } from './scoring.ts';
import { oneAway } from './predict.ts';
import type { Goal, RankedAction } from './advisor.ts';

export const actionLabel = (r: RankedAction): string => {
  const a = r.action;
  if (a.type === 'play') return `Play ${describeCombo(a.combo)} (+${a.combo.score})`;
  if (a.type === 'discard') return `Discard ${cardName(a.card)}`;
  return 'End the game';
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const explain = (ranked: RankedAction[], hand: CardSet, unseen: CardSet, goal: Goal = { kind: 'points' }): string => {
  const top = ranked[0];
  if (!top) return 'Nothing to do.';
  const base = explainAction(ranked, hand, unseen, goal.kind === 'points');
  if (goal.kind === 'points' || top.action.type === 'stop') return base;
  const note = goal.weights.gold > 0 && top.gold < 0.01 && goal.weights.silver > 0
    ? ' Gold is out of reach, so this plays for silver.'
    : '';
  return `${base} After it: gold ${pct(top.gold)}, silver or better ${pct(top.silver)}.${note}`;
};

const explainAction = (ranked: RankedAction[], hand: CardSet, unseen: CardSet, showPoints: boolean): string => {
  const top = ranked[0];
  const a = top.action;
  if (a.type === 'stop') return 'No combos left and no cards to draw. End the game.';
  if (a.type === 'play') {
    const second = ranked[1];
    const edge = second ? top.expectedScore - second.expectedScore : 0;
    return `Play ${describeCombo(a.combo)} now for ${a.combo.score}.` + (showPoints && edge >= 1 ? ` It beats the next best option by about ${edge.toFixed(0)} points on average.` : '');
  }
  const kept = hand & ~bit(a.card);
  const nowBest = bestComboIn(hand);
  const target = oneAway(kept, unseen)[0];
  const chase = target
    ? ` Keeps ${target.held.map(cardName).join(' + ')} for ${describeCombo(target.combo)} (${target.combo.score}), which needs ${target.missing.map(cardName).join(' or ')}.`
    : '';
  if (nowBest) {
    const playNow = ranked.find(r => r.action.type === 'play' && r.action.combo.mask === nowBest.mask);
    const gain = playNow ? top.expectedScore - playNow.expectedScore : 0;
    return `Hold instead of playing ${describeCombo(nowBest)} (${nowBest.score}): discard ${cardName(a.card)}.${chase}` +
      (showPoints && gain >= 1 ? ` Worth about +${gain.toFixed(0)} points on average.` : '');
  }
  return `Discard ${cardName(a.card)}; it helps the fewest combos that can still be made.${chase}`;
};

export const cardsLabel = (mask: CardSet) => cardsIn(mask).map(cardName).join(', ');
