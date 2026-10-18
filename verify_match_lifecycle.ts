/**
 * Match-lifetime stress test.
 *
 * Replays the overlay's end-of-game decision across full games, including the
 * 7-minute and 10-minute windows where a dropped client socket plus a slow
 * Live Client used to hide the HUD and leave it down.
 */
import {
    LIVE_SILENCE_END_MS,
    LIVE_SILENCE_MIDGAME_END_MS,
    OUT_OF_GAME_HOLD_MS,
    TERMINAL_PHASE_HOLD_MS,
    shouldEndMatch,
    type EndMatchInput,
} from './electron/match-lifecycle';

const TICK_MS = 2500;
const MATCH_MS = 40 * 60 * 1000;
const STRESS_GAMES = 300;

let failed = 0;

function check(name: string, condition: boolean): void {
    if (condition) return;
    failed += 1;
    console.error(`FAIL ${name}`);
}

function decide(input: EndMatchInput): boolean {
    return shouldEndMatch(input);
}

check(
    'four live misses with no phase do not end the match',
    decide({
        phase: null,
        liveSilenceMs: TICK_MS * 4,
        phaseHeldMs: TICK_MS * 4,
        liveGameTime: null,
        trustedGameTime: 7 * 60,
    }) === false
);

check(
    'InProgress never ends, even after minutes of live-client silence',
    decide({
        phase: 'InProgress',
        liveSilenceMs: 5 * 60 * 1000,
        phaseHeldMs: 5 * 60 * 1000,
        liveGameTime: null,
        trustedGameTime: 10 * 60,
    }) === false
);

check(
    'a terminal phase under the hold does not end the match',
    decide({
        phase: 'WaitingForStats',
        liveSilenceMs: TICK_MS,
        phaseHeldMs: TERMINAL_PHASE_HOLD_MS - 1,
        liveGameTime: null,
        trustedGameTime: 20 * 60,
    }) === false
);

check(
    'a terminal phase that sticks, with the clock stopped, ends the match',
    decide({
        phase: 'PreEndOfGame',
        liveSilenceMs: TERMINAL_PHASE_HOLD_MS,
        phaseHeldMs: TERMINAL_PHASE_HOLD_MS,
        liveGameTime: null,
        trustedGameTime: 20 * 60,
    }) === true
);

check(
    'a terminal label while the clock is still moving does not end the match',
    decide({
        phase: 'EndOfGame',
        liveSilenceMs: 0,
        phaseHeldMs: 30_000,
        liveGameTime: 600,
        trustedGameTime: 597,
    }) === false
);

check(
    'lobby ends only after the hold and a dead live client',
    decide({
        phase: 'Lobby',
        liveSilenceMs: OUT_OF_GAME_HOLD_MS - 1,
        phaseHeldMs: OUT_OF_GAME_HOLD_MS,
        liveGameTime: null,
        trustedGameTime: 25 * 60,
    }) === false &&
        decide({
            phase: 'Lobby',
            liveSilenceMs: OUT_OF_GAME_HOLD_MS,
            phaseHeldMs: OUT_OF_GAME_HOLD_MS,
            liveGameTime: null,
            trustedGameTime: 25 * 60,
        }) === true
);

check(
    'unknown phase early game ends after 60s with no live client',
    decide({
        phase: null,
        liveSilenceMs: LIVE_SILENCE_END_MS - 1,
        phaseHeldMs: LIVE_SILENCE_END_MS,
        liveGameTime: null,
        trustedGameTime: 4 * 60,
    }) === false &&
        decide({
            phase: null,
            liveSilenceMs: LIVE_SILENCE_END_MS,
            phaseHeldMs: LIVE_SILENCE_END_MS,
            liveGameTime: null,
            trustedGameTime: 4 * 60,
        }) === true
);

check(
    'unknown phase mid game tolerates 60s silence but ends after 3 minutes',
    decide({
        phase: null,
        liveSilenceMs: LIVE_SILENCE_END_MS + 1000,
        phaseHeldMs: LIVE_SILENCE_END_MS + 1000,
        liveGameTime: null,
        trustedGameTime: 12 * 60,
    }) === false &&
        decide({
            phase: null,
            liveSilenceMs: LIVE_SILENCE_MIDGAME_END_MS,
            phaseHeldMs: LIVE_SILENCE_MIDGAME_END_MS,
            liveGameTime: null,
            trustedGameTime: 12 * 60,
        }) === true
);

interface Sim {
    now: number;
    phase: string | null;
    phaseSince: number;
    trusted: number;
    lastProof: number;
    hasProof: boolean;
}

function createSim(): Sim {
    return { now: 0, phase: 'InProgress', phaseSince: 0, trusted: 0, lastProof: 0, hasProof: false };
}

