import axios from 'axios';
import https from 'https';

const LIVE_CLIENT_BASE = 'https://127.0.0.1:2999/liveclientdata';

// Reuse one socket pool. A fresh TLS handshake to 127.0.0.1:2999 on every
// 400 ms sample (events + active player + stats) stalls both this process and
// League's Live Client thread. Same reason the LCU agent stays keep-alive.
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    maxSockets: 4,
    keepAliveMsecs: 15_000,
});

export interface LiveClientItem {
    itemID: number;
    displayName: string;
    count: number;
    slot: number;
}

export interface LiveClientPlayer {
    championName: string;
    isBot: boolean;
    isDead: boolean;
    items: LiveClientItem[];
    level: number;
    position: string;
    rawChampionName?: string;
    respawnTimer: number;
    scores?: {
        assists: number;
        creepScore: number;
        deaths: number;
        kills: number;
        wardScore: number;
    };
    summonerName: string;
    riotId?: string;
    riotIdGameName?: string;
    riotIdTagLine?: string;
    team: 'ORDER' | 'CHAOS' | string;
    summonerSpells?: {
        summonerSpellOne?: { displayName: string };
        summonerSpellTwo?: { displayName: string };
    };
}

export interface LiveClientActivePlayer {
    level: number;
    currentGold: number;
    championStats?: Record<string, number>;
    summonerName: string;
    riotId?: string;
    riotIdGameName?: string;
    abilities?: Record<string, { abilityLevel?: number; displayName?: string }>;
}

export interface LiveClientGameData {
    gameMode: string;
    gameTime: number;
    mapName: string;
    mapNumber: number;
    mapTerrain?: string;
}

/** One raw row from `/eventdata`. Only EventID is trusted to be present. */
export interface LiveClientRawEvent {
    EventID: number;
    EventName: string;
    EventTime: number;
    [key: string]: unknown;
}

export interface LiveClientEventData {
    Events?: LiveClientRawEvent[];
}

export interface LiveClientAllGameData {
    activePlayer: LiveClientActivePlayer;
    allPlayers: LiveClientPlayer[];
    events?: LiveClientEventData;
    gameData: LiveClientGameData;
}

export interface LiveGameClock {
    gameTime: number;
    gameMode?: string;
}

/**
 * Full board in one request — **debug/diagnostic only.**
 *
 * Do not poll this: the payload is hundreds of KB in a live game. The State
 * Service (electron/state-service.ts) polls the granular endpoints
 * (`/eventdata`, `/activeplayer`, `/playerlist`, `/gamestats`) instead, which is
 * both smaller and faster. Kept because the dashboard's
 * `live-client-data` IPC handler is a useful one-shot inspection surface.
 *
 * Timeout stays short so a stuck read cannot freeze the main process; a miss is
 * not "game over" — the caller falls back to the clock.
 */
export async function fetchLiveClientData(): Promise<LiveClientAllGameData | null> {
    try {
        const response = await axios.get(`${LIVE_CLIENT_BASE}/allgamedata`, {
            httpsAgent,
            timeout: 2200,
            validateStatus: (status) => status < 500,
        });

        if (response.status === 404 || !response.data) {
            return null;
        }

        return response.data as LiveClientAllGameData;
    } catch {
        // Game client busy, or not in an active match. Caller probes the clock next.
        return null;
    }
}

/* ------------------------------------------------------------------ *
 * Granular endpoints — the State Service's read path.
 *
 * Each returns null on connection refused / 404 / timeout. "Not in game" is a
 * normal state (lobby, loading screen, or the game just ended), not an error.
 * Localhost only, self-signed cert, same agent as above.
 * ------------------------------------------------------------------ */

async function getJson<T>(path: string, timeout: number): Promise<T | null> {
    try {
        const response = await axios.get(`${LIVE_CLIENT_BASE}${path}`, {
            httpsAgent,
            timeout,
            validateStatus: (status) => status < 500,
        });
        if (response.status !== 200 || response.data === undefined || response.data === null) return null;
        return response.data as T;
    } catch {
        return null;
    }
}

/** Small and changes on every kill — polled fastest. */
export function fetchEventData(timeout = 1200): Promise<LiveClientEventData | null> {
    return getJson<LiveClientEventData>('/eventdata', timeout);
}

/** Self gold / level / champion stats — exact numbers, so vision must never guess them. */
export function fetchActivePlayer(timeout = 1200): Promise<LiveClientActivePlayer | null> {
    return getJson<LiveClientActivePlayer>('/activeplayer', timeout);
}

/** Ability levels for the local player. Changes rarely; polled slower. */
export function fetchActivePlayerAbilities(
    timeout = 1200
): Promise<Record<string, { abilityLevel?: number; displayName?: string }> | null> {
    return getJson<Record<string, { abilityLevel?: number; displayName?: string }>>(
        '/activeplayerabilities',
        timeout
    );
}

/** All 10 players: K/D/A, CS, items, levels, death state. The biggest payload. */
export function fetchPlayerList(timeout = 1500): Promise<LiveClientPlayer[] | null> {
    return getJson<LiveClientPlayer[]>('/playerlist', timeout);
}

/**
 * Full `gamestats` block: game clock plus mode/map identity. This is the State
 * Service's liveness proof — it answers if and only if a game is running.
 */
export function fetchGameStats(timeout = 1200): Promise<LiveClientGameData | null> {
    return getJson<LiveClientGameData>('/gamestats', timeout);
}

/**
 * Cheap liveness read. allgamedata is large and times out in fights; gamestats
 * is enough to prove the match is still running and to keep the HUD clock honest.
 */
export async function fetchLiveGameClock(): Promise<LiveGameClock | null> {
    try {
        const response = await axios.get(`${LIVE_CLIENT_BASE}/gamestats`, {
            httpsAgent,
            timeout: 1000,
            validateStatus: (status) => status < 500,
        });
        if (response.status !== 200 || !response.data || typeof response.data !== 'object') return null;
        const body = response.data as { gameTime?: unknown; gameMode?: unknown };
        const gameTime = typeof body.gameTime === 'number' ? body.gameTime : Number(body.gameTime);
        if (!Number.isFinite(gameTime) || gameTime < 0) return null;
        return {
            gameTime,
            gameMode: typeof body.gameMode === 'string' ? body.gameMode : undefined,
        };
    } catch {
        return null;
    }
}

export async function isLiveClientAvailable(): Promise<boolean> {
    try {
        const response = await axios.get(`${LIVE_CLIENT_BASE}/gamestats`, {
            httpsAgent,
            timeout: 1000,
            validateStatus: (status) => status < 500,
        });
        return response.status === 200 && !!response.data;
    } catch {
        return false;
    }
}

export function findLocalPlayer(data: LiveClientAllGameData): LiveClientPlayer | null {
    const { activePlayer, allPlayers } = data;
    if (!allPlayers?.length) return null;

    const activeName = activePlayer?.summonerName;
    const activeRiotId = activePlayer?.riotId;
    const activeGameName = activePlayer?.riotIdGameName;

    const match = allPlayers.find((p) => {
        if (activeRiotId && p.riotId === activeRiotId) return true;
        if (activeGameName && p.riotIdGameName === activeGameName) return true;
        if (activeName && p.summonerName === activeName) return true;
        return false;
    });

    return match || allPlayers[0] || null;
}
