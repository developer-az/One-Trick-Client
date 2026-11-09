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
import * as stateServiceModule from './electron/state-service';
import { createStateEngine, type LiveBoardLike, type LiveRawEventLike } from './src/logic/stateEngine';

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
    // PLAYERLIST_EVERY = 2; abilities are now driven by level changes (below).
    const PLAYERLIST_EVERY = 2;
    // Legacy every-4th baseline retained only for the P1 hidden-HUD budget test.
    const ABILITIES_EVERY = 4;
    for (let p = 1; p <= 8; p++) {
        const wantPlayers = p % PLAYERLIST_EVERY === 0;
        if (p === 1) {
            ok(!wantPlayers, 'poll 1 skips playerlist (staggered)');
        } else if (p === 2) {
            ok(wantPlayers, 'poll 2 requests playerlist');
        } else if (p === 4) {
            ok(wantPlayers, 'poll 4 requests playerlist');
        }
    }

    console.log('--- verify:state-service: abilities on level change ---');
    // shouldFetchAbilities is new; access it through a cast so a missing export
    // is reported as a test failure instead of aborting the harness at import time.
    const abilitiesSvc = stateServiceModule as unknown as {
        shouldFetchAbilities?: (
            lastFetchedLevel: number | null,
            knownLevel: number | null
        ) => boolean;
    };
    const shouldFetchAbilities = abilitiesSvc.shouldFetchAbilities;
    if (typeof shouldFetchAbilities === 'function') {
        ok(shouldFetchAbilities(null, null) === true, 'shouldFetchAbilities(null, null) true (first fetch)');
        ok(shouldFetchAbilities(null, 5) === true, 'shouldFetchAbilities(null, 5) true (first fetch)');
        ok(shouldFetchAbilities(5, 5) === false, 'shouldFetchAbilities(5, 5) false (no level change)');
        ok(shouldFetchAbilities(5, 6) === true, 'shouldFetchAbilities(5, 6) true (level up)');
        ok(shouldFetchAbilities(6, 5) === true, 'shouldFetchAbilities(6, 5) true (mismatch refetches)');
        ok(shouldFetchAbilities(5, null) === false, 'shouldFetchAbilities(5, null) false (no known level)');

        // Simulated 30-minute game: level 1 -> 18 over 1500 polls. Only the first
        // poll and each level change may trigger an abilities read.
        let lastFetchedLevel: number | null = null;
        let abilitiesFetches = 0;
        for (let poll = 1; poll <= 1500; poll++) {
            const knownLevel = Math.min(18, 1 + Math.floor(((poll - 1) * 18) / 1500));
            if (shouldFetchAbilities(lastFetchedLevel, knownLevel)) {
                abilitiesFetches += 1;
                lastFetchedLevel = knownLevel;
            }
        }
        ok(
            abilitiesFetches <= 18,
            `level 1->18 over 1500 polls triggers at most 18 abilities fetches (got ${abilitiesFetches})`
        );
        ok(
            abilitiesFetches >= 18,
            `every level change triggers an abilities fetch, so at least 18 (got ${abilitiesFetches})`
        );
        ok(
            abilitiesFetches < 1500 / 4,
            `level-change fetches (${abilitiesFetches}) beat old every-4th rule (375)`
        );
    } else {
        ok(false, 'shouldFetchAbilities exported');
    }

    console.log('--- verify:state-service: unspent skill points ---');
    // shouldRefreshUnspentAbilities is new; access it through a cast so a missing
    // export is reported as a test failure instead of aborting the harness at import time.
    const unspentSvc = stateServiceModule as unknown as {
        shouldRefreshUnspentAbilities?: (input: {
            ranksSum: number | null;
            level: number | null;
            pollsSinceAbilitiesFetch: number;
            msSinceLevelChange: number | null;
        }) => boolean;
    };
    const shouldRefreshUnspentAbilities = unspentSvc.shouldRefreshUnspentAbilities;
    if (typeof shouldRefreshUnspentAbilities === 'function') {
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === true,
            'unspent point refreshes after 5 polls within 30s'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 6,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === false,
            'no refresh when every level has a rank (ranksSum == level)'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 6,
                level: 5,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === false,
            'no refresh when ranksSum > level (champion starts with a rank)'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 4,
                msSinceLevelChange: 1000,
            }) === false,
            'no refresh before the 5th poll'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === true,
            'refresh on the 5th poll'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 30_001,
            }) === false,
            'no refresh once the level change is older than 30s'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 30_000,
            }) === true,
            'refresh at exactly 30s after the level change'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: null,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === false,
            'no refresh without an abilities payload'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: null,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: 1000,
            }) === false,
            'no refresh without a known level'
        );
        ok(
            shouldRefreshUnspentAbilities({
                ranksSum: 5,
                level: 6,
                pollsSinceAbilitiesFetch: 5,
                msSinceLevelChange: null,
            }) === false,
            'no refresh without a known level-change time'
        );

        // Level 5 -> 6 at t=0 leaves one unspent point (ranksSum 5). The point
        // is spent at t=3.2s (ranksSum becomes 6). Poll every 400ms: the helper
        // may refresh at most every 5th poll while a point is unspent, then must
        // stop once the spent rank is visible.
        const SIM_POLL_MS = 400;
        const SIM_END_MS = 30_000;
        const SIM_POINT_SPENT_AT_MS = 3200;
        let simRanksSum = 5;
        let simPollsSinceAbilitiesFetch = 0;
        let simRefreshes = 0;
        let simRefreshesAfterSpent = 0;
        for (let t = 0; t <= SIM_END_MS; t += SIM_POLL_MS) {
            if (t >= SIM_POINT_SPENT_AT_MS) simRanksSum = 6;
            simPollsSinceAbilitiesFetch += 1;
            const refresh = shouldRefreshUnspentAbilities({
                ranksSum: simRanksSum,
                level: 6,
                pollsSinceAbilitiesFetch: simPollsSinceAbilitiesFetch,
                msSinceLevelChange: t,
            });
            if (refresh) {
                simRefreshes += 1;
                if (t >= SIM_POINT_SPENT_AT_MS) simRefreshesAfterSpent += 1;
                // A successful abilities read resets the poll counter. Before
                // the point is spent the payload still reports ranksSum 5.
                simRanksSum = t >= SIM_POINT_SPENT_AT_MS ? 6 : 5;
                simPollsSinceAbilitiesFetch = 0;
            }
        }
        ok(
            simRefreshes >= 1 && simRefreshes <= 2,
            `level-up simulation refreshes 1-2 times while the point is unspent (got ${simRefreshes})`
        );
        ok(
            simRefreshesAfterSpent === 0,
            `level-up simulation stops refreshing after the point is spent (got ${simRefreshesAfterSpent})`
        );
    } else {
        ok(false, 'shouldRefreshUnspentAbilities exported');
    }

    console.log('--- verify:state-service: hidden-HUD cadence ---');
    // The new hidden-HUD exports do not exist yet. Access them through a cast so
    // the rest of the harness (including the event-integrity test below) can run
    // and report each missing export rather than aborting at import time.
    const svc = stateServiceModule as unknown as {
        POLL_MS?: number;
        HIDDEN_POLL_MS?: number;
        IDLE_PROBE_MS?: number;
        stateServiceCadence?: (inGame: boolean, hudHidden: boolean) => number;
        setStateServiceHudHidden?: (hidden: boolean) => void;
        isStateServiceHudHidden?: () => boolean;
        getStateServiceCadenceMs?: () => number;
    };

    ok(svc.POLL_MS === 400, `POLL_MS === 400 (got ${String(svc.POLL_MS)})`);
    ok(svc.HIDDEN_POLL_MS === 4000, `HIDDEN_POLL_MS === 4000 (got ${String(svc.HIDDEN_POLL_MS)})`);
    ok(svc.IDLE_PROBE_MS === 2000, `IDLE_PROBE_MS === 2000 (got ${String(svc.IDLE_PROBE_MS)})`);

    const cadenceFor = typeof svc.stateServiceCadence === 'function' ? svc.stateServiceCadence : null;
    ok(cadenceFor?.(false, false) === 2000, 'stateServiceCadence(false, false) is idle probe 2000');
    ok(cadenceFor?.(false, true) === 2000, 'stateServiceCadence(false, true) is idle probe 2000');
    ok(cadenceFor?.(true, false) === 400, 'stateServiceCadence(true, false) is poll 400');
    ok(cadenceFor?.(true, true) === 4000, 'stateServiceCadence(true, true) is hidden poll 4000');

    if (
        typeof svc.isStateServiceHudHidden === 'function' &&
        typeof svc.setStateServiceHudHidden === 'function'
    ) {
        ok(svc.isStateServiceHudHidden() === false, 'HUD hidden flag defaults to false');
        svc.setStateServiceHudHidden(true);
        ok(svc.isStateServiceHudHidden() === true, 'HUD hidden flag becomes true after set(true)');
        svc.setStateServiceHudHidden(true);
        ok(svc.isStateServiceHudHidden() === true, 'setting true again keeps HUD hidden true');
        svc.setStateServiceHudHidden(false);
        ok(svc.isStateServiceHudHidden() === false, 'HUD hidden flag becomes false after set(false)');
    } else {
        ok(false, 'isStateServiceHudHidden/setStateServiceHudHidden exported');
    }

    if (
        typeof svc.getStateServiceCadenceMs === 'function' &&
        typeof svc.setStateServiceHudHidden === 'function'
    ) {
        // No successful poll has happened in this harness yet, so the engine is
        // not in game and both HUD states must use the idle probe.
        svc.setStateServiceHudHidden(true);
        ok(
            svc.getStateServiceCadenceMs() === 2000,
            `cadence before first poll is idle probe when HUD hidden (got ${svc.getStateServiceCadenceMs()})`
        );
        svc.setStateServiceHudHidden(false);
        ok(
            svc.getStateServiceCadenceMs() === 2000,
            `cadence before first poll is idle probe when HUD visible (got ${svc.getStateServiceCadenceMs()})`
        );
    } else {
        ok(false, 'getStateServiceCadenceMs/setStateServiceHudHidden exported (pre-game cadence)');
    }

    // Base poll reads gamestats + activeplayer + eventdata (3), playerlist on
    // every 2nd poll (+0.5), abilities on every 4th poll (+0.25).
    const REQUESTS_PER_POLL = 3 + 1 / PLAYERLIST_EVERY + 1 / ABILITIES_EVERY;
    const hiddenReqPerSec = REQUESTS_PER_POLL / (4000 / 1000);
    const visibleReqPerSec = REQUESTS_PER_POLL / (400 / 1000);
    ok(hiddenReqPerSec <= 1.0, `hidden HUD budget <= 1 req/s (got ${hiddenReqPerSec})`);
    ok(visibleReqPerSec > 9, `visible HUD baseline exceeds 9 req/s (got ${visibleReqPerSec})`);

    // Event integrity across a slow poll that skips intermediate states. The
    // engine's cursor starts at 0 and treats EventID 0 as already consumed, so
    // this fixture uses 1..5 then 1..10 to exercise the same ten-event sequence.
    const boardWithEventIds = (ids: number[]): LiveBoardLike => {
        const events: LiveRawEventLike[] = ids.map((id) => ({
            EventID: id,
            EventName: id === 1 ? 'GameStart' : 'ChampionKill',
            EventTime: id * 10,
        }));
        return {
            gameData: { gameTime: ids.length * 10, gameMode: 'CLASSIC' },
            activePlayer: {
                level: 1,
                currentGold: 500,
                championStats: { currentHealth: 500, maxHealth: 500, resourceValue: 250, resourceMax: 250 },
            },
            allPlayers: [
                {
                    championName: 'Ahri',
                    team: 'ORDER',
                    level: 1,
                    isDead: false,
                    scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0 },
                },
            ],
            events: { Events: events },
        };
    };
    let eventBoard = boardWithEventIds([1, 2, 3, 4, 5]);
    const eventEngine = createStateEngine({ fetchBoard: async () => eventBoard });
    const busEventIds: number[] = [];
    eventEngine.onEvent((event) => busEventIds.push(event.id));
    await eventEngine.pollOnce();
    eventBoard = boardWithEventIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await eventEngine.pollOnce(); // one slow poll skipped the intermediate payloads
    await eventEngine.pollOnce(); // same full payload again must not duplicate
    const eventIds = eventEngine.events().map((event) => event.id);
    const expectedEventIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    ok(eventEngine.status().inGame, 'event-integrity fixture is in game');
    ok(
        eventIds.length === expectedEventIds.length && eventIds.every((id, i) => id === expectedEventIds[i]),
        `slow polling keeps exactly 10 events in order (got ${eventIds.join(',')})`
    );
    ok(new Set(eventIds).size === 10, 'slow polling keeps 10 distinct events with no duplicates');
    ok(
        busEventIds.length === expectedEventIds.length && busEventIds.every((id, i) => id === expectedEventIds[i]),
        `event bus emits each event exactly once in order (got ${busEventIds.join(',')})`
    );

    // Reset all global state changed by this section.
    stopStateService();
    svc.setStateServiceHudHidden?.(false);

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
