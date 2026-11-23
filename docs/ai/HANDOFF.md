# Handoff Log: One Trick Visual & Performance Pass

## Smoke Test & Invariant Checklist

| Surface | Component / Feature | Expected Behavior | Status |
|---|---|---|---|
| Electron Overlay | Summoner Timers (`src/overlay/OverlayApp.tsx`) | Global hotkey (PgUp/PgDn, Num 9/3) triggers Flash countdown, click-through intact | Verified |
| Electron Overlay | HUD Layout & Bounds (`verify_overlay_bounds.ts`) | Bounds accurately frame panels without off-screen bleed or dead space | Verified |
| Electron Overlay | HUD Geometry (`verify_hud_geometry.ts`) | Responsive across 7 League HUD/minimap scale combinations | Verified |
| Electron App | Champion Matchup & Build Draft | Loads Pyke/Pantheon/Yone authored guides or catalog fallback without lag | Verified |
| Electron App | View Transitions (`src/app/App.tsx`, `src/app/theme.css`) | GPU-accelerated 150ms View Transitions API with reduced-motion fallback | Verified |
| Electron App | Gothic Card Polish (`src/app/theme.css`) | Bracketed corner markers and tactile `:active` button response across cards | Verified |
| Website | Interactive Champion Doctrine (`website/src/components/ChampionDoctrineCard.tsx`) | Live authored doctrine switcher for Pyke, Pantheon, Yone with real LP habits | Verified |
| Website | Interactive Hotkey Simulator (`website/src/components/InteractiveSummonerTimers.tsx`) | Clickable mechanical keycaps (PgUp/PgDn) with live 300s Flash countdown | Verified |
| Website | Zero-Debuff Benchmark (`website/src/components/ComparisonMatrix.tsx`) | Verified side-by-side performance metrics vs commercial overlays | Verified |
| Website | Self-Hosted Typography | Zero external Google Fonts network calls; Cinzel, Inter Variable, IBM Plex Mono bundled | Verified |
| Website | Scroll Reveals (`website/src/components/Reveal.tsx`) | Single shared IntersectionObserver instance; 0 React re-renders on scroll | Verified |
| Website | Header Compositor (`website/src/components/SiteHeader.tsx`) | Removed `backdrop-blur` in favor of solid ink surface to eliminate scroll repaint penalties | Verified |
| Website | HUD Studio (`website/src/StudioApp.tsx`) | Interactive HUD module canvas with drag/pin positioning and scale sliders | Verified |
| Website | Social / Open Graph & Twitter Cards (`website/index.html`) | Full Twitter summary_large_image and OG preview tags | Verified |

## Performance Baseline vs Shipped

- **Electron Bundle JS:** 376.78 kB (113.97 kB gzip) -> Delta: **0 kB JS growth**.
- **Electron Bundle CSS:** 15.14 kB (3.61 kB gzip) -> Delta: **+0.07 kB gzip**.
- **Website Base JS:** 192.92 kB (61.06 kB gzip) -> Delta: **0 kB JS growth**.
- **External Network Requests:** Eliminated 7 Google Fonts network round-trips from all website HTML pages.
- **Scroll Overhead:** Single shared observer replaced per-component observers; zero re-renders.
- **All Verifications Passing:** `verify:layout`, `verify:overlay-bounds`, `verify:hud-geometry`, `verify:summoners`, `verify:stats`.

## Session: orchestrate run, Phase 0 + Phase 1 (2026-11-09)
- Branch `orchestrate/perf-tracking-itemlogic` from `main` @ 453d8d5. Plan, context pack, decisions D1-D6 and measured baselines are in `PLAN.md`.
- Phase 0 (tooling): `scripts/perf/mock-live-client.mjs` (HTTPS Live Client stand-in, deterministic game, per-endpoint cadence report), `scripts/perf/measure.mjs` (per-process CPU/RAM sampler), `scripts/perf/README.md`. Baseline: idle 0.06% CPU / 98 MB; in match 9.0 Live Client req/s with the HUD visible AND hidden.
- P1 hidden HUD:
  - The state loop runs at 4000 ms while hidden, versus 400 ms visible.
  - Hidden overlay windows are destroyed after 10 s and re-created on show with the last payload. They report `visibilityState: visible` because `backgroundThrottling: false`, so hiding alone never stopped their painting.
  - Result: hidden 0.93 req/s, 0.02-0.045% CPU, 101 MB (was 9.0 req/s, 0.45%, 158 MB).
- P2: abilities are fetched on level change plus unspent-point refresh (4-6 fetches per ~3 min, was ~108).
- P3: latency recorder and wiring (http.*, poll, hud.build, ocr.mayhem). Mayhem OCR p50 374 / p95 476 ms per call, so the native sidecar is the next run's first item (D6 trigger).
- New tests (written first, frozen by hash): `verify_state_service.ts` (hidden cadence, abilities policy, event integrity), `verify_overlay_clock.ts`, `verify_latency_stats.ts` (scripts added to `verify:release`).
- Found: the event cursor drops EventID 0 (`GameStart`); queued as T5. The Yone build reason "WR" claim is queued as T-WR.
- Coder run log (Pi, sandboxed `pi-sandbox:1.4.0`, model `isoquant/deepseek-v4.1-flash-1017-fast`, `--thinking high`):
  - survey 502s done
  - P0 first brief 92s FAILED (output token limit), halved retry 99s done
  - P0b 126s done
  - P1a 107s, P1b 34s, P1c tests 16s, P1c code 27s, P1d 81s, P1 fix 42s (no change needed; my review finding was wrong)
  - P2 tests 42s, P2 code 25s, P2 amendment tests 53s, P2 amendment code 57s
  - P3 tests 44s, P3b 51s, P3c 43s
  - No hangs.
- Not committed yet; delivery at the end per PLAN Phase 4.

## Session: Phase 2 tracking accuracy (2026-11-09)
- Recorder: `npm run record:game` (scripts/perf/record-live-client.mjs). Passive, anonymized, writes `recordings/*.jsonl.gz` (gitignored). Waiting on one real recorded match (D4) for T3.
- T1/T2: signal inventory test + synthetic fixture; GameState now carries position, isBot, wardScore, summoner spells, keystone, item slots/count/price, self stats and ability ranks, game mode.
- T5: EventID 0 (GameStart) and post-restart events are no longer dropped (cursor -1, re-diff on restart).
- T-WR: the unsourced Yone "WR" claim was reworded; `verify_no_winrate_claims.ts` guards it.
- T4: `src/logic/visionValidation.ts` for the sidecar; Mayhem OCR 9/9 on 3 synthetic fixtures (not representative).
- Coder run log (Pi sandboxed, same model/flags): recorder 256s; T-WR tests 55s, code 19s; T5 tests 86s, code 50s; T1 tests+fixture 109s; T2 code 67s; T4 tests 53s, code 28s. All done, no hangs, all scope gates clean.

