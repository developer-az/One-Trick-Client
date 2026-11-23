# Context pack — ARAM/Mayhem overlay elements, ranked isolation, overlay stability

**Task (verbatim from the orchestrator):** "Make sure all elements are working they should in aram mayhem without breaking ranked function and the overlay stability"

**Scope of this document:** facts only. No code was written, no file changed except this one, nothing was fixed, no subagents were spawned.

**Repo state at exploration:** branch `fix/overlay-aram-identity`, HEAD `05b356d` (`test: build fake Riot key at runtime to avoid secret false positives`), tracking `origin/fix/overlay-aram-identity`. Working tree clean (`git status --short` printed nothing). `package.json:4` version `1.7.1-test.18`; the nine `test-*` tags (test.19–27) all point at `ce5d658`, a single cumulative commit (`docs/ai/HANDOFF.md:217-221`).

---

## 1. File map — one line per relevant file

### Mode classification (decides whether ARAM/Mayhem paths run at all)
- `src/logic/mayhem/mode.ts` — single source of truth: `MAYHEM_QUEUE_IDS`, `ARAM_QUEUE_IDS`, `HOWLING_ABYSS_MAP_ID`, `detectMayhemMode()`, `isMayhemGame()`, `isAramOrMayhem()`; queue 2400 KIWI, Howling Abyss = map 12/`Map12`.
- `src/logic/mayhem/match.ts` — fuzzy title matching and confidence constants (`MAYHEM_HIGH_CONFIDENCE_SCORE`, `MAYHEM_AUTO_RELAX_SCORE`, unknown-augment detection).
- `src/logic/mayhem/visibility.ts` — `isMayhemAugmentHudVisible()`: the HUD opens on 2 matched offers, or 1 on manual scan / 2 consecutive high-confidence scans.
- `src/logic/mayhem/types.ts` — `MayhemMode`, `MayhemBundle`, `RankedMayhemChoice`, augment types.
- `src/logic/gameState.ts` — derives `PlayerSnapshot` from Live Client; `isSelfPlayer()` identity matching (Riot ID → game name → summoner name, with `allPlayers[0]` fallback) at lines 475-514.

### ARAM/Mayhem overlay elements (the "elements" in the task)
- `src/logic/aramOverlay.ts` — `getAramGankStatus()` (always null), `getAramWardStatus()` (classic ARAM only, suppressed in Mayhem), `buildAramInGameCues()`, `shouldUseAramOverlay()`.
- `src/overlay/overlayLogic.ts` — `resolveProfileId()` (341-355), `resolveChampionProfileId()` (362-380), `buildInGameCues()` (484-518): ARAM-family games take the ARAM cue branch with `skipLaneMacro: true`.
- `src/overlay/OverlayApp.tsx` — owns `inMayhem`/`inAram` (486-495), `aramProfileId` (498-501), `profile` (502-505), `championProfileKnown` (507); the React surface that renders every HUD element.
- `src/overlay/OverlayMayhemPanel.tsx` — the in-game augment panel; `shouldActivateMayhemSlot()` (49-64), idle "Cannot verify" prompt (29-31).
- `src/overlay/hudModules.ts` — module ids `sums/gank/vision/buy/action/mayhem/frames`, defaults (3-20), one-time Mayhem-on migration (41-83).
- `src/overlay/loadingStats.ts` — stats scope selection by queue (`ranked`/`aram`/`mayhem`/`aram-family`/`rift`) at 80-125; `loadingScopeLabel()` at 165-178.
- `src/overlay/ChromeGameHud.tsx`, `GankSquare.tsx`, `WardIndicator.tsx`, `OverlayStickers.tsx`, `hudLayout.ts`, `overlay-theme.css` — the other rendered overlay elements and their layout/theme.
- `src/app/views/MayhemView.tsx` — app-side Mayhem page (bundle attribution, live ARAM build card).
- `src/app/LiveBuildCard.tsx` — shared build card, `mode: 'ranked' | 'aram'`.

