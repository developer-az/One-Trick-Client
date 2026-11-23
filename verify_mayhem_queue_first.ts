/**
 * Queue-first Mayhem gating — Sol blocker regression guards (BRIEF-Q1-F1).
 *
 * The queue lifecycle itself lives as module state in the Electron monitor, so
 * it cannot be imported into tsx. This check pairs the real pure seams with
 * source-level assertions on game-monitor.ts (the same light-integration style
 * as verify_mayhem_monitor.ts). Every source assertion below would FAIL on the
 * pre-fix code, so they are regression guards, not restatements.
 *
 *   1. queue retry: a failed session read keeps the previous queue;
 *   2. phase transitions: Lobby -> ChampSelect -> GameStart -> InGame preserve
 *      the learned queue (it is cleared only at a genuine new session);
 *   3. KIWI inference with the session GET failing;
 *   4. level 0 is unknown/unarmed, level > 0 arms the augment gates.
 *
 * Run: npx --yes tsx verify_mayhem_queue_first.ts
 */

import {
  MAYHEM_KIWI_QUEUE_ID,
  MAYHEM_QUEUE_IDS,
  detectMayhemMode,
  inferMayhemQueueFromMode,
} from './src/logic/mayhem/mode';
import {
  mayhemAugmentLevelEdge,
  mayhemAutoOcrGate,
  mayhemAutoOcrWanted,
} from './src/logic/mayhem/monitor';
import fs from 'node:fs';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

/** A slice of `src` that starts at `start` and ends before `end` (inclusive of start). */
function block(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = from >= 0 ? src.indexOf(end, from) : -1;
  return from >= 0 && to > from ? src.slice(from, to) : '';
}

function lineWith(src: string, needle: string): string {
  const at = src.indexOf(needle);
  if (at < 0) return '';
  const end = src.indexOf('\n', at);
  return src.slice(at, end < 0 ? src.length : end);
}

const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
const enterLoading = block(monitor, 'function enterPrematchLoading(', '\nfunction exitPrematchLoading');
const beginChamp = block(monitor, 'function beginChampSelectSession()', '\nfunction prefetchHistoryForChampSelect');
const readOnce = block(monitor, 'async function readMatchQueueOnce(', '\nfunction syncMayhemPollForMode');
const scheduleRead = block(monitor, 'function scheduleQueueRead(', '\n/**');
const wantsRead = block(monitor, 'function wantsQueueRead(', '\n/** Forget an in-flight');
const resetCaches = block(monitor, 'function resetMatchCaches()', '\nfunction ');

