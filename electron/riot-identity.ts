/**
 * Riot ID identity store.
 *
 * The League client only reports the signed-in account, and only while it is
 * logged in. Two things make that unreliable to display directly:
 *  - a rename keeps the same puuid but changes gameName/tagLine;
 *  - a client restart / login screen answers /current-summoner with `{}`.
 *
 * So the identity is keyed by puuid: records survive renames, a switch upserts
 * the new puuid and moves the active pointer, and the last active record is
 * shown while the client sits on the login screen. Region is stored alongside
 * the platformId so match history can target the right endpoint later.
 */
import fs from 'fs';
import path from 'path';
import { userDataDir } from './paths';

export interface RiotIdentity {
    puuid: string;
    gameName: string | null;
    tagLine: string | null;
    /** Platform id reported by the client, e.g. EUW1. */
    platformId: string | null;
    /** Routing region derived from the platformId, e.g. euw. */
    region: string | null;
    updatedAt: number;
}

export interface RiotIdentityStore {
    activePuuid: string | null;
    recordsByPuuid: Record<string, RiotIdentity>;
}

/** What the live connection knows right now (any field may be missing). */
export interface IdentitySummary {
    summonerName?: string | null;
    gameName?: string | null;
    tagLine?: string | null;
    puuid?: string | null;
    platformId?: string | null;
}

export interface RiotIdentityStatus {
    gameName: string | null;
    tagLine: string | null;
    puuid: string | null;
    platformId: string | null;
    region: string | null;
    /** `gameName#tagLine`, or the fallback name, or null. */
    label: string | null;
    source: 'live' | 'stored' | 'none';
}

/**
 * Riot platform id → match routing region. Accepts both the platform form the
 * client reports (EUW1) and the region form region-locale answers (EUW).
 */
const PLATFORM_REGIONS: Record<string, string> = {
    NA1: 'na',
    NA: 'na',
    EUW1: 'euw',
    EUW: 'euw',
    EUN1: 'eun',
    EUNE: 'eun',
    EUN: 'eun',
    KR: 'kr',
    BR1: 'br',
    BR: 'br',
    JP1: 'jp',
    JP: 'jp',
    LA1: 'lan',
    LAN: 'lan',
    LA2: 'las',
    LAS: 'las',
    OC1: 'oce',
    OCE: 'oce',
    RU: 'ru',
    TR1: 'tr',
    TR: 'tr',
    PH2: 'ph',
    PH: 'ph',
    SG2: 'sg',
    SG: 'sg',
    TH2: 'th',
    TH: 'th',
    TW2: 'tw',
    TW: 'tw',
    VN2: 'vn',
    VN: 'vn',
    ME1: 'me',
    ME: 'me',
};