### Augment capture / ranking / bundle (Mayhem element data)
- `src/logic/mayhem/augmentSchedule.ts` — `MAYHEM_AUGMENT_LEVELS = [1, 7, 11, 15]`, OCR cadence (`off`/`snooze`/`warmup`/`burst`), XP thresholds.
- `src/logic/mayhem/pickPhase.ts` — pick windows; spawn pick is level-free and open alive before `MAYHEM_SPAWN_PICK_SECONDS = 120`.
- `src/logic/mayhem/monitor.ts` — pure monitor decision core: scan schedule for `mayhem` + `mayhem-likely`, pick counting, `mayhemUnverifiedAfterRead()`.
- `src/logic/mayhem/offerAcceptance.ts` — candidate → accepted offer frames; 1-offer promotion across consecutive scans.
- `src/logic/mayhem/pipeline.ts`, `captureMask.ts`, `captureRegion.ts`, `ocrOutput.ts` — frame geometry/pixel gating and OCR output parsing.
- `src/logic/mayhem/rank.ts`, `synergy.ts`, `buildAdjust.ts`, `bundleSanitize.ts`, `remote.ts` — augment ranking, reasons, item-tag adjustment, bundle sanitising/refresh.
- `src/logic/mayhem/hotkey.ts` — PageUp/PageDown routing; `aramFamily` wins over `inGame`, so classic ARAM still reaches the Mayhem panel.
- `electron/game-monitor.ts` — owns timers, payloads and the overlay; imports all mode/monitor helpers (94-144); manual-scan gate (755-794); writes `environment` line at match start.
- `electron/mayhem-ocr.ts` — Electron capture + PowerShell OCR runner, feeds `MayhemMonitorRead`.
- `electron/mayhem-data.ts`, `electron/mayhem-state.ts` — bundle load/refresh policy and persisted owned/roll/picks state.
- `src/data/mayhem/bundle.json` — shipped augments/combos data (patch 26.22, arammayhem.com).

### Ranked guardrails (must not regress)
- `verify_ranked.ts` — asserts SR CLASSIC/RANKED is not Mayhem/ARAM, Yone mid profile resolution, no augment HUD on SR.
- `verify_aram_profile.ts` — asserts Samira in KIWI Howling Abyss → `generic:Samira:Bot`, and build/boot assertions.
- `src/logic/profiles.ts` — `profileFromChampionName()` (254-274), `profileIdFromChampion()` (276-281, falls back to `pyke-support`); authored Pyke/Pantheon/Yone profiles.
- `src/catalog/buildCatalog.ts`, `src/catalog/snapshot.ts`, `src/data/championCatalog.ts` — catalog recommendations used by all modes.

### Overlay stability / diagnostics
- `electron/overlay-window.ts` — window lifecycle, backend switch, `keepOverlayOnTop`, `healOverlayWindows`, health log, `destroyOverlay` is the single destroy site.
- `electron/overlay-presenter.ts` — offscreen Chromium + named-pipe driver; supervisor wiring, `respawn()` (722-743), `destroy()` (850-898).
- `electron/presenter-supervisor.ts` — pure backoff/fallback decisions (1/2/4/8 s cap, 4 failures/60 s → fallback).
- `electron/presenter-frame.ts` — dirty-rect crop for OSR frames.
- `electron/overlay-bounds.ts`, `electron/safe-window.ts`, `electron/overlay-log.ts`, `electron/paint-throttle.ts` — bounds rules, destroyed-window guards, log sink, paint coalescing.
- `native/presenter/presenter.c` — Win32 layered-window presenter; diagnostic `state` line (325-364).
- `electron/environment.ts` — reads MPO / windowed-game-optimizations / recorders via `reg query` + `tasklist`.
- `src/app/overlayAdvice.ts` — turns environment readings into problem+fix text on the Performance view.
- `electron/live-builds.ts`, `electron/riot-api.ts`, `electron/ps-worker.ts` — live-build fetch/parse, Riot identity + cache, persistent PowerShell OCR host.

### Tests / gates / context
- `package.json:157` — `verify:ranked` = `verify_ranked.ts && verify_aram_profile.ts`.
- `package.json:159` — `verify:release` is the full gate (lint → ~70 verify suites → electron:build → build → 3 typechecks → packaging checks).
- `verify_augment_schedule.ts`, `verify_mayhem_monitor.ts`, `verify_mayhem_visibility.ts`, `verify_mayhem_offers.ts`, `verify_mayhem_ocr*.ts`, `verify_mayhem_fixtures.ts`, `verify_mayhem_text_matrix.ts`, `verify_mayhem_self_capture.ts`, `verify_ocr_geometry_actual.ts` — Mayhem element tests.
- `verify_overlay_health.ts`, `verify_overlay_fallback.ts`, `verify_native_presenter.ts`, `verify_presenter_frame.ts`, `verify_presenter_supervisor.ts`, `verify_destroyed_guards.ts`, `verify_overlay_environment.ts`, `verify_overlay_bounds.ts` — stability tests.
- `verify_live_builds.ts`, `verify_riot_api.ts`, `verify_riot_identity.ts`, `verify_game_state.ts`, `verify_game_monitor.ts`, `verify_state_service.ts` — identity/state tests.
- `docs/ai/HANDOFF.md` — chronological decisions, run logs, and open items through test.27 (lines 159-221 are the current overlay-stability and Mayhem history).
- `PLAN.md` — hard constraints, allowlists, typed gates (lines 15-28).

---

