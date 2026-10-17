import { makeLCURequest } from './lcu-connector';
import { lcuSocket } from './lcu-socket';
import {
    fetchLiveClientData,
    fetchLiveGameClock,
    findLocalPlayer,
    type LiveClientAllGameData,
} from './live-client';
import {
    describeEndMatchReason,
    isInGamePhase,
    shouldEndMatch,
} from './match-lifecycle';
import {
    showOverlay,
    hideOverlay,
    sendOverlayUpdate,
    isOverlayUserHidden,
    setOverlayUserHidden,
    createOverlayWindow,
    destroyOverlay,
    getOverlayWindow,
    syncScalesFromLeague,
    keepOverlayOnTop,
    healOverlayWindows,
    setOverlayMatchActive,
} from './overlay-window';
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
import { getAppSettings } from './app-settings';
import { snapshotFromState, tickPlayMoments, type PlayMomentSnapshot } from '../src/logic/playMoments';
import type { PlayOverlayState } from '../src/logic/playMoments';
import { appendPlayRecap, clearPlayRecap } from './play-recap';
import { resetJungleThreatClock } from '../src/logic/jungleLogic';

/**
 * Match lifecycle, driven by League Client events (see lcu-socket.ts).
 *
 * Nothing here polls the League client. The only timer is the Live Client
 * read, and it runs only while a match is in progress (or, when the client
 * can't be found at all, as a slow probe for a running game).
 *
 * A dropped client socket or a few failed Live Client reads must not hide the
 * HUD. The overlay stays up until the post-game phase sticks or the game
 * process has been gone for a long time. See match-lifecycle.ts.
 */

/** In-game: overlay owns the hot path; ~2.5s keeps cues/wards fresh without thrashing. */
const POLL_INGAME_MS = 2500;
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

export interface CachedEnemy {
    championId: number;
    championName?: string;
    position?: string;
}

let monitorStarted = false;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let lastChampSelectEnemies: CachedEnemy[] = [];
let inGame = false;
let destroyOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let lastOverlayFingerprint = '';
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

export function getLastChampSelectEnemies(): CachedEnemy[] {
    return lastChampSelectEnemies;
}

export function isCurrentlyInGame(): boolean {
    return inGame;
}

/** Diagnostics for the performance panel. */
export function getMonitorStats(): {
    inGame: boolean;
    livePollMs: number | null;
    liveReads: number;
    lastEndReason: string | null;
} {
    return {
        inGame,
        livePollMs: liveTimer ? currentPollMs : null,
        liveReads: liveReadsTotal,
        lastEndReason: lastMatchEndReason,
    };
}

/** Optional hook so main window can hide / pause work while League is running. */
export function setGameStateChangeHandler(handler: ((active: boolean) => void) | null): void {
    onGameStateChange = handler;
}

export function setMatchStartHotkeyHandler(handler: (() => void) | null): void {
    onMatchStartHotkeys = handler;
}

