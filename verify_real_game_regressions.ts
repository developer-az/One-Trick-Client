/**
 * verify_real_game_regressions.ts — the real ARAM Mayhem game's regressions.
 *
 * A Live Client Mayhem game reports `gameMode: "ARAM"` on `Map12` with an
 * unknown queue. These checks pin the fixes for that game:
 *   - mode detection: unknown Howling Abyss queue is `mayhem-likely` (all
 *     Mayhem features), a known 450/100 stays `aram`;
 *   - hotkey routing: PageUp/PageDown pick the Mayhem action in any ARAM-family
 *     game and the Flash action only outside it;
 *   - OCR: a missing game window falls back to the primary screen instead of
 *     invalidating the read; the ps1 marker interpolation is fixed;
 *   - queue-aware loading stats and ARAM-family history;
 *   - Ahri in Mayhem resolves Ahri's own (mage) profile, not a support build;
 *   - pet ground line removed, handoff fade layer present;
 *   - the two overlay.log diagnostics exist.
 *
 * Run: npx --yes tsx verify_real_game_regressions.ts
 */
import fs from 'node:fs';
import {
  detectMayhemMode,
  isAramOrMayhem,
  isMayhemGame,
  isMayhemMode,
} from './src/logic/mayhem/mode';
import { routeHotkey } from './src/logic/mayhem/hotkey';
import { parseMayhemOcrOutput } from './src/logic/mayhem/ocrOutput';
import {
  ARAM_QUEUES,
  HOWLING_ABYSS_MAP_ID,
  computeLoadingStats,
  type LoadingMatchLike,
} from './src/overlay/loadingStats';
import { isSupportedHistoryGame } from './electron/match-history';
import { resolveChampionProfileId } from './src/overlay/overlayLogic';
import { getProfile } from './src/logic/profiles';
import { ingestChampionCatalog } from './src/data/championCatalog';
import type { OverlayState } from './src/overlay/overlayLogic';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const game = (
  championId: number,
  win: boolean,
  queueId: number,
  mapId?: number
): LoadingMatchLike => ({ championId, win, kills: 5, deaths: 2, assists: 8, queueId, mapId });

console.log('--- verify:real-game: mode detection ---');
{
  // The real game: Live Client says ARAM on Map12, queue unknown.
  ok(
    detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', mapId: 12, queueId: null }) ===
      'mayhem-likely',
    'unknown queue on Howling Abyss is mayhem-likely'
  );
  ok(
    isMayhemGame('ARAM', 'Map12', { mapId: 12, queueId: null }),
    'mayhem-likely enables every Mayhem feature'
  );
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
  ok(
    detectMayhemMode({ gameMode: 'KIWI', mapName: 'Map12', queueId: null }) === 'mayhem',
    'KIWI mode string is mayhem'
  );
  ok(
    detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', queueId: 9999, mapId: 12 }) === 'mayhem',
    'a known non-ARAM queue on Howling Abyss is mayhem'
  );
  ok(
    detectMayhemMode({ gameMode: 'CLASSIC', mapName: 'Map11', queueId: 420, mapId: 11 }) === 'other',
    'Summoner\'s Rift is other'
  );
  ok(
    isAramOrMayhem('ARAM', 'Map12', { queueId: null, mapId: 12 }),
    'ARAM-family includes mayhem-likely'
  );
}

console.log('--- verify:real-game: hotkey routing ---');
{
  const aram = { inGame: true, aramFamily: true };
  const rift = { inGame: true, aramFamily: false };
  ok(routeHotkey('PageDown', aram) === 'mayhem-scan', 'PageDown scans in an ARAM-family game');
  ok(routeHotkey('PageUp', aram) === 'mayhem-dismiss', 'PageUp dismisses in an ARAM-family game');
  ok(routeHotkey('PageDown', rift) === 'flash-secondary', 'PageDown stays Flash outside ARAM');
  ok(routeHotkey('PageUp', rift) === 'flash-primary', 'PageUp stays Flash outside ARAM');
  ok(routeHotkey('PageDown', { inGame: false, aramFamily: true }) === null, 'no routing without a game');
  ok(routeHotkey('KeyA', aram) === null, 'unrelated keys are not routed');
  const main = fs.readFileSync('electron/main.ts', 'utf8');
  ok(
    main.includes("hotkeyRoute('PageDown'") && main.includes("overlayLog('hotkey'"),
    'the real main-process handlers drive routeHotkey and log the route'
  );
  ok(
    /routed:\s*routed\s*\?\?\s*'none'/.test(main),
    'the hotkey log line carries the routed destination'
  );
}

