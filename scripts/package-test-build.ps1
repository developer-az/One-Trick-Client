# Package a labelled test build and publish it as a GitHub pre-release.
# One command, no AI session needed:
#   powershell -ExecutionPolicy Bypass -File scripts/package-test-build.ps1
# Optional: -Label single-window -Tag test-single-window-20261110
#
# Mirrors the manual test-build procedure: full build + keyhook, a scratch
# electron-builder config derived from package.json (zip only, no ffmpeg —
# auto-clipping is unavailable in test builds), testBuildLabel stamped into
# the packaged package.json so the app identifies itself, then gh release.
param(
    [string]$Label = 'single-window',
    [string]$Tag = 'test-single-window-20261110'
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

# Scratch builder config: package.json's build, zip only, minus ffmpeg, with
# the test-build label merged into the packaged package.json via extraMetadata
# (the same mechanism as the earlier test builds — the source file is untouched).
try {
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));const b={...p.build};b.win={...b.win,target:['zip']};b.extraResources=(b.extraResources||[]).filter(r=>!(r.from||'').includes('ffmpeg'));b.extraMetadata={testBuildLabel:'$Label'};fs.writeFileSync('build-scratch.json',JSON.stringify(b,null,2))"
    if ($LASTEXITCODE -ne 0) { throw 'scratch config failed' }

    Step 'electron-builder (zip, no ffmpeg)' { npx electron-builder --config build-scratch.json --win zip }
} finally {
    Remove-Item 'build-scratch.json' -ErrorAction SilentlyContinue
}

$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$zip = "release/One.Trick.$version.zip"
if (-not (Test-Path $zip)) { throw "expected artifact missing: $zip" }

$notes = @"
Test build: single-window overlay remake (Step 2). The overlay is now ONE window for the whole match — no per-cluster windows, no raise/rebuild/repair machinery, hidden never destroys it.

Status: implemented and gate-verified off-device (full verify suite, lint, typechecks). NOT yet verified in a real match — that is what this build is for.

Acceptance: kill every OneTrick.exe first, run this build (title must read "One Trick - TEST BUILD $Label"), play one full match.
Pass = overlay visible at match end, and %APPDATA%\One Trick\logs\overlay.log shows exactly ONE 'created' line between match-start and match-end, with no 'destroy' line in between.
Auto-clipping unavailable in this build (no ffmpeg). Recorder unchanged, not included.
"@

Step 'publish pre-release' { gh release create $Tag --prerelease --title "Test build $Tag" --notes $notes $zip }
Write-Host "Done: pre-release $Tag published with $zip"
