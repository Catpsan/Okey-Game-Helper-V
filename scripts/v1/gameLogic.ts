import type { CardData, ComboResult, DiscardSuggestion, Prediction, ChestProbabilities } from './types.ts';
import { FULL_DECK } from './constants.ts';

// --- Utils ---
export const shuffle = (array: CardData[]) => {
    let currentIndex = array.length, randomIndex;
    const newArray = [...array];
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [newArray[currentIndex], newArray[randomIndex]] = [newArray[randomIndex], newArray[currentIndex]];
    }
    return newArray;
};

// --- Scoring Logic ---

const getSequenceBaseScore = (startNum: number): number => {
  return startNum * 10;
};

const getTripleScore = (num: number): number => {
  return num * 10 + 10;
};

export const calculateScore = (cards: CardData[]): ComboResult => {
  if (cards.length !== 3) return { cards, score: 0, type: 'none' };

  // Sort by number
  const sorted = [...cards].sort((a, b) => a.number - b.number);
  const c1 = sorted[0];
  const c2 = sorted[1];
  const c3 = sorted[2];

  const sameColor = c1.color === c2.color && c2.color === c3.color;
  const distinctColors = c1.color !== c2.color && c1.color !== c3.color && c2.color !== c3.color;
  
  const consecutive = c2.number === c1.number + 1 && c3.number === c2.number + 1;
  const sameNumber = c1.number === c2.number && c2.number === c3.number;

  // Check Sequence
  if (consecutive) {
    let score = getSequenceBaseScore(c1.number); // 1-2-3=10 ... 6-7-8=60
    if (sameColor) score += 40; // Bonus for Flush. 6-7-8 Flush = 100pts
    return { cards: sorted, score, type: 'sequence', isSameColor: sameColor };
  }

  // Check Triple
  if (sameNumber && distinctColors) {
    // 1,1,1=20 ... 8,8,8=90
    return { cards: sorted, score: getTripleScore(c1.number), type: 'triple' };
  }

  return { cards, score: 0, type: 'none' };
};

// --- Combinatorics ---

function getCombinations<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  function fork(target: T[], source: T[]) {
    if (target.length === size) {
      result.push(target);
      return;
    }
    source.forEach((el, idx) => fork([...target, el], source.slice(idx + 1)));
  }
  fork([], array);
  return result;
}

export const findBestMoves = (hand: CardData[]): ComboResult[] => {
  if (hand.length < 3) return [];
  const combos = getCombinations(hand, 3);
  const scoredCombos = combos
    .map(c => calculateScore(c))
    .filter(res => res.score > 0)
    .sort((a, b) => b.score - a.score);
  return scoredCombos;
};

// --- AI / Prediction ---

// Helper: Calculate the "Intrinsic Worth" of a card given a set of available cards (deck + hand)
// This answers: "How many points does this card contribute to in the universe of remaining possibilities?"
const calculateCardIntrinsicWorth = (card: CardData, contextCards: CardData[]): number => {
    let totalWorth = 0;
    
    // Static Bonus for High Value Cards (6, 7, 8)
    // These are required for the highest scoring combinations (6-7-8 Flush = 100, 8-8-8 = 90)
    // We give them a huge "potential" buffer so they aren't discarded early just because they don't connect yet.
    if (card.number >= 6) {
        totalWorth += 50000 * (card.number - 5); // 6->50k, 7->100k, 8->150k
    }

    const pairs = getCombinations(contextCards, 2);
    for (const pair of pairs) {
        const result = calculateScore([card, ...pair]);
        if (result.score > 0) {
            totalWorth += Math.pow(result.score, 3); 
        }
    }
    return totalWorth;
};

