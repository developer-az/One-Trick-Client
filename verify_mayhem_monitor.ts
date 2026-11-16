/**
 * Mayhem monitor integration (review fixes on fix-45).
 *
 * Drives the real monitor scan engine (`src/logic/mayhem/monitor.ts`) with an
 * injected OCR runner through the three behaviours that were broken:
 *
 *   1. an unknown-queue ARAM game runs bounded discovery scans and is
 *      classified Mayhem from the offers on screen (classic ARAM 450 never
 *      scans);
 *   2. two offer frames followed by two empty frames count exactly one pick,
 *      even though the OCR adapter returns the retained roll as display ids;
 *   3. a failed capture / missing game window frame in the middle neither
 *      counts nor resets the streaks.
 *
 * Run: npx --yes tsx verify_mayhem_monitor.ts
 */

import {
  createMayhemMonitorState,
  isUnknownQueueAram,
  mayhemDiscoveryLive,
  mayhemMonitorWantsScan,
  runMayhemMonitorScan,
  type MayhemMonitorInput,
  type MayhemMonitorRead,
  type MayhemMonitorState,
} from './src/logic/mayhem/monitor';
import type { MayhemModeSignals } from './src/logic/mayhem/mode';

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
    frameIds,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: true,
    ...extra,
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
    // Rate limit + 3-minute window.
    let ocrCalls = 0;
    const first = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      input(UNKNOWN_ARAM, 1_000_000),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(first.scanned && ocrCalls === 1, 'the first empty discovery scan runs');
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
      !mayhemDiscoveryLive(due.state.discovery, 1_000_000 + 180_001),
      'discovery expires three minutes after its first scan'
    );
    const expired = await runMayhemMonitorScan(
      due.state,
      input(UNKNOWN_ARAM, 1_000_000 + 180_001),
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(!expired.scanned && ocrCalls === 2, 'no scan runs after the three-minute window with no offers');
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
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-monitor FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-monitor ok');
});
