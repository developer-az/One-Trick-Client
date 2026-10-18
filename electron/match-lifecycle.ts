/**
 * When a match is allowed to take the overlay down.
 *
 * A dropped League client socket, a slow Live Client read, or one bad
 * gameflow event must not hide the HUD in the middle of a game. The overlay
 * stays up until League is actually done, or until the game process itself
 * has been gone for a long time.
 */

export const IN_GAME_PHASES = ['InProgress', 'GameStart', 'Reconnect'] as const;

export const TERMINAL_PHASES = ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'] as const;

/** Client is back in a menu. These are real, but they can flap for one event. */
export const OUT_OF_GAME_PHASES = [
    'None',
    'Lobby',
    'Matchmaking',
    'ReadyCheck',
    'ChampSelect',
    'FailedToLaunch',
    'TerminatedInError',
] as const;

/** Post-game phase must sit this long, with the live clock stopped, before the HUD closes. */
export const TERMINAL_PHASE_HOLD_MS = 8_000;

/** Menu phase plus a dead Live Client — long enough to ignore a one-frame flap. */
export const OUT_OF_GAME_HOLD_MS = 12_000;

/**
 * No Live Client proof at all (full payload or the cheap clock) and no
 * in-game phase. A teamfight hitch is a few seconds; a closed game is not.
 */
export const LIVE_SILENCE_END_MS = 60_000;

/** When the match clock is deep into the game, tolerate longer Live Client / LCU gaps. */
export const LIVE_SILENCE_MIDGAME_END_MS = 180_000;

/** Clock must move by more than a poll jitter before we trust that the match is still running. */
export const LIVE_CLOCK_ADVANCE_SEC = 0.25;

const IN_GAME = new Set<string>(IN_GAME_PHASES);
const TERMINAL = new Set<string>(TERMINAL_PHASES);
const OUT_OF_GAME = new Set<string>(OUT_OF_GAME_PHASES);

export function isInGamePhase(phase: string | null | undefined): boolean {
    return !!phase && IN_GAME.has(phase);
}

export function isTerminalPhase(phase: string | null | undefined): boolean {
    return !!phase && TERMINAL.has(phase);
}

export function isOutOfGamePhase(phase: string | null | undefined): boolean {
    return !!phase && OUT_OF_GAME.has(phase);
}

export interface EndMatchInput {
    phase: string | null;
    /** Milliseconds since allgamedata or gamestats last answered. */
    liveSilenceMs: number;
    /** How long `phase` has been the current phase. */
    phaseHeldMs: number;
    /** Clock from the read that just succeeded, or null when this tick got nothing. */
    liveGameTime: number | null;
    /** Last clock we accepted from a successful read. */
    trustedGameTime: number;
}

/** True when the live clock is still moving, so a phase label cannot end the match. */
export function liveClockStillRunning(liveGameTime: number | null, trustedGameTime: number): boolean {
    if (liveGameTime == null || !Number.isFinite(liveGameTime) || liveGameTime <= 1) return false;
    return liveGameTime > trustedGameTime + LIVE_CLOCK_ADVANCE_SEC;
}

/**
 * Whether to tear the overlay down.
 * InProgress / GameStart / Reconnect never ends a match, no matter how many Live Client reads fail.
 */
export function shouldEndMatch(input: EndMatchInput): boolean {
    if (isInGamePhase(input.phase)) return false;
    if (liveClockStillRunning(input.liveGameTime, input.trustedGameTime)) return false;

    if (isTerminalPhase(input.phase)) {
        return input.phaseHeldMs >= TERMINAL_PHASE_HOLD_MS;
    }

    if (isOutOfGamePhase(input.phase)) {
        return input.phaseHeldMs >= OUT_OF_GAME_HOLD_MS && input.liveSilenceMs >= OUT_OF_GAME_HOLD_MS;
    }

    // Socket dropped and the lockfile is gone, or the phase is unknown.
    const silenceLimit =
        input.trustedGameTime >= 300 ? LIVE_SILENCE_MIDGAME_END_MS : LIVE_SILENCE_END_MS;
    return input.liveSilenceMs >= silenceLimit;
}

/** Human-readable reason when `shouldEndMatch` is true — for debug / perf panel. */
export function describeEndMatchReason(input: EndMatchInput): string | null {
    if (!shouldEndMatch(input)) return null;
    if (isTerminalPhase(input.phase)) {
        return `terminal_phase:${input.phase ?? 'unknown'} held ${Math.round(input.phaseHeldMs / 1000)}s`;
    }
    if (isOutOfGamePhase(input.phase)) {
        return `menu_phase:${input.phase ?? 'unknown'} live_silent ${Math.round(input.liveSilenceMs / 1000)}s`;
    }
    return `live_silent ${Math.round(input.liveSilenceMs / 1000)}s phase=${input.phase ?? 'null'}`;
}
