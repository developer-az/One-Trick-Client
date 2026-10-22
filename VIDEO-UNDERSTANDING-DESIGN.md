# Video-Understanding Design — One-Trick League Client

> Written against the MASTER-FIX-PROMPT (design source) and this repo's current state
> (`TODO.md` phases 1–4 live, 5–7 live in parts, 8 = recorder). Companion to `TODO.md`.
> The screenshot that motivated this doc: a real game frame at an unusual resolution
> (non-1080p/1440p), scaled-down HUD, minimap bottom-right — proof that **no fixed pixel
> ROI can ever work**. Everything below is built around that fact.

## 1. Non-negotiable principles (from the master prompt)

1. **Image → state, not image → caption.** Output is `GameState` JSON. Never free text as primary.
2. **API first, vision second.** If the Live Client Data API gives it exactly, vision must not
   re-derive it. Vision exists only for what the API lacks: positions/minimap, wards, wave
   state, on-screen enemy HP bars, camera context.
3. **Fixed HUD layout is the model** — but *fixed relative to anchors*, not to pixels.
   Each ROI gets the cheapest exact parser: color ratios for bars, digits-only OCR for
   numbers, closed-set template matching for icons. **Never** a full-frame generic OCR pass.
4. **LLM last, on trigger only.** Rule engine answers instantly; LLM only on hotkey,
   a scored Brilliant/Blunder moment, or post-game review, receiving GameState JSON +
   60s timeline as text. At most one downscaled crop to a vision model, only when the
   question is genuinely visual.
5. **Compliance boundaries:** No process-memory reads, no injection/hooks, no input
   simulation to the game, no "undetectable" anything. Yes to: Live Client API
   (`https://127.0.0.1:2999/liveclientdata/*`, self-signed cert, localhost only), LCU API,
   Data Dragon static data, and capturing the user's own screen. Input = read-only global
   listening. Overlay = transparent, alwaysOnTop, click-through Electron BrowserWindow.

## 2. The core problem this doc solves: screen variability

League's HUD is *consistent* only relative to its anchors. Across real users it varies by:

| Source of variance | Examples seen / expected |
| --- | --- |
| Resolution + aspect | 1920×1080, 2560×1440, 2560×1080 ultrawide, 1366×768 laptops, windowed mode |
| **HUD scale** (in-game Interface slider) | 0–100 slider; scales the whole HUD (portrait, abilities, items, gold, minimap chrome) |
| **Minimap scale** (own slider) | Minimap size is independent of HUD scale |
| Minimap side | Bottom-right (default) or bottom-left (user setting) |
| Colorblind mode | Ally HP bars green → **blue**; red/green UI elements shift (blue/yellow) |
| "All dark"/HUD alpha settings | Darker chrome, e.g. the dark HUD in the motivating screenshot |
| Camera zoom / FOV | Affects in-world HP-bar sizes and minimap-to-world ratio only (ROIs unaffected) |

**Anti-goal:** hardcoding pixel ROIs for 1080p and hoping. **The rule:**

> All ROI coordinates are **normalized (0–1) against the League client area** (`GetClientRect`
> of the League HWND), then transformed per-user by two auto-detected anchors
> (**minimap box** and **player frame**). If anchors aren't confidently found, fall back to
> saved per-user offsets and *tell the user calibration needs a check* — never parse wrong boxes.

### Research log (what we could not verify online — flagged, and made non-blocking)

External search from this environment is currently blocked (DuckDuckGo bot-challenge,
GitHub code search rate-limited, Fandom 403). Rather than guess, the design **does not
depend on any unverified config knowledge**:

- **HUD-scale slider → `GlobalScale` mapping in `game.cfg`**: unverified exact mapping.
  *Approach:* read `game.cfg` (under the Riot install, e.g. `C:\Riot Games\League of
  Legends\Game\game.cfg`) as a **hint only** (section `[HUD]`, key `GlobalScale` if
  present). Calibration is done from pixels regardless; the cfg value is logged for
  correlation during calibration testing. TODO(empirical): capture the user's cfg before
  and after moving the slider, record the mapping into `CALIBRATION.md` once, then treat
  it as a two-way sanity check (slider jump ⇒ expected anchor-size jump).
- **Colorblind-mode config key**: unverified. *Approach:* detect from pixels — calibration
  samples the known ally-HP-bar green hue; if the dominant hue in that sample is instead
  the colorblind blue, flag `colorblind: true` in per-user config. This needs no config
  knowledge and is self-verifying every session.
- **Minimap side setting**: same — detected from the anchor step (minimap border square is
  searched in both bottom corners; whichever scores wins).

If any of these turn out to have a stable documented mapping later, they become *hints*
that speed up calibration — the pixel-detected ground truth always wins.

## 3. Target architecture

```
League ── Live Client API (127.0.0.1:2999) ──┐
                                             ├─> State Service (Electron main now, native sidecar later)
League window ── Windows.Graphics.Capture ──>│    - polls API @ ~400ms, diffs events by EventID
  (HWND, borderless)    (sidecar later)      │    - owns GameState, event bus, objective timers
        ROI crops only ─ OpenCV parsers      │    - fight-start rolling 10s snapshot buffer
                       └─ ONNX (DirectML)    ├─> IPC / localhost WS (JSON) ─> Electron renderer overlay
                                             └─> Ring-buffer recorder (ffmpeg, 5s segments,
                                                  keep 120s) ──trigger──> clip [-20s, +8s]
Global hotkeys (read-only listener) ──> State Service
```

