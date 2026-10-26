import { makeLCURequest } from './lcu-connector';
import { lcuSocket } from './lcu-socket';
import { findLocalPlayer, type LiveClientAllGameData } from './live-client';
import {
    getStateServiceStatus,
    readLiveBoard,
    readLiveClock,
    resetStateService,
    setStateServiceEngaged,
    startStateService,
    stopStateService,
    getGameState,
    getObjectiveTimers,
    getRecentGameEvents,
} from './state-service';
import { tickCoachCues, resetCoachCooldowns } from './coach-cues';
import { setClipperActive, queueClip, syncAutoClip } from './clipper';

/** A play at or above this weighted score becomes a clip trigger (Great+). */
let clipsQueued = 0;
let lastClipQueuedAt = 0;
import {
    describeEndMatchReason,
    isInGamePhase,
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
import { tickPlayMoments, type PlayMomentSnapshot } from '../src/logic/playMoments';
import { pickClipMoment } from '../src/logic/clipper-plan';
import type { PlayOverlayState } from '../src/logic/playMoments';
import { appendPlayRecap, clearPlayRecap } from './play-recap';
import { resetJungleThreatClock } from '../src/logic/jungleLogic';
import { isAramOrMayhem, isMayhemGame } from '../src/logic/mayhem/mode';
import { planMayhemOcr } from '../src/logic/mayhem/augmentSchedule';
import {
    computeMayhemPickPhase,
    nextMayhemPickLevel,
    resolveMayhemPicksTaken,
    type MayhemPickPhase,
} from '../src/logic/mayhem/pickPhase';
import { isMayhemAugmentHudVisible } from '../src/logic/mayhem/visibility';
import { loadMayhemBundle } from './mayhem-data';
import {
    detectMayhemOfferIds,
    isMayhemOcrRerollPending,
    resetMayhemOcrCache,
    setMayhemOcrRetainOffers,
} from './mayhem-ocr';
import {
    getMayhemPicksTaken,
    getOwnedMayhemAugmentIds,
    mergedMayhemOfferIds,
    resetMayhemMatchState,
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
let lastPlayOverlayState: PlayOverlayState | null = null;

export function getLastChampSelectEnemies(): CachedEnemy[] {
    return lastChampSelectEnemies;
}

export function isCurrentlyInGame(): boolean {
    return inGame;
}

export function isMayhemMatchActive(): boolean {
    return (
        inGame &&
        !!lastGoodPayload &&
        isMayhemGame(lastGoodPayload.gameMode, lastGoodPayload.mapName)
    );
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
    if (!isMayhemGame(lastGoodPayload.gameMode, lastGoodPayload.mapName)) return;
    mayhemUserDismissedUntilMs = 0;
    mayhemAugmentDismissedAt = 0;
    const bundle = loadMayhemBundle();
    if (!bundle?.augments?.length) return;
    resetMayhemOcrCache();
    const ids = await detectMayhemOfferIds(
        bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
        0,
        { minMatches: 1 }
    );
    mayhemOfferIds = ids;
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

    const aramMatch = isAramOrMayhem(live?.gameData?.gameMode, live?.gameData?.mapName);
    if (isMayhemGame(live?.gameData?.gameMode, live?.gameData?.mapName) && live) {
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

    const payload = {
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
        timestamp: Date.now(),
    };

    return payload;
}

/** Coarse fingerprint — skip IPC/React work when nothing the HUD cares about changed. */
function overlayFingerprint(payload: ReturnType<typeof buildOverlayPayload>): string {
    const lp = payload.localPlayer;
    const itemKey = (lp?.items || []).map((i) => `${i.itemID}:${i.count}`).join(',');
    const goldBucket = Math.floor((lp?.currentGold ?? 0) / 50);
    const wardScore = Math.floor(lp?.scores?.wardScore ?? 0);
    // Include CS + items so jungle pathing / threat heuristics actually update.
    const itemBucket = Math.floor((payload.gameTime || 0) / 12);
    const enemyKey = (payload.enemies || [])
        .map((e) => {
            const cs = e.scores?.creepScore ?? 0;
            const itemCount = (e.items || []).filter((id) => id && id !== '0').length;
            return `${e.championName}:${e.level}:${e.isDead ? 1 : 0}:${cs}:${itemCount}:${itemBucket}`;
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
    ].join('~');
}

let mayhemOfferIds: string[] = [];
let mayhemPollTimer: ReturnType<typeof setTimeout> | null = null;
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

function mayhemManualScanActive(): boolean {
    return Date.now() < mayhemManualScanUntilMs;
}

function mayhemAugmentHudShouldShow(): boolean {
    const merged = mergedMayhemOfferIds(mayhemOfferIds);
    return isMayhemAugmentHudVisible(merged, mayhemManualScanActive());
}

function clearMayhemLiveOffers(): void {
    mayhemOfferIds = [];
    setMayhemRollIds([]);
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
    const events = live.events?.Events;
    if (events?.length && isMayhemGame(live.gameData?.gameMode, live.gameData?.mapName)) {
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
    if (!lastGoodPayload || !isMayhemGame(lastGoodPayload.gameMode, lastGoodPayload.mapName)) return 15_000;
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
    mayhemLastLevel = 0;
    mayhemBurstUntilMs = 0;
    mayhemWasDead = false;
    mayhemLastEventScanId = 0;
    mayhemEventScanFrom = 0;
    mayhemPicksAtWindowOpen = 0;
    mayhemPickSessionActive = false;
    mayhemManualScanUntilMs = 0;
    mayhemUserDismissedUntilMs = 0;
    mayhemAugmentDismissedAt = 0;
    setMayhemOcrRetainOffers(false);
    resetMayhemMatchState();
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
        timestamp: Date.now(),
    };
    const fp = overlayFingerprint(payload);
    if (fp === lastOverlayFingerprint) return;
    lastGoodPayload = payload;
    lastOverlayFingerprint = fp;
    sendOverlayUpdate(payload);
}

/** Dashboard owned/roll edits — push merged offers without waiting for the next live poll. */
export function notifyMayhemOverlayStateChanged(): void {
    pushMayhemOverlayPatch();
}

async function tickMayhemOcr(): Promise<void> {
    if (!inGame || !lastGoodPayload) return;
    if (!isMayhemGame(lastGoodPayload.gameMode, lastGoodPayload.mapName)) return;
    syncMayhemPickPhaseFromPayload();
    pushMayhemOverlayPatch();

    const level = lastGoodPayload.localPlayer?.level ?? lastGoodPayload.activePlayerLevel ?? 1;
    mayhemLastLevel = level;

    const bundle = loadMayhemBundle();
    if (!bundle?.augments?.length) return;

    if (!shouldRunMayhemAutoOcr(level)) {
        if (!mayhemAugmentHudShouldShow()) purgeMayhemOffersFromScreen();
        pushMayhemOverlayPatch();
        return;
    }

    const onScreen = mayhemAugmentHudShouldShow();
    setMayhemOcrRetainOffers(onScreen);
    const rerollPending = isMayhemOcrRerollPending();
    const needThirdCard = mayhemOfferIds.length > 0 && mayhemOfferIds.length < 3;
    const minGap = onScreen
        ? rerollPending
            ? 550
            : needThirdCard
              ? 450
              : mayhemOfferIds.length >= 3
                ? 1100
                : 750
        : 1400;
    const ids = await detectMayhemOfferIds(
        bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
        minGap,
        { minMatches: 2 }
    );
    mayhemOfferIds = ids;
    if (ids.length) setMayhemRollIds(ids);
    applyMayhemOfferVisibilityAfterOcr();
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
    lastOverlayFingerprint = '';
    lastGoodPayload = null;
    lastKeepOnTopAt = 0;
    lastLiveProofAt = 0;
    trustedGameTime = 0;
    playMomentSnapshot = null;
    lastPlayOverlayState = null;
    mayhemOfferIds = [];
    mayhemPicksAtWindowOpen = 0;
    mayhemPickSessionActive = false;
    mayhemManualScanUntilMs = 0;
    mayhemUserDismissedUntilMs = 0;
    mayhemAugmentDismissedAt = 0;
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

function syncMayhemPollForMode(gameMode?: string, mapName?: string): void {
    if (isMayhemGame(gameMode, mapName)) {
        if (!mayhemPollTimer) startMayhemPoll();
        return;
    }
    stopMayhemPoll();
}

function endGameSession(): void {
    if (!inGame) return;
    console.info('[match] ended', lastMatchEndReason || '(manual)');
    inGame = false;
    setOverlayMatchActive(false);
    resetMatchCaches();
    // Ring buffer pauses with the match; captured segments stay available.
    void setClipperActive(false);
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
            syncMayhemPollForMode(payload.gameMode, payload.mapName);
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

const onStateChange = () => scheduleLive();
const onChampSelect = (session: unknown) => ingestChampSelectSession(session);

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
    lcuSocket.start();
    // Catch a match that is already running when the app opens.
    void liveTick().finally(scheduleLive);
}

export function stopGameMonitor(): void {
    monitorStarted = false;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
    if (destroyOverlayTimer) clearTimeout(destroyOverlayTimer);
    destroyOverlayTimer = null;
    stopMayhemPoll();
    void setClipperActive(false);
    stopStateService();
    lcuSocket.off('phase', onPhase);
    lcuSocket.off('state', onStateChange);
    lcuSocket.off('champSelect', onChampSelect);
    lcuSocket.stop();
}

/** Re-export for main-process IPC handlers that need a one-off LCU read. */
export { makeLCURequest };

export { buildOverlayPayload, overlayFingerprint, withPlayMoments, resetMatchCaches, liveTick };