## Test pre-release for the League PC (2026-11-09)
- GitHub pre-release `test-perf-tracking-20261109` (tag at f3cc24d, branch orchestrate/perf-tracking-itemlogic): https://github.com/developer-az/One-Trick-Client/releases/tag/test-perf-tracking-20261109
- Assets:
  - `One.Trick.1.7.0-test-perf-tracking-20261109.zip`: electron-builder zip target from a scratch config identical to package.json build, minus the ffmpeg extraResource (user chose no ffmpeg download; auto-clip unavailable). Keyhook built locally with MSYS2 gcc. Unsigned.
  - `OneTrickRecorder-test-perf-tracking-20261109.zip`: Node 24 SEA of scripts/perf/record-live-client.mjs (bundled unchanged; glue sets the out dir to the exe folder and wraps top-level await) plus `Record-Match.cmd` (runs it, then pauses). Unsigned.
- Smoke tests on this laptop against the mock: the packaged app detected the match (2 overlay windows with content, latency in the debug log); the recorder exe and the .cmd recorded, anonymized, saved next to themselves and printed SAVED.
- Tag deliberately not `v*`, so the release workflow did not run.

### 2026-11-09 Phase 3 I1a (purchase planner)
- Added `src/logic/purchasePlan.ts`: remaining cost after owned components (multiset), buy full / best affordable component / save / no free slot, gold from the Data Dragon snapshot only.
- Acceptance test `verify_purchase_plan.ts` written first and frozen (30 checks). A diff review found the planner suggesting components of already-owned items; test 3b added, fixed by Pi.
- Pi runs: I1a done in 37 s; fix done in 33 s (deepseek-v4.1-flash-1017-fast, thinking high).
- Checks: verify_purchase_plan 30/30, tsc app 0, eslint 0. Not yet wired into the HUD (I1b).

### 2026-11-09 Phase 3 I1b (buy rail wiring)
- `buyRailLine` (overlayLogic.ts) turns the purchase plan into one rail line: "Buy now · 2,800g", "Part · 1,050g", "Need 1,850g", "No free slot"; null without catalog, gold or a next item.
- OverlayApp.tsx: prices from the loaded catalog (useSyncExternalStore); the affordable component's icon leads the rail; text line under the icons. Off in ARAM/Mayhem.
- Test `verify_buy_rail.ts` written first, frozen. Pi run: done in 33 s.
- Checks: verify_buy_rail, verify_purchase_plan, verify_overlay_cues, verify_build_boot_slot pass; tsc app 0; eslint 0. Not yet viewed in the running overlay. Nothing committed.

### 2026-11-09 I1 look-check, unknown-gold fix, I2 survey
- Look-check in the running overlay (CDP, scratch copy of the mock with switchable gold/items): all four rail states fit (rail 202 px, 11 px text, scrollWidth == clientWidth). Screenshots in the session scratchpad `otc/rail/`.
- Fix: `buildOverlayPayload` sent unknown gold as 0; now null (`electron/game-monitor.ts`, `OverlayLocalPlayer.currentGold: number | null`). Test `verify_overlay_gold.ts` (13 checks). Pi reported BLOCKED on one assertion that was the orchestrator's mistake (640 g affords a Long Sword); the test was corrected by the orchestrator, code unchanged. Pi run: blocked in 68 s, then verified.
- Open: 50 g fingerprint step can lag the rail; component icon alt text.
- I2: survey-only Pi run (48 s, no files changed); steps I2.1-I2.5 written to PLAN.md. I2.1 (catalog regeneration) waits for the user's yes.
- Checks: verify_overlay_gold, verify_game_monitor, verify_buy_rail, verify_overlay_cues, verify_purchase_plan pass; tsc app + electron 0; eslint 0. Nothing committed.

### 2026-11-09 Catalog snapshot regenerated (I2.1, data only)
- **Catalog patch now 16.22.1** (was 16.20.1). `npm run catalog:generate`, user-approved. Old files kept in the session scratchpad `otc/cat-old/`.
- Schema identical in every file. Items 870 -> 863, 2 price changes (3008, 3168: 1,000 -> 1,100), 1 map flag (4641). Champions: 108 role lists changed. Recommendations 323 -> 297, nearly all changed: the committed snapshot predated the generator fix in e316881 (it had one identical situational list for all 323 rows).
- Full suite: 43/44 verify scripts pass; `verify_global_hotkeys.ts` fails as at baseline (now: exe present, hook sees no PageUp/PageDown in this session). No planner test touched by a price change. Typechecks app/electron/node 0.
- `npm run lint` fails with 3 errors that predate this step, from Phase 2 commit f3cc24d (gameState.ts:551, verify_game_state.ts:363, verify_signal_inventory.ts:133). To fix in the next coder round.
- Still to do in I2.1: add item stats and the anti-heal flag to the generator and regenerate. Nothing committed.

### 2026-11-09 I2.1 catalog stats + anti-heal (second regeneration)
- **Catalog patch: 16.22.1.** User decision: keep the regenerated roles and recommendations.
- `src/catalog/types.ts`, `src/catalog/buildCatalog.ts`: `CatalogItem.stats` and `CatalogItem.antiHeal`, mappers `itemStatsFromDDragon`, `antiHealFromDescription`. Second `npm run catalog:generate`: only those fields added to items.json (184.7 KB -> 220.1 KB); other files identical apart from the manifest timestamp.
- Lint: the 3 Phase 2 errors are fixed (gameState.ts by Pi; verify_game_state.ts and verify_signal_inventory.ts by the orchestrator, test files).
- New standing rule from the user: full lint + full verify suite at every phase boundary.
- Pi run: done in 70 s. Checks: full suite 44/45 (verify_global_hotkeys fails as at baseline), tsc app/electron/node 0, `npm run lint` 0.
- Carry into I2.2: live API and cached catalogs lack the new fields until the website is redeployed; engine treats missing as unknown. Nothing committed.

