/**
 * Proves the production OCR crop geometry, not a copy of it.
 *
 * `src/logic/mayhem/captureRegion.ts` mirrors `electron/scripts/mayhem-ocr.ps1`,
 * and its expected values are frozen in `verify_real_game_regressions.ts`. That
 * mirror is only meaningful if PowerShell agrees to the pixel: `[int]` rounds
 * (1920 * 0.84 = 1612.8 -> 1613) while the mirror truncates, which shipped a
 * one-pixel-wider offer band than the verified geometry.
 *
 * This verifier executes the ps1's OWN `Get-OfferGeometry` function: the
 * function is parsed out of the real script with the PowerShell AST and invoked
 * here, so the arithmetic under test is production's, not a restatement.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_OFFER_FRACTIONS,
  fractionalOfferRegion,
  primaryFallbackCapture,
  type CaptureRegion,
  type ScreenBounds,
} from './src/logic/mayhem/captureRegion';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ps1Path = path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1');

function ok(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL', message);
    process.exitCode = 1;
  } else {
    console.log('ok', message);
  }
}

interface GeometryCase {
  label: string;
  bounds: ScreenBounds;
  /** The crop the frozen mirror expects (truncated, matching the ps1 policy). */
  expected: CaptureRegion;
}

const CASES: GeometryCase[] = [
  {
    label: '1920x1080 primary at the origin',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    expected: { left: 153, top: 194, width: 1612, height: 669 },
  },
  {
    label: '1280x720 primary at the origin',
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    expected: { left: 102, top: 129, width: 1075, height: 446 },
  },
  {
    label: '2560x1440 primary at the origin',
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    expected: { left: 204, top: 259, width: 2150, height: 892 },
  },
  {
    label: '1920x1080 primary at a negative/top offset origin',
    bounds: { x: -1920, y: 240, width: 1920, height: 1080 },
    expected: { left: -1767, top: 434, width: 1612, height: 669 },
  },
];

interface PsGeometryResult {
  leftFrac: number;
  topFrac: number;
  widthFrac: number;
  heightFrac: number;
  results: Array<{ left: number; top: number; width: number; height: number }>;
}

/**
 * A harness that loads the ps1's geometry functions and fractions from the real
 * file. No arithmetic is restated here: only the function names and the
 * parameter reading are.
 */
