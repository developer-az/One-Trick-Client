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