## 2. Key excerpts (actual code, with file:line)

`src/logic/mayhem/mode.ts:86-110` — classification precedence (the known classic-queue rule is the ranked guardrail):
```ts
export function detectMayhemMode(signals: MayhemModeSignals): MayhemMode {
  const mode = (signals.gameMode || '').toUpperCase();
  const modeSaysMayhem = mode.includes('KIWI') || mode.includes('MAYHEM');
  const queue = queueKind(signals.queueId);
  const howling = isAramMap(signals.mapName, signals.mapId);

  if (queue === 'mayhem') return 'mayhem';
  if (modeSaysMayhem) return 'mayhem';
  if (queue === 'aram') return 'aram';

  if (howling) {
    // Known queue that is not classic ARAM on the shared map: Mayhem.
    if (queue === null && typeof signals.queueId === 'number' && Number.isFinite(signals.queueId)) {
      return 'mayhem';
    }
    if (signals.augmentOffersDetected) return 'mayhem';
    return 'mayhem-likely';
  }

  if (mode.includes('ARAM')) {
    if (signals.augmentOffersDetected) return 'mayhem';
    return 'aram';
  }
  return 'other';
}
```

`src/overlay/overlayLogic.ts:341-380` — profile resolution (note the explicit "never another champion's build" rule):
```ts
/** Resolve the active profile for a live state (live champion wins over stored). */
export function resolveProfileId(state: OverlayState, fallback?: ProfileId): ProfileId {
  const liveName = state.localPlayer?.championName;
  if (liveName) {
    const aramStyle = isAramOrMayhem(state.gameMode, state.mapName, {
      queueId: state.queueId,
      mapId: state.mapId,
    });
    const liveRole = aramStyle ? null : roleFromLivePosition(state.localPlayer?.position);
    return profileIdFromChampion(liveName, liveRole);
  }
  if (state.profileHint) return state.profileHint;
  if (state.isYone) return 'yone-mid';
  return fallback || 'pyke-support';
}

/**
 * The live champion's own profile, or null when it cannot be resolved. Used by
 * ARAM-family HUDs so an unknown champion never renders another champion's
 * build (and the buy rail can hide instead of inventing a support path).
 */
export function resolveChampionProfileId(state: OverlayState): ProfileId | null {
  const liveName = (state.localPlayer?.championName || '').trim();
  if (!liveName) return null;
  // An unreadable/unknown name must not become "another champion's" build.
  if (!resolveChampionRef({ name: liveName })) return null;
  const aramStyle = isAramOrMayhem(state.gameMode, state.mapName, {
    queueId: state.queueId,
    mapId: state.mapId,
  });
  const role = aramStyle ? null : roleFromLivePosition(state.localPlayer?.position);
  const id = profileIdFromChampion(liveName, role);
  if (id === 'pyke-support') {
    // profileIdFromChampion falls back to Pyke for an unknown champion; only a
    // real Pyke may keep that profile.
    const compact = liveName.toLowerCase().replace(/[^a-z]/g, '');
    if (compact !== 'pyke') return null;
  }
  return id;
}
```

`src/overlay/OverlayApp.tsx:486-507` — where the ARAM profile is actually selected:
```tsx
const inMayhem = isMayhemGame(state.gameMode, state.mapName, {
  queueId: state.queueId,
  mapId: state.mapId,
  augmentOffersDetected: (state.mayhemOfferIds?.length ?? 0) >= 2,
});
const inAram = isAramOrMayhem(state.gameMode, state.mapName, {
  queueId: state.queueId,
  mapId: state.mapId,
  augmentOffersDetected: (state.mayhemOfferIds?.length ?? 0) >= 2,
});
const resolvedProfileId = useMemo(() => resolveProfileId(state), [state]);
/** In an ARAM-family game the live champion must own the profile. */
const aramProfileId = useMemo(
  () => (inAram ? resolveChampionProfileId(state) : null),
  [inAram, state]
);
const profile = useMemo(
  () => getProfile(aramProfileId ?? resolvedProfileId),
  [aramProfileId, resolvedProfileId]
);
/** Unknown champion in ARAM: never draw another champion's build/buy rail. */
const championProfileKnown = !inAram || aramProfileId !== null;
```

`src/overlay/overlayLogic.ts:497-507` — ARAM cue branch avoids all lane/jungle macro:
```ts
if (
  isAramOrMayhem(state.gameMode, state.mapName, { queueId: state.queueId, mapId: state.mapId })
) {
  const aram = buildAramInGameCues(state);
  return mergeMomentCues(
    finalizeCues(aram as OverlayCue[], state, profileId, cueCtx, { skipLaneMacro: true }),
    state,
    profileId,
    cueCtx
  );
}
```

