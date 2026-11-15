# Package a labelled test build and publish it as a GitHub pre-release.
# One command, no AI session needed:
#   powershell -ExecutionPolicy Bypass -File scripts/package-test-build.ps1
# Optional: -Label native-overlay -Tag test-native-overlay-20261111 -Backend native
#
# Mirrors the manual test-build procedure: full build + keyhook + presenter,
# a scratch electron-builder config derived from package.json (zip only, no
# ffmpeg — auto-clipping is unavailable in test builds), testBuildLabel and
# overlayBackend stamped into the packaged package.json so the app
# identifies itself and selects the overlay backend, then gh release.
param(
    [string]$Label = 'native-overlay',
    [string]$Tag = 'test-native-overlay-20261111',
    [string]$Backend = 'native',
    [string]$Version = '',
    [string]$NotesFile = '',
    [switch]$NoPublish
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Step([string]$Name, [scriptblock]$Run) {
    Write-Host "== $Name"
    & $Run
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Step 'app build (tsc + vite)' { npm run build }
Step 'electron build' { npm run electron:build }
Step 'keyhook build' { npm run build:keyhook }
Step 'presenter build' { npm run build:presenter }

# Scratch builder config: package.json's build, zip only, minus ffmpeg, with
# the test-build label and overlay backend merged into the packaged
# package.json via extraMetadata (the same mechanism as the earlier test
# builds — the source file is untouched).
try {
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));const b={...p.build};b.win={...b.win,target:['zip']};b.extraResources=(b.extraResources||[]).filter(r=>!(r.from||'').includes('ffmpeg'));b.extraMetadata={testBuildLabel:'$Label',overlayBackend:'$Backend'};if('$Version')b.extraMetadata.version='$Version';fs.writeFileSync('build-scratch.json',JSON.stringify(b,null,2))"
    if ($LASTEXITCODE -ne 0) { throw 'scratch config failed' }

    Step 'electron-builder (zip, no ffmpeg)' { npx electron-builder --config build-scratch.json --win zip }
} finally {
    Remove-Item 'build-scratch.json' -ErrorAction SilentlyContinue
}

$version = if ($Version) { $Version } else { (Get-Content 'package.json' -Raw | ConvertFrom-Json).version }
$zip = "release/One.Trick.$version.zip"
if (-not (Test-Path $zip)) { throw "expected artifact missing: $zip" }

$notes = @"
Test build: native overlay remake. The HUD is rendered offscreen by Chromium and presented by onetrick-presenter.exe, a plain Win32 layered window — Chromium no longer owns an on-screen window, so the DWM/MPO presentation path is out of the picture. Locked mode uses the native presenter; unlocked/align still use the Electron window.

Status: implemented and gate-verified off-device (full verify suite, lint, typechecks). NOT yet verified in a real match — that is what this build is for.

Acceptance: kill every OneTrick.exe first, run this build (title must read "One Trick · TEST BUILD $Label"), play one full match.
Pass = overlay visible at match end, and %APPDATA%\One Trick\logs\presenter.log shows exactly ONE 'created' line between match-start and match-end, with no 'destroy' line in between and frames flowing.
Auto-clipping unavailable in this build (no ffmpeg). Recorder unchanged, not included.
"@

if ($NotesFile -and (Test-Path $NotesFile)) { $notes = Get-Content $NotesFile -Raw }
if ($NoPublish) { Write-Host "Built $zip (not published)"; return }
Step 'publish pre-release' { gh release create $Tag --prerelease --title "Test build $Tag" --notes $notes $zip }
Write-Host "Done: pre-release $Tag published with $zip"
