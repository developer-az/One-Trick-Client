// Native overlay driver (native-overlay remake).
//
// Owns the offscreen Chromium renderer and the onetrick-presenter.exe
// sidecar. The renderer paints the HUD into bitmaps; this module forwards
// them over a named pipe; the presenter (a plain Win32 layered window)
// puts them on screen. Chromium never owns an on-screen window in this
// backend, so the DWM/MPO presentation path is out of the picture.
//
// One direction only: overlay-window.ts imports this module, never the
// reverse (the overlay URL logic is duplicated here on purpose to avoid a
// require cycle with overlay-window.ts).

import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { overlayLog } from './overlay-log';
import { isWinAlive, safeCall } from './safe-window';
import { nativePresenterPath } from './paths';
import { cropDirtyRect } from './presenter-frame';
import { createPaintThrottle, type PaintRect } from './paint-throttle';
import { PresenterSupervisor } from './presenter-supervisor';

export const PRESENTER_PIPE_NAME = '\\\\.\\pipe\\onetrick-presenter';
export const PRESENTER_PROTOCOL_VERSION = 1;
export const PRESENTER_MSG = {
    HELLO: 1,
    FRAME: 2,
    SHOW: 3,
    HIDE: 4,
    CLICKTHROUGH: 5,
    BOUNDS: 6,
    CAPTURE: 7,
    PING: 8,
    READY: 101,
    PONG: 102,
    ERROR: 103,
} as const;

/** Pipe protocol message types (must match native/presenter/presenter.c). */
const MSG_HELLO = PRESENTER_MSG.HELLO;
const MSG_FRAME = PRESENTER_MSG.FRAME;
const MSG_SHOW = PRESENTER_MSG.SHOW;
const MSG_HIDE = PRESENTER_MSG.HIDE;
const MSG_CLICKTHROUGH = PRESENTER_MSG.CLICKTHROUGH;
const MSG_BOUNDS = PRESENTER_MSG.BOUNDS;
const MSG_CAPTURE = PRESENTER_MSG.CAPTURE;
const MSG_PING = PRESENTER_MSG.PING;
const MSG_READY = PRESENTER_MSG.READY;
const MSG_PONG = PRESENTER_MSG.PONG;
const MSG_ERROR = PRESENTER_MSG.ERROR;

const PROTOCOL_VERSION = PRESENTER_PROTOCOL_VERSION;
/** Same HUD paint budget as the Electron overlay (12 fps shown). */
const NATIVE_FRAME_RATE = 12;
/** Strict main-process throttle window: one forwarded paint per 1000/12 ms. */
const PAINT_THROTTLE_MS = Math.ceil(1000 / NATIVE_FRAME_RATE);
/** Stop forwarding paints while this many bytes are still queued. */
const MAX_QUEUED_BYTES = 12 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_MS = 5_000;
const PING_EVERY_MS = 5_000;
/** No PONG for this long means the presenter is wedged, not merely alive. */
const PING_TIMEOUT_MS = 3 * PING_EVERY_MS;
const CHILD_EXIT_TIMEOUT_MS = 1_500;
/** Presenter-side sanity cap, mirrored here so a corrupt length never allocates blindly. */
const MAX_MESSAGE_BYTES = 256 * 1024 * 1024;

export interface NativeDisplay {
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
}

export interface NativeSurfaceOptions {
    captureProtection: boolean;
    onLoaded: () => void;
    onDown: () => void;
    onFallback: (reason: string) => void;
}

export interface NativeSurfaceStats {
    alive: boolean;
    shown: boolean;
    frames: number;
    framesDropped: number;
    lastFrameAt: number | null;
    respawns: number;
    fallbacks: number;
}

export interface NativeSurfaceHandle {
    webContentsId: number;
    isLive(): boolean;
    isShown(): boolean;
    show(): void;
    hide(): void;
    setClickThrough(on: boolean): void;
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    setDisplay(display: NativeDisplay): void;
    setCaptureProtection(on: boolean): void;
    requestFullFrame(): void;
    refresh(): void;
    respawn(): void;
    fellBack(): boolean;
    destroy(): void;
    stats(): NativeSurfaceStats;
}