async function main(): Promise<void> {
  console.log('--- pure inference seam ---');
  ok(MAYHEM_KIWI_QUEUE_ID === 2400, 'the KIWI-implied queue id is 2400');
  ok(MAYHEM_QUEUE_IDS.length === 9, `MAYHEM_QUEUE_IDS has 9 ids (${MAYHEM_QUEUE_IDS.join(',')})`);
  ok(inferMayhemQueueFromMode('KIWI') === 2400, 'a KIWI game mode infers queue 2400');
  ok(inferMayhemQueueFromMode(' kiwi ') === 2400, 'game mode is trimmed and upper-cased before inference');
  ok(
    inferMayhemQueueFromMode('ARAM_MAYHEM') === 2400,
    'a MAYHEM mode string also infers 2400 (pre-fix: only exact KIWI matched)'
  );
  ok(inferMayhemQueueFromMode('CLASSIC') === null, 'a non-Mayhem mode infers no queue');
  ok(inferMayhemQueueFromMode(null) === null && inferMayhemQueueFromMode(undefined) === null, 'no mode infers no queue');

  console.log('--- classifier stays consistent with inference ---');
  ok(
    detectMayhemMode({ gameMode: 'KIWI', mapName: 'Map12', mapId: 12, queueId: null }) === 'mayhem',
    'an inferred KIWI game classifies as Mayhem'
  );
  ok(
    detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', mapId: 12, queueId: 2400 }) === 'mayhem',
    'a named Mayhem queue wins over a generic ARAM mode'
  );
  ok(
    detectMayhemMode({ gameMode: 'ARAM', mapName: 'Map12', mapId: 12, queueId: 450 }) === 'aram',
    'a classic ARAM queue stays ARAM'
  );

  console.log('--- queue retry: failed read keeps the previous queue ---');
  ok(
    readOnce.includes('// Keep the previous queue; the next tick retries.'),
    'the failed session GET keeps the previous queue for the next tick'
  );
  ok(
    readOnce.includes('if (meta.queueId != null) matchQueueId = meta.queueId;'),
    'a queue is replaced only when the client actually named one'
  );
  ok(
    readOnce.includes('(metaQueueId != null &&'),
    'retry completion uses the session-safe queue id (no read of a missing session)'
  );
  ok(
    scheduleRead.includes('if (!matchQueueReadDone && wantsQueueRead(lcuSocket.phase)) scheduleQueueRead();'),
    'the retry stays armed after a failed read'
  );

  console.log('--- phase transitions preserve the learned queue ---');
  ok(
    enterLoading.length > 0 && !/\bmatchQueueId = null\b/.test(enterLoading),
    'GameStart/InProgress loading does NOT clear the learned queue (pre-fix cleared it)'
  );
  ok(
    !/\bmatchMapId = null\b/.test(enterLoading),
    'loading does NOT clear the learned map'
  );
  ok(
    beginChamp.length > 0 && /\bmatchQueueId = null\b/.test(beginChamp),
    'a new ChampSelect clears the previous game queue (genuine new-session boundary)'
  );
  ok(
    /\bmatchMapId = null\b/.test(beginChamp),
    'a new ChampSelect clears the previous game map'
  );
  ok(
    !wantsRead.includes("phase === 'GameStart'") && !wantsRead.includes("phase === 'InProgress'"),
    'the queue reader is idle during loading, so a load cannot re-learn a cleared queue'
  );
  ok(
    /\bmatchQueueId = null\b/.test(resetCaches),
    'match end clears the queue (the other genuine boundary)'
  );

  console.log('--- KIWI inference with the session GET failing ---');
  const tokenGuard = lineWith(readOnce, 'if (token !== matchStartToken');
  ok(
    tokenGuard.length > 0 && !tokenGuard.includes('!session'),
    'the token guard no longer bails when the session GET failed (pre-fix: `|| !session`)'
  );
  ok(readOnce.includes('if (session) {'), 'client queue/map are applied only when a session exists');
  const sessionBlock = block(readOnce, 'if (session) {', 'const inGame = isInGamePhase(phase);');
  ok(
    !sessionBlock.includes('inferMayhemQueueFromMode'),
    'KIWI inference runs outside the session-success block'
  );
  ok(
    /if \(matchQueueId == null\) \{[\s\S]{0,140}inferMayhemQueueFromMode/.test(readOnce),
    'inference fills only a missing queue; a real session queue is never overwritten'
  );
  ok(
    readOnce.includes('inferMayhemQueueFromMode(lastGoodPayload?.gameMode ?? sessionGameMode)'),
    'inference reads the Live Client mode independently of session success'
  );

  console.log('--- level 0 unarmed vs level > 0 armed ---');
  ok(mayhemAugmentLevelEdge(0) === null, 'level 0 is unknown: no augment edge');
  ok(mayhemAugmentLevelEdge(3) === 3, 'level 3 reaches the first augment edge');
  ok(!mayhemAutoOcrWanted({ level: 0, ownedCount: 0, hudVisible: false }), 'level 0 does not arm OCR');
  ok(mayhemAutoOcrWanted({ level: 3, ownedCount: 0, hudVisible: false }), 'level 3 arms OCR');
  ok(
    !mayhemAutoOcrGate({ level: 0, ownedCount: 0, hudVisible: false, rearmedAtLevel: null }).wanted,
    'the pick gate stays unarmed at level 0'
  );
  ok(
    mayhemAutoOcrGate({ level: 3, ownedCount: 0, hudVisible: false, rearmedAtLevel: null }).wanted,
    'the pick gate arms at level 3'
  );
  ok(
    readOnce.includes('lastGoodPayload?.localPlayer?.level ?? lastGoodPayload?.activePlayerLevel ?? 0'),
    'the queue patch feeds level 0 as unknown, never a fabricated level 1'
  );
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-queue-first FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-queue-first ok');
});
