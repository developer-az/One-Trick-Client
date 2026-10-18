# Shows a fullscreen-ish test "augment shop" then captures center region + OCR (no League required).
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'League of Legends'
$form.WindowState = 'Maximized'
$form.FormBorderStyle = 'None'
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 32)
$form.TopMost = $true
$form.ShowInTaskbar = $true

$names = @('Recursion', 'Shrink Engine', 'Blunt Force')
$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = 'Fill'
$panel.BackColor = $form.BackColor
$form.Controls.Add($panel)

$font = New-Object System.Drawing.Font('Segoe UI', 40, [System.Drawing.FontStyle]::Bold)
$y0 = 280
for ($i = 0; $i -lt $names.Count; $i++) {
  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = $names[$i]
  $lbl.Font = $font
  $lbl.ForeColor = [System.Drawing.Color]::White
  $lbl.AutoSize = $true
  $lbl.Location = New-Object System.Drawing.Point(120, ($y0 + $i * 72))
  $panel.Controls.Add($lbl)
}

$form.Add_Shown({ $form.Activate() })
$null = $form.Show()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 500

$cap = Join-Path $env:TEMP "onetrick-mayhem-live-demo.png"
$bounds = $form.Bounds
$shot = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gShot = [System.Drawing.Graphics]::FromImage($shot)
$gShot.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$gShot.Dispose()
$shot.Save($cap, [System.Drawing.Imaging.ImageFormat]::Png)
$shot.Dispose()

$ocrScript = Join-Path $RepoRoot 'electron\scripts\mayhem-ocr.ps1'
if (-not (Test-Path $ocrScript)) { $ocrScript = Join-Path $RepoRoot 'dist-electron\electron\scripts\mayhem-ocr.ps1' }

$text = & $ocrScript -ImagePath $cap 2>&1 | Out-String
$form.Close()

Write-Output "--- OCR ---"
Write-Output $text
