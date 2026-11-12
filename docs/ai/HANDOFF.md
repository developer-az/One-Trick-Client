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
  - Protocol: HELLO/FRAME/SHOW/HIDE/CLICKTHROUGH/BOUNDS/CAPTURE/PING, READY/PONG/ERROR; version 1; dirty-rect BGRA frames; driver-side codec exported and unit-tested (split-chunk round-trip, oversize refusal).
- Tests: verify_native_presenter.ts (60 checks, wired into verify:release) — presenter structure, protocol round-trip, backend defaults, packaging. Failed on the pre-remake tree (45d7248, exit 1, missing driver module) before the change. verify_overlay_health.ts destroy check re-scoped to the destroyOverlay function (was: one `.destroy()` in the whole file); 49 checks.
- Gates (Linux dev VM, 2026-11-11): lint 0, tsc x3 0, vite build 0, presenter cross-compiles with MinGW (PE32+ GUI exe, 18 KB); verify suite at baseline parity — everything passes except verify:clipper-lifecycle's 4 ffmpeg checks, proven identical at the 45d7248 baseline (no ffmpeg on this VM, pre-existing environment failure). verify:electron-paths passes now (it failed at the Step 2 baseline).
- Not verified: anything on Windows (no League on the dev VM). scripts/package-test-build.ps1 now defaults to the native build (Label native-overlay, Tag test-native-overlay-20261111, Backend native). Acceptance: one full match; presenter.log shows exactly one 'created' line between match-start and match-end, no 'destroy' in between, frames flowing. If a plain layered window still vanishes, the cause is below the app entirely (driver/DWM on this PC) and no further app code is the answer.
