/**
 * verify_real_game_regressions.ts — the real ARAM Mayhem game's regressions.
 *
 * A Live Client Mayhem game reports `gameMode: "ARAM"` on `Map12` with an
 * unknown queue. These checks pin the fixes for that game, behaviourally
 * wherever the behaviour is provable without Electron:
 *   - mode detection: unknown Howling Abyss queue is `mayhem-likely` (all
 *     Mayhem features), a known 450/100 stays `aram`;
 *   - scan scheduling: the unknown-queue game keeps the NORMAL Mayhem cadence
 *     past the old 90 s discovery window, even with no offers on screen;
 *   - live augment ingestion: the `mayhem-likely` mode is what gates reading
 *     `activePlayer.augments`;
 *   - hotkey routing + PageUp dismissal on classic ARAM 450 with a live panel;
 *   - OCR: a missing game window falls back to the PRIMARY screen's full
 *     bounds (fake two-monitor layout, cursor on the secondary), masks in that
 *     space; ps1 interpolation fixed;
 *   - history scoping: shared `getMatchHistory` stays Rift-only, the loading
 *     summaries keep the ARAM family (mixed-queue fixture);
 *   - queue-aware loading stats;
 *   - Ahri in Mayhem gets CONCRETE mage/AP item ids from the real catalog,
 *     with the Mayhem AP reorder applied;
 *   - setOverlayUserHidden(false) never re-shows an already-shown window;
 *   - the mounted loading → HUD handoff (scripts/verify-overlay-handoff.mjs).
 *
 * Run: npx --yes tsx verify_real_game_regressions.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  detectMayhemMode,
  isAramOrMayhem,
  isMayhemGame,
  isMayhemMode,
  type MayhemModeSignals,
} from './src/logic/mayhem/mode';
import { routeHotkey } from './src/logic/mayhem/hotkey';
import { parseMayhemOcrOutput } from './src/logic/mayhem/ocrOutput';
import {
  createMayhemMonitorState,
  mayhemMonitorMode,
  mayhemMonitorWantsScan,
  noteMayhemManualScan,
  runMayhemMonitorScan,
  type MayhemMonitorRead,
} from './src/logic/mayhem/monitor';
import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';
import { readLiveAugmentIds } from './src/logic/mayhem/pickCount';
import {
  ARAM_QUEUES,
  HOWLING_ABYSS_MAP_ID,
  computeLoadingStats,
  type LoadingMatchLike,
} from './src/overlay/loadingStats';
import {
  getMatchHistory,
  getMatchHistorySummaries,
  isAramFamilyHistoryGame,
  isRiftHistoryGame,
  type LcuRequest,
} from './electron/match-history';
import { resolveChampionProfileId } from './src/overlay/overlayLogic';
import { getProfile } from './src/logic/profiles';
import { ingestChampionCatalog } from './src/data/championCatalog';
import { catalogItemsById, recommendationFor } from './src/catalog/client';
import { recommendationToBuild } from './src/catalog/loadout';
import { adjustBuildForMayhem } from './src/logic/mayhem/buildAdjust';
import bundledMayhem from './src/data/mayhem/bundle.json';
import type { MayhemBundle } from './src/logic/mayhem/types';
import type { CatalogBundle } from './src/catalog/types';
import type { OverlayState } from './src/overlay/overlayLogic';
import { isOverlayUserHidden, setOverlayUserHidden } from './electron/overlay-window';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const mayhemBundle = bundledMayhem as MayhemBundle;

const UNKNOWN_ARAM: MayhemModeSignals = {
  gameMode: 'ARAM',
  mapName: 'Map12',
  queueId: null,
  mapId: 12,
};
const CLASSIC_ARAM: MayhemModeSignals = {
  gameMode: 'ARAM',
  mapName: 'Map12',
  queueId: 450,
  mapId: 12,
};

function emptyRead(): MayhemMonitorRead {
  return {
    ids: [],
    candidateIds: [],
    frameIds: [],
    fresh: true,
    valid: true,
    fuzzyScore: 0.93,
    blackFrame: false,
    foreground: true,
  };
}

const game = (
  championId: number,
  win: boolean,
  queueId: number,
  mapId?: number
): LoadingMatchLike => ({ championId, win, kills: 5, deaths: 2, assists: 8, queueId, mapId });

async function main(): Promise<void> {
  console.log('--- verify:real-game: mode detection ---');
  {
    ok(
      detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', mapId: 12, queueId: null }) ===
        'mayhem-likely',
      'unknown queue on Howling Abyss is mayhem-likely'
    );
    ok(isMayhemGame('ARAM', 'Map12', { mapId: 12, queueId: null }), 'mayhem-likely enables every Mayhem feature');
    ok(isMayhemMode('mayhem-likely'), 'mayhem-likely is a Mayhem mode');
    ok(
      detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', queueId: 450, mapId: 12 }) === 'aram',
      'classic ARAM 450 stays aram'
    );
    ok(
      detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', queueId: 100, mapId: 12 }) === 'aram',
      'classic ARAM 100 stays aram'
    );
    ok(
      detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', queueId: 2400, mapId: 12 }) === 'mayhem',
      'Mayhem queue 2400 is mayhem'
    );
    ok(detectMayhemMode({ gameMode: 'KIWI', mapName: 'Map12', queueId: null }) === 'mayhem', 'KIWI mode string is mayhem');
    ok(
      detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', queueId: 9999, mapId: 12 }) === 'mayhem',
      'a known non-ARAM queue on Howling Abyss is mayhem'
    );
    ok(
      detectMayhemMode({ gameMode: 'CLASSIC', mapName: 'Map11', queueId: 420, mapId: 11 }) === 'other',
      "Summoner's Rift is other"
    );
    ok(isAramOrMayhem('ARAM', 'Map12', { queueId: null, mapId: 12 }), 'ARAM-family includes mayhem-likely');
  }

  console.log('--- verify:real-game: unknown-queue scan schedule beyond 90 s ---');
  {
    let state = createMayhemMonitorState();
    ok(
      mayhemMonitorWantsScan(state, UNKNOWN_ARAM, 1_000) === 'mayhem',
      'the unknown-queue game requests the normal Mayhem scan, not bounded discovery'
    );
    let scans = 0;
    let lastScanAt = -1;
    // Two minutes of 1 s ticks with a valid EMPTY frame: no offers ever classify
    // the match, so only the mode's schedule can keep it scanning.
    for (let now = 1_000; now <= 121_000; now += 1_000) {
      const result = await runMayhemMonitorScan(
        state,
        { now, level: 6, isDead: false, signals: UNKNOWN_ARAM, liveAugmentIds: [], autoOcrAllowed: true },
        async () => emptyRead()
      );
      state = result.state;
      if (result.scanned) {
        scans += 1;
        lastScanAt = now;
      }
    }
    ok(scans >= 100, `the normal schedule keeps scanning every tick (${scans} scans in 120 s)`);
    ok(lastScanAt > 90_000, `a scan still runs past the old 90 s discovery burst (last at ${lastScanAt} ms)`);
    ok(state.discovery.latched === false, 'empty frames never latch the unknown queue');
  }

  console.log('--- verify:real-game: live augment ingestion is gated by isMayhemMode ---');
  {
    let monitor: typeof import('./electron/game-monitor') | null = null;
    try {
      monitor = await import('./electron/game-monitor');
    } catch (error) {
      console.error('could not import electron/game-monitor:', String(error));
    }
    const gate = monitor?.shouldSyncMayhemPickPhase;
    ok(typeof gate === 'function', 'game-monitor exposes the live-pick-phase mode gate');
    if (typeof gate === 'function') {
      ok(gate('mayhem-likely') === true, 'mayhem-likely ingests activePlayer augments');
      ok(gate('mayhem') === true, 'mayhem ingests activePlayer augments');
      ok(gate('aram') === false && gate('other') === false, 'classic ARAM and other modes do not');
    }
    const live = readLiveAugmentIds({ augments: [{ augmentId: 'purist___caster' }, 'vitality_amp' ] });
    ok(
      live.includes('purist___caster') && live.includes('vitality_amp'),
      'the Live Client augment list is what the sync reads'
    );
  }

  console.log('--- verify:real-game: hotkey routing + PageUp dismissal ---');
  {
    const aram = { inGame: true, aramFamily: true };
    const rift = { inGame: true, aramFamily: false };
    ok(routeHotkey('PageDown', aram) === 'mayhem-scan', 'PageDown scans in an ARAM-family game');
    ok(routeHotkey('PageUp', aram) === 'mayhem-dismiss', 'PageUp dismisses in an ARAM-family game');
    ok(routeHotkey('PageDown', rift) === 'flash-secondary', 'PageDown stays Flash outside ARAM');
    ok(routeHotkey('PageUp', rift) === 'flash-primary', 'PageUp stays Flash outside ARAM');
    ok(routeHotkey('PageDown', { inGame: false, aramFamily: true }) === null, 'no routing without a game');
    ok(routeHotkey('KeyA', aram) === null, 'unrelated keys are not routed');

    // Queue 450 lifecycle: PageDown's two offers are visible, PageUp dismisses.
    const panelIds = ['jeweled_gauntlet', 'giant_slayer'];
    const panelRead: MayhemMonitorRead = { ...emptyRead(), ids: panelIds, frameIds: panelIds };
    const state = createMayhemMonitorState();
    ok(noteMayhemManualScan(state, CLASSIC_ARAM, panelRead) === false, 'a classic ARAM manual scan never latches Mayhem');
    ok(mayhemMonitorMode(state, CLASSIC_ARAM) === 'aram', 'classic ARAM 450 stays ARAM after the scan');
    const panelShown = isMayhemAugmentHudVisible(panelIds, true, { consecutiveScans: 1, fuzzyScore: 0.95 });
    ok(panelShown, 'PageDown leaves the offers visible on queue 450');
    let monitor: typeof import('./electron/game-monitor') | null = null;
    try {
      monitor = await import('./electron/game-monitor');
    } catch (error) {
      console.error('could not import electron/game-monitor:', String(error));
    }
    const canDismiss = monitor?.canDismissMayhemPanel;
    ok(typeof canDismiss === 'function', 'game-monitor exposes the PageUp dismissal gate');
    if (typeof canDismiss === 'function') {
      ok(
        canDismiss({ inGame: true, hasPayload: true, aramFamily: true, panelShown }) === true,
        'PageUp dismisses a visible panel on queue 450'
      );
      ok(
        canDismiss({ inGame: true, hasPayload: true, aramFamily: true, panelShown: false }) === false,
        'PageUp does nothing with no panel on screen'
      );
      ok(
        canDismiss({ inGame: true, hasPayload: true, aramFamily: false, panelShown: true }) === false,
        'PageUp never dismisses outside the ARAM family'
      );
    }
    ok(
      !isMayhemAugmentHudVisible([], false, { consecutiveScans: 0, fuzzyScore: 0 }),
      'the panel is hidden after dismissal purges the offers'
    );
  }

  console.log('--- verify:real-game: OCR fallback + primary-screen geometry ---');
  {
    const fallback = parseMayhemOcrOutput('Augment One\nAugment Two\n__OT_FALLBACK__');
    ok(fallback.fallback && !fallback.noTarget, 'a fallback capture is not a no-target read');
    ok(fallback.text.includes('Augment One'), 'fallback text is kept, never dropped');
    const missing = parseMayhemOcrOutput('__OT_NO_TARGET__');
    ok(missing.noTarget && !missing.fallback, 'a true capture failure still reports no target');
    const withTarget = parseMayhemOcrOutput('__OT_TARGET__{"pid":7,"exe":"League of Legends","class":"RiotWindowClass"}');
    ok(withTarget.target?.exe === 'League of Legends', 'window metadata still parses');

    const ps1 = fs.readFileSync('electron/scripts/mayhem-ocr.ps1', 'utf8');
    ok(ps1.includes('__OT_${Name} ${Detail}__'), 'the ps1 detail interpolation is fixed');
    ok(!ps1.includes('__OT_${Name} $Detail__'), 'the broken ps1 interpolation is gone');
    ok(ps1.includes("Write-Marker 'FALLBACK'"), 'the ps1 marks a primary-screen fallback');
    ok(ps1.includes('Capture-PrimaryScreen'), 'the ps1 fallback captures through one primary-screen helper');
    ok(!/Cursor\]::Position/.test(ps1), 'the fallback never follows the cursor to another monitor');
    ok(
      /isGameProcess\s*=\s*\$proc\.ProcessName\s*-match\s*'\^League of Legends/.test(ps1),
      'the window finder also accepts the League of Legends process name'
    );
    ok(/isRiotClass\s*-or\s*\$isGameProcess/.test(ps1), 'window matching is class OR process, not both');

    const ocr = fs.readFileSync('electron/mayhem-ocr.ts', 'utf8');
    ok(ocr.includes("overlayLog('ocr-target', { target: 'fallback', source: 'fallback' })"), 'a fallback logs target=fallback/source=fallback');
    ok(/source: 'window'/.test(ocr), 'a window capture logs source=window');
    ok(/parsed\.fallback\s*\?\s*true/.test(ocr), 'fallback frames are treated as foreground-valid');

    // The pure mirror of the ps1 arithmetic, with a fake two-monitor layout:
    // primary 1920x1080 at the origin, secondary 2560x1440 at x=1920, cursor on
    // the secondary. The fallback must still be the primary's FULL bounds.
    let region: typeof import('./src/logic/mayhem/captureRegion') | null = null;
    try {
      region = await import('./src/logic/mayhem/captureRegion');
    } catch (error) {
      console.error('could not import the capture-region mirror:', String(error));
    }
    if (region) {
      const primary = { x: 0, y: 0, width: 1920, height: 1080 };
      const secondary = { x: 1920, y: 0, width: 2560, height: 1440 };
      const fallbackRegion = region.primaryFallbackRegion(primary, secondary);
      ok(
        fallbackRegion.left === 0 &&
          fallbackRegion.top === 0 &&
          fallbackRegion.width === primary.width &&
          fallbackRegion.height === primary.height,
        'a missing game window captures the primary screen, not the cursor monitor'
      );
      ok(
        fallbackRegion.width === primary.width,
        'the fallback is the full screen, not a fractional crop'
      );
      const mask = { x: 500, y: 300, width: 400, height: 200 };
      const local = region.screenRectToCapture(mask, fallbackRegion);
      ok(
        local.left === 500 && local.top === 300 && local.width === 400 && local.height === 200,
        'masks are translated in the primary-screen capture space'
      );
      const windowRegion = region.fractionalOfferRegion({ x: 100, y: 200, width: 1000, height: 800 });
      ok(
        windowRegion.left === 180 &&
          windowRegion.top === 344 &&
          windowRegion.width === 840 &&
          windowRegion.height === 496,
        'a game-window capture still crops the offer band of its own bounds'
      );
    }
  }

  console.log('--- verify:real-game: loading stats by queue ---');
  {
    const matches: LoadingMatchLike[] = [
      game(103, true, 450, 12),
      game(103, false, 450, 12),
      game(103, true, 100, 12),
      game(103, true, 2400, 12),
      game(103, true, 420, 11),
      game(103, false, 400, 11),
    ];
    const aram = computeLoadingStats(matches, 103, 450);
    ok(aram.scope === 'aram' && aram.games === 3, `450 scopes to ARAM games (${aram.games})`);
    const mayhem = computeLoadingStats(matches, 103, 2400);
    ok(mayhem.scope === 'aram-family' && mayhem.games === 4, `thin Mayhem history widens to ARAM & Mayhem (${mayhem.games})`);
    const ranked = computeLoadingStats(matches, 103, 420);
    ok(ranked.scope === 'ranked' && ranked.games === 1, `420 scopes to ranked (${ranked.games})`);
    const rift = computeLoadingStats(matches, 103, 400);
    ok(rift.scope === 'rift' && rift.games === 2, `a normal Rift queue scopes to Rift (${rift.games})`);
    const unknown = computeLoadingStats(matches, 103, null);
    ok(unknown.games === 0 && unknown.scope === null, 'an unknown queue shows no stats');
    ok(computeLoadingStats(matches, 103, null, true).scope === 'aram-family', 'mayhem-likely folds the ARAM family');
    ok(ARAM_QUEUES.has(450) && ARAM_QUEUES.has(100) && !ARAM_QUEUES.has(2400), 'ARAM queues are 450/100 only');
  }

  console.log('--- verify:real-game: shared history stays Rift-only, loading summaries keep ARAM ---');
  {
    const raw = (
      gameId: number,
      queueId: number,
      mapId: number | undefined
    ): Record<string, unknown> => ({
      gameId,
      gameCreation: 1_700_000_000_000 + gameId,
      gameDuration: 1800,
      queueId,
      mapId,
      participants: [
        { participantId: 1, championId: 103, teamId: 100, stats: { win: true, kills: 1, deaths: 2, assists: 3 } },
      ],
      participantIdentities: [],
    });
    const page = {
      games: {
        games: [
          raw(1, 420, 11),
          raw(2, 450, 12),
          raw(3, 2400, 12),
          raw(4, 0, 12),
          raw(5, 400, 11),
        ],
      },
    };
    const request: LcuRequest = async (_method, endpoint) => {
      if (endpoint.startsWith('/lol-summoner')) return { puuid: 'fixture-puuid' };
      if (endpoint.includes('begIndex=0')) return page;
      return { games: { games: [] } };
    };
    try {
      const shared = await getMatchHistory({ count: 5, detailLimit: 0, canFetchDetails: () => false, request });
      const sharedQueues = shared.map((g) => g.queueId).sort((a, b) => a - b);
      ok(
        JSON.stringify(sharedQueues) === JSON.stringify([400, 420]),
        `getMatchHistory (Stats/Home/main pick) stays Rift-only (${sharedQueues.join(',')})`
      );
    } catch (error) {
      ok(false, `getMatchHistory accepts the fixture transport and stays Rift-only (${String(error)})`);
    }
    try {
      const summaries = await getMatchHistorySummaries({ count: 5, session: 90, request });
      const summaryQueues = summaries.map((g) => g.queueId).sort((a, b) => a - b);
      ok(
        JSON.stringify(summaryQueues) === JSON.stringify([0, 400, 420, 450, 2400]),
        `the loading summaries include the ARAM family (${summaryQueues.join(',')})`
      );
    } catch (error) {
      ok(false, `the loading summaries keep the ARAM family (${String(error)})`);
    }
    ok(isRiftHistoryGame(420) && !isRiftHistoryGame(450), 'the Rift filter is Rift-only');
    ok(isAramFamilyHistoryGame(450, 12) && isAramFamilyHistoryGame(0, HOWLING_ABYSS_MAP_ID), 'the ARAM-family filter keeps 450 and map 12');
    ok(!isAramFamilyHistoryGame(420, 11), 'the ARAM-family filter rejects the Rift');
  }

  console.log('--- verify:real-game: Ahri in Mayhem gets concrete mage items ---');
  {
    const apiDir = path.join(process.cwd(), 'website/public/api/v1');
    const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(apiDir, file), 'utf8'));
    const catalog: CatalogBundle = {
      manifest: readJson('manifest.json') as CatalogBundle['manifest'],
      champions: readJson('champions.json') as CatalogBundle['champions'],
      items: readJson('items.json') as CatalogBundle['items'],
      runes: readJson('runes.json') as CatalogBundle['runes'],
      recommendations: readJson('recommendations.json') as CatalogBundle['recommendations'],
      profiles: readJson('profiles.json') as CatalogBundle['profiles'],
    };
    ingestChampionCatalog(catalog.champions);
    const state = {
      gameMode: 'ARAM',
      mapName: 'Map12',
      mapId: 12,
      queueId: null,
      localPlayer: { championName: 'Ahri', position: 'MIDDLE' },
    } as unknown as OverlayState;
    const id = resolveChampionProfileId(state);
    ok(id === 'generic:Ahri:Mid', `Ahri resolves to her own Mid profile (${id})`);
    const profile = getProfile(id);
    ok(profile.championId === 'Ahri' && profile.role === 'Mid', `the profile is Ahri Mid (${profile.role})`);
    ok(profile.id !== 'pyke-support', 'Ahri never falls back to Pyke support');

    const ahri = catalog.champions.find((c) => c.id === 'Ahri');
    ok(!!ahri, 'Ahri is in the shipped catalog');
    const rec = recommendationFor(ahri!, 'Mid', catalog);
    const build = recommendationToBuild(rec, catalogItemsById(catalog));
    ok(
      build.core.map((i) => i.id).join(',') === '2503,6655,3137',
      `Ahri's core is the mage AP build (${build.core.map((i) => i.id).join(',')})`
    );
    ok(build.boots.id === '3020', `Ahri builds Sorcerer's Shoes (${build.boots.id})`);

    const apAugment = mayhemBundle.augments.find((a) => (a.tags || []).includes('ap'));
    ok(!!apAugment, 'the Mayhem bundle has an AP augment');
    const adjusted = adjustBuildForMayhem(build, [apAugment!.id], mayhemBundle)!;
    const adjustedIds = adjusted.core.map((i) => i.id);
    ok(adjustedIds[0] === '2503', `Blackfire Torch stays first (${adjustedIds.join(',')})`);
    ok(
      adjustedIds.indexOf('3137') < adjustedIds.indexOf('6655'),
      'the AP augment reorders the mage core (Cryptbloom before Luden\'s)'
    );
    ok(
      adjusted.core.every((item) => /Mayhem · AP augments/.test(item.reason || '')),
      'every adjusted core item carries the Mayhem AP reason'
    );
    ok(
      adjusted.situational.map((i) => i.id).join(',') === '3157,3135,3102,3165',
      `the situational AP order is applied (${adjusted.situational.map((i) => i.id).join(',')})`
    );

    const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
    ok(app.includes('resolveChampionProfileId'), 'the overlay resolves the ARAM champion profile');
    ok(app.includes('championProfileKnown'), 'the overlay can hide a build for an unknown champion');
  }

  console.log('--- verify:real-game: match start never re-shows a shown overlay ---');
  {
    const calls = { show: 0, hide: 0 };
    const deps = {
      isShown: () => true,
      show: () => {
        calls.show += 1;
      },
      hide: () => {
        calls.hide += 1;
      },
      broadcast: () => {},
    };
    let threw = '';
    try {
      setOverlayUserHidden(false, deps);
    } catch (error) {
      threw = String(error);
    }
    ok(!threw, 'setOverlayUserHidden(false) runs without touching the real Electron window');
    ok(calls.show === 0, 'an already-shown window is never re-shown (showOverlay not called)');
    ok(isOverlayUserHidden() === false, 'the non-hidden flag stays clear');

    try {
      setOverlayUserHidden(true, deps);
    } catch {
      /* ignore */
    }
    ok(calls.hide === 1, 'hiding the overlay still hides it');
    calls.show = 0;
    const hiddenDeps = { ...deps, isShown: () => false };
    try {
      setOverlayUserHidden(false, hiddenDeps);
    } catch {
      /* ignore */
    }
    ok(calls.show === 1, 'clearing a hide on a window that is not shown still shows it');

    const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
    const begin = monitor.slice(monitor.indexOf('function beginMatch'), monitor.indexOf('function resolveMatchQueueAfterStart'));
    ok(begin.includes('isOverlayUserHidden()'), 'match start clears the hide only when it was set');
    ok(!begin.includes('createOverlayWindow()'), 'match start does not re-create the overlay window');
    ok(begin.includes('ensureOverlayShown()'), 'match start reuses the existing overlay window');
  }

  console.log('--- verify:real-game: mounted loading → HUD handoff ---');
  {
    const child = spawnSync(process.execPath, [path.join('scripts', 'verify-overlay-handoff.mjs')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 180_000,
    });
    const output = `${child.stdout || ''}\n${child.stderr || ''}`;
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('ok ') || line.startsWith('FAIL ')) console.log(line);
    }
    ok(
      child.status === 0,
      `the mounted handoff harness passes (exit ${child.status ?? 'none'})` +
        (child.status === 0 ? '' : `\n${lines.filter((l) => l.startsWith('FAIL')).join('\n')}`)
    );
  }

  console.log('--- verify:real-game: diagnostics ---');
  {
    const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
    ok(monitor.includes('export function isAramFamilyMatchActive'), 'main can ask whether the live game is ARAM-family');
    ok(
      monitor.includes("makeLCURequest('GET', '/lol-gameflow/v1/session'"),
      'one in-game session read can fill an unknown queue'
    );
    ok(
      monitor.includes('isMayhemMode(mode)') && monitor.includes('isMayhemMode(currentMayhemMode())'),
      'mayhem-likely starts the normal OCR schedule'
    );
  }

  if (failures) {
    console.error(`verify:real-game FAILED (${failures})`);
    process.exit(1);
  }
  console.log('verify:real-game ok');
}

void main();
