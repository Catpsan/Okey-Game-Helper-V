# Screen reading

The helper watches the game through the browser's standard screen-share prompt
(`getDisplayMedia`). You choose the Metin 2 window; the helper receives only its picture.
There is no code path that sends keys or clicks, reads game memory or touches network traffic.

## One-time setup

1. Open the helper and press **Share game window**. Pick the Metin 2 window in the browser prompt.
2. Press **Mark hand (5 slots)** and drag a box around the five hand cards on the preview.
   Adjust **Slot gap** until the green boxes sit on the cards.
3. Optional but recommended: press **Mark field (3 slots)** and box the three slots where you
   place cards to score a combo. Cards on the field then still count as "in hand", so moving a
   card there isn't mistaken for a discard.
4. Teach the numbers: under each slot the helper shows what it reads. When a slot shows a card,
   pick its number in **teach…**. Each number needs to be taught once, in any colour
   (the helper learns the shape, not the colour). Teaching a second sample of a number helps if
   it ever misreads it.
5. **Export setup** saves the boxes and taught numbers to a file you can re-import later.
   The setup is also kept in the browser automatically.

## How it follows the game

- A few times per second, each slot is read: colour from the dominant hue, number by comparing
  the shape with what you taught. Empty slots are recognised by having almost no coloured pixels.
- A reading is only used when every slot is empty or read confidently, with no duplicates,
  and it has stayed the same for 3 frames in a row.
- Changes then become events: new card = draw, 3 cards gone forming a combo = play,
  1 card gone = discard. Anything else shows a warning and waits for you to fix it
  (clicks on the 24-card tracker, or Undo).
- Untick **Follow the game** to keep watching without changing the game state.

## Known limits

- The colour ranges assume the game's standard red, blue and yellow cards. If a colour is misread,
  tell us with a screenshot and the ranges in `src/vision/recognize.ts` can be adjusted.
- Other windows covering the game, or animations over the cards, make frames unreadable; the helper
  just waits for a clean frame.
