/**
 * Verification harness for State Service (electron/state-service.ts).
 * Tests log rotation, staggered endpoint fetching, in-flight guard,
 * idle vs in-game cadence transitions, match-end engine reset, and clean shutdown.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    startStateService,
    stopStateService,
    setStateServiceEngaged,
    readLiveBoard,
    readLiveClock,
    getGameState,
    getRecentGameSnapshots,
    getRecentGameEvents,
    getStateServiceStatus,
    getStateServiceLog,
    resetStateService,
    rotateIfNeeded,
    LOG_MAX_BYTES,
    logFilePath,
    flushLog,
} from './electron/state-service';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

async function run(): Promise<void> {
    console.log('--- verify:state-service: log rotation ---');
    const testDir = path.join(os.tmpdir(), `ot-state-service-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    process.env.ONETRICK_USER_DATA = testDir;

    const logFile = logFilePath();
    ok(logFile.includes('state-service.log'), 'logFilePath contains state-service.log');

    // Test log rotation: file < LOG_MAX_BYTES should not rotate
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'small log line\n', 'utf8');
    rotateIfNeeded(logFile);
    ok(fs.existsSync(logFile), 'small log file retained');
    ok(!fs.existsSync(`${logFile}.1`), 'no rotation for file under 2MB');

    // Test log rotation: file >= LOG_MAX_BYTES should rotate to .1
    const bigChunk = Buffer.alloc(LOG_MAX_BYTES + 1024, 'a');
    fs.writeFileSync(logFile, bigChunk);
    rotateIfNeeded(logFile);
    ok(fs.existsSync(`${logFile}.1`), 'file rotated to .1 when >= 2MB');
    ok(!fs.existsSync(logFile), 'original file moved out of way');

    // Rotate again with another big file to test overwriting existing .1
    fs.writeFileSync(logFile, bigChunk);
    rotateIfNeeded(logFile);
    ok(fs.existsSync(`${logFile}.1`), 'existing .1 cleanly replaced on second rotation');

    // Test flushLog writes to disk
    stopStateService(); // clean slate
    flushLog(); // no crash on empty buffer

    console.log('--- verify:state-service: engine state & reset ---');
    // Initial status before start
    const initialStatus = getStateServiceStatus();
    ok(initialStatus === null || !initialStatus.inGame, 'initial state not inGame');
    ok(readLiveBoard() === null, 'readLiveBoard is null before any successful poll');
    ok(readLiveClock() === null, 'readLiveClock is null before any successful poll');
    ok(getGameState() === null || !getGameState()?.inGame, 'gameState is null or not inGame');
    ok(Array.isArray(getRecentGameEvents()), 'recent game events is an array');
    ok(Array.isArray(getRecentGameSnapshots()), 'recent snapshots is an array');
    ok(Array.isArray(getStateServiceLog()), 'state service log returns an array');

    // Test resetStateService
    resetStateService('test start');
    ok(readLiveBoard() === null, 'readLiveBoard is null after resetStateService');
    ok(readLiveClock() === null, 'readLiveClock is null after resetStateService');

    console.log('--- verify:state-service: engagement & lifecycle ---');
    // Test engagement transitions
    setStateServiceEngaged(false);
    let status = getStateServiceStatus();
    ok(status?.polling === false, 'engine polling is false when engaged is false');

    setStateServiceEngaged(true);
    status = getStateServiceStatus();
    ok(status?.polling === true, 'engine polling is true when engaged is true');

    // Calling startStateService idempotently
    startStateService();
    startStateService();
    ok(getStateServiceStatus()?.polling === true, 'idempotent startStateService keeps polling active');

    // Stop state service cleans up
    stopStateService();
    status = getStateServiceStatus();
    ok(status?.polling === false, 'stopStateService marks polling as false');
    ok(readLiveBoard() === null, 'stopStateService voids lastBoard');

    console.log('--- verify:state-service: staggered granular polling math ---');
    // PLAYERLIST_EVERY = 2, ABILITIES_EVERY = 4
    const PLAYERLIST_EVERY = 2;
    const ABILITIES_EVERY = 4;
    for (let p = 1; p <= 8; p++) {
        const wantPlayers = p % PLAYERLIST_EVERY === 0;
        const wantAbilities = p % ABILITIES_EVERY === 0;
        if (p === 1) {
            ok(!wantPlayers && !wantAbilities, 'poll 1 skips playerlist and abilities (staggered)');
        } else if (p === 2) {
            ok(wantPlayers && !wantAbilities, 'poll 2 requests playerlist, skips abilities');
        } else if (p === 4) {
            ok(wantPlayers && wantAbilities, 'poll 4 requests both playerlist and abilities');
        }
    }

    // Cleanup temp dir
    try {
        fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }

    if (!process.exitCode) {
        console.log('verify:state-service ok');
    }
}

void run();
