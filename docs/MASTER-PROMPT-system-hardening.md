# Master prompt: bulk verification, background hardening, and optimization

Copy everything inside the fenced block below into a new Cursor agent chat (or `/loop` automation). Adjust the **Scope** line per run.

---

```
You are the lead engineer for One Trick (One-Trick-Client): an Electron + React League companion. Read-only localhost APIs (LCU + Live Client). Overlay must stay click-through; no input injection, no memory reads.

## Mission this run
**Scope:** [D]
- A) Bulk verification — extend/fix `verify_*.ts` harnesses and wire gaps into CI
- B) Background / main-process hardening — timers, polling, lifecycle, failure modes
- C) Performance optimization — CPU, IPC, network, disk, without changing product behavior
- D) Full pass — A then B then C in priority order

Work on a branch off `main`. Do not commit/push/tag/release unless I explicitly ask.

## Architecture you must respect
- **State Service** (`electron/state-service.ts`): sole Live Client poller (~400 ms engaged, 2 s idle probe). Granular endpoints only; never `/allgamedata`. Owns engine cursor, objective timers, debug log rotation.
- **State engine** (`src/logic/stateEngine.ts`, `src/logic/gameState.ts`): pure logic; heavily covered by `verify_game_state.ts` fixtures (+ optional `OT_LIVE_STATE=1` live harness).
- **Game monitor** (`electron/game-monitor.ts`): HUD cadence consumer of cached board + coach/play-moments/clipper hooks. Must NOT re-introduce Live Client polling here.
- **Live client** (`electron/live-client.ts`): axios to `127.0.0.1`; LCU in `lcu-connector.ts`.
- **Clipper** (`electron/clipper.ts` + `src/logic/clipper-plan.ts`): optional ffmpeg gdigrab ring buffer; triggers from scored recap (`CLIP_TRIGGER_SCORE`) or manual IPC.
- **Coach** (`src/logic/coach.ts` + `electron/coach-cues.ts`): one cue/tick, cooldown map, uses `getGameState()` + objective timers.
- **Mayhem OCR** (`electron/mayhem-ocr.ts`, etc.): separate timer path; must stay isolated from ranked SR.

Existing quality gate: `npm run verify:release` and `.github/workflows/ci.yml` / `release.yml`.

## What is already well tested (do not re-litigate unless broken)
- Overlay cue policy, layout, bounds, summoner timers, jungle/wave, loss insights, ranked guards, mayhem bundle/ranker/OCR schedule (fixture side).
- Coach rules (`verify_coach.ts`), clip planner math (`verify_clipper.ts`), game-state engine fixtures (`verify_game_state.ts`), play moments + scoring threshold (`verify_play_moments.ts`).

## Undertested / high-risk areas (prioritize these)

### 1) Integration gaps (logic tested, wiring not)
- `state-service.ts` poll loop: `inFlight`, `PLAYERLIST_EVERY` / `ABILITIES_EVERY` staleness, engaged vs idle transitions, match-end (`engine` reset), log flush timer, rotation at 2 MB.
- **Game monitor ↔ state service**: HUD tick reads `lastBoard` / `getGameState()`; coach context when board is null mid-reconnect; three dropped reads ending match vs state service still engaged.
- **Clipper lifecycle**: `startClipper` at monitor start; `setClipperActive` on match focus/end; `saveClip` while `stitching`; ffmpeg missing vs present; segment pruning under rapid triggers; no double-spawn of ffmpeg.
- **Play moments**: `tickPlayMoments` with `prevState` for scoring context — fixture coverage for low-HP brilliant path; clip trigger must use **recap** scores, not overlay cues.
- **IPC surface** (`electron/main.ts`): `state-service-*` handlers, manual clip, clipper status — shape and error handling when no match.

### 2) Not in CI / verify:release today
- `verify_hud_geometry.ts` (vision ROI matrix) — add script to `package.json` + CI if stable.
- End-to-end **game-monitor** slice tests (inject fake board + fake engine state, assert payload shape / momentCues / no throw).
- **state-service** module tests with mocked `fetch*` from `live-client` (no Electron app when possible).
- **clipper** stitch path: mock `spawn` / temp segments (unit-level), not full ffmpeg in CI.

### 3) Background performance & reliability
- Timer inventory: list every `setInterval` / `setTimeout` / recursive poll in `electron/*` and prove cleanup on match end, app quit, overlay destroy.
- IPC frequency: game-monitor must not force full React reconcile every state poll (comment exists ~430 — verify and add guard tests).
- axios: connection errors, 404, timeout, partial JSON — live-client and LCU must fail soft without wedging timers.
- Memory: event log buffer, snapshot ring in state engine, mayhem OCR caches, clip segment dir growth.
- Disk: `state-service.log`, clips folder, segment tmp cleanup on crash.

### 4) System / manual acceptance (document, don’t fake in CI)
- Practice Tool: `npm run verify:game-state-live` for 45–120 s during fights.
- ffmpeg installed: one manual clip + one Great+ kill trigger.
- Long match (30+ min): no timer leak, overlay still responsive.
- League unfocused: clipper pauses; refocus resumes.
- Mayhem queue only: OCR path still gated.

## Execution protocol

1. **Baseline** — `git fetch`; note branch; run targeted verifies before edits:
   `npm run verify:coach && npm run verify:clipper && npm run verify:game-state && npm run verify:play-moments && npm run electron:build && npm run build && npm run lint`

2. **Map** — Produce a short table: Module | Risk | Existing tests | Gap | Proposed test or fix.

3. **Implement** — Prefer:
   - New or extended `verify_*.ts` with deterministic fixtures (pattern: `ok(cond, message)`).
   - Extracting testable pure functions over mocking Electron when possible.
   - Minimal diffs; no drive-by refactors.

4. **Optimize** — Only after correctness gaps are covered or ticketed. Measure:
   - Poll work per 400 ms tick (which endpoints fire).
   - HUD tick cost (avoid duplicate work per tick).
   - Clipper CPU when recording (document ffmpeg flags already used).

5. **Wire CI** — If a new verify script is stable, add to `package.json`, `ci.yml`, `release.yml`, and `verify:release` in the same PR.

6. **Deliverables** — End with:
   - Summary of changes (files + why).
   - Commands run and results.
   - Remaining risks / manual test checklist.
   - Optional: follow-up PR slices if scope too large.

## Hard constraints
- No gameplay automation, no memory reading, no packet sniffing.
- Do not poll `/allgamedata` from game-monitor or duplicate state-service polling.
- Auto-clip and ffmpeg remain optional; app must run with clipper disabled.
- Mayhem features must not appear in ranked SR overlay paths.
- Match existing TypeScript style, eslint rules, and verify script conventions.

## Definition of done (per scope slice)
- All touched verifies pass locally.
- `npm run electron:build` and `npm run build` pass.
- No new eslint errors.
- New behavior has a verify line or an explicit manual test in the summary.
```

---

## Quick scope presets

| Preset | Replace **Scope** with |
|--------|-------------------------|
| Night bulk tests | `D) Full pass` |
| v1.6.2 follow-up | `A) + integration tests for state-service, game-monitor, clipper IPC` |
| Perf only | `C) Performance optimization` with manual baseline note (Task Manager, one Practice Tool match) |
| Pre-release | Run full `npm run verify:release` on branch; fix failures; then preset “Pre-release” scope: `A) wire verify_hud_geometry + any failing gate` |

## Related commands

```bash
npm run verify:game-state-live    # Practice Tool + Live Client
npm run verify:mayhem-ocr-live-ui   # Windows OCR UI path
npx --yes tsx verify_hud_geometry.ts
```
