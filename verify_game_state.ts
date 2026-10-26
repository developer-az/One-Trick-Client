/**
 * Phase 1 acceptance — Live Client Data API: ground truth, zero vision.
 *
 * Two halves:
 *
 * 1. Fixture tests (always run): the event cursor, objective timers, player/self
 *    derivation and the engine's exactly-once event bus. These are the real
 *    proof of "exactly one ChampionKill event per kill" — they do not need a
 *    running game.
 *
 * 2. Live harness (`OT_LIVE_STATE=1`): drives the same engine against the real
 *    Live Client API and prints every event as it lands, so the Practice Tool
 *    acceptance can be run from a terminal with no Electron build.
 *
 * Run:
 *   npm run verify:game-state
 *   $env:OT_LIVE_STATE=1; $env:OT_LIVE_STATE_SEC=45; npm run verify:game-state
 */

import https from 'node:https';
import {
    buildGameState,
    deriveObjectiveTimers,
    derivePlayerSnapshots,
    deriveSelfState,
    diffNewEvents,
    objectiveKeyForEvent,
    toGameEvent,
    type LivePlayerLike,
    type LiveRawEventLike,
} from './src/logic/gameState';
import { EVENT_RING, createStateEngine, mergeLiveBoard, type LiveBoardParts } from './src/logic/stateEngine';

const ok = (c: boolean, m: string) => {
    if (!c) {
        console.error('FAIL', m);
        process.exitCode = 1;
    } else console.log('ok', m);
};

const LIVE_CLIENT_BASE = 'https://127.0.0.1:2999/liveclientdata';
const agent = new https.Agent({ rejectUnauthorized: false });

/* ------------------------------------------------------------------ *
 * 1. Event cursor — the "exactly once" guarantee
 * ------------------------------------------------------------------ */

const ev = (EventID: number, EventName: string, EventTime: number, extra: Record<string, unknown> = {}): LiveRawEventLike => ({
    EventID,
    EventName,
    EventTime,
    ...extra,
});

const killEvents = [
    ev(1, 'GameStart', 0.05),
    ev(2, 'ChampionKill', 120, { KillerName: 'Pyke', VictimName: 'Jinx' }),
    ev(3, 'ChampionKill', 300, { KillerName: 'Pyke', VictimName: 'Thresh' }),
];

const first = diffNewEvents(0, killEvents);
ok(first.events.length === 3, `first poll emits all 3 events (got ${first.events.length})`);
ok(first.maxEventId === 3, `cursor advances to 3 (got ${first.maxEventId})`);
ok(!first.restarted, 'first poll is not a restart');

const second = diffNewEvents(first.maxEventId, killEvents);
ok(second.events.length === 0, 're-polling the same payload emits nothing (exactly once)');

const withNew = diffNewEvents(first.maxEventId, [...killEvents, ev(4, 'DragonKill', 420, { DragonType: 'Fire', KillerName: 'Pyke' })]);
ok(withNew.events.length === 1 && withNew.events[0].id === 4, 'only the new event is emitted');
ok(withNew.events[0].name === 'DragonKill', 'new event keeps its name');

const scrambled = diffNewEvents(0, [ev(3, 'A', 10), ev(1, 'A', 1), ev(2, 'A', 5)]);
ok(
    scrambled.events.map((e) => e.id).join(',') === '1,2,3',
    `out-of-order payload is sorted ascending (got ${scrambled.events.map((e) => e.id).join(',')})`
);

// New game: EventIDs restart at 0. The cursor must drop, not replay.
const restarted = diffNewEvents(9, [ev(1, 'GameStart', 0.05), ev(2, 'ChampionKill', 30)]);
ok(restarted.restarted, 'lower EventIDs are detected as a new match');
ok(restarted.events.length === 0, 'a restarted match does not replay old events as new');
ok(restarted.maxEventId === 2, 'a restarted match re-seeds the cursor');

