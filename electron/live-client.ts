import axios from 'axios';
import https from 'https';

const LIVE_CLIENT_BASE = 'https://127.0.0.1:2999/liveclientdata';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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

export interface LiveClientAllGameData {
    activePlayer: LiveClientActivePlayer;
    allPlayers: LiveClientPlayer[];
    events?: { Events?: Array<{ EventName: string; EventID: number; EventTime: number }> };
    gameData: LiveClientGameData;
}

export interface LiveGameClock {
    gameTime: number;
    gameMode?: string;
}

/**
 * Full board. Timeout stays short so a stuck read cannot freeze the main
 * process; a miss is not "game over" — the caller falls back to the clock.
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
