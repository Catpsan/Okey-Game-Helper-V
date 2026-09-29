import { COLORS, NUMBERS, cardOf, bit, cardName } from '../engine/cards.ts';
import type { Card } from '../engine/cards.ts';
import type { GameState } from '../engine/game.ts';
import { CardView } from './CardView.tsx';

interface Props {
  game: GameState;
  onDraw: (card: Card) => void;
  onMarkGone: (card: Card) => void;
  onRestore: (card: Card) => void;
}

export const DeckTracker = ({ game, onDraw, onMarkGone, onRestore }: Props) => (
  <section className="panel">
    <h2>All 24 cards</h2>
    <p className="hint">Click an unseen card when you draw it. Right-click marks it gone. Click a gone card to put it back.</p>
    <div className="tracker">
      {COLORS.map(color => (
        <div className="tracker-row" key={color}>
          {NUMBERS.map(n => {
            const card = cardOf(color, n);
            const state = game.hand & bit(card) ? 'hand' : game.gone & bit(card) ? 'gone' : 'unseen';
            return (
              <CardView
                key={card}
                card={card}
                small
                state={state}
                title={`${cardName(card)}: ${state}`}
                onClick={() => (state === 'unseen' ? onDraw(card) : state === 'gone' ? onRestore(card) : undefined)}
                onContextMenu={() => (state === 'unseen' ? onMarkGone(card) : undefined)}
              />
            );
          })}
        </div>
      ))}
    </div>
  </section>
);
