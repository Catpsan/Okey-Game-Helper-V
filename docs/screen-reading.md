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

1. **Card faces first.** The picture is scanned for light, grey-ish areas with a card's
   proportions (taller than wide). Cards that touch each other are split by the card width.
   Only the inside of a face is read, so the game's gold and brown window art, coloured text and
   the score can't be mistaken for cards.
2. **Coloured shapes as a fallback.** If no card face is found (e.g. cards with coloured faces),
   strongly coloured red, blue and yellow shapes of a plausible size are the candidates. A small
   corner number next to a big one on the same card is ignored.
3. Candidates lined up in a row with similar sizes form the hand (up to 5) and the field (up to
   3). A row only counts when at least half of its cards read confidently.
4. On each card only the **biggest** coloured shape is read (the main number), so corner indices
   and symbols don't spoil it. Its colour is the dominant hue (reds may lean orange and yellows
   gold). If the shape is a solid block, the light number printed on it is read instead.
5. The number is compared, by outline and by width/height ratio (so a narrow "1" isn't taken for
   a "7"), with built-in digit shapes and with any numbers you taught.

Green chips/boxes are confident readings, orange ones are not.

## Teaching numbers

The built-in digit shapes come from common fonts and may not match the game's font. If a number
is misread or shown with "?", pick the right number in that card's **fix** menu. Teach each
number once, in any colour (the helper learns the shape, not the colour). A second sample helps if
it still misreads. **Export** (under **Reading settings**) saves what you taught to a file you can import later; it is
also kept in the browser.

## Manual slots (fallback)

Under **Reading settings**, untick **Find cards automatically** to draw the hand box (5 slots) and field box (3 slots)
yourself, as in the first V2 version.

## Following the game (live)

- A frame is only used when every card is read confidently with no duplicates, and the reading
  stays the same for 3 frames in a row.
- Changes then become events: new card = draw, 3 cards gone forming a combo = play,
  1 card gone = discard. Anything else shows a warning for you to fix (24-card grid or Undo).
- Under **Reading settings**, untick **Follow the game** to keep watching without changing the game state.

## Known limits

- Detection is tested on synthetic game-like pictures (window art, score text, corner indices). Real screenshots are needed to confirm
  the colour ranges and card sizes work with the actual game art.
- Other windows or animations covering the cards make frames unreadable; the helper waits for a
  clean frame.
