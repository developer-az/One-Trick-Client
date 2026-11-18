/**
 * Mayhem capture gating regressions (first-run fix, Brief C).
 *
 * Proves the three confirmed capture regressions against v1.7.0:
 *
 *   1. the panel mask is built in PHYSICAL pixels (DIP bounds × scaleFactor),
 *      so at 125% it stays in the right rail instead of drifting over the
 *      augment cards;
 *   2. the desktopCapturer fallback crops the same offer band as the
 *      PowerShell capture (0.08 / 0.18 / 0.84 × 0.62), not the old, wider box;
 *   3. a real game-window capture is trusted even when the game is not
 *      focused (our overlay steals focus), while fallback-screen and black
 *      frames still never count;
 *   4. a queue-450 Howling Abyss match (real Mayhem can report 450) qualifies
 *      for the bounded discovery OCR path without reclassifying the mode.
 *
 * Run: npx --yes tsx verify_mayhem_capture_gating.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  mayhemFallbackCropRect,
  mayhemPanelMaskRect,
  type PhysicalRect,
} from './src/logic/mayhem/captureMask';
import * as monitorCore from './src/logic/mayhem/monitor';
import type {
  MayhemMonitorInput,
  MayhemMonitorRead,
  MayhemMonitorState,
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

function overlaps(a: PhysicalRect, b: PhysicalRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function contains(outer: PhysicalRect, inner: PhysicalRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function input(
  signals: MayhemModeSignals,
  now: number,
  extra: Partial<MayhemMonitorInput> = {}
): MayhemMonitorInput {
  return {
    now,
    level: 3,
    isDead: false,
    signals,
    liveAugmentIds: [],
    autoOcrAllowed: true,
    ...extra,
  };
}

function frame(
  frameIds: string[],
  extra: Partial<MayhemMonitorRead> = {}
): MayhemMonitorRead {
  return {
    ids: frameIds,
    candidateIds: [],
    frameIds,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: false,
    fallback: false,
    ...extra,
  };
}

/** The production monitor keeps optional/new probes behind a soft shape check. */
type MonitorProbe = typeof monitorCore & {
  isTrustedMayhemFrame?: (read: MayhemMonitorRead) => boolean;
  isMayhemDiscoverySignals?: (signals: MayhemModeSignals) => boolean;
};

const monitor = monitorCore as MonitorProbe;

const MAYHEM: MayhemModeSignals = {
  gameMode: 'KIWI',
  mapName: 'Map12',
  queueId: 2400,
  mapId: 12,
};
const CLASSIC_450: MayhemModeSignals = {
  gameMode: 'ARAM',
  mapName: 'Map12',
  queueId: 450,
  mapId: 12,
};

