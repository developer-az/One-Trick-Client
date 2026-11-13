# PLAN — Native overlay hardening: make the 1.7.0 test build actually work for a full match

Goal: the native-overlay remake (`onetrick-presenter.exe` + offscreen Chromium) must render correctly, stay on top, never block input, never leak, and degrade safely, across a whole match in borderless and fullscreen. Then raise HUD quality for how pros play.
Branch: `orchestrate/native-overlay-hardening` from `test-native-overlay-20261111` (`86382fe`).
Task class: M1-M2 SPEC-COMPLETE (checks writable up front). M3 DESIGN/VISUAL (needs the top-tier orchestrator + look-checks).
Orchestrator model: Sonnet 5.5 for M1-M2.

## Findings from the audit (all measured on this Windows host, 2026-11-12)
1. **P0 — presenter dies on the first message.** `CreateNamedPipe(PIPE_TYPE_MESSAGE|PIPE_READMODE_MESSAGE)` + `readExact(8-byte header)` on a message written as one 8+N-byte write returns `ERROR_MORE_DATA`, so `readExact` fails and the pipe thread exits. Real run: log shows `client-connected` then `pipe-closed frames=0` immediately. The native overlay in the test build could never have rendered. Proved fix: byte-mode pipe (`PIPE_TYPE_BYTE|PIPE_READMODE_BYTE`) gives HELLO->READY, PING->PONG, frames applied.
2. **P0 — frames are corrupt after the first partial paint.** Electron 39 OSR `paint` gives the FULL frame as `image` (physical px, e.g. 1001x750 for 800x600 @1.25) and `dirtyRect` already in physical px. `forwardPaint` scales `dirtyRect` again and pastes the full image at that offset, so the HUD is shifted/cropped. Fix: crop the dirty rect out of the full bitmap, no re-scaling; send the full frame only when the dirty rect covers it.
3. `respawn()` has no in-flight guard (budget of 2 is burned in two 1-2 s polls) and never kills the old child; after budget it gives up with NO fallback, so the user has no overlay at all.
4. Presenter asserts `HWND_TOPMOST` only on SHOW. Nothing re-asserts z-order if another topmost window lands above it. No `WM_NCHITTEST`->`HTTRANSPARENT` / `WM_MOUSEACTIVATE`->`MA_NOACTIVATE` guard. Per-frame `malloc` of up to a full frame. An orphaned presenter waits forever for a client. `DWORD`/`int` frame-rect arithmetic is not overflow-safe.
5. Existing `verify_native_presenter.ts` only greps source text; nothing exercises the real pipe, which is how 1 and 2 shipped.

## Hard constraints (every brief)
- Passive and read-only. No injection, no game-memory reads, no input simulation, no `SetWindowsHookEx`/`SetWinEventHook` (anti-cheat optics). z-order upkeep uses a plain timer only.
- No new dependencies. Never delete/reinstall node_modules. Test files already in the repo are frozen; new test files are allowed.
- Keep Electron backend (unlocked/align panel) working unchanged.

## Context pack
- Repo: Electron 39.2.3 + React 19 + TS 5.9 + Vite 7. Windows host; Docker `pi-sandbox:1.4.0` for TS work.
- Typecheck: `npx tsc -p tsconfig.app.json --noEmit`, `... tsconfig.electron.json`, `... tsconfig.node.json`. Lint: `npm run lint`.
- Tests: `npx --yes tsx verify_<name>.ts`; new harness gets a `verify:<name>` npm script. Host-only (Windows) harnesses go in `verify:local-extended`, not `verify:release`.
- Native build: `npm run build:presenter` (MinGW `x86_64-w64-mingw32-gcc` on PATH, flags `-O2 -s -mwindows -Wall -Wextra`) -> `native/bin/onetrick-presenter.exe` (git-ignored).
- Key files: `native/presenter/presenter.c`, `electron/overlay-presenter.ts` (driver), `electron/overlay-window.ts` (backend switch, `keepOverlayOnTop`, `healOverlayWindows`, health log), `electron/paths.ts` (`nativePresenterPath`), `verify_native_presenter.ts`.
- Protocol: `u32 type,u32 len,payload`, little-endian; types in `overlay-presenter.ts` `PRESENTER_MSG` (HELLO=1 FRAME=2 SHOW=3 HIDE=4 CLICKTHROUGH=5 BOUNDS=6 CAPTURE=7 PING=8; READY=101 PONG=102 ERROR=103). Pipe `\\.\pipe\onetrick-presenter`. Log `%APPDATA%\One Trick\logs\presenter.log`.
- Baseline (clean tree, 2026-11-12): verify_native_presenter, overlay_bounds, overlay_health, ipc_surface, game_monitor PASS; 3 typechecks ok; lint ok. No known pre-existing failures.
- DO-NOT-FLAG: global keyboard hook (passive, by design); `verify_global_hotkeys` needing the native helper; PLAN/handoff prose; Windows-only checks not runnable in Docker.

