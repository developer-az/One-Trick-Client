import { app, BrowserWindow, screen } from 'electron';
import { userDataDir } from './paths';
import fs from 'fs';
import path from 'path';
import { readLeagueHudScales } from './league-settings';
import { overlayWindowFaults, overlayWindowWanted } from './overlay-bounds';
import { overlayLog } from './overlay-log';
import { getAppSettings } from './app-settings';
import { getKeyHookStatus } from './global-key-hook';
import { attachNativeSurface, createOsrWindow, type NativeSurfaceHandle } from './overlay-presenter';
export interface FrameCalibration {
    dx: number;
    dy: number;
    dw: number;
    dh: number;
}

export interface OverlayCalibration {
    ability: FrameCalibration;
    minimap: FrameCalibration;
}

const DEFAULT_CALIBRATION: OverlayCalibration = {
    ability: { dx: 0, dy: 0, dw: 0, dh: 0 },
    minimap: { dx: 0, dy: 0, dw: 0, dh: 0 },
};

let overlayWin: BrowserWindow | null = null;

/**
 * Overlay backend (native-overlay remake, 2026-11-11). 'electron' is the
 * original on-screen Chromium window; 'native' renders the same page
 * offscreen and presents its frames through onetrick-presenter.exe, a
 * plain Win32 layered window. Unlocked/align modes always use the
 * Electron window — the presenter is paint-only.
 */
export type OverlayBackend = 'electron' | 'native';
let backend: OverlayBackend = 'electron';
/** Offscreen renderer window, native backend only. */
let osrWin: BrowserWindow | null = null;
/** Presenter sidecar handle, native backend only. */
let nativeSurface: NativeSurfaceHandle | null = null;
/** Native backend + unlocked/align: the Electron window is the surface. */
let electronSurfaceActive = false;

/** The native surface presents locked mode. Anything else is the Electron window. */
function isNativeLocked(): boolean {
    return backend === 'native' && process.platform === 'win32' && !electronSurfaceActive;
}

/** Packaged build default for the backend (extraMetadata.overlayBackend). */
function readPackagedOverlayBackend(): OverlayBackend | null {
    if (!app.isPackaged) return null;
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')
        ) as { overlayBackend?: unknown };
        if (pkg.overlayBackend === 'native' || pkg.overlayBackend === 'electron') {
            return pkg.overlayBackend;
        }
    } catch {
        // No packaged default — fall through to electron.
    }
    return null;
}

export function getOverlayBackend(): OverlayBackend {
    ensureSettingsLoaded();
    return backend;
}

/** Takes effect on the next surface creation (createOverlayWindow). */
export function setOverlayBackend(next: OverlayBackend): OverlayBackend {
    ensureSettingsLoaded();
    backend = next;
    saveSettings();
    return backend;
}

/**
 * The overlay is a single window (Step 2 remake, 2026-11-10). The list shape
 * stays so the module's loops read as before; it never holds more than one.
 */
function overlayWindows(): BrowserWindow[] {
    return overlayWin && !overlayWin.isDestroyed() ? [overlayWin] : [];
}

/** Shown HUD rate. The clock moves once a second; 60 software frames of a transparent window hitch League. */
const OVERLAY_SHOWN_FPS = 12;

/**
 * Visible windows paint at a low HUD rate. Hidden ones are throttled so a
 * transparent Chromium process is not compositing while League has the screen.
 */
function applyWindowPaintBudget(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const shown = win.isVisible();
    try {
        win.webContents.setBackgroundThrottling(!shown);
        win.webContents.setFrameRate(shown ? OVERLAY_SHOWN_FPS : 1);
    } catch {
        // Older Electron builds — ignore
    }
}

function syncOverlayPaintBudget(): void {
    for (const win of overlayWindows()) applyWindowPaintBudget(win);
}

/** Last ignore-mouse value applied. Re-binding the same flag freezes the cursor over League. */
const mouseIgnored = new WeakMap<BrowserWindow, boolean>();

function setMouseIgnored(win: BrowserWindow, ignored: boolean): void {
    if (win.isDestroyed()) return;
    if (mouseIgnored.get(win) === ignored) return;
    mouseIgnored.set(win, ignored);
    win.setIgnoreMouseEvents(ignored);
}

let clickThrough = true;
let userHidden = false;
/**
 * Whether the overlay page currently has anything to draw. The window stays
 * hidden until it does: an empty transparent window still sits over League's
 * swap chain and keeps DWM compositing the game.
 */
let pageHasContent = false;
/** Delay before an occupied window is allowed to hide, so one empty frame cannot blank the HUD. */
let contentGraceTimer: ReturnType<typeof setTimeout> | null = null;
const EMPTY_HIDE_GRACE_MS = 8_000;
const RENDERER_RELOAD_MIN_MS = 5_000;
const lastRendererReload = new WeakMap<BrowserWindow, number>();

/** Tab is held down (reported by the native key helper). */
let holdDown = false;

/** A match is running (set by the game monitor). */
let matchActive = false;

/** Last report from each overlay page, keyed by webContents id. */
interface OverlayBeat {
    at: number;
    frameAt: number | null;
    pageVisible: boolean;
}
const overlayBeats = new Map<number, OverlayBeat>();
/** Since when the overlay window has been on screen, as seen by the health log. */
let shownSince: number | null = null;
let lastHealthSignature = '';
let lastHealthLogAt = 0;
const HEALTH_LOG_EVERY_MS = 60_000;

/**
 * Match start used to clear the empty set and force every overlay HWND on
 * screen for the whole game. That is the DWM cost this module exists to avoid.
 * Callers still notify match start and end; visibility follows content.
 */
export function setOverlayMatchActive(active: boolean): void {
    matchActive = active;
    // Each match gets a fresh health line.
    lastHealthSignature = '';
    lastHealthLogAt = 0;
}

function lockedLayout(): boolean {
    return clickThrough && !alignMode;
}

/**
 * Hold-to-show applies only when the key helper can see Tab; without it the
 * overlay could never appear, so it falls back to always shown.
 */
export function holdToShowActive(): boolean {
    return getAppSettings().overlayHoldToShow && getKeyHookStatus().mode === 'native';
}

function shouldShowWindow(): boolean {
    return overlayWindowWanted({
        userHidden,
        overlayEnabled: getAppSettings().overlayEnabled,
        locked: lockedLayout(),
        holdToShow: holdToShowActive(),
        holdDown,
        emptySlot: !pageHasContent,
    });
}

