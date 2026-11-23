/**
 * Mayhem capture gating regressions (first-run fix, Briefs C and D).
 *
 * Proves the capture regressions against v1.7.0/1.7.1-test.11:
 *
 *   1. the panel mask is built in PHYSICAL pixels (DIP bounds × scaleFactor),
 *      with a non-zero display origin too, so at 125%/150% it stays in the
 *      right rail instead of drifting over the augment cards;
 *   2. the PowerShell capture derives that mask itself, from the frame it
 *      captured (the DIP display rect could belong to another monitor);
 *   3. the desktopCapturer fallback crops the same offer band as the
 *      PowerShell capture (0.08 / 0.18 / 0.84 × 0.62);
 *   4. a real game-window capture is trusted when the foreground belongs to
 *      the game or to our overlay, while a foreign owner (a browser inside the
 *      game rect), a fallback screen and a black frame never count;
 *   4b. every return of `detectMayhemOffers` crosses `toMayhemMonitorRead`, so
 *      `owner` cannot be dropped on the success path (a real parse of offered
 *      cards with owner=false must reach the monitor untrusted and count no
 *      pick); the real `__OT_TARGET__` parser is exercised next to it, because
 *      an injected reader would keep this green with a broken parser;
 *   5. discovery is bounded per match: bursts do not re-arm on every death and
 *      the scan/burst budget stops a classic ARAM from capturing all game;
 *   6. a queue-450 Howling Abyss match (real Mayhem can report 450) qualifies
 *      for the bounded discovery OCR path without reclassifying the mode;
 *   7. why a call did not capture stays distinct: `throttled` inside the
 *      interval, `in-flight` while another capture is pending, and
 *      `unsupported` on a platform with no capture path (not "throttled").
 *
 * Run: npx --yes tsx verify_mayhem_capture_gating.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  mayhemFallbackCropRect,
  mayhemPanelMaskRect,
  type PhysicalRect,
} from './src/logic/mayhem/captureMask';
import bundle from './src/data/mayhem/bundle.json';
import {
  createMayhemMonitorState,
  isMayhemDiscoverySignals,
  isTrustedMayhemFrame,
  mayhemMonitorWantsScan,
  noteMayhemDiscoveryTrigger,
  runMayhemMonitorScan,
  toMayhemMonitorRead,
  type MayhemMonitorInput,
  type MayhemMonitorRead,
  type MayhemMonitorState,
} from './src/logic/mayhem/monitor';
import type { MayhemModeSignals } from './src/logic/mayhem/mode';
import type { MayhemAugment, MayhemBundle } from './src/logic/mayhem/types';
import {
  detectMayhemOffers,
  parseTargetOwner,
  resetMayhemOcrCache,
  setMayhemOcrRetainOffers,
} from './electron/mayhem-ocr';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

// Injected OCR reads must carry boxes now: production refuses box-less text,
// and authoritative acceptance needs three positioned card zones. Input update
// only — the assertions below keep their original meaning.
const THREE_TITLES = ['Jeweled Gauntlet', 'Giant Slayer', 'Recursion'];
function boxedOffers(titles: string[]): {
  text: string;
  lines: Array<{ text: string; rect: { x: number; y: number; w: number; h: number } }>;
} {
  const xs = [0.265, 0.435, 0.605];
  return {
    text: titles.join('\n'),
    lines: titles.map((text, i) => ({ text, rect: { x: xs[i], y: 0.38, w: 0.13, h: 0.04 } })),
  };
}
// A valid frame with an empty trust path (all-unknown shop roll): the new
// contract refuses box-less empty text, so "no known cards" must come from
// accepted placeholder rows instead.
function boxedUnknownRoll(): ReturnType<typeof boxedOffers> {
  const titles = ['Chrono Surge', 'The Timeless', 'Celestial Roar'];
  const roll = boxedOffers(titles);
  return {
    text: `${roll.text}\nReroll 2 left`,
    lines: [...roll.lines, { text: 'Reroll 2 left', rect: { x: 0.4, y: 0.1, w: 0.1, h: 0.03 } }],
  };
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
    frameDisplayCount: frameIds.length,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: false,
    owner: true,
    fallback: false,
    ...extra,
  };
}

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

  console.log('--- 1b. a non-zero display origin is scaled, not copied ---');
  {
    // A secondary display at DIP x=1920 on a 150% desktop. The old bug scaled
    // the footprint but kept the DIP origin, so the mask landed at x≈1505
    // instead of the rail at x=5138 and covered the centred augment cards.
    const dip = { x: 1920, y: 120, width: 1920, height: 1080 };
    const rect = mayhemPanelMaskRect(dip, 1.5);
    const expectedRight =
      Math.round(dip.x * 1.5) + Math.round(dip.width * 1.5 * 0.982);
    ok(
      rect.x + rect.width === expectedRight,
      `mask at 1.5 on a secondary display ends on the physical rail edge (${rect.x + rect.width} vs ${expectedRight})`
    );
    ok(
      rect.x === expectedRight - 570 && rect.y === 601,
      `mask at 1.5 uses the physical origin (${rect.x},${rect.y})`
    );
    ok(
      rect.width === 570 && rect.height === 330,
      `mask footprint at 1.5 is the scaled panel (${rect.width}x${rect.height})`
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

  console.log('--- 3. the PowerShell capture owns its mask and offer band ---');
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

    // The mask must be derived from the captured frame inside the script: the
    // TS DIP display rect could belong to the cursor's monitor, not the game's.
    ok(
      /\[double\]\$PanelScale\s*=\s*0\.85/.test(ps1),
      'the PS1 takes --overlay-scale (hudScale 20 -> 0.85) as -PanelScale'
    );
    ok(
      ps1.includes('function Get-PanelMaskRect') &&
        /Get-PanelMaskRect -FrameLeft \$fx -FrameTop \$fy -FrameWidth \$fw -FrameHeight \$fh/.test(ps1),
      'the PS1 derives the panel mask from the frame it captured'
    );
    ok(
      /Set-MaskRectangles -Bitmap \$bmp -CaptureLeft \$Left -CaptureTop \$Top -Spec \$panelSpec/.test(ps1),
      'the PS1 translates that panel mask into the captured offer-band bitmap'
    );
    ok(
      /Capture-Region -Left \$geo\.Left[\s\S]{0,240}-FrameLeft \$BoundsLeft -FrameTop \$BoundsTop -FrameWidth \$BoundsWidth -FrameHeight \$BoundsHeight/.test(
        ps1
      ),
      'the game-window capture passes its full window rect as the panel frame'
    );
    ok(
      /380\.0 \* \$PanelScale/.test(ps1) &&
        /220\.0 \* \$PanelScale/.test(ps1) &&
        /0\.982/.test(ps1) &&
        /0\.26/.test(ps1),
      'the PS1 mask is the 380x220 panel at 0.982 W / 0.26 H, scaled by the overlay'
    );
    // The parser above is tested against hand-written JSON, so a script that
    // stopped emitting `owner` would leave the trust gate inert while every
    // injected assertion stayed green: pin the emission itself.
    ok(
      /owner\s*=\s*\[bool\]\$owner/.test(ps1),
      'the PS1 target marker emits owner as a bool (the field parseTargetOwner reads)'
    );
    ok(
      /\bPanelScale:/.test(ocrSource) && ocrSource.includes('overlayScaleFromHud('),
      'Electron passes the live --overlay-scale to the capture'
    );
    ok(
      !ocrSource.includes("'-MaskRects'"),
      'the PowerShell path no longer ships a DIP-derived screen-space mask'
    );

    // Execute the script's OWN mask function: the arithmetic that decides which
    // pixels are blanked is production's, not a restatement.
    if (process.platform === 'win32') {
      const harness = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [Parameter(Mandatory = $true)][double]$PanelScale,
  [Parameter(Mandatory = $true)][int]$FrameLeft,
  [Parameter(Mandatory = $true)][int]$FrameTop,
  [Parameter(Mandatory = $true)][int]$FrameWidth,
  [Parameter(Mandatory = $true)][int]$FrameHeight
)
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('mayhem-ocr.ps1 does not parse: ' + $parseErrors[0].Message) }
foreach ($name in @('ConvertTo-TruncatedPixels', 'Get-PanelMaskRect')) {
  $fn = $ast.FindAll({
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true) | Select-Object -First 1
  if (-not $fn) { throw ("mayhem-ocr.ps1 has no $name function: the panel mask is not verifiable") }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$rect = Get-PanelMaskRect -FrameLeft $FrameLeft -FrameTop $FrameTop -FrameWidth $FrameWidth -FrameHeight $FrameHeight
[pscustomobject]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } |
  ConvertTo-Json -Compress
`;
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-panel-mask-'));
      try {
        const harnessPath = path.join(workDir, 'panel-mask-harness.ps1');
        fs.writeFileSync(harnessPath, harness, 'utf8');
        const runMask = (scale: number, frame: PhysicalRect): PhysicalRect => {
          const stdout = execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              harnessPath,
              '-ScriptPath',
              path.resolve('electron', 'scripts', 'mayhem-ocr.ps1'),
              '-PanelScale',
              String(scale),
              '-FrameLeft',
              String(frame.x),
              '-FrameTop',
              String(frame.y),
              '-FrameWidth',
              String(frame.width),
              '-FrameHeight',
              String(frame.height),
            ],
            { encoding: 'utf8', timeout: 120000 }
          );
          return JSON.parse(stdout.trim()) as PhysicalRect;
        };
        const base = runMask(0.85, { x: 0, y: 0, width: 1920, height: 1080 });
        ok(
          base.x === 1562 && base.y === 280 && base.width === 323 && base.height === 187,
          `the PS1 mask is the 380x220 panel at hudScale 20 (${base.x},${base.y} ${base.width}x${base.height})`
        );
        const secondary = runMask(1, { x: 1920, y: 120, width: 1920, height: 1080 });
        ok(
          secondary.x === 3425 &&
            secondary.y === 400 &&
            secondary.width === 380 &&
            secondary.height === 220,
          `the PS1 mask follows the captured window's origin (${secondary.x},${secondary.y} ${secondary.width}x${secondary.height})`
        );
      } catch (error) {
        ok(false, `the PS1 panel-mask function runs (${String(error)})`);
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } else {
      console.log('skip PS1 mask execution (non-Windows)');
    }
  }

  await captureGating();
  await ownerSeam();
  await ocrRefusals();
}

/**
 * The owner trust gate must survive the real OCR path.
 *
 * The defect this pins: `detectMayhemOffers` returned a fresh object literal on
 * the success path that simply omitted `owner`, so every frame that actually
 * held offers reached the monitor with `owner === undefined` and was trusted —
 * the whole `-OwnerPid` / `Test-OwnerForeground` chain had no effect on
 * counting. A hand-built frame cannot catch that; only the real function can.
 */
