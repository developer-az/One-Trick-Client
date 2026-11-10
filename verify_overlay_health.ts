/**
 * Overlay stays in front of the game for a whole match.
 * Bug (reproduced 2026-11-09 with a topmost stand-in window): another topmost window that takes the
 * foreground sits above the overlay; the overlay keeps its always-on-top flag, so the old keep-alive
 * (which only re-applied a lost flag) never raised it again.
 * These are the pure decisions; the real z-order is checked by the orchestrator's stand-in window run.
 */
import {
    OVERLAY_RAISE_EVERY_MS,
    OVERLAY_REBUILD_AFTER_MS,
    shouldRaiseOverlay,
    shouldRebuildOverlay,
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

// ---- raise cadence ----
ok(OVERLAY_RAISE_EVERY_MS >= 2000 && OVERLAY_RAISE_EVERY_MS <= 5000, 'raise cadence is between 2 s and 5 s');
ok(shouldRaiseOverlay({ wanted: true, visible: true, msSinceRaise: OVERLAY_RAISE_EVERY_MS }), 'raise: due when visible and the interval passed');
ok(shouldRaiseOverlay({ wanted: true, visible: true, msSinceRaise: Number.POSITIVE_INFINITY }), 'raise: due when never raised');
ok(!shouldRaiseOverlay({ wanted: true, visible: true, msSinceRaise: OVERLAY_RAISE_EVERY_MS - 1 }), 'raise: not before the interval');
ok(!shouldRaiseOverlay({ wanted: true, visible: false, msSinceRaise: 60_000 }), 'raise: never on a hidden window (raising would show it)');
ok(!shouldRaiseOverlay({ wanted: false, visible: true, msSinceRaise: 60_000 }), 'raise: never when the window is not wanted');

// ---- rebuild watchdog ----
const base = {
    inMatch: true,
    userHidden: false,
    overlayEnabled: true,
    holdToShow: false,
    windowCount: 2,
    anyVisible: false,
    allSlotsEmpty: false,
    msInvisible: OVERLAY_REBUILD_AFTER_MS,
};
ok(OVERLAY_REBUILD_AFTER_MS >= 10_000 && OVERLAY_REBUILD_AFTER_MS <= 30_000, 'rebuild threshold is between 10 s and 30 s');
ok(shouldRebuildOverlay(base), 'rebuild: in match, wanted, nothing visible for the threshold');
ok(shouldRebuildOverlay({ ...base, windowCount: 0, msInvisible: OVERLAY_REBUILD_AFTER_MS }), 'rebuild: no windows at all');
ok(!shouldRebuildOverlay({ ...base, msInvisible: OVERLAY_REBUILD_AFTER_MS - 1 }), 'rebuild: not before the threshold');
ok(!shouldRebuildOverlay({ ...base, anyVisible: true }), 'rebuild: not while a window is visible');
ok(!shouldRebuildOverlay({ ...base, userHidden: true }), 'rebuild: never against the user hiding the HUD');
ok(!shouldRebuildOverlay({ ...base, overlayEnabled: false }), 'rebuild: never when the overlay is switched off');
ok(!shouldRebuildOverlay({ ...base, inMatch: false }), 'rebuild: never outside a match');
ok(!shouldRebuildOverlay({ ...base, holdToShow: true }), 'rebuild: hold-to-show hides on purpose');
ok(!shouldRebuildOverlay({ ...base, allSlotsEmpty: true }), 'rebuild: empty slots are hidden on purpose');

// ---- log line ----
const line = formatOverlayLogLine(Date.UTC(2026, 10, 9, 19, 15, 42, 7), 'raise', { windows: 2, reason: 'interval' });
ok(line.startsWith('2026-11-09T19:15:42.007Z '), 'log: ISO timestamp first');
ok(line.includes(' raise ') && line.includes('windows=2') && line.includes('reason=interval'), 'log: event and key=value details');
ok(!line.includes('\n'), 'log: single line');
ok(formatOverlayLogLine(0, 'hide').trim().endsWith('hide'), 'log: details optional');
ok(!formatOverlayLogLine(0, 'x', { note: 'a\nb' }).includes('\n'), 'log: newlines in values are flattened');
