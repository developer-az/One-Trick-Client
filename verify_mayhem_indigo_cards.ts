/**
 * verify:mayhem-indigo-cards — the card-body pixel gate must recognise this
 * patch's dark indigo card art.
 *
 * Real-match regression (26.23, test.31+): the live card body samples as
 * 9,18,38 / 8,15,41 / 2,11,28. That is neither teal (blue too strong) nor
 * neutral (red far below 25), so every slot read body=0, rim=0, the adapter
 * emitted CARDS_VISIBLE 0, and every scan settled "Could not verify" — test.31
 * made that flag load-bearing for the partial-roll and cards-gone paths.
 *
 * Pins:
 *   1. Test-CardIndigo accepts the logged card-body RGBs and rejects the
 *      background/HUD near-misses;
 *   2. an indigo body counts only beside a glowing border (rim), so a uniform
 *      indigo band can never read as three cards;
 *   3. the shipped Get-CardSlotEvidence returns body>=8, gap=0 on synth cards
 *      over this map's indigo background;
 *   4. indigo stays OUT of the gap rule (source), so a card can never cancel
 *      itself out on a map whose background is the same indigo.
 *
 * Run: npx --yes tsx verify_mayhem_indigo_cards.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ps1 = fs.readFileSync(path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1'), 'utf8');

function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`ok ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    process.exitCode = 1;
  }
}

console.log('--- 1. predicates (source) ---');
const indigo = ps1.match(/function Test-CardIndigo \{[\s\S]*?\n\}/)?.[0];
const body = ps1.match(/function Test-CardBody \{[\s\S]*?\n\}/)?.[0];
ok(!!indigo, 'Test-CardIndigo is declared');
ok(!!body, 'Test-CardBody is declared');
// The gap patches must keep the strict windows: indigo in the gap rule would
// read this map's background as card-like and cancel real cards.
const gapBlock = ps1.match(/foreach \(\$side in @\(-1, 1\)\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
ok(gapBlock.includes('Test-CardBody'), 'gap patches still use the strict Test-CardBody window');
ok(!gapBlock.includes('Test-CardIndigo'), 'indigo never reaches the gap rule');
ok(/if \(\$indigoHits -ge 5 -and \$rim -gt 0\)/.test(ps1), 'indigo body requires a glowing border (rim > 0)');
ok(/if \(\$hits.Count -ge 2\) \{ \$cardsVisible = 1 \}/.test(ps1), 'cardsVisible still needs two card-like slots');

if (indigo && body) {
  // RGB, does Test-CardIndigo accept it?
  const cases: Array<[number, number, number, boolean, string]> = [
    [9, 18, 38, true, 'logged card body'],
    [8, 15, 41, true, 'logged card body'],
    [8, 21, 37, true, 'logged card body'],
    [2, 11, 28, true, 'logged card body'],
    [5, 16, 34, true, 'logged card body'],
    [12, 23, 41, true, 'logged card body (bright card)'],
    [92, 65, 48, false, 'warm background between cards'],
    [151, 173, 126, false, 'bright scenery'],
    [16, 29, 46, false, 'indigo background is body-sized but NOT (handled by gap rule)'],
    [29, 50, 59, false, 'bluish HUD fill'],
    [40, 42, 41, false, 'dark neutral stays on the mean rule'],
    [242, 231, 199, false, 'title ink / light text'],
    [0, 0, 9, false, 'pure black'],
    [60, 90, 140, false, 'sky blue, too bright'],
  ];
  // The background sample is still indigo by colour: assert the *gate* handles
  // it through the border requirement rather than the colour window.
  const colourOnly = cases.filter((c) => c[4] !== 'indigo background is body-sized but NOT (handled by gap rule)');
  const script = `${indigo}\n${colourOnly
    .map(([r, g, b]) => `[string](Test-CardIndigo -R ${r} -G ${g} -B ${b})`)
    .join('\n')}`;
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 120_000,
    });
  } catch (err) {
    ok(false, `powershell ran Test-CardIndigo (${(err as Error).message})`);
  }
  const results = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  colourOnly.forEach(([r, g, b, want, label], i) => {
    ok((results[i] === 'True') === want, `Test-CardIndigo(${r},${g},${b}) => ${want} (${label})`);
  });
}

console.log('--- 2. shipped Get-CardSlotEvidence on synth pixels ---');
if (indigo && body) {
  const consts = ps1.match(/\$CARD_BODY_MIN = \d+[\s\S]*?\$CARD_GAP_OFFSET = [\d.]+/)![0];
  const meanFn = ps1.match(/function Test-CardMean \{[\s\S]*?\n\}/)![0];
  const slotFn = ps1.match(/function Get-CardSlotEvidence \{[\s\S]*?\n\}/)![0];
  const harness = `
Add-Type -AssemblyName System.Drawing
${consts}
${indigo}
${body}
${meanFn}
${slotFn}
function New-Canvas([int]$w, [int]$h, [int]$r, [int]$g, [int]$b) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.Clear([System.Drawing.Color]::FromArgb($r, $g, $b))
  $gfx.Dispose()
  return $bmp
}
# 26.23 card: dark indigo body under a warm glowing top border.
function Add-IndigoCard([System.Drawing.Bitmap]$bmp, [double]$cx, [switch]$NoBorder) {
  $w = $bmp.Width; $h = $bmp.Height
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(9, 18, 38))
  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 190, 120))
  $x0 = [int]($w * ($cx - 0.07)); $x1 = [int]($w * ($cx + 0.07))
  $y0 = [int]($h * 0.24); $y1 = [int]($h * 0.80)
  $gfx.FillRectangle($ink, $x0, $y0, $x1 - $x0, $y1 - $y0)
  if (-not $NoBorder) { $gfx.FillRectangle($glow, $x0, $y0, $x1 - $x0, [Math]::Max(3, [int]($h * 0.008))) }
  $ink.Dispose(); $glow.Dispose(); $gfx.Dispose()
}
# Map background: the same indigo as the card, measured between cards.
$cards = New-Canvas 840 620 16 29 46
foreach ($cx in @(0.33, 0.5, 0.67)) { Add-IndigoCard -bmp $cards -cx $cx }
foreach ($cx in @(0.33, 0.5, 0.67)) {
  $s = Get-CardSlotEvidence -Bitmap $cards -CenterX $cx
  "cards $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim)"
}
$cards.Dispose()
# Same indigo everywhere, no border anywhere: colour alone must prove nothing.
$band = New-Canvas 840 620 9 18 38
foreach ($cx in @(0.33, 0.5, 0.67)) {
  $s = Get-CardSlotEvidence -Bitmap $band -CenterX $cx
  "band $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim)"
}
$band.Dispose()
# Indigo plates with the border removed: still nothing.
$flat = New-Canvas 840 620 16 29 46
foreach ($cx in @(0.33, 0.5, 0.67)) { Add-IndigoCard -bmp $flat -cx $cx -NoBorder }
foreach ($cx in @(0.33, 0.5, 0.67)) {
  $s = Get-CardSlotEvidence -Bitmap $flat -CenterX $cx
  "noborder $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim)"
}
$flat.Dispose()
`;
  const harnessPath = path.join(root, 'test-fixtures', 'mayhem-ocr', '.indigo-cards-harness.ps1');
  fs.writeFileSync(harnessPath, harness);
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', harnessPath], {
      encoding: 'utf8',
      timeout: 180_000,
    });
  } catch (err) {
    ok(false, `pixel harness ran (${(err as Error).message})`);
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }
  const rows = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const num = (line: string, key: string) => Number(new RegExp(`${key}=(-?\\d+)`).exec(line)?.[1]);
  for (const row of rows.filter((r) => r.startsWith('cards'))) {
    ok(num(row, 'body') >= 8 && num(row, 'gap') === 0, `real pixels: ${row} (body>=8, gap=0)`);
    ok(num(row, 'rim') >= 7, `real pixels: ${row} (glowing border found)`);
  }
  for (const row of rows.filter((r) => r.startsWith('band') || r.startsWith('noborder'))) {
    ok(num(row, 'body') === 0, `no-border ${row} (colour alone proves no card)`);
  }
  ok(rows.filter((r) => r.startsWith('cards')).length === 3, 'harness measured three indigo card slots');
  ok(rows.length === 9, `harness emitted 9 slot rows (got ${rows.length})`);
}

if (!process.exitCode) console.log('verify:mayhem-indigo-cards ok');
