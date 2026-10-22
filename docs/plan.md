# Plan — Replacing "capture → generic OCR parse" with "API + fixed ROI parsers → GameState"

## The core problem (per-user variability)

Every user has a different:

1. **Screen resolution / aspect ratio** — 1080p, 1440p, 4K, ultrawide 21:9, 16:10.
2. **HUD scale slider** in League (Interface → HUD scale, roughly 0.5×–2.0×, default 1.0).
3. **Minimap scale** (its own slider, also ~0.5–2.0) and **minimap side** (left/right toggle).
4. **Chat scale**, **colourblind mode** (changes HP bar colors), **frame rate cap / V-sync**.
5. **Window mode** — borderless windowed vs exclusive fullscreen (fullscreen breaks capture).

**Conclusion: we never hard-code pixel coordinates for any HUD element.** Every ROI is
normalized (0–1) against the League client area, and re-anchored per user via auto-detection.

## Variability strategy — detect anchors, don't trust defaults

For each new game session (and on resolution change), run a **calibration pass**:

- **Minimap anchor:** edge-detect the large square minimap frame in the bottom-right *and*
  bottom-left quadrant (user setting decides which). Its detected size in px gives the
  **HUD scale factor**: `scale = detectedMinimapPx / baselineMinimapPx` (baseline captured
  at 1080p, HUD 1.0).
- **Player-frame anchor:** template-match the bottom-centre portrait border (champion
  portrait art from Data Dragon at multiple sizes) to locate the self frame.
- **Score/timer anchor:** the game clock top-right and team score frames are anchored to the
  top edge — scaled from the same HUD scale factor and detected via template match.

All remaining ROIs (HP bar, abilities, items, gold, killfeed) are laid out relative to these
two or three anchors, scaled by the detected HUD scale. If anchor confidence is low, fall back
to saved per-user offsets and surface a "recalibrate" hint — never silently parse wrong boxes.

This handles all the sliders without knowing their exact ranges: we measure, we don't assume.

## Target architecture

```
League window ── capture (WGC in native sidecar; desktopCapturer only as prototype) ──┐
Live Client API (127.0.0.1:2999) ─────────────────────────────────────────────────────┤
                                                                                      ▼
                                                        State Service (Electron main)
                                                          - poll API @ 250-500ms
                                                          - diff eventdata by EventID
                                                          - own GameState + event bus
                                                          - objective respawn timers
                                                          - ring buffer for clips
                                                          - rule engine (Brilliant scoring)
                                                                                      │
                                                            IPC/WebSocket JSON (state only)
                                                                                      ▼
                                                            Renderer overlay (read-only)
```

## Non-negotiables

- Image → structured state (GameState JSON), never image → free-text caption.
- API first, vision second. `playerlist`/`activeplayer`/`eventdata` is ground truth; vision
  only fills gaps (minimap positions, on-screen HP bars, killfeed icons).
- Fixed layout is the model: one small parser per ROI, no full-frame OCR pass ever.
- LLM last, on trigger only — never per-frame/per-second.
- Lightweight budgets: <3% CPU avg, <150 MB RAM, <1% FPS impact, all vision models <50 MB.
- No memory reading, no injection, no hooks into League's rendering, no input simulation.
  Keyboard listening is read-only (hotkeys like Flash tracking, manual clip hotkey).

## Phases

| # | Phase | Key deliverable |
|---|-------|-----------------|
| 0 | Audit current repo | Pipeline diagram, what to keep/delete |
| 1 | Live Client Data API poller | GameState from API, event bus, zero vision |
| 2 | Event engine | Clip triggers + Brilliant/Blunder scoring (unit-testable) |
| 3 | ROI parser prototype (Python) | Bars, digits, icons — measured accuracy on a screenshot test set |
| 4 | Calibration UI in Electron | Auto-detect anchors + manual nudge, persist per user |
| 5 | Minimap detector | v0 colour segmentation → v1 YOLO-nano, minimap crop only |
| 6 | Medal-style auto-clipping | ffmpeg ring buffer, segment stitch on trigger |
| 7 | Coaching | Rule engine first (instant, offline); LLM only on hotkey/event |
| 8 | Native sidecar + perf hardening | Rust/C# WGC capture, DirectML, perf report within budgets |

## Next concrete step

Phase 0 audit: inspect current capture/OCR code paths in the repo (electron/*, any Python
prototype), list what maps onto the phases above, and confirm tooling (Python, ffmpeg, native
toolchain availability) before writing any feature code.
