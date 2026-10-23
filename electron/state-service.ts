/**
 * State Service — the Electron-side adapter around `src/logic/stateEngine.ts`.
 *
 * This is the only place that reads the Live Client for game state. It owns the
 * 400 ms timer; the engine owns the EventID cursor, the event bus and the
 * objective timers. `game-monitor.ts` became a *consumer* of this module: it
 * reads the cached board on its own (slower) HUD cadence instead of doing its
 * own network fetch, so the HUD render rate and the state sample rate are
 * decoupled.
 *
 * Every read is a granular endpoint. `/allgamedata` is never polled here.
 *
 * Compliance: localhost only, read-only. Nothing here sends input or touches
 * the League process.
 */

import { userDataDir } from './paths';
import fs from 'fs';
import path from 'path';
import {
    createStateEngine,
    mergeLiveBoard,
    type LiveBoardParts,
    type StateEngine,
    type StateEngineStatus,
    type StatePollResult,
} from '../src/logic/stateEngine';
import type { GameEvent, GameState, LiveBoardLike, ObjectiveTimers } from '../src/logic/gameState';
import {
    fetchActivePlayer,
    fetchActivePlayerAbilities,
    fetchEventData,
    fetchGameStats,
    fetchPlayerList,
    type LiveClientAllGameData,
    type LiveClientGameData,
} from './live-client';

/** The State Service sample rate. Events must land within a fight's reaction window. */
const POLL_MS = 400;
/** Idle probe: engaged but no match running yet (lobby / loading screen). */
const IDLE_PROBE_MS = 2000;
/** `playerlist` is the big payload and changes slowly — read every Nth poll. */
const PLAYERLIST_EVERY = 2;
/** Abilities change on level-up only. */
const ABILITIES_EVERY = 4;
/** Debug log rotation cap. */
const LOG_MAX_BYTES = 2 * 1024 * 1024;

let engine: StateEngine | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let engaged = false;
let pollIndex = 0;
let inFlight = false;
/** Last good reads for the endpoints we poll less often. */
let lastPlayers: LiveBoardParts['players'] = null;
let lastAbilities: LiveBoardParts['abilities'] = null;
let lastClock: LiveClientGameData | null = null;
/** Last merged board — what game-monitor reads instead of doing its own fetch. */
let lastBoard: LiveClientAllGameData | null = null;
let loggedLines = 0;
let logBuffer: string[] = [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

function logFilePath(): string {
    return path.join(userDataDir(), 'logs', 'state-service.log');
}

/** Size-capped rotation: state-service.log → state-service.log.1, then start fresh. */
function rotateIfNeeded(file: string): void {
    try {
        if (fs.statSync(file).size < LOG_MAX_BYTES) return;
        const rolled = `${file}.1`;
        if (fs.existsSync(rolled)) fs.unlinkSync(rolled);
        fs.renameSync(file, rolled);
    } catch {
        // No file yet, or the OS refused the rename. Never fatal.
    }
}

function flushLog(): void {
    if (logFlushTimer) {
        clearTimeout(logFlushTimer);
        logFlushTimer = null;
    }
    if (!logBuffer.length) return;
    const chunk = `${logBuffer.join('\n')}\n`;
    logBuffer = [];
    try {
        const file = logFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        rotateIfNeeded(file);
        fs.appendFileSync(file, chunk, 'utf8');
    } catch {
        // Logging must never break the state loop.
    }
}

function mirrorNewLogLines(): void {
    if (!engine) return;
    const lines = engine.log();
    if (lines.length <= loggedLines) {
        loggedLines = lines.length;
        return;
    }
    logBuffer.push(...lines.slice(loggedLines));
    loggedLines = lines.length;
    if (logBuffer.length >= 40 || !engaged) {
        flushLog();
        return;
    }
    if (!logFlushTimer) {
        logFlushTimer = setTimeout(flushLog, 2000);
        logFlushTimer?.unref?.();
    }
}

/**
 * One board read across the granular endpoints.
 *
 * `gamestats` is fetched every poll because it is the liveness proof and the
 * cheap game clock. `playerlist` and `activeplayerabilities` are staggered; a
 * failed staggered read keeps its last good value instead of voiding the board.
 */
async function fetchBoardParts(): Promise<LiveBoardLike | null> {
    pollIndex += 1;
    const wantPlayers = pollIndex % PLAYERLIST_EVERY === 0;
    const wantAbilities = pollIndex % ABILITIES_EVERY === 0;

    const [events, activePlayer, gameData, players, abilities] = await Promise.all([
        fetchEventData(),
        fetchActivePlayer(),
        fetchGameStats(),
        wantPlayers ? fetchPlayerList() : Promise.resolve(null),
        wantAbilities ? fetchActivePlayerAbilities() : Promise.resolve(null),
    ]);

    if (players) lastPlayers = players;
    if (abilities) lastAbilities = abilities;
    if (gameData) lastClock = gameData;

    const board = mergeLiveBoard({
        events,
        activePlayer,
        players: players ?? lastPlayers,
        gameData,
        abilities: abilities ?? lastAbilities,
    });
    // `mergeLiveBoard` reconstructs exactly the `/allgamedata` shape from the
    // same four endpoints that endpoint is built from, so the non-null result is
    // the board the rest of the app already consumes. The assertion is purely a
    // type-level one: `mergeLiveBoard` is typed against the structural
    // `LiveBoardLike` so it stays Electron-free and unit-testable.
    if (board) lastBoard = board as LiveClientAllGameData;
    return board;
}

function ensureEngine(): StateEngine {
    if (engine) return engine;
    engine = createStateEngine({ fetchBoard: fetchBoardParts });
    return engine;
}

function cadence(): number {
    return ensureEngine().status().inGame ? POLL_MS : IDLE_PROBE_MS;
}

function scheduleNext(): void {
    if (!engaged) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void tick();
    }, cadence());
}