### 2026-11-09 Overlay vanishes mid-match: cause reproduced and fixed
- User report from the pre-release match: overlay gone at ~10 min, app still in match, hotkey and off/on useless; has happened on earlier versions too. Recording saved at `recordings/20261109-190517-CLASSIC-Pyke.jsonl` (ignored by git).
- Replay of the recording through the app (scratch replay server, CDP watch): no exception, overlay kept drawing. So not data.
- Reproduced with a topmost stand-in window: overlay windows keep WS_EX_TOPMOST but sit below it; `assertAlwaysOnTop` only acted on a lost flag.
- Fix (Pi, 117 s): `shouldRaiseOverlay`/`shouldRebuildOverlay` in overlay-bounds.ts, `raiseOverlayIfDue`/`rebuildOverlayIfStuck` in overlay-window.ts called from `ensureOverlayShown`, new `electron/overlay-log.ts` (`%APPDATA%/One Trick/logs/overlay.log`), buy rail floors fractional gold.
- Evidence: stand-in run after the fix shows both overlay windows above the stand-in at +5 s and +32 s. Full suite 46/46 (verify_global_hotkeys passed this run), tsc x3 0, lint 0.
- Not verified: behaviour over the real League window; cost of `moveTop()` every 3 s in a real game. Exclusive-fullscreen League cannot be overlaid by any window; `match-start windowMode=` is logged to tell.
- Open: recorder anonymizer replaced one champion name with PlayerN (name collision); 50 g rail lag; T3 fixtures from the recording.
- 2026-11-09 later: user reports the overlay still vanished at ~10 min on pre-release 2, but `logs/overlay.log` does not exist on their PC, so the new code never ran there (the build logs at match start; packaged smoke test here wrote the file). Most likely the installed One Trick held the single-instance lock, or the first test folder was used. Neither test match says anything about the fix.
- Pre-release 3 (`test-overlay-fix-3-20261109`): same fix plus self-identification: `electron/build-info-logic.ts`, window title "One Trick · TEST BUILD overlay-fix-3" (from `testBuildLabel` in the packaged package.json via electron-builder extraMetadata), `app-start` line in overlay.log with the exe path, error box when another One Trick already holds the lock. Test `verify_build_info.ts` (13 checks). Packaged smoke test: title, app-start line and second-launch error box all seen.
- 2026-11-09 night: user's `overlay.log` from two real matches on build 3 (and build 2). The app kept both windows visible and raised them every 3-5 s from match start to match end: no hide, no rebuild, no renderer exit. Yet the user saw the overlay vanish at ~10 min. So the windows stop being presented while the app sees nothing wrong; the on-top fix is real but is not this bug. The earlier claim that the user ran the old app was wrong.
- Not reproducible here: packaged build 3 on the replayed match for 13 min real time, both overlay pages at 60 rAF/s, visible, topmost throughout (first attempt was stopped by the harness for low memory at 103 s; rerun completed). Per-module content check over the whole recording: every module has content all match.
- Untested leads: `overlayHideFromCapture` (WDA_EXCLUDEFROMCAPTURE, on by default) interacting with a capture/recording tool on the user's PC; GPU/DWM presentation over the real game. Next: user tries with "Hide from recordings" off; if still failing, a diagnostic build logging per-window OS state and a renderer paint heartbeat.
- Pre-release 2: https://github.com/developer-az/One-Trick-Client/releases/tag/test-overlay-fix-20261109 (prerelease, tag at d5fcb83, branch pushed). Packaged exe smoke-tested with the replayed match and the stand-in window: overlay in front at +6 s and +24 s, stand-in kept focus. Codex review pending.

### 2026-11-10 Overlay vanish: root cause NOT found; health log, auto-repair and a real off/on recovery added
- User: main (v1.7.0) no longer loses the overlay; the test builds do, at ~10 min, and off/on does not bring it back.
- Read the whole main...HEAD diff for the match path. In a normal match the only window-affecting differences from main are the 3 s `moveTop()` raise (builds 2-3) and the page-visibility gate on the 1 Hz clock; build 1 had neither a raise nor any other window change, yet also failed. No code path found that leaves a window shown but undrawn.
- Ruled out here, with the packaged build 3 and the recorded match:
  - Covered by a topmost fullscreen window: pages stay `visible`, keep producing frames (1 s probe), and are raised back within 5 s.
  - `moveTop()` on a 125 % display: positions and sizes unchanged after 90 s of raises.
  - Match data and page content at 9:20-13:00: fine (earlier 13 min run).
  - Same Electron (39.2.3) and packaging as the release, minus ffmpeg.
- Added (not a root-cause fix; it makes the next real match conclusive and gives a way back):
  - Paint heartbeat: each overlay page reports every 5 s whether an animation frame arrived and its Page Visibility state (`overlay-heartbeat` IPC, `reportOverlayHeartbeat` in preload).
  - `checkOverlayHealth` (overlay-window.ts, called from `ensureOverlayShown`): per window visible / minimized / on top / bounds vs slot / ms since heartbeat and since last frame; `health` lines in overlay.log on every change and once a minute. Pure rules in overlay-bounds.ts (`overlayWindowFaults`, `shouldRebuildStalledOverlay`).
  - Repairs: minimized window restored without focus; moved window put back (once a minute at most); shown-but-not-drawing HUD rebuilt after 25 s (max 2 per match, 60 s apart).
  - Turning the overlay off and on during a match now always rebuilds the windows (`rebuild reason=user-unhide`), instead of re-showing the same ones.
  - `child-process-gone` (GPU and others) is written to overlay.log.
- Evidence: dev run on the replay. Off/on: new windows with content within 5 s. Simulated stall (animation frames stopped in both pages): `faults=no-frames` at 25 s, rebuilt, healthy after, no further rebuilds in 70 s. verify_overlay_health 38 checks; full suite 47/47; tsc x3 0; lint 0.
- Limits: the heartbeat proves frames are produced, not that Windows presents them. If the next failing match shows `faults=none` throughout, the windows are being covered or not composited by the OS (League display mode, capture exclusion), and the app cannot see that without a native probe.
- Needed from the League PC after the next failing match: `%APPDATA%\One Trick\logs\overlay.log`, League's display mode, and one match on the installed v1.7.0 the same day to confirm it really stays up there. Nothing committed; no new pre-release built.

### 2026-11-10 Overlay vanish: Step 2 — single-window remake (implemented by Biscuit directly, at the user's direction)
- Step 1 closed: the user had already played a match with "Hide from recordings" OFF — same vanish at ~10 min. Capture exclusion (`setContentProtection` / WDA_EXCLUDEFROMCAPTURE) is exonerated.
- Decision (user): the multi-window lifecycle itself is replaced, and the work is done by Biscuit personally, not the Claude workflow, to preserve workflow usage for professional projects.
- What changed (electron/overlay-window.ts, electron/overlay-bounds.ts, electron/game-monitor.ts):
  - Locked mode is now ONE BrowserWindow covering the whole display (`applyLockedBounds`); creation options byte-for-byte the old ones. The page already lays modules out in display coordinates, so the one slot (`currentSlot`) reports origin (0, 0) and the union of the old clusters' module/sticker ids; compact/align pseudo-slot unchanged. OverlayApp.tsx needed no changes.
  - Deleted: extra per-cluster windows (`createLayeredWindow`, `applyLockedClusters`, `applyClusterToWindow`), per-window slot sets (`emptySlots`/`emptyGrace` → one aggregate `pageHasContent` with the same 8 s grace), destroy-after-user-hide (P1d) and the rebuild-on-unhide behaviour, the 3 s raise loop, the invisible-rebuild watchdog, `checkOverlayHealth` and its repairs, and the pure rules `shouldRaiseOverlay`/`shouldRebuildOverlay`/`shouldRebuildStalledOverlay` (+ their constants). `healOverlayWindows` now only reloads a crashed renderer.
  - Kept as measurement, not intervention: the page paint heartbeat and a once-a-minute `health` line in overlay.log (faults computed for the log only — nothing acts on them), plus all other lifecycle log lines.
  - Destroy paths that remain, by design: match end (game-monitor), app quit and overlay-disable (main), settings changes never destroy.