async function ownerSeam(): Promise<void> {
  console.log('--- 4b. the owner gate survives the real OCR path ---');
  if (typeof toMayhemMonitorRead !== 'function') {
    ok(false, 'the single read seam `toMayhemMonitorRead` exists in monitor.ts');
    return;
  }
  const augments = (bundle as MayhemBundle).augments as MayhemAugment[];
  const fields = {
    ids: ['jeweled_gauntlet', 'giant_slayer'],
    candidateIds: [],
    frameIds: ['jeweled_gauntlet', 'giant_slayer'],
    frameDisplayCount: 2,
    fresh: true,
    valid: true,
    fuzzyScore: 0.97,
    blackFrame: false,
    foreground: true,
    fallback: false,
  };

  // The seam itself: owner is a required argument, and false is preserved.
  const seamRead = toMayhemMonitorRead(fields, false);
  ok(seamRead.owner === false, 'the seam attaches owner=false to the read');
  ok(!isTrustedMayhemFrame(seamRead), 'the monitor refuses a read the seam marked owner=false');
  ok(
    toMayhemMonitorRead(fields, undefined).owner === true,
    'an absent owner defaults to trusted at the seam (older capture scripts)'
  );
  ok(toMayhemMonitorRead(fields, true).owner === true, 'owner=true survives the seam');

  // The real parser, on the line the PowerShell script actually prints. §4b
  // injects a reader, so a broken parser would leave the gate inert while every
  // injected assertion stayed green.
  const targetLine = (owner: unknown): string =>
    `__OT_TARGET__${JSON.stringify({
      pid: 4242,
      exe: 'League of Legends',
      className: 'RiotWindowClass',
      rect: '0,0,1920,1080',
      frame: '1920x1080',
      black: false,
      foreground: true,
      owner,
    })}`;
  ok(parseTargetOwner(targetLine(true)) === true, 'the real parser reads owner=true');
  ok(parseTargetOwner(targetLine(false)) === false, 'the real parser reads owner=false');
  ok(parseTargetOwner(targetLine('false')) === false, 'the real parser reads a stringified "false"');
  // A truncated JSON marker is a target line whose owner could not be read:
  // present but unparsable, so it must fail closed (untrusted), never fall back
  // to the legacy "absent owner" default. A non-JSON marker is the older
  // key=value line, which genuinely never reported an owner.
  ok(
    parseTargetOwner('__OT_TARGET__{"pid":42,') === false,
    'a truncated JSON target marker is untrusted, not an absent owner'
  );
  ok(
    parseTargetOwner('__OT_TARGET__ pid=42 exe=League of Legends') === undefined,
    'a legacy key=value target marker reports no owner (undefined)'
  );
  const withoutOwner = `__OT_TARGET__${JSON.stringify({
    pid: 4242,
    exe: 'League of Legends',
    foreground: true,
  })}`;
  ok(parseTargetOwner(withoutOwner) === undefined, 'the real parser reports an absent owner as undefined');

  // End to end: the real detectMayhemOffers, injected reader, two offered cards.
  resetMayhemOcrCache();
  setMayhemOcrRetainOffers(false);
  let reads = 0;
  const read = await detectMayhemOffers(augments, 0, {
    minMatches: 2,
    readScreen: async () => {
      reads += 1;
      return {
        parsed: {
          ...boxedOffers(THREE_TITLES),
          target: { pid: 4242, exe: 'League of Legends', foreground: true },
          blackFrame: false,
          language: null,
          noTarget: false,
          fallback: false,
        },
        owner: false,
      };
    },
  });
  ok(reads === 1, 'the injected reader ran once through the real parse/accept path');
  ok(read.frameIds.length === 3, `the real OCR read sees all three offers (${read.frameIds.join(',')})`);
  ok(read.fresh && read.valid && !read.blackFrame, 'the real read is a usable frame');
  ok(read.owner === false, 'the success path carries owner=false (the old literal dropped it)');
  ok(!isTrustedMayhemFrame(read), 'the monitor does not trust an offer frame owned by a foreign window');

  // Two offer scans through the real OCR path (the one that used to drop
  // `owner`), then two GENUINELY empty scans produced by the production path:
  // a `__OT_EMPTY_FRAME__` game-window read with zero OCR lines. No hand-built
  // valid empty frame — that shortcut hid the bug where a successful empty
  // capture was marked invalid, so the monitor never saw the scan that ends a
  // pick. An accepted all-unknown roll is NOT empty; it is covered separately
  // below because it must never book a pick.
  const realEmptyRead = (scriptedOwner: boolean) =>
    detectMayhemOffers(augments, 0, {
      minMatches: 2,
      mayhemMatch: true,
      readScreen: async () => ({
        parsed: {
          text: '',
          lines: [],
          target: { pid: 4242, exe: 'League of Legends', foreground: true },
          blackFrame: false,
          language: 'en-US',
          noTarget: false,
          fallback: false,
          emptyFrame: true,
        },
        owner: scriptedOwner,
      }),
    });
  async function runScript(
    scriptedOwner: boolean,
    startAt: number
  ): Promise<{ counted: number; displayedOffers: number; picks: number; trusted: boolean[] }> {
    resetMayhemOcrCache();
    let scriptState = createMayhemMonitorState();
    let counted = 0;
    let displayedOffers = 0;
    const trusted: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      const nextRead: MayhemMonitorRead = i < 2
        ? await detectMayhemOffers(augments, 0, {
            minMatches: 2,
            mayhemMatch: true,
            readScreen: async () => ({
              parsed: {
                ...boxedOffers(THREE_TITLES),
                target: { pid: 4242, exe: 'League of Legends', foreground: true },
                blackFrame: false,
                language: null,
                noTarget: false,
                fallback: false,
              },
              owner: scriptedOwner,
            }),
          })
        : await realEmptyRead(scriptedOwner);
      trusted.push(isTrustedMayhemFrame(nextRead));
      const result = await runMayhemMonitorScan(
        scriptState,
        input(MAYHEM, startAt + i * 1_000),
        async () => nextRead
      );
      scriptState = result.state;
      counted += result.counted;
      if (i === 1) displayedOffers = scriptState.displayIds.length;
    }
    return { counted, displayedOffers, picks: scriptState.counter.picksTaken, trusted };
  }

  const foreign = await runScript(false, 9_000_000);
  ok(foreign.trusted.every((trusted) => !trusted), 'every real frame with owner=false is untrusted');
  ok(foreign.counted === 0 && foreign.picks === 0, 'an offer frame with owner=false never counts a pick');
  ok(foreign.displayedOffers === 3, `its offers still display (only counting is gated) (${foreign.displayedOffers})`);

  // Positive control: the identical sequence with owner=true does count.
  const own = await runScript(true, 9_100_000);
  ok(own.counted === 1, `the same sequence with owner=true counts one pick (${own.counted})`);

  // The production empty read itself is a genuine empty scan: fresh + valid,
  // no ids at all, no refusal. This is the field the monitor was never getting.
  {
    resetMayhemOcrCache();
    const empty = await realEmptyRead(true);
    ok(
      empty.fresh && empty.valid && empty.decision === 'unverified' &&
        empty.ids.length === 0 && empty.frameIds.length === 0 &&
        empty.frameDisplayCount === 0 && empty.refusal === null,
      'a successful empty game-window capture is a fresh, valid, id-free empty scan'
    );
  }

  // A failed (no-target) or box-less NONEMPTY read is NOT a genuine empty scan:
  // it stays invalid and cannot end an armed roll or book a phantom pick.
  {
    type Parsed = {
      text: string;
      lines: Array<{ text: string; rect: { x: number; y: number; w: number; h: number } }>;
      target: { pid: number; exe: string; foreground: boolean } | null;
      blackFrame: boolean;
      language: string | null;
      noTarget: boolean;
      fallback: boolean;
    };
    const picksAfterInvalidEmpty = async (parsed: Parsed): Promise<number> => {
      resetMayhemOcrCache();
      let s = createMayhemMonitorState();
      let picks = 0;
      for (let i = 0; i < 4; i += 1) {
        const read = i < 2
          ? await detectMayhemOffers(augments, 0, {
              minMatches: 2, mayhemMatch: true,
              readScreen: async () => ({
                parsed: {
                  ...boxedOffers(THREE_TITLES),
                  target: { pid: 4242, exe: 'League of Legends', foreground: true },
                  blackFrame: false, language: null, noTarget: false, fallback: false,
                },
                owner: true,
              }),
            })
          : await detectMayhemOffers(augments, 0, {
              minMatches: 2, mayhemMatch: true,
              readScreen: async () => ({ parsed, owner: true }),
            });
        const result = await runMayhemMonitorScan(s, input(MAYHEM, 9_400_000 + i * 1_000), async () => read);
        s = result.state;
        picks += result.counted;
      }
      return picks;
    };
    const boxless: Parsed = {
      text: 'Chrono Surge', lines: [],
      target: { pid: 4242, exe: 'League of Legends', foreground: true },
      blackFrame: false, language: null, noTarget: false, fallback: false,
    };
    const failed: Parsed = {
      text: '', lines: [], target: null,
      blackFrame: false, language: null, noTarget: true, fallback: false,
    };
    ok(await picksAfterInvalidEmpty(boxless) === 0, 'a box-less NONEMPTY read cannot count a pick');
    ok(await picksAfterInvalidEmpty(failed) === 0, 'a failed/no-target read cannot count a pick');
  }

  // An accepted all-unknown roll shows rows but no known ids. After an armed
  // roll, two such frames must not advance the empty streak, book a pick, or
  // purge the unknown roll the player is still looking at.
  {
    resetMayhemOcrCache();
    let scriptState = createMayhemMonitorState();
    let counted = 0;
    const actions: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const read = await detectMayhemOffers(augments, 0, {
        minMatches: 2,
        mayhemMatch: true,
        readScreen: async () => ({
          parsed: {
            ...(i < 3 ? boxedOffers(THREE_TITLES) : boxedUnknownRoll()),
            target: { pid: 4242, exe: 'League of Legends', foreground: true },
            blackFrame: false,
            language: null,
            noTarget: false,
            fallback: false,
          },
          owner: true,
        }),
      });
      const result = await runMayhemMonitorScan(
        scriptState,
        input(MAYHEM, 9_200_000 + i * 1_000),
        async () => read
      );
      scriptState = result.state;
      counted += result.counted;
      actions.push(result.hudAction);
    }
    ok(counted === 0 && scriptState.counter.picksTaken === 0, 'known×3 then all-unknown×2 books no pick');
    ok(!actions.includes('purge'), 'an all-unknown frame never purges the displayed roll');
    ok(
      scriptState.displayIds.length === 3,
      `the unknown roll is still displayed after two all-unknown frames (${scriptState.displayIds.length})`
    );
  }
}

