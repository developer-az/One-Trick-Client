/**
 * Mayhem monitor integration (review fixes on fix-45).
 *
 * Drives the real monitor scan engine (`src/logic/mayhem/monitor.ts`) with an
 * injected OCR runner through the behaviours that were broken:
 *
 *   1. unknown-queue ARAM is `mayhem-likely`: the NORMAL Mayhem scan schedule
 *      (never the old bounded 90 s discovery bursts), while classic ARAM 450
 *      never scans;
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
  MAX_DISCOVERY_BURSTS,
  MAX_DISCOVERY_SCANS,
  isUnknownQueueAram,
  mayhemAugmentLevelEdge,
  mayhemAutoOcrGate,
  mayhemMonitorMode,
  mayhemMonitorWantsScan,
  mayhemUnverifiedAfterRead,
  noteMayhemDiscoveryTrigger,
  noteMayhemManualScan,
  runMayhemMonitorScan,
  type MayhemMonitorInput,
  type MayhemMonitorRead,
  type MayhemMonitorState,
} from './src/logic/mayhem/monitor';
import { nextMayhemPickLevel } from './src/logic/mayhem/pickPhase';
import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';
import { decideMayhemPageUp } from './src/logic/mayhem/hotkey';
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
    frameDisplayCount: frameIds.length,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: true,
    owner: true,
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
    frameDisplayCount: accepted.frameIds.length + accepted.placeholderIds.length,
    fresh: true,
    valid: true,
    fuzzyScore,
    blackFrame: false,
    foreground: true,
    owner: true,
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
  console.log('--- unknown-queue ARAM runs the normal Mayhem schedule ---');
  ok(isUnknownQueueAram(UNKNOWN_ARAM), 'null queue on Howling Abyss is a discovery candidate');
  ok(!isUnknownQueueAram(CLASSIC_ARAM), 'classic ARAM queue 450 is never a discovery candidate');
  ok(!isUnknownQueueAram({ gameMode: 'CLASSIC', mapName: 'Map11', queueId: 420, mapId: 11 }), 'Summoner\'s Rift is not a candidate');
  ok(!isUnknownQueueAram(MAYHEM), 'a known Mayhem queue needs no discovery');

  {
    let ocrCalls = 0;
    const discoveryRead = frame(['jeweled_gauntlet', 'giant_slayer']);
    const state = createMayhemMonitorState();
    ok(
      mayhemMonitorWantsScan(state, UNKNOWN_ARAM, 1_000_000) === 'mayhem',
      'mayhem-likely wants the normal Mayhem scan, not a discovery burst'
    );
    const first = await runMayhemMonitorScan(
      state,
      input(UNKNOWN_ARAM, 1_000_000),
      async () => {
        ocrCalls += 1;
        return discoveryRead;
      }
    );
    ok(first.scanned && ocrCalls === 1, 'the first tick runs one normal OCR scan');
    ok(first.discovery === false, 'the scan is not a bounded discovery scan');
    ok(first.mode === 'mayhem', 'two offers classify the unknown queue as Mayhem');
    ok(
      mayhemMonitorWantsScan(first.state, UNKNOWN_ARAM, 1_000_001) === 'mayhem',
      'after the offers the monitor stays on the normal Mayhem cadence'
    );
    const later = await runMayhemMonitorScan(
      first.state,
      input(UNKNOWN_ARAM, 1_000_001),
      async () => frame([])
    );
    ok(later.scanned && later.mode === 'mayhem-likely', 'a blank later frame returns to the mayhem-likely classification');

    // No offers ever: the normal schedule must still scan past the old 90 s
    // discovery window.
    let scans = 0;
    let lastScanAt = -1;
    let chasing = later.state;
    for (let now = 1_002_000; now <= 1_200_000; now += 1_000) {
      const result = await runMayhemMonitorScan(
        chasing,
        input(UNKNOWN_ARAM, now),
        async () => frame([])
      );
      chasing = result.state;
      if (result.scanned) {
        scans += 1;
        lastScanAt = now;
      }
    }
    ok(scans >= 180, `the unknown queue scans on every normal tick (${scans})`);
    ok(lastScanAt > 1_090_000, `scanning continues past 90 s with no offers (last ${lastScanAt})`);
    ok(!chasing.discovery.latched, 'empty frames never latch the unknown queue');
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
    // The level/dismissal gate still applies to the normal schedule: a tick the
    // caller disallowed does not scan, and the next allowed tick does.
    let ocrCalls = 0;
    const gated = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      input(UNKNOWN_ARAM, 1_000_000, { autoOcrAllowed: false }),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(!gated.scanned && ocrCalls === 0, 'the level/dismissal gate is respected before the first augment level');
    const allowed = await runMayhemMonitorScan(
      gated.state,
      input(UNKNOWN_ARAM, 1_001_000),
      async () => {
        ocrCalls += 1;
        return frame(['jeweled_gauntlet', 'giant_slayer']);
      }
    );
    ok(allowed.scanned && ocrCalls === 1, 'the next allowed tick scans normally');
    ok(allowed.mode === 'mayhem', 'the first offers still classify the unknown queue');
  }

  {
    // The discovery trigger itself survives as the fallback for a NON-Howling
    // unknown-queue ARAM signal; reaching level 9 or dying keeps it open.
    const state = createMayhemMonitorState();
    state.discovery.levelBurst = 15;
    state.discovery.wasDead = false;
    ok(
      !noteMayhemDiscoveryTrigger(state, {
        now: 1_000_000,
        level: 9,
        isDead: false,
        signals: UNKNOWN_ARAM,
      }),
      'no burst without a level or death trigger'
    );
    ok(
      noteMayhemDiscoveryTrigger(state, {
        now: 1_001_000,
        level: 9,
        isDead: true,
        signals: UNKNOWN_ARAM,
      }),
      'a death opens a fallback discovery burst'
    );
  }

  {
    // The trigger function itself: unknown ARAM only, level and death edges.
    const state = createMayhemMonitorState();
    ok(
      !noteMayhemDiscoveryTrigger(state, {
        now: 1_000,
        level: 0,
        isDead: false,
        signals: UNKNOWN_ARAM,
      }),
      'no level read yet, no death: no burst'
    );
    ok(
      noteMayhemDiscoveryTrigger(state, {
        now: 2_000,
        level: 1,
        isDead: false,
        signals: UNKNOWN_ARAM,
      }),
      'spawn (level 1) opens the first-augment burst'
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

  console.log('--- fallback frames: offers display, picks never count ---');
  {
    // No game window matched, so the capture is the primary-screen fallback.
    // Offers on it are real enough to show, but the frame cannot prove the
    // game was on top, so the pick counter must ignore it entirely.
    const fallbackOffers = frame(['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'], {
      fallback: true,
    });
    const fallbackEmpty = frame([], { fallback: true });
    const state = createMayhemMonitorState();
    const first = await runMayhemMonitorScan(
      state,
      input(UNKNOWN_ARAM, 1_000_000),
      async () => fallbackOffers
    );
    ok(first.scanned && first.hudAction === 'show', 'a fallback offer frame displays the offers');
    ok(first.state.displayIds.length === 3, `the fallback roll is shown (${first.state.displayIds.join(',')})`);
    const second = await runMayhemMonitorScan(
      first.state,
      input(UNKNOWN_ARAM, 1_001_000),
      async () => fallbackOffers
    );
    ok(second.scanned && second.hudAction === 'show', 'successive fallback offer frames keep the panel up');
    ok(second.counted === 0 && second.state.counter.picksTaken === 0, 'fallback offer frames never count a pick');
    const cleared = await runMayhemMonitorScan(
      second.state,
      input(UNKNOWN_ARAM, 1_002_000),
      async () => fallbackEmpty
    );
    ok(cleared.hudAction === 'purge', 'an empty fallback frame after offers purges the panel (visibility rule)');
    ok(cleared.state.displayIds.length === 0, 'the purged fallback roll leaves no display ids');
    const stillCleared = await runMayhemMonitorScan(
      cleared.state,
      input(UNKNOWN_ARAM, 1_003_000),
      async () => fallbackEmpty
    );
    ok(
      stillCleared.counted === 0 && stillCleared.state.counter.picksTaken === 0,
      'empty fallback frames never count a pick'
    );
    ok(stillCleared.state.counter.offerScans === 0, 'fallback frames never feed the offer streak');

    // Control: the identical sequence with foreground frames still counts one
    // pick, so the fallback assertions above are not vacuous.
    const control = await drive(createMayhemMonitorState(), UNKNOWN_ARAM, [
      frame(['a', 'b']),
      frame(['a', 'b']),
      frame([]),
      frame([]),
    ]);
    ok(control.counted === 1, 'the same sequence with foreground frames still counts one pick');
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

  console.log('--- pick-level gate re-arms on a level-up, never purges ---');
  {
    // An over-counted pick set: three counted picks while the player is level 7
    // puts nextPick on level 15, so the plain gate would switch scanning off
    // until 15 and the panel would not return at the level-11 window.
    ok(nextMayhemPickLevel(3) === 15, 'three counted picks put nextPick at level 15 (precondition)');
    const blocked = mayhemAutoOcrGate({
      level: 7,
      ownedCount: 3,
      hudVisible: false,
      rearmedAtLevel: null,
    });
    ok(blocked.wanted, 'a level-7 tick still gets a scan when nextPick is ahead of the level');
    ok(blocked.rearmedAtLevel === 7, 'the re-arm is spent on the level-7 augment edge');
    const throttled = mayhemAutoOcrGate({
      level: 7,
      ownedCount: 3,
      hudVisible: false,
      rearmedAtLevel: blocked.rearmedAtLevel,
    });
    ok(!throttled.wanted, 'the same level does not keep re-arming (the gate still throttles)');
    const raised = mayhemAutoOcrGate({
      level: 11,
      ownedCount: 3,
      hudVisible: false,
      rearmedAtLevel: throttled.rearmedAtLevel,
    });
    ok(raised.wanted && raised.rearmedAtLevel === 11, 'level 11 re-arms scanning again');
    ok(
      !mayhemAutoOcrGate({ level: 5, ownedCount: 1, hudVisible: false, rearmedAtLevel: 1 }).wanted,
      'below the next augment level the gate still says no'
    );
    ok(mayhemAugmentLevelEdge(6) === 1, 'level 6 is on the first augment edge');
    ok(mayhemAugmentLevelEdge(7) === 7, 'level 7 is its own augment edge');
    ok(mayhemAugmentLevelEdge(0) === null && mayhemAugmentLevelEdge(1) === 1, 'the first augment edge is spawn (level 1)');
  }

  console.log('--- discovery budget resets on a new augment level ---');
  {
    const state = createMayhemMonitorState();
    state.discovery.levelBurst = 3;
    state.discovery.scans = MAX_DISCOVERY_SCANS;
    state.discovery.bursts = MAX_DISCOVERY_BURSTS;
    state.discovery.exhausted = true;
    state.discovery.lastScanAt = 1_000_000;
    ok(
      mayhemMonitorWantsScan(state, CLASSIC_ARAM, 1_000_001) === 'none',
      'an exhausted match wants no discovery scan (precondition)'
    );
    ok(
      noteMayhemDiscoveryTrigger(
        state,
        { now: 1_000_001, level: 7, isDead: false, signals: CLASSIC_ARAM },
        { anyAramQueue: true }
      ),
      'level 7 re-opens discovery after the budget was spent'
    );
    ok(state.discovery.exhausted === false, 'the exhausted flag is cleared on the new augment level');
    ok(
      state.discovery.scans === 0 && state.discovery.bursts === 1,
      `the new level starts a fresh per-level budget (${state.discovery.scans} scans, ${state.discovery.bursts} bursts)`
    );
    ok(
      mayhemMonitorWantsScan(state, CLASSIC_ARAM, 1_001_000) === 'discovery',
      'a discovery scan is allowed again after the level-up'
    );
    // The reset is per level edge, not per tick: a death at the same level may
    // not keep reopening a budget that level already spent.
    state.discovery.exhausted = true;
    state.discovery.bursts = MAX_DISCOVERY_BURSTS;
    ok(
      !noteMayhemDiscoveryTrigger(
        state,
        { now: 1_200_000, level: 7, isDead: true, signals: CLASSIC_ARAM },
        { anyAramQueue: true }
      ),
      'a death at the same level cannot reopen an exhausted budget'
    );
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
    const gateAt = tick.indexOf('if (!autoOcrWanted)');
    const gateBlock = gateAt === -1 ? '' : tick.slice(gateAt, gateAt + 500);
    ok(gateAt >= 0, 'the tick computes the pick-level gate once (autoOcrWanted)');
    ok(
      !gateBlock.includes('purgeMayhemOffersFromScreen'),
      'the pick-level gate never purges a displayed roll'
    );
    ok(
      tick.includes('autoOcrAllowed: active ? autoOcrWanted : true'),
      'the engine sees the same gate decision the tick made'
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
    /* Real Mayhem can report queue 450 (ARAM's id), so the live call must pass
     * anyAramQueue or the queue veto silently closes discovery again. */
    const discoveryCallAt = monitor.indexOf('noteMayhemDiscoveryTrigger(mayhemMonitorState');
    const discoveryCall =
      discoveryCallAt === -1 ? '' : monitor.slice(discoveryCallAt, discoveryCallAt + 600);
    ok(
      /noteMayhemDiscoveryTrigger\(mayhemMonitorState,[\s\S]*?\{\s*anyAramQueue:\s*true\s*\}/.test(discoveryCall),
      'the live tick passes { anyAramQueue: true } for queue-450 Mayhem'
    );
  }

  console.log('--- PageUp toggle: the dismiss key also restores ---');
  {
    // 1. A visible panel is still dismissed, exactly as before the toggle.
    const visible = decideMayhemPageUp({ panelVisible: true, dismissed: false, scanInFlight: false });
    ok(
      visible.action === 'dismiss' && visible.reason === 'panel-visible',
      `a visible, non-dismissed panel still dismisses (${visible.action}/${visible.reason})`
    );
    ok(!visible.suppressNonFreshWrite, 'a dismiss never writes, so nothing needs suppressing');

    // 2. After that dismiss the panel is purged and the window is open: the
    // very next press must be the restore, not a second dismissal.
    const dismissed = decideMayhemPageUp({ panelVisible: false, dismissed: true, scanInFlight: false });
    ok(
      dismissed.action === 'restore' && dismissed.reason === 'dismissed',
      `after a dismiss the next PageUp restores (${dismissed.action}/${dismissed.reason})`
    );

    // 3. A hidden (never shown) panel is restored too: the key always has a
    // recovery action, which is the whole point of the toggle.
    const hidden = decideMayhemPageUp({ panelVisible: false, dismissed: false, scanInFlight: false });
    ok(
      hidden.action === 'restore' && hidden.reason === 'panel-hidden',
      `a panel that is not showing restores (${hidden.action}/${hidden.reason})`
    );

    // 4. A scan in flight takes PageDown's rule: restore, clear the dismissal,
    // but never write the in-flight read over the roll.
    const racing = decideMayhemPageUp({ panelVisible: false, dismissed: true, scanInFlight: true });
    ok(
      racing.action === 'restore' && racing.reason === 'scan-in-flight' && racing.suppressNonFreshWrite,
      `an in-flight scan restores without writing its non-fresh read (${racing.action}/${racing.reason})`
    );

    // 5. The user is looking at a visible roll: hide it. The scan's own refusal
    // still protects the write, so the toggle must not stall on the race.
    const visibleRacing = decideMayhemPageUp({ panelVisible: true, dismissed: false, scanInFlight: true });
    ok(
      visibleRacing.action === 'dismiss' && !visibleRacing.suppressNonFreshWrite,
      'a visible panel wins over an in-flight scan (dismiss, no write suppression needed)'
    );

    // The restore is one shared body: both keys call the same helper, so the
    // epoch ordering and the non-fresh guard exist in exactly one place.
    const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
    const section = (start: string, end: string): string => {
      const from = monitor.indexOf(start);
      const to = monitor.indexOf(end, from);
      return from >= 0 && to > from ? monitor.slice(from, to) : '';
    };
    const pageUp = section(
      'export function dismissMayhemAugmentPanelFromHotkey',
      'export function canDismissMayhemPanel'
    );
    const pageDown = section(
      'export async function triggerManualMayhemOcrFromHotkey',
      'async function restoreMayhemAugmentPanelFromHotkey'
    );
    const restore = section(
      'async function restoreMayhemAugmentPanelFromHotkey',
      '/** Diagnostics for the performance panel. */'
    );
    ok(
      pageUp.includes("restoreMayhemAugmentPanelFromHotkey('PageUp')") &&
        pageDown.includes("restoreMayhemAugmentPanelFromHotkey('PageDown')"),
      'PageUp and PageDown both call the one shared restore helper'
    );
    ok(
      pageUp.includes('mayhemUserDismissedUntilMs = now + 120_000'),
      'the dismiss branch keeps the 120 s window'
    );
    ok(
      (monitor.split('mayhemOfferIds = ids').length - 1) === 1,
      'there is exactly one roll-write path (no duplicated restore body)'
    );

    // The shared body clears the dismissal before any capture await, so even a
    // refused (non-fresh) restore lets the next scan show the roll.
    const dismissalClearedAt = restore.indexOf('mayhemUserDismissedUntilMs = 0');
    const dismissedAtClearedAt = restore.indexOf('mayhemAugmentDismissedAt = 0');
    const scanAt = restore.indexOf('await detectMayhemOffers(');
    ok(
      restore.length > 0 &&
        dismissalClearedAt >= 0 &&
        dismissedAtClearedAt >= 0 &&
        dismissalClearedAt < scanAt &&
        dismissedAtClearedAt < scanAt,
      `the shared restore clears the dismissal before the capture await ` +
        `(clear@${dismissalClearedAt}/${dismissedAtClearedAt}, scan@${scanAt})`
    );

    // Epoch ordering inside that one body: bump, await, bump again, then write.
    const firstBump = restore.indexOf('mayhemMonitorEpoch += 1');
    const lastBump = restore.lastIndexOf('mayhemMonitorEpoch += 1');
    const nonFreshGuard = restore.indexOf('if (!read.fresh)');
    const rollWrite = restore.indexOf('mayhemOfferIds = ids');
    ok(
      firstBump >= 0 &&
        firstBump < scanAt &&
        lastBump > scanAt &&
        nonFreshGuard > scanAt &&
        nonFreshGuard < lastBump &&
        rollWrite > lastBump &&
        restore.split('mayhemMonitorEpoch += 1').length - 1 === 2,
      `the shared restore bumps, awaits, bumps again, refuses non-fresh, then writes ` +
        `(bump@${firstBump}, scan@${scanAt}, guard@${nonFreshGuard}, bump@${lastBump}, write@${rollWrite})`
    );

    // The gate hole this brief closed: the offers verify exists but no chain
    // entry ever ran it.
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    ok(
      pkg.scripts['verify:mayhem-offers'] === 'npx --yes tsx verify_mayhem_offers.ts',
      'package.json has a verify:mayhem-offers script'
    );
    ok(
      /verify:mayhem-monitor && npm run verify:mayhem-offers && npm run verify:mayhem-ocr/.test(
        pkg.scripts['verify:release'] ?? ''
      ),
      'verify:release runs verify:mayhem-offers between the monitor and OCR checks'
    );
  }
}

{
  const r = (decision: string, cards: number, extra: { fresh?: boolean; blackFrame?: boolean } = {}) => ({
    decision, frameDisplayCount: cards, fresh: extra.fresh ?? true, blackFrame: extra.blackFrame ?? false,
  });
  ok(mayhemUnverifiedAfterRead(false, r('unverified', 2), false), 'card-shaped unverified frame raises the warning');
  ok(!mayhemUnverifiedAfterRead(true, r('unverified', 0), false), 'plain gameplay frame clears a stuck warning');
  ok(mayhemUnverifiedAfterRead(false, r('unverified', 0, { blackFrame: true }), false), 'black frame raises the borderless warning');
  ok(mayhemUnverifiedAfterRead(true, r('unverified', 0, { fresh: false }), false), 'a read that never ran keeps the warning');
  ok(!mayhemUnverifiedAfterRead(true, r('accept', 3), true), 'accepted roll clears the warning');
  ok(!mayhemUnverifiedAfterRead(false, r('unverified', 2), true), 'a shown roll is not covered by the warning');
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-monitor FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-monitor ok');
});
