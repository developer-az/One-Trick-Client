/**
 * Mayhem monitor integration (review fixes on fix-45).
 *
 * Drives the real monitor scan engine (`src/logic/mayhem/monitor.ts`) with an
 * injected OCR runner through the behaviours that were broken:
 *
 *   1. unknown-queue ARAM discovery: 90 s bursts around level 3/7/11/15 or a
 *      death classify the match from offers (classic ARAM 450 never scans);
 *   2. a manual PageDown scan classifies an unknown queue, never 450;
 *   3. a single high-confidence offer is kept across scans through the real
 *      adapter acceptance and promoted only after two consecutive frames;
 *   4. two offer frames followed by two empty frames count exactly one pick,
 *      even though the OCR adapter returns the retained roll as display ids;
 *   5. a failed capture / missing game window frame in the middle neither
 *      counts nor resets the streaks.
 *
 * Run: npx --yes tsx verify_mayhem_monitor.ts
 */

import {
  createMayhemMonitorState,
  isUnknownQueueAram,
  mayhemDiscoveryLive,
  mayhemMonitorMode,
  mayhemMonitorWantsScan,
  noteMayhemDiscoveryTrigger,
  noteMayhemManualScan,
  runMayhemMonitorScan,
  type MayhemMonitorInput,
  type MayhemMonitorRead,
  type MayhemMonitorState,
} from './src/logic/mayhem/monitor';
import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';
import { acceptMayhemOfferFrame } from './src/logic/mayhem/offerAcceptance';
import { MAYHEM_HIGH_CONFIDENCE_SCORE } from './src/logic/mayhem/match';
import type { MayhemModeSignals } from './src/logic/mayhem/mode';
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

function frame(frameIds: string[], extra: Partial<MayhemMonitorRead> = {}): MayhemMonitorRead {
  return {
    ids: extra.ids ?? frameIds,
    candidateIds: extra.candidateIds ?? [],
    frameIds,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: true,
    ...extra,
  };
}

/**
 * One automatic-scan frame through the real adapter acceptance (minMatches 2).
 * `ids` is what the adapter would display, `candidateIds` the pending single
 * high-confidence match; they are not hand-made from `frameIds`.
 */
function adapterRead(
  matched: string[],
  fuzzyScore: number,
  opts: { previousIds?: string[]; retain?: boolean; minMatches?: number } = {}
): MayhemMonitorRead {
  const accepted = acceptMayhemOfferFrame({
    text: '',
    matched,
    minMatches: opts.minMatches ?? 2,
    fuzzyScore,
    previousIds: opts.previousIds ?? [],
    retain: opts.retain ?? false,
    stability: { rerollPending: false },
  });
  return {
    ids: accepted.ids,
    candidateIds: accepted.candidateIds,
    frameIds: accepted.frameIds,
    fresh: true,
    valid: true,
    fuzzyScore,
    blackFrame: false,
    foreground: true,
  };
}

function input(
  signals: MayhemModeSignals,
  now: number,
  extra: Partial<MayhemMonitorInput> = {}
): MayhemMonitorInput {
  return {
    now,
    level: 6,
    isDead: false,
    signals,
    liveAugmentIds: [],
    autoOcrAllowed: true,
    ...extra,
  };
}

interface DriveResult {
  state: MayhemMonitorState;
  counted: number;
  scanned: number;
  modes: string[];
}

async function drive(
  state: MayhemMonitorState,
  signals: MayhemModeSignals,
  reads: MayhemMonitorRead[],
  opts: { now?: number; inputExtra?: Partial<MayhemMonitorInput> } = {}
): Promise<DriveResult> {
  let now = opts.now ?? 1_000_000;
  let counted = 0;
  let scanned = 0;
  const modes: string[] = [];
  for (const read of reads) {
    const result = await runMayhemMonitorScan(
      state,
      input(signals, now, opts.inputExtra),
      async () => read
    );
    state = result.state;
    counted += result.counted;
    if (result.scanned) scanned += 1;
    modes.push(result.mode);
    now += 10_000;
  }
  return { state, counted, scanned, modes };
}

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
const MAYHEM: MayhemModeSignals = {
  gameMode: 'KIWI',
  mapName: 'Map12',
  queueId: 2400,
  mapId: 12,
};