export function encodePresenterMessage(type: number, payload: Buffer): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(type, 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
}

/** Streaming parser for presenter replies. Tolerates split deliveries. */
export function createPresenterMessageParser(
    onMessage: (type: number, payload: Buffer) => void
): { push(chunk: Buffer): void } {
    let buffer = Buffer.alloc(0);
    return {
        push(chunk: Buffer): void {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 8) {
                const type = buffer.readUInt32LE(0);
                const len = buffer.readUInt32LE(4);
                if (len > MAX_MESSAGE_BYTES) {
                    throw new Error(`presenter message too large: ${len} bytes`);
                }
                if (buffer.length < 8 + len) return;
                const payload = buffer.subarray(8, 8 + len);
                buffer = buffer.subarray(8 + len);
                onMessage(type, payload);
            }
        },
    };
}

function encodeMessage(type: number, payload: Buffer): Buffer {
    return encodePresenterMessage(type, payload);
}

function encodeU32s(values: number[]): Buffer {
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeUInt32LE(v >>> 0, i * 4));
    return buf;
}

/**
 * Overlay page URL. Duplicated from overlay-window.ts (same rules) so this
 * module stays importable without a require cycle.
 */
function getOverlayUrl(): string {
    const devUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devUrl) return `${devUrl.replace(/\/$/, '')}/overlay.html`;
    if (!app.isPackaged) return 'http://localhost:5173/overlay.html';
    return path.join(process.env.DIST || '', 'overlay.html');
}

function connectPipe(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const attempt = (): void => {
            const socket = net.createConnection(PRESENTER_PIPE_NAME);
            socket.once('connect', () => resolve(socket));
            socket.once('error', (error: unknown) => {
                socket.destroy();
                if (Date.now() - started > CONNECT_TIMEOUT_MS) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return;
                }
                setTimeout(attempt, 250);
            });
        };
        attempt();
    });
}

class NativeSurface implements NativeSurfaceHandle {
    readonly webContentsId: number;
    private osrWin: BrowserWindow;
    private display: NativeDisplay;
    private scaleFactor: number;
    private child: ChildProcess | null = null;
    private socket: net.Socket | null = null;
    private parser = createPresenterMessageParser((type, payload) => this.onReply(type, payload));
    private readyWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
    private alive = false;
    private shown = false;
    private destroyed = false;
    private frames = 0;
    private framesDropped = 0;
    private lastFrameAt: number | null = null;
    private queuedBytes = 0;
    private needsFullFrame = false;
    /** Latest complete paint (Electron 39 OSR always ships a full bitmap). */
    private lastFrame: { bytes: Buffer; width: number; height: number } | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;    /** Last PONG (or READY) from the presenter; 0 before the first handshake. */
    private lastPongAt = 0;
    private lastReloadAt = 0;
    private supervisor = new PresenterSupervisor();
    private spawning: Promise<void> | null = null;
    private fallbackNotified = false;
    private downNoted = false;
    private instance = 0;
    private onLoaded: () => void;
    private onDown: () => void;
    private onFallback: (reason: string) => void;
    private captureProtection: boolean;
    /** Strict paint throttle: drops intermediate paints, merges dirty rects, flushes the latest. */
    private paintThrottle: ReturnType<typeof createPaintThrottle>;
    private paintFlushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(osrWin: BrowserWindow, display: NativeDisplay, opts: NativeSurfaceOptions) {
        this.osrWin = osrWin;
        this.webContentsId = osrWin.webContents.id;
        this.display = display;
        this.scaleFactor = display.scaleFactor || 1;
        this.onLoaded = opts.onLoaded;
        this.onDown = opts.onDown;
        this.onFallback = opts.onFallback;
        this.captureProtection = opts.captureProtection;
        this.paintThrottle = createPaintThrottle(() => Date.now(), PAINT_THROTTLE_MS);
    }

    isLive(): boolean {
        return this.alive && !!this.socket && !this.socket.destroyed && !!this.child && !this.child.killed;
    }

    isShown(): boolean {
        return this.shown;
    }

