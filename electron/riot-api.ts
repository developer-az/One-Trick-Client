/**
 * Riot API with a personal key: identity, level, ranked entries, recent matches.
 *
 * - The key is stored encrypted (Electron safeStorage = Windows DPAPI) in
 *   userData/riot-key.bin. It is only ever sent as the X-Riot-Token header and
 *   never appears in errors, logs or URLs.
 * - A key dropped into userData/riot-api-key.txt is imported once and the file
 *   is emptied.
 * - Identity comes from the League client (puuid + Riot ID + region) when it is
 *   connected, else the last one seen. No key -> the UI says it uses the client only.
 * - Personal-key limits: 20 req/s and 100 req/2 min per region. Calls are
 *   rate-limited and cached hard (memory + disk).
 * D1: only tier/LP/game counts are surfaced, never a win rate.
 */
import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';
import { userDataDir } from './paths';

export interface RiotRoute {
    platform: string;
    regional: 'americas' | 'europe' | 'asia' | 'sea';
}

/** LCU `/riotclient/region-locale` region → API hosts. */
const ROUTES: Record<string, RiotRoute> = {
    NA: { platform: 'na1', regional: 'americas' },
    BR: { platform: 'br1', regional: 'americas' },
    LAN: { platform: 'la1', regional: 'americas' },
    LA1: { platform: 'la1', regional: 'americas' },
    LAS: { platform: 'la2', regional: 'americas' },
    LA2: { platform: 'la2', regional: 'americas' },
    EUW: { platform: 'euw1', regional: 'europe' },
    EUNE: { platform: 'eun1', regional: 'europe' },
    EUN: { platform: 'eun1', regional: 'europe' },
    TR: { platform: 'tr1', regional: 'europe' },
    RU: { platform: 'ru', regional: 'europe' },
    ME: { platform: 'me1', regional: 'europe' },
    KR: { platform: 'kr', regional: 'asia' },
    JP: { platform: 'jp1', regional: 'asia' },
    OCE: { platform: 'oc1', regional: 'sea' },
    OC1: { platform: 'oc1', regional: 'sea' },
    PH: { platform: 'ph2', regional: 'sea' },
    SG: { platform: 'sg2', regional: 'sea' },
    TH: { platform: 'th2', regional: 'sea' },
    TW: { platform: 'tw2', regional: 'sea' },
    VN: { platform: 'vn2', regional: 'sea' },
};

export function routeForRegion(region: string | null | undefined): RiotRoute | null {
    return ROUTES[(region || '').trim().toUpperCase()] ?? null;
}

export const isRiotKey = (k: string): boolean => /^RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k.trim());

// ---- Rate limiting -------------------------------------------------------

/** Sliding windows: [limit, windowMs]. Returns ms to wait before the next call (0 = go now). */
export class RateLimiter {
    private stamps: number[] = [];
    constructor(private readonly windows: Array<[number, number]>) {}
    waitMs(now: number): number {
        const longest = Math.max(...this.windows.map(([, w]) => w));
        this.stamps = this.stamps.filter((t) => now - t < longest);
        let wait = 0;
        for (const [limit, windowMs] of this.windows) {
            const inWindow = this.stamps.filter((t) => now - t < windowMs);
            if (inWindow.length >= limit) wait = Math.max(wait, inWindow[inWindow.length - limit] + windowMs - now);
        }
        return wait;
    }
    take(now: number): void {
        this.stamps.push(now);
    }
}

// Slightly under the personal-key limits (20/1 s, 100/120 s), per routing host.
const limiters = new Map<string, RateLimiter>();
const limiterFor = (host: string): RateLimiter => {
    let l = limiters.get(host);
    if (!l) limiters.set(host, (l = new RateLimiter([[18, 1_000], [95, 120_000]])));
    return l;
};

// ---- Key storage ---------------------------------------------------------

const keyFile = (): string => path.join(userDataDir(), 'riot-key.bin');
const dropFile = (): string => path.join(userDataDir(), 'riot-api-key.txt');

function saveKey(key: string): void {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the key was not saved.');
    fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
    fs.writeFileSync(keyFile(), safeStorage.encryptString(key.trim()));
}

/** Import a key pasted into riot-api-key.txt, then empty that file. */
function importDroppedKey(): void {
    try {
        const raw = fs.readFileSync(dropFile(), 'utf8').trim();
        if (!raw || !isRiotKey(raw)) return;
        saveKey(raw);
        fs.writeFileSync(dropFile(), '');
    } catch {
        /* no drop file */
    }
}

