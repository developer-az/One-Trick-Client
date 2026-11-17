import { makeLCURequest } from './lcu-connector';
import { lcuSocket } from './lcu-socket';
import { findLocalPlayer, type LiveClientAllGameData, type LiveClientPlayer } from './live-client';
import {
    getStateServiceStatus,
    readLiveBoard,
    readLiveClock,
    resetStateService,
    clearStateBoard,
    setStateServiceEngaged,
    setStateServiceHudHidden,
    startStateService,
    stopStateService,
    getGameState,
    getObjectiveTimers,
    getRecentGameEvents,
    getLatencySummary,
    recordLatency,
} from './state-service';
import type { LatencySummary } from '../src/logic/latencyStats';
import { tickCoachCues, resetCoachCooldowns } from './coach-cues';
import { setClipperActive, queueClip, syncAutoClip } from './clipper';

/** A play at or above this weighted score becomes a clip trigger (Great+). */
let clipsQueued = 0;
let lastClipQueuedAt = 0;
import {
    describeEndMatchReason,
    isInGamePhase,
} from './match-lifecycle';
import { isMatchLoading } from '../src/logic/matchLoading';
import {
    showOverlay,
    hideOverlay,
    sendOverlayUpdate,
    isOverlayUserHidden,
    setOverlayUserHidden,
    createOverlayWindow,
    destroyOverlay,
    onOverlayWindowCreated,
    setOverlayPageReadyHandler,
    getOverlayWindow,
    syncScalesFromLeague,
    keepOverlayOnTop,
    healOverlayWindows,
    setOverlayMatchActive,
} from './overlay-window';
import { overlayLog } from './overlay-log';
import { readLeagueHudScales } from './league-settings';
import {
    ingestChampSelectTeam,
    ingestLiveEvents,
    ingestLivePlayers,
    resetSummonerTracker,
    serializeSummoners,
    summonerFingerprint,
    consumeSummonerClipboard,
    setSummonerFocus,
} from './summoner-tracker';
import { clipboard } from 'electron';
import { getAppSettings, type AppSettings } from './app-settings';
import { getMatchHistorySummaries } from './match-history';
import {
    createOverlayDestroyGate,
    createPrematchStatsCache,
    loadingSlotFromChampSelect,
    loadingSlotFromGameflowSession,
    queueMetadataFromGameflowSession,
    resolveLoadingChampion,
    shouldRefreshLoadingStats,
    type LocalSummonerIdentity,
} from './prematch-loading';
import {
    computeLoadingStats,
    type LoadingMatchLike,
    type LoadingStats,
} from '../src/overlay/loadingStats';
import type { LoadingSlot } from '../src/overlay/loadingScreenGeometry';
import { tickPlayMoments, type PlayMomentSnapshot } from '../src/logic/playMoments';
import { pickClipMoment } from '../src/logic/clipper-plan';
import type { PlayOverlayState } from '../src/logic/playMoments';
import { appendPlayRecap, clearPlayRecap } from './play-recap';
import { resetJungleThreatClock } from '../src/logic/jungleLogic';
import {
    HOWLING_ABYSS_MAP_ID,
    detectMayhemMode,
    isAramOrMayhem,
    isMayhemMode,
    type MayhemMode,
    type MayhemModeSignals,
} from '../src/logic/mayhem/mode';
import { planMayhemOcr } from '../src/logic/mayhem/augmentSchedule';
import {
    computeMayhemPickPhase,
    nextMayhemPickLevel,
    resolveMayhemPicksTaken,
    type MayhemPickPhase,
} from '../src/logic/mayhem/pickPhase';
import {
    readLiveAugmentIds,
} from '../src/logic/mayhem/pickCount';
import {
    createMayhemMonitorState,
    isUnknownQueueAram,
    mayhemDiscoveryLive,
    noteMayhemDiscoveryTrigger,
    noteMayhemManualScan,
    runMayhemMonitorScan,
    type MayhemMonitorState,
} from '../src/logic/mayhem/monitor';
import { isMayhemAugmentHudVisible } from '../src/logic/mayhem/visibility';
import { loadMayhemBundle } from './mayhem-data';
import {
    detectMayhemOffers,
    isMayhemOcrRerollPending,
    mayhemOcrBlackFrameSeen,
    resetMayhemOcrCache,
    resetMayhemOcrMatchFlags,
    setMayhemOcrRetainOffers,
} from './mayhem-ocr';
import {
    getMayhemPicksTaken,
    getOwnedMayhemAugmentIds,
    mergedMayhemOfferIds,
    resetMayhemMatchState,
    setMayhemPicksTaken,
    setMayhemRollIds,
} from './mayhem-state';

/**
 * Match lifecycle, driven by League Client events (see lcu-socket.ts).
 *
 * Nothing here polls the League client. Game state comes from the State Service
 * (`state-service.ts`), which samples the Live Client at 400 ms and owns the
 * event cursor, objective timers and snapshot buffer. This module runs a slower
 * timer purely to decide what the HUD should draw, and to end the match when
 * the Live Client goes quiet.
 *
 * A dropped client socket or a few failed Live Client reads must not hide the
 * HUD. The overlay stays up until the post-game phase sticks or the game
 * process has been gone for a long time. See match-lifecycle.ts.
 */

/** In-game: overlay owns the hot path; ~2.5s keeps cues/wards fresh without thrashing. */
const POLL_INGAME_MS = 2500;
/** After ~18 min, enemy item churn causes fewer meaningful HUD changes — ease off CPU/IPC. */
const POLL_INGAME_LATE_MS = 4200;
const LATE_GAME_SEC = 18 * 60;
/** In-game with the overlay hidden: still ingest live for timers, but less often. */
const POLL_INGAME_HIDDEN_MS = 8000;
/** No League client found: probe the game API slowly in case a match is running anyway. */
const POLL_PROBE_MS = 5000;
/** Clipboard is a synchronous OS call — never more than once per this window. */
const CLIPBOARD_MIN_INTERVAL_MS = 20000;
/** Re-assert always-on-top at most this often (DWM churn = FPS loss). */
const KEEP_ON_TOP_MIN_MS = 20000;

let lastClipboardWrite = 0;
let lastKeepOnTopAt = 0;
/** Last healthy live payload — never clobber the HUD with a null Live Client blip. */
let lastGoodPayload: ReturnType<typeof buildOverlayPayload> | null = null;
/** Settings snapshot for the current liveTick; undefined outside a tick. */
let tickSettings: AppSettings | null = null;

function settingsForTick(): AppSettings {
    return tickSettings ?? getAppSettings();
}

export interface CachedEnemy {
    championId: number;
    championName?: string;
    position?: string;
}

let monitorStarted = false;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let lastChampSelectEnemies: CachedEnemy[] = [];
/**
 * The champion you locked in champ select (numeric LCU key + name). The
 * loading card's form and the champion accent both need it, and champ select
 * already delivers the session — no extra polling.
 */
let lastChampSelectSelf: { championId: number; championName?: string } | null = null;
/** Champion resolved from the gameflow session when no champ-select event ran (reconnect). */
let loadingChampion: { championId: number; championName?: string } | null = null;
/** Recent form on `lastChampSelectSelf.championId`, read from the champ-select cache. */
let prematchStats: LoadingStats | null = null;
/** Bumped on every load so a late resolution cannot attach to the wrong game. */
let prematchStatsToken = 0;
/** Local identity, for matching the gameflow session without another request. */
let localSummonerIdentity: LocalSummonerIdentity | null = null;
let identityWaiters: Array<(value: LocalSummonerIdentity | null) => void> = [];
/** True once this champ select has started its one history prefetch. */
let champSelectHistoryPrefetched = false;
let lastPrefetchPhase: string | null = null;
/** Bumped per champ select so an older prefetch can never fill the cache. */
let champSelectSession = 0;
/** The load the current loading overlay belongs to; 0 outside a load. */
let loadingSessionToken = 0;
/**
 * Your loading-screen slot: side + index among your team. The champ-select
 * fallback fills the order at entry; the gameflow session refines it with the
 * side (the only thing that can, so it is what the overlay places from).
 */
let loadingSlot: LoadingSlot | null = null;
/** Champ-select fallback (myTeam order by cellId), consumed at load entry. */
let champSelectSlot: LoadingSlot | null = null;
/** Queue + map for this game, captured at load entry and kept all match (Step H). */
let matchQueueId: number | null = null;
let matchMapId: number | null = null;
/** Increments once per beginMatch; scopes the one in-game queue GET. */
let matchStartToken = 0;
/** Load token whose one reconnect summaries prefetch already ran (0 = none). */
let reconnectSummaryPrefetched = 0;
/**
 * Summaries fetched during champ select so the loading path can fold them
 * without issuing a single LCU request. Empty cache ≠ zero games: only a loaded
 * cache may claim "First game on this champion".
 */
const prematchHistoryCache = createPrematchStatsCache({
    // The session id travels with the request: a new champ select must never
    // join the previous one's in-flight page (match-history keeps one slot per
    // session and starts a fresh request instead).
    fetchHistory: () => getMatchHistorySummaries({ count: 60, session: champSelectSession }),
});
/** Finished-match overlay destroy, delayed so a phase blip cannot kill it. */
const overlayDestroyGate = createOverlayDestroyGate({
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown,
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isInGame: () => inGame,
    destroy: () => destroyOverlay(),
});
let inGame = false;
/**
 * League is loading a game: GameStart, or InProgress before the Live Client
 * answers. The overlay shows the loading pet from here; beginMatch (or a phase
 * back in a menu) ends it.
 */
let prematchLoading = false;
let lastOverlayFingerprint = '';
let lastSentOverlayPayload: unknown = null;
let overlayWindowCreatedUnsubscribe: (() => void) | null = null;
let currentPollMs = POLL_INGAME_MS;
let liveReadsTotal = 0;
/** Last time allgamedata or gamestats proved the game process is up. */
let lastLiveProofAt = 0;
/** Last game clock accepted from a successful Live Client read. */
let trustedGameTime = 0;
/** Phase string we are timing, so a one-event flap cannot end the match. */
let trackedPhase = '';
let phaseSince = 0;
let onGameStateChange: ((active: boolean) => void) | null = null;
/** Optional hook so main can re-bind PageUp/PageDown when a match starts. */
let onMatchStartHotkeys: (() => void) | null = null;
let lastMatchEndReason: string | null = null;
let playMomentSnapshot: PlayMomentSnapshot | null = null;
let lastPlayOverlayState: PlayOverlayState | null = null;

export function getLastChampSelectEnemies(): CachedEnemy[] {
    return lastChampSelectEnemies;
}

export function isCurrentlyInGame(): boolean {
    return inGame;
}

export function isMayhemMatchActive(): boolean {
    return inGame && !!lastGoodPayload && isMayhemMode(currentMayhemMode());
}