/** Tab down/up. Shows or hides the locked overlay windows in hold-to-show mode. */
export function setOverlayHold(down: boolean): void {
    if (holdDown === down) return;
    holdDown = down;
    if (isNativeLocked()) {
        syncNativeVisibility();
        return;
    }
    for (const win of overlayWindows()) {
        try {
            syncWindowVisibility(win);
            if (win.isVisible()) assertAlwaysOnTop(win);
        } catch {
            // ignore
        }
    }
}

/** Exclude overlay windows from screen capture (WDA_EXCLUDEFROMCAPTURE) when the setting is on. */
function applyCaptureProtection(win: BrowserWindow): void {
    try {
        win.setContentProtection(getAppSettings().overlayHideFromCapture);
    } catch {
        // Older Windows builds without capture exclusion — ignore
    }
}

export function refreshOverlayCaptureProtection(): void {
    if (isNativeLocked()) {
        if (nativeSurface) nativeSurface.setCaptureProtection(getAppSettings().overlayHideFromCapture);
        return;
    }
    for (const win of overlayWindows()) applyCaptureProtection(win);
}

/** Re-apply visibility after a setting that affects it changes. */
export function refreshOverlayVisibility(): void {
    if (isNativeLocked()) {
        syncNativeVisibility();
        return;
    }
    for (const win of overlayWindows()) {
        try {
            syncWindowVisibility(win);
        } catch {
            // ignore
        }
    }
}

/** Native-backend mirror of syncWindowVisibility: show/hide the presenter. */
function syncNativeVisibility(): void {
    if (!nativeSurface || !isNativeLocked()) return;
    if (shouldShowWindow()) {
        if (!nativeSurface.isShown()) {
            nativeSurface.show();
            overlayLog('show', {
                backend: 'native',
                reason: 'slot-content',
                userHidden,
                content: pageHasContent,
                holdToShow: holdToShowActive(),
            });
        }
    } else if (nativeSurface.isShown()) {
        nativeSurface.hide();
        overlayLog('hide', {
            backend: 'native',
            reason: 'slot-content',
            userHidden,
            content: pageHasContent,
            holdToShow: holdToShowActive(),
        });
    }
}

function syncWindowVisibility(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const want = shouldShowWindow();
    const visible = win.isVisible();
    if (want && !visible) {
        win.showInactive();
        overlayLog('show', {
            window: win.webContents.id,
            reason: 'slot-content',
            userHidden,
            content: pageHasContent,
            holdToShow: holdToShowActive(),
        });
    } else if (!want && visible) {
        win.hide();
        // Hide/show drops the OS click-through flag. Forget it so the next show re-applies once.
        mouseIgnored.delete(win);
        overlayLog('hide', {
            window: win.webContents.id,
            reason: 'slot-content',
            userHidden,
            content: pageHasContent,
            holdToShow: holdToShowActive(),
        });
    }
    applyWindowPaintBudget(win);
}

/** Renderer reports whether it has anything to draw (see OverlayApp). */
export function setOverlaySlotContent(webContentsId: number, hasContent: boolean): void {
    const isNative =
        isNativeLocked() && !!osrWin && !osrWin.isDestroyed() && osrWin.webContents.id === webContentsId;
    const isElectron =
        !!overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === webContentsId;
    if (!isNative && !isElectron) return;
    if (hasContent) {
        if (contentGraceTimer) {
            clearTimeout(contentGraceTimer);
            contentGraceTimer = null;
        }
        if (!pageHasContent) {
            pageHasContent = true;
            if (isNative) syncNativeVisibility();
            else if (overlayWin) syncWindowVisibility(overlayWin);
        }
        return;
    }
    // Already hidden, or already waiting out a blip.
    if (!pageHasContent || contentGraceTimer) return;
    contentGraceTimer = setTimeout(() => {
        contentGraceTimer = null;
        pageHasContent = false;
        if (isNativeLocked() && osrWin && !osrWin.isDestroyed()) syncNativeVisibility();
        else if (overlayWin && !overlayWin.isDestroyed()) syncWindowVisibility(overlayWin);
    }, EMPTY_HIDE_GRACE_MS);
}

function forgetSlot(webContentsId: number): void {
    overlayBeats.delete(webContentsId);
    if (contentGraceTimer) {
        clearTimeout(contentGraceTimer);
        contentGraceTimer = null;
    }
    pageHasContent = false;
    shownSince = null;
}

function reloadOverlayRenderer(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const now = Date.now();
    const previous = lastRendererReload.get(win) ?? 0;
    if (now - previous < RENDERER_RELOAD_MIN_MS) return;
    lastRendererReload.set(win, now);
    console.warn('[overlay] reloading renderer');
    overlayLog('renderer-reload', { window: win.webContents.id });
    const url = getOverlayUrl();
    const load = url.startsWith('http') ? win.loadURL(url) : win.loadFile(url);
    void load.catch((error: unknown) => {
        console.warn('[overlay] renderer reload failed', error);
        try {
            overlayLog('renderer-reload-failed', { window: win.webContents.id, error: String(error) });
        } catch {
            // ignore
        }
    });
}

function armOverlayRenderer(win: BrowserWindow): void {
    const contentsId = win.webContents.id;
    win.on('closed', () => forgetSlot(contentsId));
    win.webContents.on('render-process-gone', (_event, details) => {
        console.warn('[overlay] renderer exited');
        overlayLog('renderer-exited', {
            window: contentsId,
            reason: details?.reason ?? 'unknown',
            exitCode: details?.exitCode ?? null,
        });
        reloadOverlayRenderer(win);
    });
    win.webContents.on('unresponsive', () => {
        console.warn('[overlay] renderer unresponsive');
        overlayLog('renderer-unresponsive', { window: contentsId });
        reloadOverlayRenderer(win);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        console.warn(`[overlay] load failed (${errorCode} ${errorDescription})`);
        overlayLog('load-failed', { window: contentsId, errorCode, errorDescription });
        reloadOverlayRenderer(win);
    });
}

/**
 * Reload a crashed overlay renderer while a match is running. Visibility is
 * not forced here — keepOverlayOnTop re-shows a window that should be shown,
 * and a window with nothing to draw is hidden on purpose.
 * Does not re-bind mouse passthrough — that path freezes the cursor over League.
 */