async function main(): Promise<void> {
  console.log('--- unknown-queue ARAM discovery ---');
  ok(isUnknownQueueAram(UNKNOWN_ARAM), 'null queue on Howling Abyss is a discovery candidate');
  ok(!isUnknownQueueAram(CLASSIC_ARAM), 'classic ARAM queue 450 is never a discovery candidate');
  ok(!isUnknownQueueAram({ gameMode: 'CLASSIC', mapName: 'Map11', queueId: 420, mapId: 11 }), 'Summoner\'s Rift is not a candidate');
  ok(!isUnknownQueueAram(MAYHEM), 'a known Mayhem queue needs no discovery');

  {
    let ocrCalls = 0;
    const discoveryRead = frame(['jeweled_gauntlet', 'giant_slayer']);
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(UNKNOWN_ARAM, 1_000_000, { autoOcrAllowed: false }),
      async () => {
        ocrCalls += 1;
        return discoveryRead;
      }
    );
    ok(first.scanned && ocrCalls === 1, 'the first discovery tick runs one OCR scan');
    ok(first.discovery === true, 'the scan ran in discovery mode');
    ok(first.mode === 'mayhem', 'two offers classify the unknown queue as Mayhem');
    ok(first.state.discovery.latched, 'classification latches for the rest of the match');
    ok(
      mayhemMonitorWantsScan(first.state, UNKNOWN_ARAM, 1_000_001) === 'mayhem',
      'after classification the monitor runs the normal Mayhem cadence'
    );
    const later = await runMayhemMonitorScan(
      first.state,
      input(UNKNOWN_ARAM, 1_000_001),
      async () => frame([])
    );
    ok(later.scanned && later.mode === 'mayhem', 'a blank later frame cannot demote a latched Mayhem match');
  }

  {
    // Classic ARAM never spends a scan, even with the engine enabled.
    let ocrCalls = 0;
    const result = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      input(CLASSIC_ARAM, 1_000_000),
      async () => {
        ocrCalls += 1;
        return frame(['jeweled_gauntlet', 'giant_slayer']);
      }
    );
    ok(!result.scanned && ocrCalls === 0 && result.mode === 'aram', 'classic ARAM 450 never starts OCR');
  }

  {
    // Burst cadence: one scan per 10 s inside a 90 s window opened by a level
    // or death trigger; a later burst reopens around the next augment window.
    let ocrCalls = 0;
    const first = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      input(UNKNOWN_ARAM, 1_000_000),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(first.scanned && ocrCalls === 1, 'the first discovery burst scan runs');
    const tooSoon = await runMayhemMonitorScan(
      first.state,
      input(UNKNOWN_ARAM, 1_000_000 + 5_000),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(!tooSoon.scanned && ocrCalls === 1, 'a second discovery scan is gated to one per 10 s');
    const due = await runMayhemMonitorScan(
      tooSoon.state,
      input(UNKNOWN_ARAM, 1_000_000 + 10_000),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(due.scanned && ocrCalls === 2, 'the next scan runs once the 10 s slot elapses');
    ok(
      !mayhemDiscoveryLive(due.state.discovery, 1_000_000 + 90_001),
      'a discovery burst expires 90 s after it opened'
    );
    const expired = await runMayhemMonitorScan(
      due.state,
      input(UNKNOWN_ARAM, 1_000_000 + 90_001),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(!expired.scanned && ocrCalls === 2, 'no scan runs after the burst with no new window');
    const level7 = await runMayhemMonitorScan(
      expired.state,
      input(UNKNOWN_ARAM, 1_000_000 + 100_000, { level: 7 }),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(level7.scanned && ocrCalls === 3, 'reaching level 7 opens a new discovery burst');
  }

  {
    // A late first augment: nothing scans below level 3, then level 3 opens a
    // burst even minutes after the match started (the old 3-minute cap missed
    // this).
    let ocrCalls = 0;
    const early = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      input(UNKNOWN_ARAM, 1_000_000, { level: 1 }),
      async () => {
        ocrCalls += 1;
        return frame(['jeweled_gauntlet', 'giant_slayer']);
      }
    );
    ok(!early.scanned && ocrCalls === 0, 'no discovery scan before the first augment level');
    const lateFirst = await runMayhemMonitorScan(
      early.state,
      input(UNKNOWN_ARAM, 1_000_000 + 300_000, { level: 3 }),
      async () => {
        ocrCalls += 1;
        return frame(['jeweled_gauntlet', 'giant_slayer']);
      }
    );
    ok(lateFirst.scanned && ocrCalls === 1, 'a late level 3 still opens a discovery burst');
    ok(lateFirst.mode === 'mayhem', 'the late first augment classifies the unknown queue as Mayhem');
  }

  {
    // A death opens a burst even when every level threshold is already past.
    const state = createMayhemMonitorState();
    state.discovery.levelBurst = 15;
    state.discovery.wasDead = false;
    let ocrCalls = 0;
    const alive = await runMayhemMonitorScan(
      state,
      input(UNKNOWN_ARAM, 1_000_000, { level: 9, isDead: false }),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(!alive.scanned && ocrCalls === 0, 'no burst without a level or death trigger');
    const dead = await runMayhemMonitorScan(
      alive.state,
      input(UNKNOWN_ARAM, 1_000_000 + 1_000, { level: 9, isDead: true }),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(dead.scanned && ocrCalls === 1, 'a death opens a discovery burst');
    const stillDead = await runMayhemMonitorScan(
      dead.state,
      input(UNKNOWN_ARAM, 1_000_000 + 20_000, { level: 9, isDead: true }),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(stillDead.scanned && ocrCalls === 2, 'staying dead keeps the burst scan cadence');
  }

  {
    // The trigger function itself: unknown ARAM only, level and death edges.
    const state = createMayhemMonitorState();
    ok(
      !noteMayhemDiscoveryTrigger(state, {
        now: 1_000,
        level: 1,
        isDead: false,
        signals: UNKNOWN_ARAM,
      }),
      'below level 3 with no death: no burst'
    );
    ok(
      noteMayhemDiscoveryTrigger(state, {
        now: 2_000,
        level: 3,
        isDead: false,
        signals: UNKNOWN_ARAM,
      }),
      'level 3 opens a burst'
    );
    const classic = createMayhemMonitorState();
    ok(
      !noteMayhemDiscoveryTrigger(classic, {
        now: 2_000,
        level: 3,
        isDead: true,
        signals: CLASSIC_ARAM,
      }),
      'classic ARAM 450 never opens a discovery burst'
    );
  }

  console.log('--- manual PageDown scan classification ---');
  {
    const twoOffers = frame(['jeweled_gauntlet', 'giant_slayer']);
    const unknown = createMayhemMonitorState();
    ok(
      noteMayhemManualScan(unknown, UNKNOWN_ARAM, twoOffers),
      'a manual scan with two offers classifies an unknown-queue ARAM game'
    );
    ok(mayhemMonitorMode(unknown, UNKNOWN_ARAM) === 'mayhem', 'the manual classification latches Mayhem');
    const classic = createMayhemMonitorState();
    ok(
      !noteMayhemManualScan(classic, CLASSIC_ARAM, twoOffers),
      'the same manual read in classic ARAM 450 never classifies Mayhem'
    );
    ok(mayhemMonitorMode(classic, CLASSIC_ARAM) === 'aram', 'classic ARAM 450 stays ARAM after a manual scan');
    classic.displayIds = ['jeweled_gauntlet', 'giant_slayer'];
    ok(
      mayhemMonitorMode(classic, CLASSIC_ARAM) === 'aram',
      'classic ARAM 450 also stays ARAM when offers are already on display'
    );
    const one = createMayhemMonitorState();
    ok(
      !noteMayhemManualScan(one, UNKNOWN_ARAM, frame(['jeweled_gauntlet'])),
      'a manual single offer does not classify an unknown queue'
    );
    const invalid = createMayhemMonitorState();
    ok(
      !noteMayhemManualScan(invalid, UNKNOWN_ARAM, frame(['a', 'b'], { valid: false })),
      'a failed manual capture does not classify an unknown queue'
    );
  }

  console.log('--- real adapter: single high-confidence offer across scans ---');
  {
    // The adapter asks for two matches, so a one-card frame yields no display
    // ids; it becomes a candidate instead. The monitor promotes it after the
    // same id on a second consecutive qualifying frame.
    const direct = acceptMayhemOfferFrame({
      text: '',
      matched: ['twin_fire'],
      minMatches: 2,
      fuzzyScore: 0.95,
      previousIds: [],
      retain: false,
      stability: { rerollPending: false },
    });
    ok(direct.ids.length === 0, 'the adapter does not display a single match directly');
    ok(direct.candidateIds.join(',') === 'twin_fire', 'the adapter returns the single high-confidence match as a candidate');
    ok(direct.frameIds.join(',') === 'twin_fire', 'the adapter still reports the frame match');
    const low = acceptMayhemOfferFrame({
      text: '',
      matched: ['twin_fire'],
      minMatches: 2,
      fuzzyScore: MAYHEM_HIGH_CONFIDENCE_SCORE - 0.01,
      previousIds: [],
      retain: false,
      stability: { rerollPending: false },
    });
    ok(low.ids.length === 0 && low.candidateIds.length === 0, 'a low-confidence single match is not a candidate');
    const relaxed = acceptMayhemOfferFrame({
      text: '',
      matched: ['twin_fire'],
      minMatches: 1,
      fuzzyScore: 0.95,
      previousIds: [],
      retain: false,
      stability: { rerollPending: false },
    });
    ok(relaxed.ids.join(',') === 'twin_fire' && relaxed.candidateIds.length === 0, 'a relaxed minMatches=1 read displays the match directly');
    const pair = acceptMayhemOfferFrame({
      text: '',
      matched: ['a', 'b'],
      minMatches: 2,
      fuzzyScore: 0.95,
      previousIds: [],
      retain: false,
      stability: { rerollPending: false },
    });
    ok(pair.ids.length === 2 && pair.candidateIds.length === 0, 'two matches display directly with no candidate');

    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(MAYHEM, 1_000_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    ok(first.hudAction === 'keep', 'the first adapter single offer is kept, not purged');
    ok(first.state.scanStreak === 1, 'the first qualifying single offer starts the scan streak');
    ok(first.state.displayIds.length === 0, 'the single offer is not displayed on the first scan');
    ok(first.state.candidateIds.join(',') === 'twin_fire' && first.state.candidateScans === 1, 'the adapter candidate is pending');
    ok(
      !isMayhemAugmentHudVisible(first.state.displayIds, false, {
        consecutiveScans: first.state.scanStreak,
        fuzzyScore: first.state.fuzzyScore,
      }),
      'one scan alone does not open the HUD'
    );
    const second = await runMayhemMonitorScan(
      first.state,
      input(MAYHEM, 1_010_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    ok(second.hudAction === 'show', 'the same adapter candidate on the next frame becomes visible');
    ok(second.state.scanStreak === 2, 'the candidate reaches two consecutive scans');
    ok(second.state.displayIds.join(',') === 'twin_fire', 'the monitor promotes the candidate to display ids');
    ok(
      isMayhemAugmentHudVisible(second.state.displayIds, false, {
        consecutiveScans: second.state.scanStreak,
        fuzzyScore: second.state.fuzzyScore,
      }),
      'two consecutive single-offer adapter frames open the HUD'
    );
  }

  {
    // A different single offer on the next frame is not the same candidate:
    // the streak resets and nothing shows.
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(MAYHEM, 1_000_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    const other = await runMayhemMonitorScan(
      first.state,
      input(MAYHEM, 1_010_000),
      async () => adapterRead(['recursion'], 0.95)
    );
    ok(other.state.displayIds.length === 0, 'a different single offer is not displayed');
    ok(other.state.candidateIds.join(',') === 'recursion' && other.state.candidateScans === 1, 'the different offer starts its own candidate streak');
    ok(other.hudAction === 'keep', 'the different single offer is kept, not shown');
    ok(
      !isMayhemAugmentHudVisible(other.state.displayIds, false, {
        consecutiveScans: other.state.scanStreak,
        fuzzyScore: other.state.fuzzyScore,
      }),
      'one match then a different match never becomes visible'
    );
  }

  {
    // A failed capture between two identical single offers must not reset the
    // candidate streak.
    const failedRead = frame([], {
      valid: false,
      foreground: false,
      ids: [],
      candidateIds: [],
    });
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(MAYHEM, 1_000_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    const invalid = await runMayhemMonitorScan(
      first.state,
      input(MAYHEM, 1_005_000),
      async () => failedRead
    );
    ok(invalid.hudAction === 'keep', 'an invalid frame keeps the pending adapter candidate');
    ok(invalid.state.candidateScans === 1 && invalid.state.scanStreak === 1, 'an invalid frame resets neither streak');
    const second = await runMayhemMonitorScan(
      invalid.state,
      input(MAYHEM, 1_010_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    ok(second.hudAction === 'show' && second.state.scanStreak === 2, 'the adapter candidate still reaches two scans across an invalid frame');
    ok(second.state.displayIds.join(',') === 'twin_fire', 'the invalid frame did not drop the adapter candidate');
  }

  {
    // Low confidence never qualifies, even after two scans.
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(MAYHEM, 1_000_000),
      async () => adapterRead(['twin_fire'], 0.7)
    );
    const second = await runMayhemMonitorScan(
      first.state,
      input(MAYHEM, 1_010_000),
      async () => adapterRead(['twin_fire'], 0.7)
    );
    ok(second.state.displayIds.length === 0 && second.state.candidateIds.length === 0, 'a low-confidence single offer never becomes a candidate');
    ok(
      !isMayhemAugmentHudVisible(second.state.displayIds, false, {
        consecutiveScans: second.state.scanStreak,
        fuzzyScore: second.state.fuzzyScore,
      }),
      'two low-confidence single-offer scans do not open the HUD'
    );
  }

  {
    // Single candidate then a confirmed empty frame: purge, nothing visible.
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(MAYHEM, 1_000_000),
      async () => adapterRead(['twin_fire'], 0.95)
    );
    const empty = await runMayhemMonitorScan(
      first.state,
      input(MAYHEM, 1_010_000),
      async () => adapterRead([], 0.95)
    );
    ok(empty.hudAction === 'purge', 'a confirmed empty frame purges the pending adapter candidate');
    ok(empty.state.scanStreak === 0 && empty.state.displayIds.length === 0, 'the purged candidate leaves no streak or ids');
    ok(empty.state.candidateIds.length === 0 && empty.state.candidateScans === 0, 'the purge also clears the candidate');
    ok(
      !isMayhemAugmentHudVisible(empty.state.displayIds, false, {
        consecutiveScans: empty.state.scanStreak,
        fuzzyScore: empty.state.fuzzyScore,
      }),
      'a single offer followed by an empty frame stays hidden'
    );
  }

  console.log('--- frame-accurate pick counting ---');
  {
    // The OCR adapter keeps returning the retained roll as display ids while
    // the frame itself is empty. Only frameIds may move the counter.
    const reads = [
      frame(['jeweled_gauntlet', 'giant_slayer', 'apex_inventor']),
      frame(['jeweled_gauntlet', 'giant_slayer', 'apex_inventor']),
      frame([], { ids: ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'] }),
      frame([], { ids: ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'] }),
    ];
    const result = await drive(createMayhemMonitorState(), MAYHEM, reads);
    ok(result.scanned === 4, 'four Mayhem scans ran');
    ok(result.counted === 1, 'two offer frames + two empty frames count exactly one pick');
    ok(result.state.counter.picksTaken === 1, 'the counter records one pick');
    ok(result.state.displayIds.length === 3, 'display ids keep the retained roll for the HUD');
  }

  {
    const reads = [
      frame(['a', 'b', 'c']),
      frame(['a', 'b', 'c']),
      frame([]),
      frame([]),
      frame(['d', 'e']),
      frame(['d', 'e']),
      frame([]),
      frame([]),
    ];
    const result = await drive(createMayhemMonitorState(), MAYHEM, reads);
    ok(result.counted === 2, 'two complete offer→empty cycles count two picks');
  }

  console.log('--- failed capture in the middle ---');
  const failed = frame([], {
    valid: false,
    foreground: false,
    ids: ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'],
  });
  {
    const result = await drive(createMayhemMonitorState(), MAYHEM, [
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame(['jeweled_gauntlet', 'giant_slayer']),
      failed,
      frame([]),
      frame([]),
    ]);
    ok(result.counted === 1, 'a failed capture does not swallow the pick (it neither counts nor resets)');
    ok(result.state.counter.picksTaken === 1, 'the pick still lands after the failed frame');
  }
  {
    const result = await drive(createMayhemMonitorState(), MAYHEM, [
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame(['jeweled_gauntlet', 'giant_slayer']),
      failed,
      failed,
      frame([]),
      failed,
      frame([]),
    ]);
    ok(result.counted === 1, 'invalid frames never advance or reset the empty streak');
  }
  {
    const result = await drive(createMayhemMonitorState(), MAYHEM, [
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame([], { blackFrame: true }),
      frame([]),
      frame([]),
    ]);
    ok(result.counted === 1, 'a black frame is excluded but keeps the offer streak');
  }
  {
    const result = await drive(createMayhemMonitorState(), MAYHEM, [
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame(['jeweled_gauntlet', 'giant_slayer']),
      frame([], { foreground: false }),
      frame([]),
      frame([]),
    ]);
    ok(result.counted === 1, 'a background-window scan is excluded but keeps the offer streak');
  }
  {
    const reads = [frame(['jeweled_gauntlet', 'giant_slayer']), failed, frame([])];
    const result = await drive(createMayhemMonitorState(), MAYHEM, reads);
    ok(result.counted === 0, 'an invalid read cannot stand in for a real offer frame');
    ok(result.state.counter.picksTaken === 0, 'one offer frame + invalid + empty is not a pick');
  }

  console.log('--- visibility streaks ignore invalid reads ---');
  {
    const result = await drive(createMayhemMonitorState(), MAYHEM, [
      frame(['twin_fire'], { fuzzyScore: 0.99 }),
      failed,
      frame(['twin_fire'], { fuzzyScore: 0.99 }),
    ]);
    ok(result.state.scanStreak === 2, 'an invalid read between two single-card scans does not reset the streak');
  }

  console.log('--- game-monitor wiring ---');
  {
    const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
    const tickStart = monitor.indexOf('async function tickMayhemOcr');
    const tickEnd = monitor.indexOf('export function clearMayhemOffersForDashboard');
    const tick = tickStart >= 0 && tickEnd > tickStart ? monitor.slice(tickStart, tickEnd) : '';
    ok(
      tick.includes("result.hudAction === 'purge'") && !tick.includes('applyMayhemOfferVisibilityAfterOcr()'),
      'automatic scans purge only on the engine purge action (no generic post-scan purge)'
    );
    ok(
      tick.includes("result.hudAction === 'show' || mayhemAugmentHudShouldShow()"),
      'automatic scans show the HUD from the show action or the retained-roll visibility'
    );
    const manualStart = monitor.indexOf('export async function triggerManualMayhemOcrFromHotkey');
    const manualEnd = monitor.indexOf('export function getMonitorStats');
    const manual = manualStart >= 0 && manualEnd > manualStart ? monitor.slice(manualStart, manualEnd) : '';
    ok(manual.includes('isAramOrMayhem('), 'manual PageDown is allowed by ARAM family, not by Mayhem classification');
    ok(manual.includes('noteMayhemManualScan('), 'manual PageDown classifies through the shared latch helper');
    ok(
      monitor.includes('noteMayhemDiscoveryTrigger(mayhemMonitorState'),
      'the live tick opens discovery bursts on level/death triggers'
    );
  }
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-monitor FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-monitor ok');
});
