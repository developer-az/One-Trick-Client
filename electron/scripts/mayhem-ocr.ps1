param(
  [Parameter(Mandatory = $false)]
  [string]$ImagePath = '',
  [switch]$CaptureScreen,
  [switch]$UseGameWindow,
  [double]$LeftFrac = 0.08,
  [double]$TopFrac = 0.18,
  [double]$WidthFrac = 0.84,
  [double]$HeightFrac = 0.62,
  # The Electron main process that hosts the overlay. Ownership of the
  # foreground window is one half of the capture-trust decision: a game window
  # that is behind a browser must not be trusted just because it exists.
  [int]$OwnerPid = 0,
  # The overlay root's --overlay-scale (0.75 + hudScale/200). The mayhem panel
  # footprint is 380x220 CSS px multiplied by this, anchored to the right rail.
  [double]$PanelScale = 0.85
)

$ErrorActionPreference = 'Stop'

function Write-Marker {
  param([string]$Name, [string]$Detail = '')
  if ($Detail) {
    Write-Output "__OT_${Name} ${Detail}__"
  } else {
    Write-Output "__OT_${Name}__"
  }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class OTMayhemWin32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public struct POINT { public int X; public int Y; }
}
"@

# Match Electron's physical-pixel coordinates: window rects, CopyFromScreen and
# the mask rects all come from the same DPI-aware space.
try { [void][OTMayhemWin32]::SetProcessDPIAware() } catch { }

function Get-ClientScreenRect {
  param([IntPtr]$Handle)
  $client = New-Object OTMayhemWin32+RECT
  if (-not [OTMayhemWin32]::GetClientRect($Handle, [ref]$client)) { return $null }
  $topLeft = New-Object OTMayhemWin32+POINT
  $bottomRight = New-Object OTMayhemWin32+POINT
  $bottomRight.X = $client.Right
  $bottomRight.Y = $client.Bottom
  if (-not [OTMayhemWin32]::ClientToScreen($Handle, [ref]$topLeft)) { return $null }
  if (-not [OTMayhemWin32]::ClientToScreen($Handle, [ref]$bottomRight)) { return $null }
  $w = $bottomRight.X - $topLeft.X
  $h = $bottomRight.Y - $topLeft.Y
  if ($w -lt 200 -or $h -lt 200) { return $null }
  return [pscustomobject]@{
    Left = $topLeft.X
    Top = $topLeft.Y
    Width = $w
    Height = $h
  }
}

function Find-GameWindow {
  $script:found = $null
  $callback = [OTMayhemWin32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [OTMayhemWin32]::IsWindowVisible($hWnd)) { return $true }
    $sb = New-Object System.Text.StringBuilder 256
    [void][OTMayhemWin32]::GetClassName($hWnd, $sb, 256)
    $className = $sb.ToString()
    $processId = [uint32]0
    [void][OTMayhemWin32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    if ($processId -eq 0) { return $true }
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $proc) { return $true }
    # The game itself draws in RiotWindowClass and its executable process is
    # "League of Legends"; some builds report the name with .exe. Accept either
    # signal, but never the launcher/client (LeagueClientUx).
    $isRiotClass = $className -eq 'RiotWindowClass'
    $isGameProcess = $proc.ProcessName -match '^League of Legends(\.exe)?$'
    if (-not ($isRiotClass -or $isGameProcess)) { return $true }
    if ($proc.ProcessName -match 'Client|Launcher|UX') { return $true }
    $rect = Get-ClientScreenRect -Handle $hWnd
    if (-not $rect) { return $true }
    $area = $rect.Width * $rect.Height
    if (-not $script:found -or $area -gt $script:found.Area) {
      $script:found = [pscustomobject]@{
        Handle = $hWnd
        ProcessId = [int]$processId
        Exe = $proc.ProcessName
        Class = $className
        Area = $area
        Left = $rect.Left
        Top = $rect.Top
        Width = $rect.Width
        Height = $rect.Height
      }
    }
    return $true
  }
  [void][OTMayhemWin32]::EnumWindows($callback, [IntPtr]::Zero)
  return $script:found
}