- Tests: rewritten `verify_overlay_health.ts` (46 checks, wired into `verify:release` as verify:overlay-health) pins the structure — exactly one `new BrowserWindow(`, deleted names absent, `destroyOverlay` never called inside overlay-window.ts, the wanted-rule and log format. It failed in 24 places on the pre-remake code before the change. `verify_overlay_health.ts` was rewritten in place: its rule tests covered deleted functions, the log-format checks remain, and the structural assertions live there now.
- Gates (Linux dev VM, 2026-11-10): lint 0, `tsc -b` + vite build 0, electron tsc 0, `tsc --noEmit` 0; verify suite identical to the pre-change baseline on this machine (only verify:electron-paths and verify:clipper-lifecycle fail, as they did before the change — both environment-specific here).
- Known tradeoff, accepted with a gate: a display-sized transparent window is the DWM cost the old comment warned about. The page keeps 12 FPS shown / 1 FPS hidden paint budgets, and modules paint in small rects, but the Phase 1 perf comparison was NOT re-run on Windows — if the packaged test build costs FPS in a real match, that is measured feedback, not a surprise.
- Not verified: anything in a real match (no League on the dev VM). `scripts/package-test-build.ps1` packages test-single-window-20261110 in one command on the laptop (zip, no ffmpeg, label `single-window` via extraMetadata). Acceptance unchanged: one full match; overlay.log shows exactly one `created` line between match-start and match-end and no `destroy` in between. If a single static window still vanishes with frames flowing, the cause is environmental (Step 3: MPO / fullscreen-optimizations toggles) and no more app builds follow.

### 2026-11-11 Overlay vanish: Step 2 FAILED its acceptance match; native-overlay remake (implemented by Biscuit directly, at the user's direction)
- Step 2 verdict: the single-window build (test-single-window-20261110, published 2026-11-11) still disappears in a real match. One static window, no destroy/rebuild code left, frames flowing — the cause is environmental (Windows/DWM presentation), not app code. Step 3 (MPO off via OverlayTestMode=5, fullscreen optimizations off for League) runs in parallel on the PC.
- User direction: "remake the app" — persistent enough, other models haven't fixed it. Biscuit's position, delivered to the user: a same-stack remake would fail the same way; the remake must change what presents the pixels.
- What changed (new: native/presenter/presenter.c, scripts/build-presenter.mjs, electron/overlay-presenter.ts, verify_native_presenter.ts; edited: electron/overlay-window.ts, electron/paths.ts, package.json, scripts/package-test-build.ps1, verify_overlay_health.ts):
  - Locked mode renders the same OverlayApp offscreen (offscreen: true, 12 fps budget) and forwards paint bitmaps over named pipe \\.\pipe\onetrick-presenter to onetrick-presenter.exe, a plain Win32 layered window (UpdateLayeredWindow, ULW_ALPHA, WS_EX_TOPMOST/TOOLWINDOW/NOACTIVATE, WS_EX_TRANSPARENT for click-through, WDA_EXCLUDEFROMCAPTURE for hide-from-capture). Chromium owns no on-screen window in this backend.
  - Backend switch: overlayBackend setting ('electron' default in source; packaged test builds stamp 'native' via extraMetadata.overlayBackend; Windows-only). All overlay-window.ts exports keep their names; unlocked/align always use the Electron window (presenter is paint-only). The lock/unlock switch hides the Electron panel instead of destroying it, so destroyOverlay stays the one destroy site (three destroys inside it: presenter, offscreen, Electron).
  - Presenter lifecycle: exits when the pipe breaks; driver respawns (max 2/match) with full-frame re-send; presenter.log is the acceptance evidence (created/destroy, frame counts).
  - Protocol: HELLO/FRAME/SHOW/HIDE/CLICKTHROUGH/BOUNDS/CAPTURE/PING, READY/PONG/ERROR; version 1; dirty-rect BGRA frames; driver-side codec exported and unit-tested (split-chunk round-trip, oversize refusal).- Tests: verify_native_presenter.ts (60 checks, wired into verify:release) — presenter structure, protocol round-trip, backend defaults, packaging. Failed on the pre-remake tree (45d7248, exit 1, missing driver module) before the change. verify_overlay_health.ts destroy check re-scoped to the destroyOverlay function (was: one `.destroy()` in the whole file); 49 checks.
- Gates (Linux dev VM, 2026-11-11): lint 0, tsc x3 0, vite build 0, presenter cross-compiles with MinGW (PE32+ GUI exe, 18 KB); verify suite at baseline parity — everything passes except verify:clipper-lifecycle's 4 ffmpeg checks, proven identical at the 45d7248 baseline (no ffmpeg on this VM, pre-existing environment failure). verify:electron-paths passes now (it failed at the Step 2 baseline).
- Not verified: anything on Windows (no League on the dev VM). scripts/package-test-build.ps1 now defaults to the native build (Label native-overlay, Tag test-native-overlay-20261111, Backend native). Acceptance: one full match; presenter.log shows exactly one 'created' line between match-start and match-end, no 'destroy' in between, frames flowing. If a plain layered window still vanishes, the cause is below the app entirely (driver/DWM on this PC) and no further app code is the answer.

