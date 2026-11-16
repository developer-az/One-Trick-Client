/**
 * Pre-match loading lifecycle decisions.
 *
 * Electron-free on purpose: the game monitor, the overlay window and
 * verify_prematch_lifecycle.ts drive exactly the same functions with fake
 * timers, fake windows and injected fetchers. Everything here is a decision
 * (should this happen, what is that value), never a side effect of its own —
 * the callers own the timers, windows and LCU transport.
 */
import { computeLoadingStats, type LoadingStats, type LoadingMatchLike } from '../src/overlay/loadingStats';

/** How long the finished match's overlay window is kept before it is destroyed. */
export const PREMATCH_DESTROY_DELAY_MS = 12_000;

export interface OverlayDestroyGate {
    /** Arm the delayed destroy for a finished match. */
    schedule(): void;
    /** Cancel a pending destroy (a new load/match owns the overlay again). */
    cancel(): void;
    pending(): boolean;
}

export interface OverlayDestroyGateDeps {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    isInGame: () => boolean;
    destroy: () => void;
    delayMs?: number;
}

/**
 * The post-match window destroy is delayed so a phase blip does not kill the
 * overlay. A quick requeue enters the next load inside that window, so entry
 * must cancel the timer — otherwise the old match's timer destroys the pet
 * window while the loading screen is drawing it.
 */
export function createOverlayDestroyGate(deps: OverlayDestroyGateDeps): OverlayDestroyGate {
    let handle: unknown = null;
    const clear = (): void => {
        if (handle === null) return;
        deps.clearTimeout(handle);
        handle = null;
    };
    return {
        schedule(): void {
            clear();
            handle = deps.setTimeout(() => {
                handle = null;
                // Only tear down a window the monitor is no longer using.
                if (!deps.isInGame()) deps.destroy();
            }, deps.delayMs ?? PREMATCH_DESTROY_DELAY_MS);
        },
        cancel(): void {
            clear();
        },
        pending(): boolean {
            return handle !== null;
        },
    };
}

/** Last heartbeat reported by one overlay page (keyed by webContents id). */
export interface OverlayPageBeat {
    at: number;
    frameAt: number | null;
    pageVisible: boolean;
}

/**
 * Record a heartbeat and answer whether the page was already ready before it
 * (true) or this is the first beat of the current page mount (false).
 *
 * The first beat is the only signal that the renderer's effects ran and its
 * overlay-update listener is bound, so it is what triggers a payload replay.
 * A reload keeps the webContents id; resetPageReadiness clears the entry on
 * navigation so the remounted page gets a first beat again.
 */
export function pageReadyAfterBeat(
    beats: Map<number, OverlayPageBeat>,
    webContentsId: number,
    beat: { frames: boolean; pageVisible: boolean },
    now: number = Date.now()
): boolean {
    const prior = beats.get(webContentsId);
    beats.set(webContentsId, {
        at: now,
        frameAt: beat.frames ? now : prior?.frameAt ?? null,
        pageVisible: beat.pageVisible,
    });
    return !!prior;
}

/** Whether this page mount has already reported a heartbeat. */
export function isPageReady(beats: Map<number, OverlayPageBeat>, webContentsId: number): boolean {
    return beats.has(webContentsId);
}

/**
 * Forget page readiness for a webContents id. Called on did-start-navigation,
 * did-finish-load and render-process-gone: all three can start a fresh page
 * mount that keeps the same id, and each mount needs its own replay.
 */
export function resetPageReadiness(
    beats: Map<number, OverlayPageBeat>,
    webContentsId: number,
    reason: string,
    log?: (event: string, detail?: Record<string, unknown>) => void
): boolean {
    const had = beats.delete(webContentsId);
    if (had && log) {
        try {
            log('page-readiness-reset', { window: webContentsId, reason });
        } catch {
            // A replay/health listener must never break the beat path.
        }
    }
    return had;
}

export interface LocalSummonerIdentity {
    summonerId?: number | null;
    puuid?: string | null;
}

export interface SessionChampion {
    championId: number;
    championName?: string;
}