const HARNESS = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [Parameter(Mandatory = $true)][string]$CasesPath
)
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('mayhem-ocr.ps1 does not parse: ' + $parseErrors[0].Message) }
foreach ($name in @('ConvertTo-TruncatedPixels', 'Get-OfferGeometry')) {
  $fn = $ast.FindAll({
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true) | Select-Object -First 1
  if (-not $fn) { throw ("mayhem-ocr.ps1 has no $name function: the offer geometry is not verifiable") }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$source = Get-Content -LiteralPath $ScriptPath -Raw
foreach ($name in @('LeftFrac', 'TopFrac', 'WidthFrac', 'HeightFrac')) {
  $match = [regex]::Match($source, '\[double\]\$' + $name + '\s*=\s*([0-9.]+)')
  if (-not $match.Success) { throw ("mayhem-ocr.ps1 has no $" + $name + " default") }
  Set-Variable -Name $name -Value ([double]$match.Groups[1].Value)
}
# Windows PowerShell 5.1 hands a JSON array out of ConvertFrom-Json as one
# object, so enumerate it directly instead of wrapping it in @().
$cases = Get-Content -LiteralPath $CasesPath -Raw | ConvertFrom-Json
$results = @()
foreach ($case in $cases) {
  $geo = Get-OfferGeometry -BoundsX $case.x -BoundsY $case.y -BoundsWidth $case.width -BoundsHeight $case.height
  $results += [pscustomobject]@{
    left = [int]$geo.Left
    top = [int]$geo.Top
    width = [int]$geo.Width
    height = [int]$geo.Height
  }
}
[pscustomobject]@{
  leftFrac = $LeftFrac
  topFrac = $TopFrac
  widthFrac = $WidthFrac
  heightFrac = $HeightFrac
  results = $results
} | ConvertTo-Json -Depth 5 -Compress
`;

function runActualGeometry(): PsGeometryResult | null {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-ocr-geometry-'));
  try {
    const harnessPath = path.join(workDir, 'geometry-harness.ps1');
    const casesPath = path.join(workDir, 'cases.json');
    fs.writeFileSync(harnessPath, HARNESS, 'utf8');
    fs.writeFileSync(
      casesPath,
      JSON.stringify(CASES.map((c) => c.bounds)),
      'utf8'
    );
    const stdout = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        harnessPath,
        '-ScriptPath',
        ps1Path,
        '-CasesPath',
        casesPath,
      ],
      { cwd: root, encoding: 'utf8', timeout: 120000 }
    );
    const parsed = JSON.parse(stdout.trim()) as PsGeometryResult;
    if (!Array.isArray(parsed.results) || parsed.results.length !== CASES.length) {
      console.error('unexpected harness output:', stdout);
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('could not execute the ps1 geometry:', String(error));
    return null;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function sameRect(a: CaptureRegion, b: CaptureRegion): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function show(rect: CaptureRegion): string {
  return `${rect.left},${rect.top} ${rect.width}x${rect.height}`;
}

if (process.platform !== 'win32') {
  console.log('skip OCR geometry (non-Windows: no PowerShell/System.Windows.Forms)');
} else {
  const actual = runActualGeometry();
  ok(actual !== null, 'the production ps1 offer geometry runs');
  if (actual) {
    ok(
      Math.abs(actual.leftFrac - DEFAULT_OFFER_FRACTIONS.leftFrac) < 1e-9 &&
        Math.abs(actual.topFrac - DEFAULT_OFFER_FRACTIONS.topFrac) < 1e-9 &&
        Math.abs(actual.widthFrac - DEFAULT_OFFER_FRACTIONS.widthFrac) < 1e-9 &&
        Math.abs(actual.heightFrac - DEFAULT_OFFER_FRACTIONS.heightFrac) < 1e-9,
      `the ps1 and captureRegion.ts share the offer fractions (${actual.leftFrac},${actual.topFrac},${actual.widthFrac},${actual.heightFrac})`
    );
    CASES.forEach((testCase, index) => {
      const ps = actual.results[index];
      const mirror = primaryFallbackCapture(testCase.bounds).crop;
      const windowPath = fractionalOfferRegion(testCase.bounds);
      const fallback = primaryFallbackCapture(testCase.bounds);
      ok(
        ps.left === testCase.expected.left &&
          ps.top === testCase.expected.top &&
          ps.width === testCase.expected.width &&
          ps.height === testCase.expected.height,
        `${testCase.label}: the ps1 truncates to the frozen crop (${show(ps)} vs ${show(testCase.expected)})`
      );
      ok(
        sameRect(ps, mirror),
        `${testCase.label}: the ps1 crop equals captureRegion.ts's primary fallback crop (${show(ps)} vs ${show(mirror)})`
      );
      ok(
        sameRect(ps, windowPath),
        `${testCase.label}: the window path and the fallback share one crop policy (${show(windowPath)})`
      );
      ok(
        fallback.capture.left === testCase.bounds.x &&
          fallback.capture.top === testCase.bounds.y &&
          fallback.capture.width === testCase.bounds.width &&
          fallback.capture.height === testCase.bounds.height,
        `${testCase.label}: the fallback still captures the primary's full bounds (${show(fallback.capture)})`
      );
      ok(
        ps.width > 0 && ps.height > 0,
        `${testCase.label}: the ps1 crop has a positive size (${ps.width}x${ps.height})`
      );
    });
  }
  if (!process.exitCode) console.log('verify:ocr-geometry-actual ok');
}