const empty = diffNewEvents(7, undefined);
ok(empty.events.length === 0 && empty.maxEventId === 7, 'a payload with no events leaves the cursor alone');

const dupes = diffNewEvents(0, [ev(2, 'X', 1), ev(2, 'X', 1)]);
ok(dupes.events.length === 1 || dupes.maxEventId === 2, 'duplicate ids in one payload stay one cursor value');

const parsed = toGameEvent(ev(5, 'ChampionKill', 90, { KillerName: 'Pyke', KillStreak: 2 }));
ok(!!parsed && parsed.id === 5 && parsed.name === 'ChampionKill' && parsed.gameTime === 90, 'toGameEvent normalises the row');
ok(!!parsed && (parsed.raw as Record<string, unknown>).KillerName === 'Pyke', 'toGameEvent keeps the raw payload');
ok(!!parsed && !('EventID' in parsed.raw), 'toGameEvent strips the reserved keys out of raw');
ok(toGameEvent({ EventName: 'NoId' } as LiveRawEventLike) === null, 'a row with no EventID is dropped');

/* ------------------------------------------------------------------ *
 * 2. Objective timers
 * ------------------------------------------------------------------ */

const events = [
    toGameEvent(ev(2, 'ChampionKill', 120)),
    toGameEvent(ev(4, 'DragonKill', 600, { DragonType: 'Fire', KillerName: 'Pyke', Stolen: 'False' })),
    toGameEvent(ev(6, 'TurretKilled', 700, { TurretKilled: 'Turret_T1_C_01_A', KillerName: 'Pyke' })),
    toGameEvent(ev(8, 'BaronKill', 1200, { KillerName: 'Pyke' })),
].filter((e): e is NonNullable<typeof e> => !!e);

const timers = deriveObjectiveTimers(events, 700);
ok(!!timers.dragon && timers.dragon.nextSpawnAt === 900, `dragon respawns 300s after the kill (got ${timers.dragon?.nextSpawnAt})`);
ok(!!timers.dragon && timers.dragon.inSec === 200, `dragon countdown is gameTime-aware (got ${timers.dragon?.inSec})`);
ok(!!timers.baron && timers.baron.nextSpawnAt === 1560, `baron respawns 360s after the kill (got ${timers.baron?.nextSpawnAt})`);
ok(timers.herald === null, 'herald timer stays null when herald has not been killed');
ok(!!timers.dragon && timers.dragon.stolen === false, 'Stolen:"False" is read as false');
ok(!!timers.baron && timers.baron.killerName === 'Pyke', 'timer keeps the killer name');

const twoDragons = deriveObjectiveTimers(
    [toGameEvent(ev(1, 'DragonKill', 600)), toGameEvent(ev(2, 'DragonKill', 900))].filter((e): e is NonNullable<typeof e> => !!e),
    950
);
ok(!!twoDragons.dragon && twoDragons.dragon.killedAt === 900, 'the most recent dragon kill wins the timer');
ok(!!twoDragons.dragon && twoDragons.dragon.inSec === 250, `dragon countdown restarts off the second kill (got ${twoDragons.dragon?.inSec})`);

const stolen = deriveObjectiveTimers(
    [toGameEvent(ev(3, 'BaronKill', 1500, { Stolen: 'True' }))].filter((e): e is NonNullable<typeof e> => !!e),
    1500
);
ok(!!stolen.baron && stolen.baron.stolen === true, 'Stolen:"True" is read as true');

const epic = deriveObjectiveTimers(
    [
        toGameEvent(ev(1, 'EpicMonsterKill', 800, { MonsterType: 'Dragon', DragonType: 'Air' })),
        toGameEvent(ev(2, 'EpicMonsterKill', 900, { MonsterType: 'Herald' })),
    ].filter((e): e is NonNullable<typeof e> => !!e),
    900
);
ok(!!epic.dragon && epic.dragon.nextSpawnAt === 1100, 'EpicMonsterKill(Dragon) maps to the dragon timer');
ok(!!epic.herald && epic.herald.nextSpawnAt === 1260, 'EpicMonsterKill(Herald) maps to the herald timer');