/** Mirrors game-monitor: judge with the previous clock, then accept the new one. */
function step(sim: Sim, phase: string | null, liveGameTime: number | null): boolean {
    if (phase !== sim.phase) {
        sim.phase = phase;
        sim.phaseSince = sim.now;
    }
    const end = shouldEndMatch({
        phase,
        liveSilenceMs: sim.hasProof ? sim.now - sim.lastProof : 0,
        phaseHeldMs: sim.now - sim.phaseSince,
        liveGameTime,
        trustedGameTime: sim.trusted,
    });
    if (liveGameTime != null) {
        sim.hasProof = true;
        sim.lastProof = sim.now;
        if (liveGameTime > sim.trusted) sim.trusted = liveGameTime;
    }
    return end;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One full game. Socket drops at 7:00 and 10:00, and the live API fails most
 * of those windows plus a random slice of every other tick.
 */
function playGame(seed: number, stickyPhase: boolean): number | null {
    const rand = mulberry32(seed);
    const sim = createSim();
    for (let now = 0; now <= MATCH_MS; now += TICK_MS) {
        sim.now = now;
        const minute = now / 60000;
        const danger =
            (minute >= 7 && minute < 7.5) || (minute >= 10 && minute < 10.75);
        const dropSocket = danger && !stickyPhase;
        const phase = dropSocket ? null : 'InProgress';
        const failRate = danger ? 0.8 : 0.12;
        const silence = sim.hasProof ? now - sim.lastProof : 0;
        // A 60s blackout is a closed game and is covered by the unit checks.
        // These games are the mid-match hitch: the API keeps missing, then answers.
        const live = silence >= 50_000 || rand() >= failRate ? now / 1000 : null;
        if (step(sim, phase, live)) return now;
    }
    return null;
}

for (let game = 0; game < STRESS_GAMES; game += 1) {
    const diedSticky = playGame(0x1a2b3c00 + game, true);
    const diedDropped = playGame(0x9f00e100 + game, false);
    if (diedSticky != null) {
        failed += 1;
        console.error(`FAIL sticky game ${game} ended at ${Math.round(diedSticky / 1000)}s`);
    }
    if (diedDropped != null) {
        failed += 1;
        console.error(`FAIL dropped-socket game ${game} ended at ${Math.round(diedDropped / 1000)}s`);
    }
}

function playScript(name: string, frames: Array<{ ms: number; phase: string | null; live: number | null }>, expectEnd: boolean): void {
    const sim = createSim();
    let endedAt: number | null = null;
    for (const frame of frames) {
        sim.now = frame.ms;
        if (step(sim, frame.phase, frame.live)) {
            endedAt = frame.ms;
            break;
        }
    }
    check(`${name} ${expectEnd ? 'ends' : 'stays up'}`, expectEnd ? endedAt != null : endedAt == null);
}

const falseTerminal: Array<{ ms: number; phase: string | null; live: number | null }> = [];
for (let ms = 0; ms <= 20_000; ms += TICK_MS) {
    falseTerminal.push({
        ms,
        phase: ms >= 5_000 ? 'WaitingForStats' : 'InProgress',
        live: ms / 1000,
    });
}
playScript('false WaitingForStats with a moving clock', falseTerminal, false);

const realEnd: Array<{ ms: number; phase: string | null; live: number | null }> = [
    { ms: 0, phase: 'InProgress', live: 1800 },
];
const terminalAt = TICK_MS;
for (let ms = terminalAt; ms <= terminalAt + TERMINAL_PHASE_HOLD_MS + TICK_MS; ms += TICK_MS) {
    realEnd.push({ ms, phase: 'WaitingForStats', live: null });
}
playScript('real post-game phase', realEnd, true);

const longHitch: Array<{ ms: number; phase: string | null; live: number | null }> = [
    { ms: 0, phase: 'InProgress', live: 600 },
];
for (let ms = TICK_MS; ms <= 45_000; ms += TICK_MS) {
    longHitch.push({ ms, phase: 'InProgress', live: null });
}
playScript('45s live outage while InProgress', longHitch, false);

const minuteTen: Array<{ ms: number; phase: string | null; live: number | null }> = [
    { ms: 0, phase: 'InProgress', live: 600 },
];
for (let ms = TICK_MS; ms <= 30_000; ms += TICK_MS) {
    minuteTen.push({ ms, phase: null, live: null });
}
playScript('30s socket drop and live outage around 10:00', minuteTen, false);

console.log(
    `Match lifecycle: ${STRESS_GAMES * 2} full games, plus the 7:00 / 10:00 outage cases.`
);
if (failed > 0) {
    console.error(`${failed} match lifecycle check(s) failed.`);
    process.exit(1);
}
console.log('Match lifecycle ok.');
