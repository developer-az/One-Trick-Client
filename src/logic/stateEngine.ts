/**
 * State engine — the "State Service" core.
 *
 * Owns the things that must exist exactly once per match:
 *   - the single EventID cursor (no second cursor anywhere else)
 *   - the internal event bus (each new event is emitted once)
 *   - objective respawn timers
 *   - a rolling snapshot buffer (the *before* state a fight needs in Phase 2)
 *   - a bounded debug log of every state transition and event
 *
 * IO-free and Electron-free: `deps.fetchBoard` is injected, so
 * `electron/state-service.ts` supplies axios + a 400 ms timer while
 * `verify_game_state.ts` supplies fixtures (or a live Live Client read).
 */

import {
    buildGameState,
    deriveObjectiveTimers,
    diffNewEvents,
    emptyGameState,
    EMPTY_TIMERS,
    type GameEvent,
    type GameState,
    type LiveActivePlayerLike,
    type LiveBoardLike,
    type LiveGameDataLike,
    type LivePlayerLike,
    type LiveRawEventLike,
    type ObjectiveTimers,
} from './gameState';

/** Consecutive failed polls before we admit the match is over. */
const FAILURES_TO_NOT_IN_GAME = 3;
/** Rolling fight-start buffer, in milliseconds of real time. */
const DEFAULT_SNAPSHOT_WINDOW_MS = 10_000;
/** Bounded debug log ring. */
const LOG_LIMIT = 500;

export interface StateEngineStatus {
    inGame: boolean;
    /** Consecutive failed polls. */
    failures: number;
    pollCount: number;
    errorCount: number;
    lastError: string | null;
    lastSuccessAt: number;
    /** ms since the last successful board read; 0 when never. */
    silenceMs: number;
    /** Highest EventID consumed. */
    eventCursor: number;
    polling: boolean;
}

export interface StateEngineDeps {
    fetchBoard: () => Promise<LiveBoardLike | null>;
    now?: () => number;
    snapshotWindowMs?: number;
}

export interface StatePollResult {
    /** True when the board read succeeded. */
    ok: boolean;
    /** Events newly seen on this poll (emitted once). */
    newEvents: GameEvent[];
    gameState: GameState;
    /** True when anything the HUD cares about changed since the last poll. */
    changed: boolean;
    restarted: boolean;
}

export interface StateEngine {
    pollOnce(): Promise<StatePollResult>;
    snapshot(): GameState;
    timers(): ObjectiveTimers;
    events(): GameEvent[];
    recentSnapshots(): GameState[];
    status(): StateEngineStatus;
    setPolling(active: boolean): void;
    onEvent(listener: (event: GameEvent) => void): () => void;
    onState(listener: (state: GameState, result: StatePollResult) => void): () => void;
    reset(reason?: string): void;
    log(limit?: number): string[];
}


