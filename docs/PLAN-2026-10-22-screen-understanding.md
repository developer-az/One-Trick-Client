# Screen-Understanding Rebuild — Audit & Plan (2026-10-22)

Source prompt: `Downloads/MASTER-FIX-PROMPT.md`. Companion design files
(`IMPLEMENTATION.md`, `rois.json`, `src/types.ts`, `src/live-client.ts`,
`prototype/vision_pipeline.py`) were **not** present in the repo — this plan re-derives
their equivalents from the existing codebase instead of overwriting it.

## Phase 0 audit — what exists today

### Current pipeline (as-is)
```
Electron main (electron/) ── poll https://127.0.0.1:2999/allgamedata  (live-client.ts)
                             └─> game-monitor.ts (state, KDA, objectives, play moments)
League desktop ── PowerShell/desktopCapturer screenshot ──> mayhem-ocr.ts
                             └─> Python sidecar (electron/scripts/mayhem-ocr.py) OCR ─> mayhem-state.ts
native/keyhook/keyhook.c ── read-only keyboard hook (flash/clip hotkeys) ──> global-key-hook.ts
Renderer (React) ── IPC ── overlay window (overlay-window.ts) ── tips/cues
```

### Compliant with the prompt's boundaries ✅
- **Live Client Data API** is already the state backbone: `electron/live-client.ts`
  polls `/allgamedata` on `127.0.0.1:2999` with `rejectUnauthorized: false` (localhost-only, allowed).
- **Read-only input**: `native/keyhook/keyhook.c` is a keyboard-only `WH_KEYBOARD_LL` hook,
  no `SendInput`, no mouse injection. `globalShortcut` fallback is also read-only.
- **No memory reading, no DLL injection, no rendering hooks, no game input** anywhere in the repo.
- Inference/OCR runs in **main + sidecar**, never the renderer.


### Violations of the prompt's principles (to fix in Phase 1–3)
| # | Violation | Where | Fix |
|---|-----------|-------|-----|
| 1 | `desktopCapturer` full-screen capture (thumbnail of entire display) | `electron/mayhem-ocr.ts` | Replace with WGC of the **League HWND only** in a native sidecar (Phase 8); desktopCapturer only as Phase-3 prototype |
| 2 | Generic full-frame OCR with no ROI map | `electron/scripts/mayhem-ocr.py` | Replace with per-ROI parsers driven by `rois.json` (Phase 3) |
| 3 | `allgamedata` polled wholesale | `electron/live-client.ts` | Poll the five small endpoints; keep `allgamedata` for debug only |
| 4 | No `GameState` contract, no event bus, no objective respawn timers | scattered across `game-monitor.ts`/`mayhem-state.ts` | Introduce `src/vision/gameState.ts` + `src/vision/events.ts` (Phase 1–2) |
| 5 | No event-diffing by `EventID`; risk of duplicate `ChampionKill` emissions | `game-monitor.ts` | Deduplicate in the new event bus (Phase 1) |
| 6 | Absolute pixel coordinates hard-coded in OCR scripts | `mayhem-ocr.py` | Normalized ROIs + anchors, per-user offsets (Phase 4) |
| 7 | No ffmpeg ring buffer / auto-clipping | absent | Phase 6 (new) |
| 8 | LLM coach layer absent | — | Phase 7 (new, rule engine first) |

### Tooling inventory
- **Package manager:** npm (`package.json`, v1.6.1). Electron + TypeScript + Vite + React.
- **Native modules:** a custom compiled `onetrick-keys.exe` (`native/keyhook/keyhook.c`,
  MinGW). There is **no Rust/C# sidecar yet** — the only "sidecar" is the Python OCR script.
- **ffmpeg:** not currently a dependency — needed in Phase 6.
- **Verify scripts:** ~35 `verify_*.ts` files at repo root — new phases add their own
  `verify_*` script in the same style and wire into `package.json`.

## The resolution / HUD-settings variability question

The screenshot (1080p-class frame, minimap bottom-right, HUD bottom-centre) confirms the
standard Riot HUD layout: **the layout is fixed, but four player settings change its
geometry**. ROIs must be *parametric*, never hard-coded:

