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
- Pre-release 2: https://github.com/developer-az/One-Trick-Client/releases/tag/test-overlay-fix-20261109 (prerelease, tag at d5fcb83, branch pushed). Packaged exe smoke-tested with the replayed match and the stand-in window: overlay in front at +6 s and +24 s, stand-in kept focus. Codex review pending.
