/**
 * The GameState contract.
 *
 * Every component downstream of the Live Client API reads these shapes; nothing
 * downstream touches pixels. Phase 1 fills everything here except `minimap`,
 * which is vision-only because the Live Client API exposes no positions.
 *
 * Deliberately Electron-free and IO-free: the Electron adapter
 * (`electron/state-service.ts`) injects the board, and `verify_game_state.ts`
 * unit-tests the derivations with fixtures. This mirrors the split already used
 * by `playMoments.ts` (minimal input types, no overlay/Electron imports).
 */

/** One Live Client event, normalised. `id` is the API's EventID — the dedupe key. */
export interface GameEvent {
    id: number;
    name: string;
    /** Seconds into the game (from the event's EventTime, not wall clock). */
    gameTime: number;
    raw: Record<string, unknown>;
}

export interface PlayerSnapshot {
    riotId: string;
    champion: string;
    team: 'ORDER' | 'CHAOS';
    isSelf: boolean;
    isDead: boolean;
    respawnTimer: number;
    level: number;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    items: number[];
}

export interface MinimapDetection {
    cls: string;
    /** Normalised to the minimap crop, 0–1. */
    x: number;
    y: number;
    conf: number;
}

export interface MinimapState {
    allyVisible: number;
    enemyVisible: number;
    detections: MinimapDetection[];
}

export interface SelfState {
    champion: string;
    level: number;
    hpPct: number | null;
    manaPct: number | null;
    currentGold: number | null;
    cs: number | null;
}

export interface GameState {
    ts: number;
    inGame: boolean;
    gameTime: number;
    self: SelfState;
    players: PlayerSnapshot[];
    /** Vision only — the API has no positions. Populated from Phase 3/5. */
    minimap: MinimapState | null;
    events: GameEvent[];
    lastEvent: GameEvent | null;
}


/* ------------------------------------------------------------------ *
 * Structural input shapes
 *
 * These intentionally mirror the subset of the Live Client payloads that the
 * derivations need. `electron/live-client.ts` types satisfy them structurally,
 * so the adapter passes its objects straight through without a mapping layer.
 * ------------------------------------------------------------------ */

export interface LiveItemLike {
    itemID?: number;
    itemId?: number;
    count?: number;
}

export interface LiveScoresLike {
    kills?: number;
    deaths?: number;
    assists?: number;
    creepScore?: number;
    wardScore?: number;
}

export interface LivePlayerLike {
    riotId?: string;
    riotIdGameName?: string;
    summonerName?: string;
    championName?: string;
    team?: string;
    isDead?: boolean;
    respawnTimer?: number;
    level?: number;
    scores?: LiveScoresLike;
    items?: LiveItemLike[];
}

export interface ChampionStatsLike {
    currentHealth?: number;
    maxHealth?: number;
    resourceValue?: number;
    resourceMax?: number;
    /** Older clients named the mana fields this way. */
    currentMana?: number;
    maxMana?: number;
    resourceType?: string | number;
    [key: string]: number | string | undefined;
}

export interface LiveActivePlayerLike {
    level?: number;
    currentGold?: number;
    summonerName?: string;
    riotId?: string;
    riotIdGameName?: string;
    championStats?: ChampionStatsLike;
    abilities?: Record<string, { abilityLevel?: number; displayName?: string }>;
}

export interface LiveRawEventLike {
    EventID?: number;
    EventName?: string;
    EventTime?: number;
    [key: string]: unknown;
}

export interface LiveGameDataLike {
    gameTime?: number;
    gameMode?: string;
    mapName?: string;
    mapNumber?: number;
    mapTerrain?: string;
}

export interface LiveBoardLike {
    activePlayer?: LiveActivePlayerLike;
    allPlayers?: LivePlayerLike[];
    events?: { Events?: LiveRawEventLike[] };
    gameData?: LiveGameDataLike;
}

export const EMPTY_SELF: SelfState = {
    champion: '',
    level: 0,
    hpPct: null,
    manaPct: null,
    currentGold: null,
    cs: null,
};