1. **Resolution & aspect ratio** — League stretches to fill 16:9/16:10/21:9/ultrawide. All ROIs
   are stored as normalized 0–1 fractions of the client rect, so aspect changes are mostly free;
   ultrawide needs a small x-correction on the centre HUD cluster (it stays centred, so
   x-anchoring at centre, not left edge, handles it).
2. **HUD scale (25–200% in League settings)** — uniformly scales the bottom-centre HUD, killfeed
   and the minimap frame. Auto-detected as `measured minimap size / baseline minimap size`.
3. **Minimap side (left/right)** — a real League setting; auto-detect which bottom corner the
   big square border occupies and mirror the x coordinate.
4. **Map scale (minimap zoom 25–200%)** — scales only the minimap; detect and store separately
   from HUD scale so the two don't contaminate each other.

Two anchors solve all four: the **minimap border** (bottom-left/right corner) and the
**player frame border** (bottom-centre), derived each game via edge detection. Everything else
is expressed relative to those. If either anchor's confidence is low we fall back to the user's
saved offsets and surface a "recalibrate" hint — never silently parse with wrong boxes.

Colourblind mode swaps HP-bar hue (green→yellow-ish, red→orange-ish) but not geometry, so it's
handled inside the HSV parser by trying both hue bands, not by a separate ROI map.

## Phase plan mapped onto this repo

| Phase | Scope | New code | Verify script |
|-------|-------|----------|---------------|
| 1 | Live Client poller, event bus, objective timers | `src/vision/live-client-v2.ts`, `src/vision/gameState.ts`, `src/vision/events.ts` (sidecar-compatible) | `verify_live_client_v2.ts` |
| 2 | Event engine: clip triggers + Brilliant scoring | `src/vision/score.ts` (config-driven, `reasons[]`) | `verify_score.ts` (fixtures, no live game needed) |
| 3 | ROI parsers in Python (prototype, desktopCapturer/mss capture) | `prototype/rois.json`, `prototype/parsers.py`, `prototype/calibrate.py` | `verify_mayhem_ocr.py`-style harness + labelled test set |
| 4 | Calibration UI in Electron settings | `src/app/views/CalibrateView.tsx` + IPC | `verify_overlay_bounds.ts` extension |
| 5 | Minimap detector v0 (colour segmentation, no ML) | `prototype/minimap_v0.py` → port to TS/native in Phase 8 | `verify_minimap_v0.ts` |
| 6 | ffmpeg ring-buffer auto-clipping in the sidecar | `native/clipper/` | `verify_clipper.ts` |
| 7 | Rule-engine coach (LLM optional, off by default) | `src/logic/coach.ts` | `verify_coach.ts` |
| 8 | Native sidecar port (Rust WGC + ONNX) + perf report | `native/sidecar-rs/` | perf harness script |

### Immediate next actions (Phase 1)
1. Create `src/vision/gameState.ts` with the exact `GameState`/`GameEvent`/`PlayerSnapshot`
   contract from the prompt (typed, no vision fields outside `minimap`).
2. Create `src/vision/events.ts` — `EventID`-dedup diffing of `eventdata`, one emission per event.
3. Create `src/vision/live-client-v2.ts` — poll the five small endpoints at 300 ms, merge into
   GameState, maintain dragon +300 / baron +360 / herald +360 respawn timers, keep
   `allgamedata` behind a debug flag only.
4. Add `verify_live_client_v2.ts` with a mocked transport (no real game needed to test the
   diffing/merging logic); live Practice-Tool acceptance still needs a human-run session.
5. Keep `electron/game-monitor.ts` untouched until v2 proves out — then switch consumers over
   and delete the `allgamedata` polling path.

### Non-negotiables restated for this repo
- Renderer never does capture/OCR/inference (already true; keep it true).
- No memory reading, no injection, no rendering hooks, no input to the game — verified clean.
- `desktopCapturer` is **prototype-only** and must be gone from the production path by Phase 8.
- Every phase lands with its `verify_*` script passing before the next phase starts.
