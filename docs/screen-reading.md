# Screen reading

The helper only ever looks at pictures of the game: either the live window you share through
the browser's standard screen-share prompt, or a screenshot you paste. There is no code path
that sends keys or clicks, reads game memory or touches network traffic.

## Two ways to feed it

**Live window.** When the page opens, press **Share game window** and pick the Metin 2 window.
Browsers only allow screen sharing after a click, so this one click is needed each time the page
opens; everything after that is automatic.

**Snipping Tool paste.** Press <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>, snip the Okey
window, then press <kbd>Ctrl</kbd> + <kbd>V</kbd> anywhere on the helper page. Dropping an image
file on the page works too. A pasted picture may come several moves after the last one: cards that
left your hand are matched to combos where possible (plays), the rest count as discards, and new
cards are draws. Check the log and use Undo if it guessed wrong.

## Automatic layout detection

With **Find cards automatically** on (the default) there is nothing to calibrate:

1. The picture is scanned for strongly coloured red, blue and yellow pixels.
2. Connected coloured shapes of a plausible size are candidate card numbers (or whole cards, if
   the card face itself is coloured). Coloured frames around a number are ignored in favour of the
   number inside.
3. Shapes lined up in a row with similar heights form the hand (up to 5) and the field (up to 3).
   Rows with more than 5 shapes, and shapes that don't read as a number, are ignored, so coloured
   text and icons in the interface don't count.
4. Each shape's colour comes from its dominant hue and its number from its outline, compared with
   built-in digit shapes and with any numbers you taught.

Green boxes on the preview are confident readings, orange ones are not.

## Teaching numbers

The built-in digit shapes come from common fonts and may not match the game's font. If a number
is misread or shown with "?", pick the right number under that card in **teach…**. Teach each
number once, in any colour (the helper learns the shape, not the colour). A second sample helps if
it still misreads. **Export setup** saves what you taught to a file you can import later; it is
also kept in the browser.

## Manual slots (fallback)

Untick **Find cards automatically** to draw the hand box (5 slots) and field box (3 slots)
yourself, as in the first V2 version.

## Following the game (live)

- A frame is only used when every card is read confidently with no duplicates, and the reading
  stays the same for 3 frames in a row.
- Changes then become events: new card = draw, 3 cards gone forming a combo = play,
  1 card gone = discard. Anything else shows a warning for you to fix (24-card grid or Undo).
- Untick **Follow the game** to keep watching without changing the game state.

## Known limits

- Detection has been tested on synthetic game pictures only. Real screenshots are needed to confirm
  the colour ranges and card sizes work with the actual game art.
- Other windows or animations covering the cards make frames unreadable; the helper waits for a
  clean frame.