export function healOverlayWindows(): void {
    if (userHidden || !getAppSettings().overlayEnabled) return;
    if (holdToShowActive() && !holdDown) return;
    if (isNativeLocked()) {
        // A dead presenter respawns here; the HUD repaints on reconnect.
        if (nativeSurface && !nativeSurface.isLive()) nativeSurface.respawn();
        return;
    }
    if (!overlayWin || overlayWin.isDestroyed()) return;
    try {
        if (overlayWin.webContents.isCrashed()) reloadOverlayRenderer(overlayWin);
    } catch {
        // ignore
    }
}

/**
 * An overlay page reports that it is alive and whether a frame was produced.
 * This is the only signal that separates "shown" from "actually drawn".
 * It is measurement only: since the single-window remake nothing acts on it
 * automatically — the health line in overlay.log is what a human reads.
 */
export function noteOverlayHeartbeat(
    webContentsId: number,
    beat: { frames: boolean; pageVisible: boolean }
): void {
    const isNative =
        isNativeLocked() && !!osrWin && !osrWin.isDestroyed() && osrWin.webContents.id === webContentsId;
    const isElectron =
        !!overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === webContentsId;
    if (!isNative && !isElectron) return;
    const now = Date.now();
    const previous = overlayBeats.get(webContentsId);
    overlayBeats.set(webContentsId, {
        at: now,
        frameAt: beat.frames ? now : previous?.frameAt ?? null,
        pageVisible: beat.pageVisible,
    });
}

/**
 * Once a minute during a match, write what the OS and the page say about
 * the one overlay window to overlay.log. No repairs: if the window is ever
 * presented wrongly again, this line is the evidence, not the fix.
 */
function logOverlayHealth(): void {
    if (!matchActive) return;
    if (isNativeLocked() && nativeSurface) {
        const now = Date.now();
        const stats = nativeSurface.stats();
        const beat = osrWin ? overlayBeats.get(osrWin.webContents.id) : undefined;
        const frameMs = stats.lastFrameAt === null ? null : now - stats.lastFrameAt;
        const faults: string[] = [];
        if (!stats.alive) faults.push('presenter-down');
        if (stats.shown && frameMs !== null && frameMs > 30_000) faults.push('stale-frames');
        const signature = `${stats.shown ? 1 : 0}:${stats.alive ? 1 : 0}:${faults.join('+')}`;
        if (signature === lastHealthSignature && now - lastHealthLogAt < HEALTH_LOG_EVERY_MS) return;
        lastHealthSignature = signature;
        lastHealthLogAt = now;
        overlayLog('health', {
            backend: 'native',
            visible: stats.shown,
            presenterAlive: stats.alive,
            frames: stats.frames,
            framesDropped: stats.framesDropped,
            frameMs,
            beatMs: beat ? now - beat.at : null,
            respawns: stats.respawns,
            faults: faults.length ? faults.join('+') : 'none',
        });
        return;
    }
    const win = overlayWin;
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    const visible = win.isVisible();
    if (!visible) shownSince = null;
    else if (shownSince === null) shownSince = now;
    const beat = overlayBeats.get(win.webContents.id);
    const bounds = win.getBounds();
    const display = overlayDisplay();
    const faults = overlayWindowFaults({
        visible,
        minimized: win.isMinimized(),
        onTop: win.isAlwaysOnTop(),
        boundsOk:
            !lockedLayout() ||
            (bounds.x === display.bounds.x &&
                bounds.y === display.bounds.y &&
                bounds.width === display.bounds.width &&
                bounds.height === display.bounds.height),
        msShown: shownSince === null ? null : now - shownSince,
        msSinceBeat: beat ? now - beat.at : null,
        msSinceFrame: beat?.frameAt != null ? now - beat.frameAt : null,
        pageVisible: beat ? beat.pageVisible : null,
    });
    const signature = `${visible ? 1 : 0}:${faults.join('+')}`;
    if (signature === lastHealthSignature && now - lastHealthLogAt < HEALTH_LOG_EVERY_MS) return;
    lastHealthSignature = signature;
    lastHealthLogAt = now;
    overlayLog('health', {
        window: win.webContents.id,
        visible,
        minimized: win.isMinimized(),
        onTop: win.isAlwaysOnTop(),
        bounds: `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`,
        shownMs: shownSince === null ? null : now - shownSince,
        beatMs: beat ? now - beat.at : null,
        frameMs: beat?.frameAt != null ? now - beat.frameAt : null,
        page: beat ? (beat.pageVisible ? 'visible' : 'hidden') : 'unknown',
        faults: faults.length ? faults.join('+') : 'none',
    });
}


export function getOverlayWindowStats(): { windows: number; visible: number } {
    if (isNativeLocked()) {
        return { windows: 1, visible: nativeSurface && nativeSurface.isShown() ? 1 : 0 };
    }
    const wins = overlayWindows();
    return { windows: wins.length, visible: wins.filter((w) => w.isVisible()).length };
}
let hudScale = 20;
/** Default ~MinimapScale 1.0 (was 88 ≈ 1.82 — caused huge map frame vs HUD). */
let mapScale = 33;
let chromeColor = '#e8b84a';
/** Overlay text scale multiplier (0.85–1.6). Independent of HUD geometry. */
let overlayTextScale = 1;
let gameWidth = 1920;
let gameHeight = 1080;
let calibration: OverlayCalibration = { ...DEFAULT_CALIBRATION, ability: { ...DEFAULT_CALIBRATION.ability }, minimap: { ...DEFAULT_CALIBRATION.minimap } };

export type HudModuleId = 'sums' | 'gank' | 'vision' | 'buy' | 'action' | 'mayhem' | 'frames';
export type HudModules = Record<HudModuleId, boolean>;

const HUD_MODULE_IDS: HudModuleId[] = ['sums', 'gank', 'vision', 'buy', 'action', 'mayhem', 'frames'];
const DEFAULT_HUD_MODULES: HudModules = {
    sums: true,
    gank: true,
    vision: true,
    buy: true,
    action: true,
    mayhem: false,
    frames: false,
};

let hudModules: HudModules = { ...DEFAULT_HUD_MODULES };
let hudLayout: unknown = null;
let settingsLoaded = false;