# Is the captured game window genuinely on top? Two cases are trusted: the game
# itself owns the foreground, or our own overlay does (it can steal focus while
# the game is still the window underneath). Anything else — a browser sitting
# inside the game rect, for example — means the captured pixels are not the
# game's augment screen, so the frame must not count a pick.
function Test-OwnerForeground {
  param([IntPtr]$GameHandle)
  $foreground = [OTMayhemWin32]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return $false }
  if ($foreground -eq $GameHandle) { return $true }
  if ($OwnerPid -le 0) { return $false }
  $foregroundPid = [uint32]0
  [void][OTMayhemWin32]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  return ([int]$foregroundPid -eq $OwnerPid)
}

function Set-MaskRectangles {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [int]$CaptureLeft,
    [int]$CaptureTop,
    [string]$Spec
  )
  if (-not $Spec) { return }
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
  $g = [System.Drawing.Graphics]::FromImage($Bitmap)
  try {
    foreach ($part in $Spec.Split(';')) {
      $numbers = $part.Split(',')
      if ($numbers.Count -ne 4) { continue }
      $mx = 0; $my = 0; $mw = 0; $mh = 0
      if (-not [int]::TryParse($numbers[0], [ref]$mx)) { continue }
      if (-not [int]::TryParse($numbers[1], [ref]$my)) { continue }
      if (-not [int]::TryParse($numbers[2], [ref]$mw)) { continue }
      if (-not [int]::TryParse($numbers[3], [ref]$mh)) { continue }
      $localX = $mx - $CaptureLeft
      $localY = $my - $CaptureTop
      $left = [Math]::Max(0, $localX)
      $top = [Math]::Max(0, $localY)
      $right = [Math]::Min($Bitmap.Width, $localX + $mw)
      $bottom = [Math]::Min($Bitmap.Height, $localY + $mh)
      if ($right -le $left -or $bottom -le $top) { continue }
      $g.FillRectangle($brush, $left, $top, ($right - $left), ($bottom - $top))
    }
  } finally {
    $g.Dispose()
    $brush.Dispose()
  }
}

function Test-BlackFrame {
  param([System.Drawing.Bitmap]$Bitmap)
  $stepX = [Math]::Max(1, [int]($Bitmap.Width / 48))
  $stepY = [Math]::Max(1, [int]($Bitmap.Height / 48))
  $samples = 0
  $dark = 0
  for ($y = 0; $y -lt $Bitmap.Height; $y += $stepY) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $stepX) {
      $c = $Bitmap.GetPixel($x, $y)
      $samples += 1
      $luma = [int](0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B)
      if ($luma -lt 12) { $dark += 1 }
    }
  }
  if ($samples -eq 0) { return $false }
  return ($dark / $samples) -ge 0.98
}

# A crop rect given in screen coordinates, translated into the local pixels of
# the bitmap captured at $CaptureLeft/$CaptureTop and clipped to that bitmap.
# The crop arguments name the area to keep; the capture origin is where the
# bitmap starts, so the local offset is the difference, never the raw value.
# Pure: no bitmap is touched, so the verifier runs this straight from the AST.
# verify_ocr_geometry_actual.ts exercises it with positive and negative origins.
function ConvertTo-CropRect {
  param(
    [int]$CropLeft,
    [int]$CropTop,
    [int]$CropWidth,
    [int]$CropHeight,
    [int]$CaptureLeft,
    [int]$CaptureTop,
    [int]$BitmapWidth,
    [int]$BitmapHeight
  )
  $cx = [Math]::Max(0, $CropLeft - $CaptureLeft)
  $cy = [Math]::Max(0, $CropTop - $CaptureTop)
  $cw = [Math]::Min($CropWidth, $BitmapWidth - $cx)
  $ch = [Math]::Min($CropHeight, $BitmapHeight - $cy)
  return [pscustomobject]@{
    X = $cx
    Y = $cy
    Width = $cw
    Height = $ch
  }
}