function clean(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizePlatformId(value: unknown): string | null {
    const raw = clean(value);
    return raw ? raw.toUpperCase() : null;
}

export function regionFromPlatformId(platformId: unknown): string | null {
    const key = normalizePlatformId(platformId);
    if (!key) return null;
    return PLATFORM_REGIONS[key] ?? null;
}

export function emptyIdentityStore(): RiotIdentityStore {
    return { activePuuid: null, recordsByPuuid: {} };
}

/**
 * Map /lol-summoner/v1/current-summoner onto a record. An empty object (login
 * screen, client still booting) or a partial payload without a puuid is not an
 * identity, so it returns null instead of inventing an account.
 */
export function identityFromSummoner(
    summoner: unknown,
    platformId: string | null = null
): RiotIdentity | null {
    const src = summoner && typeof summoner === 'object' ? (summoner as Record<string, unknown>) : {};
    const puuid = clean(src.puuid);
    if (!puuid) return null;
    const gameName = clean(src.gameName) ?? clean(src.displayName);
    const tagLine = clean(src.tagLine);
    if (!gameName && !tagLine) return null;
    const platform = normalizePlatformId(clean(src.platformId) ?? platformId);
    return {
        puuid,
        gameName,
        tagLine,
        platformId: platform,
        region: regionFromPlatformId(platform),
        updatedAt: Date.now(),
    };
}

/**
 * Upsert by puuid. A rename replaces the names on the same record; a switch
 * adds a new record and moves activePuuid. A missing platformId keeps the
 * previously stored one so a partial summoner event cannot erase the region.
 */
export function upsertIdentity(
    store: RiotIdentityStore,
    identity: RiotIdentity
): RiotIdentityStore {
    const prior = store.recordsByPuuid[identity.puuid];
    const platformId = identity.platformId ?? prior?.platformId ?? null;
    const record: RiotIdentity = {
        puuid: identity.puuid,
        gameName: identity.gameName ?? prior?.gameName ?? null,
        tagLine: identity.tagLine ?? prior?.tagLine ?? null,
        platformId,
        region: regionFromPlatformId(platformId) ?? prior?.region ?? null,
        updatedAt: identity.updatedAt || Date.now(),
    };
    return {
        activePuuid: identity.puuid,
        recordsByPuuid: { ...store.recordsByPuuid, [identity.puuid]: record },
    };
}

export function activeIdentity(store: RiotIdentityStore): RiotIdentity | null {
    if (!store.activePuuid) return null;
    return store.recordsByPuuid[store.activePuuid] ?? null;
}

/**
 * Display form of a Riot ID. Both halves are required: a gameName without a
 * tagLine is not a Riot ID, so the caller's fallback wins instead.
 */
export function formatRiotId(
    identity: { gameName?: string | null; tagLine?: string | null } | null | undefined,
    fallback: string | null = null
): string | null {
    const gameName = clean(identity?.gameName);
    const tagLine = clean(identity?.tagLine);
    if (gameName && tagLine) return `${gameName}#${tagLine}`;
    return clean(fallback);
}

/**
 * Resolve what the dashboard should show. Live fields win (so a rename shows
 * immediately), the stored record fills gaps for the same puuid, and while the
 * client is on the login screen (no live identity) the stored record is shown.
 */
export function statusFor(
    summary: IdentitySummary,
    stored: RiotIdentity | null | undefined
): RiotIdentityStatus {
    const summaryName = clean(summary.summonerName);
    const livePuuid = clean(summary.puuid);
    const liveGameName = clean(summary.gameName);
    const liveTagLine = clean(summary.tagLine);
    const livePlatformId = normalizePlatformId(summary.platformId);
    const hasLive = !!(livePuuid || liveGameName || liveTagLine);

    if (hasLive) {
        const base = livePuuid && stored?.puuid === livePuuid ? stored : null;
        const platformId = livePlatformId ?? base?.platformId ?? null;
        const gameName = liveGameName ?? base?.gameName ?? null;
        const tagLine = liveTagLine ?? base?.tagLine ?? null;
        const region = regionFromPlatformId(platformId) ?? base?.region ?? null;
        const puuid = livePuuid ?? base?.puuid ?? null;
        return {
            gameName,
            tagLine,
            puuid,
            platformId,
            region,
            label: formatRiotId({ gameName, tagLine }, summaryName),
            source: 'live',
        };
    }

    if (stored) {
        return {
            gameName: stored.gameName,
            tagLine: stored.tagLine,
            puuid: stored.puuid,
            platformId: stored.platformId,
            region: stored.region,
            label: formatRiotId(stored, summaryName),
            source: 'stored',
        };
    }

    return {
        gameName: null,
        tagLine: null,
        puuid: null,
        platformId: null,
        region: null,
        label: summaryName,
        source: 'none',
    };
}

function normalizeRecord(raw: unknown, fallbackPuuid: string): RiotIdentity | null {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    const puuid = clean(src.puuid) ?? clean(fallbackPuuid);
    if (!puuid) return null;
    const platformId = normalizePlatformId(src.platformId);
    return {
        puuid,
        gameName: clean(src.gameName),
        tagLine: clean(src.tagLine),
        platformId,
        region: clean(src.region) ?? regionFromPlatformId(platformId),
        updatedAt:
            typeof src.updatedAt === 'number' && Number.isFinite(src.updatedAt)
                ? src.updatedAt
                : 0,
    };
}

function normalizeStore(raw: unknown): RiotIdentityStore {
    const store = emptyIdentityStore();
    if (!raw || typeof raw !== 'object') return store;
    const src = raw as { activePuuid?: unknown; recordsByPuuid?: unknown };
    const records =
        src.recordsByPuuid && typeof src.recordsByPuuid === 'object'
            ? (src.recordsByPuuid as Record<string, unknown>)
            : {};
    for (const [key, value] of Object.entries(records)) {
        const record = normalizeRecord(value, key);
        if (record) store.recordsByPuuid[record.puuid] = record;
    }
    const active = clean(src.activePuuid);
    if (active && store.recordsByPuuid[active]) store.activePuuid = active;
    return store;
}

function identityFile(): string {
    return path.join(userDataDir(), 'riot-identity.json');
}

export function loadIdentityStore(filePath: string = identityFile()): RiotIdentityStore {
    try {
        return normalizeStore(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return emptyIdentityStore();
    }
}

/** Writes are rare (login, rename, switch), so a small sync write is fine. */
export function saveIdentityStore(
    store: RiotIdentityStore,
    filePath: string = identityFile()
): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}