function normalizeHudModules(value: unknown): HudModules {
    const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const next: HudModules = { ...DEFAULT_HUD_MODULES };
    for (const id of HUD_MODULE_IDS) {
        if (typeof src[id] === 'boolean') next[id] = src[id];
    }
    return next;
}

function normalizeChromeColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toLowerCase() : null;
}

function normalizeFrameCalibration(value: unknown): FrameCalibration | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const nums = ['dx', 'dy', 'dw', 'dh'].map((k) => (Number.isFinite(v[k]) ? Number(v[k]) : 0));
    return { dx: nums[0], dy: nums[1], dw: nums[2], dh: nums[3] };
}
let interactiveBounds: Electron.Rectangle | null = null;

/** Compact unlocked panel — keep small so it never eats the game view. */
const INTERACTIVE_WIDTH = 280;
const INTERACTIVE_HEIGHT = 380;

/**
 * Fullscreen HUD/minimap guide mode (separate from "Unlocked · Move").
 * Unlock = small draggable panel. Align = temporary fullscreen calibration.
 */
let alignMode = false;

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function getOverlayUrl(): string {
    if (VITE_DEV_SERVER_URL) {
        return `${VITE_DEV_SERVER_URL.replace(/\/$/, '')}/overlay.html`;
    }
    if (!app.isPackaged) {
        return 'http://localhost:5173/overlay.html';
    }
    return path.join(process.env.DIST || '', 'overlay.html');
}

export function getOverlayWindow(): BrowserWindow | null {
    // Native locked mode: the hidden Electron panel (if any) is not the
    // surface — callers must see the OSR window or nothing.
    if (isNativeLocked()) {
        return osrWin && !osrWin.isDestroyed() ? osrWin : null;
    }
    if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
    if (osrWin && !osrWin.isDestroyed()) return osrWin;
    return overlayWindows()[0] || null;
}

function widgetsFromSettings(): Array<{
    id: string;
    kind: 'module' | 'sticker';
    xNorm: number;
    yNorm: number;
    scale?: number;
    anchor?: string;
}> {
    const raw = hudLayout && typeof hudLayout === 'object' ? (hudLayout as {
        elements?: Array<{ id?: string; visible?: boolean; x?: number; y?: number; scale?: number; anchor?: string }>;
        stickers?: Array<{ id?: string; x?: number; y?: number; scale?: number }>;
    }) : null;
    const defaults = [
        { id: 'sums', visible: true, x: 0.018, y: 0.078, scale: 1, anchor: 'tl' },
        { id: 'gank', visible: true, x: 0.835, y: 0.078, scale: 1, anchor: 'tr' },
        { id: 'vision', visible: true, x: 0.835, y: 0.26, scale: 1, anchor: 'tr' },
        { id: 'buy', visible: true, x: 0.835, y: 0.42, scale: 1, anchor: 'tr' },
        { id: 'action', visible: true, x: 0.835, y: 0.54, scale: 1, anchor: 'tr' },
        { id: 'mayhem', visible: false, x: 0.835, y: 0.26, scale: 1, anchor: 'tr' },
    ];
    const elements = Array.isArray(raw?.elements) && raw.elements.length ? [...raw.elements] : defaults;
    if (!elements.some((el) => el?.id === 'mayhem')) {
        elements.push({ id: 'mayhem', visible: false, x: 0.835, y: 0.26, scale: 1, anchor: 'tr' });
    }
    const widgets: Array<{
        id: string;
        kind: 'module' | 'sticker';
        xNorm: number;
        yNorm: number;
        scale?: number;
        anchor?: string;
    }> = [];
    for (const el of elements) {
        if (!el?.id || el.id === 'frames') continue;
        const allowed = HUD_MODULE_IDS.includes(el.id as HudModuleId);
        if (!allowed) continue;
        const moduleOn = hudModules[el.id as HudModuleId] !== false && el.visible !== false;
        if (!moduleOn) continue;
        widgets.push({
            id: el.id,
            kind: 'module',
            xNorm: Number.isFinite(el.x) ? Number(el.x) : 0,
            yNorm: Number.isFinite(el.y) ? Number(el.y) : 0,
            scale: typeof el.scale === 'number' ? el.scale : 1,
            anchor: el.anchor,
        });
    }
    for (const sticker of raw?.stickers || []) {
        if (!sticker?.id) continue;
        widgets.push({
            id: sticker.id,
            kind: 'sticker',
            xNorm: Number.isFinite(sticker.x) ? Number(sticker.x) : 0,
            yNorm: Number.isFinite(sticker.y) ? Number(sticker.y) : 0,
            scale: typeof sticker.scale === 'number' ? sticker.scale : 1,
            anchor: 'tl',
        });
    }
    return widgets;
}

/** The display the overlay lives on. Window placement and slot metadata must agree on it. */
function overlayDisplay(): Electron.Display {
    if (overlayWin && !overlayWin.isDestroyed()) {
        return screen.getDisplayMatching(overlayWin.getBounds()) || screen.getPrimaryDisplay();
    }
    return screen.getPrimaryDisplay();
}

/**
 * Locked mode is one window over the whole display. The page lays modules
 * out in display coordinates (see currentSlot), so the window only needs
 * the display's bounds; nothing is created, moved or destroyed when the
 * layout changes — the new layout travels in the next meta broadcast.
 */
function applyLockedBounds(): void {
    const display = overlayDisplay();
    if (isNativeLocked()) {
        if (nativeSurface) nativeSurface.setBounds(display.bounds);
        return;
    }
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.setBounds(display.bounds);
    overlayWin.setMovable(false);
}


export function isOverlayUserHidden(): boolean {
    return userHidden;
}

function settingsPath(): string {
    return path.join(userDataDir(), 'overlay-settings.json');
}

function ensureSettingsLoaded(): void {
    if (settingsLoaded) return;
    loadSettings();
}