ok(objectiveKeyForEvent(toGameEvent(ev(1, 'ChampionKill', 5))!) === null, 'a champion kill is not an objective');
ok(deriveObjectiveTimers([], 0).dragon === null, 'no objective events → no timers');

/* ------------------------------------------------------------------ *
 * 3. Players and self
 * ------------------------------------------------------------------ */

const TEAM: LivePlayerLike[] = [
    { riotId: 'Blue#1', championName: 'Pyke', team: 'ORDER', level: 6, isDead: false, respawnTimer: 0, scores: { kills: 2, deaths: 1, assists: 5, creepScore: 41 }, items: [{ itemID: 3865 }, { itemID: 2031 }] },
    { riotId: 'Blue#2', championName: 'Jinx', team: 'ORDER', level: 7, scores: { kills: 4, deaths: 0, assists: 2, creepScore: 120 } },
    { riotId: 'Red#1', championName: 'Thresh', team: 'CHAOS', level: 5, isDead: true, respawnTimer: 12, scores: { kills: 0, deaths: 3, assists: 1, creepScore: 20 } },
    { riotId: 'Red#2', championName: 'Yasuo', team: 'CHAOS', level: 6, scores: { kills: 1, deaths: 2, assists: 0, creepScore: 90 }, items: [{ itemId: 6672 }] },
];

const activePlayer = { riotId: 'Blue#1', level: 6, currentGold: 1234, summonerName: 'Blue' };
const snapshots = derivePlayerSnapshots(TEAM, activePlayer);
ok(snapshots.length === 4, `one snapshot per player row (got ${snapshots.length})`);
ok(snapshots.filter((p) => p.isSelf).length === 1, 'exactly one player is flagged as self');
ok(snapshots[0].isSelf, 'self is matched by riotId, not by position');
ok(snapshots[2].isSelf === false, 'an enemy is never flagged as self');
ok(snapshots[0].team === 'ORDER' && snapshots[2].team === 'CHAOS', 'teams map to ORDER/CHAOS');
ok(snapshots[0].items.join(',') === '3865,2031', `items map to numeric ids (got ${snapshots[0].items.join(',')})`);
ok(snapshots[3].items.join(',') === '6672', 'the alternate itemId key is also mapped');
ok(snapshots[2].isDead && snapshots[2].respawnTimer === 12, 'death state and respawn timer carry through');
ok(snapshots[0].kills === 2 && snapshots[0].deaths === 1 && snapshots[0].assists === 5, 'K/D/A carries through');
ok(snapshots[0].cs === 41, 'CS carries through');
ok(snapshots[0].riotId === 'Blue#1', 'riotId is preserved');

const noIdMatch = derivePlayerSnapshots(TEAM, { summonerName: 'Nobody#NONE' });
ok(noIdMatch[0].isSelf, 'with no identity match the documented first row is self');
ok(noIdMatch.filter((p) => p.isSelf).length === 1, 'the fallback still yields exactly one self');

const selfState = deriveSelfState(
    TEAM[0],
    { ...activePlayer, championStats: { currentHealth: 500, maxHealth: 1000, resourceValue: 100, resourceMax: 400 } },
    true
);
ok(selfState.hpPct === 0.5, `hpPct comes from championStats (got ${selfState.hpPct})`);
ok(selfState.manaPct === 0.25, `manaPct comes from resourceValue/resourceMax (got ${selfState.manaPct})`);
ok(selfState.currentGold === 1234, 'currentGold comes from activeplayer');
ok(selfState.cs === 41, 'self CS comes from the player row');
ok(selfState.champion === 'Pyke' && selfState.level === 6, 'self identity carries through');

const legacyMana = deriveSelfState(TEAM[0], { championStats: { currentHealth: 1, maxHealth: 4, currentMana: 30, maxMana: 60 } }, true);
ok(legacyMana.manaPct === 0.5, 'the legacy currentMana/maxMana field names still work');