`src/logic/aramOverlay.ts:35-42, 86-109` — gank/vision element gating and ARAM cues:
```ts
/** ARAM / Mayhem — no jungle gank square. */
export function getAramGankStatus(): null {
  return null;
}

/** Brush / oracle reminders suited to Howling Abyss (classic ARAM — not Mayhem augment HUD). */
export function getAramWardStatus(state: AramHudState): WardStatus | null {
  if (isMayhemGame(state.gameMode, state.mapName, modeSignalsOf(state))) return null;
```
```ts
export function buildAramInGameCues(state: AramHudState): AramOverlayCue[] {
  const cues: AramOverlayCue[] = [];
  const level = state.localPlayer?.level ?? state.activePlayerLevel ?? 1;
  const gameTime = state.gameTime ?? 0;
  const minutes = gameTime / 60;
  const mayhem = isMayhemGame(state.gameMode, state.mapName, modeSignalsOf(state));

  if (level === 6) {
    cues.push({ id: 'ult-online', label: 'R online', detail: '', urgency: 'spike', maxAgeSec: 24 });
  }

  if (minutes >= 8 && minutes <= 14) {
    cues.push({ id: 'aram-mid', label: 'Group mid', detail: '', urgency: 'info', maxAgeSec: 35 });
  }

  if (mayhem && isMayhemAugmentLevel(level)) {
    cues.push({ id: 'mayhem-pick', label: 'Augment pick', detail: '', urgency: 'spike', maxAgeSec: 20 });
  }

  return cues;
}

export function shouldUseAramOverlay(state: AramHudState): boolean {
  return isAramOrMayhem(state.gameMode, state.mapName, modeSignalsOf(state));
}
```

`src/logic/mayhem/hotkey.ts:24-36` — ranked hotkeys stay untouched outside ARAM family:
```ts
/**
 * Route one hotkey press. Returns null for a key this router does not own.
 * `aramFamily` wins over `inGame`: the classic ARAM manual scan is exactly the
 * case that must still reach the Mayhem panel while the board is live.
 */
export function routeHotkey(key: string, ctx: HotkeyContext): HotkeyRoute | null {
  if (!ctx.inGame) return null;
  const primary = PRIMARY_KEYS.has(key);
  const secondary = SECONDARY_KEYS.has(key);
  if (!primary && !secondary) return null;
  if (ctx.aramFamily) return primary ? 'mayhem-dismiss' : 'mayhem-scan';
  return primary ? 'flash-primary' : 'flash-secondary';
}
```

`src/logic/mayhem/visibility.ts:22-35` — when the augment element is allowed to show:
```ts
export function isMayhemAugmentHudVisible(
  offerIds: string[],
  manualScanActive: boolean,
  singleOffer?: MayhemSingleOfferEvidence
): boolean {
  if (offerIds.length >= MIN_AUTO_AUGMENT_OFFERS_FOR_HUD) return true;
  if (offerIds.length !== 1) return false;
  if (manualScanActive) return true;
  if (!singleOffer) return false;
  return (
    singleOffer.consecutiveScans >= MIN_SINGLE_OFFER_SCANS &&
    singleOffer.fuzzyScore >= MAYHEM_HIGH_CONFIDENCE_SCORE
  );
}
```

`src/overlay/OverlayMayhemPanel.tsx:29-31, 47-64` — idle prompt and slot activation:
```tsx
/** Idle prompt — shown only when no press left a status; a finished scan has its own outcome text. */
const MAYHEM_IDLE_CANNOT_VERIFY =
  'Cannot verify the augment screen — press PageDown to retry (borderless window required in fullscreen)';
```
```tsx
/** Panel/slot activation, shared with the verify so the zero-offer press is testable. */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldActivateMayhemSlot(input: {
  mayhemFamily: boolean;
  moduleOn: boolean;
  dismissedRecently: boolean;
  unverified: boolean;
  augmentWindow: boolean;
  offerCount: number;
  ocrHint?: string;
}): boolean {
  if (!input.mayhemFamily || !input.moduleOn || input.dismissedRecently) return false;
  return (
    input.unverified ||
    isMayhemManualScanHint(input.ocrHint) ||
    (input.augmentWindow && input.offerCount > 0)
  );
}
```