function loadSettings(): void {
    settingsLoaded = true;
    // Prefer live League game.cfg (your actual Interface scales)
    const league = readLeagueHudScales();
    if (league) {
        hudScale = league.hudScale;
        mapScale = league.mapScale;
        gameWidth = league.width;
        gameHeight = league.height;
    }

    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as {
            hudScale?: unknown;
            mapScale?: unknown;
            chromeColor?: unknown;
            overlayTextScale?: unknown;
            interactiveBounds?: Electron.Rectangle;
            preferLeagueCfg?: unknown;
            hudModules?: unknown;
            overlayBackend?: unknown;
        };
        // Only override with saved values if user explicitly tuned after import
        // (preferLeagueCfg false). Default: keep League cfg values.
        if (settings.preferLeagueCfg === false) {
            if (typeof settings.hudScale === 'number') {
                hudScale = Math.max(0, Math.min(100, Math.round(settings.hudScale)));
            }
            if (typeof settings.mapScale === 'number') {
                mapScale = Math.max(0, Math.min(100, Math.round(settings.mapScale)));
            }
        }
        const savedColor = normalizeChromeColor(settings.chromeColor);
        if (savedColor) chromeColor = savedColor;
        const savedTextScale = normalizeOverlayTextScale(settings.overlayTextScale);
        if (savedTextScale != null) overlayTextScale = savedTextScale;
        const savedCalibration = settings as { calibration?: { ability?: unknown; minimap?: unknown } };
        if (savedCalibration.calibration) {
            const ability = normalizeFrameCalibration(savedCalibration.calibration.ability);
            const minimap = normalizeFrameCalibration(savedCalibration.calibration.minimap);
            if (ability) calibration.ability = ability;
            if (minimap) calibration.minimap = minimap;
        }
        if (settings.interactiveBounds &&
            Number.isFinite(settings.interactiveBounds.x) &&
            Number.isFinite(settings.interactiveBounds.y) &&
            Number.isFinite(settings.interactiveBounds.width) &&
            Number.isFinite(settings.interactiveBounds.height)) {
            interactiveBounds = settings.interactiveBounds;
        }
        hudModules = normalizeHudModules(settings.hudModules);
        const savedLayout = (settings as { hudLayout?: unknown }).hudLayout;
        if (savedLayout && typeof savedLayout === 'object') hudLayout = savedLayout;
        // Backend: saved setting wins; else the packaged build's default
        // (extraMetadata.overlayBackend — test builds stamp 'native'); else electron.
        if (settings.overlayBackend === 'native' || settings.overlayBackend === 'electron') {
            backend = settings.overlayBackend;
        } else {
            backend = readPackagedOverlayBackend() ?? 'electron';
        }
    } catch {
        // No saved settings yet.
        backend = readPackagedOverlayBackend() ?? 'electron';
    }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced async write — sliders and nudges never block the main thread on disk. */
function persistSettings(preferLeagueCfg: boolean): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        writeSettingsNow(preferLeagueCfg);
    }, 250);
}

function writeSettingsNow(preferLeagueCfg: boolean): void {
    try {
        void fs.promises.writeFile(
            settingsPath(),
            JSON.stringify({
                hudScale,
                mapScale,
                chromeColor,
                overlayTextScale,
                interactiveBounds,
                calibration,
                hudModules,
                hudLayout,
                overlayBackend: backend,
                preferLeagueCfg,
            }),
            'utf8'
        ).catch((error) => console.warn('[overlay] Failed to save settings:', error));
    } catch (error) {
        console.warn('[overlay] Failed to save settings:', error);
    }
}

function saveSettings(): void {
    persistSettings(false);
}

/** Re-read League game.cfg and push scales to overlay + callers. */
export function syncScalesFromLeague(): {
    hudScale: number;
    mapScale: number;
    source?: string;
    gameWidth?: number;
    gameHeight?: number;
} {
    const league = readLeagueHudScales();
    if (league) {
        hudScale = league.hudScale;
        mapScale = league.mapScale;
        gameWidth = league.width;
        gameHeight = league.height;
        try {
            // Must include calibration/etc — this used to omit them and silently
            // wipe the user's saved nudge positions from disk on every game start.
            persistSettings(true);
        } catch {
            // ignore
        }
        if (clickThrough && !alignMode) {
            applyLockedBounds();
        }
        broadcastOverlayMeta();
        return {
            hudScale,
            mapScale,
            source: league.source,
            gameWidth,
            gameHeight,
        };
    }
    return { hudScale, mapScale, gameWidth, gameHeight };
}

const workspacePinned = new WeakSet<BrowserWindow>();

function assertAlwaysOnTop(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    // Blur and the 20s keep-alive both call this. Repeating setAlwaysOnTop
    // while League owns focus is a hitch, so only re-apply what was lost.
    const needsTop = !win.isAlwaysOnTop();
    const needsPin = !workspacePinned.has(win);
    if (!needsTop && !needsPin) return;
    if (needsTop) win.setAlwaysOnTop(true, 'screen-saver');
    if (needsPin) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        workspacePinned.add(win);
    }
}

const overlayWindowCreatedListeners = new Set<() => void>();

/** Fires once per newly created main overlay window, after its renderer loads. */
export function onOverlayWindowCreated(listener: () => void): () => void {
    overlayWindowCreatedListeners.add(listener);
    return () => {
        overlayWindowCreatedListeners.delete(listener);
    };
}

/**
 * Native backend: create the offscreen renderer synchronously (callers need
 * a BrowserWindow back immediately) and attach the presenter sidecar in the
 * background. Frames start flowing once the pipe handshake completes.
 */
function createNativeOverlayWindow(display: Electron.Display): BrowserWindow {
    electronSurfaceActive = false;
    const bounds = display.bounds;
    const win = createOsrWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scaleFactor: display.scaleFactor || 1,
    });
    osrWin = win;
    pageHasContent = false;
    overlayLog('created', { kind: 'main', backend: 'native' });
    win.on('closed', () => {
        forgetSlot(win.webContents.id);
        if (osrWin === win) osrWin = null;
        if (nativeSurface && nativeSurface.webContentsId === win.webContents.id) nativeSurface = null;
    });
    void attachNativeSurface(
        win,
        {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            scaleFactor: display.scaleFactor || 1,
        },
        {
            captureProtection: getAppSettings().overlayHideFromCapture,
            onLoaded: () => {
                broadcastOverlayMeta();
                for (const listener of overlayWindowCreatedListeners) {
                    try {
                        listener();
                    } catch {
                        // A listener must not break overlay startup.
                    }
                }
            },
            onDown: () => {
                // Heal/respawn happens on the next keepOverlayOnTop poll.
            },
        }
    )
        .then((handle) => {
            nativeSurface = handle;
            syncNativeVisibility();
        })
        .catch((error: unknown) => {
            console.warn('[overlay] presenter attach failed', error);
            overlayLog('presenter-spawn-failed', { error: String(error) });
        });
    return win;
}