- Electron `desktopCapturer` is **only** a Phase-3 prototype shortcut; production is
  WGC (Windows.Graphics.Capture) of the League HWND in a native sidecar
  (Rust `windows-capture` + `ort`, or C# WinRT + ONNX Runtime). The Python/OpenCV
  prototype (`vision/vision_pipeline.py`, already in repo) keeps the same JSON protocol
  so it can be swapped without touching Electron.
- Nothing in the renderer does capture, OCR, or inference.
- League in exclusive fullscreen breaks WGC/overlay → detect and prompt the user to
  switch to Borderless.

## 4. The contract — GameState

```ts
interface GameEvent {
  id: number; name: string; gameTime: number; raw: Record<string, unknown>;
}
interface PlayerSnapshot {
  riotId: string; champion: string; team: "ORDER" | "CHAOS";
  isSelf: boolean; isDead: boolean; respawnTimer: number; level: number;
  kills: number; deaths: number; assists: number; cs: number; items: number[];
}
interface MinimapState {
  allyVisible: number; enemyVisible: number;
  detections: { cls: string; x: number; y: number; conf: number }[]; // normalized to minimap
}
interface GameState {
  ts: number; inGame: boolean; gameTime: number;
  self: { champion: string; level: number; hpPct: number | null;
          manaPct: number | null; currentGold: number | null; cs: number | null };
  players: PlayerSnapshot[];
  minimap: MinimapState | null;   // vision only — API has no positions
  events: GameEvent[]; lastEvent: GameEvent | null;
}
```

Repo alignment: `src/live-client.ts` already builds `inGame`, `self.*`, `players` from the
API; `src/types.ts` will be extended with `MinimapState` and the calibration types below.
`GameState` is the **only** thing downstream consumers (overlay UI, scorePlay, recorder,
coach) read. Nothing downstream touches pixels.


## 5. Vision pipeline (per-ROI parsers)

### 5.1 ROI map

New file `vision/rois.json`: every ROI as **normalized 0–1 coordinates against the League
client area**, versioned by game patch. Regions: `minimap`, `selfPortraitHp`,
`selfAbilities`, `selfItemsGold`, `gameTimer`, `teamScoreTop`, `killFeed`,
`announcement`, `screenCentre`, `chat` (optional).

Cross-check rule: whenever the API provides a value, vision may *validate* it (log a
mismatch once, not spam) but must never *replace* it as the source of truth.

### 5.2 Per-user calibration (handles different resolutions & HUD settings)

Two anchors, auto-detected from a captured frame:

1. **Minimap anchor** — edge detect + find the large square border in the bottom-right
   **or bottom-left** quadrant (side is a user setting — detect it). Gives minimap
   origin + size → `minimapScale`.
2. **Player-frame anchor** — bottom-centre portrait border template match. Gives HUD
   position + scale (`hudScale`).

All ROIs are stored normalized against a baseline reference layout (League default HUD
at 1080p); at runtime each ROI rect is transformed through
`{resolution → client-area size, hudScale, minimapScale, minimapSide} + perUserOffsets`,
then clamped. Per-user config `userData/calibration.json` stores offsets, scales,
minimap side, colourblind flag, last-verified resolution.

Auto-recalibrate on: first launch, resolution change, HUD-scale change, and the
loading-screen → in-game transition. Low anchor confidence ⇒ fall back to saved
offsets + a visible "check calibration" nudge — never silently parse with wrong boxes.

### 5.3 Change gating + budgets

Hash / pixel-diff every ROI crop; unchanged since last pass ⇒ skip its parser entirely.
Per-ROI rates: minimap 5–10 fps, self HP/mana 10 fps, timer/gold/CS 1 fps, killfeed on
change, full frame never. Budgets: sidecar <3% CPU avg, <150 MB RAM, <1% FPS impact,
all vision models <50 MB on disk (int8 ONNX); minimap inference ≤25 ms/crop.

### 5.4 Parsers (implement exactly, in this order)

- **Bars (no ML):** crop → HSV segment (HP green or colourblind-blue, mana blue, enemy
  HP red) → fill ratio along the bar's middle band → `hpPct`/`manaPct` in [0,1].
- **Digits (numbers only):** crop → 2–3× cubic upscale → grayscale → Otsu/adaptive
  threshold → OCR with hard whitelist `0123456789:./`. Start with RapidOCR (ONNX). If
  game-timer accuracy <95% on the test set, fine-tune a tiny CRNN on synthetic
  League-style font renders — never a bigger general OCR model.
- **Icons (closed set):** Data Dragon champion/item/spell icons cached per patch,
  matched with `cv2.matchTemplate`. Only if that fails on the test set, train a small
  classifier (MobileNetV3 / YOLO-cls, int8 ONNX).
- **Names (closed set):** never free-OCR player names — fuzzy-match any OCR output
  against the exact 10 names from `playerlist`.
- **Screen-centre bars:** detect horizontal HP bars above champions (geometry + HSV);
  output count + lowest enemy HP %. No OCR there.

### 5.5 Test set

≥30 real screenshots: 1920×1080 and 2560×1440, HUD scales 50/100, minimap right (left
if feasible), colourblind on/off. Targets: timer ≥95% exact, self HP within ±3%,
killfeed champion icon ≥95% correct, per-ROI ms cost reported. Manifest + results
committed.