### 2026-11-21 Overlay vanish: diagnosis from evidence (branch fix/overlay-aram-identity @ 8664a3c = v1.7.1-test.18)
Written before any presentation-code change.
- **No real-match evidence for the native presenter exists on this PC.** Every `presenter.log` session (2026-11-15/16, ~35 runs) matches `scripts/smoke-native-overlay.mjs`: presenter #1 is `taskkill /F`'d about 5 s after READY (the dev-run `%APPDATA%\Electron\logs\overlay.log` shows `presenter-down reason=pipe-closed` then `presenter-exited code=1`), then the supervised respawn. The packaged app's `%APPDATA%\One Trick\logs\overlay.log` has no match since 2026-11-10 (only `app-start` lines for test.4 and test.9). So the native overlay has never been match-tested with logs we can see.
- **League is not installed on this PC.** `C:\Riot Games\League of Legends` is gone; only AppCompat entries remain. It is a hybrid-GPU laptop (Intel UHD drives the 1920x1080 60 Hz panel, RTX 4050 renders). Which PC the failing matches ran on is the first open question.
- **Windows toggles on this PC:** MPO off (`HKLM\SOFTWARE\Microsoft\Windows\Dwm\OverlayTestMode=5`, last boot 2026-11-21 20:33, so it is in effect). Fullscreen optimizations disabled for `League of Legends.exe` and `LeagueClientUxRender.exe` (`DISABLEDXMAXIMIZEDWINDOWEDMODE`). **"Optimizations for windowed games" is ON** (`HKCU\Software\Microsoft\DirectX\UserGpuPreferences DirectXUserGlobalSettings=SwapEffectUpgradeEnable=1`).
- **The acceptance evidence was too weak to decide anything.** The driver `kill()`s the presenter at match end, so the presenter never logs `destroy` (zero destroy lines is trivially true). `frames=` is logged only every 600 frames, so a static HUD can play a whole match without one. Nothing in the log says whether the window was above League or whether League was exclusive fullscreen.
- **What the older real-match logs prove (2026-11-09/11, Electron backend):** the windows stayed visible and topmost, and the app raised them every 3-5 s; frames flowed (heartbeat); the single static window also vanished. So the app believed it was shown and drawing while the user saw nothing. That rules out app lifecycle code. It leaves (a) League above us in z-order, (b) League in true exclusive fullscreen, or (c) DWM not compositing our window over a flip-model game (MPO / independent flip). The last build that stayed up was v1.7.0 (user report, 2026-11-10); its z-order code (`setAlwaysOnTop(true,'screen-saver')`, `showInactive`) is the same as now, so the code diff does not explain it.
- **Interaction of the toggles (a likely contributor, not yet proven):** with fullscreen optimizations disabled, League set to *Fullscreen* becomes true exclusive fullscreen, which no window can draw over. With "Optimizations for windowed games" on, League in *Borderless* uses flip-model presentation, which lets DWM stop compositing other windows over it. The safe combination is League in Borderless, MPO off, and windowed-game optimizations off for League.
- **Next step (diagnostic, not a fix):** the presenter logs a `state` line on every change and once a minute: shown/visible/topmost, `fgAbove` (League above us in z-order), `fgExe`, `fgFull` (foreground covers its monitor), `quns` (`SHQueryUserNotificationState`, 3 = exclusive D3D fullscreen), and frames. The driver closes the pipe before killing the presenter, so a match ends with exactly one `destroy`. One real match then tells (a), (b) and (c) apart at the moment the overlay disappears.
- **Diagnostic build 1.7.1-test.19 (label `overlay-diag-19`, native backend)**, local only, not published: `release/One.Trick.1.7.1-test.19.zip`. Changes: `native/presenter/presenter.c` (`state` line, diagnostic only), `electron/overlay-presenter.ts` (`destroy()` closes the pipe and kills the presenter only if it is still alive after 1.5 s). Checks on this PC: presenter builds (2 old `-Wcast-function-type` warnings, none new); `verify:presenter-live` all ok (leak run stable); `smoke:native-overlay` 8/8 at 125 % DPI with `state` lines in presenter.log; verify native_presenter / overlay_health / overlay_fallback / presenter_supervisor / destroyed_guards pass; tsc app/electron/node 0; eslint on the changed TS file 0.
- User answer 2026-11-21: League runs on **a different PC**. This PC's toggles say nothing about that one.
- **Phase 1 gate: OPEN.** It needs one full ranked match on the League PC with this build: an overlay that stays up to the end, and presenter.log showing one `created`, `state` lines with frames rising, and `destroy` only after the match ends. If it vanishes, the `state` line at that time decides the mechanism: `fgAbove=1` = z-order; `quns=3` = exclusive fullscreen; `shown=1 visible=1 topmost=1 fgAbove=0 quns!=3` with frames rising = DWM not compositing (flip model / MPO).
- 2026-11-21 user decisions: test pre-releases may be published without asking each time; his normal games are the gate (no dedicated test match).
- Found: every real-match overlay.log from the League PC (2026-11-09/10) says `windowMode=null`. game.cfg was never found there, so the display mode was never known. `league-settings.ts` now also reads Riot's `product_settings.yaml` install path.
- **test.20 (`overlay-diag-20`) published as a pre-release:** https://github.com/developer-az/One-Trick-Client/releases/tag/test-overlay-diag-20 (tag at 8664a3c; the zip includes the uncommitted branch changes). New: `electron/environment.ts` reads MPO (`OverlayTestMode`) and Windows 11 windowed-game optimizations (`SwapEffectUpgradeEnable`) via `reg query`; `src/app/overlayAdvice.ts` turns Fullscreen / unknown mode / optimizations on / MPO on into problem + fix text, shown on the Performance view; game-monitor writes an `environment` line to overlay.log at match start. Test `verify_overlay_environment.ts` (13 checks, added to verify:release). Real-registry run on this PC: `mpoOff=true windowedGameOptimizations=true windowMode=null`, matching the manual reads.
- Suite: verify:release passes except 3 suites that fail identically on a clean 8664a3c worktree (pre-existing): verify_clipper_lifecycle (ffmpeg installed here), verify_purchase_order (4 sell-boots checks), verify_app_density (StatsView mb-5/gap-5). Lint 0 errors, 1 old warning (OverlayApp.tsx:1289). The Performance-view callout has not been looked at rendered.
- Phase 1 gate still OPEN: waiting on logs from a normal game (Google Drive).

## 2026-11-22 — Phase 1 accepted on user report; Phase 2 OCR worker; Phase 4 live builds (test.21, test.22)

- **Phase 1**: Anthony reports the overlay now stays up with overlay-diag-20 (occasional ~1 s blink, no logs yet). Accepted as good enough to move on; the strict presenter.log gate (1 `created`, 0 `destroy`, frames flowing) is still unproven on the League PC. The blink is the next thing to read once logs arrive (look for presenter `state` lines with covered=1/fgAbove=1 or a quns change at that time).
- **PR #47 salvage**: nothing taken. test.18 already supersedes each piece: Map12 sensing (`detectMayhemMode`), the OCR null/[] fix (reads now carry fresh/valid/decision), Riot ID in status (`formatRiotId`). `riot-identity.ts` (puuid store) is left for Phase 3 if needed.
- **Phase 2 OCR latency**: root cause of the p50 374 / p95 476 ms was a cold `powershell -File` per read (process start + Add-Type compile + WinRT load). `electron/ps-worker.ts` keeps one `powershell -Command -` host and runs the same script per request (end marker + exit code; serialized; a timeout kills the host and the next call starts fresh). Measured on dev PC: cold 560-610 ms, warm 42-44 ms, identical output. Script unchanged. `verify_ps_worker.ts` (10 checks). `verify_mayhem_capture_gating` source check updated for the new `PanelScale:` param. Published as test-mayhem-ocr-21.
- **Phase 4 builds source**: OP.GG MCP (`https://mcp-api.op.gg/mcp`, `lol_get_champion_analysis`) chosen: answers from this PC in ~250-800 ms, has items/boots/runes/skills/pick rates, ARAM mode, ARAM augments, and the patch (`trends.pick.version`). u.gg answers too (patches.json) but needs undocumented stats endpoints; CommunityDragon has no builds (used for the current patch only). Response is text in a "class X: fields" + constructor format, parsed in `electron/live-builds.ts`. Only pick_rate/play requested (D1). Disk cache per patch under userData/live-builds/<patch>/. IPC `live-build-get`; Loadout shows "Popular build this patch" with source and patch. Gate green: Pyke (doctrine) / Ornn Top / Miss Fortune Bot resolve live on 16.23; Pyke doctrine core 3179,3142 vs live 3179,3142,3814 (2 shared). `verify_live_builds.ts` offline in verify:release, `--live` for the network gate.
- **Phase 3**: blocked on Anthony registering a personal API key (steps given in chat). Nothing built yet.
- Not done: visual check of the Loadout card; Mayhem HUD-stays-up work (needs ARAM game logs).