const noStats = deriveSelfState(TEAM[0], activePlayer, true);
ok(noStats.hpPct === null && noStats.currentGold === null, 'missing championStats reports null, never a guessed number');
ok(noStats.champion === 'Pyke', 'missing championStats still keeps the champion identity');

const zeroMax = deriveSelfState(TEAM[0], { championStats: { currentHealth: 10, maxHealth: 0 } }, true);
ok(zeroMax.hpPct === null, 'a zero max health cannot produce Infinity');

/* ------------------------------------------------------------------ *
 * 4. GameState assembly and the endpoint merge
 * ------------------------------------------------------------------ */

const assembled = buildGameState({
    board: { activePlayer, allPlayers: TEAM, events: { Events: killEvents }, gameData: { gameTime: 412.5, gameMode: 'CLASSIC' } },
    events,
    ts: 1000,
});
ok(assembled.inGame, 'an assembled state reports inGame');
ok(assembled.gameTime === 412.5, `gameTime comes from gamestats (got ${assembled.gameTime})`);
ok(assembled.minimap === null, 'minimap stays null — vision only, per the contract');
ok(assembled.lastEvent?.id === 8, `lastEvent is the highest EventID (got ${assembled.lastEvent?.id})`);
ok(assembled.self.champion === 'Pyke', 'assembled self identity is correct');

ok(mergeLiveBoard({ events: null, activePlayer: null, players: null, gameData: null }) === null, 'no gamestats → not in game → no board');

const merged = mergeLiveBoard({
    events: { Events: killEvents },
    activePlayer,
    players: TEAM,
    gameData: { gameTime: 300, gameMode: 'CLASSIC' },
    abilities: { Q: { abilityLevel: 3 } },
});
ok(!!merged && merged.allPlayers?.length === 4, 'the merge carries the player rows through');
ok(!!merged && merged.events?.Events?.length === 3, 'the merge carries the events through');
ok(!!merged && merged.gameData?.gameTime === 300, 'the merge carries gamestats through');
ok(!!merged && merged.activePlayer?.abilities?.Q?.abilityLevel === 3, 'the merge folds activeplayerabilities into the active player');

const partial = mergeLiveBoard({
    events: null,
    activePlayer: null,
    players: TEAM,
    gameData: { gameTime: 42 },
});
ok(!!partial && partial.allPlayers?.length === 4, 'a board missing events and activeplayer still yields player data');
ok(!!partial && partial.events?.Events === undefined, 'a missing eventdata block does not fabricate events');

/* ------------------------------------------------------------------ *
 * 5. Engine — the exactly-once bus, timers, snapshots, not-in-game
 * ------------------------------------------------------------------ */