`src/overlay/hudModules.ts:3-20, 60-83` — the element toggles and first-run Mayhem migration:
```ts
export const HUD_MODULE_IDS = ['sums', 'gank', 'vision', 'buy', 'action', 'mayhem', 'frames'] as const;

export type HudModuleId = (typeof HUD_MODULE_IDS)[number];

/** Modules the web HUD Studio stage can render as live pins. */
export const HUD_STUDIO_MODULE_IDS: HudModuleId[] = ['sums', 'gank', 'vision', 'buy', 'action'];

export type HudModules = Record<HudModuleId, boolean>;

export const DEFAULT_HUD_MODULES: HudModules = {
  sums: true,
  gank: true,
  vision: true,
  buy: true,
  action: true,
  mayhem: true,
  frames: false,
};
```
```ts
/**
 * One-time store migration. Builds before the first-run switch shipped Mayhem
 * off, so a persisted `mayhem: false` is that install default rather than a
 * choice. A store without the marker is turned on and stamped; a stamped store
 * is returned untouched, so a user who turned Mayhem off stays off.
 */
export function migrateMayhemDefaults<T extends Record<string, unknown>>(
  settings: T
): { settings: T; migrated: boolean } {
  if (settings[MAYHEM_DEFAULTS_MIGRATION_KEY] === true) return { settings, migrated: false };
  const modules =
    settings.hudModules && typeof settings.hudModules === 'object'
      ? { ...(settings.hudModules as Record<string, unknown>) }
      : {};
  modules.mayhem = true;
  return {
    settings: {
      ...settings,
      hudModules: modules,
      hudLayout: withMayhemVisible(settings.hudLayout),
      [MAYHEM_DEFAULTS_MIGRATION_KEY]: true,
    } as unknown as T,
    migrated: true,
  };
}
```

`src/overlay/loadingStats.ts:90-125, 165-178` — stats element scope (ranked line stays ranked-only):
```ts
  if (queueId === undefined) {
    // Legacy fixture callers: ranked first, then the whole Rift window.
    const ranked = onChampion.filter(
      (game): boolean => typeof game.queueId === 'number' && RANKED_QUEUES.has(game.queueId)
    );
    scoped =
      ranked.length > 0
        ? ranked
        : onChampion.filter(
            (game) => typeof game.queueId !== 'number' || RIFT_QUEUES.has(game.queueId)
          );
    scope = ranked.length > 0 ? 'ranked' : 'rift';
  } else if (queueId == null || !Number.isFinite(queueId)) {
    if (!mayhemLikely) {
      // The queue is not known yet: show no stats rather than a ranked line.
      return empty;
    }
    ({ scoped, scope } = mayhemScope());
  } else if (MAYHEM_QUEUES.has(queueId)) {
    ({ scoped, scope } = mayhemScope());
  } else if (ARAM_QUEUES.has(queueId)) {
    scoped = onChampion.filter(
      (game): boolean => typeof game.queueId === 'number' && ARAM_QUEUES.has(game.queueId)
    );
    scope = 'aram';
  } else if (RANKED_QUEUES.has(queueId)) {
    scoped = onChampion.filter(
      (game): boolean => typeof game.queueId === 'number' && RANKED_QUEUES.has(game.queueId)
    );
    scope = 'ranked';
  }
```
```ts
export function loadingScopeLabel(scope: LoadingScope | null): string {
  switch (scope) {
    case 'ranked':
      return 'ranked ';
    case 'aram':
      return 'ARAM ';
    case 'mayhem':
      return 'Mayhem ';
    case 'aram-family':
      return 'ARAM & Mayhem ';
    default:
      return '';
  }
}
```

`electron/game-monitor.ts:755-779` — main-process manual-scan gate, including why classic ARAM 450 is not widened:
```ts
  const signals = currentMayhemSignals();
  // Manual scan is allowed in any ARAM-family game, including an unknown
  // queue. Only an unknown queue may be classified from it; classic ARAM 450
  // must stay ARAM even when cards are on screen.
  const aramFamily = isAramOrMayhem(signals.gameMode, signals.mapName, {
    queueId: signals.queueId,
    mapId: signals.mapId,
    augmentOffersDetected: false,
  });
  const mode = currentMayhemMode();
  // What this gate guarantees: whenever `currentMayhemMode()` classifies the
  // match Mayhem or `mayhem-likely` (unknown-queue Howling Abyss), a roll of
  // cards the bundle does not know still displays its titled rows — on patch
  // day every card can be newer than the bundle, and the mode used to latch
  // only from a frame that displayed rows, so the panel stayed blank all
  // match. A match classified `aram` (a classic queue id, e.g. 450) is not
  // widened: it shows nothing until the bundle knows at least one offered id.
  // The display-only junk risk is bounded the same way in both cases:
  // placeholders never evict a 1–2 row known roll, never latch discovery,
  // never move the pick counter and never arm the fast poll.
  const modeMayhem = isMayhemMode(mode);
  if (!modeMayhem && !aramFamily) {
    logMayhemHotkeyRoute({ key, routed: false, reason: 'not-aram-family' });
    return;
  }
```

