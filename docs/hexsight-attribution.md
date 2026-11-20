# hexsight attribution

The name-independent augment-card pixel gate (fixed three-slot sampling of dark-teal
card bodies / light rim contrast, two of three slots required, ambiguous frames
treated as visible) was inspired by the idea in `bard58/hexsight`,
`src/ocr.rs:1016-1096`.

- Copyright © 2026 bard58
- License: MIT OR Apache-2.0
- Repository: https://github.com/bard58/hexsight

Only the algorithm idea was reimplemented, in our own coordinate space against our
own rendered fixtures. No code, screenshots, icons or data were copied from that
project.

The queue-first model was inspired by the idea in the same project,
`src/model.rs:237-242` (the Mayhem queue id list), `src/worker.rs:1050-1177`
(retry the gameflow session each tick in lobby/champ-select/in-game until a real
queue and game id are named, keeping the last queue on a failed read) and
`src/worker.rs:1858-1867` (infer Mayhem queue 2400 from the game API's KIWI mode
when the client names no queue). We reimplemented the idea against our own
game-monitor state and LCU seam; no Rust code was copied.
