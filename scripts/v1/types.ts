export type CardColor = 'red' | 'blue' | 'yellow';
export type CardNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CardData {
  id: string;
  color: CardColor;
  number: CardNumber;
}

export interface ComboResult {
  cards: CardData[];
  score: number;
  type: 'triple' | 'sequence' | 'none';
  isSameColor?: boolean;
}

export interface Prediction {
  keptCards: CardData[];
  neededCard: CardData;
  score: number;
  type: 'triple' | 'sequence';
}

export interface ChestProbabilities {
  gold: number;   // Percentage 0-100
  silver: number; // Percentage 0-100
  bronze: number; // Percentage 0-100
}

export interface DiscardSuggestion {
  cardToRemove: CardData;
  probability: number; // 0-1 (Immediate Win Probability)
  averagePotentialScore: number;
  maxPossibleScore: number; 
  outs: number; 
  safeDiscardScore: number; // Represents the "Deep Potential" of the KEPT cards
  scoreIndex: number; // The weighted score used for sorting (Immediate EV)
  prediction: Prediction | null;
  chestProbabilities?: ChestProbabilities;
}

export interface GameState {
  removedCardIds: Set<string>; // Cards permanently gone from the game
  handIds: (string | null)[]; // The 5 current slots (or null if empty)
  currentScore: number;
}

export interface SimStats {
  totalGames: number;
  averageScore: number;
  highScore: number;
  bronzeCount: number; // < 300
  silverCount: number; // 300-399
  goldCount: number;   // >= 400
}