    stats(): NativeSurfaceStats {
        return {
            alive: this.isLive(),
            shown: this.shown,
            frames: this.frames,
            framesDropped: this.framesDropped,
            lastFrameAt: this.lastFrameAt,
            // The supervisor counts the initial attach as a spawn; health lines
            // must report actual respawns.
            respawns: Math.max(0, this.supervisor.snapshot().respawns - 1),
            fallbacks: this.fallbackNotified ? 1 : 0,
        };
    }

    private send(type: number, payload: Buffer): boolean {
        if (!this.socket || this.socket.destroyed) return false;
        const message = encodeMessage(type, payload);
        this.queuedBytes += message.length;
        const flushed = this.socket.write(message, () => {
            this.queuedBytes = Math.max(0, this.queuedBytes - message.length);
        });
        void flushed;
        return true;
    }

    private physicalWidth(): number {
        return Math.max(1, Math.round(this.display.width * this.scaleFactor));
    }

    private physicalHeight(): number {
        return Math.max(1, Math.round(this.display.height * this.scaleFactor));
    }

    private physicalRect(rect: { x: number; y: number; width: number; height: number }): {
        x: number;
        y: number;
        width: number;
        height: number;
    } {
        return {
            x: Math.round(rect.x * this.scaleFactor),
            y: Math.round(rect.y * this.scaleFactor),
            width: Math.round(rect.width * this.scaleFactor),
            height: Math.round(rect.height * this.scaleFactor),
        };
    }

    async start(): Promise<void> {
        const initial = this.spawnAndConnect();
        this.spawning = initial;
        try {
            await initial;
        } catch (error) {
            // The renderer still arms; respawn() ticks retry with backoff.
            console.warn('[presenter] initial presenter attach failed', error);
            overlayLog('presenter-spawn-failed', { error: String(error), initial: true });
        } finally {
            if (this.spawning === initial) this.spawning = null;
        }
        this.armRenderer();
        this.osrWin.webContents.on('did-finish-load', () => {
            // The window can be torn down between the load event and this
            // callback (post-match destroy races the finished render).
            if (!isWinAlive(this.osrWin)) return;
            safeCall(() => this.osrWin.webContents.startPainting(), (error) => {
                // Older Electron — painting starts on load; log anything else.
                console.warn('[presenter] startPainting failed', error);
            });
            this.requestFullFrame();
            this.onLoaded();
        });
        this.osrWin.webContents.on('paint', (_event, dirtyRect, image) => {
            if (!isWinAlive(this.osrWin)) return;
            this.forwardPaint(dirtyRect, image);
        });
        const url = getOverlayUrl();
        const load = url.startsWith('http') ? this.osrWin.loadURL(url) : this.osrWin.loadFile(url);
        void load.catch((error: unknown) => {
            console.warn('[presenter] overlay load failed', error);
            overlayLog('presenter-load-failed', { error: String(error) });
        });
        this.pingTimer = setInterval(() => {
            if (this.destroyed) return;
            if (this.spawning !== null) return;
            if (!this.isLive()) {
                this.markDown('ping-no-live-presenter');
                return;
            }
            const sinceMs = Date.now() - this.lastPongAt;
            if (sinceMs > PING_TIMEOUT_MS) {
                overlayLog('presenter-ping-timeout', { sinceMs });
                this.markDown('ping-timeout');
                return;
            }
            this.send(MSG_PING, Buffer.alloc(0));
        }, PING_EVERY_MS);
    }