function Capture-Region {
  param(
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [string]$OutPath,
    # The full game-window (or primary-screen) frame the overlay panel is
    # anchored to, in the same screen coordinates as $Left/$Top. The captured
    # bitmap is often only the offer band, so the panel mask is computed in this
    # frame and then translated into the bitmap. Omitted: the capture rect is
    # the frame (the primary-screen fallback captures the whole display).
    [int]$FrameLeft = 0,
    [int]$FrameTop = 0,
    [int]$FrameWidth = 0,
    [int]$FrameHeight = 0,
    # Optional post-mask crop, in the SAME screen coordinates as $Left/$Top.
    [int]$CropLeft = -1,
    [int]$CropTop = -1,
    [int]$CropWidth = 0,
    [int]$CropHeight = 0
  )
  Add-Type -AssemblyName System.Drawing
  $rw = [Math]::Max(64, $Width)
  $rh = [Math]::Max(64, $Height)
  $bmp = New-Object System.Drawing.Bitmap $rw, $rh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($Left, $Top, 0, 0, (New-Object System.Drawing.Size $rw, $rh))
  $g.Dispose()
  # Mask our own mayhem panel before OCR. The rect is computed from the frame
  # and translated into this bitmap's pixels, so a game window on another
  # monitor can never be masked using the cursor display's geometry.
  if ($FrameWidth -gt 0 -and $FrameHeight -gt 0) {
    $fx = $FrameLeft; $fy = $FrameTop; $fw = $FrameWidth; $fh = $FrameHeight
  } else {
    $fx = $Left; $fy = $Top; $fw = $rw; $fh = $rh
  }
  $panel = Get-PanelMaskRect -FrameLeft $fx -FrameTop $fy -FrameWidth $fw -FrameHeight $fh
  $panelSpec = "$($panel.X),$($panel.Y),$($panel.Width),$($panel.Height)"
  Set-MaskRectangles -Bitmap $bmp -CaptureLeft $Left -CaptureTop $Top -Spec $panelSpec
  $black = Test-BlackFrame -Bitmap $bmp
  $out = $bmp
  if ($CropWidth -gt 0 -and $CropHeight -gt 0) {
    # Crop AFTER capturing and masking the whole frame: the mask rects already
    # live in $Left/$Top screen space, then the offer band is cut out.
    $crop = ConvertTo-CropRect -CropLeft $CropLeft -CropTop $CropTop `
      -CropWidth $CropWidth -CropHeight $CropHeight `
      -CaptureLeft $Left -CaptureTop $Top `
      -BitmapWidth $bmp.Width -BitmapHeight $bmp.Height
    if ($crop.Width -gt 0 -and $crop.Height -gt 0) {
      $rect = New-Object System.Drawing.Rectangle $crop.X, $crop.Y, $crop.Width, $crop.Height
      $out = $bmp.Clone($rect, $bmp.PixelFormat)
    }
  }
  $out.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  if (-not [object]::ReferenceEquals($out, $bmp)) { $out.Dispose() }
  $bmp.Dispose()
  return $black
}

# Every fractional pixel value is truncated toward zero, never rounded to
# nearest. PowerShell's [int] cast rounds (1920 * 0.84 = 1612.8 -> 1613, and
# 1920 * 0.08 = 153.6 -> 154), while the verified mirror
# src/logic/mayhem/captureRegion.ts truncates, so a cast shifted the production
# crop a pixel off the geometry the app and its tests reason about.
# verify_ocr_geometry_actual.ts runs this function straight out of this file.
function ConvertTo-TruncatedPixels {
  param([double]$Value)
  return [int][Math]::Truncate($Value)
}

# The overlay's mayhem panel footprint, measured against the game window (or
# primary screen) the overlay is anchored to: 380x220 CSS px scaled by
# --overlay-scale (0.75 + hudScale/200), right rail at 0.982 W, top at 0.26 H.
# The caller captures a sub-rect (the offer band), so Set-MaskRectangles
# translates this screen-space rect into the bitmap. Computing it here, from
# the frame this script already found, keeps the mask on the same monitor and
# window as the pixels — a DIP display rect chosen in Electron for the cursor's
# monitor could point at a different screen entirely.
# verify_mayhem_capture_gating.ts pins the constants and the call site.
function Get-PanelMaskRect {
  param(
    [int]$FrameLeft,
    [int]$FrameTop,
    [int]$FrameWidth,
    [int]$FrameHeight
  )
  $width = [Math]::Max(1, (ConvertTo-TruncatedPixels (380.0 * $PanelScale)))
  $height = [Math]::Max(1, (ConvertTo-TruncatedPixels (220.0 * $PanelScale)))
  $right = $FrameLeft + (ConvertTo-TruncatedPixels ($FrameWidth * 0.982))
  $top = $FrameTop + (ConvertTo-TruncatedPixels ($FrameHeight * 0.26))
  return [pscustomobject]@{
    X = $right - $width
    Y = $top
    Width = $width
    Height = $height
  }
}

# The offer band of a bounds rect. The game-window capture, the primary-screen
# fallback and the reported frame size all go through here: one policy, so they
# cannot disagree about where the band is.
function Get-OfferGeometry {
  param(
    [int]$BoundsX,
    [int]$BoundsY,
    [int]$BoundsWidth,
    [int]$BoundsHeight
  )
  $width = [Math]::Max(64, (ConvertTo-TruncatedPixels ($BoundsWidth * $WidthFrac)))
  $height = [Math]::Max(64, (ConvertTo-TruncatedPixels ($BoundsHeight * $HeightFrac)))
  $left = $BoundsX + (ConvertTo-TruncatedPixels ($BoundsWidth * $LeftFrac))
  $top = $BoundsY + (ConvertTo-TruncatedPixels ($BoundsHeight * $TopFrac))
  return [pscustomobject]@{
    Left = $left
    Top = $top
    Width = $width
    Height = $height
  }
}

function Capture-FractionRegion {
  param(
    [int]$BoundsLeft,
    [int]$BoundsTop,
    [int]$BoundsWidth,
    [int]$BoundsHeight,
    [string]$OutPath
  )
  $geo = Get-OfferGeometry -BoundsX $BoundsLeft -BoundsY $BoundsTop -BoundsWidth $BoundsWidth -BoundsHeight $BoundsHeight
  return (Capture-Region -Left $geo.Left -Top $geo.Top -Width $geo.Width -Height $geo.Height -OutPath $OutPath `
    -FrameLeft $BoundsLeft -FrameTop $BoundsTop -FrameWidth $BoundsWidth -FrameHeight $BoundsHeight)
}

