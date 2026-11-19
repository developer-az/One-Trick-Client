# Deterministic synthetic Mayhem fixtures: aged card frames + titles drawn from our own bundle.
param(
  [string]$OutDir = (Join-Path (Join-Path $PSScriptRoot '..') 'test-fixtures/mayhem-ocr/labelled')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bundle = Get-Content -LiteralPath (Join-Path $root 'src/data/mayhem/bundle.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-AugmentName {
  param([string]$Id)
  return @($bundle.augments | Where-Object { $_.id -eq $Id })[0].name
}

$champions = @($bundle.combos | ForEach-Object { $_.championId } | Sort-Object -Unique)
function Get-ChampName {
  param([string]$Name)
  if ($champions -notcontains $Name) { throw "champion not in bundle: $Name" }
  return $Name
}

function Draw-Fixture {
  param(
    [string]$FileName,
    [string[]]$Titles,
    [double[]]$Xs,
    [double[]]$Ys,
    [int]$FontSize = 42,
    [double]$Scale = 1.0,
    [int]$OffsetPixels = 0,
    [switch]$NoCards
  )

  $w = [int][Math]::Round(1920 * $Scale)
  $h = [int][Math]::Round(1080 * $Scale)
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $font = $null; $textBrush = $null; $frameBrush = $null; $framePen = $null
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(18, 22, 32))
    $px = [single][Math]::Max(12, [Math]::Round($FontSize * $Scale))
    $font = [System.Drawing.Font]::new('Segoe UI', $px, [System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 240, 228))
    $frameBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(46, 36, 28))
    $framePen = [System.Drawing.Pen]::new(
      [System.Drawing.Color]::FromArgb(176, 141, 87),
      [single][Math]::Max(2, [Math]::Round(3 * $Scale))
    )
    $cxList = @()
    $cyList = @()
    for ($i = 0; $i -lt $Titles.Count; $i++) {
      $cxList += [int][Math]::Round($Xs[$i] * $w) + $OffsetPixels
      $cyList += [int][Math]::Round($Ys[$i] * $h) + $OffsetPixels
    }
    if (-not $NoCards) {
      $cw = [int][Math]::Round(320 * $Scale)
      $ch = [int][Math]::Round(210 * $Scale)
      for ($i = 0; $i -lt $Titles.Count; $i++) {
        $rect = [System.Drawing.Rectangle]::new(
          $cxList[$i] - [int]($cw / 2), $cyList[$i] - [int]($ch / 2), $cw, $ch
        )
        $g.FillRectangle($frameBrush, $rect)
        $g.DrawRectangle($framePen, $rect)
      }
    }
    for ($i = 0; $i -lt $Titles.Count; $i++) {
      $measure = $g.MeasureString($Titles[$i], $font)
      $g.DrawString(
        $Titles[$i], $font, $textBrush,
        [single]($cxList[$i] - $measure.Width / 2), [single]($cyList[$i] - $measure.Height / 2)
      )
    }
  } finally {
    if ($framePen) { $framePen.Dispose() }
    if ($frameBrush) { $frameBrush.Dispose() }
    if ($textBrush) { $textBrush.Dispose() }
    if ($font) { $font.Dispose() }
    $g.Dispose()
  }
  $out = Join-Path $OutDir $FileName
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output $out
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Name-independent pixel-gate fixtures: three unfamiliar titles, no shop text.
# Only the card fill/border colours differ; geometry matches the column layout.
function Draw-HeaderlessFixture {
  param(
    [string]$FileName,
    [System.Drawing.Color]$Body,
    [System.Drawing.Color]$Rim,
    [string[]]$Titles,
    [double[]]$Xs = @(0.33, 0.50, 0.67),
    # A wide, non-card-shaped teal band at the sampled body/rim rows: the old
    # single-point sampler lit every slot on it, but it has no card-sized teal
    # patch, so the region sampler must reject it.
    [switch]$TealBand,
    # Full-width teal covering the ENTIRE body patch: every slot gets 9 body
    # hits, so only the inter-card gap samples can prove these are not cards.
    [switch]$FullWidthTealBand
  )
  $w = 1920
  $h = 1080
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $bodyBrush = $null; $rimPen = $null; $font = $null; $textBrush = $null; $bandBrush = $null
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(18, 22, 32))
    $bodyBrush = [System.Drawing.SolidBrush]::new($Body)
    $rimPen = [System.Drawing.Pen]::new($Rim, [single]10)
    $font = [System.Drawing.Font]::new('Segoe UI', [single]42, [System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 240, 228))
    if ($TealBand -or $FullWidthTealBand) {
      $bandTop = if ($FullWidthTealBand) { 0.40 } else { 0.29 }
      $bandHeight = if ($FullWidthTealBand) { 0.12 } else { 0.185 }
      $bandBrush = [System.Drawing.SolidBrush]::new($Body)
      $g.FillRectangle($bandBrush, [System.Drawing.Rectangle]::new(0, [int][Math]::Round($bandTop * $h), $w, [int][Math]::Round($bandHeight * $h)))
    }
    $cy = [int][Math]::Round(0.40 * $h)
    $cw = 320; $ch = 210
    for ($i = 0; $i -lt $Titles.Count; $i++) {
      $cx = [int][Math]::Round($Xs[$i] * $w)
      if (-not $TealBand -and -not $FullWidthTealBand) {
        $rect = [System.Drawing.Rectangle]::new($cx - [int]($cw / 2), $cy - [int]($ch / 2), $cw, $ch)
        $g.FillRectangle($bodyBrush, $rect)
        $g.DrawRectangle($rimPen, $rect)
      }
      $measure = $g.MeasureString($Titles[$i], $font)
      $g.DrawString(
        $Titles[$i], $font, $textBrush,
        [single]($cx - $measure.Width / 2), [single]($cy - $measure.Height / 2)
      )
    }
  } finally {
    if ($bandBrush) { $bandBrush.Dispose() }
    if ($textBrush) { $textBrush.Dispose() }
    if ($font) { $font.Dispose() }
    if ($rimPen) { $rimPen.Dispose() }
    if ($bodyBrush) { $bodyBrush.Dispose() }
    $g.Dispose()
  }
  $out = Join-Path $OutDir $FileName
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output $out
}

