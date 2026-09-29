# Okey card rules

Confirmed against the official wikis on 2026-09-29:

- https://en-wiki.metin2.gameforge.com/index.php/Okey_Card_Game
- https://pt-wiki.metin2.gameforge.com/index.php/Evento_Okey

The engine implements exactly these rules (`src/engine/scoring.ts`, tested in `tests/scoring.test.ts`).

## Deck and hand

- 24 cards: numbers 1 to 8 in three colours (red, blue, yellow), one of each.
- You always have up to 5 cards in hand, refilled from the deck.
- Select 3 cards to score a combo. There can be no gap between the numbers.
- Right-click discards a card. Discarded cards are gone for good.
- The game ends when all 24 cards are used, or when you press "End".
- Changing map or teleporting ends the game; cancelled games are not refunded.
- Cost: 30,000 Yang and 1 Card Set per game (up to 999 Card Sets can be held).

## Scoring

| Combo | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Same number, three colours | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |

| Run (lowest card) | 1-2-3 | 2-3-4 | 3-4-5 | 4-5-6 | 5-6-7 | 6-7-8 |
|---|---|---|---|---|---|---|
| Same colour | 50 | 60 | 70 | 80 | 90 | 100 |
| Mixed colours | 10 | 20 | 30 | 40 | 50 | 60 |

## Chests

| Chest | Final score |
|---|---|
| Gold | 400 or more |
| Silver | 300 to 399 |
| Bronze | under 300 |

The event top 10 also earns extra golden chests (1st: 10, 2nd: 5, 3rd: 3, 4th to 10th: 1).

## Modelling notes

- Drawing is free and never hurts, so the engine assumes you refill to 5 before each decision.
- The only real decisions are: which combo to play, which card to discard, or whether to hold a
  combo and discard something else, hoping for a better combo.
- Cards you haven't seen are exactly the cards left in the deck, so draw odds are exact.