export function createOverlayWindow(): BrowserWindow {
    loadSettings();
    // Backend-aware early return: in native locked mode the hidden Electron
    // panel (kept for the next unlock) must not satisfy this check.
    if (backend === 'native' && process.platform === 'win32' && clickThrough && !alignMode) {
        if (osrWin && !osrWin.isDestroyed()) {
            return osrWin;
        }
    } else if (overlayWin && !overlayWin.isDestroyed()) {
        return overlayWin;
    }

    // Always re-read game.cfg on overlay create so frames match Interface scales
    syncScalesFromLeague();
    const display = screen.getPrimaryDisplay();

    if (backend === 'native' && process.platform === 'win32' && clickThrough && !alignMode) {
        return createNativeOverlayWindow(display);
    }

    overlayWin = new BrowserWindow({
        width: 260,
        height: 320,
        x: display.bounds.x + 16,
        y: display.bounds.y + 48,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        hasShadow: false,
        fullscreenable: false,
        roundedCorners: false,
        show: false,
        backgroundColor: '#00000000',
        paintWhenInitiallyHidden: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
        },
    });

    pageHasContent = false;
    overlayLog('created', { kind: 'main' });
    assertAlwaysOnTop(overlayWin);
    applyCaptureProtection(overlayWin);

    // Default: a fullscreen click-through surface, so the game is never blocked.
    setClickThrough(true);

    // No OS chrome / context menu — accidental right-clicks must not surface UI that
    // steals focus from League or makes the overlay feel like it "closed".
    overlayWin.setMenu(null);
    overlayWin.webContents.on('context-menu', (e) => {
        e.preventDefault();
    });
    armOverlayRenderer(overlayWin);
    overlayWin.on('blur', () => {
        // Never tear down on blur — just re-assert topmost while supposed to be visible
        if (userHidden || !overlayWin || overlayWin.isDestroyed()) return;
        if (clickThrough && !alignMode) {
            try {
                for (const win of overlayWindows()) {
                    syncWindowVisibility(win);
                    if (win.isVisible()) assertAlwaysOnTop(win);
                }
            } catch {
                // ignore
            }
        }
    });
    let notifiedCreated = false;
    overlayWin.webContents.on('did-finish-load', () => {
        broadcastOverlayMeta();
        if (notifiedCreated) return;
        notifiedCreated = true;
        for (const listener of overlayWindowCreatedListeners) {
            try {
                listener();
            } catch {
                // A listener must not break overlay startup.
            }
        }
    });

    const url = getOverlayUrl();
    if (url.startsWith('http')) {
        overlayWin.loadURL(url);
    } else {
        overlayWin.loadFile(url);
    }

    overlayWin.on('closed', () => {
        overlayWin = null;
    });
    let moveSaveTimer: ReturnType<typeof setTimeout> | null = null;
    overlayWin.on('moved', () => {
        if (clickThrough || !overlayWin || overlayWin.isDestroyed()) return;
        interactiveBounds = overlayWin.getBounds();
        // 'moved' fires repeatedly through a drag gesture — debounce the
        // synchronous disk write instead of blocking the main thread per event.
        if (moveSaveTimer) clearTimeout(moveSaveTimer);
        moveSaveTimer = setTimeout(saveSettings, 300);
    });

    return overlayWin;
}

/**
 * Cheap periodic self-heal: Windows can drop topmost / visibility mid-match.
 * Do NOT re-arm setIgnoreMouseEvents every poll — that causes brief mouse freezes
 * while Windows rebinds the layered-window hit-test path over League.
 */
export function keepOverlayOnTop(): void {
    if (userHidden) return;
    if (isNativeLocked()) {
        if (nativeSurface && !nativeSurface.isLive()) nativeSurface.respawn();
        syncNativeVisibility();
        logOverlayHealth();
        return;
    }
    for (const win of overlayWindows()) {
        try {
            syncWindowVisibility(win);
            if (win.isVisible() && !win.isAlwaysOnTop()) assertAlwaysOnTop(win);
        } catch {
            // ignore
        }
    }
    logOverlayHealth();
}

export function showOverlay(): void {
    if (userHidden || !getAppSettings().overlayEnabled) return;

    const win = createOverlayWindow();
    if (isNativeLocked()) {
        syncNativeVisibility();
        return;
    }
    if (clickThrough && !alignMode) {
        applyLockedBounds();
        syncWindowVisibility(win);
    } else if (!win.isVisible()) {
        win.showInactive();
    }
    syncOverlayPaintBudget();
    assertAlwaysOnTop(win);
    // Re-apply click-through after show — Windows can drop ignore-mouse state on hide/show
    setClickThrough(clickThrough);
    overlayLog('show', { windows: overlayWindows().length, clickThrough, alignMode });
}

export function hideOverlay(): void {
    if (isNativeLocked()) {
        if (nativeSurface) nativeSurface.hide();
        syncOverlayPaintBudget();
        overlayLog('hide', { backend: 'native' });
        return;
    }
    const shown = overlayWindows().filter((win) => win.isVisible()).length;
    for (const win of overlayWindows()) {
        if (win.isVisible()) win.hide();
    }
    // Hidden overlay should not keep a hot compositor path against the game.
    syncOverlayPaintBudget();
    overlayLog('hide', { windows: shown });
}

export function destroyOverlay(): void {
    overlayLog('destroy', { windows: overlayWindows().length, backend: isNativeLocked() ? 'native' : 'electron' });
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        writeSettingsNow(true);
    }
    if (contentGraceTimer) {
        clearTimeout(contentGraceTimer);
        contentGraceTimer = null;
    }
    pageHasContent = false;
    shownSince = null;
    if (isNativeLocked() || nativeSurface || osrWin) {
        if (nativeSurface) {
            nativeSurface.destroy();
            nativeSurface = null;
        }
        if (osrWin && !osrWin.isDestroyed()) {
            osrWin.destroy();
        }
        osrWin = null;
        electronSurfaceActive = false;
    }
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.destroy();
    }
    overlayWin = null;
}

/**
 * Bring the HUD back after the user hid it: show the same window again.
 * Hiding never destroys it, so off/on mid-match cannot churn windows.
 */