console.log('--- verify:real-game: OCR fallback ---');
{
  const fallback = parseMayhemOcrOutput('Augment One\nAugment Two\n__OT_FALLBACK__');
  ok(fallback.fallback && !fallback.noTarget, 'a fallback capture is not a no-target read');
  ok(fallback.text.includes('Augment One'), 'fallback text is kept, never dropped');
  const missing = parseMayhemOcrOutput('__OT_NO_TARGET__');
  ok(missing.noTarget && !missing.fallback, 'a true capture failure still reports no target');
  const empty = parseMayhemOcrOutput('__OT_TARGET__{"pid":7,"exe":"League of Legends","class":"RiotWindowClass"}');
  ok(empty.target?.exe === 'League of Legends', 'window metadata still parses');

  const ps1 = fs.readFileSync('electron/scripts/mayhem-ocr.ps1', 'utf8');
  ok(ps1.includes('__OT_${Name} ${Detail}__'), 'the ps1 detail interpolation is fixed');
  ok(!ps1.includes('__OT_${Name} $Detail__'), 'the broken ps1 interpolation is gone');
  ok(ps1.includes("Write-Marker 'FALLBACK'"), 'the ps1 marks a primary-screen fallback');
  ok(
    /isGameProcess\s*=\s*\$proc\.ProcessName\s*-match\s*'\^League of Legends/.test(ps1),
    'the window finder also accepts the League of Legends process name'
  );
  ok(
    /isRiotClass\s*-or\s*\$isGameProcess/.test(ps1),
    'window matching is class OR process, not both'
  );

  const ocr = fs.readFileSync('electron/mayhem-ocr.ts', 'utf8');
  ok(ocr.includes("overlayLog('ocr-target', { target: 'fallback', source: 'fallback' })"), 'a fallback logs target=fallback/source=fallback');
  ok(/source: 'window'/.test(ocr), 'a window capture logs source=window');
  ok(/parsed\.fallback\s*\?\s*true/.test(ocr), 'fallback frames are treated as foreground-valid');
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
  ok(
    mayhem.scope === 'aram-family' && mayhem.games === 4,
    `thin Mayhem history widens to ARAM & Mayhem (${mayhem.games})`
  );
  const ranked = computeLoadingStats(matches, 103, 420);
  ok(ranked.scope === 'ranked' && ranked.games === 1, `420 scopes to ranked (${ranked.games})`);
  const rift = computeLoadingStats(matches, 103, 400);
  ok(rift.scope === 'rift' && rift.games === 2, `a normal Rift queue scopes to Rift (${rift.games})`);
  const unknown = computeLoadingStats(matches, 103, null);
  ok(unknown.games === 0 && unknown.scope === null, 'an unknown queue shows no stats');
  ok(
    computeLoadingStats(matches, 103, null, true).scope === 'aram-family',
    'mayhem-likely folds the ARAM family'
  );
  ok(ARAM_QUEUES.has(450) && ARAM_QUEUES.has(100) && !ARAM_QUEUES.has(2400), 'ARAM queues are 450/100 only');

  const card = fs.readFileSync('src/overlay/LoadingCard.tsx', 'utf8');
  ok(card.includes('loadingScopeLabel'), 'the card labels its scope');
  ok(card.includes('queueKnown'), 'the card can stay neutral while the queue is unknown');
  ok(
    fs.readFileSync('src/overlay/loadingStats.ts', 'utf8').includes('ARAM & Mayhem '),
    'the widened label is "ARAM & Mayhem"'
  );
}

