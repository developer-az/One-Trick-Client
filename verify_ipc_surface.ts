/**
 * Verification harness for IPC Surface (electron/main.ts).
 * Tests state-service-*, clipper-status, and clip-save-manual handlers
 * for return shape, null safety, and error handling when no match is active.
 */

import {
    getStateServiceStatus,
    getObjectiveTimers,
    getRecentGameEvents,
    getRecentGameSnapshots,
    getStateServiceLog,
    getGameState,
    resetStateService,
} from './electron/state-service';
import { getClipperStatus, saveManualClip } from './electron/clipper';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

async function run(): Promise<void> {
    console.log('--- verify:ipc-surface: state-service-* handlers ---');
    resetStateService('pre-match');

    // 1. state-service-status
    const statusPayload = (() => {
        try {
            return {
                success: true,
                status: getStateServiceStatus(),
                timers: getObjectiveTimers(),
            };
        } catch (error) {
            return { success: false, error: String(error), status: null, timers: null };
        }
    })();

    ok(statusPayload.success === true, 'state-service-status success is true');
    ok(statusPayload.status === null || statusPayload.status.inGame === false, 'status is null or not in game');
    ok(statusPayload.timers === null || (statusPayload.timers.dragon === null && statusPayload.timers.baron === null), 'timers null or empty');

    // 2. state-service-events
    const eventsPayload = (() => {
        try {
            return {
                success: true,
                events: getRecentGameEvents(),
                snapshots: getRecentGameSnapshots().length,
            };
        } catch (error) {
            return { success: false, error: String(error), events: [], snapshots: 0 };
        }
    })();

    ok(eventsPayload.success === true, 'state-service-events success is true');
    ok(Array.isArray(eventsPayload.events), 'events is an array');
    ok(typeof eventsPayload.snapshots === 'number', 'snapshots count is numeric');

    // 3. state-service-log
    const logPayload = ((limit?: number) => {
        try {
            return {
                success: true,
                log: getStateServiceLog(typeof limit === 'number' ? limit : 200),
            };
        } catch (error) {
            return { success: false, error: String(error), log: [] };
        }
    })(50);

    ok(logPayload.success === true, 'state-service-log success is true');
    ok(Array.isArray(logPayload.log), 'log is an array');

    // 4. state-service-state
    const statePayload = (() => {
        try {
            return {
                success: true,
                state: getGameState(),
            };
        } catch (error) {
            return { success: false, error: String(error), state: null };
        }
    })();

    ok(statePayload.success === true, 'state-service-state success is true');
    ok(statePayload.state === null || statePayload.state.inGame === false, 'state is null or not in game');

    console.log('--- verify:ipc-surface: clipper handlers ---');
    // 5. clipper-status
    const clipperStatus = getClipperStatus();
    ok(typeof clipperStatus === 'object' && clipperStatus !== null, 'clipper-status returns object');
    ok(['disabled', 'idle', 'recording', 'stitching', 'error'].includes(clipperStatus.status), `valid status enum (got ${clipperStatus.status})`);
    ok(typeof clipperStatus.detail === 'string', 'detail is string');
    ok(typeof clipperStatus.clipsDir === 'string', 'clipsDir is string');

    // 6. clip-save-manual when no match is active
    const manualResult = await (async () => {
        try {
            const gameTime = getGameState()?.gameTime ?? getRecentGameSnapshots().at(-1)?.gameTime ?? 0;
            const saved = await saveManualClip(Math.round(gameTime));
            return { success: !!saved, path: saved, status: getClipperStatus() };
        } catch (error) {
            return { success: false, path: null, error: String(error), status: getClipperStatus() };
        }
    })();

    ok(manualResult.success === false, 'clip-save-manual returns success:false when no match/segments');
    ok(manualResult.path === null, 'clip-save-manual returns path:null');
    ok(typeof manualResult.status === 'object', 'clip-save-manual returns status object');

    if (!process.exitCode) {
        console.log('verify:ipc-surface ok');
    }
}

void run();