    private async spawnAndConnect(): Promise<void> {
        this.downNoted = false;
        this.instance += 1;
        const token = this.instance;
        this.supervisor.noteStarting(Date.now());
        this.parser = createPresenterMessageParser((type, payload) => this.onReply(type, payload));
        const exe = nativePresenterPath();
        let child: ChildProcess;
        try {
            child = spawn(exe, [], { windowsHide: true });
        } catch (error) {
            this.markDown('spawn-failed');
            throw error;
        }
        this.child = child;
        child.on('error', (error: unknown) => {
            if (token !== this.instance) return;
            console.warn('[presenter] spawn failed', error);
            overlayLog('presenter-spawn-failed', { error: String(error) });
            this.markDown('spawn-failed');
        });
        child.on('exit', (code) => {
            if (token !== this.instance) return;
            overlayLog('presenter-exited', { code });
            this.markDown('child-exited');
        });
        try {
            const socket = await connectPipe();
            if (token !== this.instance || this.destroyed) {
                socket.destroy();
                throw new Error('presenter spawn cancelled');
            }
            this.socket = socket;
            socket.on('data', (chunk: Buffer) => {
                if (token !== this.instance) return;
                try {
                    this.parser.push(chunk);
                } catch (error) {
                    console.warn('[presenter] parser error', error);
                    this.markDown('parser-error');
                }
            });
            socket.on('close', () => {
                if (token !== this.instance) return;
                this.markDown('pipe-closed');
            });
            socket.on('error', (error: unknown) => {
                if (token !== this.instance) return;
                console.warn('[presenter] pipe error', error);
                this.markDown('pipe-error');
            });
            const ready = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.readyWaiter = null;
                    reject(new Error('presenter READY timeout'));
                }, READY_TIMEOUT_MS);
                this.readyWaiter = {
                    resolve: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                    reject: (error: Error) => {
                        clearTimeout(timer);
                        reject(error);
                    },
                };
            });
            const hello = encodeU32s([PROTOCOL_VERSION, this.physicalWidth(), this.physicalHeight()]);
            this.send(MSG_HELLO, hello);
            await ready;
        } catch (error) {
            if (token === this.instance) this.markDown('spawn-connect-failed');
            throw error;
        }
        if (token !== this.instance || this.destroyed) {
            throw new Error('presenter spawn cancelled');
        }
        this.alive = true;
        this.lastPongAt = Date.now();
        this.supervisor.noteReady(Date.now());
        this.send(MSG_CAPTURE, Buffer.from([this.captureProtection ? 1 : 0]));
        this.send(MSG_CLICKTHROUGH, Buffer.from([1]));
        if (this.shown) this.send(MSG_SHOW, Buffer.alloc(0));
        const physical = this.physicalRect({
            x: this.display.x,
            y: this.display.y,
            width: this.display.width,
            height: this.display.height,
        });
        this.send(MSG_BOUNDS, encodeU32s([physical.x, physical.y, physical.width, physical.height]));
        overlayLog('presenter-spawned', {
            width: this.physicalWidth(),
            height: this.physicalHeight(),
        });
        // First paint after connect is the full frame.
        this.requestFullFrame();
    }

    private onReply(type: number, payload: Buffer): void {
        if (type === MSG_PONG) {
            // Liveness reply: reset the wedged-presenter clock, nothing else.
            this.lastPongAt = Date.now();
            return;
        }
        if (type === MSG_READY) {
            if (this.readyWaiter) {
                const waiter = this.readyWaiter;
                this.readyWaiter = null;
                waiter.resolve();
            }
            return;
        }
        if (type === MSG_ERROR) {
            const message = payload.toString('utf8');
            console.warn('[presenter] presenter error:', message);
            overlayLog('presenter-error', { message });
            if (this.readyWaiter) {
                const waiter = this.readyWaiter;
                this.readyWaiter = null;
                waiter.reject(new Error(`presenter error: ${message}`));
            }
        }
        // PONG needs no action here.
    }

    private markDown(reason: string): void {
        if (this.downNoted) return;
        this.downNoted = true;
        const wasAlive = this.alive;
        this.alive = false;
        this.supervisor.noteDown(Date.now(), reason);
        if (this.socket) {
            try {
                this.socket.destroy();
            } catch {
                // ignore
            }
            this.socket = null;
        }
        if (wasAlive) {
            overlayLog('presenter-down', { reason });
            this.onDown();
        }
    }

    private forwardPaint(
        dirtyRect: { x: number; y: number; width: number; height: number },
        image: Electron.NativeImage
    ): void {
        // A paint can land just as the offscreen window is destroyed; reading
        // the bitmap off a dead NativeImage throws "Object has been destroyed".
        const size = safeCall(() => image.getSize(), (error) => {
            console.warn('[presenter] paint getSize failed', error);
        });
        const bytes = safeCall(() => image.toBitmap(), (error) => {
            console.warn('[presenter] paint toBitmap failed', error);
        });
        if (!size || !bytes) return;
        // The paint bitmap is the complete frame, so keep it even when this
        // paint is dropped (presenter down, queue full, or throttled): respawn/
        // resize and the throttle flush can then re-send it without waiting
        // for the next dirty rect.
        if (bytes.length === size.width * size.height * 4) {
            this.lastFrame = { bytes, width: size.width, height: size.height };
        }
        if (this.destroyed || !this.isLive()) {
            this.framesDropped++;
            return;
        }
        if (this.queuedBytes > MAX_QUEUED_BYTES) {
            // Queue full: drop this frame but force the next one to be a FULL
            // frame so the presenter never ends up with a hole.
            this.needsFullFrame = true;
            this.framesDropped++;
            return;
        }
        // Strict main-process paint throttle: one forwarded paint per
        // PAINT_THROTTLE_MS window. The leading paint of a window ships
        // immediately; intermediate paints are dropped with their dirty rects
        // merged into a union; the union is always flushed once the window
        // elapses (see flushHeldPaint).
        const shipped = this.paintThrottle.accept(dirtyRect);
        this.schedulePaintFlush();
        if (!shipped) {
            this.framesDropped++;
            return;
        }
        this.shipFrame(shipped);
    }

    private shipFrame(dirtyRect: PaintRect): void {
        if (!this.lastFrame) {
            this.framesDropped++;
            return;
        }
        // The dirty rect is already in physical pixels of this bitmap; ship
        // exactly that sub-rectangle so the presenter pastes it at (x, y).
        const cropped = cropDirtyRect(this.lastFrame.bytes, this.lastFrame.width, this.lastFrame.height, dirtyRect);
        if (!cropped) {
            // Corrupt bitmap or empty rect — never send a broken frame.
            this.framesDropped++;
            return;
        }
        const header = encodeU32s([cropped.x, cropped.y, cropped.width, cropped.height]);
        if (!this.send(MSG_FRAME, Buffer.concat([header, cropped.data]))) {
            this.framesDropped++;
            return;
        }
        this.frames++;
        this.lastFrameAt = Date.now();
        if (this.needsFullFrame) {
            this.needsFullFrame = false;
            this.requestFullFrame();
        }
    }

    /** Arm (once) the timer that flushes the throttled paint union at window close. */
    private schedulePaintFlush(): void {
        const at = this.paintThrottle.flushAt();
        if (at === null) {
            if (this.paintFlushTimer) {
                clearTimeout(this.paintFlushTimer);
                this.paintFlushTimer = null;
            }
            return;
        }
        if (this.paintFlushTimer) return;
        const wait = Math.max(0, at - Date.now());
        this.paintFlushTimer = setTimeout(() => {
            this.paintFlushTimer = null;
            this.flushHeldPaint();
        }, wait);
    }

    /** Flush the throttled union — the "final one" is always sent at window close. */
    private flushHeldPaint(): void {
        if (this.destroyed || !this.isLive()) return;
        const rect = this.paintThrottle.flush();
        if (!rect) return;
        if (this.queuedBytes > MAX_QUEUED_BYTES) {
            this.needsFullFrame = true;
            this.framesDropped++;
            return;
        }
        this.shipFrame(rect);
    }

    private resendLastFrame(): void {
        if (this.destroyed || !this.isLive() || !this.lastFrame) return;
        // The OSR image can be a pixel larger than the presenter surface (DPI
        // rounding); the presenter clips, so no size-equality guard here.
        if (this.queuedBytes > MAX_QUEUED_BYTES) return;
        const header = encodeU32s([0, 0, this.lastFrame.width, this.lastFrame.height]);
        if (!this.send(MSG_FRAME, Buffer.concat([header, this.lastFrame.bytes]))) return;
        this.frames++;
        this.lastFrameAt = Date.now();
    }

    requestFullFrame(): void {
        if (this.destroyed || this.osrWin.isDestroyed()) return;
        try {
            this.osrWin.webContents.invalidate();
        } catch {
            // Renderer not ready yet — the next paint covers it.
        }
        this.resendLastFrame();
    }

    show(): void {
        this.shown = true;
        if (this.isLive()) {
            this.send(MSG_SHOW, Buffer.alloc(0));
            this.requestFullFrame();
        }
    }

    hide(): void {
        this.shown = false;
        if (this.isLive()) this.send(MSG_HIDE, Buffer.alloc(0));
    }

    setClickThrough(on: boolean): void {
        if (this.isLive()) this.send(MSG_CLICKTHROUGH, Buffer.from([on ? 1 : 0]));
    }

    setBounds(rect: { x: number; y: number; width: number; height: number }): void {
        const physical = this.physicalRect(rect);
        this.display = { ...rect, scaleFactor: this.scaleFactor };
        if (this.isLive()) {
            this.send(MSG_BOUNDS, encodeU32s([physical.x, physical.y, physical.width, physical.height]));
            this.requestFullFrame();
        }
    }

    setDisplay(display: NativeDisplay): void {
        if (this.destroyed) return;
        this.display = { ...display };
        this.scaleFactor = display.scaleFactor || 1;
        const bounds = { x: display.x, y: display.y, width: display.width, height: display.height };
        if (!this.osrWin.isDestroyed()) {
            try {
                this.osrWin.setBounds(bounds);
            } catch {
                // The offscreen window can vanish during a display change.
            }
        }
        if (!this.isLive()) return;
        const physical = this.physicalRect(bounds);
        this.send(MSG_BOUNDS, encodeU32s([physical.x, physical.y, physical.width, physical.height]));
        this.requestFullFrame();
    }

    refresh(): void {
        if (!this.isLive()) return;
        this.send(MSG_CLICKTHROUGH, Buffer.from([1]));
        const physical = this.physicalRect({
            x: this.display.x,
            y: this.display.y,
            width: this.display.width,
            height: this.display.height,
        });
        this.send(MSG_BOUNDS, encodeU32s([physical.x, physical.y, physical.width, physical.height]));
        if (this.shown) this.send(MSG_SHOW, Buffer.alloc(0));
        this.requestFullFrame();
    }

    setCaptureProtection(on: boolean): void {
        this.captureProtection = on;
        if (this.isLive()) this.send(MSG_CAPTURE, Buffer.from([on ? 1 : 0]));
    }

    respawn(): void {
        if (this.destroyed || this.osrWin.isDestroyed()) return;
        if (this.spawning) return;
        const action = this.supervisor.decide(Date.now(), { wanted: !this.destroyed });
        if (action.kind === 'none' || action.kind === 'wait') return;
        if (action.kind === 'fallback') {
            overlayLog('presenter-fallback', { reason: action.reason });
            if (!this.fallbackNotified) {
                this.fallbackNotified = true;
                this.onFallback(action.reason);
            }
            return;
        }
        // The supervisor's attempt counts the initial attach; log human attempts.
        overlayLog('presenter-respawned', { attempt: action.attempt - 1 });
        const task = this.runRespawn();
        this.spawning = task;
        void task
            .catch((error: unknown) => {
                console.warn('[presenter] respawn failed', error);
                overlayLog('presenter-spawn-failed', { error: String(error), respawn: true });
            })
            .finally(() => {
                if (this.spawning === task) this.spawning = null;
            });
    }

    fellBack(): boolean {
        return this.fallbackNotified || this.supervisor.snapshot().fellBack;
    }

    private async runRespawn(): Promise<void> {
        await this.disposePresenter();
        if (this.destroyed) return;
        await this.spawnAndConnect();
        if (this.shown) this.send(MSG_SHOW, Buffer.alloc(0));
        const physical = this.physicalRect({
            x: this.display.x,
            y: this.display.y,
            width: this.display.width,
            height: this.display.height,
        });
        this.send(MSG_BOUNDS, encodeU32s([physical.x, physical.y, physical.width, physical.height]));
        this.requestFullFrame();
    }

    private async disposePresenter(): Promise<void> {
        const child = this.child;
        const socket = this.socket;
        this.child = null;
        this.socket = null;
        this.alive = false;
        this.instance += 1;
        this.readyWaiter = null;
        if (socket) {
            socket.removeAllListeners();
            try {
                socket.destroy();
            } catch {
                // ignore
            }
        }
        if (!child) return;
        child.removeAllListeners();
        if (child.exitCode !== null || child.signalCode !== null) {
            try {
                child.kill();
            } catch {
                // ignore
            }
            return;
        }
        await new Promise<void>((resolve) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const finish = (): void => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                child.removeListener('exit', finish);
                resolve();
            };
            timer = setTimeout(finish, CHILD_EXIT_TIMEOUT_MS);
            child.once('exit', finish);
            try {
                child.kill();
            } catch {
                finish();
            }
        });
    }

    private armRenderer(): void {
        const contents = this.osrWin.webContents;
        const reload = (): void => {
            if (this.destroyed || this.osrWin.isDestroyed()) return;
            const now = Date.now();
            if (now - this.lastReloadAt < 5_000) return;
            this.lastReloadAt = now;
            const url = getOverlayUrl();
            const load = safeCall(() => (url.startsWith('http') ? this.osrWin.loadURL(url) : this.osrWin.loadFile(url)), (error) => {
                console.warn('[presenter] overlay reload failed', error);
            });
            if (load) {
                void load.catch((error: unknown) => {
                    console.warn('[presenter] overlay reload failed', error);
                });
            }
            overlayLog('presenter-renderer-reload', {});
        };
        contents.on('render-process-gone', (_event, details) => {
            overlayLog('presenter-renderer-exited', {
                reason: details?.reason ?? 'unknown',
                exitCode: details?.exitCode ?? null,
            });
            reload();
        });
        contents.on('unresponsive', () => {
            overlayLog('presenter-renderer-unresponsive', {});
            reload();
        });
        contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) return;
            overlayLog('presenter-load-failed', { errorCode, errorDescription });
            reload();
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.alive = false;
        this.instance += 1;
        this.readyWaiter = null;
        this.lastFrame = null;
        this.paintThrottle.reset();
        if (this.paintFlushTimer) {
            clearTimeout(this.paintFlushTimer);
            this.paintFlushTimer = null;
        }
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.socket) {
            this.socket.removeAllListeners();
            try {
                this.socket.destroy();
            } catch {
                // ignore
            }
            this.socket = null;
        }
        if (this.child) {
            this.child.removeAllListeners();
            try {
                this.child.kill();
            } catch {
                // ignore
            }
            this.child = null;
        }
        if (!this.osrWin.isDestroyed()) {
            try {
                this.osrWin.destroy();
            } catch {
                // ignore
            }
        }
    }
}

