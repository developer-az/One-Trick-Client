# Harder Mayhem OCR fixtures: stylized card text on a busy, colourful screen at
# two client scales, with a fake "League of Legends" window chrome bar at the top.
# Regenerate with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fixtures/mayhem/generate-fixtures.ps1
param(
  [string]$OutDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Write-HardFixture {
  param(
    [string]$FileName,
    [int]$Width,
    [int]$Height,
    [string[]]$Names,
    [string]$Title = 'League of Legends'
  )

  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # Busy backdrop: diagonal gradient + deterministic shapes (no Random object,
  # so every regeneration produces the same bytes).
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height),
    [System.Drawing.Color]::FromArgb(24, 16, 40),
    [System.Drawing.Color]::FromArgb(8, 44, 52),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
  $g.FillRectangle($bg, 0, 0, $Width, $Height)
  $bg.Dispose()

  $shapeColors = @(
    [System.Drawing.Color]::FromArgb(150, 76, 32, 120),
    [System.Drawing.Color]::FromArgb(120, 20, 120, 110),
    [System.Drawing.Color]::FromArgb(110, 180, 120, 40),
    [System.Drawing.Color]::FromArgb(140, 40, 60, 150),
    [System.Drawing.Color]::FromArgb(90, 220, 220, 230)
  )
  $seed = 7
  for ($i = 0; $i -lt 26; $i++) {
    $seed = ($seed * 1103515245 + 12345) -band 0x7fffffff
    $sx = $seed % $Width
    $seed = ($seed * 1103515245 + 12345) -band 0x7fffffff
    $sy = $seed % $Height
    $seed = ($seed * 1103515245 + 12345) -band 0x7fffffff
    $sw = 40 + ($seed % [int]($Width / 5))
    $seed = ($seed * 1103515245 + 12345) -band 0x7fffffff
    $sh = 30 + ($seed % [int]($Height / 4))
    $brush = New-Object System.Drawing.SolidBrush $shapeColors[$i % $shapeColors.Count]
    if ($i % 3 -eq 0) {
      $g.FillEllipse($brush, $sx, $sy, $sw, $sh)
    } else {
      $g.FillRectangle($brush, $sx, $sy, $sw, $sh)
    }
    $brush.Dispose()
  }

  # Fake game window chrome: the title bar an OCR-visible client would show.
  $chrome = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 12, 12, 18))
  $g.FillRectangle($chrome, 0, 0, $Width, [int]($Height * 0.055))
  $chrome.Dispose()
  $titleFont = New-Object System.Drawing.Font('Segoe UI', [int]([Math]::Max(11, $Height * 0.022)), [System.Drawing.FontStyle]::Regular)
  $g.DrawString($Title, $titleFont, [System.Drawing.Brushes]::Gainsboro, [int]($Width * 0.012), [int]($Height * 0.012))
  $titleFont.Dispose()

  # Three augment cards, stylized serif italic, centred in their own panel.
  # Panels are drawn first, titles second, so one overflowing title can never
  # be covered by the next card's panel.
  $cardW = [int]($Width * 0.28)
  $cardH = [int]($Height * 0.3)
  $cardY = [int]($Height * 0.34)
  $gap = [int]($Width * 0.025)
  $total = ($cardW * 3) + ($gap * 2)
  $cardX = [int](($Width - $total) / 2)
  $fontSize = [int]([Math]::Max(16, [double]$Height * 0.046))
  $panel = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(205, 14, 18, 26))
  $borderWidth = [Math]::Max(2, [double]$Height / 360); $border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 120, 200, 190)), $borderWidth
  $outlineWidth = [Math]::Max(2, [double]$Height / 420); $outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 8, 8, 10)), $outlineWidth
  $textBrush = [System.Drawing.Brushes]::White

  for ($i = 0; $i -lt $Names.Count; $i++) {
    $x = $cardX + ($i * ($cardW + $gap))
    $g.FillRectangle($panel, $x, $cardY, $cardW, $cardH)
    $g.DrawRectangle($border, $x, $cardY, $cardW, $cardH)
  }

  for ($i = 0; $i -lt $Names.Count; $i++) {
    $x = $cardX + ($i * ($cardW + $gap))
    $text = $Names[$i]
    # Shrink until the title fits inside its card with breathing room.
    $size = $fontSize
    $measured = $null
    do {
      $candidate = New-Object System.Drawing.Font('Georgia', $size, ([System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic), [System.Drawing.GraphicsUnit]::Pixel)
      $measured = $g.MeasureString($text, $candidate)
      if ($measured.Width -le ($cardW * 0.86) -or $size -le 14) { break }
      $candidate.Dispose()
      $size = [int]($size * 0.9)
    } while ($true)
    $font = $candidate
    $tx = $x + [int](($cardW - $measured.Width) / 2)
    $ty = $cardY + [int](($cardH - $measured.Height) / 2)
    # Outline then fill: stands in for the game's glowing card title.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($text, $font.FontFamily, [int]$font.Style, $font.Size, (New-Object System.Drawing.PointF $tx, $ty), [System.Drawing.StringFormat]::GenericDefault)
    $g.DrawPath($outline, $path)
    $g.FillPath($textBrush, $path)
    $path.Dispose()
    $font.Dispose()
  }

  $panel.Dispose()
  $border.Dispose()
  $outline.Dispose()
  $font.Dispose()
  $g.Dispose()
  $out = Join-Path $OutDir $FileName
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output $out
}

Write-HardFixture 'busy-1280x720.png' 1280 720 @('Jeweled Gauntlet', 'Giant Slayer', 'Apex Inventor')
Write-HardFixture 'busy-2560x1440.png' 2560 1440 @('Recursion', 'Shrink Engine', 'Blunt Force')
Write-HardFixture 'unrelated-ui-1280x720.png' 1280 720 @('Victory', 'Defeat', 'Summoners Rift') 'League of Legends - End of Game'
