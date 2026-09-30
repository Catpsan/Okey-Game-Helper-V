import { colorOf, numberOf } from '../engine/cards.ts';
import type { Card } from '../engine/cards.ts';

interface Props {
  card: Card | null;
  state?: 'hand' | 'gone' | 'unseen' | 'suggested';
  small?: boolean;
  title?: string;
  onClick?: () => void;
  onContextMenu?: () => void;
}

export const CardView = ({ card, state = 'unseen', small, title, onClick, onContextMenu }: Props) => {
  if (card === null) return <div className={`card empty ${small ? 'small' : ''}`} />;
  return (
    <button
      type="button"
      title={title}
      className={`card ${colorOf(card)} is-${state} ${small ? "small" : ""}`}
      onClick={onClick}
      onContextMenu={e => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu();
      }}
    >
      {numberOf(card)}
    </button>
  );
};