// Monte Carlo Simulation Helper
const runMonteCarlo = (
    initialHand: CardData[], 
    initialDeck: CardData[], 
    initialRemoved: Set<string>, 
    startScore: number
): ChestProbabilities => {
    const ITERATIONS = 20; // Lightweight simulation count
    let golds = 0, silvers = 0, bronzes = 0;
    
    for(let i=0; i<ITERATIONS; i++) {
        let deck = shuffle([...initialDeck]);
        let hand = [...initialHand];
        let removed = new Set(initialRemoved);
        let score = startScore;
        let active = true;
        
        while(active) {
            // Fill hand
            while(hand.length < 5 && deck.length > 0) {
                hand.push(deck.pop()!);
            }
            
            if(hand.length < 3 && deck.length === 0) { active = false; break; }
            
            const moves = findBestMoves(hand);
            if(moves.length > 0) {
                 const move = moves[0];
                 score += move.score;
                 const playedIds = new Set(move.cards.map(c => c.id));
                 hand = hand.filter(c => !playedIds.has(c.id));
                 move.cards.forEach(c => removed.add(c.id));
            } else {
                 if(deck.length === 0) { active = false; break; }
                 
                 // AI Discard: Recurse without chest calc (fast mode)
                 const suggestions = analyzeDiscards(hand, removed, score, false);
                 if(suggestions.length > 0) {
                     const discard = suggestions[0].cardToRemove;
                     hand = hand.filter(c => c.id !== discard.id);
                     removed.add(discard.id);
                 } else {
                     active = false;
                 }
            }
        }
        
        if (score >= 400) golds++;
        else if (score >= 300) silvers++;
        else bronzes++;
    }
    
    return {
        gold: Math.round((golds / ITERATIONS) * 100),
        silver: Math.round((silvers / ITERATIONS) * 100),
        bronze: Math.round((bronzes / ITERATIONS) * 100)
    };
};

export const analyzeDiscards = (
  currentHand: CardData[],
  removedCardIds: Set<string>,
  currentScore: number = 0,
  calculateChestStats: boolean = false
): DiscardSuggestion[] => {
  const currentHandIds = new Set(currentHand.map(c => c.id));
  
  // The universe of cards that are NOT removed.
  const availableUniverse = FULL_DECK.filter(c => !removedCardIds.has(c.id));
  
  // The Draw Pile specifically
  const remainingDeck = availableUniverse.filter(c => !currentHandIds.has(c.id));

  if (remainingDeck.length === 0) return [];

  // Pre-calculate intrinsic worth for every card in the hand.
  const cardWorths = new Map<string, number>();
  for (const card of currentHand) {
      const otherContext = availableUniverse.filter(c => c.id !== card.id);
      cardWorths.set(card.id, calculateCardIntrinsicWorth(card, otherContext));
  }

  const suggestions: DiscardSuggestion[] = [];

  for (const cardToRemove of currentHand) {
    const keptHand = currentHand.filter(c => c.id !== cardToRemove.id);
    
    // Metric 1: Immediate Draw Potential (EV)
    let sumWeightedScores = 0;
    let winningOuts = 0;
    let maxPossibleScore = 0;
    let bestPrediction: Prediction | null = null;

    for (const drawnCard of remainingDeck) {
      const simulatedHand = [...keptHand, drawnCard];
      const moves = findBestMoves(simulatedHand);
      
      if (moves.length > 0) {
        const score = moves[0].score;
        sumWeightedScores += Math.pow(score, 3); 
        winningOuts++;
        if (score > maxPossibleScore) maxPossibleScore = score;

        if (!bestPrediction || score > bestPrediction.score) {
             const winningMove = moves[0];
             const usedIds = new Set(winningMove.cards.map(c => c.id));
             const usedKeptCards = keptHand.filter(c => usedIds.has(c.id));
             
             bestPrediction = {
                 keptCards: usedKeptCards,
                 neededCard: drawnCard,
                 score: score,
                 type: winningMove.type as 'triple' | 'sequence'
             };
        }
      }
    }

    // Metric 2: Retention Value
    let retentionValue = 0;
    for (const kept of keptHand) {
        retentionValue += (cardWorths.get(kept.id) || 0);
    }
    const opportunityCost = cardWorths.get(cardToRemove.id) || 0;

    // COMPOSITE SCORE INDEX
    const immediateFactor = sumWeightedScores; 
    const retentionFactor = retentionValue / 10; 
    
    const scoreIndex = immediateFactor + retentionFactor;

    // --- Monte Carlo Chest Probability ---
    let chestProbabilities: ChestProbabilities | undefined;
    if (calculateChestStats) {
        chestProbabilities = runMonteCarlo(keptHand, remainingDeck, removedCardIds, currentScore);
    }

    suggestions.push({
      cardToRemove,
      probability: winningOuts / remainingDeck.length,
      averagePotentialScore: winningOuts > 0 ? Math.pow(sumWeightedScores / winningOuts, 1/3) : 0, 
      maxPossibleScore,
      outs: winningOuts,
      safeDiscardScore: opportunityCost, 
      scoreIndex: scoreIndex,
      prediction: bestPrediction,
      chestProbabilities
    });
  }

  return suggestions.sort((a, b) => b.scoreIndex - a.scoreIndex);
};