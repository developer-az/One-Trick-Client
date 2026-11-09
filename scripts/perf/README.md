# Performance harness

Two Windows-only tools for Phase 0 baselines. Neither adds a dependency.

- `measure.mjs` samples the app's process tree through PowerShell/WMI: CPU from
  `Win32_PerfFormattedData_PerfProc_Process`, memory from `WorkingSetPrivate`,
  and process parents/command lines from `Win32_Process`.
- `mock-live-client.mjs` (already in this directory) is a deterministic HTTPS
  stand-in for the League Live Client API. It replays a game and records the
  request cadence per endpoint.

## Requirements

- Windows 10/11, PowerShell 5.1+, Node 18+
- `openssl` on `PATH` for the mock's self-signed certificate, unless you pass
  `--cert` / `--key` with your own certificate
- Run commands from the repository root

## Record a real match

`record-live-client.mjs` passively records one real League match through the
Live Client Data API. It only performs read-only GETs to
`https://127.0.0.1:2999/liveclientdata/*`; it never writes to the game or
simulates input. Start it any time, even while still in queue:

```powershell
npm run record:game
# or with a custom cadence / location:
node scripts/perf/record-live-client.mjs --interval 2000 --max-minutes 90 --out-dir recordings
```

It probes `gamestats` every 5 seconds until a game is live, then records the
full `allgamedata` response every `--interval` ms (default 2000), plus
`activeplayerabilities` when the active player's level changes and every 30
seconds. Recording stops after 20 seconds of consecutive failures (game
closed), on `Ctrl+C`, or at `--max-minutes`, and the gzip stream is finalized.

Recordings land in `recordings/<YYYYMMDD-HHMMSS>-<gameMode>-<champion>.jsonl.gz`
under the repository root (`recordings/` is gitignored). Each line is one JSON
snapshot: `{"t","gameTime","data"}` for `allgamedata`, or
`{"t","gameTime","abilities"}` for abilities. Before writing, the active
player's `riotId` / `summonerName` / `riotIdGameName` become `Self`, the other
players become `Player2`..`Player10` in `allPlayers` order of first sight, and
tag lines become `ANON`; these replacements are applied to every string value,
including event `KillerName` / `VictimName` / `Assisters`. Champion names,
items, stats, and events are unchanged.

A successful run prints a `recording ...` status line every 30 seconds and ends
with `SAVED <absolute path> (<N> snapshots, <mm:ss> of game, <KB> KB)`. Check the
result with:

```powershell
zcat recordings/*.jsonl.gz | head -n 2
```

For a dry run against the mock, start the mock and point the recorder at its
port:

```powershell
node scripts/perf/mock-live-client.mjs --port 29991 --duration 20 --out /tmp/m.json
node scripts/perf/record-live-client.mjs --port 29991 --interval 1000 --out-dir /tmp/rec
```

## Build and launch

```powershell
npm run electron:build
npm run build
```

The built app can be launched in either of these ways:

```powershell
# Development launch (non-packaged Electron loads Vite at localhost:5173).
# Terminal 1:
npm run dev
# Terminal 2:
npm run electron

# Or produce a packaged build and run it:
npm run dist
.\release\win-unpacked\OneTrick.exe
```

Use `--name electron` for the source launch (the default) and
`--name OneTrick` for the packaged exe. To pin the exact tree instead, find the
main process and pass its pid:

```powershell
Get-Process electron,OneTrick -ErrorAction SilentlyContinue | Select-Object Id,ProcessName
node scripts/perf/measure.mjs --root-pid 12345 --label idle
```

## Baseline scenarios

Keep the machine on AC power, close other games/capture tools, and use the same
display settings for every run. Record at least 60 seconds per scenario.

### Idle (no mock, no match)

1. Build and launch the app. Leave the dashboard open and the overlay hidden.
2. Do not start the mock or League.
3. Sample:

```powershell
node scripts/perf/measure.mjs --label idle --seconds 60 --interval 1000 --out perf-results/idle.json
```

### In-game (mock Live Client running)

1. Start the mock in its own terminal:

```powershell
node scripts/perf/mock-live-client.mjs --port 2999 --start-time 300 --speed 1 --duration 180 --out perf-results/mock-in-game.json
```

