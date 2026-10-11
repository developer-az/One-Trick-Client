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
    readLockfileCredentials,
    setLcuCredentials,
    type LcuCredentials,
} from './lcu-connector';

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

export type LcuConnectionState = 'searching' | 'connecting' | 'connected';

export interface LcuSummary {
    state: LcuConnectionState;
    phase: string | null;
    summonerName: string | null;
    connectedAt: number | null;
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
        return {
            state: this.stateValue,
            phase: this.phaseValue,
            summonerName: this.summonerName,
            connectedAt: this.connectedAt,
        };
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
            this.scheduleDiscovery();
            return;
        }
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
            setLcuCredentials(null);
            this.setPhase(null);
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
            const summoner = (await makeLCURequest('GET', '/lol-summoner/v1/current-summoner')) as {
                gameName?: string;
                displayName?: string;
            } | null;
            this.summonerName = summoner?.gameName || summoner?.displayName || null;
            this.emit('summoner', summoner);
        } catch {
            // Login screen.
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
            case EVENTS.phase:
                this.setPhase(!deleted && typeof payload?.data === 'string' ? payload.data : null);
                break;
            case EVENTS.champSelect:
                this.setChampSelect(deleted ? null : payload?.data ?? null);
                break;
            case EVENTS.summoner: {
                const data = (deleted ? null : payload?.data) as { gameName?: string; displayName?: string } | null;
                this.summonerName = data?.gameName || data?.displayName || null;
                this.emit('summoner', data);
                break;
            }
            default:
                break;
        }
    }
}

export const lcuSocket = new LcuSocket();