export function toggleOverlayVisibility(): boolean {
    userHidden = !userHidden;
    overlayLog('user-hidden', { hidden: userHidden, source: 'toggle' });
    if (userHidden) {
        hideOverlay();
    } else {
        showOverlay();
    }
    broadcastOverlayMeta();
    return !userHidden;
}

export function setOverlayUserHidden(hidden: boolean): void {
    userHidden = hidden;
    overlayLog('user-hidden', { hidden, source: 'set' });
    if (hidden) {
        hideOverlay();
    } else {
        showOverlay();
    }
    broadcastOverlayMeta();
}

function applyFullscreenBounds(): void {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const display = screen.getDisplayMatching(overlayWin.getBounds()) || screen.getPrimaryDisplay();
    overlayWin.setBounds(display.bounds);
    overlayWin.setMovable(false);
}

function applyCompactPanelBounds(): void {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const display = screen.getPrimaryDisplay();
    const fallbackBounds: Electron.Rectangle = {
        x: display.workArea.x + display.workArea.width - INTERACTIVE_WIDTH - 16,
        y: display.workArea.y + 48,
        width: INTERACTIVE_WIDTH,
        height: INTERACTIVE_HEIGHT,
    };
    const target = interactiveBounds || fallbackBounds;
    overlayWin.setBounds({
        x: target.x,
        y: target.y,
        width: INTERACTIVE_WIDTH,
        height: INTERACTIVE_HEIGHT,
    });
    overlayWin.setMovable(true);
}

export function setClickThrough(enabled: boolean): void {
    const wasClickThrough = clickThrough;
    const wasAlign = alignMode;
    clickThrough = enabled;
    if (backend === 'native' && process.platform === 'win32') {
        if (enabled) {
            // Re-locking: back to the native presenter. The Electron window
            // is hidden, not destroyed — destroyOverlay stays the one place
            // a surface is destroyed, and the panel is cheap to re-show.
            alignMode = false;
            electronSurfaceActive = false;
            if (overlayWin && !overlayWin.isDestroyed()) {
                if (!wasClickThrough && !wasAlign) {
                    interactiveBounds = overlayWin.getBounds();
                    saveSettings();
                }
                overlayWin.hide();
            }
            if (!osrWin || osrWin.isDestroyed()) createOverlayWindow();
            syncNativeVisibility();
            broadcastOverlayMeta();
            return;
        }
        // Unlocking: the Electron compact panel is the surface.
        electronSurfaceActive = true;
        alignMode = false;
        if (nativeSurface) nativeSurface.hide();
        if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();
        // Fall through to the existing unlocked handling below.
    }
    if (!overlayWin || overlayWin.isDestroyed()) return;

    if (enabled) {
        // Save only when leaving the compact movable panel (not fullscreen align)
        if (!wasClickThrough && !wasAlign) {
            interactiveBounds = overlayWin.getBounds();
            saveSettings();
        }
        alignMode = false;
        // One window over the whole display (Step 2 remake) — see applyLockedBounds.
        applyLockedBounds();
        overlayWin.setFocusable(false);
        // No { forward: true }: forwarding still routes every mousemove through
        // Chromium for hit-testing, which hitchs the cursor over League. Locked
        // UI is paint-only (pointer-events: none) — OS pass-through is enough.
        setMouseIgnored(overlayWin, true);
        // Never steal focus back from League when re-locking
        if (overlayWin.isVisible()) {
            overlayWin.showInactive();
        }
    } else {
        // Unlocked = compact movable panel (game stays clickable around it)
        alignMode = false;
        applyCompactPanelBounds();
        overlayWin.setFocusable(true);
        setMouseIgnored(overlayWin, false);
        // showInactive — do NOT focus() or League loses input / can flicker the overlay
        overlayWin.showInactive();
    }
    broadcastOverlayMeta();
}

export function toggleClickThrough(): boolean {
    setClickThrough(!clickThrough);
    return clickThrough;
}

export function isClickThrough(): boolean {
    return clickThrough;
}

export function isAlignMode(): boolean {
    return alignMode;
}

/** Fullscreen HUD/minimap guides for calibration — not the same as Unlock/Move. */
export function setAlignMode(enabled: boolean): boolean {
    if (backend === 'native' && process.platform === 'win32') {
        // Align is always the Electron surface (guides need clicks).
        electronSurfaceActive = true;
        if (enabled) {
            alignMode = true;
            clickThrough = false;
            if (nativeSurface) nativeSurface.hide();
            if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();
        }
        // Leaving align falls through to the existing compact-panel handling.
    }
    if (!overlayWin || overlayWin.isDestroyed()) {
        alignMode = enabled;
        return alignMode;
    }

    if (enabled) {
        // Remember compact position if we were in the movable panel
        if (!clickThrough && !alignMode) {
            interactiveBounds = overlayWin.getBounds();
            saveSettings();
        }
        alignMode = true;
        clickThrough = false;
        applyFullscreenBounds();
        overlayWin.setFocusable(true);
        setMouseIgnored(overlayWin, false);
        // showInactive — focus() steals input from League and can freeze the cursor
        overlayWin.showInactive();
    } else {
        alignMode = false;
        // Back to compact movable panel (still unlocked)
        clickThrough = false;
        applyCompactPanelBounds();
        overlayWin.setFocusable(true);
        setMouseIgnored(overlayWin, false);
        overlayWin.showInactive();
    }
    broadcastOverlayMeta();
    return alignMode;
}

export function toggleAlignMode(): boolean {
    return setAlignMode(!alignMode);
}

export function getHudModules(): HudModules {
    ensureSettingsLoaded();
    return { ...hudModules };
}

export function setHudModules(next: unknown): HudModules {
    ensureSettingsLoaded();
    hudModules = normalizeHudModules({ ...hudModules, ...(next && typeof next === 'object' ? next : {}) });
    saveSettings();
    broadcastOverlayMeta();
    return { ...hudModules };
}

export function getHudLayout(): unknown {
    ensureSettingsLoaded();
    return hudLayout;
}

export function setHudLayout(next: unknown): unknown {
    ensureSettingsLoaded();
    if (next && typeof next === 'object') {
        hudLayout = next;
        saveSettings();
        broadcastOverlayMeta();
    }
    return hudLayout;
}

export function getHudScale(): number {
    ensureSettingsLoaded();
    return hudScale;
}

export function setHudScale(scale: number): number {
    hudScale = Math.max(0, Math.min(100, Math.round(scale)));
    saveSettings();
    broadcastOverlayMeta();
    return hudScale;
}