2. Launch the app. It should detect the mock as an in-progress game and show the
   overlay HUD. Wait for the overlay to settle before sampling.
3. Sample the visible-HUD run:

```powershell
node scripts/perf/measure.mjs --label in-game-hud-visible --seconds 60 --interval 1000 --out perf-results/in-game-visible.json
```

4. For the hidden-HUD run, press `Ctrl+Shift+H` to hide the overlay, wait a few
   seconds, then sample with a new label and output file:

```powershell
node scripts/perf/measure.mjs --label in-game-hud-hidden --seconds 60 --interval 1000 --out perf-results/in-game-hidden.json
```

5. Stop the mock with `Ctrl+C` (or let `--duration` finish). It writes its own
   report on exit.

Mock options:

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `2999` | HTTPS port; the app's Live Client base is fixed at `https://127.0.0.1:2999/liveclientdata` |
| `--start-time <s>` | `300` | Game clock (seconds) at mock start |
| `--speed <x>` | `1` | Game-time multiplier |
| `--duration <s>` | `0` | Stop after this many seconds; `0` means run until `Ctrl+C` |
| `--out <file>` | `./perf-mock-report.json` | Per-endpoint cadence report |
| `--cert <file>` / `--key <file>` | generated | Optional TLS certificate/key pair |

The mock prints a summary every 10 seconds and records per-endpoint count and
interval statistics (mean/p50/min/max).

## Reports and measurement semantics

`measure.mjs` writes to `--out` (relative to the current directory, parent
directories created automatically; default `./perf-measure-report.json`) and
also prints the full JSON followed by a one-line summary:

```text
[measure] in-game-hud-visible: total CPU avg 0.18% p95 0.41% | working set avg 412.3 MB max 455.9 MB
```

Report shape:

```json
{
  "label": "in-game-hud-visible",
  "samples": 60,
  "seconds": 59.8,
  "cores": 16,
  "byType": {
    "browser": { "avgCpuPct": 0.03, "p95CpuPct": 0.1, "maxCpuPct": 0.2,
                 "avgWorkingSetMB": 120.1, "maxWorkingSetMB": 130.4, "processCount": 1 },
    "renderer": { "...": "same fields" }
  },
  "total": { "avgCpuPct": 0.18, "p95CpuPct": 0.41,
             "avgWorkingSetMB": 412.3, "maxWorkingSetMB": 455.9 }
}
```

- `samples` is the number of samples attempted; `seconds` is actual elapsed time.
- `cores` is `os.cpus().length`. Each process's `PercentProcessorTime` is divided
  by that count, so `100` means the whole machine (not one core).
- Per-type values sum all processes of that type in each sample; `total` sums the
  whole selected tree.
- `p95` uses nearest-rank over sample-level totals. `processCount` is the maximum
  number of processes seen for that type.
- `byType` keys are normally `browser` (no `--type=` flag), `renderer`,
  `gpu-process`, and `utility`. A renderer whose command line contains
  `overlay` is split into `renderer-overlay`; when that cannot be identified it
  stays under `renderer`.
- `--root-pid` measures that pid plus all descendants. `--name` matches process
  names containing the text (default `electron`) plus their descendants.

## What this cannot measure

- **League FPS and frame times.** `measure.mjs` only sees process CPU and private
  working set. FPS impact requires a real match, with PresentMon or League's own
  FPS display, comparing app closed / app open with the overlay visible / hidden.
  Do the same runs with overlay rendering off in Performance settings to isolate
  the overlay cost.
- **Overlay cost on the game GPU.** There are no GPU engine counters, frame
  pacing, or present timings here; use PresentMon's GPU/display columns in the
  real-match run.
- **Input latency, compositor cost, and vsync behavior.** Not observable from WMI.
- **Real Live Client timing.** The mock replays deterministic data; request
  cadence is comparable across app builds, but network latency against a real
  League client is not.
- **Sub-interval spikes.** WMI formatted counters are coarse and sampled every
  `--interval` ms (default 1000); short bursts can be missed. Keep the same
  interval when comparing runs.

For the real-match FPS protocol: set League to Borderless at a fixed resolution,
disable frame caps, run a repeatable scenario (for example Practice Tool), and
capture with PresentMon for each configuration: app closed, app open + HUD
visible, app open + HUD hidden. Compare median and 1% low FPS, not a single
reading.
