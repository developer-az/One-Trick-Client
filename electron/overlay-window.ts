import { app, BrowserWindow, screen } from 'electron';
import { userDataDir } from './paths';
import fs from 'fs';
import path from 'path';
import { readLeagueHudScales } from './league-settings';
import { clusterOverlayWindows, overlayWindowWanted, type OverlayCluster } from './overlay-bounds';
import { getAppSettings } from './app-settings';
import { getKeyHookStatus } from './global-key-hook';
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
/** Extra slim rails so locked mode never uses one fullscreen layered window. */
const extraWindows: BrowserWindow[] = [];

function overlayWindows(): BrowserWindow[] {
    const list: BrowserWindow[] = [];
    if (overlayWin && !overlayWin.isDestroyed()) list.push(overlayWin);
    for (const win of extraWindows) {
        if (win && !win.isDestroyed()) list.push(win);
    }
    return list;
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
 * webContents ids of locked overlay windows whose slot has nothing to draw.
 * Those stay hidden: an empty transparent window still sits over League's swap
 * chain and keeps DWM compositing the game.
 */
const emptySlots = new Set<number>();
/** Delay before an occupied window is allowed to hide, so one empty frame cannot blank the HUD. */
const emptyGrace = new Map<number, ReturnType<typeof setTimeout>>();
const EMPTY_HIDE_GRACE_MS = 8_000;
const RENDERER_RELOAD_MIN_MS = 5_000;
const lastRendererReload = new WeakMap<BrowserWindow, number>();

/** Tab is held down (reported by the native key helper). */
let holdDown = false;

/**
 * Match start used to clear the empty set and force every overlay HWND on
 * screen for the whole game. That is the DWM cost this module exists to avoid.
 * Callers still notify match start and end; visibility follows content.
 */
export function setOverlayMatchActive(_active: boolean): void {
    void _active;
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

function shouldShowWindow(win: BrowserWindow): boolean {
    return overlayWindowWanted({
        userHidden,
        overlayEnabled: getAppSettings().overlayEnabled,
        locked: lockedLayout(),
        holdToShow: holdToShowActive(),
        holdDown,
        emptySlot: emptySlots.has(win.webContents.id),
    });
}

/** Tab down/up. Shows or hides the locked overlay windows in hold-to-show mode. */
export function setOverlayHold(down: boolean): void {
    if (holdDown === down) return;
    holdDown = down;
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
    for (const win of overlayWindows()) applyCaptureProtection(win);
}

/** Re-apply visibility after a setting that affects it changes. */
export function refreshOverlayVisibility(): void {
    for (const win of overlayWindows()) {
        try {
            syncWindowVisibility(win);
        } catch {
            // ignore
        }
    }
}

function syncWindowVisibility(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const want = shouldShowWindow(win);
    if (want && !win.isVisible()) win.showInactive();
    else if (!want && win.isVisible()) {
        win.hide();
        // Hide/show drops the OS click-through flag. Forget it so the next show re-applies once.
        mouseIgnored.delete(win);
    }
    applyWindowPaintBudget(win);
}

/** Renderer reports whether its slot has content (see OverlayApp). */
export function setOverlaySlotContent(webContentsId: number, hasContent: boolean): void {
    const pending = emptyGrace.get(webContentsId);
    if (hasContent) {
        if (pending) {
            clearTimeout(pending);
            emptyGrace.delete(webContentsId);
        }
        emptySlots.delete(webContentsId);
        syncSlotVisibility(webContentsId);
        return;
    }
    // Already hidden, or already waiting out a blip.
    if (emptySlots.has(webContentsId) || pending) return;
    const timer = setTimeout(() => {
        emptyGrace.delete(webContentsId);
        emptySlots.add(webContentsId);
        syncSlotVisibility(webContentsId);
    }, EMPTY_HIDE_GRACE_MS);
    emptyGrace.set(webContentsId, timer);
}

function syncSlotVisibility(webContentsId: number): void {
    for (const win of overlayWindows()) {
        if (win.isDestroyed()) continue;
        if (win.webContents.id === webContentsId) syncWindowVisibility(win);
    }
}

function forgetSlot(webContentsId: number): void {
    const pending = emptyGrace.get(webContentsId);
    if (pending) clearTimeout(pending);
    emptyGrace.delete(webContentsId);
    emptySlots.delete(webContentsId);
}

function reloadOverlayRenderer(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const now = Date.now();
    const previous = lastRendererReload.get(win) ?? 0;
    if (now - previous < RENDERER_RELOAD_MIN_MS) return;
    lastRendererReload.set(win, now);
    console.warn('[overlay] reloading renderer');
    const url = getOverlayUrl();
    const load = url.startsWith('http') ? win.loadURL(url) : win.loadFile(url);
    void load.catch((error: unknown) => {
        console.warn('[overlay] renderer reload failed', error);
    });
}

function armOverlayRenderer(win: BrowserWindow): void {
    const contentsId = win.webContents.id;
    win.on('closed', () => forgetSlot(contentsId));
    win.webContents.on('render-process-gone', () => {
        console.warn('[overlay] renderer exited');
        reloadOverlayRenderer(win);
    });
    win.webContents.on('unresponsive', () => {
        console.warn('[overlay] renderer unresponsive');
        reloadOverlayRenderer(win);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        console.warn(`[overlay] load failed (${errorCode} ${errorDescription})`);
        reloadOverlayRenderer(win);
    });
}

/**
 * Bring a crashed or fully hidden overlay back while a match is running.
 * Does not re-bind mouse passthrough — that path freezes the cursor over League.
 */
export function healOverlayWindows(): void {
    if (userHidden || !getAppSettings().overlayEnabled) return;
    if (holdToShowActive() && !holdDown) return;
    for (const win of overlayWindows()) {
        try {
            if (win.webContents.isCrashed()) reloadOverlayRenderer(win);
        } catch {
            // ignore
        }
    }
    const wins = overlayWindows();
    if (!wins.length) return;
    const anyVisible = wins.some((win) => {
        try {
            return win.isVisible();
        } catch {
            return false;
        }
    });
    if (anyVisible) return;
    // Empty slots are hidden on purpose. Forcing show here would just hide them again.
    const allEmpty = wins.every((win) => emptySlots.has(win.webContents.id));
    if (!allEmpty) showOverlay();
}

export function getOverlayWindowStats(): { windows: number; visible: number } {
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
    return overlayWindows()[0] || null;
}

function destroyExtraWindows(): void {
    while (extraWindows.length) {
        const win = extraWindows.pop();
        if (win && !win.isDestroyed()) {
            win.destroy();
        }
    }
}

function createLayeredWindow(bounds: Electron.Rectangle): BrowserWindow {
    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
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
    // Hidden until its renderer reports something to draw.
    emptySlots.add(win.webContents.id);
    assertAlwaysOnTop(win);
    applyCaptureProtection(win);
    win.setMenu(null);
    win.webContents.on('context-menu', (e) => {
        e.preventDefault();
    });
    armOverlayRenderer(win);
    const url = getOverlayUrl();
    if (url.startsWith('http')) {
        win.loadURL(url);
    } else {
        win.loadFile(url);
    }
    win.webContents.on('did-finish-load', () => {
        broadcastOverlayMeta();
    });
    return win;
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

function applyClusterToWindow(win: BrowserWindow, cluster: OverlayCluster, clickPass: boolean): void {
    win.setBounds({
        x: cluster.x,
        y: cluster.y,
        width: cluster.width,
        height: cluster.height,
    });
    win.setMovable(false);
    win.setFocusable(false);
    setMouseIgnored(win, clickPass);
    syncWindowVisibility(win);
}

/** The display the overlay lives on. Window placement and slot metadata must agree on it. */
function overlayDisplay(): Electron.Display {
    if (overlayWin && !overlayWin.isDestroyed()) {
        return screen.getDisplayMatching(overlayWin.getBounds()) || screen.getPrimaryDisplay();
    }
    return screen.getPrimaryDisplay();
}

function lockedClusters(display: Electron.Display): OverlayCluster[] {
    return clusterOverlayWindows({
        widgets: widgetsFromSettings(),
        display: display.bounds,
        gameWidth,
        gameHeight,
        hudScale,
    });
}

function applyLockedClusters(): void {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const clusters = lockedClusters(overlayDisplay());
    if (!clusters.length) {
        destroyExtraWindows();
        overlayWin.hide();
        return;
    }

    applyClusterToWindow(overlayWin, clusters[0], true);
    for (let i = 1; i < clusters.length; i += 1) {
        let extra = extraWindows[i - 1];
        if (!extra || extra.isDestroyed()) {
            extra = createLayeredWindow(clusters[i]);
            extraWindows[i - 1] = extra;
        }
        applyClusterToWindow(extra, clusters[i], true);
    }
    while (extraWindows.length > clusters.length - 1) {
        const spare = extraWindows.pop();
        if (spare && !spare.isDestroyed()) spare.destroy();
    }
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
    } catch {
        // No saved settings yet.
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
        if (clickThrough && !alignMode && overlayWin && !overlayWin.isDestroyed()) {
            applyLockedClusters();
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

export function createOverlayWindow(): BrowserWindow {
    if (overlayWin && !overlayWin.isDestroyed()) {
        return overlayWin;
    }

    loadSettings();
    // Always re-read game.cfg on overlay create so frames match Interface scales
    syncScalesFromLeague();
    const display = screen.getPrimaryDisplay();

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

    emptySlots.add(overlayWin.webContents.id);
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
    overlayWin.webContents.on('did-finish-load', () => {
        broadcastOverlayMeta();
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
    for (const win of overlayWindows()) {
        try {
            syncWindowVisibility(win);
            if (win.isVisible() && !win.isAlwaysOnTop()) assertAlwaysOnTop(win);
        } catch {
            // ignore
        }
    }
}

export function showOverlay(): void {
    if (userHidden || !getAppSettings().overlayEnabled) return;

    const win = createOverlayWindow();
    if (clickThrough && !alignMode) {
        applyLockedClusters();
    } else if (!win.isVisible()) {
        win.showInactive();
    }
    syncOverlayPaintBudget();
    assertAlwaysOnTop(win);
    // Re-apply click-through after show — Windows can drop ignore-mouse state on hide/show
    setClickThrough(clickThrough);
}

export function hideOverlay(): void {
    for (const win of overlayWindows()) {
        if (win.isVisible()) win.hide();
    }
    // Hidden overlay should not keep a hot compositor path against the game.
    syncOverlayPaintBudget();
}

export function destroyOverlay(): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        writeSettingsNow(true);
    }
    for (const timer of emptyGrace.values()) clearTimeout(timer);
    emptyGrace.clear();
    emptySlots.clear();
    destroyExtraWindows();
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.destroy();
    }
    overlayWin = null;
}

export function toggleOverlayVisibility(): boolean {
    userHidden = !userHidden;
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
    if (!overlayWin || overlayWin.isDestroyed()) return;

    if (enabled) {
        // Save only when leaving the compact movable panel (not fullscreen align)
        if (!wasClickThrough && !wasAlign) {
            interactiveBounds = overlayWin.getBounds();
            saveSettings();
        }
        alignMode = false;
        // Tight column windows — never a display-sized layered HWND over League.
        applyLockedClusters();
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
        destroyExtraWindows();
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
        destroyExtraWindows();
        applyFullscreenBounds();
        overlayWin.setFocusable(true);
        setMouseIgnored(overlayWin, false);
        // showInactive — focus() steals input from League and can freeze the cursor
        overlayWin.showInactive();
    } else {
        alignMode = false;
        // Back to compact movable panel (still unlocked)
        clickThrough = false;
        destroyExtraWindows();
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
    if (clickThrough && !alignMode && overlayWin && !overlayWin.isDestroyed()) {
        applyLockedClusters();
    }
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
        if (clickThrough && !alignMode && overlayWin && !overlayWin.isDestroyed()) {
            applyLockedClusters();
        }
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
    if (clickThrough && !alignMode && overlayWin && !overlayWin.isDestroyed()) {
        applyLockedClusters();
    }
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
    if (clickThrough && !alignMode && overlayWin && !overlayWin.isDestroyed()) {
        applyLockedClusters();
    }
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

function slotsFor(windows: BrowserWindow[], display: Electron.Display): OverlaySlot[] {
    const clusters = clickThrough && !alignMode ? lockedClusters(display) : [];
    return windows.map((_win, index) => {
        const cluster = clusters[index];
        return cluster
            ? {
                  id: cluster.id,
                  originX: cluster.x - display.bounds.x,
                  originY: cluster.y - display.bounds.y,
                  moduleIds: cluster.moduleIds,
                  stickerIds: cluster.stickerIds,
                  mode: 'locked' as const,
              }
            : {
                  id: alignMode ? 'align' : 'compact',
                  originX: 0,
                  originY: 0,
                  moduleIds: HUD_MODULE_IDS,
                  stickerIds: [],
                  mode: alignMode ? ('align' as const) : ('compact' as const),
              };
    });
}

/**
 * Slot and display size for one overlay renderer. The renderer also asks for
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
    const windows = overlayWindows();
    const index = windows.findIndex((win) => win.webContents.id === webContentsId);
    return {
        slot: index >= 0 ? slotsFor(windows, display)[index] : null,
        displayWidth: display.bounds.width,
        displayHeight: display.bounds.height,
    };
}

export function broadcastOverlayMeta(): void {
    const display = overlayDisplay();
    const windows = overlayWindows();
    if (!windows.length) return;
    const slots = slotsFor(windows, display);
    windows.forEach((win, index) => {
        if (win.isDestroyed()) return;
        win.webContents.send('overlay-meta', {
            visible: !userHidden && win.isVisible(),
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
            slot: slots[index],
        });
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
        const isOverlay = overlayWindows().some((overlay) => overlay.id === win.id);
        win.webContents.send('overlay-update', isOverlay ? full : slim);
    }
}
