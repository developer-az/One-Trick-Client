/**
 * Overlay health: one window, honestly reported.
 *
 * History: this file used to test the raise/rebuild/stall-repair rules of the
 * multi-window lifecycle. That lifecycle was retired on 2026-11-10 (Step 2
 * single-window remake) after the overlay kept vanishing ~10 min into real
 * matches while every app-side signal said healthy — windows visible,
 * topmost, pages producing frames. The overlay is now ONE window: created
 * once, shown/hidden only, destroyed only when the match ends, the app
 * quits, or the overlay is disabled. Health is still computed (overlay.log's
 * once-a-minute `health` line) but nothing acts on it automatically.
 *
 * These checks pin the new structure so the intervention machinery cannot
 * creep back. The structural assertions were first proven against the
 * pre-remake code, where they failed in 24 places.
 */
import fs from 'node:fs';
import {
    OVERLAY_BEAT_EVERY_MS,
    OVERLAY_PAINT_STALL_MS,
    overlayWindowFaults,
    overlayWindowWanted,
    type OverlayWindowHealth,
} from './electron/overlay-bounds';
import { formatOverlayLogLine } from './electron/overlay-log';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function read(rel: string): string {
    return fs.readFileSync(rel, 'utf8');
}

// ---- one window, created in exactly one place ----
const ow = read('electron/overlay-window.ts');
ok(
    (ow.match(/new BrowserWindow\(/g) || []).length === 1,
    'overlay-window.ts contains exactly one `new BrowserWindow(` — a single creation site'
);

// ---- the multi-window lifecycle is gone, not bypassed ----
for (const gone of [
    'extraWindows',
    'createLayeredWindow',
    'destroyExtraWindows',
    'applyLockedClusters',
    'applyClusterToWindow',
    'lockedClusters',
]) {
    ok(!ow.includes(gone), `overlay-window.ts no longer references ${gone}`);
}

// ---- nothing resurrects or destroys the window mid-match ----
for (const gone of [
    'scheduleUserHiddenDestroy',
    'USER_HIDDEN_DESTROY_MS',
    'raiseOverlayIfDue',
    'rebuildOverlayIfStuck',
    'checkOverlayHealth',
    'overlayInvisibleSince',
]) {
    ok(!ow.includes(gone), `overlay-window.ts no longer references ${gone}`);
}
ok(
    (ow.match(/destroyOverlay\(/g) || []).length === 1,
    'destroyOverlay is defined once and never called inside overlay-window.ts (callers are match end / app quit / settings only)'
);
ok(
    (ow.match(/\.destroy\(\)/g) || []).length === 1,
    'the overlay window is destroyed in exactly one place (destroyOverlay)'
);

// ---- content still gates visibility, now as one aggregate report ----
ok(ow.includes('setOverlaySlotContent'), 'the page content report entry point still exists');
ok(ow.includes('pageHasContent'), 'content state is a single aggregate flag, not per-window slot sets');
for (const gone of ['emptySlots', 'emptyGrace']) {
    ok(!ow.includes(gone), `overlay-window.ts no longer references ${gone}`);
}

// ---- the pure decision rules that drove rebuilds are gone from overlay-bounds ----
const ob = read('electron/overlay-bounds.ts');
for (const gone of ['shouldRaiseOverlay', 'shouldRebuildOverlay', 'shouldRebuildStalledOverlay']) {
    ok(!ob.includes(gone), `overlay-bounds.ts no longer exports ${gone}`);
}

// ---- the game monitor no longer runs interventions on its tick ----
const gm = read('electron/game-monitor.ts');
for (const gone of ['raiseOverlayIfDue', 'rebuildOverlayIfStuck', 'checkOverlayHealth']) {
    ok(!gm.includes(gone), `game-monitor.ts no longer references ${gone}`);
}

// ---- wanted rule: content gates the one window in locked mode only ----
const wanted = {
    userHidden: false,
    overlayEnabled: true,
    locked: true,
    holdToShow: false,
    holdDown: false,
    emptySlot: false,
};
ok(overlayWindowWanted(wanted), 'wanted: locked, enabled, has content');
ok(!overlayWindowWanted({ ...wanted, emptySlot: true }), 'wanted: locked with nothing to draw stays hidden');
ok(overlayWindowWanted({ ...wanted, locked: false, emptySlot: true }), 'wanted: unlocked panel shows regardless of content');
ok(!overlayWindowWanted({ ...wanted, userHidden: true }), 'wanted: never against a user hide');
ok(!overlayWindowWanted({ ...wanted, overlayEnabled: false }), 'wanted: never when the overlay is switched off');
ok(!overlayWindowWanted({ ...wanted, holdToShow: true }), 'wanted: hold-to-show waits for the key');
ok(overlayWindowWanted({ ...wanted, holdToShow: true, holdDown: true }), 'wanted: hold-to-show shows while held');

// ---- health faults: computed for the log line, nothing acts on them ----
const healthy: OverlayWindowHealth = {
    visible: true,
    minimized: false,
    onTop: true,
    boundsOk: true,
    msShown: 120_000,
    msSinceBeat: OVERLAY_BEAT_EVERY_MS,
    msSinceFrame: OVERLAY_BEAT_EVERY_MS,
    pageVisible: true,
};
ok(OVERLAY_PAINT_STALL_MS >= OVERLAY_BEAT_EVERY_MS * 3, 'health: a stall needs several missed heartbeats');
ok(overlayWindowFaults(healthy).length === 0, 'health: a drawing window has no faults');
ok(
    overlayWindowFaults({ ...healthy, visible: false, minimized: true, msSinceBeat: null, msSinceFrame: null }).length === 0,
    'health: a hidden window is never at fault'
);
ok(overlayWindowFaults({ ...healthy, minimized: true }).includes('minimized'), 'health: shown but minimized');
ok(overlayWindowFaults({ ...healthy, onTop: false }).includes('not-on-top'), 'health: shown but not on top');
ok(overlayWindowFaults({ ...healthy, boundsOk: false }).includes('bounds'), 'health: shown in the wrong place');
ok(overlayWindowFaults({ ...healthy, pageVisible: false }).includes('page-hidden'), 'health: page believes it is hidden');
ok(
    overlayWindowFaults({ ...healthy, msSinceFrame: OVERLAY_PAINT_STALL_MS }).includes('no-frames'),
    'health: page alive but no frames'
);
ok(
    overlayWindowFaults({ ...healthy, msShown: OVERLAY_PAINT_STALL_MS - 1, msSinceBeat: null, msSinceFrame: null }).length === 0,
    'health: a just-shown window gets time to draw'
);

// ---- overlay log format ----
const line = formatOverlayLogLine(Date.UTC(2026, 10, 9, 19, 15, 42, 7), 'show', { windows: 1, reason: 'slot-content' });
ok(line.startsWith('2026-11-09T19:15:42.007Z '), 'log: ISO timestamp first');
ok(line.includes(' show ') && line.includes('windows=1') && line.includes('reason=slot-content'), 'log: event and key=value details');
ok(!line.includes('\n'), 'log: single line');
ok(formatOverlayLogLine(0, 'hide').trim().endsWith('hide'), 'log: details optional');
ok(!formatOverlayLogLine(0, 'x', { note: 'a\nb' }).includes('\n'), 'log: newlines in values are flattened');
