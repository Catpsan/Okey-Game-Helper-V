# Okey Helper V2 plan

Hard rule for every part of this plan: the helper only **looks** at pixels of the game window that you choose to share. It never sends input, never reads game memory, never touches network packets. Every action in the game is yours.

## 1. What V1 does today

V1 ("Okey Card Master", React + Vite, repo `Catpsan/Okey-Game-Helper`) is a manual-entry companion:

- Models the deck as 24 cards (red/blue/yellow × 1–8), a 5-slot hand, and a set of removed cards.
- You click cards to put them in your hand or mark them removed; state is saved in localStorage.
- Scoring (`services/gameLogic.ts`): mixed sequence = start×10 (1-2-3 = 10 … 6-7-8 = 60), same-colour sequence +40 (6-7-8 flush = 100), triple of distinct colours = n×10+10 (1-1-1 = 20 … 8-8-8 = 90). Chests: gold ≥ 400, silver ≥ 300, bronze below.
- Suggestions: shows the best combo in hand, and ranks discards by a hand-tuned index (sum of score³ over the next draw + a "retention" term with a big hard-coded bonus for 6/7/8).
- A 20-game Monte Carlo per discard estimates chest odds, and a "simulate N games" button benchmarks the bot.

## 2. Weak spots worth fixing

1. **Always plays the best combo immediately.** Holding can be better: red 6 + red 7 + blue 8 plays for 60 now, but waiting for red 8 is worth 100. V1 never considers "keep and draw".
2. **Discard ranking is a heuristic, not a real evaluation.** The score³ weighting and the 50k/100k/150k bonuses are magic numbers; they don't measure what actually happens over the rest of the game.
3. **Chest odds are noisy.** 20 rollouts gives ±10–20 percentage points, and the rollout policy is the same greedy bot.
4. **Optimizes average score, not the chest.** If you're at 330 with few cards left, the right move is the one that maximises P(≥ 400), which can differ from the highest-average move.
5. **All manual input.** Every draw, play and discard has to be clicked in, which is slow and error-prone.
6. **Housekeeping:** heavy work runs on the UI thread, there are no tests for the scoring rules, and the README still refers to a Gemini API key that the app doesn't use.

## 3. V2: better move optimization

- **Legal actions every turn:** play any valid combo, discard any card, or (when the hand isn't full) just draw. Evaluate all of them, not just "best combo, else discard".
- **Search:** expectimax over the next 2–3 draws (the branching is small: at most ~19 unseen cards per draw), with leaves scored by a fast value estimate. Deeper in the endgame, when few cards remain, solve **exactly** (the state space collapses quickly).
- **Value estimate:** replace magic numbers with a value table learned offline by simulating millions of games (self-play / value iteration over a compact state: remaining cards by colour/number + hand). Colour symmetry (the 3 colours are interchangeable) cuts the state space by up to 6×.
- **Selectable goal:** "maximise average score" or "maximise gold chance" (or silver when gold is out of reach). The engine re-weights leaves by P(reaching threshold).
- **Explain each suggestion** in one line: "Discard blue 2: keeps red 6-7 open for a 100-point flush (3 outs among 14 cards)".
- Runs in a **Web Worker** so the UI never freezes; benchmark V1 vs V2 bot over 100k simulated games and publish the gold/silver/bronze rates.

## 4. V2: predictions

- **Card tracker with certainty:** every one of the 24 cards is in hand, gone, or still unseen. Unseen cards are exactly what can come next, so draw odds are exact, not estimated.
- **Next-draw panel:** for each unseen card, the probability it's the next draw (1 / unseen count) and what it would unlock ("red 8 → 100 flush").
- **Outs per plan:** for each combo you're building, the number of outs and the probability of hitting it before the deck runs out.
- **Chest forecast:** P(gold / silver / bronze) from the current position under the recommended play, using thousands of fast rollouts (or the exact endgame solve), with a confidence range.
- **Final-score distribution:** a small histogram of where this game is likely to finish.

## 5. V2: screen reading (read-only)

**Recommended approach: keep it a web app and use the browser's screen-share API (`getDisplayMedia`).** You pick the Metin 2 window in the browser's own share dialog; the helper receives video frames of that window and nothing else. It has no way to send clicks or keys, and it reuses all of V1's React code.

Pipeline:
1. **Calibrate once:** you drag a box around the Okey panel; the helper remembers the positions of the 5 hand slots, the score text and the deck counter relative to that box (resolution-independent).
2. **Recognise cards:** each slot is classified by dominant colour (red / blue / yellow, trivial in HSV) and number (template matching against the 8 digit glyphs, captured from your own screen during calibration). 24 possible faces makes this very reliable.
3. **Read score and deck count** with the same digit templates (no OCR library needed).
4. **Infer events from frame changes:** a card appearing in an empty slot = draw; cards leaving the hand with the score going up = play (score delta confirms which combo); one card leaving with no score change = discard. The tracker updates itself.
5. **Stay honest about confidence:** only accept a reading when it's stable across a few frames; if confidence is low, show it in yellow and let you correct it with one click (the V1 manual controls stay as fallback).
6. Sampling at a few frames per second is plenty; all processing stays local in your browser.

Display: the helper sits in a second window / monitor or a narrow side panel next to the game. A transparent always-on-top overlay (Electron) is possible later, still display-only, but it's optional.

Alternative considered: a Python desktop app (mss + OpenCV + a Tk/Qt window). Also read-only and slightly faster to prototype vision in, but it means rewriting V1's logic and UI. I'd only pick it if the browser screen-share doesn't work well with your client.

One caution: some private servers forbid any third-party tool, even read-only ones. Worth checking your server's rules.

## 6. Proposed phases

1. **Engine:** port scoring to a tested module, add the full action set, expectimax + exact endgame, goal selector, Web Worker, V1-vs-V2 benchmark.
2. **Predictions UI:** tracker with certainty, next-draw panel, outs, chest forecast, explanations.
3. **Screen reading:** screen-share capture, calibration, card/score/deck recognition, automatic event tracking, correction UI.
4. **Polish (optional):** overlay mode, session history and stats.

## 7. Things I need from you

- **Rules check:** are the scores above correct for your server, and is discarding unlimited? Can you choose to draw without playing or discarding?
- **Screenshots:** 3–5 screenshots of the Okey window (empty hand, full hand, after a play, end screen), ideally at the resolution you play at. They're the basis for the recognition templates.
- **Where to build:** a `v2` branch in the existing repo (my suggestion), or a new repository.
