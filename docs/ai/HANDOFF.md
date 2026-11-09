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