export function getMapScale(): number {
    ensureSettingsLoaded();
    return mapScale;
}

export function setMapScale(scale: number): number {
    mapScale = Math.max(0, Math.min(100, Math.round(scale)));
    saveSettings();
    broadcastOverlayMeta();
    return mapScale;
}

export function getCalibration(): OverlayCalibration {
    return calibration;
}

/** Nudge one dimension (dx/dy/dw/dh) of a frame (ability/minimap) by a pixel delta. Persists + broadcasts. */
export function adjustCalibration(
    target: 'ability' | 'minimap',
    field: keyof FrameCalibration,
    delta: number
): OverlayCalibration {
    if (!Number.isFinite(delta)) return calibration;
    const current = calibration[target][field];
    const next = Math.max(-400, Math.min(400, current + delta));
    calibration = {
        ...calibration,
        [target]: { ...calibration[target], [field]: next },
    };
    saveSettings();
    broadcastOverlayMeta();
    return calibration;
}

export function resetCalibration(): OverlayCalibration {
    calibration = {
        ability: { dx: 0, dy: 0, dw: 0, dh: 0 },
        minimap: { dx: 0, dy: 0, dw: 0, dh: 0 },
    };
    saveSettings();
    broadcastOverlayMeta();
    return calibration;
}

export function getChromeColor(): string {
    ensureSettingsLoaded();
    return chromeColor;
}

/** Clamp to a sane range: below 0.85 is unreadable, above 1.6 the panels outgrow their anchors. */
function normalizeOverlayTextScale(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.round(Math.max(0.85, Math.min(1.6, value)) * 100) / 100;
}

export function getOverlayTextScale(): number {
    ensureSettingsLoaded();
    return overlayTextScale;
}

export function setOverlayTextScale(value: unknown): number {
    const next = normalizeOverlayTextScale(value);
    if (next != null) {
        overlayTextScale = next;
        saveSettings();
        broadcastOverlayMeta();
    }
    return overlayTextScale;
}

export function setChromeColor(color: string): string {
    const next = normalizeChromeColor(color);
    if (next) {
        chromeColor = next;
        saveSettings();
        broadcastOverlayMeta();
    }
    return chromeColor;
}

export function getGameResolution(): { gameWidth: number; gameHeight: number } {
    return { gameWidth, gameHeight };
}

export interface OverlaySlot {
    id: string;
    originX: number;
    originY: number;
    moduleIds: readonly string[];
    stickerIds: readonly string[];
    mode: 'locked' | 'compact' | 'align';
}

/**
 * The one slot the single overlay window renders. Locked mode covers the
 * whole display: the page lays every module out in display coordinates and
 * the window is the display, so the origin is (0, 0) and the module set is
 * the union the per-cluster windows used to split between them (frames
 * excluded — widgetsFromSettings never clusters it, and the page gates the
 * guides on align mode). Compact/align keep their single pseudo-slot.
 */
function currentSlot(): OverlaySlot {
    if (clickThrough && !alignMode) {
        const widgets = widgetsFromSettings();
        return {
            id: 'slot-0',
            originX: 0,
            originY: 0,
            moduleIds: widgets.filter((w) => w.kind === 'module').map((w) => w.id),
            stickerIds: widgets.filter((w) => w.kind === 'sticker').map((w) => w.id),
            mode: 'locked',
        };
    }
    return {
        id: alignMode ? 'align' : 'compact',
        originX: 0,
        originY: 0,
        moduleIds: HUD_MODULE_IDS,
        stickerIds: [],
        mode: alignMode ? ('align' as const) : ('compact' as const),
    };
}

/**
 * Slot and display size for the overlay renderer. The renderer also asks for
 * this on mount: the 'overlay-meta' push on did-finish-load can arrive before
 * React has subscribed, and a window without its slot used to paint every
 * module (the same panel twice on screen).
 */
export function overlaySlotFor(webContentsId: number): {
    slot: OverlaySlot | null;
    displayWidth: number;
    displayHeight: number;
} {
    const display = overlayDisplay();
    const isOverlay =
        (!!overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === webContentsId) ||
        (!!osrWin && !osrWin.isDestroyed() && osrWin.webContents.id === webContentsId);
    return {
        slot: isOverlay ? currentSlot() : null,
        displayWidth: display.bounds.width,
        displayHeight: display.bounds.height,
    };
}

export function broadcastOverlayMeta(): void {
    const native = isNativeLocked();
    const win = native ? osrWin : overlayWin;
    if (!win || win.isDestroyed()) return;
    const display = overlayDisplay();
    win.webContents.send('overlay-meta', {
        visible: native
            ? !userHidden && (nativeSurface?.isShown() ?? false)
            : !userHidden && win.isVisible(),
        clickThrough,
        userHidden,
        hudScale,
        mapScale,
        chromeColor,
        overlayTextScale,
        calibration,
        gameWidth,
        gameHeight,
        alignMode,
        hudModules,
        hudLayout,
        displayWidth: display.bounds.width,
        displayHeight: display.bounds.height,
        slot: currentSlot(),
    });
}

interface OverlayUpdatePayload {
    inGame?: boolean;
    profileHint?: string | null;
    enemyBotSummoners?: unknown;
    localPlayer?: { championName?: string } | null;
    timestamp?: number;
    [key: string]: unknown;
}

/**
 * The main window only needs match state, the profile hint and the bot-lane
 * timers — sending it the full live payload (every player, every item, every
 * score) forced a React pass on data it never renders while a game is running.
 */
function slimForMainWindow(payload: OverlayUpdatePayload): OverlayUpdatePayload {
    return {
        inGame: payload.inGame,
        profileHint: payload.profileHint ?? null,
        enemyBotSummoners: payload.enemyBotSummoners,
        localPlayer: payload.localPlayer
            ? { championName: payload.localPlayer.championName }
            : null,
        timestamp: payload.timestamp,
    };
}

export function sendOverlayUpdate(payload: unknown): void {
    const full = (payload || {}) as OverlayUpdatePayload;
    const slim = slimForMainWindow(full);

    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const isOverlay =
            overlayWindows().some((overlay) => overlay.id === win.id) ||
            (!!osrWin && !osrWin.isDestroyed() && osrWin.id === win.id);
        win.webContents.send('overlay-update', isOverlay ? full : slim);
    }
}