async function engineTests(): Promise<void> {
    let payload: LiveBoardParts = {
        events: { Events: [ev(1, 'GameStart', 0.05), ev(2, 'ChampionKill', 120)] },
        activePlayer,
        players: TEAM,
        gameData: { gameTime: 130, gameMode: 'CLASSIC' },
    };
    let board: ReturnType<typeof mergeLiveBoard> = mergeLiveBoard(payload);

    const engine = createStateEngine({
        fetchBoard: async () => board,
        now: () => 1_000_000,
    });

    const seen: number[] = [];
    engine.onEvent((e) => seen.push(e.id));

    const poll1 = await engine.pollOnce();
    ok(poll1.ok && poll1.newEvents.length === 2, `poll 1 emits both events (got ${poll1.newEvents.length})`);
    ok(engine.status().inGame, 'engine reports inGame after a successful read');
    ok(engine.status().eventCursor === 2, 'the engine owns one cursor and advances it');
    ok(engine.snapshot().self.champion === 'Pyke', 'the engine exposes the assembled GameState');

    const poll2 = await engine.pollOnce();
    ok(poll2.newEvents.length === 0, 're-polling the same payload emits no events again');
    ok(seen.length === 2, `the event bus fired exactly twice for two events (got ${seen.length})`);

    payload = {
        ...payload,
        gameData: { gameTime: 420, gameMode: 'CLASSIC' },
        events: { Events: [...(payload.events?.Events || []), ev(3, 'DragonKill', 300)] },
    };
    board = mergeLiveBoard(payload);
    const poll3 = await engine.pollOnce();
    ok(poll3.newEvents.length === 1 && poll3.newEvents[0].id === 3, 'only the newly-arrived event is emitted');
    ok(seen.join(',') === '1,2,3', `events arrive once each, in order (got ${seen.join(',')})`);
    ok(engine.timers().dragon?.nextSpawnAt === 600, `the engine derives the dragon timer (got ${engine.timers().dragon?.nextSpawnAt})`);
    ok(engine.recentSnapshots().length >= 3, 'the engine keeps a rolling snapshot buffer for Phase 2');
    ok(engine.log().length > 0, 'the engine writes a debug log');
    ok(engine.log().some((l) => l.includes('ChampionKill')), 'the debug log records each event');

    // Three failed reads in a row = match over. A single blip must not do it.
    board = null;
    await engine.pollOnce();
    ok(engine.status().inGame, 'one dropped read does not end the match');
    await engine.pollOnce();
    ok(engine.status().inGame, 'two dropped reads do not end the match');
    await engine.pollOnce();
    ok(!engine.status().inGame, 'three dropped reads end the match');
    ok(engine.snapshot().lastEvent === null, 'match end clears the state');
    ok(engine.events().length === 0, 'match end clears the event list');
    ok(engine.timers().dragon === null, 'match end clears the objective timers');
    ok(engine.recentSnapshots().length === 0, 'match end clears the snapshot buffer');

    // A new match starts: cursor must re-seed without replaying.
    payload = {
        events: { Events: [ev(1, 'GameStart', 0.05)] },
        activePlayer,
        players: TEAM,
        gameData: { gameTime: 1, gameMode: 'CLASSIC' },
    };
    board = mergeLiveBoard(payload);
    const poll4 = await engine.pollOnce();
    ok(poll4.ok && engine.status().inGame, 'a new match flips the engine back to inGame');
    ok(poll4.newEvents.length === 1 && poll4.newEvents[0].name === 'GameStart', 'the new match emits its own GameStart once');

    ok(engine.status().pollCount === 7, `every poll is counted (got ${engine.status().pollCount})`);
    ok(engine.status().errorCount === 0, 'refused reads are "not in game", not errors');

    // An engine that throws must not break the loop.
    const throwing = createStateEngine({
        fetchBoard: async () => {
            throw new Error('boom');
        },
    });
    const bad = await throwing.pollOnce();
    ok(!bad.ok && throwing.status().errorCount === 1, 'a throwing fetcher is counted as an error, not a crash');
    ok(throwing.status().lastError === 'Error: boom', 'the error is kept for the debug log');

    const many: LiveRawEventLike[] = [ev(1, 'DragonKill', 300, { DragonType: 'Fire' })];
    for (let id = 2; id <= EVENT_RING + 80; id++) many.push(ev(id, 'ChampionKill', 300 + id));
    const manyBoard = mergeLiveBoard({
        events: { Events: many },
        activePlayer,
        players: TEAM,
        gameData: { gameTime: 900, gameMode: 'CLASSIC' },
    });
    const ring = createStateEngine({ fetchBoard: async () => manyBoard, now: () => 2_000_000 });
    await ring.pollOnce();
    ok(ring.events().length === EVENT_RING, `event ring stays at ${EVENT_RING} (got ${ring.events().length})`);
    ok(ring.events()[0].id > 1, 'the ring drops the oldest rows');
    ok(ring.timers().dragon?.killedAt === 300, 'the dragon timer survives after its event leaves the ring');
    ok(
        ring.events().every((event, index, list) => index === 0 || event.id >= list[index - 1].id),
        'the ring stays in id order without sorting the whole match'
    );
}