async function tick(): Promise<void> {
    if (!engaged || inFlight) {
        if (engaged) scheduleNext();
        return;
    }
    inFlight = true;
    try {
        await ensureEngine().pollOnce();
        if (engaged) mirrorNewLogLines();
    } catch (error) {
        // The engine already turns read failures into state. This catch is for
        // anything the engine could not absorb, and must not kill the loop.
        console.warn('[state] poll failed:', error);
    } finally {
        inFlight = false;
        if (engaged) scheduleNext();
    }
}

/* ------------------------------------------------------------------ *
 * Public API — game-monitor.ts consumes this
 * ------------------------------------------------------------------ */

/** Start the sample loop. Idempotent. */
export function startStateService(): void {
    ensureEngine();
    const wasEngaged = engaged;
    engaged = true;
    if (timer || inFlight) return;
    // Read once immediately so a match that is already running is picked up on
    // the first tick instead of after one idle-probe interval.
    if (!wasEngaged) void tick();
    else scheduleNext();
}

/** Stop sampling. The last state is retained but marked as not polling. */
export function stopStateService(): void {
    engaged = false;
    if (timer) clearTimeout(timer);
    timer = null;
    ensureEngine().setPolling(false);
    lastBoard = null;
    lastClock = null;
    lastPlayers = null;
    lastAbilities = null;
    pollIndex = 0;
    flushLog();
}
/**
 * Whether the Live Client is worth reading at all. game-monitor drives this from
 * its own lifecycle knowledge (LCU phase present, or a match already running),
 * so the service does not have to duplicate that policy.
 */
export function setStateServiceEngaged(next: boolean): void {
    if (engaged === next) return;
    engaged = next;
    ensureEngine().setPolling(next);
    if (next) {
        if (!timer && !inFlight) scheduleNext();
        return;
    }
    if (timer) clearTimeout(timer);
    timer = null;
}

/**
 * Latest merged board from the last poll — **no IO, never blocks.**
 * Returns null when no poll has ever succeeded (not in game yet).
 */
export function readLiveBoard(): LiveClientAllGameData | null {
    const status = engine?.status();
    if (!status || status.lastSuccessAt === 0 || !status.inGame) return null;
    return lastBoard;
}

/** Cheap game clock from the last successful `gamestats` read. */
export function readLiveClock(): LiveClientGameData | null {
    if (!lastClock) return null;
    const status = engine?.status();
    if (!status?.inGame) return null;
    return lastClock;
}

export function getGameState(): GameState | null {
    return engine?.snapshot() ?? null;
}

export function getObjectiveTimers(): ObjectiveTimers | null {
    return engine?.timers() ?? null;
}

export function getRecentGameSnapshots(): GameState[] {
    return engine?.recentSnapshots() ?? [];
}

export function getRecentGameEvents(): GameEvent[] {
    return engine?.events() ?? [];
}

export function getStateServiceStatus(): StateEngineStatus | null {
    return engine?.status() ?? null;
}

/** Rotating debug log — in-memory ring plus the size-capped file on disk. */
export function getStateServiceLog(limit = 200): string[] {
    return engine?.log(limit) ?? [];
}

/** Subscribe to every newly-seen Live Client event, exactly once each. */
export function onGameEvent(listener: (event: GameEvent) => void): () => void {
    return ensureEngine().onEvent(listener);
}

/** Subscribe to state updates. Fires on every successful poll. */
export function onGameState(
    listener: (state: GameState, result: StatePollResult) => void
): () => void {
    return ensureEngine().onState(listener);
}

/**
 * Drop cursor, events, timers and snapshots. Called on match start so a new
 * game's EventIDs (which restart at 0) can never be mistaken for old ones.
 */
export function resetStateService(reason = 'match start'): void {
    lastBoard = null;
    lastClock = null;
    lastPlayers = null;
    lastAbilities = null;
    pollIndex = 0;
    ensureEngine().reset(reason);
}


export { rotateIfNeeded, LOG_MAX_BYTES, logFilePath, flushLog, fetchBoardParts };
