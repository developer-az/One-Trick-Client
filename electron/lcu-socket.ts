/**
 * Push-based League Client (LCU) connection.
 *
 * The client exposes a WAMP-style WebSocket on the same port as its REST API.
 * Subscribing to the few events we care about replaces every LCU poll the app
 * used to run (gameflow phase every 2–5 s for the life of the app, champ select
 * every 1.5 s from the renderer). While a match is running the client sends
 * nothing, so One Trick puts zero load on it.
 *
 * Discovery: the lockfile only exists while the client runs, so a cheap
 * `readFile` every few seconds while disconnected is the whole "is League open?"
 * probe — no process scanning in the background.
 */
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
    makeLCURequest,
    readCurrentSummoner,
    readLockfileCredentials,
    readPlatformId,
    setLcuCredentials,
    type LcuCredentials,
} from './lcu-connector';
import {
    activeIdentity,
    identityFromSummoner,
    loadIdentityStore,
    saveIdentityStore,
    statusFor,
    upsertIdentity,
    type RiotIdentityStore,
} from './riot-identity';
import { isInGamePhase } from './match-lifecycle';

/** WAMP opcodes used by the LCU. */
const WAMP_SUBSCRIBE = 5;
const WAMP_EVENT = 8;

const EVENTS = {
    phase: 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase',
    champSelect: 'OnJsonApiEvent_lol-champ-select_v1_session',
    summoner: 'OnJsonApiEvent_lol-summoner_v1_current-summoner',
} as const;

const DISCOVERY_INTERVAL_MS = 3000;
const RECONNECT_DELAY_MS = 2000;
/** Missing lockfile this many probes in a row before an in-game phase is forgotten. */
const LOCKFILE_MISSES_BEFORE_CLEAR = 3;

export type LcuConnectionState = 'searching' | 'connecting' | 'connected';

export interface LcuSummary {
    state: LcuConnectionState;
    phase: string | null;
    summonerName: string | null;
    connectedAt: number | null;
    /**
     * Resolved Riot identity. Optional and duplicated from `LcuStatus` in
     * src/types.d.ts on purpose: the electron project cannot see that file.
     */
    gameName?: string | null;
    tagLine?: string | null;
    puuid?: string | null;
    platformId?: string | null;
    /** Routing region derived from platformId (e.g. euw), for match history. */
    region?: string | null;
    /** `gameName#tagLine`, falling back to summonerName, or null. */
    riotId?: string | null;
}

interface LcuEvents {
    state: [LcuConnectionState];
    phase: [string | null];
    champSelect: [unknown | null];
    summoner: [unknown | null];
}

class LcuSocket extends EventEmitter {
    private ws: WebSocket | null = null;
    private creds: LcuCredentials | null = null;
    private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private stateValue: LcuConnectionState = 'searching';
    private phaseValue: string | null = null;
    private champSelectValue: unknown | null = null;
    private summonerName: string | null = null;
    private connectedAt: number | null = null;
    private lockfileMisses = 0;
    /** Persisted across restarts: rename keeps the record, switch upserts. */
    private identityStore: RiotIdentityStore = loadIdentityStore();
    private liveGameName: string | null = null;
    private liveTagLine: string | null = null;
    private livePuuid: string | null = null;
    private livePlatformId: string | null = null;

    override emit<K extends keyof LcuEvents>(event: K, ...args: LcuEvents[K]): boolean {
        return super.emit(event, ...args);
    }

    override on<K extends keyof LcuEvents>(event: K, listener: (...args: LcuEvents[K]) => void): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    get state(): LcuConnectionState {
        return this.stateValue;
    }

    get phase(): string | null {
        return this.phaseValue;
    }

    get champSelect(): unknown | null {
        return this.champSelectValue;
    }

