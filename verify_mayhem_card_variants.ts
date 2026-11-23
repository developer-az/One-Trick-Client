/**
 * verify:mayhem-card-variants — the card-body gate across every card variant a
 * Mayhem screen can show (test.36).
 *
 * The tier is random per selection (Silver / Gold / Prismatic), Command Line's
 * Hacked Reroll mixes tiers in one row, and Headliners decorate the art
 * (HEARTSTEEL band stickers, Debonair gold text). A bright mark on a minority of
 * the 3x3 body patch used to drag the patch mean bright and turn a real card
 * into "no card". The ps1 now trims at most 3 bright samples, only under a
 * glowing border, and never trims the gap samples.
 *
 * Pins:
 *   1. predicate table on the logged RGBs for every rarity;
 *   2. the shipped Get-CardSlotEvidence on synthetic bitmaps: every rarity,
 *      Maestro four-column, a mixed-rarity row, stickered and Debonair bodies,
 *      and the negatives (uniform band, borderless plates, bright cave with no
 *      cards, a majority-bright patch that is not a sticker);
 *   3. source guards.
 *
 * Synthetic only: no real HEARTSTEEL / Debonair / Command Line capture exists
 * yet. See docs/ai/HANDOFF.md test.36.
 *
 * Run: npx --yes tsx verify_mayhem_card_variants.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNewMayhemOfferRoll, stabilizeMayhemOffers } from './src/logic/mayhem/offerStability';
import { createMayhemPickCounterState, observeMayhemPickScan } from './src/logic/mayhem/pickCount';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ps1 = fs.readFileSync(path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1'), 'utf8');
let checks = 0;

function ok(cond: boolean, msg: string): void {
  checks += 1;
  if (cond) console.log(`ok ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    process.exitCode = 1;
  }
}

function runPs(script: string, label: string): string[] {
  const file = path.join(root, 'test-fixtures', 'mayhem-ocr', `.card-variants-${label}.ps1`);
  fs.writeFileSync(file, script);
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file], {
      encoding: 'utf8',
      timeout: 180_000,
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    ok(false, `powershell ran ${label} (${(err as Error).message})`);
    return [];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const fn = (name: string) => ps1.match(new RegExp(`function ${name} \\{[\\s\\S]*?\\n\\}`))?.[0];
const indigo = fn('Test-CardIndigo');
const body = fn('Test-CardBody');
const mean = fn('Test-CardMean');
const slot = fn('Get-CardSlotEvidence');
const consts = ps1.match(/\$CARD_BODY_MIN = \d+[\s\S]*?\$CARD_GAP_OFFSET = [\d.]+/)?.[0];

console.log('--- 3. source guards ---');
ok(!!(indigo && body && mean && slot && consts), 'all probe functions and constants are declared');
const gapBlock = ps1.match(/foreach \(\$side in @\(-1, 1\)\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
ok(gapBlock.includes('Test-CardBody'), 'gap samples keep the strict Test-CardBody window');
ok(!gapBlock.includes('Test-CardIndigo'), 'indigo never reaches the gap rule');
ok(!/trim/i.test(gapBlock), 'gap samples are never sticker-trimmed');
ok(/\$brightCount -le 3/.test(ps1), 'the sticker trim drops at most 3 of 9 samples');
ok(/\$trimNeutral -or \$indigoHits -ge 5 -or \(\$darkHits -ge 5/.test(ps1), 'trimmed reading only counts inside the glowing-border block');
ok(/if \(\$hits.Count -ge 2\) \{ \$cardsVisible = 1 \}/.test(ps1), 'cardsVisible still needs two card-like slots');
// The contrast rule must use the UNTRIMMED mean: a trimmed mean flipped a real
// non-game screenshot (purple web hero) to CARDS_VISIBLE 1 during test.36.
ok(/\$bodyLuma = 0\.2126 \* \(\$sumR \/ \$bodySamples\)/.test(ps1) && !/\$bodyLuma = [^\n]*\$trimR/.test(ps1), 'gap-contrast rule uses the untrimmed body mean');
ok(/0\.20 \+ \$k \* 0\.004/.test(ps1), 'the rim is a scanned band, not a single fixed row');

console.log('--- 1. predicate table ---');
if (indigo && body && mean) {
  // [r, g, b, body-or-indigo-or-mean accepted?, label]
  const cases: Array<[number, number, number, boolean, string]> = [
    [9, 18, 38, true, 'prismatic logged body'],
    [8, 15, 41, true, 'prismatic logged body'],
    [2, 11, 28, true, 'prismatic logged body'],
    [40, 42, 41, true, 'silver logged body'],
    [33, 35, 35, true, 'silver logged body'],
    [46, 47, 47, true, 'silver logged body'],
    [190, 150, 70, true, 'gold window body'],
    [92, 65, 48, false, 'warm background'],
    [29, 50, 59, false, 'bluish HUD fill'],
    [56, 67, 69, false, 'bluish HUD fill'],
    [242, 231, 199, false, 'title ink'],
    [0, 0, 0, false, 'pure black'],
  ];
  const lines = cases.map(
    ([r, g, b]) =>
      `[string]((Test-CardBody -R ${r} -G ${g} -B ${b}) -or (Test-CardIndigo -R ${r} -G ${g} -B ${b}) -or (Test-CardMean -R ${r} -G ${g} -B ${b}))`,
  );
  const res = runPs(`${indigo}\n${body}\n${mean}\n${lines.join('\n')}`, 'predicates');
  cases.forEach(([r, g, b, want, label], i) => ok((res[i] === 'True') === want, `(${r},${g},${b}) => ${want} (${label})`));
}

console.log('--- 2. shipped Get-CardSlotEvidence on synth bitmaps ---');
if (indigo && body && mean && slot && consts) {
  const harness = `
Add-Type -AssemblyName System.Drawing
${consts}
${indigo}
${body}
${mean}
${slot}
function New-Canvas([int]$w, [int]$h, [int]$r, [int]$g, [int]$b) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.Clear([System.Drawing.Color]::FromArgb($r, $g, $b))
  $gfx.Dispose()
  return $bmp
}
function Add-Card($bmp, [double]$cx, [int]$r, [int]$g, [int]$b, [switch]$NoBorder) {
  $w = $bmp.Width; $h = $bmp.Height
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($r, $g, $b))
  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 190, 120))
  $x0 = [int]($w * ($cx - 0.07)); $x1 = [int]($w * ($cx + 0.07))
  $y0 = [int]($h * 0.24); $y1 = [int]($h * 0.80)
  $gfx.FillRectangle($ink, $x0, $y0, $x1 - $x0, $y1 - $y0)
  if (-not $NoBorder) { $gfx.FillRectangle($glow, $x0, $y0, $x1 - $x0, [Math]::Max(3, [int]($h * 0.008))) }
  $ink.Dispose(); $glow.Dispose(); $gfx.Dispose()
}
# A bright mark over part of the body patch (patch: cx +-0.02w, 0.46h +-0.02h).
function Add-Mark($bmp, [double]$fx0, [double]$fx1, [double]$fy0, [double]$fy1, [int]$r, [int]$g, [int]$b) {
  $w = $bmp.Width; $h = $bmp.Height
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($r, $g, $b))
  $gfx.FillRectangle($ink, [int]($w * $fx0), [int]($h * $fy0), [Math]::Max(1, [int]($w * ($fx1 - $fx0))), [Math]::Max(1, [int]($h * ($fy1 - $fy0))))
  $ink.Dispose(); $gfx.Dispose()
}
function Emit($bmp, [string]$tag, [double[]]$cols) {
  foreach ($cx in $cols) {
    $s = Get-CardSlotEvidence -Bitmap $bmp -CenterX $cx
    "$tag $($s.x) body=$($s.body) gap=$($s.gap) rim=$($s.rim) rgb=$($s.bodyR),$($s.bodyG),$($s.bodyB)"
  }
}
$three = @(0.33, 0.5, 0.67)
$fourCols = @(0.245, 0.415, 0.585, 0.755)

$b = New-Canvas 840 620 16 29 46; foreach ($cx in $three) { Add-Card $b $cx 9 18 38 }; Emit $b 'pos-prismatic' $three; $b.Dispose()
$b = New-Canvas 840 620 92 118 104; foreach ($cx in $three) { Add-Card $b $cx 60 62 64 }; Emit $b 'pos-silver' $three; $b.Dispose()
$b = New-Canvas 840 620 92 118 104; foreach ($cx in $three) { Add-Card $b $cx 190 150 70 }; Emit $b 'pos-gold' $three; $b.Dispose()
$b = New-Canvas 840 620 92 118 104; foreach ($cx in $fourCols) { Add-Card $b $cx 30 24 30 }; Emit $b 'pos-maestro' $fourCols; $b.Dispose()

# Command Line Hacked Reroll: gold, prismatic, silver in one row.
$b = New-Canvas 840 620 92 118 104
Add-Card $b 0.33 190 150 70; Add-Card $b 0.5 9 18 38; Add-Card $b 0.67 60 62 64
Emit $b 'pos-mixed' $three; $b.Dispose()

# HEARTSTEEL band sticker: a bright pink mark over 2 of the 9 samples.
$b = New-Canvas 840 620 92 118 104
foreach ($cx in $three) { Add-Card $b $cx 40 42 41; Add-Mark $b ($cx - 0.005) ($cx + 0.03) 0.455 0.465 245 120 200 }
Emit $b 'pos-sticker-silver' $three; $b.Dispose()
$b = New-Canvas 840 620 16 29 46
foreach ($cx in $three) { Add-Card $b $cx 9 18 38; Add-Mark $b ($cx - 0.005) ($cx + 0.03) 0.455 0.465 245 120 200 }
Emit $b 'pos-sticker-prismatic' $three; $b.Dispose()

# The case the trim exists for: silver art on a background of nearly the same
# luma (no gap contrast to lean on), so only the neutral-mean rule can name the
# card, and a sticker used to break that mean. Fails on the pre-test.36 ps1.
$b = New-Canvas 840 620 30 58 50
foreach ($cx in $three) { Add-Card $b $cx 46 47 47; Add-Mark $b ($cx - 0.005) ($cx + 0.03) 0.455 0.465 245 120 200 }
Emit $b 'pos-sticker-lowcontrast' $three; $b.Dispose()

# Debonair gold text across the patch's middle row (3 of 9 samples).
$b = New-Canvas 840 620 92 118 104
foreach ($cx in $three) { Add-Card $b $cx 46 47 47; Add-Mark $b ($cx - 0.03) ($cx + 0.03) 0.455 0.465 230 190 90 }
Emit $b 'pos-debonair-silver' $three; $b.Dispose()
$b = New-Canvas 840 620 92 118 104
foreach ($cx in $fourCols) { Add-Card $b $cx 30 24 30; Add-Mark $b ($cx - 0.03) ($cx + 0.03) 0.455 0.465 230 190 90 }
Emit $b 'pos-debonair-maestro' $fourCols; $b.Dispose()

# Negatives.
$b = New-Canvas 840 620 9 18 38; Emit $b 'neg-band' $three; $b.Dispose()
$b = New-Canvas 840 620 16 29 46; foreach ($cx in $three) { Add-Card $b $cx 9 18 38 -NoBorder }; Emit $b 'neg-noborder' $three; $b.Dispose()
$b = New-Canvas 840 620 151 173 126; Emit $b 'neg-cave' ($three + $fourCols); $b.Dispose()
# Bright marks on a plain indigo band, no card edge anywhere: the trim must not
# invent a card from background plus flecks.
$b = New-Canvas 840 620 9 18 38
foreach ($cx in $three) { Add-Mark $b ($cx - 0.005) ($cx + 0.03) 0.455 0.465 245 120 200 }
Emit $b 'neg-sticker-noborder' $three; $b.Dispose()
# Majority-bright patch (6 of 9) under a border: not a sticker, not trimmed.
$b = New-Canvas 840 620 92 118 104
foreach ($cx in $three) { Add-Card $b $cx 60 62 64; Add-Mark $b ($cx - 0.03) ($cx + 0.03) 0.43 0.465 245 240 235 }
Emit $b 'neg-majority-bright' $three; $b.Dispose()
`;
  const rows = runPs(harness, 'slots');
  const num = (line: string, key: string) => Number(new RegExp(`${key}=(-?\\d+)`).exec(line)?.[1]);
  const count = (prefix: string) => rows.filter((r) => r.startsWith(`${prefix} `)).length;
  for (const row of rows.filter((r) => r.startsWith('pos-'))) {
    ok(num(row, 'body') >= 8 && num(row, 'gap') === 0, `${row} (body>=8, gap=0)`);
  }
  for (const row of rows.filter((r) => /^neg-(band|noborder|cave|sticker-noborder|majority-bright) /.test(r))) {
    // A slot is card-like only with body>=8 AND gap=0 (pipeline alignment).
    ok(num(row, 'body') < 8 || num(row, 'gap') > 0, `${row} (not card-like)`);
  }
  for (const row of rows.filter((r) => r.startsWith('neg-band '))) ok(num(row, 'body') === 0, `${row} (uniform band body=0)`);
  for (const row of rows.filter((r) => r.startsWith('neg-noborder '))) ok(num(row, 'body') === 0, `${row} (borderless body=0)`);
  const expected: Record<string, number> = {
    'pos-prismatic': 3, 'pos-silver': 3, 'pos-gold': 3, 'pos-maestro': 4, 'pos-mixed': 3,
    'pos-sticker-silver': 3, 'pos-sticker-prismatic': 3, 'pos-sticker-lowcontrast': 3, 'pos-debonair-silver': 3, 'pos-debonair-maestro': 4,
    'neg-band': 3, 'neg-noborder': 3, 'neg-cave': 7, 'neg-sticker-noborder': 3, 'neg-majority-bright': 3,
  };
  for (const [k, n] of Object.entries(expected)) ok(count(k) === n, `${k}: ${n} slot rows (got ${count(k)})`);
  // cardsVisible needs >=2 card-like slots: the cave frame must give fewer than 2.
  const caveHits = rows.filter((r) => r.startsWith('neg-cave ') && num(r, 'body') >= 8 && num(r, 'gap') === 0).length;
  ok(caveHits < 2, `bright cave background with no cards is not visible (${caveHits} card-like slots)`);
}

console.log('--- 4. extra selections (K/DA, Superfans, Pentakill): back-to-back rolls ---');
{
  const A = ['recursion', 'shrink_engine', 'blunt_force'];
  const B = ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'];
  const st = { rerollPending: false };
  // Extra selection arrives while roll A is displayed: B replaces A, no merge.
  const shown = stabilizeMayhemOffers(A, B, B.join('\n'), true, st);
  ok(shown.join() === B.join(), `second roll replaces the first (got ${shown.join()})`);
  ok(!shown.some((id) => A.includes(id)), 'no card from the first roll survives (no merge)');
  ok(isNewMayhemOfferRoll(A, B), 'a disjoint follow-up is a new roll');
  // A partial re-read of B must not shrink or pull A back.
  const partial = stabilizeMayhemOffers(B, B.slice(0, 2), B.slice(0, 2).join('\n'), true, st);
  ok(partial.join() === B.join(), 'a partial read of the second roll keeps the full second roll');

  const scan = (s: ReturnType<typeof createMayhemPickCounterState>, offerCount: number) =>
    observeMayhemPickScan(s, { offerCount, isDead: false, foreground: true, blackFrame: false });
  // Roll, pick (empty gap), extra roll, pick: exactly two picks.
  let c = createMayhemPickCounterState();
  c = scan(scan(c, 3), 3);
  c = scan(scan(c, 0), 0);
  ok(c.picksTaken === 1, `first pick counted once (got ${c.picksTaken})`);
  c = scan(scan(c, 3), 3);
  c = scan(scan(c, 0), 0);
  ok(c.picksTaken === 2, `extra selection's pick counted once more (got ${c.picksTaken})`);
  // Extra empties after the pick never double-count.
  c = scan(scan(scan(c, 0), 0), 0);
  ok(c.picksTaken === 2, `trailing empty scans do not double-count (got ${c.picksTaken})`);
  // A roll replaced by another with no empty gap counts no pick: the counter
  // only acts on the cards-gone evidence it sees (test.31 logic, unchanged).
  let d = createMayhemPickCounterState();
  d = scan(scan(d, 3), 3);
  d = scan(scan(d, 3), 3);
  ok(d.picksTaken === 0, `gapless roll swap counts no pick (got ${d.picksTaken})`);
}

if (!process.exitCode) console.log(`verify:mayhem-card-variants ok (${checks} checks)`);
