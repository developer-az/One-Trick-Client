import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { ensureLCUConnected, makeLCURequest } from './lcu-connector';

/**
 * Your own recent matches from the League client (no Riot API key needed).
 *
 * The list endpoint only carries your own participant, so enemy champions come
 * from one detail request per game. Details never change, so they are cached
 * on disk and each game is fetched at most once.
 */

export interface MatchSummary {
    gameId: number;
    /** Epoch ms. */
    at: number;
    durationSec: number;
    queueId: number;
    championId: number;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    role: 'Top' | 'Jungle' | 'Mid' | 'Bot' | 'Support' | null;
    /** Enemy champion ids, when the game's details have been loaded. */
    enemies?: number[];
    /** Enemy in the same position, when positions are known. */
    laneOpponent?: number | null;
    /** Allied champion ids when details have been loaded. */
    allies?: number[];
    /** Bot lane partner when roles are known. */
    lanePartner?: number | null;
}

interface RawParticipant {
    participantId?: number;
    championId?: number;
    teamId?: number;
    spell1Id?: number;
    spell2Id?: number;
    stats?: {
        win?: boolean;
        kills?: number;
        deaths?: number;
        assists?: number;
        totalMinionsKilled?: number;
        neutralMinionsKilled?: number;
    };
    timeline?: { lane?: string; role?: string };
}

interface RawGame {
    gameId?: number;
    gameCreation?: number;
    gameDuration?: number;
    queueId?: number;
    participants?: RawParticipant[];
    participantIdentities?: Array<{ participantId?: number; player?: { puuid?: string } }>;
}

/** Summoner's Rift queues: draft, ranked solo/flex, blind, quickplay, swiftplay. */
export const RIFT_QUEUES = new Set([400, 420, 430, 440, 480, 490]);
/** Games shorter than this were remakes. */
const MIN_DURATION_SEC = 300;
const SMITE = 11;

export function roleOf(p: RawParticipant | undefined): MatchSummary['role'] {
    const lane = (p?.timeline?.lane || '').toUpperCase();
    const role = (p?.timeline?.role || '').toUpperCase();
    const spells = [p?.spell1Id, p?.spell2Id];
    // Smite is the one reliable jungle signal. Riot's lane guess calls a
    // roaming support (Pyke, Bard) "JUNGLE" when they leave lane early.
    if (spells.includes(SMITE)) return 'Jungle';
    if (lane === 'TOP') return 'Top';
    if (lane === 'JUNGLE') return spells.some((x) => x) ? null : 'Jungle';
    if (lane === 'MIDDLE' || lane === 'MID') return 'Mid';
    if (lane === 'BOTTOM' || lane === 'BOT') {
        if (role === 'DUO_SUPPORT') return 'Support';
        if (role === 'DUO_CARRY') return 'Bot';
    }
    return null;
}

/** Your participant in a game (the list endpoint has only you). */
function selfIn(game: RawGame, puuid: string | null): RawParticipant | undefined {
    const parts = game.participants || [];
    if (parts.length === 1) return parts[0];
    const id = game.participantIdentities?.find((i) => puuid && i.player?.puuid === puuid)?.participantId;
    return parts.find((p) => p.participantId === id);
}

export function summarize(game: RawGame, puuid: string | null): MatchSummary | null {
    const me = selfIn(game, puuid);
    if (!me || !game.gameId || !me.championId) return null;
    const durationSec = game.gameDuration ?? 0;
    // Older clients reported milliseconds.
    const seconds = durationSec > 100000 ? Math.round(durationSec / 1000) : durationSec;
    return {
        gameId: game.gameId,
        at: game.gameCreation ?? 0,
        durationSec: seconds,
        queueId: game.queueId ?? 0,
        championId: me.championId,
        win: !!me.stats?.win,
        kills: me.stats?.kills ?? 0,
        deaths: me.stats?.deaths ?? 0,
        assists: me.stats?.assists ?? 0,
        cs: (me.stats?.totalMinionsKilled ?? 0) + (me.stats?.neutralMinionsKilled ?? 0),
        role: roleOf(me),
    };
}

/** Enemy champions and your lane opponent from a full game. */
export function enemiesFrom(game: RawGame, puuid: string | null): { enemies: number[]; laneOpponent: number | null } {
    const me = selfIn(game, puuid);
    if (!me) return { enemies: [], laneOpponent: null };
    const foes = (game.participants || []).filter((p) => p.teamId !== me.teamId && p.championId);
    const myRole = roleOf(me);
    const opp = myRole ? foes.filter((p) => roleOf(p) === myRole) : [];
    return {
        enemies: foes.map((p) => p.championId!),
        laneOpponent: opp.length === 1 ? opp[0].championId! : null,
    };
}