function ingestChampSelectSession(session: unknown): void {
    if (!session || typeof session !== 'object') return;
    const theirTeam = (session as {
        theirTeam?: Array<{
            championId?: number;
            championName?: string;
            assignedPosition?: string;
            teamPosition?: string;
            position?: string;
            spell1Id?: number;
            spell2Id?: number;
        }>;
    }).theirTeam;
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
            sendOverlayUpdate({
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

function buildOverlayPayload(live: LiveClientAllGameData | null, gameflowPhase: string | null) {
    const localPlayer = live ? findLocalPlayer(live) : null;
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

    const enemies = enemyPlayers.map((p) => ({
        championName: p.championName,
        level: p.level,
        position: p.position,
        isDead: p.isDead,
        items: p.items?.map((i) => i.displayName) || [],
        scores: p.scores,
        summonerSpells: p.summonerSpells,
    }));

    // Keep lane summoner timers current from live positions + kill events
    ingestLivePlayers(
        enemyPlayers.map((p) => ({
            championName: p.championName,
            position: p.position,
            summonerSpells: p.summonerSpells,
            itemIds: (p.items || []).map((i) => i.itemID),
        }))
    );
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
            clipboard.writeText(clip);
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

    return {
        inGame: true,
        gameflowPhase,
        gameMode: live?.gameData?.gameMode || null,
        gameTime: live?.gameData?.gameTime ?? 0,
        mapName: live?.gameData?.mapName || null,
        localPlayer: localPlayer
            ? {
                  championName: localPlayer.championName,
                  level: localPlayer.level,
                  isDead: localPlayer.isDead,
                  items: localPlayer.items || [],
                  scores: localPlayer.scores,
                  position: localPlayer.position,
                  currentGold: live?.activePlayer?.currentGold ?? 0,
                  summonerSpells: localPlayer.summonerSpells,
              }
            : null,
        isPyke,
        isYone,
        profileHint,
        enemies,
        allies,
        cachedChampSelectEnemies: lastChampSelectEnemies,
        enemyBotSummoners: serializeSummoners(),
        activePlayerLevel: live?.activePlayer?.level ?? localPlayer?.level ?? 0,
        timestamp: Date.now(),
    };
}

/** Coarse fingerprint — skip IPC/React work when nothing the HUD cares about changed. */
function overlayFingerprint(payload: ReturnType<typeof buildOverlayPayload>): string {
    const lp = payload.localPlayer;
    const itemKey = (lp?.items || []).map((i) => `${i.itemID}:${i.count}`).join(',');
    const goldBucket = Math.floor((lp?.currentGold ?? 0) / 50);
    const wardScore = Math.floor(lp?.scores?.wardScore ?? 0);
    // Include CS + items so jungle pathing / threat heuristics actually update.
    const enemyKey = (payload.enemies || [])
        .map((e) => {
            const cs = e.scores?.creepScore ?? 0;
            const items = (e.items || []).slice(0, 6).join(',');
            return `${e.championName}:${e.level}:${e.isDead ? 1 : 0}:${cs}:${items}`;
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
    ].join('~');
}

function resetMatchCaches(): void {
    lastChampSelectEnemies = [];
    lastOverlayFingerprint = '';
    lastGoodPayload = null;
    lastKeepOnTopAt = 0;
    lastLiveProofAt = 0;
    trustedGameTime = 0;
    playMomentSnapshot = null;
    resetJungleThreatClock();
    resetSummonerTracker();
}

function withPlayMoments(payload: ReturnType<typeof buildOverlayPayload>): ReturnType<typeof buildOverlayPayload> {
    const state = { ...payload, inGame: true } as PlayOverlayState;
    const { cues, recap } = tickPlayMoments(playMomentSnapshot, state);
    playMomentSnapshot = snapshotFromState(state);
    appendPlayRecap(recap);
    if (!cues.length) return payload;
    return { ...payload, momentCues: cues } as ReturnType<typeof buildOverlayPayload>;
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
    if (Number.isFinite(gameTime) && gameTime > trustedGameTime) {
        trustedGameTime = gameTime;
    }
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
    sendOverlayUpdate(advanced);
}

function ensureOverlayShown(): void {
    if (isOverlayUserHidden() || !getAppSettings().overlayEnabled) return;
    if (!getOverlayWindow()) {
        createOverlayWindow();
        showOverlay();
    }
    healOverlayWindows();
    maybeKeepOverlayOnTop();
}

function maybeKeepOverlayOnTop(): void {
    const now = Date.now();
    if (now - lastKeepOnTopAt < KEEP_ON_TOP_MIN_MS) return;
    lastKeepOnTopAt = now;
    keepOverlayOnTop();
}

function beginMatch(): void {
    console.info('[match] started');
    inGame = true;
    lastMatchEndReason = null;
    playMomentSnapshot = null;
    clearPlayRecap();
    resetJungleThreatClock();
    setOverlayMatchActive(true);
    lastLiveProofAt = Date.now();
    if (destroyOverlayTimer) {
        clearTimeout(destroyOverlayTimer);
        destroyOverlayTimer = null;
    }
    // New match — never stay hidden from a previous manual hide
    setOverlayUserHidden(false);
    if (getAppSettings().overlayEnabled) {
        syncScalesFromLeague();
        createOverlayWindow();
        showOverlay();
    }
    try {
        onMatchStartHotkeys?.();
    } catch {
        // ignore
    }
    onGameStateChange?.(true);
}

function endGameSession(): void {
    if (!inGame) return;
    console.info('[match] ended', lastMatchEndReason || '(manual)');
    inGame = false;
    setOverlayMatchActive(false);
    resetMatchCaches();
    hideOverlay();
    // Delay destroy so a brief phase blip mid-game cannot permanently kill the window.
    if (destroyOverlayTimer) clearTimeout(destroyOverlayTimer);
    destroyOverlayTimer = setTimeout(() => {
        destroyOverlayTimer = null;
        if (!inGame) destroyOverlay();
    }, 12000);
    sendOverlayUpdate({
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
        return isOverlayUserHidden() ? POLL_INGAME_HIDDEN_MS : POLL_INGAME_MS;
    }
    // No client to tell us about matches: probe slowly so a running game is still found.
    if (lcuSocket.state === 'searching') return POLL_PROBE_MS;
    return null;
}

function scheduleLive(): void {
    if (!monitorStarted) return;
    const cadence = liveCadence();
    if (cadence === null) {
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = null;
        return;
    }
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
    try {
        const phase = lcuSocket.phase;
        const live = await fetchLiveClientData();
        liveReadsTotal += 1;
        const overlayHidden = isOverlayUserHidden();

        if (live) {
            const gameTime = live.gameData?.gameTime ?? 0;
            const wasInGame = inGame;
            if (!wasInGame) beginMatch();
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
            lastGoodPayload = payload;
            if (overlayHidden) {
                // Slim ping so the main window stays parked as "in match"
                if (!wasInGame) sendOverlayUpdate({ inGame: true, timestamp: Date.now() });
                return;
            }
            const fp = overlayFingerprint(payload);
            if (fp !== lastOverlayFingerprint) {
                lastOverlayFingerprint = fp;
                sendOverlayUpdate(withPlayMoments(payload));
            }
            return;
        }

        // allgamedata timed out or 404'd. The cheap clock is enough to prove
        // the match is still going, and it does not count as silence.
        const clock = await fetchLiveGameClock();
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
        tickInFlight = false;
    }
}

function onPhase(phase: string | null): void {
    // Start the hold timer. The next live tick decides, so a phase label is
    // never judged without a chance to see whether the game clock is moving.
    phaseHoldMs(phase);
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
    sendOverlayUpdate({
        inGame: false,
        enemyBotSummoners: serializeSummoners(),
        timestamp: Date.now(),
    });
}

/** Overlay shown/hidden by the user — adjust the live cadence right away. */
export function refreshLiveCadence(): void {
    scheduleLive();
}

export function startGameMonitor(): void {
    if (monitorStarted) return;
    monitorStarted = true;
    lcuSocket.on('phase', onPhase);
    lcuSocket.on('state', () => scheduleLive());
    lcuSocket.on('champSelect', (session) => ingestChampSelectSession(session));
    lcuSocket.start();
    // Catch a match that is already running when the app opens.
    void liveTick().finally(scheduleLive);
}

export function stopGameMonitor(): void {
    monitorStarted = false;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
    lcuSocket.stop();
}

/** Re-export for main-process IPC handlers that need a one-off LCU read. */
export { makeLCURequest };