function Capture-PrimaryScreen {
  param([string]$OutPath)
  Add-Type -AssemblyName System.Windows.Forms
  # Fallback (no game window matched): capture the PRIMARY screen's complete
  # bounds — never the monitor under the cursor — and mask in that space. Then
  # cut the same offer-band crop a matched game window would use, relative to
  # the primary bounds: with no window to measure, the game is assumed to fill
  # the primary screen, so the offers are centred there.
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $geo = Get-OfferGeometry -BoundsX $b.X -BoundsY $b.Y -BoundsWidth $b.Width -BoundsHeight $b.Height
  $rw = $geo.Width
  $rh = $geo.Height
  $rx = $geo.Left
  $ry = $geo.Top
  return (Capture-Region -Left $b.X -Top $b.Y -Width $b.Width -Height $b.Height -OutPath $OutPath `
    -CropLeft $rx -CropTop $ry -CropWidth $rw -CropHeight $rh)
}

$blackFrame = $false
$isFallback = $false
$target = $null
# OCR boxes are normalized to the captured bitmap. Capture mode OCRs the offer
# band crop, so carry that crop as fractions of the full frame; -ImagePath OCRs
# the whole file and keeps the identity rect.
$ocrFrame = @(0.0, 0.0, 1.0, 1.0)

if ($CaptureScreen) {
  $ocrFrame = @($LeftFrac, $TopFrac, $WidthFrac, $HeightFrac)
  if (-not $ImagePath) {
    $ImagePath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'onetrick-mayhem-cap.png')
  }
  $captured = $false
  if ($UseGameWindow) {
    $target = Find-GameWindow
    if ($target) {
      $blackFrame = Capture-FractionRegion -BoundsLeft $target.Left -BoundsTop $target.Top `
        -BoundsWidth $target.Width -BoundsHeight $target.Height -OutPath $ImagePath
      $captured = $true
    } else {
      # No game window matched: capture the primary screen's full bounds (as the
      # early builds did), then cut the offer band from it, and mark the frame as
      # a fallback, never as no-target.
      $isFallback = $true
      Write-Marker 'FALLBACK'
    }
  }
  if (-not $captured) {
    $blackFrame = Capture-PrimaryScreen -OutPath $ImagePath
  }
  if ($target) {
    $foreground = ([OTMayhemWin32]::GetForegroundWindow() -eq $target.Handle)
    $owner = Test-OwnerForeground -GameHandle $target.Handle
    $frame = Get-OfferGeometry -BoundsX $target.Left -BoundsY $target.Top -BoundsWidth $target.Width -BoundsHeight $target.Height
    $frameWidth = $frame.Width
    $frameHeight = $frame.Height
    # JSON, not key=value pairs: the game process name is "League of Legends"
    # (it contains spaces) and the old space-separated marker truncated it.
    $targetInfo = [ordered]@{
      pid = [int]$target.ProcessId
      exe = [string]$target.Exe
      class = [string]$target.Class
      rect = "$($target.Left),$($target.Top),$($target.Width),$($target.Height)"
      frame = "${frameWidth}x${frameHeight}"
      black = [bool]$blackFrame
      fg = [bool]$foreground
      owner = [bool]$owner
    }
    Write-Output ("__OT_TARGET__" + ($targetInfo | ConvertTo-Json -Compress))
  }
  if ($blackFrame) { Write-Marker 'BLACK_FRAME' }
  if (-not (Test-Path -LiteralPath $ImagePath)) { exit 3 }
}