export function emptyGameState(ts = 0): GameState {
    return {
        ts,
        inGame: false,
        gameTime: 0,
        self: { ...EMPTY_SELF },
        players: [],
        minimap: null,
        events: [],
        lastEvent: null,
    };
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export function toGameEvent(raw: LiveRawEventLike): GameEvent | null {
    const id = asFiniteNumber(raw.EventID);
    if (id === null) return null;
    const t = asFiniteNumber(raw.EventTime);
    const rest: Record<string, unknown> = { ...raw };
    delete rest.EventID;
    delete rest.EventName;
    delete rest.EventTime;
    return {
        id,
        name: typeof raw.EventName === 'string' ? raw.EventName : '',
        gameTime: t === null ? 0 : t,
        raw: rest,
    };
}

export interface EventDiff {
    /** Events the caller has not seen, ascending by EventID. */
    events: GameEvent[];
    /** Cursor value to pass in next time. */
    maxEventId: number;
    /**
     * The API renumbers EventID from 0 each game, so a payload whose highest id
     * is below the cursor means a new match started. The cursor is dropped and
     * the payload is NOT replayed as fresh events.
     */
    restarted: boolean;
}

/**
 * Diff `eventdata.Events` against the highest EventID already consumed.
 * Pure: same inputs, same output, no cursor state held here.
 */
export function diffNewEvents(seenMaxEventId: number, rawEvents: LiveRawEventLike[] | undefined): EventDiff {
    const events = (rawEvents || [])
        .map(toGameEvent)
        .filter((e): e is GameEvent => !!e)
        .sort((a, b) => a.id - b.id);

    if (!events.length) {
        return { events: [], maxEventId: seenMaxEventId, restarted: false };
    }

    const highest = events[events.length - 1].id;
    if (highest < seenMaxEventId) {
        return { events: [], maxEventId: highest, restarted: true };
    }

    return {
        events: events.filter((e) => e.id > seenMaxEventId),
        maxEventId: highest > seenMaxEventId ? highest : seenMaxEventId,
        restarted: false,
    };
}

/* ------------------------------------------------------------------ *
 * Objective timers
 * ------------------------------------------------------------------ */

/** Respawn windows after a kill. Dragon 5 min, Baron and Herald 6 min. */
export const OBJECTIVE_RESPAWN_SEC = {
    dragon: 300,
    baron: 360,
    herald: 360,
} as const;

export type ObjectiveKey = keyof typeof OBJECTIVE_RESPAWN_SEC;

export interface ObjectiveTimer {
    key: ObjectiveKey;
    /** Seconds into the game the objective died. */
    killedAt: number;
    /** Seconds into the game it comes back. */
    nextSpawnAt: number;
    /** Seconds until spawn; negative once overdue. */
    inSec: number;
    killerName?: string;
    stolen: boolean;
}

export interface ObjectiveTimers {
    dragon: ObjectiveTimer | null;
    baron: ObjectiveTimer | null;
    herald: ObjectiveTimer | null;
}

export const EMPTY_TIMERS: ObjectiveTimers = { dragon: null, baron: null, herald: null };

function truthyFlag(value: unknown): boolean {
    return value === true || String(value).toLowerCase() === 'true';
}

/**
 * Which objective, if any, did this event kill?
 * Handles both the specific events and the newer `EpicMonsterKill` umbrella.
 */
export function objectiveKeyForEvent(event: GameEvent): ObjectiveKey | null {
    const raw = event.raw as Record<string, unknown>;
    const monster = String(raw.MonsterType ?? raw.monsterType ?? '').toLowerCase();
    const dragonType = String(raw.DragonType ?? '').toLowerCase();

    switch (event.name) {
        case 'DragonKill':
            return 'dragon';
        case 'BaronKill':
            return 'baron';
        case 'HeraldKill':
            return 'herald';
        case 'EpicMonsterKill':
            if (monster.includes('baron')) return 'baron';
            if (monster.includes('herald') || monster.includes('rift')) return 'herald';
            if (monster.includes('dragon') || dragonType) return 'dragon';
            return null;
        default:
            return null;
    }
}

/**
 * Fold objective kills into a spawn countdown. Later kills of the same objective
 * overwrite earlier ones; the newest event wins. Pure.
 */
export function deriveObjectiveTimers(events: GameEvent[], gameTime: number): ObjectiveTimers {
    const timers: ObjectiveTimers = { dragon: null, baron: null, herald: null };
    for (const event of events) {
        const key = objectiveKeyForEvent(event);
        if (!key) continue;
        const raw = event.raw as Record<string, unknown>;
        const killedAt = event.gameTime;
        const nextSpawnAt = killedAt + OBJECTIVE_RESPAWN_SEC[key];
        const existing = timers[key];
        if (existing && existing.killedAt > killedAt) continue;
        timers[key] = {
            key,
            killedAt,
            nextSpawnAt,
            inSec: Math.round(nextSpawnAt - gameTime),
            killerName: typeof raw.KillerName === 'string' ? raw.KillerName : undefined,
            stolen: truthyFlag(raw.Stolen),
        };
    }
    return timers;
}

/* ------------------------------------------------------------------ *
 * Players / self
 * ------------------------------------------------------------------ */

function asTeamSide(value: unknown): 'ORDER' | 'CHAOS' {
    return String(value).toUpperCase() === 'ORDER' ? 'ORDER' : 'CHAOS';
}

function riotIdOf(player: LivePlayerLike): string {
    if (player.riotId) return player.riotId;
    if (player.riotIdGameName) return player.riotIdGameName;
    return player.summonerName || '';
}

/** Does this player row belong to the local player? */
export function isSelfPlayer(player: LivePlayerLike, activePlayer: LiveActivePlayerLike | undefined): boolean {
    if (!player) return false;
    const activeRiotId = activePlayer?.riotId;
    if (activeRiotId && player.riotId === activeRiotId) return true;
    const activeGameName = activePlayer?.riotIdGameName;
    if (activeGameName && player.riotIdGameName === activeGameName) return true;
    const activeName = activePlayer?.summonerName;
    if (activeName && player.summonerName === activeName) return true;
    return false;
}

export function derivePlayerSnapshots(
    players: LivePlayerLike[] | undefined,
    activePlayer: LiveActivePlayerLike | undefined
): PlayerSnapshot[] {
    const list = players || [];
    // No reliable match on identity → fall back to the documented rule that
    // allPlayers[0] is the local player.
    const anyMatch = list.some((p) => isSelfPlayer(p, activePlayer));

    return list.map((player, index) => ({
        riotId: riotIdOf(player),
        champion: player.championName || '',
        team: asTeamSide(player.team),
        isSelf: anyMatch ? isSelfPlayer(player, activePlayer) : index === 0,
        isDead: !!player.isDead,
        respawnTimer: typeof player.respawnTimer === 'number' ? player.respawnTimer : 0,
        level: player.level || 0,
        kills: player.scores?.kills || 0,
        deaths: player.scores?.deaths || 0,
        assists: player.scores?.assists || 0,
        cs: player.scores?.creepScore || 0,
        items: (player.items || [])
            .map((item) => item.itemID ?? item.itemId ?? 0)
            .filter((id) => !!id),
    }));
}

function ratio(current: number | undefined, max: number | undefined): number | null {
    if (typeof current !== 'number' || typeof max !== 'number') return null;
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
    return Math.max(0, Math.min(1, current / max));
}

/**
 * Self HP/mana/gold come straight from `/activeplayer`. Per principle 2 the API
 * already has these exactly, so vision must never be used for them.
 */
export function deriveSelfState(
    selfPlayer: LivePlayerLike | undefined,
    activePlayer: LiveActivePlayerLike | undefined,
    acknowledgeMissing = false
): SelfState {
    if (!selfPlayer && !activePlayer) return { ...EMPTY_SELF };

    const stats = activePlayer?.championStats;
    const champion = selfPlayer?.championName || '';
    const gold = asFiniteNumber(activePlayer?.currentGold);

    if (!stats && acknowledgeMissing) {
        // Active player block missing mid-match: keep identity, admit the
        // numbers are unknown rather than inventing them.
        return {
            champion,
            level: selfPlayer?.level || activePlayer?.level || 0,
            hpPct: null,
            manaPct: null,
            currentGold: null,
            cs: selfPlayer?.scores?.creepScore ?? null,
        };
    }

    return {
        champion,
        level: selfPlayer?.level || activePlayer?.level || 0,
        hpPct: ratio(stats?.currentHealth, stats?.maxHealth),
        manaPct: ratio(stats?.resourceValue ?? stats?.currentMana, stats?.resourceMax ?? stats?.maxMana),
        currentGold: gold,
        cs: selfPlayer?.scores?.creepScore ?? null,
    };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

export interface BuildGameStateInput {
    board: LiveBoardLike;
    /** All events already consumed this match, ascending. */
    events: GameEvent[];
    ts: number;
    minimap?: MinimapState | null;
}

/** Assemble the contract from a merged board. Pure. */
export function buildGameState({ board, events, ts, minimap = null }: BuildGameStateInput): GameState {
    const activePlayer = board.activePlayer;
    const rows = board.allPlayers || [];
    const players = derivePlayerSnapshots(rows, activePlayer);
    const selfIndex = players.findIndex((p) => p.isSelf);
    const selfPlayerLike = selfIndex >= 0 ? rows[selfIndex] : undefined;
    const sorted = [...events].sort((a, b) => a.id - b.id);

    return {
        ts,
        inGame: true,
        gameTime: asFiniteNumber(board.gameData?.gameTime) ?? 0,
        self: deriveSelfState(selfPlayerLike, activePlayer, true),
        players,
        minimap,
        events: sorted,
        lastEvent: sorted.length ? sorted[sorted.length - 1] : null,
    };
}


function asFiniteNumber(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