function loadKey(): string | null {
    importDroppedKey();
    try {
        if (!safeStorage?.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(fs.readFileSync(keyFile())).trim() || null;
    } catch {
        return null;
    }
}

export function setRiotKey(key: string): { ok: boolean; error?: string } {
    if (!isRiotKey(key)) return { ok: false, error: 'That does not look like a Riot key (RGAPI-…).' };
    try {
        saveKey(key);
        cache.clear();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Could not save the key.' };
    }
}

export function clearRiotKey(): void {
    try {
        fs.rmSync(keyFile(), { force: true });
    } catch {
        /* ignore */
    }
    cache.clear();
}

// ---- Identity ------------------------------------------------------------

export interface RiotIdentity {
    puuid: string | null;
    gameName: string | null;
    tagLine: string | null;
    region: string | null;
}

const identityFile = (): string => path.join(userDataDir(), 'riot-identity.json');

/** Remember the last identity the client reported, so the API works with the client closed. */
export function rememberIdentity(next: RiotIdentity): RiotIdentity {
    const prev = readIdentity();
    const merged: RiotIdentity = {
        puuid: next.puuid || (next.gameName && next.gameName !== prev.gameName ? null : prev.puuid),
        gameName: next.gameName || prev.gameName,
        tagLine: next.tagLine || prev.tagLine,
        region: next.region || prev.region,
    };
    try {
        fs.mkdirSync(path.dirname(identityFile()), { recursive: true });
        fs.writeFileSync(identityFile(), JSON.stringify(merged));
    } catch {
        /* best effort */
    }
    return merged;
}

function readIdentity(): RiotIdentity {
    try {
        return { puuid: null, gameName: null, tagLine: null, region: null, ...JSON.parse(fs.readFileSync(identityFile(), 'utf8')) };
    } catch {
        return { puuid: null, gameName: null, tagLine: null, region: null };
    }
}

// ---- HTTP + cache --------------------------------------------------------

class RiotHttpError extends Error {
    constructor(readonly status: number, where: string) {
        super(`Riot API ${status} (${where})`);
    }
}

const cache = new Map<string, { at: number; data: unknown }>();
const cacheFile = (): string => path.join(userDataDir(), 'riot-cache.json');
let cacheLoaded = false;

function loadCache(): void {
    if (cacheLoaded) return;
    cacheLoaded = true;
    try {
        for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, { at: number; data: unknown }>)) cache.set(k, v);
    } catch {
        /* empty */
    }
}

function persistCache(): void {
    try {
        fs.writeFileSync(cacheFile(), JSON.stringify(Object.fromEntries(cache)));
    } catch {
        /* best effort */
    }
}

