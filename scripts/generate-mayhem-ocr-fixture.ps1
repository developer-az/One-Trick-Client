# Synthetic Mayhem pick screen — three augment titles for OCR integration tests.
param(
  [ValidateSet('three-offers', 'recursion-trio', 'noisy-ui', 'all')]
  [string]$Scenario = 'all',
  [string]$OutDir = (Join-Path (Join-Path (Join-Path $PSScriptRoot '..') 'test-fixtures') 'mayhem-ocr')
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Write-Fixture {
  param(
    [string]$FileName,
    [string[]]$Names,
    [int]$FontSize = 42,
    [int]$Y = 420
  )
  $out = Join-Path $OutDir $FileName
  Add-Type -AssemblyName System.Drawing
  $w = 1920
  $h = 1080
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(18, 22, 32))
  $font = New-Object System.Drawing.Font('Segoe UI', $FontSize, [System.Drawing.FontStyle]::Bold)
  $brush = [System.Drawing.Brushes]::White
  $step = [Math]::Max(380, [int](($w - 360) / $Names.Count))
  $x0 = 180
  for ($i = 0; $i -lt $Names.Count; $i++) {
    $g.DrawString($Names[$i], $font, $brush, ($x0 + $i * $step), $Y)
  }
  if ($FileName -eq 'noisy-ui.png') {
    $small = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Regular)
    $g.DrawString('Reroll   Silver   Gold   Prismatic   Choose wisely', $small, $brush, 120, 120)
    $g.DrawString('ARAM Mayhem', $small, $brush, 120, 80)
  }
  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output $out
}

$scenarios = @()
if ($Scenario -eq 'all') {
  $scenarios = @('three-offers', 'recursion-trio', 'noisy-ui')
} else {
  $scenarios = @($Scenario)
}

foreach ($s in $scenarios) {
  switch ($s) {
    'three-offers' {
      Write-Fixture 'three-offers.png' @('Jeweled Gauntlet', 'Giant Slayer', 'Apex Inventor')
    }
    'recursion-trio' {
      Write-Fixture 'recursion-trio.png' @('Recursion', 'Shrink Engine', 'Blunt Force')
    }
    'noisy-ui' {
      Write-Fixture 'noisy-ui.png' @('Dashing', 'Back To Basics', 'Eureka') -FontSize 38
    }
  }
}
