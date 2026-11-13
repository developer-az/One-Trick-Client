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
(filled in as steps finish)
