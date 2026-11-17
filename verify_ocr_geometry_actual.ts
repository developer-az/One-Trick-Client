/**
 * Proves the production OCR crop geometry, not a copy of it.
 *
 * `src/logic/mayhem/captureRegion.ts` mirrors `electron/scripts/mayhem-ocr.ps1`,
 * and its expected values are frozen in `verify_real_game_regressions.ts`. That
 * mirror is only meaningful if PowerShell agrees to the pixel: `[int]` rounds
 * (1920 * 0.84 = 1612.8 -> 1613) while the mirror truncates, which shipped a
 * one-pixel-wider offer band than the verified geometry.
 *
 * This verifier executes the ps1's OWN functions: they are parsed out of the
 * real script with the PowerShell AST and dot-sourced here, so the arithmetic
 * under test is production's, not a restatement.
 *
 * Two things are proven:
 *  - `Get-OfferGeometry` truncates to the frozen crops of
 *    `verify_real_game_regressions.ts` at every tested resolution/origin.
 *  - `ConvertTo-CropRect` translates a screen-space crop into the captured
 *    bitmap's local pixels and clips it, for positive and negative capture
 *    origins. That translation is what actually decides which pixels are OCR'd;
 *    a sign error there would crop the wrong screen area silently.
 *
 * The AST harness also reads `Capture-PrimaryScreen` and requires its
 * `Get-OfferGeometry` result to feed the `Capture-Region` crop arguments, so a
 * future edit that computes the band but crops somewhere else fails here.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cropRectToBitmap,
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

interface CropCase {
  label: string;
  /** The crop the ps1 asks for, in screen coordinates. */
  crop: CaptureRegion;
  /** The frame it captured: `Capture-Region`'s Left/Top/Width/Height. */
  capture: CaptureRegion;
  /** The bitmap's real pixel size; Clip cases rely on it differing from crop. */
  bitmapWidth: number;
  bitmapHeight: number;
  expected: CaptureRegion;
}

const CROP_CASES: CropCase[] = [
  {
    label: '1920x1080 capture at the origin keeps the band where it was computed',
    crop: { left: 153, top: 194, width: 1612, height: 669 },
    capture: { left: 0, top: 0, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 153, top: 194, width: 1612, height: 669 },
  },
  {
    label: 'a negative capture origin is added back, not subtracted twice',
    crop: { left: -1767, top: 434, width: 1612, height: 669 },
    capture: { left: -1920, top: 240, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 153, top: 194, width: 1612, height: 669 },
  },
  {
    label: 'a positive non-zero capture origin translates the same way',
    crop: { left: 2713, top: 194, width: 1612, height: 669 },
    capture: { left: 2560, top: 0, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 153, top: 194, width: 1612, height: 669 },
  },
  {
    label: 'a crop past the right/bottom edge is clipped to the bitmap',
    crop: { left: 1500, top: 900, width: 800, height: 400 },
    capture: { left: 0, top: 0, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 1500, top: 900, width: 420, height: 180 },
  },
  {
    label: 'a crop left/above the capture origin clamps at zero',
    crop: { left: 40, top: 20, width: 200, height: 160 },
    capture: { left: 100, top: 80, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 0, top: 0, width: 200, height: 160 },
  },
  {
    label: 'a crop starting at the bitmap edge collapses to zero size (no crop)',
    crop: { left: 1920, top: 0, width: 100, height: 100 },
    capture: { left: 0, top: 0, width: 1920, height: 1080 },
    bitmapWidth: 1920,
    bitmapHeight: 1080,
    expected: { left: 1920, top: 0, width: 0, height: 100 },
  },
];

interface PsGeometryResult {
  leftFrac: number;
  topFrac: number;
  widthFrac: number;
  heightFrac: number;
  results: Array<{ left: number; top: number; width: number; height: number }>;
  crops: Array<{ x: number; y: number; width: number; height: number }>;
  primaryCropFromGeometry: boolean;
  primaryProblems: string[];
}