async function captureGating(): Promise<void> {
  console.log('--- 4. trusted frames: owner, black, fallback ---');
  {
    ok(
      isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { owner: true })),
      'owner=true (game or our overlay) is trusted'
    );
    ok(
      !isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { owner: false })),
      'a foreign foreground owner (browser over the game rect) is never trusted'
    );
    ok(
      isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { owner: undefined })),
      'a read without an owner flag stays trusted (older capture scripts)'
    );
    ok(!isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { blackFrame: true })), 'a black frame is never trusted');
    ok(!isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { valid: false })), 'a no-target frame is never trusted');
    ok(!isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { fallback: true })), 'a fallback-screen frame is never trusted');
    ok(!isTrustedMayhemFrame(frame(['jeweled_gauntlet'], { fresh: false })), 'a stale frame is never trusted');

    // The engine itself: offers seen while the overlay owns focus must display
    // and, across offer → empty scans, count a pick.
    let state = createMayhemMonitorState();
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
      const result = await runMayhemMonitorScan(state, input(MAYHEM, now), async () => read);
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
      let s: MayhemMonitorState = createMayhemMonitorState();
      let picks = 0;
      let t = 2_000_000;
      for (const read of [
        frame(['jeweled_gauntlet', 'giant_slayer'], extra),
        frame(['jeweled_gauntlet', 'giant_slayer'], extra),
        frame([], extra),
        frame([], extra),
      ]) {
        const result = await runMayhemMonitorScan(s, input(MAYHEM, t), async () => read);
        s = result.state;
        picks += result.counted;
        t += 10_000;
      }
      ok(picks === 0, `${'fallback' in extra ? 'fallback' : 'black'} frames never count a pick`);
    }

    // A browser owning the foreground inside the game rect: the same visible
    // "offers" must never count, even though they may display.
    {
      let s: MayhemMonitorState = createMayhemMonitorState();
      let picks = 0;
      let t = 2_500_000;
      for (const read of [
        frame(['jeweled_gauntlet', 'giant_slayer'], { owner: false }),
        frame(['jeweled_gauntlet', 'giant_slayer'], { owner: false }),
        frame([], { owner: false }),
        frame([], { owner: false }),
      ]) {
        const result = await runMayhemMonitorScan(s, input(MAYHEM, t), async () => read);
        s = result.state;
        picks += result.counted;
        t += 10_000;
      }
      ok(picks === 0, 'a foreign foreground owner never counts a pick');
    }
  }

  console.log('--- 5. discovery is bounded per match ---');
  {
    // The bug: every death edge re-armed the 90 s burst, so a classic ARAM
    // could spawn a capture every ~10 s for the whole game.
    const state = createMayhemMonitorState();
    const t0 = 4_000_000;
    ok(
      noteMayhemDiscoveryTrigger(
        state,
        { now: t0, level: 3, isDead: false, signals: CLASSIC_450 },
        { anyAramQueue: true }
      ),
      'a level-3 trigger opens a discovery burst'
    );
    const openedAt = state.discovery.burstStartedAt;
    ok(
      noteMayhemDiscoveryTrigger(
        state,
        { now: t0 + 50_000, level: 3, isDead: true, signals: CLASSIC_450 },
        { anyAramQueue: true }
      ) && state.discovery.burstStartedAt === openedAt && state.discovery.bursts === 1,
      'a death inside a live burst does not re-arm it'
    );

    // Exhaust the scan budget with single-offer frames (never two, so the
    // match cannot latch and the budget is what stops it).
    let budgeted = createMayhemMonitorState();
    let t = 5_000_000;
    let scans = 0;
    let iterations = 0;
    let dead = false;
    while (!budgeted.discovery.exhausted && iterations < 80) {
      iterations += 1;
      dead = !dead;
      if (dead) {
        noteMayhemDiscoveryTrigger(
          budgeted,
          { now: t, level: 3, isDead: true, signals: CLASSIC_450 },
          { anyAramQueue: true }
        );
      }
      if (mayhemMonitorWantsScan(budgeted, CLASSIC_450, t) === 'discovery') {
        const result = await runMayhemMonitorScan(
          budgeted,
          { ...input(CLASSIC_450, t), level: 3, isDead: false, autoOcrAllowed: false },
          async () => frame(['jeweled_gauntlet'])
        );
        budgeted = result.state;
        if (result.scanned) scans += 1;
      }
      t += 10_000;
    }
    ok(
      scans === 30 && budgeted.discovery.scans === 30,
      `discovery stops after MAX_DISCOVERY_SCANS=30 scans (${scans})`
    );
    ok(
      budgeted.discovery.bursts <= 6,
      `discovery opens at most MAX_DISCOVERY_BURSTS=6 bursts (${budgeted.discovery.bursts})`
    );
    ok(budgeted.discovery.exhausted === true, 'the exhausted flag is set once the budget is spent');
    ok(
      mayhemMonitorWantsScan(budgeted, CLASSIC_450, t) === 'none',
      'an exhausted match never wants another discovery scan'
    );
    ok(
      !noteMayhemDiscoveryTrigger(
        budgeted,
        { now: t + 120_000, level: 3, isDead: true, signals: CLASSIC_450 },
        { anyAramQueue: true }
      ),
      'an exhausted match cannot open another burst'
    );

    // Two consecutive bursts that read no offer at all also end discovery.
    let empty = createMayhemMonitorState();
    let e = 6_000_000;
    noteMayhemDiscoveryTrigger(
      empty,
      { now: e, level: 3, isDead: false, signals: CLASSIC_450 },
      { anyAramQueue: true }
    );
    let emptyResult = await runMayhemMonitorScan(
      empty,
      { ...input(CLASSIC_450, e), level: 3, isDead: false, autoOcrAllowed: false },
      async () => frame([])
    );
    empty = emptyResult.state;
    e += 91_000;
    noteMayhemDiscoveryTrigger(
      empty,
      { now: e, level: 3, isDead: true, signals: CLASSIC_450 },
      { anyAramQueue: true }
    );
    emptyResult = await runMayhemMonitorScan(
      empty,
      { ...input(CLASSIC_450, e), level: 3, isDead: false, autoOcrAllowed: false },
      async () => frame([])
    );
    empty = emptyResult.state;
    e += 91_000;
    ok(
      !noteMayhemDiscoveryTrigger(
        empty,
        { now: e, level: 3, isDead: true, signals: CLASSIC_450 },
        { anyAramQueue: true }
      ) && empty.discovery.exhausted === true,
      'two consecutive bursts with zero offers stop discovery for the match'
    );
    ok(
      empty.discovery.bursts === 2 && empty.discovery.scans === 2,
      `the empty-burst stop leaves a small, observable trace (${empty.discovery.bursts} bursts, ${empty.discovery.scans} scans)`
    );
  }

  console.log('--- 6. queue-450 Howling Abyss gets bounded discovery OCR ---');
  {
    ok(isMayhemDiscoverySignals(CLASSIC_450), 'queue 450 on Howling Abyss is discovery-eligible');

    const state = createMayhemMonitorState();
    const now = 3_000_000;
    ok(
      noteMayhemDiscoveryTrigger(
        state,
        { now, level: 3, isDead: false, signals: CLASSIC_450 },
        { anyAramQueue: true }
      ),
      'level 3 opens a bounded discovery burst for a queue-450 Howling Abyss match'
    );
    ok(
      mayhemMonitorWantsScan(state, CLASSIC_450, now + 1_000) === 'discovery',
      'the queue-450 match wants a bounded discovery scan'
    );

    let ocrCalls = 0;
    const result = await runMayhemMonitorScan(
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

/**
 * Why a call did not capture: the three refusals are distinct, and a platform
 * without a capture path is not "throttled" (nothing was throttled).
 */
async function ocrRefusals(): Promise<void> {
  console.log('--- 7. refusal reasons: throttled, in-flight, unsupported ---');
  const augments = (bundle as MayhemBundle).augments as MayhemAugment[];
  const screen = async () => ({
    parsed: {
      text: 'Jeweled Gauntlet\nGiant Slayer',
      target: { pid: 4242, exe: 'League of Legends', foreground: true },
      blackFrame: false,
      language: null,
      noTarget: false,
      fallback: false,
    },
    owner: true,
  });

  resetMayhemOcrCache();
  setMayhemOcrRetainOffers(false);
  const first = await detectMayhemOffers(augments, 0, { minMatches: 2, readScreen: screen });
  if (process.platform !== 'win32') {
    ok(
      first.refusal === 'unsupported' && !first.fresh,
      `a platform with no capture path reports unsupported, not throttled (${first.refusal})`
    );
    return;
  }
  ok(first.refusal === null && first.fresh, 'the first scan really ran');

  // Two calls inside minIntervalMs: the second did not capture, and says why.
  const throttled = await detectMayhemOffers(augments, 60_000, { minMatches: 2, readScreen: screen });
  ok(
    throttled.refusal === 'throttled' && !throttled.fresh,
    `a second scan inside minIntervalMs is refused as throttled (${throttled.refusal})`
  );

  // In flight: a readScreen that starts another scan while this one holds the
  // capture. The inner call never runs, and its own verdict says so.
  resetMayhemOcrCache();
  let innerRefusal: string | null | undefined;
  const outer = await detectMayhemOffers(augments, 0, {
    minMatches: 2,
    readScreen: async () => {
      const inner = await detectMayhemOffers(augments, 0, { minMatches: 2, readScreen: screen });
      innerRefusal = inner.refusal;
      return screen();
    },
  });
  ok(
    innerRefusal === 'in-flight',
    `a scan started while another is in flight is refused as in-flight (${innerRefusal})`
  );
  ok(outer.refusal === null && outer.fresh, 'the outer scan still completes normally');
}

void main()
  .then(() => {
    if (failures > 0) {
      console.error(`verify:mayhem-capture-gating FAILED (${failures} check(s))`);
      process.exit(1);
    }
    console.log('verify:mayhem-capture-gating ok');
  });