/** Create the offscreen renderer window (synchronous; the presenter attaches after). */
export function createOsrWindow(display: NativeDisplay): BrowserWindow {
    const osrWin = new BrowserWindow({
        width: Math.max(1, Math.round(display.width)),
        height: Math.max(1, Math.round(display.height)),
        x: Math.round(display.x),
        y: Math.round(display.y),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        hasShadow: false,
        fullscreenable: false,
        roundedCorners: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            offscreen: true,
            backgroundThrottling: false,
        },
    });
    try {
        osrWin.webContents.setBackgroundThrottling(false);
    } catch {
        // Older Electron — the webPreference already covers it.
    }
    osrWin.webContents.setFrameRate(NATIVE_FRAME_RATE);
    return osrWin;
}

/** Attach the presenter sidecar to an offscreen window created by createOsrWindow. */
export async function attachNativeSurface(
    osrWin: BrowserWindow,
    display: NativeDisplay,
    opts: NativeSurfaceOptions
): Promise<NativeSurfaceHandle> {
    const surface = new NativeSurface(osrWin, display, opts);
    try {
        await surface.start();
    } catch (error) {
        // Never leave a started sidecar/pipe behind when the attach fails
        // (e.g. the window closed while the presenter was starting).
        surface.destroy();
        throw error;
    }
    return surface;
}

export async function createNativeSurface(
    display: NativeDisplay,
    opts: NativeSurfaceOptions
): Promise<NativeSurfaceHandle> {
    const osrWin = createOsrWindow(display);
    return attachNativeSurface(osrWin, display, opts);
}