/* ------------------------------------------------------------------ *
 * 6. Live harness — Practice Tool acceptance, no Electron needed
 * ------------------------------------------------------------------ */

function getJson<T>(endpoint: string): Promise<T | null> {
    return new Promise((resolve) => {
        const req = https.get(`${LIVE_CLIENT_BASE}${endpoint}`, { agent, timeout: 1200 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body) as T);
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

async function liveHarness(): Promise<void> {
    const seconds = Number(process.env.OT_LIVE_STATE_SEC || 30);
    const engine = createStateEngine({
        fetchBoard: async () => {
            const [events, activePlayer, gameData, players] = await Promise.all([
                getJson<{ Events?: LiveRawEventLike[] }>('/eventdata'),
                getJson<Record<string, unknown>>('/activeplayer'),
                getJson<Record<string, unknown>>('/gamestats'),
                getJson<LivePlayerLike[]>('/playerlist'),
            ]);
            return mergeLiveBoard({ events, activePlayer, players, gameData });
        },
    });

    engine.onEvent((e) => {
        const raw = e.raw as Record<string, unknown>;
        console.log(
            `  EVENT #${e.id} ${e.name} at ${Math.floor(e.gameTime / 60)}:${String(Math.floor(e.gameTime % 60)).padStart(2, '0')}` +
                (raw.KillerName ? ` killer=${String(raw.KillerName)}` : '') +
                (raw.VictimName ? ` victim=${String(raw.VictimName)}` : '') +
                (raw.DragonType ? ` dragon=${String(raw.DragonType)}` : '') +
                (raw.Stolen ? ` stolen=${String(raw.Stolen)}` : '')
        );
    });

    console.log(`\nLive harness: reading ${LIVE_CLIENT_BASE} every 400ms for ${seconds}s`);
    console.log('Start a Practice Tool game, kill a dummy, take a dragon and a turret, then end the game.\n');

    let polls = 0;
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) {
        await engine.pollOnce();
        polls += 1;
        const status = engine.status();
        if (status.inGame && polls % 5 === 1) {
            const state = engine.snapshot();
            const timers = engine.timers();
            console.log(
                `  [${(state.gameTime / 60).toFixed(1)}m] self=${state.self.champion} lvl${state.self.level}` +
                    ` hp=${state.self.hpPct === null ? '?' : `${Math.round(state.self.hpPct * 100)}%`}` +
                    ` gold=${state.self.currentGold ?? '?'} cs=${state.self.cs ?? '?'} players=${state.players.length}` +
                    ` cursor=${status.eventCursor}` +
                    (timers.dragon ? ` dragon-in=${timers.dragon.inSec}s` : '') +
                    (timers.baron ? ` baron-in=${timers.baron.inSec}s` : '')
            );
        }
        await new Promise((r) => setTimeout(r, 400));
    }

    const status = engine.status();
    console.log(`\nLive harness done: ${polls} polls, inGame=${status.inGame}, cursor=${status.eventCursor}`);
    console.log('--- state log tail ---');
    for (const line of engine.log(40)) console.log(line);

    if (status.inGame) {
        const state = engine.snapshot();
        ok(state.players.length > 0, `live board has ${state.players.length} players`);
        ok(state.self.champion.length > 0, `live self champion detected: ${state.self.champion}`);
        ok(state.self.hpPct === null || (state.self.hpPct >= 0 && state.self.hpPct <= 1), 'live hpPct is within 0–1');
        ok(state.minimap === null, 'live state keeps minimap null in Phase 1 (no vision)');
    } else {
        console.log('not in a game at the end of the run — skipping live board assertions');
    }
}

void engineTests().then(async () => {
    if (process.env.OT_LIVE_STATE === '1') await liveHarness();
    else console.log('\nskip live harness (set OT_LIVE_STATE=1 with Practice Tool running to execute it)');
    if (!process.exitCode) console.log('verify:game-state ok');
});