/** Howling Abyss / ARAM-ish live game (Mayhem, mayhem-likely or classic ARAM). */
export function isAramFamilyMatchActive(): boolean {
    if (!inGame || !lastGoodPayload) return false;
    const signals = currentMayhemSignals();
    return isAramOrMayhem(signals.gameMode, signals.mapName, {
        queueId: signals.queueId,
        mapId: signals.mapId,
        augmentOffersDetected: false,
    });
}

/** The overlay is showing the pre-match loading screen right now. */
export function isPrematchLoading(): boolean {
    return prematchLoading;
}

/**
 * Which phase means "a game is loading but no live board exists yet".
 * GameStart is the loading screen; InProgress appears before the Live Client
 * answers when the client reconnects straight into a game. Once beginMatch has
 * run, a real match owns the overlay, so `inGame` always wins.
 */
export function isPrematchLoadingPhase(phase: string | null, inGameNow: boolean): boolean {
    if (inGameNow) return false;
    return phase === 'GameStart' || phase === 'InProgress';
}

/** The one payload the loading screen needs: pet + phase, no board. */
export function prematchLoadingPayload(
    phase: string | null,
    pet: AppSettings['pet'],
    champion?: { championId: number; championName?: string } | null,
    stats?: LoadingStats | null,
    slot?: LoadingSlot | null,
    queue?: { queueId?: number | null; mapId?: number | null }
): Record<string, unknown> {
    return {
        inGame: true,
        loading: true,
        gameflowPhase: phase,
        gameTime: 0,
        trustedGameTime: 0,
        pet,
        championId: champion?.championId ?? null,
        championName: champion?.championName ?? null,
        // Always present (null when unknown): the page replaces its state
        // wholesale, so an omitted field would blank a card that already drew.
        loadingStats: stats ?? null,
        loadingSlot: slot ?? null,
        queueId: queue?.queueId ?? null,
        mapId: queue?.mapId ?? null,
        timestamp: Date.now(),
    };
}

/** Whether a freshly created (or just mounted) overlay page should be re-sent the last payload. */
export function shouldReplayOverlayState(state: {
    inGame: boolean;
    prematchLoading: boolean;
    userHidden: boolean;
    hasPayload: boolean;
}): boolean {
    if (state.userHidden || !state.hasPayload) return false;
    return state.inGame || state.prematchLoading;
}

/**
 * The client's own summoner event (already fetched once per LCU connect) gives
 * the identity that matches us inside `/lol-gameflow/v1/session`. Caching it
 * here is what keeps the reconnect champion read at a single request.
 */
function rememberLocalSummoner(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const summoner = value as { summonerId?: number; puuid?: string };
    if (typeof summoner.summonerId !== 'number' && !summoner.puuid) return;
    localSummonerIdentity = {
        summonerId: typeof summoner.summonerId === 'number' ? summoner.summonerId : null,
        puuid: typeof summoner.puuid === 'string' ? summoner.puuid : null,
    };
    const waiters = identityWaiters;
    identityWaiters = [];
    for (const resolve of waiters) resolve(localSummonerIdentity);
}

