param(
  [Parameter(Mandatory = $false)]
  [string]$ImagePath = '',
  [switch]$CaptureScreen,
  [switch]$UseGameWindow,
  [double]$LeftFrac = 0.08,
  [double]$TopFrac = 0.18,
  [double]$WidthFrac = 0.84,
  [double]$HeightFrac = 0.62,
  # Screen-space rectangles to black out before OCR: "x,y,w,h;x,y,w,h" (physical pixels).
  [string]$MaskRects = ''
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

function Capture-Region {
  param(
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [string]$OutPath,
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
  Set-MaskRectangles -Bitmap $bmp -CaptureLeft $Left -CaptureTop $Top -Spec $MaskRects
  $black = Test-BlackFrame -Bitmap $bmp
  $out = $bmp
  if ($CropWidth -gt 0 -and $CropHeight -gt 0) {
    # Crop AFTER capturing and masking the whole frame: the mask rects already
    # live in $Left/$Top screen space, then the offer band is cut out.
    $cx = [Math]::Max(0, $CropLeft - $Left)
    $cy = [Math]::Max(0, $CropTop - $Top)
    $cw = [Math]::Min($CropWidth, $bmp.Width - $cx)
    $ch = [Math]::Min($CropHeight, $bmp.Height - $cy)
    if ($cw -gt 0 -and $ch -gt 0) {
      $rect = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
      $out = $bmp.Clone($rect, $bmp.PixelFormat)
    }
  }
  $out.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  if (-not [object]::ReferenceEquals($out, $bmp)) { $out.Dispose() }
  $bmp.Dispose()
  return $black
}

function Capture-FractionRegion {
  param(
    [int]$BoundsLeft,
    [int]$BoundsTop,
    [int]$BoundsWidth,
    [int]$BoundsHeight,
    [string]$OutPath
  )
  $rw = [Math]::Max(64, [int]($BoundsWidth * $WidthFrac))
  $rh = [Math]::Max(64, [int]($BoundsHeight * $HeightFrac))
  $rx = $BoundsLeft + [int]($BoundsWidth * $LeftFrac)
  $ry = $BoundsTop + [int]($BoundsHeight * $TopFrac)
  return (Capture-Region -Left $rx -Top $ry -Width $rw -Height $rh -OutPath $OutPath)
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
  $rw = [Math]::Max(64, [int]($b.Width * $WidthFrac))
  $rh = [Math]::Max(64, [int]($b.Height * $HeightFrac))
  $rx = $b.X + [int]($b.Width * $LeftFrac)
  $ry = $b.Y + [int]($b.Height * $TopFrac)
  return (Capture-Region -Left $b.X -Top $b.Y -Width $b.Width -Height $b.Height -OutPath $OutPath `
    -CropLeft $rx -CropTop $ry -CropWidth $rw -CropHeight $rh)
}

$blackFrame = $false
$target = $null

if ($CaptureScreen) {
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
      # No game window matched: capture the full primary screen (as the early
      # builds did) and mark the frame as a fallback, never as no-target.
      Write-Marker 'FALLBACK'
    }
  }
  if (-not $captured) {
    $blackFrame = Capture-PrimaryScreen -OutPath $ImagePath
  }
  if ($target) {
    $foreground = ([OTMayhemWin32]::GetForegroundWindow() -eq $target.Handle)
    $frameWidth = [Math]::Max(64, [int]($target.Width * $WidthFrac))
    $frameHeight = [Math]::Max(64, [int]($target.Height * $HeightFrac))
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
foreach ($line in $result.Lines) {
  if ($line.Text) { Write-Output $line.Text }
}
