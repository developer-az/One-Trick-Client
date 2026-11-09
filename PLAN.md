# PLAN — One Trick: no-lag Windows overlay, measured tracking accuracy, full-state item logic

## Goal
Make the One Trick Electron app run on Windows with no measurable cost to League, prove its tracking against the Live Client Data API, and have item recommendations use every tracked signal (price- and gold-aware, powerspike and component timing). This is a coaching overlay, passive and read-only.

## Hard constraints (apply to every brief)
- Passive and read-only. No injection, no game-memory reads, no automated or simulated inputs.
- Allowed sources (D2, D3, D5 decided 2026-11-09):
  - the Live Client Data API (`https://127.0.0.1:2999`) as ground truth
  - the League Client local API (LCU)
  - Riot Data Dragon
  - CommunityDragon (named static-data source)
  - arammayhem.com (named static-data source for Mayhem augments, with attribution)
  - the app's own screen capture
- Nothing else. No stats sites, no global win rates.
- Architecture stays as designed (`VIDEO-UNDERSTANDING-DESIGN.md`):
  - API first.
  - Vision only for what the API cannot provide, on fixed anchored ROIs, in the native sidecar.
  - LLMs only on triggers, never in the tracking loop. The survey found no LLM code today.

## Context pack (all briefs and the review prompt draw from this)
- **Repo:** Electron 39 + React 19 + TypeScript 5.9 + Vite 7. Branch `orchestrate/perf-tracking-itemlogic` from `main` @ `453d8d5`.
- **Typecheck:**
  - `npx tsc -p tsconfig.app.json --noEmit`
  - `npx tsc -p tsconfig.electron.json --noEmit`
  - `npx tsc -p tsconfig.node.json --noEmit`
  - The root `tsc --noEmit` checks nothing (`files: []`).
- **Lint:** `npm run lint`.
- **Tests:** root `verify_*.ts` harnesses run with `npx --yes tsx verify_<name>.ts`. Each new harness also gets a `verify:<name>` npm script and goes into `verify:release`.
- **Build:** `npm run electron:build && npm run build`.
- **Coder sandbox:** Docker `pi-sandbox:1.4.0`, volumes `pi-nm-one-trick-client-root` (/work/node_modules) and `pi-nm-one-trick-client-website` (/work/website/node_modules). Windows-only checks run on the host.
- **Key files:**
  - `electron/state-service.ts`: the only Live Client loop. 400 ms in game; 2000 ms idle probe; `playerlist` every 2nd poll, `activeplayerabilities` every 4th.
  - `electron/live-client.ts`: Live Client adapters (https.Agent with keep-alive, `rejectUnauthorized: false`).
  - `electron/game-monitor.ts`: HUD cadence. 2.5 s normal, 4.2 s after 18:00, 8 s hidden, 5 s probe. Calls `setStateServiceEngaged(true)` unconditionally in a match (~line 1036).
  - `src/logic/gameState.ts`, `src/logic/stateEngine.ts`: `GameState` and `PlayerSnapshot`, `mergeLiveBoard`, the event cursor.
  - `electron/overlay-window.ts`: overlay windows; paints at 12 FPS shown, 1 FPS hidden.
  - `src/overlay/OverlayApp.tsx`, `src/overlay/overlayLogic.ts`: build call chain to the "next buy" cue.
  - `src/logic/buildProgress.ts`: `trackBuildProgress`; `BuildItemRef` = `{id, name, reason}`, no price.
  - `src/logic/situation.ts`, `src/logic/profiles.ts`, `src/logic/{pyke,pantheon,yone}Logic.ts`, `src/logic/genericProfile.ts`, `src/logic/coach.ts`.
  - `src/catalog/buildCatalog.ts`: Data Dragon items with `gold.total`, `from`, `into`.
  - `electron/mayhem-ocr.ts` + `electron/scripts/mayhem-ocr.ps1`: the only vision parser (Windows.Media.Ocr, ARAM Mayhem augment offers).
  - `src/vision/hud-geometry.ts`: normalized ROIs, not wired to anything live.