/** Allied champions and bot partner from a full game. */
export function alliesFrom(
    game: RawGame,
    puuid: string | null
): { allies: number[]; lanePartner: number | null } {
    const me = selfIn(game, puuid);
    if (!me) return { allies: [], lanePartner: null };
    const team = (game.participants || []).filter(
        (p) => p.teamId === me.teamId && p.championId && p.participantId !== me.participantId
    );
    const myRole = roleOf(me);
    let lanePartner: number | null = null;
    if (myRole === 'Bot' || myRole === 'Support') {
        const want = myRole === 'Bot' ? 'Support' : 'Bot';
        const partners = team.filter((p) => roleOf(p) === want);
        lanePartner = partners.length === 1 ? partners[0].championId! : null;
    }
    return { allies: team.map((p) => p.championId!), lanePartner };
}

type DetailCache = Record<
    string,
    { enemies: number[]; laneOpponent: number | null; allies?: number[]; lanePartner?: number | null }
>;
let detailCache: DetailCache | null = null;
let cacheWrite: ReturnType<typeof setTimeout> | null = null;

function cacheFile(): string {
    return path.join(app.getPath('userData'), 'match-details.json');
}

function loadCache(): DetailCache {
    if (detailCache) return detailCache;
    try {
        detailCache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as DetailCache;
    } catch {
        detailCache = {};
    }
    return detailCache;
}

function saveCacheSoon(): void {
    if (cacheWrite) clearTimeout(cacheWrite);
    cacheWrite = setTimeout(() => {
        cacheWrite = null;
        void fs.promises.writeFile(cacheFile(), JSON.stringify(detailCache || {})).catch(() => undefined);
    }, 1000);
}

let inFlight: Promise<MatchSummary[]> | null = null;

/**
 * Up to `count` recent Summoner's Rift games, newest first. Enemy details are
 * filled for at most `detailLimit` games per call so the first load stays quick.
 */
export function getMatchHistory(opts: { count?: number; detailLimit?: number; canFetchDetails: () => boolean }): Promise<MatchSummary[]> {
    if (inFlight) return inFlight;
    inFlight = load(opts).finally(() => {
        inFlight = null;
    });
    return inFlight;
}

async function load({ count = 60, detailLimit = 25, canFetchDetails }: { count?: number; detailLimit?: number; canFetchDetails: () => boolean }): Promise<MatchSummary[]> {
    await ensureLCUConnected();
    const me = (await makeLCURequest('GET', '/lol-summoner/v1/current-summoner', undefined, 5000)) as { puuid?: string } | null;
    const puuid = me?.puuid || null;

    const games: RawGame[] = [];
    const seen = new Set<number>();
    // The client serves at most 20 games per request. Some client builds
    // ignore begIndex on the current-summoner route and return the same page
    // again, so games are keyed by id; when a page brings nothing new the
    // puuid route is tried once before paging stops.
    const routes = ['/lol-match-history/v1/products/lol/current-summoner/matches'];
    if (puuid) routes.push(`/lol-match-history/v1/products/lol/${puuid}/matches`);
    let route = 0;
    for (let beg = 0; beg < count; ) {
        const end = Math.min(count, beg + 20) - 1;
        const res = (await makeLCURequest('GET', `${routes[route]}?begIndex=${beg}&endIndex=${end}`, undefined, 10000).catch(
            () => null
        )) as { games?: { games?: RawGame[] } } | null;
        const page = res?.games?.games || [];
        const fresh = page.filter((g) => g.gameId && !seen.has(g.gameId));
        for (const g of fresh) seen.add(g.gameId!);
        games.push(...fresh);
        if (!fresh.length && beg > 0 && route + 1 < routes.length) {
            route++;
            continue;
        }
        if (!fresh.length || page.length < end - beg + 1) break;
        beg += 20;
    }

    const out = games
        .map((g) => summarize(g, puuid))
        .filter((g): g is MatchSummary => !!g && RIFT_QUEUES.has(g.queueId) && g.durationSec >= MIN_DURATION_SEC)
        .sort((a, b) => b.at - a.at);

    const cache = loadCache();
    let fetched = 0;
    for (const g of out) {
        const hit = cache[g.gameId];
        if (hit) {
            g.enemies = hit.enemies;
            g.laneOpponent = hit.laneOpponent;
            if (hit.allies?.length) g.allies = hit.allies;
            if (hit.lanePartner != null) g.lanePartner = hit.lanePartner;
            continue;
        }
        // Never fetch details during a match; one request at a time otherwise.
        if (fetched >= detailLimit || !canFetchDetails()) continue;
        try {
            const full = (await makeLCURequest('GET', `/lol-match-history/v1/games/${g.gameId}`, undefined, 8000)) as RawGame | null;
            fetched++;
            if (!full) continue;
            const info = enemiesFrom(full, puuid);
            const allyInfo = alliesFrom(full, puuid);
            if (!info.enemies.length) continue;
            cache[g.gameId] = { ...info, ...allyInfo };
            g.enemies = info.enemies;
            g.laneOpponent = info.laneOpponent;
            g.allies = allyInfo.allies;
            g.lanePartner = allyInfo.lanePartner;
        } catch {
            break;
        }
    }
    if (fetched) saveCacheSoon();
    return out;
}