if (-not $ImagePath -or -not (Test-Path -LiteralPath $ImagePath)) {
  Write-Error 'ImagePath missing or not found'
  exit 4
}
$ImagePath = (Resolve-Path -LiteralPath $ImagePath).Path

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

function Await-WinRt {
  param($AsyncOp, [Type]$ResultType)
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
    })[0]
  $asTaskGeneric = $asTask.MakeGenericMethod($ResultType)
  $netTask = $asTaskGeneric.Invoke($null, @($AsyncOp))
  return $netTask.GetAwaiter().GetResult()
}

# Prefer English: League's augment cards are English even on other clients, and
# the matcher's fuzzy normalization is tuned to English letter shapes.
$engine = $null
$languageUsed = ''
try {
  $english = New-Object Windows.Globalization.Language 'en-US'
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english)
  if ($engine) { $languageUsed = 'en-US' }
} catch {
  $engine = $null
}
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($engine) { $languageUsed = $engine.RecognizerLanguage.LanguageTag }
}
if (-not $engine) { exit 2 }
if (-not $languageUsed) { $languageUsed = 'profile' }
Write-Output "__OT_OCR_LANG ${languageUsed}__"

$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$ocrLines = @()
foreach ($line in $result.Lines) {
  if ($line.Text) {
    Write-Output $line.Text
    # shortcut: Windows PowerShell 5.1 does not project OcrLine.BoundingRect, so the line box is the union of its word boxes; upgrade when the host exposes it.
    $minX = 0; $minY = 0; $maxR = 0; $maxB = 0; $hasWord = $false
    foreach ($word in $line.Words) {
      $wr = $word.BoundingRect
      $rx = [double]$wr.X; $ry = [double]$wr.Y
      $rr = $rx + [double]$wr.Width; $rb = $ry + [double]$wr.Height
      if (-not $hasWord) {
        $minX = $rx; $minY = $ry; $maxR = $rr; $maxB = $rb; $hasWord = $true
        continue
      }
      if ($rx -lt $minX) { $minX = $rx }
      if ($ry -lt $minY) { $minY = $ry }
      if ($rr -gt $maxR) { $maxR = $rr }
      if ($rb -gt $maxB) { $maxB = $rb }
    }
    $bw = [Math]::Max(1, [double]$bitmap.PixelWidth)
    $bh = [Math]::Max(1, [double]$bitmap.PixelHeight)
    $ocrLines += [ordered]@{
      text = [string]$line.Text
      rect = [ordered]@{
        x = [Math]::Round([Math]::Max(0.0, [Math]::Min(1.0, $minX / $bw)), 4)
        y = [Math]::Round([Math]::Max(0.0, [Math]::Min(1.0, $minY / $bh)), 4)
        w = [Math]::Round([Math]::Max(0.0, [Math]::Min(1.0, ($maxR - $minX) / $bw)), 4)
        h = [Math]::Round([Math]::Max(0.0, [Math]::Min(1.0, ($maxB - $minY) / $bh)), 4)
      }
    }
  }
}
$linesPayload = [ordered]@{
  frame = $ocrFrame
  lines = $ocrLines
}
Write-Output ('__OT_LINES__' + (ConvertTo-Json -InputObject $linesPayload -Compress -Depth 5))
# Windows OCR succeeded but recognized no text. Only a genuine game-window
# capture may claim an empty frame: a black, fallback or failed read is not an
# empty scan the pick counter can trust.
if ($ocrLines.Count -eq 0 -and -not $blackFrame -and -not $isFallback) {
  Write-Marker 'EMPTY_FRAME'
}