## 2026-11-22 — Phase 3 Riot identity (test.23)

- Anthony already had an approved personal key. On the dev PC he pasted it into `%APPDATA%\One Trick\riot-api-key.txt` (outside the repo); the app imports it once into `riot-key.bin` (Electron safeStorage / DPAPI) and empties the txt. On the League PC the key goes into Profile → Riot API → Save key.
- `electron/riot-api.ts`: identity from the LCU (puuid, Riot ID, `/riotclient/region-locale`) remembered in `riot-identity.json`; account-v1 by-riot-id only when the puuid is unknown → summoner-v4 → league-v4 → match-v5 ids (20). Sliding-window limiter per host at 18/1 s and 95/120 s (personal limits 20/100). Memory + disk cache (`riot-cache.json`): account 24 h, summoner 1 h, league / match ids 10 min; 429/5xx serve stale. 401/403 → `invalid-key`. Key only in the X-Riot-Token header; errors carry the endpoint path, never the key.
- No key → state `no-key`, the card says "One Trick uses your League client only." D1: rank shows tier/division/LP and game counts, no win rate.
- Profile: the disabled placeholder card is now live (save/remove key, status line); Level and Rank facts fill when linked; the header shows the Riot ID.
- `verify_riot_api.ts` (9 checks: routes, key format, both rate windows, no-key fallback; `--live` confirmed the key: na1 champion-rotations 200, account-v1 unknown ID 404). Live identity lookup not run: no League client or stored Riot ID on the dev PC. First real check is the League PC with test.23.

## 2026-11-22 — verify:release fully green (test.24)

The three suites that failed on clean test.18 are fixed; `npm run verify:release` now exits 0 end to end.
- clipper_lifecycle: `findFfmpeg` treated `ONETRICK_FFMPEG` as one candidate among many, so a bad override fell back to a real ffmpeg on PCs that have one. An explicit override is now the only candidate.
- purchase_order (sell boots): `supportBuildMaturity` counted only on-path legendaries, so a full inventory of finished off-path items (an off-path legendary, a finished support item) never read as near complete and the cue said keep boots forever. Finished off-path items (legendary, or support quest item past Atlas/Compass/Bounty, excluding boots) now count. All 7 build/buy suites pass.
- app_density: StatsView `mb-5`/`gap-5` → `mb-4`/`gap-4` (16px scale).

## 2026-11-22 — Recent matches on Profile (test.25)

- `riot-api.ts`: the 10 newest match ids get match-v5 detail, reduced to the player's own line (`matchSummaryFor`: champion, K/D/A, win, queue label, CS, minutes, end time) before caching; cached a year (finished matches never change). `riotGet` gained an optional `reduce` so big payloads never hit riot-cache.json. Rows are the player's own results only (D1: no aggregate rate shown).
- Profile: "Recent matches" card when linked. verify_riot_api 13 checks; verify:release green.

## 2026-11-22 — ARAM build on the Mayhem page (test.26)

- `LiveBuildCard` moved to `src/app/LiveBuildCard.tsx` (mode prop). Loadout uses ranked; the Mayhem page shows "Popular ARAM build this patch" for the focus champion (OP.GG `game_mode: aram`; position is required by the tool, Mid is sent and ignored for ARAM). Live: Pyke ARAM Serrated Dirk > Hubris > Axiom Arc > Edge of Night, Brand Blackfire Torch > Liandry's > Rylai's, patch 16.23. verify:release green.

## 2026-11-22 — test.27: Mayhem first augment + stuck "Cannot verify"
- User report (test.26 game): first augment ("level 1") never read; "Cannot verify… press PageDown" stayed all game; mid-game panel weak. No logs.
- Cause 1: auto OCR gated on level >= 3 for pick 1, and pick phase said "die to open" while alive at spawn. Fix: `MAYHEM_AUGMENT_LEVELS = [1,7,11,15]` (pick 1 is level-free), discovery levels reuse it, `computeMayhemPickPhase` opens the window alive for pick 1 while gameTime < 120 s (900 ms poll).
- Cause 2: any fresh frame with no card geometry set `mayhemUnverified`; only an accepted roll cleared it. Fix: `mayhemUnverifiedAfterRead` (monitor.ts) raises it only on card-shaped or black frames and clears it on a plain gameplay frame; used by auto and manual paths in game-monitor.ts.
- Tests updated: verify_mayhem_monitor (level-1 semantics + 6 warning checks), verify_augment_schedule (spawn checks). verify:release green. Published test-mayhem-spawn-27; test-aram-build-26 marked superseded.
- Still open: "mid-game didn't work well" needs logs (frame reasons in mayhem frame log lines).

## 2026-11-22 - Source history for prereleases test.19-27

- Those builds were packaged from uncommitted working-tree changes, so all nine `test-*` tags originally pointed at `8664a3c` (v1.7.1-test.18) - a commit without their code. Commit `ce5d658` now records the full cumulative change; the tags were force-moved to it locally and on origin so each release points at source that contains its feature.
- Caveat: all nine tags share that one cumulative commit; there are no per-round snapshots. The published zip is still the exact artifact for a round - use the tag to find the code, not to reproduce that round's precise diff.
- `package.json` stays at `1.7.1-test.18`: `scripts/package-test-build.ps1` stamps the release version through `extraMetadata`, which is how each zip got its own version.

## 2026-11-23 - test.31: post-pick panel, items rail, picked augment, item gold