/** Bounded wait for the summoner event that follows an LCU (re)connect. */
function waitForLocalSummoner(timeoutMs: number): Promise<LocalSummonerIdentity | null> {
    if (localSummonerIdentity) return Promise.resolve(localSummonerIdentity);
    return new Promise((resolve) => {
        let settled = false;
        const done = (value: LocalSummonerIdentity | null): void => {
            if (settled) return;
            settled = true;
            const index = identityWaiters.indexOf(done);
            if (index >= 0) identityWaiters.splice(index, 1);
            resolve(value);
        };
        identityWaiters.push(done);
        const timer = setTimeout(() => done(null), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
    });
}

/**
 * A new ChampSelect owns a fresh history snapshot. Bumping the session both
 * resets the cache and invalidates a prefetch from the previous champ select,
 * so a hot requeue never shows last game's games (or an old page's results).
 */
function beginChampSelectSession(): void {
    champSelectSession += 1;
    champSelectHistoryPrefetched = false;
    prematchHistoryCache.reset();
}

/**
 * Mark that this champ select already asked for its history. If that prefetch
 * is still in flight when GameStart arrives, fold it when it lands — for this
 * load and this champion only — and refresh the loading payload. Nothing here
 * starts an LCU request from the loading path.
 */
function prefetchHistoryForChampSelect(): void {
    if (champSelectHistoryPrefetched || inGame || prematchLoading) return;
    champSelectHistoryPrefetched = true;
    const session = champSelectSession;
    void prematchHistoryCache.prefetch().then(() => {
        if (session !== champSelectSession) return;
        const championId = loadingChampion?.championId ?? null;
        const refresh = shouldRefreshLoadingStats({
            loading: prematchLoading,
            loadToken: loadingSessionToken,
            activeToken: prematchStatsToken,
            championId,
            loadingChampionId: loadingChampion?.championId ?? null,
        });
        if (!refresh || championId == null) return;
        const stats = prematchStatsFromCache(championId);
        if (!stats) return;
        prematchStats = stats;
        sendPrematchLoadingPayload();
        overlayLog('prematch-loading stats', { source: 'champ-select-cache', championId });
    });
}

/** Cache-only fold: no LCU request, and null stays "unknown" (pet only). */
function prematchStatsFromCache(championId: number | null | undefined): LoadingStats | null {
    const mayhemLikely = matchQueueId == null && matchMapId === HOWLING_ABYSS_MAP_ID;
    return prematchHistoryCache.statsFor(championId, matchQueueId, mayhemLikely);
}

/** The session read just taught us the queue: re-fold the card for it. */
function refreshPrematchStatsForQueue(): void {
    if (!prematchLoading) return;
    prematchStats = prematchStatsFromCache(loadingChampion?.championId ?? null);
}

/** Send the loading payload for the champion currently known (if any). */
function sendPrematchLoadingPayload(): void {
    sendFullOverlayUpdate(
        prematchLoadingPayload(
            lcuSocket.phase,
            settingsForTick().pet,
            loadingChampion,
            prematchStats,
            loadingSlot,
            { queueId: matchQueueId, mapId: matchMapId }
        )
    );
}

/**
 * Store the loading slot and log it in one readable line:
 * `loading-slot side=… index=… size=… source=…`.
 */
function applyLoadingSlot(next: LoadingSlot | null): void {
    if (!next) return;
    const same =
        !!loadingSlot &&
        loadingSlot.side === next.side &&
        loadingSlot.index === next.index &&
        loadingSlot.teamSize === next.teamSize &&
        loadingSlot.source === next.source;
    if (same) return;
    loadingSlot = next;
    overlayLog('loading-slot', {
        side: next.side ?? 'unknown',
        index: next.index,
        size: next.teamSize,
        source: next.source,
    });
}

/** Queue id + map id from the same session read; kept for the whole match. */
function applyQueueMetadata(session: unknown): void {
    const meta = queueMetadataFromGameflowSession(session);
    if (meta.queueId != null) matchQueueId = meta.queueId;
    if (meta.mapId != null) matchMapId = meta.mapId;
}

/**
 * Reconnect straight into InProgress: no champ-select event ever ran, so the
 * pick is unknown. One gameflow-session read is allowed for this case only;
 * every other loading tick reads the cache. The same response carries the
 * loading slot and the queue/map ids, so a reconnect still spends just one GET.
 */
async function resolvePrematchChampionFromSession(): Promise<void> {
    if (!prematchLoading || loadingChampion) return;
    const token = prematchStatsToken;
    // The client fetches its own summoner once per connect; wait for that
    // event instead of spending a second request on identity.
    const identity = await waitForLocalSummoner(1500);
    if (!identity) return;
    let session: unknown = null;
    const champion = await resolveLoadingChampion({
        getIdentity: () => identity,
        fetchSession: async () => {
            session = await makeLCURequest('GET', '/lol-gameflow/v1/session', undefined, 4000);
            return session;
        },
    });
    if (token !== prematchStatsToken || !prematchLoading || !session) return;
    applyLoadingSlot(loadingSlotFromGameflowSession(session, identity));
    applyQueueMetadata(session);
    refreshPrematchStatsForQueue();
    if (!champion || loadingChampion) {
        // The slot/queue ids alone are worth a refinement payload.
        sendPrematchLoadingPayload();
        return;
    }
    loadingChampion = champion;
    prematchStats = prematchStatsFromCache(champion.championId);
    overlayLog('prematch-loading champion', {
        source: 'gameflow-session',
        championId: champion.championId,
        stats: prematchStats ? 'cache' : 'none',
    });
    sendPrematchLoadingPayload();
    // No champ-select prefetch ever ran for a reconnect: the card would stay
    // "Reading…" for the whole load. One summaries-only request, this load only.
    void prefetchHistoryForReconnect(token, champion.championId);
}

/**
 * Champ-select path: the pick is already known, so this load's one session read
 * is spent on the slot (side + index) and the queue ids. Deliberately async —
 * the pet and card are already on screen and get refined when it lands.
 */
async function resolveLoadingSlotFromSession(): Promise<void> {
    if (!prematchLoading) return;
    const token = prematchStatsToken;
    const identity = await waitForLocalSummoner(1500);
    if (!identity) return;
    let session: unknown = null;
    try {
        session = await makeLCURequest('GET', '/lol-gameflow/v1/session', undefined, 4000);
    } catch {
        return;
    }
    if (token !== prematchStatsToken || !prematchLoading || !session) return;
    applyLoadingSlot(loadingSlotFromGameflowSession(session, identity));
    applyQueueMetadata(session);
    refreshPrematchStatsForQueue();
    sendPrematchLoadingPayload();
}

/**
 * A reconnect's single summaries prefetch (count 60, no details). It does not
 * touch the champ-select cache — no champ select happened — and is folded only
 * for the load and champion it was started for.
 */
async function prefetchHistoryForReconnect(token: number, championId: number): Promise<void> {
    if (reconnectSummaryPrefetched === token) return;
    reconnectSummaryPrefetched = token;
    let matches: LoadingMatchLike[] | null = null;
    try {
        // The load token is this prefetch's session key: two consecutive
        // reconnects must never join each other's in-flight page (the second
        // would accept the first's result and fold it into the wrong load).
        matches = await getMatchHistorySummaries({ count: 60, session: token });
    } catch {
        return;
    }
    if (!matches || token !== prematchStatsToken || !prematchLoading) return;
    const refresh = shouldRefreshLoadingStats({
        loading: prematchLoading,
        loadToken: loadingSessionToken,
        activeToken: prematchStatsToken,
        championId,
        loadingChampionId: loadingChampion?.championId ?? null,
    });
    if (!refresh) return;
    prematchStats = computeLoadingStats(
        matches,
        championId,
        matchQueueId,
        matchQueueId == null && matchMapId === HOWLING_ABYSS_MAP_ID
    );
    sendPrematchLoadingPayload();
    overlayLog('prematch-loading stats', { source: 'reconnect-prefetch', championId });
}

/**
 * A late champ-select swap while the load is drawing must recolor/re-stat the
 * payload instead of leaving the previous pick on screen.
 */
function applyChampSelectChampionToLoading(): void {
    if (!prematchLoading || !lastChampSelectSelf) return;
    const next = lastChampSelectSelf;
    if (
        loadingChampion &&
        loadingChampion.championId === next.championId &&
        (loadingChampion.championName || '') === (next.championName || '')
    ) {
        return;
    }
    loadingChampion = { championId: next.championId, championName: next.championName };
    prematchStats = prematchStatsFromCache(next.championId);
    sendPrematchLoadingPayload();
}

/** PageUp in Mayhem: hide augment HUD until next shop window or Page Down scan. */
export function dismissMayhemAugmentPanelFromHotkey(): void {
    if (!isMayhemMatchActive()) return;
    mayhemUserDismissedUntilMs = Date.now() + 120_000;
    mayhemAugmentDismissedAt = Date.now();
    mayhemManualScanUntilMs = 0;
    purgeMayhemOffersFromScreen();
    pushMayhemOverlayPatch();
    notifyMayhemOverlayStateChanged();
}

/** PageDown in Mayhem: force one screen capture + Windows OCR for augment cards. */
export async function triggerManualMayhemOcrFromHotkey(): Promise<void> {
    if (!inGame || !lastGoodPayload) return;
    const signals = currentMayhemSignals();
    // Manual scan is allowed in any ARAM-family game, including an unknown
    // queue. Only an unknown queue may be classified from it; classic ARAM 450
    // must stay ARAM even when cards are on screen.
    const aramFamily = isAramOrMayhem(signals.gameMode, signals.mapName, {
        queueId: signals.queueId,
        mapId: signals.mapId,
        augmentOffersDetected: false,
    });
    if (currentMayhemMode() !== 'mayhem' && !aramFamily) return;
    mayhemUserDismissedUntilMs = 0;
    mayhemAugmentDismissedAt = 0;
    const bundle = loadMayhemBundle();
    if (!bundle?.augments?.length) return;
    resetMayhemOcrCache();
    const read = await detectMayhemOffers(
        bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
        0,
        { minMatches: 1 }
    );
    const ids = read.ids;
    mayhemOfferIds = ids;
    mayhemMonitorState.displayIds = [...ids];
    mayhemMonitorState.fuzzyScore = read.fuzzyScore;
    // A manual scan is a fresh authoritative frame: drop any pending auto
    // candidate so it cannot overwrite the manual roll.
    mayhemMonitorState.candidateIds = [];
    mayhemMonitorState.candidateScans = 0;
    noteMayhemManualScan(mayhemMonitorState, signals, read);
    if (ids.length >= 1) {
        mayhemManualScanUntilMs = Date.now() + 60_000;
        setMayhemRollIds(ids);
        beginMayhemPickSession();
    } else {
        mayhemManualScanUntilMs = 0;
    }
    applyMayhemOfferVisibilityAfterOcr();
    pushMayhemOverlayPatch();
    notifyMayhemOverlayStateChanged();
}

/** Diagnostics for the performance panel. */
export function getMonitorStats(): {
    inGame: boolean;
    livePollMs: number | null;
    liveReads: number;
    lastEndReason: string | null;
    latency: Record<string, LatencySummary>;
} {
    return {
        inGame,
        livePollMs: liveTimer ? currentPollMs : null,
        liveReads: liveReadsTotal,
        lastEndReason: lastMatchEndReason,
        latency: getLatencySummary(),
    };
}

/** Optional hook so main window can hide / pause work while League is running. */
export function setGameStateChangeHandler(handler: ((active: boolean) => void) | null): void {
    onGameStateChange = handler;
}

export function setMatchStartHotkeyHandler(handler: (() => void) | null): void {
    onMatchStartHotkeys = handler;
}

/**
 * Remember the champion you locked in. `localPlayerCellId` links the session to
 * your row; with no pick yet the slot is 0 and the previous value is dropped so
 * a stale champion cannot color the next load.
 */
function rememberChampSelectSelf(
    myTeam:
        | Array<{
              cellId?: number;
              championId?: number;
              championName?: string;
              summonerId?: number;
              puuid?: string;
          }>
        | undefined,
    localPlayerCellId: number | undefined
): void {
    if (!Array.isArray(myTeam)) return;
    const locked = myTeam.filter(
        (member) => !!member && typeof member.championId === 'number' && member.championId > 0
    );
    if (locked.length === 0) {
        lastChampSelectSelf = null;
        champSelectSlot = null;
        return;
    }
    const self =
        typeof localPlayerCellId === 'number' && localPlayerCellId >= 0
            ? locked.find((member) => member.cellId === localPlayerCellId)
            : locked.length === 1
              ? locked[0]
              : undefined;
    if (!self?.championId) return;
    lastChampSelectSelf = { championId: self.championId, championName: self.championName };
    // Your slot inside your own team, ordered by cellId exactly as the client
    // numbers it. The side only exists in the gameflow session, so this is a
    // fallback the overlay never places from on its own.
    champSelectSlot = loadingSlotFromChampSelect(myTeam, localPlayerCellId);
    // Champ select already carries the identity the reconnect path needs, so
    // the gameflow-session read never has to fetch it separately.
    if (typeof self.summonerId === 'number' || self.puuid) rememberLocalSummoner(self);
}

function ingestChampSelectSession(session: unknown): void {
    if (!session || typeof session !== 'object') return;
    const typed = session as {
        localPlayerCellId?: number;
        myTeam?: Array<{
            cellId?: number;
            championId?: number;
            championName?: string;
            summonerId?: number;
            puuid?: string;
        }>;
        theirTeam?: Array<{
            championId?: number;
            championName?: string;
            assignedPosition?: string;
            teamPosition?: string;
            position?: string;
            spell1Id?: number;
            spell2Id?: number;
        }>;
    };
    rememberChampSelectSelf(typed.myTeam, typed.localPlayerCellId);
    // One summaries-only prefetch per champ select; the loading path only reads it.
    if (lastChampSelectSelf) {
        prefetchHistoryForChampSelect();
        applyChampSelectChampionToLoading();
    }
    const theirTeam = typed.theirTeam;
    if (!Array.isArray(theirTeam)) return;

    const enemies: CachedEnemy[] = [];
    for (const member of theirTeam) {
        if (member.championId && member.championId !== 0) {
            enemies.push({
                championId: member.championId,
                championName: member.championName,
                position: member.assignedPosition,
            });
        }
    }
    if (enemies.length > 0) {
        lastChampSelectEnemies = enemies;
    }
    // Auto-fill enemy summoner intel while sitting in client
    ingestChampSelectTeam(theirTeam);

    const summons = serializeSummoners();
    if (summons.length > 0) {
        const fp = `pre:${summonerFingerprint()}`;
        if (fp !== lastOverlayFingerprint) {
            lastOverlayFingerprint = fp;
            sendFullOverlayUpdate({
                inGame: false,
                enemyBotSummoners: summons,
                cachedChampSelectEnemies: lastChampSelectEnemies,
                timestamp: Date.now(),
            });
        }
    }
}

/** Live champion → authored profile. Unknown champs become generic:{id}:{role}. */
const AUTHORED_BY_CHAMPION: Record<string, string> = {
    pyke: 'pyke-support',
    pantheon: 'pantheon-support',
    yone: 'yone-mid',
};

const LIVE_ROLE: Record<string, string> = {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    MID: 'Mid',
    BOTTOM: 'Bot',
    BOT: 'Bot',
    UTILITY: 'Support',
    SUPPORT: 'Support',
    ADC: 'Bot',
};

function profileHintFromLive(championName: string | undefined, position?: string): string | null {
    if (!championName) return null;
    const compact = championName.toLowerCase().replace(/[^a-z]/g, '');
    if (AUTHORED_BY_CHAMPION[compact]) return AUTHORED_BY_CHAMPION[compact];
    const role = LIVE_ROLE[(position || '').trim().toUpperCase()] || 'Mid';
    const championId = championName.replace(/[^a-zA-Z0-9]/g, '') || championName;
    return `generic:${championId}:${role}`;
}

/** Display-ready `enemies` row as it appears on the HUD payload. */
type PayloadEnemy = {
    championName: string | undefined;
    level: number | undefined;
    position: string | undefined;
    isDead: boolean | undefined;
    items: string[];
    scores: LiveClientPlayer['scores'];
    summonerSpells: LiveClientPlayer['summonerSpells'];
    respawnTimer: number;
};

/** Cheap signature of one enemy player — covers every field the HUD enemy row reads. */
function enemyPlayerSignature(p: LiveClientPlayer): string {
    const respawn =
        typeof p.respawnTimer === 'number' && Number.isFinite(p.respawnTimer) && p.respawnTimer > 0
            ? Math.ceil(p.respawnTimer)
            : 0;
    const scores = p.scores
        ? `${p.scores.kills ?? 0}:${p.scores.deaths ?? 0}:${p.scores.assists ?? 0}:${p.scores.creepScore ?? 0}:${p.scores.wardScore ?? 0}`
        : '0:0:0:0:0';
    const spells = p.summonerSpells
        ? `${p.summonerSpells.summonerSpellOne?.displayName ?? ''}|${p.summonerSpells.summonerSpellTwo?.displayName ?? ''}`
        : '';
    return [
        p.championName || '',
        p.level ?? 0,
        p.position || '',
        p.isDead ? 1 : 0,
        (p.items || []).map((i) => `${i.itemID ?? ''}:${i.displayName ?? ''}:${i.count ?? 1}`).join(','),
        scores,
        spells,
        respawn,
    ].join('~');
}

/**
 * Reuse the previous `enemies` array when the enemy players did not change.
 * The mapping is pure, so the cached array is exactly what a fresh map would
 * produce — title (and memory churn) is what changes, not behavior.
 */
function mapEnemies(enemyPlayers: LiveClientPlayer[]): PayloadEnemy[] {
    const signature = enemyPlayers.map(enemyPlayerSignature).join('|');
    if (lastMappedEnemies && lastEnemySignature === signature) return lastMappedEnemies;
    const enemies = enemyPlayers.map((p) => ({
        championName: p.championName,
        level: p.level,
        position: p.position,
        isDead: p.isDead,
        items: p.items?.map((i) => i.displayName) || [],
        scores: p.scores,
        summonerSpells: p.summonerSpells,
        respawnTimer:
            typeof p.respawnTimer === 'number' && Number.isFinite(p.respawnTimer) && p.respawnTimer > 0
                ? Math.ceil(p.respawnTimer)
                : 0,
    }));
    lastEnemySignature = signature;
    lastMappedEnemies = enemies;
    return enemies;
}

function buildOverlayPayload(live: LiveClientAllGameData | null, gameflowPhase: string | null) {
    const localPlayer = live ? findLocalPlayer(live) : null;
    const liveGold = live?.activePlayer?.currentGold;
    const currentGold = typeof liveGold === 'number' && Number.isFinite(liveGold) ? liveGold : null;
    const localName = (localPlayer?.championName || '').toLowerCase().replace(/[^a-z]/g, '');
    const isPyke = localPlayer ? localName === 'pyke' : true;
    const isYone = localPlayer ? localName === 'yone' : false;
    const profileHint = localPlayer
        ? profileHintFromLive(localPlayer.championName, localPlayer.position)
        : 'pyke-support';

    // Yone Mid tracks enemy mid sums; support profiles track bot + support
    const midFocus =
        profileHint === 'yone-mid' ||
        isYone ||
        (typeof profileHint === 'string' && /generic:[^:]+:(Mid|Top|Jungle)$/.test(profileHint));
    setSummonerFocus(midFocus ? 'mid' : 'bot');

    const enemyPlayers =
        live?.allPlayers?.filter((p) => localPlayer && p.team !== localPlayer.team) || [];
    const enemies = mapEnemies(enemyPlayers);
    const mayhemMode = mayhemModeForLive(live);
    const aramMatch = mayhemMode !== 'other';
    if (mayhemMode === 'mayhem' && live) {
        syncMayhemPickPhase(live);
    }
    // Lane-based enemy sum tracking is SR-only (ADC/mid bot lane model).
    if (!aramMatch) {
        ingestLivePlayers(
            enemyPlayers.map((p) => ({
                championName: p.championName,
                position: p.position,
                summonerSpells: p.summonerSpells,
                itemIds: (p.items || []).map((i) => i.itemID),
            }))
        );
    }
    const nameToChampion = new Map<string, string>();
    for (const p of live?.allPlayers || []) {
        if (p.summonerName) nameToChampion.set(p.summonerName, p.championName);
        if (p.riotIdGameName) nameToChampion.set(p.riotIdGameName, p.championName);
        if (p.riotId) {
            nameToChampion.set(p.riotId, p.championName);
            const base = p.riotId.split('#')[0];
            if (base) nameToChampion.set(base, p.championName);
        }
        // Events sometimes use champion display names directly
        if (p.championName) nameToChampion.set(p.championName, p.championName);
    }
    ingestLiveEvents(live?.events?.Events, nameToChampion, live?.gameData?.gameTime);

    // Auto-copy ADC Flash/Heal/Barrier when they come back up. Clipboard writes
    // are a synchronous OS call — throttle so a flapping timer can never turn
    // into a write on every tick while a match is running.
    // Only take the pending text when we're allowed to write it, so a throttled
    // tick doesn't swallow it.
    const clip = Date.now() - lastClipboardWrite > CLIPBOARD_MIN_INTERVAL_MS ? consumeSummonerClipboard() : null;
    if (clip) {
        lastClipboardWrite = Date.now();
        try {
            clipboard?.writeText(clip);
        } catch {
            // ignore clipboard failures
        }
    }

    const allies = live?.allPlayers
        ?.filter((p) => localPlayer && p.team === localPlayer.team && p.summonerName !== localPlayer.summonerName)
        .map((p) => ({
            championName: p.championName,
            level: p.level,
            position: p.position,
            isDead: p.isDead,
        })) || [];

    const gameTime = live?.gameData?.gameTime ?? 0;
    const loading = isMatchLoading({
        phase: gameflowPhase,
        gameTime,
        trustedGameTime,
        matchEngaged: true,
    });
    // Champ-select pick for this game. The numeric key drives the accent and
    // the match list; only trust it when the name still matches the live
    // champion (a stale pick must never recolor an unknown board).
    const champSelectChampionId = ((): number | null => {
        if (!lastChampSelectSelf) return null;
        const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const live = compact(localPlayer?.championName || '');
        const picked = compact(lastChampSelectSelf.championName || '');
        if (live && picked && live !== picked) return null;
        return lastChampSelectSelf.championId;
    })();
    const payload = {
        inGame: !loading,
        loading,
        gameflowPhase,
        championId: champSelectChampionId,
        gameMode: live?.gameData?.gameMode || null,
        gameTime,
        trustedGameTime,
        // Captured at load entry from the gameflow session, kept all match for
        // the steps that branch on the exact queue (Step H).
        queueId: matchQueueId,
        mapId: matchMapId,
        objectiveTimers: getObjectiveTimers() ?? undefined,
        pet: settingsForTick().pet,
        mapName: live?.gameData?.mapName || null,
        localPlayer: localPlayer
            ? {
                  championName: localPlayer.championName,
                  level: localPlayer.level,
                  isDead: localPlayer.isDead,
                  items: localPlayer.items || [],
                  scores: localPlayer.scores,
                  position: localPlayer.position,
                  currentGold,
                  summonerSpells: localPlayer.summonerSpells,
              }
            : null,
        isPyke,
        isYone,
        profileHint,
        enemies,
        allies,
        cachedChampSelectEnemies: lastChampSelectEnemies,
        enemyBotSummoners: aramMatch ? [] : serializeSummoners(),
        activePlayerLevel: live?.activePlayer?.level ?? localPlayer?.level ?? 0,
        championStats: live?.activePlayer?.championStats ?? null,
        mayhemOfferIds: (() => {
            const merged = mergedMayhemOfferIds(mayhemOfferIds);
            return merged.length ? merged : undefined;
        })(),
        mayhemOwnedIds: getOwnedMayhemAugmentIds(),
        mayhemAugmentWindow: mayhemAugmentHudShouldShow(),
        mayhemPickHint: mayhemPickPhase.hint,
        mayhemWaitingForDeath: mayhemPickPhase.waitingForDeath,
        mayhemAugmentDismissedAt: mayhemAugmentDismissedAt || undefined,
        mayhemOcrHint: mayhemOcrBlackFrameSeen()
            ? 'Use borderless for augment detection'
            : undefined,
        timestamp: Date.now(),
    };

    return payload;
}

/** Coarse fingerprint — skip IPC/React work when nothing the HUD cares about changed. */
function overlayFingerprint(payload: ReturnType<typeof buildOverlayPayload>): string {
    const lp = payload.localPlayer;
    const itemKey = (lp?.items || []).map((i) => `${i.itemID}:${i.count}`).join(',');
    // 150g + 30s buckets: coarser than the displayed values, so a handful of
    // ticks with only gold/time drift do not force an IPC + React reconcile.
    const goldBucket = Math.floor((lp?.currentGold ?? 0) / 150);
    const wardScore = Math.floor(lp?.scores?.wardScore ?? 0);
    // Include CS + items so jungle pathing / threat heuristics actually update.
    const itemBucket = Math.floor((payload.gameTime || 0) / 30);
    const enemyKey = (payload.enemies || [])
        .map((e) => {
            const cs = e.scores?.creepScore ?? 0;
            const itemCount = (e.items || []).filter((id) => id && id !== '0').length;
            return `${e.championName}:${e.level}:${e.isDead ? 1 : 0}:${cs}:${itemCount}:${itemBucket}:${Math.ceil((e.respawnTimer ?? 0) / 10)}`;
        })
        .join('|');
    // 10s buckets — ward/cue clocks tick locally in the overlay renderer.
    // Per-second buckets forced an IPC + full React reconcile every poll.
    const timeBucket = Math.floor((payload.gameTime || 0) / 10);
    return [
        payload.gameflowPhase || '',
        payload.gameMode || '',
        timeBucket,
        lp?.level ?? 0,
        lp?.isDead ? 1 : 0,
        itemKey,
        goldBucket,
        wardScore,
        enemyKey,
        payload.isPyke ? 1 : 0,
        payload.profileHint || '',
        summonerFingerprint(),
        (payload.cachedChampSelectEnemies || []).map((e) => e.championId).join(','),
        (payload.mayhemOfferIds || []).join(','),
        (payload.mayhemOwnedIds || []).join(','),
        payload.mayhemAugmentWindow ? 1 : 0,
        payload.mayhemPickHint || '',
        payload.mayhemWaitingForDeath ? 1 : 0,
        payload.mayhemAugmentDismissedAt ?? 0,
        payload.mayhemOcrHint || '',
    ].join('~');
}

let mayhemOfferIds: string[] = [];
/**
 * Memoized payload `enemies` list: built once per enemy-list signature so a
 * tick whose enemies did not change reuses the previous array instead of
 * rebuilding it (and the objects inside it) every poll.
 */
let lastEnemySignature = '';
let lastMappedEnemies: PayloadEnemy[] | null = null;
/** Last time tickPlayMoments / tickCoachCues / clip planning actually ran. */
let lastPlayMomentsAt = 0;
/** Cue ids+labels the HUD last received from a warm (non-fingerprint) push. */
let lastSentMomentCueContent = '';
/** Moment-engine runs ride payload sends; this floor also keeps a quiet match warm. */
const PLAY_MOMENTS_MIN_INTERVAL_MS = 2000;

let mayhemPollTimer: ReturnType<typeof setTimeout> | null = null;
/** The one Mayhem poll session of this match (later discovery bursts reuse it). */
let mayhemPollStartedThisMatch = false;
let mayhemBurstUntilMs = 0;
let mayhemLastLevel = 0;
let mayhemPickPhase: MayhemPickPhase = {
    pickWindowOpen: false,
    waitingForDeath: false,
    hint: '',
    nextPickLevel: 3,
    picksTaken: 0,
    ocrBurst: false,
};
let mayhemWasDead = false;
let mayhemLastEventScanId = 0;
/** How far into the last Live Client event list this scan walked. */
let mayhemEventScanFrom = 0;
let mayhemPicksAtWindowOpen = 0;
let mayhemPickSessionActive = false;
/** Page Down with a single OCR hit — allow HUD until timeout or off-screen OCR. */
let mayhemManualScanUntilMs = 0;
/** Page Up dismiss — pause auto OCR until next pick window or Page Down. */
let mayhemUserDismissedUntilMs = 0;
let mayhemAugmentDismissedAt = 0;
/** Live Client owned augment ids for this match (ground truth when it exposes them). */
let mayhemLiveAugmentIds: string[] = [];
/** Consecutive fresh OCR scans that read at least one offer (single-card HUD gate). */
let mayhemOfferScanStreak = 0;
let mayhemOfferFuzzyScore = 0;
/**
 * Decision state for this match: pick counter, scan streaks, retained display
 * ids and the bounded-discovery latch. The pure engine in
 * src/logic/mayhem/monitor.ts drives it; the fields below are mirrors the rest
 * of this module reads.
 */
let mayhemMonitorState: MayhemMonitorState = createMayhemMonitorState();
/** Last `mode-detect` line written this match (dedupe: one line per signal set). */
let lastModeDetectKey = '';

function mayhemOffersDetected(): boolean {
    // Latched discovery wins even after a blank scan cleared the display ids:
    // an unknown-queue game that showed augments stays Mayhem for the match.
    return (
        mayhemMonitorState.discovery.latched ||
        mergedMayhemOfferIds(mayhemOfferIds).length >= 2
    );
}

/** One `mode-detect` line per distinct signal set, to overlay.log. */
function logModeDetect(signals: MayhemModeSignals): MayhemMode {
    const mode = detectMayhemMode(signals);
    const key = [
        signals.gameMode ?? '',
        signals.mapName ?? '',
        signals.queueId ?? '',
        signals.mapId ?? '',
        signals.augmentOffersDetected ? 1 : 0,
        mode,
    ].join('|');
    if (key !== lastModeDetectKey) {
        lastModeDetectKey = key;
        overlayLog('mode-detect', {
            gameMode: signals.gameMode ?? 'unknown',
            mapName: signals.mapName ?? 'unknown',
            queueId: signals.queueId ?? 'unknown',
            mapId: signals.mapId ?? 'unknown',
            result: mode,
        });
    }
    return mode;
}

function mayhemModeForLive(live: LiveClientAllGameData | null): MayhemMode {
    return logModeDetect({
        gameMode: live?.gameData?.gameMode ?? null,
        mapName: live?.gameData?.mapName ?? null,
        queueId: matchQueueId,
        mapId: matchMapId,
        augmentOffersDetected: mayhemOffersDetected(),
    });
}

function currentMayhemSignals(): MayhemModeSignals {
    return {
        gameMode: lastGoodPayload?.gameMode ?? null,
        mapName: lastGoodPayload?.mapName ?? null,
        queueId: matchQueueId ?? lastGoodPayload?.queueId ?? null,
        mapId: matchMapId ?? lastGoodPayload?.mapId ?? null,
        augmentOffersDetected: mayhemOffersDetected(),
    };
}

function currentMayhemMode(): MayhemMode {
    return logModeDetect(currentMayhemSignals());
}

function mayhemManualScanActive(): boolean {
    return Date.now() < mayhemManualScanUntilMs;
}

function mayhemAugmentHudShouldShow(): boolean {
    const merged = mergedMayhemOfferIds(mayhemOfferIds);
    return isMayhemAugmentHudVisible(merged, mayhemManualScanActive(), {
        consecutiveScans: mayhemOfferScanStreak,
        fuzzyScore: mayhemOfferFuzzyScore,
    });
}

function clearMayhemLiveOffers(): void {
    mayhemOfferIds = [];
    setMayhemRollIds([]);
    // Drop the engine's display mirror too: a throttled (non-fresh) scan must
    // not resurrect the roll the HUD just cleared.
    mayhemMonitorState.displayIds = [];
    mayhemMonitorState.scanStreak = 0;
    mayhemMonitorState.fuzzyScore = 0;
    mayhemMonitorState.candidateIds = [];
    mayhemMonitorState.candidateScans = 0;
    mayhemOfferScanStreak = 0;
    mayhemOfferFuzzyScore = 0;
    resetMayhemOcrCache();
}

function beginMayhemPickSession(): void {
    mayhemPickSessionActive = true;
    setMayhemOcrRetainOffers(true);
}

function endMayhemPickSession(): void {
    mayhemPickSessionActive = false;
    setMayhemOcrRetainOffers(false);
    clearMayhemLiveOffers();
}

function purgeMayhemOffersFromScreen(): void {
    mayhemOfferIds = [];
    setMayhemRollIds([]);
    mayhemManualScanUntilMs = 0;
    mayhemMonitorState.displayIds = [];
    mayhemMonitorState.scanStreak = 0;
    mayhemMonitorState.fuzzyScore = 0;
    mayhemMonitorState.candidateIds = [];
    mayhemMonitorState.candidateScans = 0;
    mayhemOfferScanStreak = 0;
    mayhemOfferFuzzyScore = 0;
    if (mayhemPickSessionActive) {
        endMayhemPickSession();
    } else {
        setMayhemOcrRetainOffers(false);
        resetMayhemOcrCache();
    }
}

function applyMayhemOfferVisibilityAfterOcr(): void {
    if (mayhemAugmentHudShouldShow()) {
        if (!mayhemPickSessionActive) beginMayhemPickSession();
        return;
    }
    purgeMayhemOffersFromScreen();
}

function shouldRunMayhemAutoOcr(level: number): boolean {
    if (Date.now() < mayhemUserDismissedUntilMs) return false;
    const ownedCount = mayhemPicksResolved(level);
    const nextPick = nextMayhemPickLevel(ownedCount);
    if (nextPick == null) return false;
    if (level >= nextPick) return true;
    if (mayhemAugmentHudShouldShow()) return true;
    return false;
}

function mayhemPicksResolved(level: number): number {
    return resolveMayhemPicksTaken(level, getOwnedMayhemAugmentIds(), getMayhemPicksTaken());
}

function syncMayhemPickPhase(live: LiveClientAllGameData): void {
    const localPlayer = findLocalPlayer(live);
    const level = localPlayer?.level ?? live.activePlayer?.level ?? 1;
    const isDead = !!localPlayer?.isDead;
    const ownedCount = mayhemPicksResolved(level);
    const prevOpen = mayhemPickPhase.pickWindowOpen;
    mayhemPickPhase = computeMayhemPickPhase({
        level,
        gameTime: live.gameData?.gameTime ?? 0,
        isDead,
        wasDead: mayhemWasDead,
        ownedAugmentCount: ownedCount,
        championStats: live.activePlayer?.championStats,
    });

    if (ownedCount > mayhemPicksAtWindowOpen && !isDead) {
        mayhemPickPhase = {
            ...mayhemPickPhase,
            pickWindowOpen: false,
            waitingForDeath: false,
            ocrBurst: false,
        };
        purgeMayhemOffersFromScreen();
    }

    if (mayhemPickPhase.pickWindowOpen && !prevOpen) {
        mayhemPicksAtWindowOpen = ownedCount;
        mayhemUserDismissedUntilMs = 0;
        mayhemAugmentDismissedAt = 0;
    }
    mayhemWasDead = isDead;
    // Live Client owned augments are authoritative when the game exposes them.
    mayhemLiveAugmentIds = readLiveAugmentIds(live.activePlayer);
    const events = live.events?.Events;
    if (events?.length && mayhemModeForLive(live) === 'mayhem') {
        const start = events.length + 8 < mayhemEventScanFrom ? 0 : Math.max(0, mayhemEventScanFrom - 4);
        let maxId = mayhemLastEventScanId;
        for (let i = start; i < events.length; i++) {
            const ev = events[i];
            const id = ev.EventID ?? 0;
            if (id > maxId) maxId = id;
            if (id <= mayhemLastEventScanId) continue;
            const name = ev.EventName || '';
            if (/augment|mayhem|kiwi|arena/i.test(name)) {
                console.info('[mayhem-live-event]', name, ev.EventTime);
            }
        }
        mayhemLastEventScanId = maxId;
        mayhemEventScanFrom = events.length;
    }
}

function syncMayhemPickPhaseFromPayload(): void {
    if (!lastGoodPayload) return;
    const lp = lastGoodPayload.localPlayer;
    const level = lp?.level ?? lastGoodPayload.activePlayerLevel ?? 1;
    const isDead = !!lp?.isDead;

    const ownedCount = mayhemPicksResolved(level);
    const prevOpen = mayhemPickPhase.pickWindowOpen;
    mayhemPickPhase = computeMayhemPickPhase({
        level,
        gameTime: lastGoodPayload.gameTime ?? 0,
        isDead,
        wasDead: mayhemWasDead,
        ownedAugmentCount: ownedCount,
        championStats: lastGoodPayload.championStats,
    });

    if (ownedCount > mayhemPicksAtWindowOpen && !isDead) {
        mayhemPickPhase = {
            ...mayhemPickPhase,
            pickWindowOpen: false,
            waitingForDeath: false,
            ocrBurst: false,
        };
        purgeMayhemOffersFromScreen();
    }

    if (mayhemPickPhase.pickWindowOpen && !prevOpen) {
        mayhemPicksAtWindowOpen = ownedCount;
        mayhemUserDismissedUntilMs = 0;
        mayhemAugmentDismissedAt = 0;
    }
    mayhemWasDead = isDead;
}

function stopMayhemPoll(): void {
    if (mayhemPollTimer) {
        clearTimeout(mayhemPollTimer);
        mayhemPollTimer = null;
    }
}

function scheduleMayhemPoll(delayMs: number): void {
    stopMayhemPoll();
    mayhemPollTimer = setTimeout(() => {
        void tickMayhemOcr().finally(() => {
            if (inGame) scheduleMayhemPoll(nextMayhemPollDelayMs());
        });
    }, delayMs);
}

function nextMayhemPollDelayMs(): number {
    if (!lastGoodPayload) return 15_000;
    if (!isMayhemMode(currentMayhemMode())) {
        // Discovery is deliberately slow: one foreground scan per 10 s.
        return mayhemDiscoveryLive(mayhemMonitorState.discovery, Date.now()) ? 10_000 : 15_000;
    }
    syncMayhemPickPhaseFromPayload();
    if (mayhemPickPhase.pickWindowOpen) return 900;
    if (mayhemPickPhase.waitingForDeath) return 4000;
    const level = lastGoodPayload.localPlayer?.level ?? lastGoodPayload.activePlayerLevel ?? 1;
    const plan = planMayhemOcr({
        level,
        previousLevel: mayhemLastLevel,
        championStats: lastGoodPayload.championStats,
        gameTime: lastGoodPayload.gameTime ?? 0,
        nowMs: Date.now(),
        burstUntilMs: mayhemBurstUntilMs,
    });
    mayhemBurstUntilMs = plan.burstUntilMs;
    return plan.intervalMs;
}

function startMayhemPoll(): void {
    const firstPoll = !mayhemPollStartedThisMatch;
    mayhemPollStartedThisMatch = true;
    mayhemLastLevel = 0;
    mayhemBurstUntilMs = 0;
    mayhemWasDead = false;
    mayhemLastEventScanId = 0;
    mayhemEventScanFrom = 0;
    mayhemPicksAtWindowOpen = 0;
    if (firstPoll) {
        // A new match resets the monitor engine, but a discovery burst (or a
        // manual PageDown result) that the live tick just produced keeps its
        // clock, offers and streak; only the per-match counter restarts.
        const previous = mayhemMonitorState;
        mayhemMonitorState = createMayhemMonitorState();
        mayhemMonitorState.discovery = { ...previous.discovery };
        mayhemMonitorState.displayIds = [...previous.displayIds];
        mayhemMonitorState.scanStreak = previous.scanStreak;
        mayhemMonitorState.fuzzyScore = previous.fuzzyScore;
        mayhemMonitorState.candidateIds = [...previous.candidateIds];
        mayhemMonitorState.candidateScans = previous.candidateScans;
        mayhemPickSessionActive = false;
        mayhemManualScanUntilMs = 0;
        mayhemUserDismissedUntilMs = 0;
        mayhemAugmentDismissedAt = 0;
        mayhemLiveAugmentIds = [];
        resetMayhemOcrMatchFlags();
        setMayhemOcrRetainOffers(false);
        resetMayhemMatchState();
    }
    // A later discovery burst (level 7/11/15 or a death) reuses the poll
    // session: the engine's counter, streak and single-offer candidate survive.
    mayhemOfferScanStreak = mayhemMonitorState.scanStreak;
    mayhemOfferFuzzyScore = mayhemMonitorState.fuzzyScore;
    mayhemOfferIds = mayhemMonitorState.displayIds;
    mayhemPickPhase = {
        pickWindowOpen: false,
        waitingForDeath: false,
        hint: '',
        nextPickLevel: 3,
        picksTaken: 0,
        ocrBurst: false,
    };
    scheduleMayhemPoll(1200);
}

function pushMayhemOverlayPatch(): void {
    if (!lastGoodPayload) return;
    const merged = mergedMayhemOfferIds(mayhemOfferIds);
    const payload = {
        ...lastGoodPayload,
        mayhemOfferIds: merged.length ? merged : undefined,
        mayhemOwnedIds: getOwnedMayhemAugmentIds(),
        mayhemAugmentWindow: mayhemAugmentHudShouldShow(),
        mayhemPickHint: mayhemPickPhase.hint,
        mayhemWaitingForDeath: mayhemPickPhase.waitingForDeath,
        mayhemAugmentDismissedAt: mayhemAugmentDismissedAt || undefined,
        mayhemOcrHint: mayhemOcrBlackFrameSeen()
            ? 'Use borderless for augment detection'
            : undefined,
        timestamp: Date.now(),
    };
    const fp = overlayFingerprint(payload);
    if (fp === lastOverlayFingerprint) return;
    lastGoodPayload = payload;
    lastOverlayFingerprint = fp;
    sendFullOverlayUpdate(payload);
}

/** Dashboard owned/roll edits — push merged offers without waiting for the next live poll. */
export function notifyMayhemOverlayStateChanged(): void {
    pushMayhemOverlayPatch();
}

async function tickMayhemOcr(): Promise<void> {
    if (!inGame || !lastGoodPayload) return;
    const signals = currentMayhemSignals();
    const mode = currentMayhemMode();
    const active = isMayhemMode(mode);
    const now = Date.now();
    // Unknown-queue ARAM: scan at a slow, bounded cadence so offer cards can
    // classify the match. Classic ARAM (450) and other maps never qualify.
    const discovery =
        !active &&
        isUnknownQueueAram(signals) &&
        mayhemDiscoveryLive(mayhemMonitorState.discovery, now);
    if (!active && !discovery) return;

    if (active) {
        syncMayhemPickPhaseFromPayload();
        pushMayhemOverlayPatch();
    }

    const level = lastGoodPayload.localPlayer?.level ?? lastGoodPayload.activePlayerLevel ?? 1;
    mayhemLastLevel = level;

    const bundle = loadMayhemBundle();
    if (!bundle?.augments?.length) return;

    let minGap = 0;
    if (active) {
        if (!shouldRunMayhemAutoOcr(level)) {
            if (!mayhemAugmentHudShouldShow()) purgeMayhemOffersFromScreen();
            pushMayhemOverlayPatch();
            return;
        }
        const onScreen = mayhemAugmentHudShouldShow();
        setMayhemOcrRetainOffers(onScreen);
        const rerollPending = isMayhemOcrRerollPending();
        const needThirdCard = mayhemOfferIds.length > 0 && mayhemOfferIds.length < 3;
        minGap = onScreen
            ? rerollPending
                ? 550
                : needThirdCard
                  ? 450
                  : mayhemOfferIds.length >= 3
                    ? 1100
                    : 750
            : 1400;
    } else {
        setMayhemOcrRetainOffers(false);
    }

    const result = await runMayhemMonitorScan(
        mayhemMonitorState,
        {
            now,
            level,
            isDead: !!lastGoodPayload?.localPlayer?.isDead,
            signals,
            liveAugmentIds: mayhemLiveAugmentIds,
            autoOcrAllowed: active ? shouldRunMayhemAutoOcr(level) : true,
            manualScanActive: mayhemManualScanActive(),
        },
        (minMatches) =>
            detectMayhemOffers(
                bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
                minGap,
                { minMatches }
            )
    );
    mayhemMonitorState = result.state;
    // Display ids may keep the last roll while the HUD is open; the counter
    // already used this frame's ids only (frameIds) inside the engine.
    mayhemOfferIds = result.state.displayIds;

    mayhemOfferScanStreak = result.state.scanStreak;
    mayhemOfferFuzzyScore = result.state.fuzzyScore;
    if (mayhemOfferIds.length) setMayhemRollIds(mayhemOfferIds);
    if (result.counted > 0) {
        setMayhemPicksTaken(result.state.counter.picksTaken);
        mayhemPickPhase = { ...mayhemPickPhase, picksTaken: result.state.counter.picksTaken };
        purgeMayhemOffersFromScreen();
    } else if (result.scanned) {
        // A single offer stays as a candidate (`keep`) until a second scan
        // makes it visible or a confirmed empty frame purges it. Invalid
        // frames never purge, so a failed capture cannot reset the streak.
        if (result.hudAction === 'show' || mayhemAugmentHudShouldShow()) {
            if (!mayhemPickSessionActive) beginMayhemPickSession();
        } else if (result.hudAction === 'purge') {
            purgeMayhemOffersFromScreen();
        }
    }
    pushMayhemOverlayPatch();
}

export function clearMayhemOffersForDashboard(): void {
    clearMayhemLiveOffers();
    pushMayhemOverlayPatch();
}

export function getMayhemLiveOfferIds(): string[] {
    return [...mayhemOfferIds];
}

function resetMatchCaches(): void {
    lastChampSelectEnemies = [];
    lastChampSelectSelf = null;
    loadingChampion = null;
    loadingSlot = null;
    champSelectSlot = null;
    matchQueueId = null;
    matchMapId = null;
    prematchStats = null;
    prematchStatsToken += 1;
    loadingSessionToken = 0;
    champSelectHistoryPrefetched = false;
    // Drop the history snapshot too: the next champ select loads a fresh one.
    champSelectSession += 1;
    prematchHistoryCache.reset();
    lastOverlayFingerprint = '';
    lastSentOverlayPayload = null;
    lastGoodPayload = null;
    lastKeepOnTopAt = 0;
    lastLiveProofAt = 0;
    trustedGameTime = 0;
    playMomentSnapshot = null;
    lastPlayOverlayState = null;
    lastEnemySignature = '';
    lastMappedEnemies = null;
    lastPlayMomentsAt = 0;
    lastSentMomentCueContent = '';
    mayhemOfferIds = [];
    mayhemPicksAtWindowOpen = 0;
    mayhemPickSessionActive = false;
    mayhemManualScanUntilMs = 0;
    mayhemUserDismissedUntilMs = 0;
    mayhemAugmentDismissedAt = 0;
    mayhemMonitorState = createMayhemMonitorState();
    mayhemPollStartedThisMatch = false;
    mayhemLiveAugmentIds = [];
    mayhemOfferScanStreak = mayhemMonitorState.scanStreak;
    mayhemOfferFuzzyScore = mayhemMonitorState.fuzzyScore;
    lastModeDetectKey = '';
    setMayhemOcrRetainOffers(false);
    resetMayhemMatchState();
    mayhemBurstUntilMs = 0;
    mayhemLastLevel = 0;
    mayhemWasDead = false;
    mayhemLastEventScanId = 0;
    mayhemEventScanFrom = 0;
    resetMayhemOcrCache();
    stopMayhemPoll();
    resetJungleThreatClock();
    resetSummonerTracker();
    resetCoachCooldowns();
    clipsQueued = 0;
    lastClipQueuedAt = 0;
}

/**
 * Cue content fingerprint for the warm-push gate — every field the HUD renders
 * (id, label, detail, urgency), plus the empty state: when no cues remain,
 * withPlayMoments() returns the plain payload, so this yields '' and the send
 * decision below treats cue retirement as a real change.
 */
function momentCueContent(payload: unknown): string {
    const cues =
        (payload as { momentCues?: Array<{ id: string; label: string; detail: string; urgency: string }> })
            .momentCues || [];
    return cues.map((cue) => `${cue.id}:${cue.label}:${cue.detail}:${cue.urgency}`).join('|');
}

function selfHpFromStats(stats: { currentHealth?: number; maxHealth?: number } | null | undefined): number | null {
    const current = stats?.currentHealth;
    const max = stats?.maxHealth;
    if (typeof current !== 'number' || typeof max !== 'number' || !(max > 0)) return null;
    return Math.max(0, Math.min(1, current / max));
}

function withPlayMoments(payload: ReturnType<typeof buildOverlayPayload>): ReturnType<typeof buildOverlayPayload> {
    const hp = selfHpFromStats(payload.championStats);
    const state = {
        ...payload,
        inGame: true,
        localPlayer: payload.localPlayer ? { ...payload.localPlayer, hpPct: hp } : null,
    } as PlayOverlayState;
    const { cues, recap, snapshot } = tickPlayMoments(playMomentSnapshot, state, lastPlayOverlayState, {
        events: getRecentGameEvents(),
        now: getGameState(),
    });
    lastPlayOverlayState = state;
    playMomentSnapshot = snapshot;
    appendPlayRecap(recap);

    // Live coach: one rule-engine tip per tick at most, riding the same
    // moment-cue channel. Cooldowns reset on match start.
    const coachCue = tickCoachCues(getGameState(), getObjectiveTimers(), {
        gameTime: payload.gameTime || 0,
        level: payload.localPlayer?.level ?? payload.activePlayerLevel ?? 1,
        isDead: payload.localPlayer?.isDead ?? false,
        respawnSec: 0,
        currentGold: payload.localPlayer?.currentGold ?? null,
        enemies: (payload.enemies || []).map((e) => ({
            championName: e.championName,
            level: e.level ?? 0,
            isDead: !!e.isDead,
            kills: e.scores?.kills ?? 0,
            deaths: e.scores?.deaths ?? 0,
        })),
    });

    const allCues = coachCue ? [coachCue, ...cues] : cues;

    // Auto-clip: one fight per tick (kill, death, or steal). The planner
    // caps how many a match can queue so stitching cannot pile up.
    const trigger = pickClipMoment(recap, {
        clipsSoFar: clipsQueued,
        msSinceLast: lastClipQueuedAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastClipQueuedAt,
    });
    if (trigger) {
        clipsQueued += 1;
        lastClipQueuedAt = Date.now();
        queueClip({
            eventMs: Date.now(),
            gameTimeSec: trigger.gameTime,
            label: trigger.label,
            score: trigger.score,
            reasons: trigger.reasons,
        });
    }

    if (!allCues.length) return payload;

    return { ...payload, momentCues: allCues } as ReturnType<typeof buildOverlayPayload>;
}

function phaseHoldMs(phase: string | null): number {
    const key = phase ?? '';
    if (key !== trackedPhase) {
        trackedPhase = key;
        phaseSince = Date.now();
    }
    return phaseSince ? Date.now() - phaseSince : 0;
}

function considerMatchEnd(liveGameTime: number | null): void {
    if (!inGame) return;
    const phase = lcuSocket.phase;
    const silenceMs = lastLiveProofAt > 0 ? Date.now() - lastLiveProofAt : 0;
    const input = {
        phase,
        liveSilenceMs: silenceMs,
        phaseHeldMs: phaseHoldMs(phase),
        liveGameTime,
        trustedGameTime,
    };
    const reason = describeEndMatchReason(input);
    if (reason) {
        lastMatchEndReason = reason;
        endGameSession();
    }
}

function noteLiveClock(gameTime: number): void {
    lastLiveProofAt = Date.now();
    const prev = trustedGameTime;
    if (Number.isFinite(gameTime) && gameTime > trustedGameTime) {
        trustedGameTime = gameTime;
    }
    if (prev < LATE_GAME_SEC && trustedGameTime >= LATE_GAME_SEC && inGame) {
        scheduleLive();
    }
}

/**
 * Silence is what ends a match (see considerMatchEnd), so the proof clock must
 * come from the State Service's own successful reads — not from this tick,
 * which now reads a cache and would otherwise look "fresh" forever.
 */
function syncLiveProofFromStateService(): void {
    const status = getStateServiceStatus();
    if (!status) return;
    if (status.lastSuccessAt > lastLiveProofAt) lastLiveProofAt = status.lastSuccessAt;
}

function holdLastBoard(overlayHidden: boolean, gameTime?: number): void {
    if (!lastGoodPayload || overlayHidden) return;
    const elapsedSec = Math.max(0, (Date.now() - (lastGoodPayload.timestamp || Date.now())) / 1000);
    const nextTime =
        typeof gameTime === 'number' && Number.isFinite(gameTime)
            ? gameTime
            : (lastGoodPayload.gameTime || 0) + elapsedSec;
    const advanced = {
        ...lastGoodPayload,
        gameTime: nextTime,
        timestamp: Date.now(),
    };
    lastGoodPayload = advanced;
    const fp = overlayFingerprint(advanced);
    if (fp === lastOverlayFingerprint) return;
    lastOverlayFingerprint = fp;
    sendFullOverlayUpdate(advanced);
}

function sendFullOverlayUpdate(payload: unknown): void {
    lastSentOverlayPayload = payload;
    sendOverlayUpdate(payload);
}

/**
 * A new overlay page (window-created) or one that just reported it is mounted
 * (page-ready) has no state of its own: re-send the last payload. Before this
 * existed the pre-match loading payload was sent into a page that did not
 * listen yet and was never replayed, so the pet never appeared.
 */
function replayOverlayState(via: string): void {
    if (
        !shouldReplayOverlayState({
            inGame,
            prematchLoading,
            userHidden: isOverlayUserHidden(),
            hasPayload: !!lastSentOverlayPayload,
        })
    ) {
        return;
    }
    if (prematchLoading) {
        overlayLog('prematch-loading replay-loading', { via, phase: lcuSocket.phase ?? 'none' });
    }
    lastOverlayFingerprint = '';
    sendOverlayUpdate(lastSentOverlayPayload);
}

function handleOverlayWindowCreated(): void {
    replayOverlayState('window-created');
}

/** The page's first heartbeat proves React mounted and its listener is bound. */
function handleOverlayPageReady(): void {
    replayOverlayState('page-ready');
}

/**
 * Enter the pre-match loading state once per load: cancel the finished match's
 * delayed window destroy (a quick requeue must not destroy the pet window),
 * clear a hide carried over from the last match, raise the overlay and send the
 * loading payload through sendFullOverlayUpdate so lastSentOverlayPayload can
 * replay it. Stats come from the champ-select cache only — this path issues no
 * LCU request. A reconnect with no known pick resolves it from the gameflow
 * session (one request, that case only).
 */
function enterPrematchLoading(phase: string | null): void {
    // A requeue inside the 12 s window owns the overlay again.
    overlayDestroyGate.cancel();
    if (prematchLoading) return;
    prematchLoading = true;
    prematchStats = null;
    prematchStatsToken += 1;
    loadingSessionToken = prematchStatsToken;
    loadingChampion = lastChampSelectSelf
        ? { championId: lastChampSelectSelf.championId, championName: lastChampSelectSelf.championName }
        : null;
    prematchStats = prematchStatsFromCache(loadingChampion?.championId ?? null);
    // The champ-select order is known at entry; only the gameflow session can
    // add your side, and it lands asynchronously below (never delaying this
    // first payload).
    loadingSlot = null;
    applyLoadingSlot(champSelectSlot);
    matchQueueId = null;
    matchMapId = null;
    const previousHide = isOverlayUserHidden();
    overlayLog('prematch-loading enter', {
        phase: phase ?? 'none',
        userHidden: previousHide,
        champion: loadingChampion ? 'champ-select' : 'unknown',
        stats: prematchStats ? 'cache' : 'none',
    });
    if (previousHide) setOverlayUserHidden(false);
    const settings = settingsForTick();
    if (!settings.overlayEnabled) return;
    // Clearing a hide above shows the overlay, and createOverlayWindow re-reads
    // game.cfg itself, so the scales are right whichever call creates the window.
    syncScalesFromLeague();
    createOverlayWindow();
    showOverlay();
    sendFullOverlayUpdate(prematchLoadingPayload(phase, settings.pet, loadingChampion, prematchStats, loadingSlot, { queueId: matchQueueId, mapId: matchMapId }));
    // One session GET per load, whichever path needs it: a reconnect resolves
    // the pick with it, a champ-select load only learns the side from it.
    if (!loadingChampion) void resolvePrematchChampionFromSession();
    else void resolveLoadingSlotFromSession();
}

/**
 * Leave it. A real match takes over silently (its first board payload follows
 * the same tick). A dodge/cancel has nothing to show, so the overlay is hidden
 * and the loading flag is cleared for the page.
 */
function exitPrematchLoading(reason: string, hide: boolean): void {
    if (!prematchLoading) return;
    prematchLoading = false;
    // Invalidate an in-flight resolution: it belongs to the load we just left.
    prematchStats = null;
    loadingChampion = null;
    loadingSlot = null;
    prematchStatsToken += 1;
    loadingSessionToken = 0;
    overlayLog('prematch-loading exit', { reason });
    if (!hide) return;
    // A dodge/cancel leaves no pick for the next game: drop the stale one so a
    // later reconnect cannot use it. A match takeover keeps it (the live board
    // still reads the pick for the accent and match list).
    lastChampSelectSelf = null;
    hideOverlay();
    // Nothing will draw into the hidden window: give it the same delayed
    // teardown as a finished match. A new load or match start cancels it.
    overlayDestroyGate.schedule();
    sendFullOverlayUpdate({
        inGame: false,
        loading: false,
        enemies: [],
        allies: [],
        cachedChampSelectEnemies: [],
        localPlayer: null,
        timestamp: Date.now(),
    });
}

function ensureOverlayShown(): void {
    if (isOverlayUserHidden() || !settingsForTick().overlayEnabled) return;
    if (!getOverlayWindow()) {
        createOverlayWindow();
        showOverlay();
    }
    healOverlayWindows();
    maybeKeepOverlayOnTop();
    // The single overlay window is never raised on a loop, rebuilt or repaired
    // from here (Step 2 remake): keepOverlayOnTop only re-asserts a lost
    // topmost flag, and the health line in overlay.log is the diagnostic.
}

function maybeKeepOverlayOnTop(): void {
    const now = Date.now();
    if (now - lastKeepOnTopAt < KEEP_ON_TOP_MIN_MS) return;
    lastKeepOnTopAt = now;
    keepOverlayOnTop();
}

function beginMatch(live?: LiveClientAllGameData | null): void {
    console.info('[match] started');
    inGame = true;
    matchStartToken += 1;
    // A live board arrived: the load screen is over, no hide (this is a match).
    exitPrematchLoading('match-start', false);
    let windowMode: string | null = null;
    try {
        windowMode = readLeagueHudScales()?.windowMode ?? null;
    } catch {
        windowMode = null;
    }
    const gameMode = live?.gameData?.gameMode ?? lastGoodPayload?.gameMode ?? null;
    const mapName = live?.gameData?.mapName ?? lastGoodPayload?.mapName ?? null;
    overlayLog('match-start', {
        mode: detectMayhemMode({ gameMode, mapName, queueId: matchQueueId, mapId: matchMapId }),
        queueId: matchQueueId ?? 'unknown',
        mapId: matchMapId ?? 'unknown',
        gameMode: gameMode ?? 'unknown',
        mapName: mapName ?? 'unknown',
        windowMode,
    });
    lastMatchEndReason = null;
    playMomentSnapshot = null;
    lastSentOverlayPayload = null;
    // New match: drop the State Service's event cursor with it. Live Client
    // EventIDs restart at 0 every game, so a stale cursor would swallow the
    // first events of this one.
    resetStateService('match start');
    clearPlayRecap();
    resetJungleThreatClock();
    resetCoachCooldowns();
    setOverlayMatchActive(true);
    // Ring buffer starts recording as the match opens.
    void setClipperActive(true);
    lastLiveProofAt = Date.now();
    overlayDestroyGate.cancel();
    // New match — never stay hidden from a previous manual hide
    setOverlayUserHidden(false);
    if (settingsForTick().overlayEnabled) {
        syncScalesFromLeague();
        // The load screen already created and showed this window. Re-creating
        // or re-showing it at match start flickers the handoff, so reuse it.
        ensureOverlayShown();
    }
    // The Live Client often reports no queue yet. One in-game session read
    // fills queue/map, then the mode is classified again (never during load).
    void resolveMatchQueueAfterStart(matchStartToken);
    try {
        onMatchStartHotkeys?.();
    } catch {
        // ignore
    }
    onGameStateChange?.(true);
}

/**
 * The loading payload usually carries the queue from the champ-select session
 * read. When it is still unknown at match start, spend exactly one
 * `/lol-gameflow/v1/session` GET, then re-run mode detection.
 */
async function resolveMatchQueueAfterStart(token: number): Promise<void> {
    if (matchQueueId != null && matchMapId != null) return;
    let session: unknown = null;
    try {
        session = await makeLCURequest('GET', '/lol-gameflow/v1/session', undefined, 4000);
    } catch {
        return;
    }
    if (token !== matchStartToken || !inGame || !session) return;
    applyQueueMetadata(session);
    if (lastGoodPayload) {
        lastGoodPayload = {
            ...lastGoodPayload,
            queueId: matchQueueId,
            mapId: matchMapId,
        };
    }
    syncMayhemPollForMode({
        ...currentMayhemSignals(),
        level: lastGoodPayload?.localPlayer?.level ?? lastGoodPayload?.activePlayerLevel ?? 1,
        isDead: !!lastGoodPayload?.localPlayer?.isDead,
    });
    pushMayhemOverlayPatch();
}

function syncMayhemPollForMode(signals: {
    gameMode?: string | null;
    mapName?: string | null;
    queueId?: number | null;
    mapId?: number | null;
    level?: number;
    isDead?: boolean;
}): void {
    const mode = logModeDetect({ ...signals, augmentOffersDetected: mayhemOffersDetected() });
    if (isMayhemMode(mode)) {
        if (!mayhemPollTimer) startMayhemPoll();
        return;
    }
    if (isUnknownQueueAram(signals)) {
        // Unknown queue on Howling Abyss: open/continue a bounded discovery
        // burst around the augment windows (level 3/7/11/15 or a death).
        // Classic ARAM (queue 450) never reaches this branch.
        const burst = noteMayhemDiscoveryTrigger(mayhemMonitorState, {
            now: Date.now(),
            level: signals.level ?? 1,
            isDead: signals.isDead === true,
            signals,
        });
        if (burst) {
            if (!mayhemPollTimer) startMayhemPoll();
            return;
        }
    }
    stopMayhemPoll();
}

function endGameSession(): void {
    if (!inGame) return;
    console.info('[match] ended', lastMatchEndReason || '(manual)');
    overlayLog('match-end', { reason: lastMatchEndReason || 'manual' });
    inGame = false;
    // The board cached from the finished game would let a late live tick (or a
    // poll still in flight) restart the whole match lifecycle via beginMatch
    // after the overlay was taken down. Void it: readLiveBoard() is null again.
    clearStateBoard();
    setOverlayMatchActive(false);
    resetMatchCaches();
    // Ring buffer pauses with the match; captured segments stay available.
    void setClipperActive(false);
    hideOverlay();
    // Delay destroy so a brief phase blip mid-game cannot permanently kill the window.
    // A new load/match cancels this gate before the 12 s elapse.
    overlayDestroyGate.schedule();
    sendFullOverlayUpdate({
        inGame: false,
        enemies: [],
        allies: [],
        cachedChampSelectEnemies: [],
        localPlayer: null,
        timestamp: Date.now(),
    });
    onGameStateChange?.(false);
    scheduleLive();
}

/** Should the Live Client be read at all right now, and how often? */
function liveCadence(): number | null {
    const phase = lcuSocket.phase;
    if (inGame || isInGamePhase(phase)) {
        if (isOverlayUserHidden()) return POLL_INGAME_HIDDEN_MS;
        const gt = trustedGameTime || lastGoodPayload?.gameTime || 0;
        return gt >= LATE_GAME_SEC ? POLL_INGAME_LATE_MS : POLL_INGAME_MS;
    }
    // No client to tell us about matches: probe slowly so a running game is still found.
    if (lcuSocket.state === 'searching') return POLL_PROBE_MS;
    return null;
}

function scheduleLive(): void {
    if (!monitorStarted) return;
    // Keep the State Service's slower hidden-HUD sample rate in lockstep with
    // the overlay's visibility and the user's overlay setting.
    setStateServiceHudHidden(isOverlayUserHidden() || !settingsForTick().overlayEnabled);
    const cadence = liveCadence();
    if (cadence === null) {
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = null;
        // Nothing to watch: park the sampler entirely rather than hammer a
        // closed port.
        setStateServiceEngaged(false);
        return;
    }
    setStateServiceEngaged(true);
    if (liveTimer && cadence === currentPollMs) return;
    if (liveTimer) clearTimeout(liveTimer);
    currentPollMs = cadence;
    liveTimer = setTimeout(() => {
        liveTimer = null;
        void liveTick().finally(scheduleLive);
    }, cadence);
}

let tickInFlight = false;

async function liveTick(): Promise<void> {
    if (tickInFlight) return;
    tickInFlight = true;
    // Read settings once per tick: every helper below shares this snapshot.
    tickSettings = getAppSettings();
    const hudBuildStart = performance.now();
    try {
        const phase = lcuSocket.phase;
        // Board comes from the State Service's 400 ms sample loop — no network
        // call on this path. This tick only decides what the HUD should draw.
        const live = readLiveBoard();
        liveReadsTotal += 1;
        syncLiveProofFromStateService();
        const overlayHidden = isOverlayUserHidden();

        if (live) {
            const gameTime = live.gameData?.gameTime ?? 0;
            const wasInGame = inGame;
            if (!wasInGame) beginMatch(live);
            // Decide before noteLiveClock updates the trusted clock, so an
            // advancing game cannot look frozen on the same tick.
            considerMatchEnd(gameTime);
            if (!inGame) return;
            noteLiveClock(gameTime);

            if (!overlayHidden) ensureOverlayShown();

            const payload = buildOverlayPayload(live, phase);
            // Prefer the trusted clock if this payload came back with a stale 0.
            if ((payload.gameTime || 0) < trustedGameTime) {
                payload.gameTime = trustedGameTime;
            }
            syncMayhemPollForMode({
                gameMode: payload.gameMode,
                mapName: payload.mapName,
                queueId: payload.queueId,
                mapId: payload.mapId,
                level: payload.localPlayer?.level ?? payload.activePlayerLevel ?? 1,
                isDead: !!payload.localPlayer?.isDead,
            });
            lastGoodPayload = payload;
            if (overlayHidden) {
                // Slim ping so the main window stays parked as "in match"
                if (!wasInGame) sendOverlayUpdate({ inGame: true, timestamp: Date.now() });
                return;
            }
            const fp = overlayFingerprint(payload);
            const changed = fp !== lastOverlayFingerprint;
            const momentsDue = Date.now() - lastPlayMomentsAt >= PLAY_MOMENTS_MIN_INTERVAL_MS;
            if (changed || momentsDue) {
                // tickPlayMoments / tickCoachCues / clip planning are the
                // expensive side of a tick: run them when a payload is going
                // out anyway, or at the 2s floor so a quiet match (no stat
                // changes) still ages cooldowns and hears coach tips.
                lastPlayMomentsAt = Date.now();
                const enriched = withPlayMoments(payload);
                if (changed) {
                    lastOverlayFingerprint = fp;
                    lastSentMomentCueContent = momentCueContent(enriched);
                    sendFullOverlayUpdate(enriched);
                } else {
                    // No stat changed, but the moment engine may have produced
                    // live cues — or retired the last one (when the last cue
                    // expires withPlayMoments returns the plain payload, so
                    // the empty state is exactly the "clear the HUD rail"
                    // signal). Comparing the cue content — including that
                    // empty state — decides the send: a sticky, unchanged cue
                    // must not force a resend every 2 s.
                    const content = momentCueContent(enriched);
                    if (content !== lastSentMomentCueContent) {
                        lastSentMomentCueContent = content;
                        lastOverlayFingerprint = overlayFingerprint(enriched);
                        sendFullOverlayUpdate(enriched);
                    }
                }
            }
            return;
        }

        // Board read failed at the source (Live Client refused/404'd). The cheap
        // clock is enough to prove the match is still going, and it does not
        // count as silence.
        const clock = readLiveClock();
        liveReadsTotal += 1;
        if (clock) {
            if (!inGame) beginMatch();
            considerMatchEnd(clock.gameTime);
            if (!inGame) return;
            noteLiveClock(clock.gameTime);
            if (!overlayHidden) {
                ensureOverlayShown();
                holdLastBoard(false, clock.gameTime);
            }
            return;
        }

        if (!inGame) return;

        // Both reads failed. Keep the last board on screen. Only a real end
        // (terminal phase that sticks, or a long silence with no in-game phase)
        // takes the overlay down — a few seconds of timeouts must not.
        considerMatchEnd(null);
        if (!inGame) return;
        if (!overlayHidden) ensureOverlayShown();
        holdLastBoard(overlayHidden);
    } finally {
        recordLatency('hud.build', performance.now() - hudBuildStart);
        tickSettings = null;
        tickInFlight = false;
    }
}

function onPhase(phase: string | null): void {
    // Start the hold timer. The next live tick decides, so a phase label is
    // never judged without a chance to see whether the game clock is moving.
    phaseHoldMs(phase);
    // One history prefetch per champ select, on entry. A pick lock retries it
    // through ingestChampSelectSession if the client was still walking in.
    if (phase === 'ChampSelect') {
        if (lastPrefetchPhase !== 'ChampSelect') {
            beginChampSelectSession();
            prefetchHistoryForChampSelect();
        }
    } else {
        champSelectHistoryPrefetched = false;
    }
    lastPrefetchPhase = phase;
    // Loading screen: GameStart, or InProgress before the Live Client answers.
    // Leaving those phases without a live board means the load was dodged or
    // cancelled — take the overlay back down.
    if (isPrematchLoadingPhase(phase, inGame)) {
        enterPrematchLoading(phase);
    } else if (prematchLoading) {
        exitPrematchLoading(`phase-${phase ?? 'none'}`, true);
    }
    if (isInGamePhase(phase) && !liveTimer) {
        // Read immediately rather than waiting a full interval after loading.
        void liveTick().finally(scheduleLive);
        return;
    }
    scheduleLive();
}

/** Immediate overlay/UI refresh after a manual summoner mark. */
export function pushSummonerUpdate(): void {
    lastOverlayFingerprint = '';
    if (inGame) {
        void liveTick();
        return;
    }
    sendFullOverlayUpdate({
        inGame: false,
        enemyBotSummoners: serializeSummoners(),
        timestamp: Date.now(),
    });
}

/** Overlay shown/hidden by the user — adjust the live cadence right away. */
export function refreshLiveCadence(): void {
    scheduleLive();
}

const onStateChange = () => scheduleLive();
const onChampSelect = (session: unknown) => ingestChampSelectSession(session);
/** The client's own summoner event: identity for the reconnect session read. */
const onSummoner = (summoner: unknown) => rememberLocalSummoner(summoner);

export function startGameMonitor(): void {
    if (monitorStarted) return;
    monitorStarted = true;
    // The State Service samples the Live Client; this monitor renders at its own
    // (slower) cadence off the service's cache.
    startStateService();
    syncAutoClip(getAppSettings().autoClip, false);
    lcuSocket.on('phase', onPhase);
    lcuSocket.on('state', onStateChange);
    lcuSocket.on('champSelect', onChampSelect);
    lcuSocket.on('summoner', onSummoner);
    lcuSocket.start();
    overlayWindowCreatedUnsubscribe = onOverlayWindowCreated(handleOverlayWindowCreated);
    setOverlayPageReadyHandler(handleOverlayPageReady);
    // Catch a match that is already running when the app opens.
    void liveTick().finally(scheduleLive);
}

export function stopGameMonitor(): void {
    monitorStarted = false;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
    overlayDestroyGate.cancel();
    if (overlayWindowCreatedUnsubscribe) {
        overlayWindowCreatedUnsubscribe();
        overlayWindowCreatedUnsubscribe = null;
    }
    setOverlayPageReadyHandler(null);
    prematchLoading = false;
    loadingChampion = null;
    prematchStats = null;
    prematchHistoryCache.reset();
    stopMayhemPoll();
    void setClipperActive(false);
    stopStateService();
    lcuSocket.off('phase', onPhase);
    lcuSocket.off('state', onStateChange);
    lcuSocket.off('champSelect', onChampSelect);
    lcuSocket.off('summoner', onSummoner);
    lcuSocket.stop();
}

/** Re-export for main-process IPC handlers that need a one-off LCU read. */
export { makeLCURequest };

export {
    buildOverlayPayload,
    overlayFingerprint,
    withPlayMoments,
    momentCueContent,
    resetMatchCaches,
    liveTick,
};