$known3 = @('recursion', 'eureka', 'goliath') | ForEach-Object { Get-AugmentName $_ }
$known4 = @('recursion', 'eureka', 'goliath', 'dashing') | ForEach-Object { Get-AugmentName $_ }
$threeX = @(0.33, 0.50, 0.67)
$fourX = @(0.245, 0.415, 0.585, 0.755)
$rowY = @(0.40, 0.40, 0.40)

Draw-Fixture 'positive-3-en.png' $known3 $threeX $rowY
Draw-Fixture 'positive-4-en.png' $known4 $fourX @(0.40, 0.40, 0.40, 0.40)
Draw-Fixture 'negative-champion-row.png' @(
  (Get-ChampName 'Yasuo'), (Get-ChampName 'Annie'), (Get-ChampName 'Warwick')
) $threeX $rowY
Draw-Fixture 'negative-scoreboard.png' @(
  ((Get-ChampName 'Yasuo') + ' 12/4/8'),
  ((Get-ChampName 'Annie') + ' 9/6/13'),
  ((Get-ChampName 'Warwick') + ' 15/3/7')
) @(0.20, 0.20, 0.20) @(0.36, 0.42, 0.48) -FontSize 34 -NoCards
Draw-Fixture 'negative-one-known-two-junk.png' @(
  $known3[0], (Get-ChampName 'Viego'), (Get-ChampName 'Brand')
) $threeX $rowY
Draw-Fixture 'negative-no-geometry.png' $known3 @(0.12, 0.55, 0.28) @(0.22, 0.63, 0.78) -NoCards
Draw-Fixture 'positive-scaled-150.png' $known3 $threeX $rowY -Scale 1.5
Draw-Fixture 'positive-offset-25.png' $known3 $threeX $rowY -OffsetPixels 25

$unfamiliar = @('Zephyr', 'Cinder', 'Astral')
$unfamiliar4 = @('Zephyr', 'Cinder', 'Astral', 'Nebula')
Draw-HeaderlessFixture 'positive-headerless-teal.png' `
  ([System.Drawing.Color]::FromArgb(8, 22, 26)) `
  ([System.Drawing.Color]::FromArgb(60, 180, 190)) $unfamiliar
Draw-HeaderlessFixture 'negative-headerless-no-teal.png' `
  ([System.Drawing.Color]::FromArgb(40, 30, 45)) `
  ([System.Drawing.Color]::FromArgb(55, 44, 62)) $unfamiliar
Draw-HeaderlessFixture 'positive-4-headerless-teal.png' `
  ([System.Drawing.Color]::FromArgb(8, 22, 26)) `
  ([System.Drawing.Color]::FromArgb(60, 180, 190)) $unfamiliar4 $fourX
Draw-HeaderlessFixture 'negative-aligned-teal.png' `
  ([System.Drawing.Color]::FromArgb(8, 22, 26)) `
  ([System.Drawing.Color]::FromArgb(60, 180, 190)) $unfamiliar $threeX -TealBand
Draw-HeaderlessFixture 'negative-full-width-teal.png' `
  ([System.Drawing.Color]::FromArgb(8, 22, 26)) `
  ([System.Drawing.Color]::FromArgb(60, 180, 190)) $unfamiliar $threeX -FullWidthTealBand
