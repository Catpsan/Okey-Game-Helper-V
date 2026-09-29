# Okey Game Helper V2

A companion for the Metin 2 Okey card minigame that suggests your best next play, predicts upcoming draws and chest odds, and reads the game state from the screen.

V1 lives at [Catpsan/Okey-Game-Helper](https://github.com/Catpsan/Okey-Game-Helper) (manual card entry).

## Hard rule: read-only

The helper only **looks** at the pixels of the game window you choose to share. It never:

- sends keyboard or mouse input to the game,
- reads or writes game memory,
- reads, modifies or injects network packets.

Every action in the game is made by the player.

## Contents

- [`docs/v2-plan.md`](docs/v2-plan.md): V1 review and the V2 plan (move optimization, predictions, screen reading, phases).
- [`docs/rules.md`](docs/rules.md): the game rules the engine assumes, and open questions.
- [`screenshots/`](screenshots/): reference screenshots of the Okey window, used to build card recognition.

## Status

Planning. No code yet.