async function main(): Promise<void> {
  console.log('--- 1. panel mask is physical, not DIP ---');
  {
    // 1920×1080 DIP at 125% = a 2400×1350 physical desktop.
    const dip = { x: 0, y: 0, width: 1920, height: 1080 };
    const physical = { width: 2400, height: 1350 };
    const rect = mayhemPanelMaskRect(dip, 1.25);
    const rightPanelBand: PhysicalRect = {
      x: Math.round(physical.width * 0.75),
      y: 0,
      width: physical.width - Math.round(physical.width * 0.75),
      height: physical.height,
    };
    // The augment cards sit centred; the right 24% is clear of them.
    const cardBand: PhysicalRect = {
      x: Math.round(physical.width * 0.24),
      y: 0,
      width: Math.round(physical.width * 0.48),
      height: physical.height,
    };
    ok(
      contains(rightPanelBand, rect),
      `mask at 1.25 is fully inside the right panel band (${rect.x},${rect.y} ${rect.width}x${rect.height})`
    );
    ok(
      !overlaps(rect, cardBand),
      `mask at 1.25 does not overlap the card band (${rect.x},${rect.y} ${rect.width}x${rect.height})`
    );
    ok(
      rect.width === Math.round(380 * 1.25) && rect.height === Math.round(220 * 1.25),
      'mask footprint is scaled to physical pixels at 1.25'
    );
  }

  console.log('--- 2. scale 1 mask stays exactly as shipped ---');
  {
    const rect = mayhemPanelMaskRect({ x: 0, y: 0, width: 1920, height: 1080 }, 1);
    ok(
      rect.x === 1505 && rect.y === 281 && rect.width === 380 && rect.height === 220,
      `mask at scale 1 is unchanged (${rect.x},${rect.y} ${rect.width}x${rect.height})`
    );
  }

  console.log('--- 3. desktopCapturer fallback matches the PowerShell band ---');
  {
    const ps1 = fs.readFileSync(path.join('electron', 'scripts', 'mayhem-ocr.ps1'), 'utf8');
    const psFrac = (name: string): number => {
      const match = new RegExp(`\\[double\\]\\$${name}\\s*=\\s*([0-9.]+)`).exec(ps1);
      return match ? Number(match[1]) : NaN;
    };
    const left = psFrac('LeftFrac');
    const top = psFrac('TopFrac');
    const widthFrac = psFrac('WidthFrac');
    const heightFrac = psFrac('HeightFrac');
    ok(
      left === 0.08 && top === 0.18 && widthFrac === 0.84 && heightFrac === 0.62,
      `PowerShell offer band is 0.08/0.18/0.84x0.62 (${left}/${top}/${widthFrac}x${heightFrac})`
    );

    const width = 1920;
    const height = 1080;
    const crop = mayhemFallbackCropRect(width, height);
    ok(
      crop.x === Math.trunc(width * left) &&
        crop.y === Math.trunc(height * top) &&
        crop.width === Math.trunc(width * widthFrac) &&
        crop.height === Math.trunc(height * heightFrac),
      `fallback crop equals the PowerShell band (${crop.x},${crop.y} ${crop.width}x${crop.height})`
    );

    const ocrSource = fs.readFileSync(path.join('electron', 'mayhem-ocr.ts'), 'utf8');
    ok(
      ocrSource.includes('mayhemFallbackCropRect('),
      'desktopCapturer fallback uses the shared PowerShell offer-band crop'
    );
  }

  console.log('--- 4. trusted frames ignore focus, reject black/fallback ---');
  {
    const trusted = monitor.isTrustedMayhemFrame;
    ok(typeof trusted === 'function', 'monitor exports the trusted-frame decision');
    if (typeof trusted === 'function') {
      ok(
        trusted(frame(['jeweled_gauntlet', 'giant_slayer'], { foreground: false })),
        'a real target capture is trusted with foreground=false'
      );
      ok(!trusted(frame(['jeweled_gauntlet'], { blackFrame: true })), 'a black frame is never trusted');
      ok(!trusted(frame(['jeweled_gauntlet'], { valid: false })), 'a no-target frame is never trusted');
      ok(!trusted(frame(['jeweled_gauntlet'], { fallback: true })), 'a fallback-screen frame is never trusted');
      ok(!trusted(frame(['jeweled_gauntlet'], { fresh: false })), 'a stale frame is never trusted');
    }

    // The engine itself: offers seen while the overlay owns focus must display
    // and, across offer → empty scans, count a pick.
    let state = monitor.createMayhemMonitorState();
    let counted = 0;
    let displayedOffers = 0;
    const reads = [
      frame(['jeweled_gauntlet', 'giant_slayer'], { foreground: false }),
      frame(['jeweled_gauntlet', 'giant_slayer'], { foreground: false }),
      frame([], { foreground: false }),
      frame([], { foreground: false }),
    ];
    let now = 1_000_000;
    let readIndex = 0;
    for (const read of reads) {
      const result = await monitor.runMayhemMonitorScan(state, input(MAYHEM, now), async () => read);
      state = result.state;
      counted += result.counted;
      readIndex += 1;
      if (readIndex === 2) displayedOffers = state.displayIds.length;
      now += 10_000;
    }
    ok(displayedOffers === 2, 'offers from an unfocused game window still display');
    ok(counted === 1 && state.counter.picksTaken === 1, 'an unfocused but captured offer → empty cycle counts one pick');

    // Fallback screen and black frames must still never count.
    for (const extra of [{ fallback: true }, { blackFrame: true }] as const) {
      let s: MayhemMonitorState = monitor.createMayhemMonitorState();
      let picks = 0;
      let t = 2_000_000;
      for (const read of [
        frame(['jeweled_gauntlet', 'giant_slayer'], extra),
        frame(['jeweled_gauntlet', 'giant_slayer'], extra),
        frame([], extra),
        frame([], extra),
      ]) {
        const result = await monitor.runMayhemMonitorScan(s, input(MAYHEM, t), async () => read);
        s = result.state;
        picks += result.counted;
        t += 10_000;
      }
      ok(picks === 0, `${'fallback' in extra ? 'fallback' : 'black'} frames never count a pick`);
    }
  }

  console.log('--- 5. queue-450 Howling Abyss gets bounded discovery OCR ---');
  {
    ok(
      typeof monitor.isMayhemDiscoverySignals === 'function' &&
        monitor.isMayhemDiscoverySignals(CLASSIC_450),
      'queue 450 on Howling Abyss is discovery-eligible'
    );

    const state = monitor.createMayhemMonitorState();
    const now = 3_000_000;
    const trigger = monitor.noteMayhemDiscoveryTrigger as (
      s: MayhemMonitorState,
      i: { now: number; level: number; isDead: boolean; signals: MayhemModeSignals },
      options?: { anyAramQueue?: boolean }
    ) => boolean;
    ok(
      trigger(state, { now, level: 3, isDead: false, signals: CLASSIC_450 }, { anyAramQueue: true }),
      'level 3 opens a bounded discovery burst for a queue-450 Howling Abyss match'
    );
    ok(
      monitor.mayhemMonitorWantsScan(state, CLASSIC_450, now + 1_000) === 'discovery',
      'the queue-450 match wants a bounded discovery scan'
    );

    let ocrCalls = 0;
    const result = await monitor.runMayhemMonitorScan(
      state,
      {
        now: now + 1_000,
        level: 3,
        isDead: false,
        signals: CLASSIC_450,
        liveAugmentIds: [],
        autoOcrAllowed: false,
      },
      async () => {
        ocrCalls += 1;
        return frame([]);
      }
    );
    ok(ocrCalls === 1 && result.scanned && result.discovery, 'the queue-450 match runs the bounded discovery OCR path');
    ok(result.mode === 'aram', 'the queue-450 match keeps the aram label');
  }
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-capture-gating FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-capture-gating ok');
});