export function createStateEngine(deps: StateEngineDeps): StateEngine {
    const now = deps.now ?? (() => Date.now());
    const snapshotWindowMs = deps.snapshotWindowMs ?? DEFAULT_SNAPSHOT_WINDOW_MS;

    let eventCursor = 0;
    let allEvents: GameEvent[] = [];
    let state: GameState = emptyGameState(now());
    let timers: ObjectiveTimers = { ...EMPTY_TIMERS };
    let failures = 0;
    let pollCount = 0;
    let errorCount = 0;
    let lastError: string | null = null;
    let lastSuccessAt = 0;
    let lastFingerprint = '';
    let polling = false;
    let snapshots: GameState[] = [];
    let logLines: string[] = [];

    const eventListeners: Array<(event: GameEvent) => void> = [];
    const stateListeners: Array<(state: GameState, result: StatePollResult) => void> = [];

    function log(line: string): void {
        logLines.push(`${new Date(now()).toISOString()} ${line}`);
        if (logLines.length > LOG_LIMIT) logLines = logLines.slice(-LOG_LIMIT);
    }

    /**
     * Coarse change fingerprint. Deliberately not a deep compare: the HUD only
     * needs to know whether a repaint is worth an IPC hop.
     */
    function fingerprint(next: GameState): string {
        const playerKey = next.players
            .map((p) => `${p.champion}:${p.level}:${p.kills}/${p.deaths}/${p.assists}:${p.cs}:${p.isDead ? 1 : 0}`)
            .join('|');
        const selfKey = [
            next.self.hpPct === null ? 'x' : Math.round(next.self.hpPct * 100),
            next.self.manaPct === null ? 'x' : Math.round(next.self.manaPct * 100),
            next.self.currentGold === null ? 'x' : Math.floor(next.self.currentGold / 50),
            next.self.cs === null ? 'x' : next.self.cs,
            next.self.level,
        ].join(',');
        return [
            next.inGame ? 1 : 0,
            Math.floor(next.gameTime / 1),
            next.self.champion,
            selfKey,
            playerKey,
            eventCursor,
        ].join('~');
    }

    function pushSnapshot(next: GameState): void {
        if (!next.inGame) {
            snapshots = [];
            return;
        }
        snapshots.push(next);
        const cutoff = now() - snapshotWindowMs;
        // Keep one snapshot older than the window so a fight starting right at
        // the edge still has a "before" frame to score against.
        let firstInside = 0;
        while (firstInside < snapshots.length - 2 && snapshots[firstInside + 1].ts < cutoff) firstInside++;
        if (firstInside > 0) snapshots = snapshots.slice(firstInside);
    }

    function emitEvent(event: GameEvent): void {
        const raw = event.raw as Record<string, unknown>;
        const who = raw.KillerName ? ` killer=${String(raw.KillerName)}` : '';
        const victim = raw.VictimName ? ` victim=${String(raw.VictimName)}` : '';
        const stolen = raw.Stolen !== undefined ? ` stolen=${String(raw.Stolen)}` : '';
        log(`[event] #${event.id} ${event.name} t=${Math.round(event.gameTime)}s${who}${victim}${stolen}`);
        for (const listener of [...eventListeners]) {
            try {
                listener(event);
            } catch (error) {
                log(`[error] event listener: ${String(error)}`);
            }
        }
    }

    function markNotInGame(reason: string): void {
        const wasInGame = state.inGame;
        state = emptyGameState(now());
        timers = { ...EMPTY_TIMERS };
        allEvents = [];
        eventCursor = 0;
        snapshots = [];
        if (wasInGame) log(`[state] match end (${reason})`);
    }

    async function pollOnce(): Promise<StatePollResult> {
        pollCount += 1;
        let board: LiveBoardLike | null = null;
        try {
            board = await deps.fetchBoard();
        } catch (error) {
            errorCount += 1;
            lastError = String(error);
        }

        if (!board) {
            failures += 1;
            // "Not in game" is a normal state (lobby, loading screen, game
            // over) — a single blip must not blank a live match.
            if (failures >= FAILURES_TO_NOT_IN_GAME) markNotInGame(`${failures} failed reads`);
            lastFingerprint = '';
            return {
                ok: false,
                newEvents: [],
                gameState: state,
                changed: state.inGame === false,
                restarted: false,
            };
        }

        failures = 0;
        lastError = null;
        lastSuccessAt = now();
        const wasInGame = state.inGame;

        const diff = diffNewEvents(eventCursor, board.events?.Events);
        if (diff.restarted) {
            log('[state] event ids restarted — new match detected');
            allEvents = [];
        }
        eventCursor = diff.maxEventId;
        if (diff.events.length) allEvents = [...allEvents, ...diff.events];

        const gameTime = typeof board.gameData?.gameTime === 'number' ? board.gameData.gameTime : 0;
        const next = buildGameState({ board, events: allEvents, ts: now() });
        state = next;
        timers = deriveObjectiveTimers(allEvents, gameTime);

        if (!wasInGame) log(`[state] match start (champion=${next.self.champion || '?'})`);

        const fp = fingerprint(next);
        const changed = fp !== lastFingerprint;
        lastFingerprint = fp;

        pushSnapshot(next);
        for (const event of diff.events) emitEvent(event);

        const result: StatePollResult = {
            ok: true,
            newEvents: diff.events,
            gameState: next,
            changed,
            restarted: diff.restarted,
        };

        for (const listener of [...stateListeners]) {
            try {
                listener(next, result);
            } catch (error) {
                log(`[error] state listener: ${String(error)}`);
            }
        }

        return result;
    }

    return {
        pollOnce,
        snapshot: () => state,
        timers: () => timers,
        events: () => [...allEvents],
        recentSnapshots: () => [...snapshots],
        status: () => ({
            inGame: state.inGame,
            failures,
            pollCount,
            errorCount,
            lastError,
            lastSuccessAt,
            silenceMs: lastSuccessAt > 0 ? Math.max(0, now() - lastSuccessAt) : 0,
            eventCursor,
            polling,
        }),
        setPolling: (active: boolean) => {
            polling = active;
        },
        onEvent: (listener) => {
            eventListeners.push(listener);
            return () => {
                const index = eventListeners.indexOf(listener);
                if (index >= 0) eventListeners.splice(index, 1);
            };
        },
        onState: (listener) => {
            stateListeners.push(listener);
            return () => {
                const index = stateListeners.indexOf(listener);
                if (index >= 0) stateListeners.splice(index, 1);
            };
        },
        reset: (reason = 'manual') => {
            log(`[state] reset (${reason})`);
            markNotInGame(reason);
        },
        log: (limit = LOG_LIMIT) => logLines.slice(-limit),
    };
}

/* ------------------------------------------------------------------ *
 * Board merge
 * ------------------------------------------------------------------ */

/**
 * The four endpoint payloads, as the State Service read them this poll.
 * Any of them may be null — a single endpoint failing must not void the board.
 */
export interface LiveBoardParts {
    events: { Events?: LiveRawEventLike[] } | null;
    activePlayer: LiveActivePlayerLike | null;
    players: LivePlayerLike[] | null;
    gameData: LiveGameDataLike | null;
    abilities?: Record<string, { abilityLevel?: number; displayName?: string }> | null;
}

/**
 * Fold the granular endpoints back into one board, the shape the rest of the
 * app already consumes.
 *
 * `/gamestats` is the liveness proof: it answers if and only if a game is
 * running, so a missing game block means "not in game" rather than a partial
 * board. Everything else degrades field-by-field onto whatever arrived.
 */
export function mergeLiveBoard(parts: LiveBoardParts): LiveBoardLike | null {
    if (!parts.gameData) return null;

    const activePlayer = parts.activePlayer
        ? {
              ...parts.activePlayer,
              abilities: parts.abilities ?? parts.activePlayer.abilities,
          }
        : undefined;

    return {
        activePlayer,
        allPlayers: parts.players ?? undefined,
        events: { Events: parts.events?.Events },
        gameData: parts.gameData,
    };
}