`electron/overlay-presenter.ts:850-898` — stability-sensitive shutdown (pipe close first, kill only a straggler):
```ts
    destroy(): void {
        this.destroyed = true;
        this.alive = false;
        this.instance += 1;
        this.readyWaiter = null;
        this.lastFrame = null;
        this.lastValidatedFrame = null;
        this.paintThrottle.reset();
        if (this.paintFlushTimer) {
            clearTimeout(this.paintFlushTimer);
            this.paintFlushTimer = null;
        }
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.socket) {
            this.socket.removeAllListeners();
            try {
                this.socket.destroy();
            } catch {
                // ignore
            }
            this.socket = null;
        }
        if (this.child) {
            const child = this.child;
            child.removeAllListeners();
            this.child = null;
            // The pipe is closed above, so the presenter exits by itself and logs
            // `destroy` (the match-end acceptance line); kill only a straggler.
            const straggler = setTimeout(() => {
                if (child.exitCode !== null || child.signalCode !== null) return;
                try {
                    child.kill();
                } catch {
                    // ignore
                }
            }, CHILD_EXIT_TIMEOUT_MS);
            straggler.unref?.();
        }
        if (!this.osrWin.isDestroyed()) {
            try {
                this.osrWin.destroy();
            } catch {
                // ignore
            }
        }
    }
```

`native/presenter/presenter.c:325-364` — the diagnostic that decides future overlay-stability bugs:
```c
// Diagnostic only (changes nothing): what Windows says about us and the game,
// logged on every change and once a minute. quns 3 = exclusive D3D fullscreen.
static void logState(HWND hwnd, int covered) {
    typedef HRESULT(WINAPI * QunsFn)(int *);
    static QunsFn quns = NULL;
    static int qunsLoaded = 0;
    if (!qunsLoaded) {
        qunsLoaded = 1;
        HMODULE shell = LoadLibraryA("shell32.dll");
        if (shell) quns = (QunsFn)(void *)GetProcAddress(shell, "SHQueryUserNotificationState");
    }
    int qunsState = -1;
    if (quns && quns(&qunsState) != S_OK) qunsState = -1;
    HWND fg = GetForegroundWindow();
    int fgAbove = 0, fgFull = 0;
    HWND above = GetWindow(hwnd, GW_HWNDPREV);
    for (int hops = 0; fg && above && hops < 512; hops++, above = GetWindow(above, GW_HWNDPREV)) {
        if (above == fg) { fgAbove = 1; break; }
    }
    ...
    snprintf(state, sizeof(state),
        "state shown=%d visible=%d topmost=%d covered=%d fgAbove=%d fgFull=%d quns=%d fg=%s",
        g_shown, IsWindowVisible(hwnd) ? 1 : 0,
        (GetWindowLongPtrA(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST) ? 1 : 0,
        covered, fgAbove, fgFull, qunsState, exe);
    DWORD now = GetTickCount();
    if (strcmp(state, g_lastState) != 0 || now - g_lastStateLog >= 60000) {
        snprintf(g_lastState, sizeof(g_lastState), "%s", state);
        g_lastStateLog = now;
        logLine("%s frames=%ld", state, g_frameCount);
    }
}
```

`src/app/overlayAdvice.ts:18-47` — user-facing stability advice (must stay in sync with `electron/environment.ts`):
```ts
export function overlaySettingsAdvice(env: OverlaySettingsEnv): OverlayAdvice[] {
    const out: OverlayAdvice[] = [];
    if (env.windowMode === 'fullscreen') {
        out.push({
            id: 'fullscreen',
            problem: 'League is set to Fullscreen. Windows lets nothing draw over a fullscreen game, so the overlay cannot show.',
            fix: 'In game: Esc → Video → Window Mode → Windowed (at your screen resolution) or Borderless.',
        });
    } else if (env.windowMode === null) {
        out.push({
            id: 'unknown-mode',
            problem: 'One Trick could not find League’s settings file, so it cannot check the display mode.',
            fix: 'Make sure League is not in Fullscreen: Esc → Video → Window Mode → Windowed or Borderless.',
        });
    }
    if (env.windowedGameOptimizations === true) {
        out.push({
            id: 'windowed-optimizations',
            problem: 'Windows “Optimizations for windowed games” is on. It can make Windows stop drawing overlays over League mid-game.',
            fix: 'Settings → System → Display → Graphics → Change default graphics settings → turn Optimizations for windowed games off.',
        });
    }
    if (env.mpoOff === false) {
        out.push({
            id: 'mpo',
            problem: 'Multiplane overlay (MPO) is on. On some graphics drivers it hides overlays over games.',
            fix: 'In PowerShell as administrator: reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm /v OverlayTestMode /t REG_DWORD /d 5 /f — then restart the PC.',
        });
    }
    return out;
}
```