## Milestone 1 — the presenter works (host-verified)
- **S1 (Pi, Docker) — frame cropping, pure logic.** New `electron/presenter-frame.ts`: `cropDirtyRect(bitmap, imgW, imgH, dirty)` -> `{x,y,w,h,data}`; clamps to image, empty/NaN rects -> null, full-cover -> whole image without copying, rows copied with correct stride. Wire into `forwardPaint` (no `physicalRect` scaling of dirtyRect; `setBounds` still scales). New `verify_presenter_frame.ts` + `verify:presenter-frame`, added to `verify:release`. Allowlist: `electron/presenter-frame.ts`, `electron/overlay-presenter.ts`, `verify_presenter_frame.ts`, `package.json`.
- **S2 (Codex, host) — live presenter harness (tests first).** New `scripts/probe-presenter.mjs` + `verify:presenter-live` (in `verify:local-extended`): spawns the built exe, connects with Node `net` exactly like the driver, asserts: HELLO->READY; PING->PONG; header and payload delivered whole, split, and 1-byte-at-a-time all work; bad version / oversize / bad rect -> ERROR or ignored but process survives; FRAME dirty rects land at the right pixels (read back via a debug-free path: PrintWindow is unavailable, so assert via `frames=` log and no crash); ex-style flags `LAYERED|TRANSPARENT|NOACTIVATE|TOOLWINDOW|TOPMOST` and `HTTRANSPARENT` hit-test, queried via PowerShell P/Invoke; leak check: 3000 full-size frames, handle count and GDI/USER object count growth under thresholds; exits within 3 s of pipe close. Must FAIL on current exe (documented), allowlist `scripts/probe-presenter.mjs`, `package.json`.
- **S3 (Codex, host) — presenter.c hardening until S2 is green.** Byte-mode pipe; reusable grow-only payload buffer (cap 64 MB, no per-frame malloc); 64-bit overflow-safe frame validation; `WM_NCHITTEST`->`HTTRANSPARENT` when click-through; `WM_MOUSEACTIVATE`->`MA_NOACTIVATE`; 1 s timer re-asserting `HWND_TOPMOST` (NOACTIVATE|NOMOVE|NOSIZE) only while shown and only when something is above us (`GW_HWNDPREV` non-null) or the TOPMOST bit was lost, with a rate-limited `z-reasserted` log line; no-client timeout (30 s) then exit; log `z-reasserted`, `topmost-lost`; keep every existing log string that `verify_native_presenter.ts` greps. Allowlist `native/presenter/presenter.c`, `verify_native_presenter.ts` (additions only).
- Milestone check: full harness green on host, `npm run build:presenter` warning-free, targeted suites + typechecks + lint.

## Milestone 2 — the driver survives reality
- **S4 (Pi, Docker) — supervisor.** New pure `electron/presenter-supervisor.ts` + `verify_presenter_supervisor.ts`: decides `respawn | wait | fallback` from events (down, spawn-failed, ready-timeout, healthy-for-N-s) with injected clock; in-flight guard, exponential backoff (1 s, 2 s, 4 s ... cap), budget refills after 2 healthy minutes, falls back to the Electron overlay after 4 consecutive failures within 60 s, never respawns while shown=false and no match.
- **S5 (Pi, Docker) — wire it.** `overlay-presenter.ts`: single in-flight spawn, kill old child (and wait for exit) before respawn, route decisions through the supervisor, `onFallback` callback; `overlay-window.ts`: on fallback switch backend to Electron for the rest of the match (log `backend-fallback`), subscribe to `screen` `display-metrics-changed` / `display-added|removed` and `powerMonitor` `resume`/`unlock-screen` to re-send BOUNDS, request a full frame, re-assert show. Health log gains `zReasserts`/`respawns`. Allowlist `electron/overlay-presenter.ts`, `electron/overlay-window.ts`, `verify_overlay_health.ts` is FROZEN (add new `verify_overlay_fallback.ts` instead).
- Milestone check: read diff, host smoke (`npm run electron:build`, launch Electron with the real presenter, mock Live Client from `scripts/perf/mock-live-client.mjs`, kill the presenter mid-run and confirm respawn/fallback in `overlay.log`), typechecks, lint.