- User report (test.30): the roll is read now, but the panel stays after picking, the items/build rail disappears while the augment panel is up, and the app cannot tell which augment was taken or the owned total.
- Why the panel stuck: `mayhemAugmentHudShouldShow()` still saw the retained display ids, and the tick checked `show || hudVisible` before the purge branch, so `hudAction === 'purge'` was unreachable. The purge branch is now first; a retained roll can no longer veto the engine's purge.
- Why it never noticed the pick: after selection the crop has HUD/callout text, so the pipeline returns `unverified` and `observeMayhemPickScan` was skipped entirely. The pixel gate (`cardsVisible === false`) is positive evidence the roll is gone; two trusted cards-gone frames feed the counter and expire the HUD (`MAYHEM_CARDS_GONE_*` in monitor.ts). Fallback/foreign/black frames stay excluded.
- Which augment: the selection screen closes on a left-click. `mayhem-ocr.ps1` reports the cursor normalized to the offer band (`__OT_CURSOR__`), and `selection.ts` maps it to the 3/4 card columns. The click is recorded in `mayhem-owned.json` and shown as `Have n/4` on the panel. A cursor outside every card counts the pick without inventing an augment. Live Client `augments` (when a build exposes them) is folded in as authoritative and its shape is logged once per match (`mayhem-live-shape`).
- Items rail: `showBuy` and the locked-slot content test no longer require `!mayhemPanelActive`; the augment panel and the build/icons rail coexist.
- Item gold (Blitz/Porofessor/Hexgate method): every `playerlist` item carries `price` and `consumable`; `goldDiff.ts` sums held-item shop prices per team, excluding consumables and free trinkets. The rail shows `Items 24.1k vs 23.3k +800`. This is item gold, not total earned gold; unspent gold is not visible to any companion app.
- New `verify:mayhem-pick-selection` (cursor mapping, cards-gone expiry, pick count, fallback exclusion, OCR cursor parsing, ps1 marker, item gold) wired into `verify:release`. Frozen verifies untouched. `verify:release` exits 0.
- Published `test-mayhem-pick-items-31` from `3b4d4ef` on `fix/overlay-aram-identity`; the tag and branch point at that commit, so the source matches the zip.

## 2026-11-23 - Open: the native bottom HUD is not skinned

- User report: the custom HUD skins style the app rails but the bottom-centre area (health/mana bar + abilities + summoners/items) is only a transparent calibration frame, so it doesn't feel skinned.
- Diagnosis is written up for the next owner in `docs/ai/OPUS-MASTER-PROMPT.md`: `ChromeGameHud` draws `.chrome-frame-live` (1px outline + corner brackets, deliberately no fill); `hud-skins.css` targets `.ov-panel` / `.hud-overlay-panel` / `.hud-rail-card` only; `frames` is off by default.
- The master prompt asks for a static, non-interactive skin perimeter over the cluster, reusing `HudSkinOrnaments` and the `data-ov-skin` variables, with a readability gate (native bars/icons never obscured), geometry tests, screenshots and test.32.

## 2026-11-23 - test.32: the native bottom HUD is skinned

- Closes the item above. With `frames` on (default still off), live mode draws `GameHudSkin` (inside `ChromeGameHud.tsx`): a static perimeter around the bottom-centre cluster in the active skin, with a health/mana lip and caps, side plates, a divider and bottom lip, the `HudSkinOrnaments` corner set and a per-skin signature (gothic chrome crest, blood moon red rule and chamfers, arcane double hairline, ironclad rivet rail, warden rounded leaf plates, hunter range ticks, vanguard shield crest). Align mode still shows only the calibration guides; the ability box stays as a transparent anchor (`verify:overlay-handoff` measures it).
- Layout is pure (`src/overlay/gameHudSkin.ts`): the ability rect reproduces the frame math and reuses the existing `ability` calibration (no new calibration target). The health strip sits directly above it, and the surround is clamped to the game view and stopped short of the minimap. Every piece sits in the 10*s padding gutter, so none enters the cluster or health strip.
- Least-obscuring choices: no backing behind the bars or icons, and the frame centre is transparent. Ornament size is capped at the gutter, so the ornament scale setting tops out at that cap here. The health strip position is derived from the frame (92% wide, 20*s tall, 3*s above), not measured from a real match: **check it in game**, and nudge the ability calibration if it sits off.
- CSS in `src/overlay/game-hud-skin.css`: static only (no animation/transition/filter/blur/backdrop/box-shadow), pointer-events none. Frames hint now reads "Game HUD + minimap frame/skin".
- New `verify:game-hud-skin` (2850 checks: frame-math parity, 108 resolution/HUD/map combos incl. letterbox + pillarbox, no piece in the cluster interior, minimap clearance, source/CSS/wiring guards), wired into `verify:release` after `verify:hud-geometry`. Frozen verifies untouched. `verify:release` exits 0, and `verify:hud-skins`, `verify:hud-skins-dom`, `verify:overlay-handoff`, `verify:ranked` and `verify:mayhem-pick-selection` all pass.
- Screenshots: `node scripts/game-hud-skin-shots.mjs <dir>` (after `npm run build`) renders the real component over a synthetic HUD and fails if any native centre pixel changes. The saved set is in `docs/ai/screenshots/test32/`: all 7 skins at 1920x1080 (`sheet-1080.png` crops them), plus gothic/bloodmoon/vanguard at 1366x768, 2560x1440 and 3440x1440. All 16 renders left the native pixels unchanged.
- Not done: a game-HUD preview card in HUD Skin settings (optional in the brief).
## 2026-11-23 - test.34: "Could not verify" was the card-pixel gate, not the HUD

- Report: after test.31 every augment roll settled `Could not verify - press PageDown to retry`. Answer to "is it fixed in test.32/33": no. Those builds only touched the HUD skin; the reader was last changed by test.31.
- Root cause (real captures, four screenshots): the live card body samples as dark indigo - 9,18,38 / 8,15,41 / 2,11,28. `Test-CardBody` accepted only teal (blue <= 36, low chroma), gold, or neutral grey (all channels >= 25). Indigo matched none, so every slot read body=0, the adapter emitted CARDS_VISIBLE 0, and the pipeline refused the roll. Test.31 made that flag load-bearing (the partial-roll branch and the cards-gone purge both need it), which is why the failure became universal on this patch.
- Second, independent cause of the same symptom: the rim probe sampled two fixed rows (0.303h, 0.312h) tuned to an older card size. Current cards are taller, so the glowing border fell outside the probe. It now also scans the upper third (0.20-0.36) and accepts only a bright edge directly above a dark interior, which a plain background cannot fake.
- Fix: `Test-CardIndigo` (blue-dominant, low red) plus "indigo counts as a body only beside a glowing border". Indigo is deliberately kept out of the gap rule: this map's background behind the cards is the same indigo, so letting it satisfy the gap patch would cancel every real card out. A uniform indigo screen therefore still proves nothing.
- Data: `npm run sync:mayhem` -> bundle 26.22 to 26.23, 213 to 225 augments. `Flashy` (seen live, "Your Flash has 3 charges") is still absent upstream - the closest row is a placeholder `Flash 2` - so an unknown title rides the partial-roll path as a placeholder rather than being guessed into a name.
- New `verify:mayhem-indigo-cards`: predicate table on the logged RGBs, and the shipped `Get-CardSlotEvidence` on synthetic bitmaps (indigo cards over an indigo background => body>=8, gap=0, rim>=7; the same art without a border => body=0), plus source guards that indigo never reaches the gap rule. Wired into `verify:release` after `verify:mayhem-dark-cards`. `verify:release` exits 0 and the ten mayhem verifies pass.
- Diagnosis tool kept: `npx --yes tsx scripts/mayhem-diagnose.ts <png>` runs the shipped capture script on one image and prints the markers, parsed evidence and the classifier verdict.
- No ranked/presenter/Mayhem-pick behaviour changed; the HUD skin from test.33 is unchanged.
- Published `test-mayhem-indigo-34` from this commit.

