param(
  [Parameter(Mandatory = $false)]
  [string]$ImagePath = '',
  [switch]$CaptureScreen,
  [switch]$UseGameWindow,
  [double]$LeftFrac = 0.08,
  [double]$TopFrac = 0.18,
  [double]$WidthFrac = 0.84,
  [double]$HeightFrac = 0.62
)

$ErrorActionPreference = 'Stop'

function Capture-RectRegion {
  param(
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [string]$OutPath
  )
  Add-Type -AssemblyName System.Drawing
  $rw = [Math]::Max(64, $Width)
  $rh = [Math]::Max(64, $Height)
  $bmp = New-Object System.Drawing.Bitmap $rw, $rh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($Left, $Top, 0, 0, (New-Object System.Drawing.Size $rw, $rh))
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
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
  Capture-RectRegion -Left $rx -Top $ry -Width $rw -Height $rh -OutPath $OutPath
}

function Capture-CenterRegion {
  param([string]$OutPath)
  Add-Type -AssemblyName System.Windows.Forms
  $pt = [System.Windows.Forms.Cursor]::Position
  $scr = [System.Windows.Forms.Screen]::FromPoint($pt)
  if (-not $scr) { $scr = [System.Windows.Forms.Screen]::PrimaryScreen }
  $b = $scr.Bounds
  Capture-FractionRegion -BoundsLeft $b.X -BoundsTop $b.Y -BoundsWidth $b.Width -BoundsHeight $b.Height -OutPath $OutPath
}

function Capture-LeagueClientRegion {
  param([string]$OutPath)
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OTWin32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
  $proc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'League of Legends' } |
    Select-Object -First 1
  if (-not $proc) { return $false }
  $rect = New-Object OTWin32+RECT
  if (-not [OTWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) { return $false }
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  if ($w -lt 200 -or $h -lt 200) { return $false }
  Capture-FractionRegion -BoundsLeft $rect.Left -BoundsTop $rect.Top -BoundsWidth $w -BoundsHeight $h -OutPath $OutPath
  return $true
}

if ($CaptureScreen) {
  if (-not $ImagePath) {
    $ImagePath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "onetrick-mayhem-cap.png")
  }
  $captured = $false
  if ($UseGameWindow) {
    $captured = Capture-LeagueClientRegion -OutPath $ImagePath
  }
  if (-not $captured) {
    Capture-CenterRegion -OutPath $ImagePath
  }
  if (-not (Test-Path -LiteralPath $ImagePath)) { exit 3 }
}

if (-not $ImagePath -or -not (Test-Path -LiteralPath $ImagePath)) {
  Write-Error 'ImagePath missing or not found'
  exit 4
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

function Await-WinRt {
  param($AsyncOp, [Type]$ResultType)
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
    })[0]
  $asTaskGeneric = $asTask.MakeGenericMethod($ResultType)
  $netTask = $asTaskGeneric.Invoke($null, @($AsyncOp))
  return $netTask.GetAwaiter().GetResult()
}

$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { exit 2 }
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) {
  if ($line.Text) { Write-Output $line.Text }
}
