# Okey card rules (as assumed by the engine)

Taken from V1 (`services/gameLogic.ts`). Items marked **unconfirmed** need checking against the live server.

## Deck and hand

- 24 cards: 3 colours (red, blue, yellow) × numbers 1 to 8, one of each.
- Hand of up to 5 cards, drawn from the deck.
- Each turn you can play a combo of 3 cards from your hand or discard one card.
- Discarding is unlimited. **Unconfirmed**
- You can draw without playing or discarding while the hand has free slots. **Unconfirmed**
- The game ends when the deck is empty and no combo can be played.

## Scoring

| Combo | Rule | Points |
|---|---|---|
| Mixed-colour sequence | 3 consecutive numbers, not all same colour | lowest number × 10 (1-2-3 = 10 … 6-7-8 = 60) |
| Same-colour sequence | 3 consecutive numbers, same colour | lowest number × 10 + 40 (1-2-3 = 50 … 6-7-8 = 100) |
| Triple | same number, 3 different colours | number × 10 + 10 (1-1-1 = 20 … 8-8-8 = 90) |

## Chests

| Chest | Final score |
|---|---|
| Gold | 400 or more |
| Silver | 300 to 399 |
| Bronze | under 300 |

Scores and thresholds: **unconfirmed** for the current server.
