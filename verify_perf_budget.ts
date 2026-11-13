/**
 * Performance budget — the overlay CPU/IPC cut (2026-11).
 *
 * Source-level + pure-function checks pin the bounded changes without
 * importing electron or React DOM:
 *   - State Service samples at >= 600 ms and reads `playerlist` every 4th poll
 *     (eventdata is gated on a successful gamestats read).
 *   - The change-detection fingerprint coarsens gold (/150) and item (/30)
 *     buckets — displayed values are untouched.
 *   - The paint throttle helper merges held dirty rects and always flushes the
 *     latest one, and the presenter uses it with the 12 MB queue cap.
 *   - The OverlayApp 1 Hz clock lives in a useSyncExternalStore hook so only
 *     countdown leaves re-render.
 *
 * Run: npx --yes tsx verify_perf_budget.ts
 */
import fs from 'node:fs';
import { createPaintThrottle, type PaintRect } from './electron/paint-throttle';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  } else {
    console.log('ok', msg);
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8');
}

function capture(source: string, pattern: RegExp): string | null {
  const m = source.match(pattern);
  return m?.[1] ?? null;
}

// ---- 1. State Service cadence --------------------------------------------
const stateService = read('electron/state-service.ts');
const pollMs = capture(stateService, /export const POLL_MS = (\d+);/);
ok(pollMs !== null && Number(pollMs) >= 600, `POLL_MS >= 600 (got ${String(pollMs)})`);
ok(stateService.includes('export const HIDDEN_POLL_MS = 4000;'), 'hidden-HUD sample rate stays 4000');
ok(stateService.includes('export const IDLE_PROBE_MS = 2000;'), 'idle probe stays 2000');