    summary(): LcuSummary {
        const stored = activeIdentity(this.identityStore);
        const identity = statusFor(
            {
                summonerName: this.summonerName,
                gameName: this.liveGameName,
                tagLine: this.liveTagLine,
                puuid: this.livePuuid,
                platformId: this.livePlatformId,
            },
            stored
        );
        return {
            state: this.stateValue,
            phase: this.phaseValue,
            summonerName: this.summonerName,
            connectedAt: this.connectedAt,
            gameName: identity.gameName,
            tagLine: identity.tagLine,
            puuid: identity.puuid,
            platformId: identity.platformId,
            region: identity.region,
            riotId: identity.label,
        };
    }

    /**
     * Fold a summoner payload into the identity store. The puuid is the key:
     * a rename rewrites the same record, a different account adds a record and
     * moves the active pointer. Nothing here keys off the client pid, so a
     * client restart alone never resets the identity.
     */
    private applySummoner(summoner: unknown, platformId?: string | null): void {
        const src = summoner && typeof summoner === 'object'
            ? (summoner as { gameName?: unknown; displayName?: unknown })
            : {};
        const gameName =
            typeof src.gameName === 'string' && src.gameName
                ? src.gameName
                : typeof src.displayName === 'string' && src.displayName
                    ? src.displayName
                    : null;
        this.summonerName = gameName;

        const identity = identityFromSummoner(summoner, platformId ?? this.livePlatformId);
        if (!identity) return;

        this.liveGameName = identity.gameName;
        this.liveTagLine = identity.tagLine;
        this.livePuuid = identity.puuid;
        if (identity.platformId) this.livePlatformId = identity.platformId;

        this.identityStore = upsertIdentity(this.identityStore, identity);
        try {
            saveIdentityStore(this.identityStore);
        } catch (error) {
            console.warn('[lcu] could not save Riot identity:', error);
        }
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        void this.discover();
    }

    stop(): void {
        this.running = false;
        if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
        this.discoveryTimer = null;
        this.closeSocket();
    }

    /** User pressed "connect" — try now instead of waiting for the next probe. */
    poke(): void {
        if (!this.running || this.stateValue !== 'searching') return;
        if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
        this.discoveryTimer = null;
        void this.discover();
    }

    private setState(next: LcuConnectionState): void {
        if (next === this.stateValue) return;
        console.info(`[lcu] ${this.stateValue} -> ${next}`);
        this.stateValue = next;
        this.emit('state', next);
    }

    private setPhase(next: string | null): void {
        if (next === this.phaseValue) return;
        console.info(`[lcu] phase ${next ?? '(none)'}`);
        this.phaseValue = next;
        this.emit('phase', next);
    }

    private setChampSelect(next: unknown | null): void {
        this.champSelectValue = next;
        this.emit('champSelect', next);
    }

    private scheduleDiscovery(delay = DISCOVERY_INTERVAL_MS): void {
        if (!this.running || this.discoveryTimer) return;
        this.discoveryTimer = setTimeout(() => {
            this.discoveryTimer = null;
            void this.discover();
        }, delay);
    }

    private async discover(): Promise<void> {
        if (!this.running || this.ws) return;
        const creds = await readLockfileCredentials();
        if (!creds) {
            this.setState('searching');
            this.lockfileMisses += 1;
            // One failed lockfile read is not "the game ended". Clear a sticky
            // in-game phase only after the client has actually stayed gone.
            if (!isInGamePhase(this.phaseValue) || this.lockfileMisses >= LOCKFILE_MISSES_BEFORE_CLEAR) {
                this.setPhase(null);
            }
            this.scheduleDiscovery();
            return;
        }
        this.lockfileMisses = 0;
        this.open(creds);
    }