- **Conventions:**
  - Pure logic goes in `src/logic/`, Electron adapters in `electron/`, ROI geometry in `src/vision/`.
  - Plain copy; never state a win rate without an allowed, named source.
  - No new dependencies without approval.
- **Baseline before any change (2026-11-09, host):**
  - 35/36 `verify_*.ts` pass.
  - Pre-existing failure: `verify_global_hotkeys.ts` ("onetrick-keys.exe present"; the native helper isn't built locally, needs MinGW).
  - All three typechecks clean; lint clean.
  - Two harnesses print but assert nothing: `verify_logic.ts` and `verify_synergy.ts`.
- **DO-NOT-FLAG** (include in every review prompt): the global keyboard hook (a passive listener, by design); `verify_global_hotkeys` failing locally without the native helper; PLAN/handoff prose.

## Survey findings that shape this plan (Pi survey, verified by spot checks)
- **One Live Client loop:**
  - 400 ms, granular endpoints, never `/allgamedata`. It schedules the next tick after the current one completes, so polls never overlap.
  - The HUD consumes the cached board at 2.5–8 s.
- **Fields fetched but dropped before `GameState`:** `position`, `wardScore`, `summonerSpells` (handled separately by the summoner tracker), item `slot`/`count`, `isBot`, and ability levels (polled every 4th tick, consumed by nothing).
- **Vision:**
  - Only the Mayhem augment OCR exists, so no vision parser overlaps an API field today.
  - The `GameState.minimap` vision contract is a stub (always `null`).
  - There is no native sidecar yet; the OCR runs as PowerShell spawned from the Electron main process.
- **Item logic:** four engines that adapt differently.
  - Pantheon consumes `situation`; Pyke and Yone ignore it; generic ignores enemy, ally and situation entirely.
  - `next buy` = the first unowned item, with no price, no gold check and no component path.
- **Non-allowed sources in use:** CommunityDragon (rune recommendations, champion summary, item metadata) and arammayhem.com (Mayhem augment data). See decisions D2 and D3.

## Measured baselines (Phase 0, 2026-11-09, unchanged code at 453d8d5)
Setup:
- Built app (`electron:build` + `build`), UI served by `vite preview` on 5173 (the production bundle), launched with `electron .`.
- No League running. In-match = `scripts/perf/mock-live-client.mjs` replaying a deterministic game on 127.0.0.1:2999.
- HUD hidden via the app's own `electronAPI.setOverlayVisible(false)`, called over local remote debugging (no input simulation).
- CPU = % of the whole machine, sampled every 1 s by `scripts/perf/measure.mjs`. Raw reports: orchestrator scratch `perf-baseline/`.

| Metric | Idle (no match), 60 s | In match, HUD visible, 90 s | In match, HUD hidden, 90 s |
|---|---|---|---|
| Total CPU % avg / p95 | 0.06 / 0.25 | 0.35 / 1.00 | **0.45 / 1.00** (higher than visible) |
| Working set MB avg / max | 98 / 128 | 163 / 211 | 158 / 159 |
| browser (main) CPU avg / p95 | 0.05 / 0.25 | 0.18 / 0.50 | 0.09 / 0.25 |
| renderers CPU avg / p95 (count) | 0.00 / 0.00 (1) | 0.15 / 0.56 (3) | 0.19 / 0.69 (3) |
| gpu-process CPU avg / p95 | 0.00 / 0.00 | 0.02 / 0.19 | **0.17 / 0.50** |
| Live Client requests/s | 0 (port closed) | **9.0** | **9.0** (unchanged) |
| eventdata / activeplayer / gamestats per s | — | 2.4 each (~417 ms) | 2.4 each (unchanged) |
| playerlist / activeplayerabilities per s | — | 1.2 / 0.6 | 1.2 / 0.6 (unchanged) |
| Max concurrent requests (per-poll fan-out) | — | 4 | 5 |
| Mayhem OCR ms per call | — | not yet measured (P3 adds the timing) | — |
| League FPS impact, closed vs open, overlay on/off | — | **needs a real match (user-run, PresentMon)** | |

What the numbers say:
- (1) P1 is confirmed: hiding the HUD does not lower the request rate at all (9.0 req/s both ways), and total CPU is slightly higher hidden, driven by the gpu-process (0.02 → 0.17%). Hidden should be the cheap state.
- (2) The overall cost is already small on this machine (avg < 0.5% CPU, about 160 MB in a match), so "no lag" work targets the game's frame time (overlay compositing, GPU) and per-poll fan-out, not raw app CPU.
- (3) `activeplayerabilities` is 0.6 req/s for data nothing consumes (P2).

## Workstream budgets (proven against the table above, never asserted)
- No busy-polling: every loop is scheduled after its work completes; request rate stays at or below the measured baseline, and at the hidden cadence when the HUD is hidden.
- Nothing on the game's critical path: no synchronous work in Live Client handlers, OCR stays in its own process, no layout or animation loops in overlay windows beyond the 12 FPS paint budget.
- In-match app CPU (HUD visible) ≤ 0.35% avg / 1.0% p95, with working set ≤ 211 MB max.
- HUD hidden: Live Client requests/s ≤ the hidden cadence (target ≤ 1 req/s) and total CPU below the HUD-visible figure, including the gpu-process.
- League FPS: no measurable drop with the overlay on vs off in a real match (user-run protocol in `scripts/perf/README.md`).

## Phases and steps
Each step: tests first (frozen by hash) where it changes logic, then code, then scope gate, then targeted verify + typecheck.

### Phase 0 — Measurement harness and baselines (tooling only, no product code)
- [done] 0.1 `scripts/perf/mock-live-client.mjs`: HTTPS stand-in for the Live Client Data API that replays a deterministic game and records per-endpoint request cadence.
- [done] 0.2 `scripts/perf/measure.mjs`: per-process CPU and memory sampler for the app's process tree. Plus `scripts/perf/README.md`.
- [done] 0.3 Run the baselines (idle, HUD visible, HUD hidden) and fill in the table above.
- [done] 0.4 `scripts/perf/record-live-client.mjs`: a passive recorder (read-only GETs at the app's own cadence) that saves real Live Client snapshots during a match, for recorded-game-state fixtures. The user runs it in one real game (D4).

DONE WHEN: both reports exist for all three scenarios and the table is filled.

### Phase 1 — Performance
- **[done] P1 RESULT (2026-11-09).**
  - Same replayed game, new code. HUD visible: 9.0 req/s, app CPU 0.302% (sum of process averages). HUD hidden, after the 10 s destroy: **0.93 req/s, 0.045% CPU (−85%)**, 0 overlay renderer processes, compositor 0.000%. Re-show re-creates both overlay windows with content.
  - Changes:
    - P1a tests (`verify_state_service.ts`)
    - P1b state-service hidden cadence 4000 ms
    - P1c `verify_overlay_clock.ts` + visibility-gated 1 Hz overlay timers
    - P1d hidden overlay windows destroyed after 10 s, re-created on show with the last payload
  - Finding: overlay pages report `visibilityState: visible` even when hidden, because they are created with `backgroundThrottling: false` (deliberate, so a visible overlay keeps updating over League). So P1c's visibility gate is defensive only; P1d's destroy is what frees the cost.
- **P1 (named fix: hidden-HUD state loop).**
  - Problem: the 400 ms state loop keeps running in a match while the HUD is hidden.
  - Fix: while hidden, the in-match loop drops to the hidden cadence, or pauses work that only the HUD consumes. Event cursor integrity (no missed `EventID`s) is kept, because `eventdata` returns the full list.
  - ACCEPTANCE:
    - (a) A `verify_state_service.ts` extension written first: hidden → poll interval equals the hidden cadence; visible → 400 ms; switching back resumes without dropping events.
    - (b) Harness proof on the same replayed game: mock request rate and app CPU, HUD visible vs hidden, recorded in the baseline table. Hidden must show the lower rate and lower CPU.
- **[done] P2 RESULT.**
  - `activeplayerabilities` is now fetched on the first poll, on each self-level change, and while a skill point is unspent (every 5th poll for up to 30 s after a level change). Amended after review: a level-up and spending the point are separate moments.
  - Harness: 4–6 abilities fetches in ~3 in-game minutes, vs ~108 under the old every-4th rule.
- **P2. Stop polling endpoints nobody consumes.**
  - `activeplayerabilities` is fetched every 4th poll but unused.
  - Either drop it, or consume ability levels in Phase 3 (powerspikes on R rank-ups) and then fetch it only on a level change.
  - ACCEPTANCE: mock report shows the endpoint rate falling, or tied to level-ups.
- **[done] P3 RESULT.**
  - `src/logic/latencyStats.ts` (ring buffer, nearest-rank p50/p95; `verify_latency_stats.ts`). Wired for each `http.*` read, `poll` (the whole pollOnce incl. HTTP), `hud.build` and `ocr.mayhem`, surfaced in perf-stats and the `ONETRICK_DEBUG` log.
  - Live (harness) p50/p95:
    - http.eventdata 5.3/10.9 ms
    - poll 8.2/14.8 ms
    - hud.build 1.1/32.6 ms. The p95 is a main-process block per HUD tick, not League's; revisit when Phase 3 changes this path.
  - Mayhem OCR, 15 calls on fixtures: **p50 374 ms, p95 476 ms** per call (PowerShell spawn + Windows.Media.Ocr; every 900 ms during the pick window).
  - This is above the D6 trigger (250 ms), so **the native vision sidecar is the follow-up run's first item.**
- **Measurement note:** HUD-visible CPU varied 0.34–0.43% avg across three otherwise identical runs, so Phase 4 compares the median of 3 runs per scenario against a re-measured baseline, not single runs.
- **P3. Latency instrumentation.**
  - Add per-phase timing (HTTP round-trip, merge, HUD build, OCR call) to the existing perf stats.
  - ACCEPTANCE: the Performance view or debug log shows p50/p95 for each phase, and the harness run records them.

### Phase 2 — Tracking accuracy
- **T1. Signal inventory as a test.**
  - A frozen table of every documented Live Client field (allgamedata, activePlayer incl. abilities, championStats, runes; allPlayers incl. items, scores, summonerSpells, position; every event name; gameData), each marked used (with consumer) or ignored (with reason).
  - ACCEPTANCE: `verify_signal_inventory.ts` fails when a fetched field is silently dropped or a documented field is unaccounted for.
- **T2. Carry dropped fields into `GameState`.**
  - Add `position`, `wardScore`, `summonerSpells`, item `slot`/`count`, `isBot` and ability levels to `PlayerSnapshot`/`SelfState` where Phase 3 consumes them.
  - ACCEPTANCE: T1 shows no unexplained drops; `verify_game_state.ts` covers the new fields with recorded payloads.
- **T3. Recorded-payload fixtures.**
  - Real Live Client JSON from 0.4 checked into `test-fixtures/live-client/` with player names anonymized.
  - ACCEPTANCE: the parsers pass on the recorded fixtures, so patch drift is caught offline.
- **T4. Vision vs API validation.**
  - Wherever a vision parser overlaps an API field, compare against the API value, log disagreements (once per field per game) and report accuracy as a number.
  - Today no parser overlaps an API field (Mayhem OCR reads augment offers, which the API doesn't expose).
  - So T4 delivers: (a) the validation hook in `GameState` for any future overlapping parser; (b) Mayhem OCR accuracy measured as a number on the fixture set (exact-match rate, ms per call).
- **T5. EventID 0 is dropped** (found while writing the P1 tests, verified).
  - The engine's event cursor starts at 0 (`src/logic/stateEngine.ts:98`, reset `:193`), and `diffNewEvents` skips `id <= cursor` (`src/logic/gameState.ts:212-235`). So the Live Client's first event (EventID 0, `GameStart`) is never emitted.
  - Fix: the cursor starts and resets at -1.
  - ACCEPTANCE (test first): a board whose events start at EventID 0 emits all of them once; restart detection still works.
- **T-WR (named fix: tracking integrity, unsourced win rate).**
  - Rule: no build reason may state a win rate that doesn't come from an allowed, named source.
  - Until D1 is decided, `src/logic/yoneLogic.ts:189` is reworded without the win-rate claim, e.g. `'%HP on-hit in E — strongest in extended skirmishes.'`
  - A guard test fails on any build reason, cue or guidance string matching `/win ?rate|\bWR\b/i` unless it is wired to an approved source.
  - **Every place the app currently refers to a win rate:**
    - **Unsourced claim (to fix):** `src/logic/yoneLogic.ts:189`: "highest skirmish WR core (Skill-Capped)".
    - **The user's own record (sourced: their own LCU match history, `electron/match-history.ts:202` `/lol-match-history/v1/...`):**
      - `src/app/views/StatsView.tsx:111,125,147,193,208,246,271-276`
      - `src/logic/stats.ts:25,53,83` (Wilson interval)
      - `src/logic/lossInsights.ts:10,63,76,89`
    - **Disclaimers that say no win-rate data is used (not claims):**
      - `README.md:44`
      - `src/app/views/DraftView.tsx:231`
      - `src/app/views/HomeView.tsx:183`
      - `src/app/views/OneTrickCard.tsx:75`
      - `src/app/views/MayhemView.tsx:189`
    - **Marketing site, about competitors (not a claim):** `website/src/components/ComparisonMatrix.tsx:35`.
  - ACCEPTANCE: the guard test passes; `yoneLogic.ts:189` makes no win-rate claim.

### Phase 2 status (2026-11-09)
- [done] 0.4 recorder: `npm run record:game`. Waits for a match, reads `/allgamedata` every 2 s plus abilities on level change, anonymizes names, saves `recordings/*.jsonl.gz` (gitignored), stops by itself. Verified on Windows against the mock.
- [done] T1:
  - `verify_signal_inventory.ts` + `test-fixtures/live-client/mock-board-900s.json` (synthetic).
  - 78/78 fixture leaf paths are accounted for as used or ignored-with-reason.
  - Fidelity is checked against the real `GameState` build.
- [done] T2: `PlayerSnapshot` gains position, isBot, wardScore, summonerSpells, keystone, itemSlots (id/slot/count/price). `SelfState` gains stats (16 championStats) and abilityRanks. `GameState` gains mode.
- [done] T5: the event cursor starts at -1. EventID 0 (GameStart) is emitted, and after a restart the new match's events are emitted once (they were dropped before).
- [done] T-WR:
  - `yoneLogic.ts:189` reworded to "%HP on-hit in E — strongest when fights run long against high-HP targets."
  - `verify_no_winrate_claims.ts` guards 1,106 runtime build reasons plus a static scan of logic/overlay/catalog/data/electron.
  - D1 own-record display was checked: the Stats view already shows G / W–L and a 95% range beside every win rate under "Your stats".
- [done] T4:
  - `src/logic/visionValidation.ts` (API is truth; per-field agree/disagree counts; one log line per field per match), ready for the sidecar run. No current parser overlaps an API field.
  - Mayhem OCR on fixtures: **9/9 augments matched (100%)** on 3 PowerShell-generated images, p50 374 / p95 476 ms per call. Not representative: the ≥30 real screenshot set belongs to the sidecar run.
- **T3 pending D4:** replace the synthetic fixture with snapshots from the user's recorded match, then re-run `verify_signal_inventory.ts` to catch real-schema fields the mock lacks (e.g. `abilityHaste`).

### Phase 3 — Item logic (all acceptance tests from recorded game states, written first and frozen)
- **I1 (named fix: price- and gold-aware next buy).**
  - Every recommendation carries its Data Dragon cost (`gold.total`), and the remaining cost given the components already owned.
  - Every recommendation is checked against `currentGold`.
  - The cue says what to buy now: the full item if affordable; otherwise the best affordable component on its `from` path; otherwise "need X more gold".
  - ACCEPTANCE TESTS (recorded states): cannot afford anything yet; can afford a component but not the full item; already owns components so the remaining cost is lower; can afford the full item; full inventory; boots-slot interplay. Prices come from the Data Dragon catalog, never hard-coded.
- **I2. One build-economy engine for all profiles.**
  - A shared `src/logic/buildEngine.ts` (name TBD) that every profile, including generic, routes through.
  - It weighs: game time; gold now and gold rate (curve from samples); enemy composition (AD/AP/true damage mix, CC, healing, shields, tankiness, and armor/MR from their items via Data Dragon stats); ally composition; current inventory and components; KDA and CS pace vs time; objective state from events (dragons with soul, herald, baron, towers, inhibitors); level and ability ranks.
  - Authored doctrine (Pyke, Pantheon, Yone) stays as the candidate pool and priorities; the engine picks and orders within it.
  - ACCEPTANCE: recorded-state tests where each signal changes the recommendation in the expected direction (e.g. enemy healing → anti-heal moves up; enemy stacking armor → armor pen moves up; behind on gold → cheaper defensive component first), and no signal is fetched and then ignored (cross-checked with T1).
- **I3. Powerspike and component-timing calls for in-game use.**
  - Cues such as "Recall: 1,100 g completes Umbral Glaive", "Level 6 in ~1 wave — ult spike", "Hold for Mythic component vs buy boots".
  - Uses I1/I2 plus ability ranks and the gold rate.
  - ACCEPTANCE: recorded-state tests for each call type, with cooldown and dedupe so the HUD is not noisy (existing cue policy in `verify_overlay_cues.ts`).
- **I4. "Highest-win-rate builds"** depends on D1. Without an approved win-rate source, the engine optimizes for the stated signals and never claims a win rate.

### Phase 4 — Gates and delivery
- Full `verify_*` suite, three typechecks, lint, `npm run build`, and re-run the Phase 0 harness to compare against the baselines.
- Codex review with the diff baked in (INTERIM GLM review if Codex is quota-blocked).
- Commit, push, PR with a run summary (LAND ON THE PR). Never merge without approval.

## Decisions (recorded 2026-11-09)
- **D1 Win rates:** only from the user's own match history via LCU (`electron/match-history.ts`). Always shown with the sample size and labelled as the user's own record. No global win rates, no stats sites. The unsourced claim at `src/logic/yoneLogic.ts:189` is removed or reworded to logic-based reasoning (T-WR). I4 ("highest-win-rate builds") means: when the user's own record has enough games with an item or build, it may inform ordering, shown with "n games" and "your record". Otherwise the engine optimizes on the tracked signals and states no win rate.
- **D2 CommunityDragon:** approved as a named static-data source.
- **D3 arammayhem.com:** approved as a named static-data source (keep the attribution).
- **D4 Recorded match:** still open. The user runs `scripts/perf/record-live-client.mjs` (Phase 0.4) in one real game; until then, acceptance tests use the deterministic mock game.
- **D5 LCU:** allowed, confirmed.
- **D6 Native vision sidecar:** a follow-up run, not this one. Trigger: P3's per-call OCR timings (p50/p95 ms per Mayhem OCR call, and its CPU) set its priority. If OCR p95 per call is over 250 ms or it costs measurable CPU during the augment pick window, the sidecar becomes the next run's first item.
- **Plan approved 2026-11-09.** Phase 1 starts with P1, tests first.
