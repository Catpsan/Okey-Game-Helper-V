import type { CardData, CardColor, CardNumber } from './types.ts';

export const COLORS: CardColor[] = ['red', 'blue', 'yellow'];
export const NUMBERS: CardNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];

// Generate the full deck of 24 cards
export const FULL_DECK: CardData[] = [];
COLORS.forEach(color => {
  NUMBERS.forEach(num => {
    FULL_DECK.push({
      id: `${color}-${num}`,
      color,
      number: num
    });
  });
});

export const COLOR_MAP: Record<CardColor, string> = {
  red: 'bg-red-600 text-white border-red-800',
  blue: 'bg-blue-600 text-white border-blue-800',
  yellow: 'bg-yellow-400 text-black border-yellow-600',
};

export const COLOR_BG_MAP: Record<CardColor, string> = {
  red: 'bg-red-900/20',
  blue: 'bg-blue-900/20',
  yellow: 'bg-yellow-900/20',
};

export const STORAGE_KEY = 'okey-master-state-v1';