`verify_ranked.ts:27-49` — the ranked guardrail assertions, verbatim:
```ts
ok(!isMayhemGame('CLASSIC', 'Summoners Rift'), 'ranked SR is not Mayhem');
ok(!isMayhemGame('RANKED', 'Summoners Rift'), 'RANKED mode string is not Mayhem');
ok(isMayhemGame('KIWI', 'Howling Abyss'), 'KIWI ARAM Mayhem detected');
ok(!isAramOrMayhem('CLASSIC', 'Summoners Rift'), 'SR classic is not ARAM');
ok(isAramOrMayhem('ARAM', 'Howling Abyss'), 'classic ARAM map detected');

const yoneMid = resolveProfileId({
  inGame: true,
  gameMode: 'CLASSIC',
  mapName: 'Summoners Rift',
  gameTime: 600,
  localPlayer: {
    championName: 'Yone',
    position: 'MIDDLE',
    level: 8,
    items: [],
  },
});
ok(yoneMid === 'yone-mid', `ranked Yone mid profile (${yoneMid})`);

ok(!isMayhemAugmentHudVisible([], false), 'no augment HUD while playing SR');

if (!process.exitCode) console.log('verify:ranked ok');
```

`verify_augment_schedule.ts:64-68` — first-pick timing assertions (test.27 semantics):
```ts
const spawnL1 = computeMayhemPickPhase({ level: 1, gameTime: 5, isDead: false, wasDead: false, ownedAugmentCount: 0 });
ok(spawnL1.pickWindowOpen && spawnL1.ocrBurst, 'first augment on spawn at level 1 opens the window alive');
const spawnL3 = computeMayhemPickPhase({ level: 3, gameTime: 5, isDead: false, wasDead: false, ownedAugmentCount: 0 });
ok(spawnL3.pickWindowOpen, 'first augment on spawn at level 3 opens the window alive');
if (!process.exitCode) console.log('verify:augment-schedule ok');
```

---

## 3. Current state — verbatim output

Command run: `npm run verify:release *> C:\Users\Az040\AppData\Local\Temp\opencode\otc-verify-release.log` in `C:\Users\Az040\Projects\One-Trick-Client`.

**Exit code (verbatim):**
```
EXITCODE=0
```

**Lint (verbatim from log, lines 3-11):**
```
npm notice run one-trick@1.7.1-test.18 lint
npm notice run eslint .
[baseline-browser-mapping] The data in this module is over two months old.  To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`

C:\Users\Az040\Projects\One-Trick-Client\src\overlay\OverlayApp.tsx
  1289:3  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