interface SessionMember {
    championId?: number;
    summonerId?: number;
    puuid?: string;
}

interface GameflowSessionLike {
    gameData?: {
        playerChampionSelections?: SessionMember[];
        teamOne?: SessionMember[];
        teamTwo?: SessionMember[];
    };
}

function sameSummoner(member: SessionMember, local: LocalSummonerIdentity): boolean {
    if (local.puuid && typeof member.puuid === 'string' && member.puuid) {
        return member.puuid === local.puuid;
    }
    if (
        typeof local.summonerId === 'number' &&
        Number.isFinite(local.summonerId) &&
        typeof member.summonerId === 'number'
    ) {
        return member.summonerId === local.summonerId;
    }
    return false;
}

/**
 * Your champion from `/lol-gameflow/v1/session`. A reconnect goes straight to
 * InProgress without a champ-select event, so this is the only place the pick
 * exists; `playerChampionSelections` carries it, with the teams as fallback.
 */
export function championFromGameflowSession(
    session: unknown,
    local: LocalSummonerIdentity | null
): SessionChampion | null {
    if (!session || typeof session !== 'object' || !local) return null;
    if (!local.puuid && typeof local.summonerId !== 'number') return null;
    const data = (session as GameflowSessionLike).gameData;
    if (!data) return null;
    const lists = [data.playerChampionSelections, data.teamOne, data.teamTwo];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const member of list) {
            if (!member || typeof member.championId !== 'number' || member.championId <= 0) continue;
            if (!sameSummoner(member, local)) continue;
            return { championId: member.championId };
        }
    }
    return null;
}

/**
 * One session read, only when the pick is unknown. The local identity comes
 * from the client's own summoner event, so this path costs exactly one LCU
 * request; with no identity there is nothing to match and no request is made.
 */
export async function resolveLoadingChampion(deps: {
    getIdentity: () => LocalSummonerIdentity | null;
    fetchSession: () => Promise<unknown>;
}): Promise<SessionChampion | null> {
    const identity = deps.getIdentity();
    if (!identity || (!identity.puuid && typeof identity.summonerId !== 'number')) return null;
    let session: unknown = null;
    try {
        session = await deps.fetchSession();
    } catch {
        return null;
    }
    return championFromGameflowSession(session, identity);
}

export interface PrematchStatsCache {
    /** Fetch recent summaries once (no per-game detail requests). */
    prefetch(): Promise<void>;
    /**
     * Recent form for a champion, or null when the cache is unknown. Null must
     * stay null: "no games found" and "history never loaded" are different
     * states on the loading card (pet only vs. First game).
     */
    statsFor(championId: number | null | undefined): LoadingStats | null;
    loaded(): boolean;
    reset(): void;
}

/**
 * Champ-select prefetch → loading read. The loading path never fetches: it
 * returns the cached fold or null. Only prefetch() touches the LCU, and it is
 * summaries-only so it can never join (or start) another caller's detail
 * fetch.
 */
export function createPrematchStatsCache(deps: {
    fetchHistory: () => Promise<LoadingMatchLike[]>;
}): PrematchStatsCache {
    let matches: LoadingMatchLike[] | null = null;
    let inFlight: Promise<void> | null = null;
    let generation = 0;
    return {
        prefetch(): Promise<void> {
            if (matches !== null) return Promise.resolve();
            if (inFlight) return inFlight;
            const mine = generation;
            inFlight = deps
                .fetchHistory()
                .then((result) => {
                    if (mine !== generation) return;
                    matches = Array.isArray(result) ? result : [];
                })
                .catch(() => {
                    // Offline / fresh account: the card simply never appears.
                })
                .finally(() => {
                    if (mine === generation) inFlight = null;
                });
            return inFlight;
        },
        statsFor(championId: number | null | undefined): LoadingStats | null {
            if (!matches || typeof championId !== 'number' || !Number.isFinite(championId)) return null;
            return computeLoadingStats(matches, championId);
        },
        loaded(): boolean {
            return matches !== null;
        },
        reset(): void {
            generation += 1;
            matches = null;
            inFlight = null;
        },
    };
}