async function riotGet<T>(
    host: string,
    apiPath: string,
    key: string,
    ttlMs: number,
    reduce: (raw: unknown) => T = (raw) => raw as T
): Promise<T> {
    loadCache();
    const id = `${host}${apiPath}`;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
    const limiter = limiterFor(host);
    for (let wait = limiter.waitMs(Date.now()); wait > 0; wait = limiter.waitMs(Date.now())) {
        if (wait > 5_000 && hit) return hit.data as T; // over budget: stale beats waiting
        await new Promise((r) => setTimeout(r, wait));
    }
    limiter.take(Date.now());
    const res = await fetch(`https://${host}.api.riotgames.com${apiPath}`, {
        headers: { 'X-Riot-Token': key },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        if (hit && res.status >= 429) return hit.data as T;
        // The path names the endpoint only; the key is never in it.
        throw new RiotHttpError(res.status, apiPath.split('/').slice(0, 5).join('/'));
    }
    // Only the reduced shape is cached, so big payloads (match-v5) stay small on disk.
    const data = reduce(await res.json());
    cache.set(id, { at: Date.now(), data });
    persistCache();
    return data;
}

// ---- Status --------------------------------------------------------------

export interface RiotRank {
    queue: string;
    tier: string;
    rank: string;
    lp: number;
    games: number;
}

export interface RiotMatch {
    id: string;
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    win: boolean;
    queue: string;
    cs: number;
    durationMin: number;
    endedAt: number;
}

const QUEUES: Record<number, string> = {
    420: 'Solo/Duo',
    440: 'Flex',
    400: 'Draft',
    430: 'Blind',
    490: 'Quickplay',
    450: 'ARAM',
    2400: 'ARAM Mayhem',
    1700: 'Arena',
    900: 'URF',
};

/** The player's own line from a match-v5 payload, or null if they are not in it. */
export function matchSummaryFor(raw: unknown, puuid: string): RiotMatch | null {
    const m = raw as {
        metadata?: { matchId?: string };
        info?: {
            queueId?: number;
            gameMode?: string;
            gameDuration?: number;
            gameEndTimestamp?: number;
            participants?: Array<{
                puuid?: string;
                championName?: string;
                kills?: number;
                deaths?: number;
                assists?: number;
                win?: boolean;
                totalMinionsKilled?: number;
                neutralMinionsKilled?: number;
            }>;
        };
    };
    const me = m?.info?.participants?.find((p) => p.puuid === puuid);
    if (!m?.metadata?.matchId || !me) return null;
    return {
        id: m.metadata.matchId,
        champion: me.championName ?? '',
        kills: me.kills ?? 0,
        deaths: me.deaths ?? 0,
        assists: me.assists ?? 0,
        win: me.win === true,
        queue: QUEUES[m.info?.queueId ?? -1] ?? m.info?.gameMode ?? 'Game',
        cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
        durationMin: Math.round((m.info?.gameDuration ?? 0) / 60),
        endedAt: m.info?.gameEndTimestamp ?? 0,
    };
}

export interface RiotStatus {
    state: 'no-key' | 'no-identity' | 'ok' | 'invalid-key' | 'error';
    message: string;
    riotId: string | null;
    region: string | null;
    level: number | null;
    profileIconId: number | null;
    ranks: RiotRank[];
    recentMatchIds: string[];
    recentMatches: RiotMatch[];
    fetchedAt: number | null;
}

const empty = (state: RiotStatus['state'], message: string, id?: RiotIdentity): RiotStatus => ({
    state,
    message,
    riotId: id?.gameName && id.tagLine ? `${id.gameName}#${id.tagLine}` : null,
    region: id?.region ?? null,
    level: null,
    profileIconId: null,
    ranks: [],
    recentMatchIds: [],
    recentMatches: [],
    fetchedAt: null,
});

const QUEUE_LABEL: Record<string, string> = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex' };

/**
 * account-v1 (only when the puuid is unknown) → summoner-v4 → league-v4 → match-v5.
 * `live` is what the League client reports right now (any field may be null).
 */
export async function getRiotStatus(live: RiotIdentity): Promise<RiotStatus> {
    const id = rememberIdentity(live);
    const key = loadKey();
    if (!key) return empty('no-key', 'No Riot API key. One Trick uses your League client only.', id);
    const route = routeForRegion(id.region);
    if (!route || (!id.puuid && !(id.gameName && id.tagLine))) {
        return empty('no-identity', 'Open the League client once so One Trick learns your account and region.', id);
    }
    try {
        let puuid = id.puuid;
        if (!puuid) {
            const acct = await riotGet<{ puuid: string }>(
                route.regional,
                `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id.gameName!)}/${encodeURIComponent(id.tagLine!)}`,
                key,
                24 * 3_600_000
            );
            puuid = acct.puuid;
            rememberIdentity({ ...id, puuid });
        }
        const p = encodeURIComponent(puuid);
        const [summoner, entries, matches] = await Promise.all([
            riotGet<{ summonerLevel?: number; profileIconId?: number }>(route.platform, `/lol/summoner/v4/summoners/by-puuid/${p}`, key, 3_600_000),
            riotGet<Array<{ queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number }>>(
                route.platform,
                `/lol/league/v4/entries/by-puuid/${p}`,
                key,
                10 * 60_000
            ),
            riotGet<string[]>(route.regional, `/lol/match/v5/matches/by-puuid/${p}/ids?start=0&count=20`, key, 10 * 60_000),
        ]);
        const ids = Array.isArray(matches) ? matches : [];
        // Finished matches never change: cache for a year. A failed detail just drops that row.
        const recentMatches = (
            await Promise.all(
                ids.slice(0, 10).map((mid) =>
                    riotGet<RiotMatch | null>(
                        route.regional,
                        `/lol/match/v5/matches/${encodeURIComponent(mid)}`,
                        key,
                        365 * 86_400_000,
                        (raw) => matchSummaryFor(raw, puuid!)
                    ).catch(() => null)
                )
            )
        ).filter((m): m is RiotMatch => !!m);
        return {
            ...empty('ok', 'Linked with your personal Riot API key.', id),
            recentMatches,
            level: summoner.summonerLevel ?? null,
            profileIconId: summoner.profileIconId ?? null,
            ranks: entries
                .filter((e) => QUEUE_LABEL[e.queueType])
                .map((e) => ({ queue: QUEUE_LABEL[e.queueType], tier: e.tier, rank: e.rank, lp: e.leaguePoints, games: e.wins + e.losses })),
            recentMatchIds: ids,
            fetchedAt: Date.now(),
        };
    } catch (e) {
        if (e instanceof RiotHttpError && (e.status === 401 || e.status === 403)) {
            return empty('invalid-key', 'Riot rejected the key. Check it is your approved personal key, or paste it again.', id);
        }
        return empty('error', `Riot API unavailable right now (${e instanceof Error ? e.message : 'network error'}). Using the League client.`, id);
    }
}
