# Screen reading

The helper only ever looks at pictures of the game: the live window you share through the
browser's screen-share prompt, or a screenshot you paste. It never sends keys or clicks, reads
game memory or touches network traffic.

## Fastest: snip the hand

1. In Metin 2, press <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> and snip **just the 5 hand cards**
   (a tight box from the left edge of the first card to the right edge of the last).
2. Press <kbd>Ctrl</kbd> + <kbd>V</kbd> anywhere on the helper page.

The snip is cut into 5 equal slots. If the boxes in **Setup** don't sit on the cards, move the
**Gap** slider. A snip may come several moves after the last one: cards that left your hand
are matched to combos where possible (plays), the rest count as discards, and new cards are draws.

## Live: share the window

Press **Share game window** and pick Metin 2. The first time, drag a box around your 5 hand cards
on the preview (and optionally **Mark field** for the 3 field slots). The box is remembered.
Browsers only allow screen sharing after a click, so this one click is needed each time the page opens.

A live frame is only used when every slot is read confidently, with no duplicates, for 3 frames in a
row. Then: new card = draw, 3 cards gone forming a combo = play, 1 card gone = discard.

## How it learns the cards

Every theme and screen draws the cards differently, so the helper **learns them from you**:

- When a card is unclear (orange), just add it on the 24-card grid as usual. The helper stores what
  that slot looked like as that card. It fills slots left to right, so add cards in hand order.
- Or pick the right card under the slot in **Setup**; pick **empty** for an empty slot.
- It compares each slot with what it learned: colour from the card's hues, number from the shape
  that differs between cards (the frame and emblems all cards share are ignored). So after one hand
  it can already read new combinations, e.g. a blue 6 after seeing a red 6 and a blue 2.
- Learned cards are kept in your browser. **Forget learned cards** starts over.

Before anything is learned, a built-in colour/digit reader is tried; it works only for simple card art.
## Finding the cards automatically

**Find cards automatically** is on by default: share the window or paste a snip of the whole Okey
window and no box is needed. It is tuned on a real starting screen (`tests/fixtures/okey-start.png`):
Metin 2 cards are solid red, blue or yellow with a black number, and the field starts with
face-down cards.

- Candidates are strongly coloured card-sized shapes (or light card faces, for other card art)
  lined up in a row of up to 5 (hand) or 3 (field). The gold/brown window art, the score and the
  face-down cards are ignored.
- On each card only the biggest shape is read: the black number inside a coloured card, or the
  coloured number on a light card. Corner numbers and symbols are skipped.
- 1, 2, 5, 6 and 7 are built in from the game's own digits; 3, 4 and 8 use font shapes until the
  helper learns them from you (pick the card once when it is orange).
- The test reads the real screen at 70%–200% size and inside a full-screen capture.

If it finds no card it is sure of, a snip is cut into 5 hand slots as above, and live mode uses the
box you marked (**Mark hand**).

## Tips

- Keep the game at the same size between sessions, or re-mark the box.
- If a card is read wrong, correct it once in Setup; the helper keeps up to 3 pictures per card.
