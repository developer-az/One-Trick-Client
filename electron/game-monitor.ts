import { connectToLCU, makeLCURequest } from './lcu-connector';
import { fetchLiveClientData, findLocalPlayer, type LiveClientAllGameData } from './live-client';
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

/** True terminal phases — only these end a match immediately. */
const MATCH_OVER_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);

/** Soft lobby phases — only end the match if live client is also gone (strike buffer). */
const LOBBY_PHASES = new Set([
    'Lobby',
    'ChampSelect',
    'ReadyCheck',
    'Matchmaking',
    'None',
]);

/** Gameflow phases where an active match (including Practice Tool) is running. */
const IN_GAME_PHASES = new Set(['InProgress', 'GameStart']);

/** Quiet lobby / menu — rare phase checks only. */
const POLL_IDLE_MS = 5000;
/** Champ select needs faster enemy/summoner ingest. */
const POLL_CHAMPSELECT_MS = 2000;
/** In-game: overlay owns the hot path; ~2.5s keeps cues/wards fresh without thrashing. */
const POLL_INGAME_MS = 2500;
/** In-game with the overlay hidden: still ingest live for timers, but less often. */
const POLL_INGAME_HIDDEN_MS = 8000;
/** Clipboard is a synchronous OS call — never more than once per this window. */
const CLIPBOARD_MIN_INTERVAL_MS = 20000;
/** Soft end requires this many consecutive failed ticks. */
const END_GAME_STRIKES_NEEDED = 4;
/** Re-assert always-on-top at most this often (DWM churn = FPS loss). */
const KEEP_ON_TOP_MIN_MS = 20000;
/** Re-bind PageUp/PageDown hook periodically — Windows can drop it mid-match. */
const HOTKEY_REBIND_MIN_MS = 45000;
/** Lobby/menu LCU reconnect backoff. */
const LCU_RECONNECT_IDLE_MS = 5000;
/**
 * Mid-match reconnect backoff. PowerShell/WMI fallback can freeze the PC for
 * seconds — never thrash it while Live Client is still the source of truth.
 */
const LCU_RECONNECT_INGAME_MS = 45000;

let lastClipboardWrite = 0;
let lastKeepOnTopAt = 0;
let lastHotkeyRebindAt = 0;
/** Last healthy live payload — never clobber the HUD with a null Live Client blip. */
let lastGoodPayload: ReturnType<typeof buildOverlayPayload> | null = null;