Γ£û 1 problem (0 errors, 1 warning)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```
(`Γ£û` is the checkmark glyph as captured by PowerShell redirection; ESLint emitted 0 errors and 1 pre-existing warning.)

**Selected per-suite summary lines (verbatim, in run order):**
```
verify:perf-budget ok
verify:cue-rank ok
verify:map-scheme ok
verify:overlay-clock ok
verify:no-winrate-claims ok
verify:catalog ok
verify:layout ok
recorder detection ok
verify_overlay_environment: all ok
verify_ps_worker: all ok
verify_live_builds: all ok
verify_riot_api: all ok
verify:destroyed-guards ok
verify:stats ok
verify:ranked ok
verify:aram-profile ok
verify:mayhem-reroll-refresh ok
verify:riot-identity ok
verify:mayhem-bundle ok
verify:mayhem ok
verify:mayhem-match ok
verify:mayhem-visibility ok
verify:mayhem-defaults ok
verify:mayhem-capture-gating ok
verify:mayhem-poll-watchdog ok
verify:mayhem-monitor ok
verify:mayhem-offers ok
verify:mayhem-ocr ok
verify:mayhem-ocr-lines ok
verify:mayhem-fixtures ok
verify:mayhem-self-capture ok
verify:ocr-geometry-actual ok
verify:global-hotkeys ok
verify:augment-schedule ok
verify:clipper ok
verify:clipper-lifecycle ok
verify:game-state ok
verify:state-service ok
verify:game-monitor ok
verify:ipc-surface ok
verify:electron-paths ok
verify:packaging ok
verify:stale-launcher ok — customInstall: 6 Delete, 3 RMDir, 2 nsExec::ExecToLog, 2 Pop $0, 4 OneTrick delete | whole file: 3 RMDir, 2 reg delete, 0 conditionals
verify:purchase-order ok
PASS — verify_app_density: 0 failing invariant(s)
verify:review-fixes ok
```

**Failure scan:** a `Select-String` for `FAIL|error TS|Error:|failed` found no failing assertion. The lines containing "failed" are test *names* (e.g. `ok a failed capture does not swallow the pick (it neither counts nor resets)`) and one expected negative-test log line:
```
[mayhem] refresh failed: Error: implausible augment payload (0 augments, need 50)
```
The OCR suite printed its own tally verbatim:
```
Summary: 0 FAIL, 20 PASS
```
The last line of the whole run is `verify:review-fixes ok`. **No test is currently failing.**

**Known open items from `docs/ai/HANDOFF.md` (verbatim, not test failures):**
```
179: - **Phase 1**: Anthony reports the overlay now stays up with overlay-diag-20 (occasional ~1 s blink, no logs yet). Accepted as good enough to move on; the strict presenter.log gate (1 `created`, 0 `destroy`, frames flowing) is still unproven on the League PC. The blink is the next thing to read once logs arrive (look for presenter `state` lines with covered=1/fgAbove=1 or a quns change at that time).
```
```
162: - **League is not installed on this PC.** `C:\Riot Games\League of Legends` is gone; only AppCompat entries remain. It is a hybrid-GPU laptop (Intel UHD drives the 1920x1080 60 Hz panel, RTX 4050 renders). Which PC the failing matches ran on is the first open question.
```
```
170: - **Phase 1 gate: OPEN.** It needs one full ranked match on the League PC with this build: an overlay that stays up to the end, and presenter.log showing one `created`, `state` lines with frames rising, and `destroy` only after the match ends. If it vanishes, the `state` line at that time decides the mechanism: `fgAbove=1` = z-order; `quns=3` = exclusive fullscreen; `shown=1 visible=1 topmost=1 fgAbove=0 quns!=3` with frames rising = DWM not compositing (flip model / MPO).
```
```
215: - Still open: "mid-game didn't work well" needs logs (frame reasons in mayhem frame log lines).
```
```
180: - **PR #47 salvage**: nothing taken. test.18 already supersedes each piece: Map12 sensing (`detectMayhemMode`), the OCR null/[] fix (reads now carry fresh/valid/decision), Riot ID in status (`formatRiotId`). `riot-identity.ts` (puuid store) is left for Phase 3 if needed.
```

**Environment limits (facts):** no League install and no real-match presenter logs on this PC; `--live` gates (`verify:live-builds:live`, `verify:riot-api --live`) need network/key; `npm run verify:presenter-live` / `smoke:native-overlay` are host-only and live in `verify:local-extended` (`package.json:142-144`).

---

## 4. What NOT to touch

- **Nothing outside the task:** `website/**`, `docs/**` (except this pack), `release/**`, `dist/**`, `dist-electron/**`, `out/**`, `node_modules/**`, `build/**`, `packaging/**`, `recordings/**`, `test-fixtures/**`, `.github/**`, `.obsidian/**`, `.cursor/**`, `scripts/perf/**`.
- **Frozen tests:** `PLAN.md:17` — "Test files already in the repo are frozen; new test files are allowed." `PLAN.md:38` — `verify_overlay_health.ts` is FROZEN (add a new `verify_overlay_fallback.ts` instead); `verify_native_presenter.ts` additions only (`PLAN.md:33`).
- **Ranked behavior is a guardrail, not a target:** do not change `detectMayhemMode()` precedence for known classic queues (450/100), `resolveProfileId()`'s non-ARAM role path, `routeHotkey()`'s non-ARAM branch (`flash-primary`/`flash-secondary`), or `loadingStats.ts` ranked scoping. `verify_ranked.ts` and `verify_aram_profile.ts` encode these.
- **Overlay stability code is diagnostic-critical:** do not remove the presenter `state` line (`native/presenter/presenter.c:325-364`), the pipe-close-before-kill ordering in `overlay-presenter.ts:850-898`, or the supervisor backoff/fallback rules; the next real-match diagnosis depends on them.
- **Version stamping:** do not edit `package.json:4`; per `docs/ai/HANDOFF.md:221` the release version comes from `extraMetadata` in `scripts/package-test-build.ps1`.
- **No publishing / paid actions:** the user wants free options only; ask before anything that publishes or costs credits.
- **This session:** do not write code, do not fix anything, do not spawn subagents, and change no file except `docs/ai/CONTEXT-PACK.md`.

## 5. Gate for the next session

`npm run verify:release` (package.json:159) is the full gate and is green at the time of writing. Any change to ARAM/Mayhem elements, ranked resolution, or the overlay path must leave it green. Targeted suites for this task: `verify:ranked`, `verify:aram-profile`, `verify:augment-schedule`, `verify:mayhem-monitor`, `verify:mayhem-visibility`, `verify:mayhem-offers`, `verify:mayhem-self-capture`, `verify:overlay-health`, `verify:native-presenter`, `verify:presenter-frame`, `verify:presenter-supervisor`, `verify:destroyed-guards`, `verify:overlay-environment`, `verify:live-builds`, `verify:riot-api`.