console.log('--- verify:real-game: history includes ARAM family ---');
{
  ok(isSupportedHistoryGame(420), 'Rift ranked is in the history window');
  ok(isSupportedHistoryGame(450), 'classic ARAM is in the history window');
  ok(isSupportedHistoryGame(2400), 'Mayhem is in the history window');
  ok(
    isSupportedHistoryGame(0, HOWLING_ABYSS_MAP_ID),
    'an unknown queue on Howling Abyss is kept by map id'
  );
  ok(!isSupportedHistoryGame(0, 11), 'an unknown queue on the Rift is not kept');
  const history = fs.readFileSync('electron/match-history.ts', 'utf8');
  ok(/count:\s*opts\.count\s*\?\?\s*60/.test(history), 'the fetch count stays 60');
  ok(history.includes('isSupportedHistoryGame(g.queueId, g.mapId)'), 'the filter keeps the ARAM family');
}

console.log('--- verify:real-game: Ahri in Mayhem uses her own build ---');
{
  ingestChampionCatalog([{ id: 'Ahri', key: 103, name: 'Ahri' }]);
  const state = {
    gameMode: 'ARAM',
    mapName: 'Map12',
    mapId: 12,
    queueId: null,
    localPlayer: { championName: 'Ahri', position: 'MIDDLE' },
  } as unknown as OverlayState;
  const id = resolveChampionProfileId(state);
  ok(!!id, `Ahri resolves to a profile (${id})`);
  const profile = getProfile(id);
  ok(profile.championId === 'Ahri', `the profile belongs to Ahri (${profile.championId})`);
  ok(profile.role !== 'Support', `Ahri does not get a support profile (${profile.role})`);
  ok(profile.id !== 'pyke-support', 'Ahri never falls back to Pyke support');

  const unknown = {
    gameMode: 'ARAM',
    mapName: 'Map12',
    mapId: 12,
    localPlayer: { championName: 'Not A Champion', position: 'MIDDLE' },
  } as unknown as OverlayState;
  ok(resolveChampionProfileId(unknown) === null, 'an unknown champion resolves to no profile');

  const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
  ok(app.includes('resolveChampionProfileId'), 'the overlay resolves the ARAM champion profile');
  ok(app.includes('championProfileKnown'), 'the overlay can hide a build for an unknown champion');
  ok(
    /adjustBuildForMayhem\(base, state\.mayhemOwnedIds/.test(app),
    'Mayhem still adjusts the champion build with owned augments'
  );
}

console.log('--- verify:real-game: handoff, pet line, diagnostics ---');
{
  const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
  ok(app.includes('ov-handoff-loading'), 'the loading layer is rendered through the handoff');
  ok(
    /opacity:\s*handoffFading\s*\?\s*0\s*:\s*1/.test(app) && app.includes('opacity 250ms'),
    'the loading layer fades out over 250 ms'
  );
  ok(app.includes("prefers-reduced-motion: reduce"), 'reduced motion skips the fade');
  ok(app.includes('opacity 200ms'), 'the HUD fades in over 200 ms');
  ok(
    /state\.loading\s*\|\|\s*showHandoffLayer\s*\|\|\s*slotHasContent/.test(app),
    'content stays reported through the handoff'
  );

  const pet = fs.readFileSync('src/overlay/OverlayPet.tsx', 'utf8');
  const css = fs.readFileSync('src/overlay/overlay-theme.css', 'utf8');
  ok(!pet.includes('ov-pet-ground') && !css.includes('.ov-pet-ground'), 'the pet ground line is gone');

  const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
  const begin = monitor.slice(monitor.indexOf('function beginMatch'), monitor.indexOf('function resolveMatchQueueAfterStart'));
  ok(begin.includes("overlayLog('match-start'"), 'match start logs one diagnostics line');
  ok(
    /mode:[\s\S]{0,200}queueId:[\s\S]{0,200}mapId:[\s\S]{0,200}gameMode:[\s\S]{0,200}mapName:/.test(begin),
    'match-start carries mode/queueId/mapId/gameMode/mapName'
  );
  ok(!begin.includes('createOverlayWindow()'), 'match start does not re-create the overlay window');
  ok(begin.includes('ensureOverlayShown()'), 'match start reuses the existing overlay window');
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
