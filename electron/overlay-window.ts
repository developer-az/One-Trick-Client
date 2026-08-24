import { app, BrowserWindow, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import { readLeagueHudScales } from './league-settings';

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

/** When the overlay is hidden, allow Chromium to throttle it and free GPU/CPU for League. */
function setOverlayThrottling(enabled: boolean): void {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    try {
        overlayWin.webContents.setBackgroundThrottling(enabled);
    } catch {
        // Older Electron builds — ignore
    }
}

let clickThrough = true;
let userHidden = false;
let hudScale = 20;
/** Default ~MinimapScale 1.0 (was 88 ≈ 1.82 — caused huge map frame vs HUD). */
let mapScale = 33;
let chromeColor = '#d4d8de';
let gameWidth = 1920;
let gameHeight = 1080;
let calibration: OverlayCalibration = { ...DEFAULT_CALIBRATION, ability: { ...DEFAULT_CALIBRATION.ability }, minimap: { ...DEFAULT_CALIBRATION.minimap } };

export type HudModuleId = 'sums' | 'gank' | 'vision' | 'buy' | 'action' | 'frames';
export type HudModules = Record<HudModuleId, boolean>;

const HUD_MODULE_IDS: HudModuleId[] = ['sums', 'gank', 'vision', 'buy', 'action', 'frames'];
const DEFAULT_HUD_MODULES: HudModules = {
    sums: true,
    gank: true,
    vision: true,
    buy: true,
    action: true,
    frames: false,
};

let hudModules: HudModules = { ...DEFAULT_HUD_MODULES };
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
    return overlayWin;
}

export function isOverlayUserHidden(): boolean {
    return userHidden;
}

function settingsPath(): string {
    return path.join(app.getPath('userData'), 'overlay-settings.json');
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
    } catch {
        // No saved settings yet.
    }
}

function persistSettings(preferLeagueCfg: boolean): void {
    try {
        fs.writeFileSync(
            settingsPath(),
            JSON.stringify({
                hudScale,
                mapScale,
                chromeColor,
                interactiveBounds,
                calibration,
                hudModules,
                preferLeagueCfg,
            }),
            'utf8'
        );
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

function assertAlwaysOnTop(win: BrowserWindow): void {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

export function createOverlayWindow(): BrowserWindow {
    if (overlayWin && !overlayWin.isDestroyed()) {
        return overlayWin;
    }

    loadSettings();
    // Always re-read game.cfg on overlay create so frames match Interface scales
    syncScalesFromLeague();
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.bounds;

    overlayWin = new BrowserWindow({
        width,
        height,
        x: display.bounds.x,
        y: display.bounds.y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        hasShadow: false,
        fullscreenable: false,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
        },
    });

    assertAlwaysOnTop(overlayWin);

    // Default: a fullscreen click-through surface, so the game is never blocked.
    setClickThrough(true);

    // No OS chrome / context menu — accidental right-clicks must not surface UI that
    // steals focus from League or makes the overlay feel like it "closed".
    overlayWin.setMenu(null);
    overlayWin.webContents.on('context-menu', (e) => {
        e.preventDefault();
    });
    overlayWin.on('blur', () => {
        // Never tear down on blur — just re-assert topmost while supposed to be visible
        if (userHidden || !overlayWin || overlayWin.isDestroyed()) return;
        if (clickThrough && !alignMode) {
            try {
                assertAlwaysOnTop(overlayWin);
                if (!overlayWin.isVisible()) overlayWin.showInactive();
            } catch {
                // ignore
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
    if (!overlayWin || overlayWin.isDestroyed()) return;
    // If Windows dropped visibility mid-match without user hide, bring it back
    if (!userHidden && !overlayWin.isVisible()) {
        try {
            overlayWin.showInactive();
        } catch {
            // ignore
        }
    }
    if (!overlayWin.isVisible()) return;
    if (!overlayWin.isAlwaysOnTop()) {
        assertAlwaysOnTop(overlayWin);
    }
}

export function showOverlay(): void {
    if (userHidden) return;

    const win = createOverlayWindow();
    setOverlayThrottling(false);
    if (!win.isVisible()) {
        win.showInactive();
    }
    assertAlwaysOnTop(win);
    // Re-apply click-through after show — Windows can drop ignore-mouse state on hide/show
    setClickThrough(clickThrough);
}

export function hideOverlay(): void {
    if (overlayWin && !overlayWin.isDestroyed()) {
        if (overlayWin.isVisible()) {
            overlayWin.hide();
        }
        // Hidden overlay should not keep a hot compositor path against the game.
        setOverlayThrottling(true);
    }
}

export function destroyOverlay(): void {
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
        applyFullscreenBounds();
        overlayWin.setFocusable(false);
        // No { forward: true }: forwarding still routes every mousemove through
        // Chromium for hit-testing, which hitchs the cursor over League. Locked
        // UI is paint-only (pointer-events: none) — OS pass-through is enough.
        overlayWin.setIgnoreMouseEvents(true);
        // Never steal focus back from League when re-locking
        if (overlayWin.isVisible()) {
            overlayWin.showInactive();
        }
    } else {
        // Unlocked = compact movable panel (game stays clickable around it)
        alignMode = false;
        applyCompactPanelBounds();
        overlayWin.setFocusable(true);
        overlayWin.setIgnoreMouseEvents(false);
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
        applyFullscreenBounds();
        overlayWin.setFocusable(true);
        overlayWin.setIgnoreMouseEvents(false);
        // showInactive — focus() steals input from League and can freeze the cursor
        overlayWin.showInactive();
    } else {
        alignMode = false;
        // Back to compact movable panel (still unlocked)
        clickThrough = false;
        applyCompactPanelBounds();
        overlayWin.setFocusable(true);
        overlayWin.setIgnoreMouseEvents(false);
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

export function broadcastOverlayMeta(): void {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send('overlay-meta', {
        visible: !userHidden && overlayWin.isVisible(),
        clickThrough,
        userHidden,
        hudScale,
        mapScale,
        chromeColor,
        calibration,
        gameWidth,
        gameHeight,
        alignMode,
        hudModules,
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
        const isOverlay = overlayWin != null && !overlayWin.isDestroyed() && win.id === overlayWin.id;
        win.webContents.send('overlay-update', isOverlay ? full : slim);
    }
}