## 2026-11-23 - test.35: the card look varies per selection, so the reader keys on structure

- Research (LoL wiki ARAM: Mayhem, Riot support, arammayhem.com): the selection screen is not one fixed picture.
  - The tier is random every screen and the whole game shares it: **Silver / Gold / Prismatic**, each with its own card art. A roll can therefore be grey, gold or indigo depending on the draw.
  - **Maestro** (Jhin) headliners hand out **four** offerings instead of three (both the ps1 slot set and `pipeline.ts` already model 3- and 4-column rows).
  - **Command Line** converts rerolls into Hacked Rerolls that upgrade one offering a tier, so one screen can mix rarities side by side.
  - **HEARTSTEEL** stamps a sticker/decoration on some cards, **Debonair Zed** adds gold/hat text to the card, **Pentakill** has its own three-choice screen, and **K/DA** / **Superfans** grant an extra selection.
- So colour cannot be the key: test.34's indigo window only covered this patch's prismatic art. The body rule is now **structure**: a dark interior under a glowing top border, either at the known indigo window, or (any other dark art) additionally clearly darker than the gaps between the cards. Bright art (gold) still proves itself through its own colour window. Indigo stays out of the gap rule, so this map's indigo background cannot cancel real cards.
- `verify:mayhem-indigo-cards` now covers all of it: prismatic (indigo), silver (neutral), gold (bright) and a four-card Maestro screen on the shipped `Get-CardSlotEvidence`, plus two negatives (uniform indigo band, borderless plates => body 0). 19 slot rows. All four real captures still report CARDS_VISIBLE 1 with clean gaps.
- Bundle stays at 26.23 (225 augments). `verify:release` exits 0 and the mayhem verifies pass.
- Published `test-mayhem-rare-cards-35`.


## 2026-11-22 - test.36: card variants (stickers, mixed rarity, extra selections)

- **Sticker trim** (`Get-CardSlotEvidence`, `electron/scripts/mayhem-ocr.ps1`): up to 3 of the 9 body samples that are bright (luma > 95) are dropped, and the rest are re-tested with the neutral-art mean (`Test-CardMean`). That reading counts only inside the glowing-border block. Gap samples are never trimmed, and the gap-contrast rule keeps the **untrimmed** mean.
- Why, measured: most stickered cards already passed through `darkHits >= 5` plus gap contrast. The one case that failed was silver art on a background of nearly the same luma: the old probe gave body=7 (refused) and the new one gives body=8 (`pos-sticker-lowcontrast`, red before and green after the change).
- Regression found and fixed in-session: the first draft also fed the trimmed mean into the contrast rule, which flipped 4 real non-game screenshots (OneDrive\Pictures\Screenshots, e.g. a purple web hero) to CARDS_VISIBLE 1. After the fix, all 94 real screenshots (658 slots) give byte-identical slot evidence and verdicts to the pre-test.36 ps1. A source guard pins it.
- New `verify:mayhem-card-variants` (102 checks), wired into `verify:release` after `verify:mayhem-indigo-cards`. It covers the predicate table on the logged RGBs, the shipped probe on prismatic, silver, gold, Maestro four-column, mixed-rarity (Hacked Reroll), HEARTSTEEL sticker and Debonair text rows, plus negatives (uniform band, borderless plates, bright cave, flecks on background, majority-bright patch). It also covers back-to-back rolls (an extra selection replaces the roll without merging, each pick is counted once, and trailing empties do not double-count).
- **Flashy**: still absent upstream (bundle 26.23). Left on the placeholder path on purpose. I added no alias because it could invent an augment.
- Known limit (test.31 logic, unchanged by design): if an extra selection replaces a roll with no empty frame in between, no pick is counted for the first roll. This is pinned in the new verify.
- **OPEN, needs real captures** (none exist on this machine; the four test.34 captures are not on disk): HEARTSTEEL sticker, Debonair Zed, Command Line mixed row, Pentakill screen, and a stickered **gold** card (gold art proves itself per pixel with no rim, so a sticker can cost it hits; it was not loosened without evidence). Run `npx --yes tsx scripts/mayhem-diagnose.ts <png>` on each and record the VERDICT line.
- **HUD skin health strip** (test.33): not checked in a real game. It is unchanged and still open.
- `verify:release` exit 0. No ranked, presenter, pick-logic or HUD maths changes, and no version edit.

## 2026-11-23 - test.37: the HUD stops blanking in ranked

- Report: in ranked the overlay disappeared for about 10 s and came back on its own. No code path hid the window: match-end detection, the empty-slot timer, hold-to-show, the presenter supervisor and the native show/hide rules were each checked and none can take it down while a match is live.
- Cause: the live payload (uildOverlayPayload) sets inGame: !loading, and loading came from isMatchLoading. That predicate returned true for any GameStart phase before looking at the clock. When the client keeps (or replays) GameStart after the game has started, every 2.5 s update arrived as "not in game, loading", so the page swapped the HUD for the loading layer until the phase caught up to InProgress - the 10 s blank.
- Fix (src/logic/matchLoading.ts): a running match clock in an engaged match now wins over the phase label. Real loading is unchanged (no match engaged, or the clock has not passed the 0.25 s jitter threshold). status.ts and the overlay both read the same predicate, so the dashboard agrees.
- New erify:match-loading-clock: GameStart with no match / frozen clock / sub-threshold clock stays loading; GameStart mid-match, with an advancing clock, and just after clock start are live; InProgress, Reconnect, Lobby and null-phase behaviour pinned unchanged. Wired into erify:release. erify:release exits 0.
- **Not confirmed in a live game on this machine** (no ranked capture here). Acceptance for the user: one ranked game to about 5 minutes with no blank.
- Release 	est-overlay-clock-37 (1.7.1-test.37, native backend) is the **latest** release; 49 old test/beta releases and their tags were deleted, leaving the 21 stable versions plus this build.