export interface CachedEnemy {
    championId: number;
    championName?: string;
    position?: string;
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastChampSelectEnemies: CachedEnemy[] = [];
let inGame = false;
/** Consecutive ticks where the match looked over — avoid destroying overlay on blips. */
let endGameStrikes = 0;
let destroyOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let lastLcuConnectAttempt = 0;
let lastOverlayFingerprint = '';
let currentPollMs = POLL_IDLE_MS;
let onGameStateChange: ((active: boolean) => void) | null = null;
/** Optional hook so main can re-bind PageUp/PageDown when a match starts. */
let onMatchStartHotkeys: (() => void) | null = null;

export function getLastChampSelectEnemies(): CachedEnemy[] {
    return lastChampSelectEnemies;
}

export function isCurrentlyInGame(): boolean {
    return inGame;
}

/** Optional hook so main window can minimize / pause work while League is running. */
export function setGameStateChangeHandler(handler: ((active: boolean) => void) | null): void {
    onGameStateChange = handler;
}

export function setMatchStartHotkeyHandler(handler: (() => void) | null): void {
    onMatchStartHotkeys = handler;
}

/** Attempt (re)connect with backoff. Mid-match uses a long cooldown to avoid PowerShell stalls. */
async function ensureLcuConnected(): Promise<boolean> {
    const now = Date.now();
    const backoff = inGame ? LCU_RECONNECT_INGAME_MS : LCU_RECONNECT_IDLE_MS;
    if (now - lastLcuConnectAttempt < backoff) return false;
    lastLcuConnectAttempt = now;
    try {
        await connectToLCU();
        return true;
    } catch {
        return false;
    }
}

async function pollGameflowPhase(): Promise<string | null> {
    try {
        const phase = await makeLCURequest('GET', '/lol-gameflow/v1/gameflow-phase');
        return typeof phase === 'string' ? phase : null;
    } catch {
        return null;
    }
}

async function cacheChampSelectEnemies(): Promise<void> {
    try {
        const session = await makeLCURequest('GET', '/lol-champ-select/v1/session');
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
        // Auto-fill enemy bot summoner intel while sitting in client
        ingestChampSelectTeam(theirTeam);
    } catch {
        // Not in champ select
    }
}

/** Live champion → profile id. Keep in sync with src/logic/profiles.ts. */
const PROFILE_BY_CHAMPION: Record<string, string> = {
    pyke: 'pyke-support',
    pantheon: 'pantheon-support',
    yone: 'yone-mid',
};

function buildOverlayPayload(live: LiveClientAllGameData | null, gameflowPhase: string | null) {
    const localPlayer = live ? findLocalPlayer(live) : null;
    const localName = (localPlayer?.championName || '').toLowerCase().replace(/[^a-z]/g, '');
    const isPyke = localPlayer ? localName === 'pyke' : true;
    const isYone = localPlayer ? localName === 'yone' : false;
    const profileHint = localPlayer
        ? PROFILE_BY_CHAMPION[localName] ?? null
        : 'pyke-support';

    // Yone Mid tracks enemy mid sums; support profiles track bot + support
    setSummonerFocus(profileHint === 'yone-mid' || isYone ? 'mid' : 'bot');

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
    ingestLivePlayers(enemies);
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
    ingestLiveEvents(live?.events?.Events, nameToChampion);

    // Auto-copy ADC Flash/Heal/Barrier when they come back up. Clipboard writes
    // are a synchronous OS call — throttle so a flapping timer can never turn
    // into a write on every tick while a match is running.
    const clip = consumeSummonerClipboard();
    if (clip && Date.now() - lastClipboardWrite > CLIPBOARD_MIN_INTERVAL_MS) {
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
    lastHotkeyRebindAt = 0;
    resetSummonerTracker();
}

function maybeKeepOverlayOnTop(): void {
    const now = Date.now();
    if (now - lastKeepOnTopAt < KEEP_ON_TOP_MIN_MS) return;
    lastKeepOnTopAt = now;
    keepOverlayOnTop();
}

function maybeRebindHotkeys(): void {
    const now = Date.now();
    if (now - lastHotkeyRebindAt < HOTKEY_REBIND_MIN_MS) return;
    lastHotkeyRebindAt = now;
    try {
        onMatchStartHotkeys?.();
    } catch {
        // ignore
    }
}

function setPollCadence(ms: number): void {
    if (ms === currentPollMs && monitorInterval) return;
    currentPollMs = ms;
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = setInterval(() => {
            void tick();
        }, currentPollMs);
    }
}

function endGameSession(): void {
    inGame = false;
    endGameStrikes = 0;
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
    setPollCadence(POLL_IDLE_MS);
    onGameStateChange?.(false);
}

let tickInFlight = false;

async function tick(): Promise<void> {
    // Guard against overlapping ticks: if LCU/Live Client latency ever exceeds
    // the poll cadence, setInterval would otherwise stack concurrent ticks.
    if (tickInFlight) return;
    tickInFlight = true;
    try {
        // Mid-match: prefer Live Client first. Never spawn a PowerShell LCU
        // reconnect while the game API is healthy — that stalls mouse/input.
        // Always fetch while in-game (even if overlay is hidden) so summoner
        // ingest / timers keep updating.
        let live: LiveClientAllGameData | null = null;
        const overlayHidden = isOverlayUserHidden();
        if (inGame) {
            live = await fetchLiveClientData();
        }

        let phase = await pollGameflowPhase();
        if (phase === null && !(inGame && live)) {
            const reconnected = await ensureLcuConnected();
            if (reconnected) {
                phase = await pollGameflowPhase();
            }
        }

        const phaseInGame = phase ? IN_GAME_PHASES.has(phase) : false;
        const phaseMatchOver = phase ? MATCH_OVER_PHASES.has(phase) : false;
        const phaseLobby = phase ? LOBBY_PHASES.has(phase) : false;
        const phaseChampSelect = phase === 'ChampSelect' || phase === 'ReadyCheck';

        // Champ-select ingest only — skip LCU session reads while sitting in lobby/menus
        if (!inGame && !phaseInGame && phaseChampSelect) {
            await cacheChampSelectEnemies();
            setPollCadence(POLL_CHAMPSELECT_MS);
        } else if (!inGame && !phaseInGame) {
            setPollCadence(POLL_IDLE_MS);
        }

        // Live client is the in-game hot path. Always fetch while we believe a match
        // is running (even if the overlay is hidden) so summoner ingest / timers keep.
        // Skip only on known terminal post-game phases.
        if (live === null && (phaseInGame || phase === null || inGame) && !phaseMatchOver) {
            live = await fetchLiveClientData();
        }
        const liveAvailable = live !== null;

        // Prefer gameflow when known for true end-of-game. Lobby/ChampSelect mid-match
        // must NOT instantly kill the overlay — those blips happen when LCU flaps.
        // Stay in-session on live blips if we already have a good payload.
        const shouldShow =
            phaseInGame ||
            (liveAvailable && !phaseMatchOver && phase === null) ||
            (inGame && !phaseMatchOver && (liveAvailable || !!lastGoodPayload));

        if (shouldShow) {
            const wasInGame = inGame;
            inGame = true;
            if (liveAvailable) endGameStrikes = 0;
            if (destroyOverlayTimer) {
                clearTimeout(destroyOverlayTimer);
                destroyOverlayTimer = null;
            }
            setPollCadence(overlayHidden ? POLL_INGAME_HIDDEN_MS : POLL_INGAME_MS);

            if (!wasInGame) {
                // New match — never stay hidden from a previous manual hide
                setOverlayUserHidden(false);
                syncScalesFromLeague();
                createOverlayWindow();
                showOverlay();
                lastHotkeyRebindAt = Date.now();
                try {
                    onMatchStartHotkeys?.();
                } catch {
                    // ignore
                }
                onGameStateChange?.(true);
            } else if (!overlayHidden) {
                // Self-heal: window was destroyed mid-match — bring it back
                if (!getOverlayWindow()) {
                    createOverlayWindow();
                    showOverlay();
                }
                maybeKeepOverlayOnTop();
                maybeRebindHotkeys();
            } else {
                // Hidden: still refresh hotkeys so PageUp works when they unhide
                maybeRebindHotkeys();
            }

            if (liveAvailable) {
                const payload = buildOverlayPayload(live, phase);
                lastGoodPayload = payload;
                if (overlayHidden) {
                    // Slim ping so the main window stays parked as "in match"
                    if (!wasInGame) {
                        sendOverlayUpdate({ inGame: true, timestamp: Date.now() });
                    }
                } else {
                    const fp = overlayFingerprint(payload);
                    if (fp !== lastOverlayFingerprint) {
                        lastOverlayFingerprint = fp;
                        sendOverlayUpdate(payload);
                    }
                }
            } else if (lastGoodPayload) {
                // Live Client blip — hold last good board (never wipe items/jungle/wards).
                // Advance clock locally so countdowns keep moving; count strikes so a
                // true disconnect still ends the session.
                endGameStrikes += 1;
                if (endGameStrikes >= END_GAME_STRIKES_NEEDED) {
                    endGameSession();
                } else {
                    if (!overlayHidden) {
                        const advanced = {
                            ...lastGoodPayload,
                            gameTime: (lastGoodPayload.gameTime || 0) + currentPollMs / 1000,
                            timestamp: Date.now(),
                        };
                        lastGoodPayload = advanced;
                        const fp = overlayFingerprint(advanced);
                        if (fp !== lastOverlayFingerprint) {
                            lastOverlayFingerprint = fp;
                            sendOverlayUpdate(advanced);
                        }
                    } else if (!wasInGame) {
                        sendOverlayUpdate({ inGame: true, timestamp: Date.now() });
                    }
                }
            } else if (overlayHidden && !wasInGame) {
                sendOverlayUpdate({ inGame: true, timestamp: Date.now() });
            }
        } else if (inGame) {
            // True end-of-game: end immediately.
            // Lobby/ChampSelect/null: only end if live client is also dead for N strikes.
            if (phaseMatchOver) {
                endGameSession();
            } else if (phaseLobby || phase === null) {
                if (!liveAvailable) {
                    endGameStrikes += 1;
                    if (endGameStrikes >= END_GAME_STRIKES_NEEDED) endGameSession();
                } else {
                    endGameStrikes = 0;
                }
            } else {
                endGameStrikes += 1;
                if (endGameStrikes >= END_GAME_STRIKES_NEEDED) endGameSession();
            }
        } else if (!inGame) {
            // Pregame: push bot summoner intel to main UI occasionally (no overlay window)
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
    } finally {
        tickInFlight = false;
    }
}

/** Immediate overlay/UI refresh after a manual summoner mark. */
export function pushSummonerUpdate(): void {
    lastOverlayFingerprint = '';
    if (inGame) {
        void tick();
        return;
    }
    sendOverlayUpdate({
        inGame: false,
        enemyBotSummoners: serializeSummoners(),
        timestamp: Date.now(),
    });
}

export function startGameMonitor(): void {
    if (monitorInterval) return;

    // Do NOT create the overlay window until a match actually starts —
    // a fullscreen transparent always-on-top surface costs DWM composition.

    void tick();
    monitorInterval = setInterval(() => {
        void tick();
    }, currentPollMs);
}

export function stopGameMonitor(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}