## Milestone 3 — HUD quality (DESIGN/VISUAL; needs the top-tier orchestrator and look-checks)
Not started. First a Pi survey of what the HUD already shows vs. what high-level players track (objective timers, summoner/ult cooldowns, wave/jungle, item spikes, gold-to-buy), then a bounded list of improvements and a look-check pass. To be scoped after M1-M2 are verified.

## Review gate
FIRST-PASS: GLM-5.3-Flash via Pi (full diff). FINAL: Codex on the whole diff, HIGH effort (flagship, user-visible, system-level code). Not claimed unless it actually ran and passed.

## Unverifiable here (must be said plainly)
No League match is available, so true borderless/fullscreen behavior, MPO interaction, and real-match z-order are proven only by harness + mock; the real acceptance test is the user's match using the log lines in the release notes.

## Run log
- S1 Pi/DeepSeek 42 s done. S4 Pi 73 s done. S5 Pi BLOCKED once (correctly: two superseded frozen assertions), orchestrator updated them, rerun 146 s done. S6 Pi 51 s done. S7 Pi 65 s done.
- S2/S3 Codex (host) BLOCKED on live checks (its sandbox denies named pipes); orchestrator ran the harness on the host, fixed three harness bugs (PowerShell $null->"" in FindWindow, WinForms competitor not topmost, EPIPE handler) and two real presenter bugs (z-lift needed HWND_TOP and a full chain walk).
- FIRST-PASS (GLM-5.3-Flash, whole branch): FAIL, 7 findings; verified+fixed #1 fallback undone by loadSettings (critical), #2 hung presenter, #4 payload cap, #5 counters, #6 overlap-aware z lift; dismissed #3 (deliberate test update) and #7 (presenter.log carries z-reasserted).
- FINAL (Codex, HIGH, whole branch): FAIL, 2 findings, both verified real and fixed: MSG_FRAME rejected frames larger than the surface before applyFrame could clip them (+ regression probe, fails on old exe/passes on new); stale native attach could tear down a replacement window.
- DELTA (Codex, LOW): 1 medium (sidecar left alive if start() rejects) fixed; that last 6-line fix was NOT re-reviewed.
- Host evidence: probe-presenter.mjs all ok; smoke-native-overlay.mjs 8/8 ok at 125% DPI; verify suites for all touched areas PASS; 3 typechecks ok; lint 0 errors. Pre-existing/environmental: verify_clipper_lifecycle fails because ffmpeg is installed here (clipper.ts unchanged).
- Not done: Milestone 3 (HUD content/design) and a packaged-app run against a mock match (the mock Live Client does not produce a self-player here, so match-start never fired).

---
# ROUND 2 (2026-11-13) — post-test feedback: crash, overlay layout, perf, premium UI, pet, pro features
Task class: mixed. R2-A..C SPEC-COMPLETE (Sonnet orchestrator ok); R2-D..F DESIGN/VISUAL/ambiguous (top-tier orchestrator + look-checks, no queue mode).
Orchestrator model: Sonnet 5.5 (escalate D-F verification to top tier).
Context pack: as above. Extra key files: `src/overlay/OverlayApp.tsx` (1076 loc), `overlayLogic.ts`, `overlay-theme.css`, `ChromeGameHud.tsx`, `hudLayout.ts`, `src/logic/purchasePlan.ts`, `buildProgress.ts`, `bootChains.ts`, `src/app/views/*`, `src/app/theme.css`, `tokens.css`, `electron/main.ts`, `overlay-window.ts` (1623 loc), `match-lifecycle.ts`, `state-service.ts`. Existing `isDestroyed()` guards cover most overlay-window.ts paths; unguarded candidates are timers/IPC callbacks firing after match-end teardown (`handle.destroy()` ~L905, destroy blocks ~L1183-1193) and `main.ts:1010 win.close()`.
DO-NOT-FLAG: as above.

