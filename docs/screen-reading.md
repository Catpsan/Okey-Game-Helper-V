# Screen reading

The helper only ever looks at pictures of the game: the live window you share through the
browser's screen-share prompt, or a screenshot you paste. It never sends keys or clicks, reads
game memory or touches network traffic.

## Default: it finds the Okey window by itself

Tuned to the real Okey window (solid red, blue or yellow cards with a black number). Either:

- press **Share game window** and pick Metin 2 (windowed mode; browsers can't capture fullscreen games), or
- snip the Okey window with <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> and press <kbd>Ctrl</kbd> + <kbd>V</kbd> in the helper.

No box to draw. It finds the five card faces (same size, in a row), takes the colour of each face and
reads the big black number in the middle, ignoring the frame, the face-down field cards, the deck and
the score. On big screens it zooms into the Okey window and reads it at full resolution.
The numbers 1, 2, 5, 6 and 7 use the game's own digit shapes; 3, 4 and 8 use a matching serif font
plus a loop count (8 has two loops, 6 one, 3 none). If a number is ever read wrong, pick the right
card under it in **Setup** once: it learns that number's real shape.

The real screenshot is part of the tests (`tests/okey.test.ts`), at several sizes and inside a desktop capture.

## Other mode: marked box / snip of the hand

For other skins, pick **Marked box / snip of the hand** in Setup. Then:

1. In Metin 2, press <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> and snip **just the 5 hand cards**
   (a tight box from the left edge of the first card to the right edge of the last).
2. Press <kbd>Ctrl</kbd> + <kbd>V</kbd> anywhere on the helper page.

The snip is cut into 5 equal slots. If the boxes in **Setup** don't sit on the cards, move the
**Gap** slider. A snip may come several moves after the last one: cards that left your hand
are matched to combos where possible (plays), the rest count as discards, and new cards are draws.

### Live: share the window

Press **Share game window** and pick Metin 2. The first time, drag a box around your 5 hand cards
on the preview (and optionally **Mark field** for the 3 field slots). The box is remembered.
Browsers only allow screen sharing after a click, so this one click is needed each time the page opens.

A live frame is only used when every slot is read confidently, with no duplicates, for 3 frames in a
row. Then: new card = draw, 3 cards gone forming a combo = play, 1 card gone = discard.

### How it learns the cards

Every theme and screen draws the cards differently, so the helper **learns them from you**:

- When a card is unclear (orange), just add it on the 24-card grid as usual. The helper stores what
  that slot looked like as that card. It fills slots left to right, so add cards in hand order.
- Or pick the right card under the slot in **Setup**; pick **empty** for an empty slot.
- It compares each slot with what it learned: colour from the card's hues, number from the shape
  that differs between cards (the frame and emblems all cards share are ignored). So after one hand
  it can already read new combinations, e.g. a blue 6 after seeing a red 6 and a blue 2.
- Learned cards are kept in your browser. **Forget learned cards** starts over.

Before anything is learned, a built-in colour/digit reader is tried; it works only for simple card art.
**Auto-find cards (beta)** looks for the cards anywhere in the picture without a box; it is less reliable.

## Tips

- Keep the game at the same size between sessions, or re-mark the box.
- If a card is read wrong, correct it once in Setup; the helper keeps up to 3 pictures per card.
