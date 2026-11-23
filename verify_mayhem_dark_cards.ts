/**
 * Patch-day rolls on dark neutral card art (test.28 real-match log).
 *
 * Pins: three/two unknown titles + aligned dark slot bodies with clean gaps are
 * accepted as display-only placeholders; a uniform band (gap > 0) or ranked /
 * no-geometry frames stay unverified. Also runs the shipped PowerShell
 * Test-CardBody against the logged RGB values.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bundle from './src/data/mayhem/bundle.json';
import type { MayhemCardSlot } from './src/logic/mayhem/ocrOutput';
import {
  classifyMayhemFrame,
  createMayhemPipelineState,
  type MayhemFrameLine,
  type MayhemFrameMatchMode,
} from './src/logic/mayhem/pipeline';
import type { MayhemBundle } from './src/logic/mayhem/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const augments = (bundle as MayhemBundle).augments;

function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`ok ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    process.exitCode = 1;
  }
}

function line(text: string, cx: number, cy = 0.405): MayhemFrameLine {
  return { text, rect: { x: cx - 0.05, y: cy - 0.012, w: 0.1, h: 0.024 } };
}

const darkSlots = (gap: number): MayhemCardSlot[] => [
  { x: 0.33, body: 9, rim: 0, gap, bodyR: 40, bodyG: 42, bodyB: 41 },
  { x: 0.5, body: 9, rim: 0, gap, bodyR: 33, bodyG: 35, bodyB: 35 },
  { x: 0.67, body: 9, rim: 0, gap, bodyR: 46, bodyG: 47, bodyB: 47 },
];

function run(
  lines: MayhemFrameLine[],
  slots: MayhemCardSlot[] | undefined,
  mode: MayhemFrameMatchMode = 'mayhem',
  cardsVisible = true
) {
  return classifyMayhemFrame({
    lines, augments, mode, state: createMayhemPipelineState(), now: 1000, cardsVisible, cardSlots: slots,
  });
}

const unknownRow = [line('Zorbletron Prime', 0.33), line('Quixel Vortex', 0.5), line('Mumblecrest Ward', 0.67)];
for (const l of unknownRow) {
  ok(!augments.some((a) => a.name.toLowerCase() === l.text.toLowerCase()), `fixture title "${l.text}" is not in the bundle`);
}

// (a) three unknown + dark neutral bodies, clean gaps => accept, display-only.
const a = run(unknownRow, darkSlots(0));
ok(a.decision === 'accept', `three unknown + dark bodies + clean gaps accepts (${a.decision} ${a.reasons})`);
ok(a.knownIds.length === 0 && a.placeholderIds.length === 3, 'all-unknown accept is placeholder-only (no trusted ids)');

// (a2) one known + two unknown + dark bodies => accept; only the known id is trusted.
const known = augments.find((x) => x.name.length >= 6)!;
const mixed = run([line('Zorbletron Prime', 0.33), line(known.name, 0.5), line('Mumblecrest Ward', 0.67)], darkSlots(0));
ok(mixed.decision === 'accept', `1 known + 2 unknown + dark bodies accepts (${mixed.decision} ${mixed.reasons})`);
ok(mixed.knownIds.length === 1 && mixed.knownIds[0] === known.id, 'only the known id is trusted');
ok(mixed.placeholderIds.length === 2 && mixed.ids.length === 3, 'two placeholders shown in row order');
ok(mixed.ids[1] === known.id, 'known id keeps its column position');
const mixedNoPixels = run([line('Zorbletron Prime', 0.33), line(known.name, 0.5), line('Mumblecrest Ward', 0.67)], undefined, 'mayhem', false);
ok(mixedNoPixels.decision === 'unverified', '1 known + 2 unknown without pixels stays unverified');

// (b) uniform band: gap > 0 => unverified.
const b = run(unknownRow, darkSlots(3));
ok(b.decision === 'unverified' && b.ids.length === 0, `uniform band (gap>0) stays unverified (${b.decision})`);
const bMixed = run([line('Zorbletron Prime', 0.33), line(known.name, 0.5), line('Mumblecrest Ward', 0.67)], darkSlots(3));
ok(bMixed.decision === 'unverified' && bMixed.ids.length === 0, 'mixed row on a uniform band stays unverified');

// (c) ranked SR / classic / no geometry => unverified.
const c1 = run(unknownRow, darkSlots(0), 'classic');
ok(c1.decision === 'unverified' && c1.ids.length === 0, 'classic/ranked mode never accepts unknown rows');
const c1b = run([line('Zorbletron Prime', 0.33), line(known.name, 0.5), line('Mumblecrest Ward', 0.67)], darkSlots(0), 'classic');
ok(c1b.decision === 'unverified' && c1b.ids.length === 0, 'classic/ranked mode never accepts a mixed unknown row');
const c2 = run([line('Zorbletron Prime', 0.33, 0.8), line('Quixel Vortex', 0.5, 0.8), line('Mumblecrest Ward', 0.67, 0.8)], darkSlots(0));
ok(c2.decision === 'unverified' && c2.cardCount === 0, 'no card geometry (SR scoreboard rows) stays unverified');
const c3 = run([], darkSlots(0));
ok(c3.decision === 'unverified' && c3.reasons.includes('no-card-geometry'), 'empty frame stays unverified');

// PowerShell predicate against the logged values.
const ps1 = fs.readFileSync(path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1'), 'utf8');
const fn = ps1.match(/function Test-CardBody \{[\s\S]*?\n\}/);
ok(!!fn, 'Test-CardBody found in mayhem-ocr.ps1');
if (fn) {
  const cases: Array<[number, number, number, boolean]> = [
    [40, 42, 41, true], [33, 35, 35, true], [46, 47, 47, true], // logged dark bodies
    [29, 50, 59, false], [56, 67, 69, false], [24, 61, 68, false], [113, 119, 120, false], // logged gaps
    [5, 20, 22, true], // teal still accepted
    [190, 160, 90, true], // gold still accepted
    [8, 12, 16, false], [200, 200, 200, false],
  ];
  const script = `${fn[0]}\n${cases.map(([r, g, bb]) => `[string](Test-CardBody -R ${r} -G ${g} -B ${bb})`).join('\n')}`;
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  } catch (err) {
    ok(false, `powershell ran (${(err as Error).message})`);
  }
  const results = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  cases.forEach(([r, g, bb, want], i) => {
    ok((results[i] === 'True') === want, `Test-CardBody ${r},${g},${bb} => ${want} (got ${results[i]})`);
  });
}

// Real pixel gate: build bitmaps in PowerShell and run the shipped
// Get-CardSlotEvidence, so the mean-based dark-card rule is proven on pixels
// that no single per-pixel window accepts.
if (fn) {
  const consts = ps1.match(/\$CARD_BODY_MIN = \d+[\s\S]*?\$CARD_GAP_OFFSET = [\d.]+/)![0];
  const meanFn = ps1.match(/function Test-CardMean \{[\s\S]*?\n\}/)![0];
  const slotFn = ps1.match(/function Get-CardSlotEvidence \{[\s\S]*?\n\}/)![0];
  const harness = `
Add-Type -AssemblyName System.Drawing
${consts}
${fn[0]}
${meanFn}
${slotFn}
function New-Canvas([int]$w, [int]$h, [int]$r, [int]$g, [int]$b) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.Clear([System.Drawing.Color]::FromArgb($r, $g, $b))
  $gfx.Dispose()
  return $bmp
}
# Card art that no single pixel window accepts: alternating 20,22,24 and 80,82,84
# stripes, mean ~50,52,54 (neutral). Background is the logged bluish HUD.
function Add-Card([System.Drawing.Bitmap]$bmp, [double]$cx) {
  $w = $bmp.Width; $h = $bmp.Height
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $a = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 22, 24))
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 82, 84))
  # Half-width 0.070 against 0.17 spacing keeps a real inter-card gap, which is
  # where the gap patch must stay non-card-like.
  $x0 = [int]($w * ($cx - 0.07)); $x1 = [int]($w * ($cx + 0.07))
  $y0 = [int]($h * 0.30); $y1 = [int]($h * 0.80)
  for ($x = $x0; $x -le $x1; $x++) {
    $brush = if (($x % 2) -eq 0) { $a } else { $b }
    $gfx.FillRectangle($brush, $x, $y0, 1, $y1 - $y0)
  }
  $a.Dispose(); $b.Dispose(); $gfx.Dispose()
}
$cards = New-Canvas 840 620 29 50 59
foreach ($cx in @(0.33, 0.5, 0.67)) { Add-Card -bmp $cards -cx $cx }
foreach ($cx in @(0.33, 0.5, 0.67)) {
  $s = Get-CardSlotEvidence -Bitmap $cards -CenterX $cx
  "cards $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim)"
}
$cards.Dispose()
# Uniform dark-neutral band: body-like everywhere, including the gap patches.
$band = New-Canvas 840 620 50 52 54
foreach ($cx in @(0.33, 0.5, 0.67)) {
  $s = Get-CardSlotEvidence -Bitmap $band -CenterX $cx
  "band $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim)"
}
$band.Dispose()
`;
  const harnessPath = path.join(root, 'test-fixtures', 'mayhem-ocr', '.dark-cards-harness.ps1');
  fs.writeFileSync(harnessPath, harness);
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', harnessPath], { encoding: 'utf8' });
  } catch (err) {
    ok(false, `pixel harness ran (${(err as Error).message})`);
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }
  const rows = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const num = (line: string, key: string) => Number(new RegExp(`${key}=(-?\\d+)`).exec(line)?.[1]);
  for (const row of rows.filter((r) => r.startsWith('cards'))) {
    ok(num(row, 'body') >= 8 && num(row, 'gap') === 0, `real pixels: ${row} (body>=8, gap=0)`);
  }
  for (const row of rows.filter((r) => r.startsWith('band'))) {
    ok(num(row, 'gap') > 0, `real pixels: ${row} (uniform band gap>0)`);
  }
  ok(rows.length === 6, `pixel harness emitted 6 slot rows (got ${rows.length})`);
}

if (!process.exitCode) console.log('verify:mayhem-dark-cards ok');