    private open(creds: LcuCredentials): void {
        this.creds = creds;
        setLcuCredentials(creds);
        this.setState('connecting');

        const auth = Buffer.from(`riot:${creds.token}`).toString('base64');
        const ws = new WebSocket(`wss://127.0.0.1:${creds.port}/`, 'wamp', {
            headers: { Authorization: `Basic ${auth}` },
            // The client serves a self-signed Riot certificate on localhost.
            rejectUnauthorized: false,
        });
        this.ws = ws;

        ws.on('open', () => {
            for (const name of Object.values(EVENTS)) {
                ws.send(JSON.stringify([WAMP_SUBSCRIBE, name]));
            }
            this.connectedAt = Date.now();
            this.setState('connected');
            void this.hydrate();
        });

        ws.on('message', (raw) => this.handleMessage(raw.toString()));

        const onGone = () => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.connectedAt = null;
            this.summonerName = null;
            // Keep the persisted identity: a dropped socket or a trip to the
            // login screen should not erase who was last signed in.
            this.liveGameName = null;
            this.liveTagLine = null;
            this.livePuuid = null;
            this.livePlatformId = null;
            setLcuCredentials(null);
            // A dropped socket is not a phase change. While a match is running the
            // client sends nothing, so this socket goes idle and dies mid-game.
            // Forgetting InProgress here is what used to take the overlay down
            // after a few Live Client timeouts. Hydrate() overwrites the phase
            // on the next successful connect.
            if (!isInGamePhase(this.phaseValue)) this.setPhase(null);
            if (this.champSelectValue !== null) this.setChampSelect(null);
            this.setState('searching');
            this.scheduleDiscovery(RECONNECT_DELAY_MS);
        };
        ws.on('close', onGone);
        ws.on('error', () => {
            // 'close' follows; a refused socket usually means the client is still
            // booting and the lockfile was written before the port opened.
            try {
                ws.terminate();
            } catch {
                // ignore
            }
            onGone();
        });
    }

    private closeSocket(): void {
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            try {
                ws.close();
            } catch {
                // ignore
            }
        }
    }

    /** Events only fire on change; read current values once after connecting. */
    private async hydrate(): Promise<void> {
        try {
            const phase = await makeLCURequest('GET', '/lol-gameflow/v1/gameflow-phase');
            this.setPhase(typeof phase === 'string' ? phase : null);
        } catch {
            // Client still booting; the phase event will arrive later.
        }
        try {
            const session = await makeLCURequest('GET', '/lol-champ-select/v1/session');
            if (session) this.setChampSelect(session);
        } catch {
            // Not in champ select.
        }
        try {
            const summoner = await readCurrentSummoner();
            // Re-resolve per connection: a different account can log into the
            // same client, so a cached platformId would carry the wrong region.
            const platformId = (await readPlatformId()) ?? this.livePlatformId;
            if (platformId) this.livePlatformId = platformId;
            this.applySummoner(summoner, platformId);
            this.emit('summoner', summoner);
        } catch {
            // Login screen / client still booting.
        }
    }

    private handleMessage(text: string): void {
        if (!text) return;
        let msg: unknown;
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }
        if (!Array.isArray(msg) || msg[0] !== WAMP_EVENT) return;
        const name = msg[1];
        const payload = msg[2] as { data?: unknown; eventType?: string } | undefined;
        const deleted = payload?.eventType === 'Delete';
        switch (name) {
            case EVENTS.phase: {
                const next = !deleted && typeof payload?.data === 'string' ? payload.data : null;
                // A Delete while InProgress is a socket hiccup, not the scoreboard.
                if (deleted && isInGamePhase(this.phaseValue)) break;
                this.setPhase(next);
                break;
            }
            case EVENTS.champSelect:
                this.setChampSelect(deleted ? null : payload?.data ?? null);
                break;
            case EVENTS.summoner: {
                const data = (deleted ? null : payload?.data) ?? null;
                if (data) {
                    this.applySummoner(data, this.livePlatformId);
                } else {
                    // Logout / login screen: live identity is gone, the stored
                    // record still describes the last signed-in account.
                    this.summonerName = null;
                    this.liveGameName = null;
                    this.liveTagLine = null;
                    this.livePuuid = null;
                    this.livePlatformId = null;
                }
                this.emit('summoner', data);
                break;
            }
            default:
                break;
        }
    }
}

export const lcuSocket = new LcuSocket();