## R2-A (P0) Post-match "Object has been destroyed" uncaught exception
1. Reproduce: unit-level harness `verify_destroyed_guards.ts` with fake BrowserWindow/webContents whose methods throw after destroy(); drive match-end teardown ordering (timers, IPC send, setFrameRate, health log, presenter osrWin paint).
2. Fix: guard every deferred callback (timers, `paint`/`did-finish-load`, `webContents.send`, `setFrameRate`) with a `safeWin()` helper; clear all timers in teardown; register a process-level `uncaughtException` handler that logs to overlay.log and never shows the native dialog for this class. Allowlist: `electron/overlay-window.ts`, `electron/overlay-presenter.ts`, `electron/main.ts`, `electron/clipper.ts`, new `electron/safe-window.ts`, new test, `package.json`.
Done when: new harness green + existing verify_overlay_health/overlay_fallback/presenter_* green + 3 typechecks.

## R2-B Overlay layout fixes (clipped right edge, left side translucency/sectioning)
1. Measure: Pi survey of `overlay-theme.css` + `OverlayApp.tsx` + `hudLayout.ts` for fixed widths, `overflow:hidden`, missing `min-width:0`, absolute-right items, and whether HUD geometry (native presenter surface size vs DOM width) crops the right edge (DPI/physical px).
2. Fix every row to flex with `min-width:0`, price/right column `flex-shrink:0`, safe right padding; verify with a headless-render look-check at 1080p/1440p, 100/125/150% DPI. Left rail: reduce opacity (glass backing ~0.35-0.5, blur off for perf), group into labelled sections (Summoners / Cooldowns / Objectives) with hairline dividers.
Done when: `verify_hud_geometry`, `verify_layout`, `verify_overlay_bounds` green + screenshots at each DPI show no clipped text.

## R2-C Performance (esp. early game)
1. Profile: Pi survey for hot paths: 1 s polling fan-out, state-service recompute, full-frame OSR repaint cadence (OVERLAY_SHOWN_FPS), CSS `backdrop-filter`/animations forcing repaints, DDragon/catalog fetch at match start, React re-render storms in OverlayApp (memo/selectors), IPC payload size. Existing `scripts/perf/` harness reused for before/after numbers.
2. Fix top offenders only, with before/after numbers in the PR. Dirty-rect friendly rendering, throttle idle frames, defer catalog prefetch until after first HUD paint.
Done when: perf harness shows measurable CPU/frame-time drop; no behavior suites regress.

## R2-D Build order clarity ("this, then that")
Single numbered linear build path in overlay + app: `purchasePlan.ts` emits an ordered `NextBuy` list (1 Boots? vs item decision resolved by explicit rule + reason chip e.g. "Boots first: lane-lock, 1100g"), overlay shows ONE highlighted "BUY NEXT" with a numbered queue behind it; ambiguity branches become "if X then A else B" with the condition evaluated live. Tests first: `verify_purchase_order.ts`.

## R2-E Premium UI + customization + pixel pet
1. Frontend master prompt (deliverable `docs/UI-MASTER-PROMPT.md`): design tokens, density, type scale, spacing, glass/gothic material rules, motion, anti-"airy" rules.
2. Apply to app views (tighter density, cards, consistent tokens) in `src/app/theme.css`/`tokens.css`/views.
3. Settings: themes (accent palettes, density, corner radius, glass level, font scale), saved in app-settings; live preview.
4. Pixel pet for the loading screen/lobby: canvas sprite pet (idle/walk/sleep/react-to-queue-pop), choose species/color in settings; rendered in the app window (not injected into the League client — passive-only constraint).
Look-checks required at each sub-step.

## R2-F Pro-feature parity with Blitz/U.GG/OP.GG (scoped honestly)
Survey first (Pi): current coverage vs. matrix: champion tier list, per-champ builds/runes/skill order/matchups, live-game scouting of 10 players (rank, winrate, mastery), post-game timeline review, summoner profile/match history, counters, ARAM/Mayhem. Aggregated stats need a data source: no scraping of blitz/u.gg/op.gg (ToS + legal); use Riot API (needs production key) / Data Dragon / CommunityDragon and own aggregation of players' fetched matches. Deliver a bounded set after the survey; this is a roadmap-sized item and will be split into follow-up PRs rather than pretended done.

## Order / milestones
M-A: R2-A. M-B: R2-B + R2-C. M-C: R2-D. M-D: R2-E. M-E: R2-F survey + first slice. Verify at each; first-pass GLM review at end; Codex final review (HIGH for crash fix).