// ---- 2. playerlist cadence + eventdata gating ----------------------------
const playerlistEvery = capture(stateService, /const PLAYERLIST_EVERY = (\d+);/);
ok(playerlistEvery === '4', `playerlist fetched every 4th poll (got ${String(playerlistEvery)})`);
ok(stateService.includes("players ?? lastPlayers"), 'playerlist last-good value reused between polls');
ok(
  /gameData\s*\?\s*timeAsync\(latencyRecorder, 'http\.eventdata'/.test(stateService),
  'eventdata is only read when the gamestats read succeeded'
);

// ---- 3. fingerprint buckets coarsened (display values untouched) ----------
const gm = read('electron/game-monitor.ts');
const goldBucket = capture(gm, /Math\.floor\(\(lp\?\.currentGold \?\? 0\) \/ (\d+)\)/);
ok(goldBucket === '150', `fingerprint gold bucket coarsened to /150 (got ${String(goldBucket)})`);
const itemBucket = capture(gm, /Math\.floor\(\(payload\.gameTime \|\| 0\) \/ (\d+)\)/);
ok(itemBucket === '30', `fingerprint item bucket coarsened to /30 (got ${String(itemBucket)})`);
// The fingerprint must still key on displayed enemies so coarsening never
// hides a roster change.
ok(gm.includes('enemyKey'), 'fingerprint keeps the enemy key');
// Enemies array is memoized on a cheap signature.
ok(gm.includes('function mapEnemies'), 'enemies list is built once per signature (mapEnemies)');
ok(gm.includes('lastEnemySignature'), 'enemy signature cache present');

// ---- 4. paint throttle: pure merge + flush behavior -----------------------
let now = 0;
const throttle = createPaintThrottle(() => now, 84);
const leading: PaintRect = throttle.accept({ x: 10, y: 20, width: 5, height: 4 });
ok(
  !!leading && leading.x === 10 && leading.y === 20 && leading.width === 5 && leading.height === 4,
  'leading paint of a window ships immediately with its rect intact'
);
ok(throttle.windowOpen() === true, 'window is open after the leading paint');
ok(throttle.flushAt() === 84, 'flush is scheduled at now + interval (84)');
ok(throttle.flush() === null, 'nothing flushes before the window elapses');
ok(throttle.accept({ x: 30, y: 40, width: 8, height: 6 }) === null, 'intermediate paint is dropped (returns null)');
ok(throttle.accept({ x: 2, y: 4, width: 12, height: 10 }) === null, 'second intermediate paint is dropped too');
now = 84;
const union = throttle.flush();
ok(
  !!union && union.x === 2 && union.y === 4 && union.width === 36 && union.height === 42,
  `held rects are merged into the union of all dirty regions (got ${JSON.stringify(union)})`
);
ok(throttle.flush() === null, 'flush consumes the union exactly once');
now = 100;
ok(throttle.accept({ x: 0, y: 0, width: 1, height: 1 }) === null, 'a paint right after a flush is held (flush opened a new window)');
now = 200;
ok(throttle.flush() !== null, 'the held paint flushes once the post-flush window closes');
now = 400;
throttle.flush(); // nothing held: closes the window
const fresh: PaintRect = throttle.accept({ x: 0, y: 0, width: 1, height: 1 });
ok(!!fresh && throttle.windowOpen(), 'an idle paint opens a fresh window and ships immediately');
throttle.reset();
ok(throttle.flush() === null && !throttle.windowOpen(), 'reset() clears the pending union and window');

const paintThrottleSource = read('electron/paint-throttle.ts');
ok(!paintThrottleSource.includes("from 'electron'"), 'paint-throttle.ts is pure (no electron import)');

const presenter = read('electron/overlay-presenter.ts');
ok(presenter.includes('createPaintThrottle'), 'overlay-presenter.ts uses the paint throttle');
ok(presenter.includes('PAINT_THROTTLE_MS'), 'paint throttle window constant present');
const queuedCap = capture(presenter, /const MAX_QUEUED_BYTES = (\d+) \* 1024 \* 1024;/);
ok(queuedCap === '12', `MAX_QUEUED_BYTES lowered to 12 MB (got ${String(queuedCap)})`);
ok(presenter.includes('needsFullFrame = true'), 'queue-full drop forces the next frame to be a FULL frame');

// ---- 5. OverlayApp clock hook --------------------------------------------
const app = read('src/overlay/OverlayApp.tsx');
ok(app.includes('export function useOverlayClock'), 'OverlayApp exports the useOverlayClock hook');
ok(app.includes('useSyncExternalStore'), 'the overlay clock is a useSyncExternalStore subscription');
ok(app.includes('OverlayClockLabel'), 'the sums rail clock label is a leaf component');
ok(!app.includes('const [clockSec'), 'the per-second tick no longer re-renders the whole app (no clockSec state)');
ok(app.includes('React.memo'), 'right-rail panels are memoized');
ok(app.includes('deferRefresh: true'), 'catalog warm defers the live refresh past first paint');

// ---- 6. LCU socket: idle discovery + champ-select hydrate gate ------------
const socket = read('electron/lcu-socket.ts');
ok(socket.includes('IDLE_DISCOVERY_INTERVAL_MS = 5000'), 'idle lockfile discovery slows to 5 s');
ok(socket.includes('IDLE_PHASE_WINDOW_MS = 60_000'), 'idle window is 60 s without a phase');
ok(socket.includes('CHAMP_SELECT_HYDRATE_PHASES'), 'champ-select hydrate is phase-gated');
ok(
  socket.includes('CHAMP_SELECT_HYDRATE_PHASES.has(phase)'),
  'hydrate skips the champ-select REST call outside ChampSelect/Lobby'
);

// ---- 7. catalog defer + ddragon deferred refresh --------------------------
const client = read('src/catalog/client.ts');
ok(client.includes('deferRefresh'), 'warmCatalog supports deferRefresh');
ok(client.includes('scheduleDeferredCatalogWork'), 'catalog schedules deferred work off the hot path');
const ddragon = read('src/data/ddragonAssets.ts');
ok(ddragon.includes('warmDdragonVersionDeferred'), 'DDragon version refresh can be deferred');

if (failures > 0) {
  console.error(`verify:perf-budget FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('verify:perf-budget ok');