/**
 * A harness that loads the ps1's functions and fractions from the real file.
 * No arithmetic is restated here: only the function names and the parameter
 * reading are.
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
foreach ($name in @('ConvertTo-TruncatedPixels', 'Get-OfferGeometry', 'ConvertTo-CropRect')) {
  $fn = $ast.FindAll({
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true) | Select-Object -First 1
  if (-not $fn) { throw ("mayhem-ocr.ps1 has no $name function: the OCR crop is not verifiable") }
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
$input = Get-Content -LiteralPath $CasesPath -Raw | ConvertFrom-Json
$results = @()
foreach ($case in $input.geometry) {
  $geo = Get-OfferGeometry -BoundsX $case.x -BoundsY $case.y -BoundsWidth $case.width -BoundsHeight $case.height
  $results += [pscustomobject]@{
    left = [int]$geo.Left
    top = [int]$geo.Top
    width = [int]$geo.Width
    height = [int]$geo.Height
  }
}
$cropResults = @()
foreach ($case in $input.crops) {
  $crop = ConvertTo-CropRect -CropLeft $case.cropLeft -CropTop $case.cropTop -CropWidth $case.cropWidth -CropHeight $case.cropHeight -CaptureLeft $case.captureLeft -CaptureTop $case.captureTop -BitmapWidth $case.bitmapWidth -BitmapHeight $case.bitmapHeight
  $cropResults += [pscustomobject]@{
    x = [int]$crop.X
    y = [int]$crop.Y
    width = [int]$crop.Width
    height = [int]$crop.Height
  }
}

# The fallback must crop with the geometry it computed: trace the arguments of
# its Capture-Region call back through one level of simple assignments, because
# the frozen regex in verify_real_game_regressions.ts pins $rx/$ry/$rw/$rh.
$primaryFn = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Capture-PrimaryScreen'
  }, $true) | Select-Object -First 1
if (-not $primaryFn) { throw 'mayhem-ocr.ps1 has no Capture-PrimaryScreen function' }
$assigned = @{}
foreach ($a in $primaryFn.Body.FindAll({
      param($node)
      $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left -is [System.Management.Automation.Language.VariableExpressionAst]
    }, $true)) {
  $assigned[$a.Left.VariablePath.UserPath] = $a.Right.Extent.Text
}
$geoVariable = ''
foreach ($name in $assigned.Keys) {
  if ($assigned[$name] -like 'Get-OfferGeometry*') { $geoVariable = $name }
}
$captureCall = $primaryFn.Body.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Capture-Region'
  }, $true) | Select-Object -First 1
$used = @{}
if ($captureCall) {
  $current = ''
  foreach ($element in $captureCall.CommandElements) {
    if ($element -is [System.Management.Automation.Language.CommandParameterAst]) {
      $current = $element.ParameterName
      $used[$current] = ''
    } elseif ($current) {
      $used[$current] = $element.Extent.Text
    }
  }
}
$problems = @()
if (-not $geoVariable) { $problems += 'Capture-PrimaryScreen never assigns a Get-OfferGeometry result' }
if (-not $captureCall) { $problems += 'Capture-PrimaryScreen never calls Capture-Region' }
if ($geoVariable -and $assigned[$geoVariable] -notmatch '-BoundsX \$b\.X\s+-BoundsY \$b\.Y\s+-BoundsWidth \$b\.Width\s+-BoundsHeight \$b\.Height') {
  $problems += 'the fallback geometry is not computed from the primary screen bounds ($b)'
}
foreach ($pair in @(@('CropLeft', 'Left'), @('CropTop', 'Top'), @('CropWidth', 'Width'), @('CropHeight', 'Height'))) {
  $argument = $used[$pair[0]]
  if (-not $argument) { $problems += ("Capture-Region loses -" + $pair[0]); continue }
  $resolved = $argument
  if ($argument -match '^\$([A-Za-z_][A-Za-z0-9_]*)$' -and $assigned.ContainsKey($Matches[1])) {
    $resolved = $assigned[$Matches[1]]
  }
  $expected = '$' + $geoVariable + '.' + $pair[1]
  if ($resolved -ne $expected) {
    $problems += ("-" + $pair[0] + " is '" + $argument + "' -> '" + $resolved + "', expected " + $expected)
  }
}

[pscustomobject]@{
  leftFrac = $LeftFrac
  topFrac = $TopFrac
  widthFrac = $WidthFrac
  heightFrac = $HeightFrac
  results = $results
  crops = $cropResults
  primaryCropFromGeometry = [bool]($problems.Count -eq 0)
  primaryProblems = [string[]]$problems
} | ConvertTo-Json -Depth 6 -Compress
`;

function runActualGeometry(): PsGeometryResult | null {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-ocr-geometry-'));
  try {
    const harnessPath = path.join(workDir, 'geometry-harness.ps1');
    const casesPath = path.join(workDir, 'cases.json');
    fs.writeFileSync(harnessPath, HARNESS, 'utf8');
    fs.writeFileSync(
      casesPath,
      JSON.stringify({
        geometry: CASES.map((c) => c.bounds),
        crops: CROP_CASES.map((c) => ({
          cropLeft: c.crop.left,
          cropTop: c.crop.top,
          cropWidth: c.crop.width,
          cropHeight: c.crop.height,
          captureLeft: c.capture.left,
          captureTop: c.capture.top,
          bitmapWidth: c.bitmapWidth,
          bitmapHeight: c.bitmapHeight,
        })),
      }),
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
    if (
      !Array.isArray(parsed.results) ||
      parsed.results.length !== CASES.length ||
      !Array.isArray(parsed.crops) ||
      parsed.crops.length !== CROP_CASES.length
    ) {
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
      const fallback = primaryFallbackCapture(testCase.bounds);
      const windowPath = fractionalOfferRegion(testCase.bounds);
      ok(
        ps.left === testCase.expected.left &&
          ps.top === testCase.expected.top &&
          ps.width === testCase.expected.width &&
          ps.height === testCase.expected.height,
        `${testCase.label}: the ps1 truncates to the frozen crop (${show(ps)} vs ${show(testCase.expected)})`
      );
      ok(
        sameRect(ps, fallback.crop),
        `${testCase.label}: the ps1 crop equals captureRegion.ts's primary fallback crop (${show(ps)} vs ${show(fallback.crop)})`
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

    console.log('--- bitmap-local crop translation (ConvertTo-CropRect) ---');
    CROP_CASES.forEach((testCase, index) => {
      const ps = actual.crops[index];
      const local: CaptureRegion = {
        left: ps.x,
        top: ps.y,
        width: ps.width,
        height: ps.height,
      };
      const mirror = cropRectToBitmap(
        testCase.crop,
        testCase.capture,
        testCase.bitmapWidth,
        testCase.bitmapHeight
      );
      ok(
        sameRect(local, testCase.expected),
        `${testCase.label}: the ps1 produces ${show(testCase.expected)} (got ${show(local)})`
      );
      ok(
        sameRect(local, mirror),
        `${testCase.label}: captureRegion.ts's cropRectToBitmap agrees (${show(mirror)})`
      );
    });
    CROP_CASES.slice(0, 3).forEach((testCase, index) => {
      const ps = actual.crops[index];
      ok(
        ps.width > 0 && ps.height > 0,
        `${testCase.label}: the translated crop has a positive size (${ps.width}x${ps.height})`
      );
    });

    console.log('--- the fallback crops with the geometry it computed ---');
    ok(
      actual.primaryCropFromGeometry,
      `Capture-PrimaryScreen feeds Get-OfferGeometry's band into Capture-Region${
        actual.primaryProblems.length ? ' (' + actual.primaryProblems.join('; ') + ')' : ''
      }`
    );
  }
  if (!process.exitCode) console.log('verify:ocr-geometry-actual ok');
}
