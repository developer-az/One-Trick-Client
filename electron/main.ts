import './configure-app-branding';
import {
    app,
    BrowserWindow,
    ipcMain,
    globalShortcut,
    clipboard,
    Menu,
    Tray,
    nativeImage,
    type NativeImage,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { connectToLCU, makeLCURequest } from './lcu-connector';
import { lcuSocket } from './lcu-socket';
import { flushAppSettings, getAppSettings, gpuAccelerationAtLaunch, loadAppSettings, updateAppSettings } from './app-settings';
import { fetchLiveClientData } from './live-client';
import {
    getGameState,
    getObjectiveTimers,
    getRecentGameEvents,
    getRecentGameSnapshots,
    getStateServiceLog,
    getStateServiceStatus,
} from './state-service';
import {
    startGameMonitor,
    stopGameMonitor,
    isCurrentlyInGame,
    setGameStateChangeHandler,
    setMatchStartHotkeyHandler,
    pushSummonerUpdate,
    getMonitorStats,
    refreshLiveCadence,
    triggerManualMayhemOcrFromHotkey,
    dismissMayhemAugmentPanelFromHotkey,
    isMayhemMatchActive,
} from './game-monitor';
import { ensureKeyhookBinary } from './ensure-keyhook';
import { getPlayRecap } from './play-recap';
import { getClipperStatus, saveManualClip, syncAutoClip } from './clipper';
import {
    destroyOverlay,
    toggleOverlayVisibility,
    setOverlayUserHidden,
    toggleClickThrough,
    isClickThrough,
    isAlignMode,
    setAlignMode,
    isOverlayUserHidden,
    showOverlay,
    getHudScale,
    setHudScale,
    getMapScale,
    setMapScale,
    getChromeColor,
    setChromeColor,
    getOverlayTextScale,
    setOverlayTextScale,
    getHudModules,
    setHudModules,
    getHudLayout,
    setHudLayout,
    syncScalesFromLeague,
    getCalibration,
    adjustCalibration,
    resetCalibration,
    getGameResolution,
    broadcastOverlayMeta,
    overlaySlotFor,
    setOverlayHold,
    refreshOverlayVisibility,
    refreshOverlayCaptureProtection,
    holdToShowActive,
    hideOverlay,
    setOverlaySlotContent,
    getOverlayWindowStats,
    type FrameCalibration,
} from './overlay-window';
import {
    formatAdcClipboard,
    markSpellUsed,
    toggleSpellUsed,
    getSummonerFocus,
    type TrackedRole,
} from './summoner-tracker';
import { startFlashKeyHook, stopFlashKeyHook, getKeyHookStatus } from './global-key-hook';
import { loadCatalogCache, refreshCatalogCache } from './catalog-cache';
import { overlayEnvironment } from './environment';
import { buildIconCandidates, distDir, publicDir } from './paths';

process.env.DIST = distDir();
process.env.VITE_PUBLIC = publicDir();

let win: BrowserWindow | null;
let tray: Tray | null = null;
let quittingApp = false;
/** Set when the dashboard was hidden by a match starting, so it is restored after. */
let hiddenForMatch = false;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// GPU mode must be chosen before the app is ready. Software rendering is the
// default: One Trick's windows are mostly static, and keeping our compositor
// off the GPU leaves the whole GPU queue to League.
loadAppSettings();
if (!gpuAccelerationAtLaunch()) {
    app.disableHardwareAcceleration();
}

/** Single instance: a second launch focuses the first instead of doubling every hook and timer. */
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
    app.quit();
}
app.on('second-instance', () => {
    showDashboard();
});

function showDashboard(): void {
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
}

function sendToDashboard(channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createTray(): void {
    if (tray) return;
    try {
        const image = loadAppIconImage();
        tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
    } catch {
        return;
    }
    tray.setToolTip('One Trick');
    tray.on('click', showDashboard);
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Open One Trick', click: showDashboard },
            {
                label: 'Show / hide overlay',
                click: () => {
                    const visible = toggleOverlayVisibility();
                    refreshLiveCadence();
                    sendToDashboard('overlay-visibility-changed', { visible });
                },
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    quittingApp = true;
                    app.quit();
                },
            },
        ])
    );
}

function resolveAppIcon(): string {
    for (const candidate of buildIconCandidates()) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return path.join(process.env.VITE_PUBLIC || '', 'icon.png');
}

function loadAppIconImage(): NativeImage {
    const iconPath = resolveAppIcon();
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image;
    return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || '', 'icon.png'));
}

const MAIN_DEV_URL = 'http://localhost:5173/';

function createWindow() {
    win = new BrowserWindow({
        width: 1240,
        height: 860,
        minWidth: 880,
        minHeight: 640,
        show: false,
        icon: loadAppIconImage(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // Default true — keep main UI throttled when unfocused/minimized so
            // it does not compete with League for CPU while a match is running.
            backgroundThrottling: true,
        },
        backgroundColor: '#070708',
        frame: false,
        transparent: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#070708',
            symbolColor: '#d4d8de',
            height: 40
        }
    });

    win.on('close', (event) => {
        if (!quittingApp) {
            event.preventDefault();
            win?.hide();
            return;
        }
    });

    win.on('closed', () => {
        win = null;
        stopGameMonitor();
        destroyOverlay();
        stopFlashKeyHook();
        globalShortcut.unregisterAll();
    });

    let loadAttempts = 0;
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || !win) return;
        console.error('[main] did-fail-load', errorCode, errorDescription, validatedURL);
        const devUrl = VITE_DEV_SERVER_URL || MAIN_DEV_URL;
        if (!app.isPackaged && validatedURL.startsWith('http://localhost:') && loadAttempts < 3) {
            loadAttempts += 1;
            setTimeout(() => {
                void win?.loadURL(devUrl);
            }, 600 * loadAttempts);
        }
    });

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString());
    });

    win.once('ready-to-show', () => {
        win?.show();
    });

    const loadMain = async () => {
        if (VITE_DEV_SERVER_URL) {
            await win?.loadURL(VITE_DEV_SERVER_URL);
        } else if (!app.isPackaged) {
            await win?.loadURL(MAIN_DEV_URL);
            // DevTools are heavy on GPU/CPU — only open when explicitly requested.
            if (process.env.PYKE_OPEN_DEVTOOLS === '1') {
                win?.webContents.openDevTools();
            }
        } else {
            await win?.loadFile(path.join(process.env.DIST || '', 'index.html'));
        }
    };
    void loadMain();
}

function flashToggleRoles(): { primary: TrackedRole; secondary: TrackedRole } {
    // Yone mid: PageUp = Mid Flash, PageDown = Mid second combat sum (Ignite preferred)
    if (getSummonerFocus() === 'mid') {
        return { primary: 'Mid', secondary: 'Mid' };
    }
    return { primary: 'Bot', secondary: 'Support' };
}

function onFlashPrimary(): void {
    if (isMayhemMatchActive()) {
        dismissMayhemAugmentPanelFromHotkey();
        return;
    }
    const { primary } = flashToggleRoles();
    const res = toggleSpellUsed(primary, 'Flash');
    if (res.success) pushSummonerUpdate();
}

function onFlashSecondary(): void {
    if (isMayhemMatchActive()) {
        void triggerManualMayhemOcrFromHotkey();
        return;
    }
    const { secondary } = flashToggleRoles();
    if (getSummonerFocus() === 'mid') {
        // Mid: PageDown is the laner's other summoner (Ignite, else Teleport).
        // PageUp already owns Flash, so it is never a fallback here.
        let res = toggleSpellUsed(secondary, 'Ignite');
        if (!res.success) res = toggleSpellUsed(secondary, 'Teleport');
        if (res.success) pushSummonerUpdate();
        return;
    }
    const res = toggleSpellUsed(secondary, 'Flash');
    if (res.success) pushSummonerUpdate();
}

/**
 * PageUp / PageDown (and Numpad 9/3) must work while League has focus.
 * Electron `globalShortcut` (RegisterHotKey) often never fires in that case —
 * use uiohook-napi WH_KEYBOARD_LL instead. Keep globalShortcut only as a
 * degraded fallback if the native hook fails to load.
 *
 * Elevation: if League is Run as Administrator and One Trick is not, Windows
 * UIPI blocks the hook from seeing those keydowns — run One Trick elevated too.
 */
function registerElectronFlashHotkeyFallback(): void {
    const upOk = globalShortcut.register('PageUp', onFlashPrimary);
    const downOk = globalShortcut.register('PageDown', onFlashSecondary);
    try {
        if (!globalShortcut.isRegistered('Prior')) globalShortcut.register('Prior', onFlashPrimary);
        if (!globalShortcut.isRegistered('Next')) globalShortcut.register('Next', onFlashSecondary);
    } catch {
        // ignore
    }
    globalShortcut.register('num9', onFlashPrimary);
    globalShortcut.register('num3', onFlashSecondary);

    if (!upOk || !downOk) {
        console.warn(
            '[keys] Flash hotkeys fallback incomplete. Check the onetrick-keys helper, ' +
                'or run One Trick as admin if League is elevated.'
        );
    } else {
        console.warn(
            '[keys] Using Electron globalShortcut fallback for PageUp/PageDown — ' +
                'these often fail while League has focus. ' +
                (getKeyHookStatus().error || 'The onetrick-keys helper did not start.')
        );
    }
}

function registerFlashHotkeys(): void {
    ensureKeyhookBinary();
    // Drop any prior RegisterHotKey binds for these keys (avoid double-fire if
    // both paths somehow lived together from an older session).
    for (const key of ['PageUp', 'PageDown', 'num9', 'num3', 'Prior', 'Next'] as const) {
        try {
            if (globalShortcut.isRegistered(key)) globalShortcut.unregister(key);
        } catch {
            // ignore
        }
    }

    const hookOk = startFlashKeyHook({
        onPrimary: onFlashPrimary,
        onSecondary: onFlashSecondary,
        onHold: setOverlayHold,
    });
    if (!hookOk) {
        registerElectronFlashHotkeyFallback();
        return;
    }

    // Helper reports "R" on stdout asynchronously — don't register fallback yet.
    setTimeout(() => {
        if (getKeyHookStatus().mode === 'native') return;
        registerElectronFlashHotkeyFallback();
    }, 500);
}

function registerOverlayHotkeys() {
    // Avoid Ctrl+Shift+I — Electron/Chromium reserves it for DevTools
    // Ctrl+Shift combos still use globalShortcut (rarely conflict with League).
    const hideOk = globalShortcut.register('CommandOrControl+Shift+H', () => {
        const visible = toggleOverlayVisibility();
        refreshLiveCadence();
        win?.webContents.send('overlay-visibility-changed', { visible });
    });

    const clickOk = globalShortcut.register('CommandOrControl+Shift+U', () => {
        // Unlock = compact movable panel; Lock = fullscreen click-through.
        // (HUD align is a separate mode — do not cover the whole screen here.)
        const clickThrough = toggleClickThrough();
        win?.webContents.send('overlay-clickthrough-changed', { clickThrough });
        broadcastOverlayMeta();
    });

    registerFlashHotkeys();

    if (!hideOk || !globalShortcut.isRegistered('CommandOrControl+Shift+H')) {
        console.warn('[overlay] Failed to register Ctrl+Shift+H (hide); another app may own it.');
    }
    if (!clickOk || !globalShortcut.isRegistered('CommandOrControl+Shift+U')) {
        console.warn('[overlay] Failed to register Ctrl+Shift+U (lock/unlock); another app may own it.');
    }
}

app.on('window-all-closed', () => {
    stopGameMonitor();
    destroyOverlay();
    stopFlashKeyHook();
    globalShortcut.unregisterAll();
    if (process.platform !== 'darwin') {
        app.quit();
        win = null;
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    stopGameMonitor();
    destroyOverlay();
    flushAppSettings();
    stopFlashKeyHook();
    globalShortcut.unregisterAll();
});

app.whenReady().then(() => {
    if (!primaryInstance) return;
    createWindow();
    // Overlay is created only when a match starts (see game-monitor) —
    // avoid a permanent fullscreen transparent window sitting idle.
    registerOverlayHotkeys();
    // Re-bind Flash keys every match start (Windows can drop hotkeys after focus fights)
    setMatchStartHotkeyHandler(() => {
        registerFlashHotkeys();
    });

    // Park the dashboard during matches so it never paints over League's frames.
    // Hidden (tray) is the default; a hidden window produces no frames at all,
    // whereas a minimized one can still be restored onto a second monitor.
    setGameStateChangeHandler((active) => {
        if (!win || win.isDestroyed()) return;
        if (active) {
            if (getAppSettings().hideDashboardInGame) {
                if (win.isVisible()) {
                    win.hide();
                    hiddenForMatch = true;
                }
            } else if (!win.isMinimized()) {
                win.minimize();
            }
        } else if (hiddenForMatch) {
            hiddenForMatch = false;
            win.showInactive();
        } else if (win.isMinimized()) {
            win.restore();
        }
    });

    createTray();

    // League client state is pushed (WebSocket) — forward it to the dashboard.
    const pushLcuStatus = () => sendToDashboard('lcu-status', lcuSocket.summary());
    lcuSocket.on('state', pushLcuStatus);
    lcuSocket.on('phase', pushLcuStatus);
    lcuSocket.on('summoner', pushLcuStatus);
    lcuSocket.on('champSelect', (session) => sendToDashboard('champ-select', session));

    startGameMonitor();

    void refreshCatalogCache().catch(() => {
        loadCatalogCache();
    });

    // IPC Handlers
    // User-initiated connect: allowed to use the slow process probe once.
    ipcMain.handle('lcu-connect', async () => {
        if (lcuSocket.state === 'connected') return { success: true };
        try {
            await connectToLCU(true);
            lcuSocket.poke();
            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('lcu-status', () => lcuSocket.summary());
    ipcMain.handle('champ-select-get', () => ({ session: lcuSocket.champSelect }));

    ipcMain.handle('app-settings-get', () => getAppSettings());
    ipcMain.handle('app-settings-set', (_event, patch: unknown) => {
        const before = getAppSettings();
        const result = updateAppSettings(patch);
        if (before.overlayEnabled !== result.settings.overlayEnabled) {
            if (!result.settings.overlayEnabled) hideOverlay();
            else if (isCurrentlyInGame()) showOverlay();
        }
        if (before.overlayHoldToShow !== result.settings.overlayHoldToShow) refreshOverlayVisibility();
        if (before.overlayHideFromCapture !== result.settings.overlayHideFromCapture) refreshOverlayCaptureProtection();
        if (before.autoClip !== result.settings.autoClip) {
            syncAutoClip(result.settings.autoClip, result.settings.autoClip && isCurrentlyInGame());
        }
        return result;
    });
    ipcMain.handle('app-relaunch', () => {
        app.relaunch();
        app.exit(0);
    });

    ipcMain.on('overlay-slot-content', (event, hasContent: boolean) => {
        if (process.env.ONETRICK_DEBUG) console.info(`[overlay] slot ${event.sender.id} content=${hasContent}`);
        setOverlaySlotContent(event.sender.id, !!hasContent);
    });

    if (process.env.ONETRICK_DEBUG) {
        setInterval(() => {
            const o = getOverlayWindowStats();
            const m = getMonitorStats();
            console.info(`[debug] overlayWindows=${o.windows} visible=${o.visible} inGame=${m.inGame} livePollMs=${m.livePollMs} gpu=${app.getGPUFeatureStatus().gpu_compositing}`);
        }, 5000);
    }

    ipcMain.handle('perf-stats', async () => {
        const processes = app.getAppMetrics().map((m) => ({
            type: String(m.type),
            name: m.name || m.serviceName || String(m.type),
            cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
            memoryMb: Math.round((m.memory?.workingSetSize || 0) / 1024),
        }));
        const overlay = getOverlayWindowStats();
        const monitor = getMonitorStats();
        return {
            processes,
            totalCpu: Math.round(processes.reduce((sum, p) => sum + p.cpu, 0) * 10) / 10,
            totalMemoryMb: processes.reduce((sum, p) => sum + p.memoryMb, 0),
            overlayWindows: overlay.windows,
            overlayVisible: overlay.visible > 0,
            gpuAcceleration: getAppSettings().gpuAcceleration,
            gpuActive: gpuAccelerationAtLaunch(),
            hotkeys: getKeyHookStatus(),
            overlayHold: holdToShowActive(),
            lcu: lcuSocket.summary(),
            inGame: monitor.inGame,
            livePollMs: monitor.livePollMs,
            liveReads: monitor.liveReads,
            lastEndReason: monitor.lastEndReason,
            environment: await overlayEnvironment(),
        };
    });

    ipcMain.handle('match-recap-get', () => getPlayRecap());

    // Auto-clipping: status for the Performance tab + manual "save last 30s".
    ipcMain.handle('clipper-status', () => getClipperStatus());
    ipcMain.handle('clip-save-manual', async () => {
        try {
            const gameTime = getGameState()?.gameTime ?? getRecentGameSnapshots().at(-1)?.gameTime ?? 0;
            const saved = await saveManualClip(Math.round(gameTime));
            return { success: !!saved, path: saved, status: getClipperStatus() };
        } catch (error) {
            return { success: false, path: null, error: String(error), status: getClipperStatus() };
        }
    });

    ipcMain.handle('lcu-request', async (_event, method, endpoint, body) => {
        try {
            const response = await makeLCURequest(method, endpoint, body);

            if (response === null) {
                return { success: false, error: '404 - Not found (expected when not in champ select)' };
            }

            return { success: true, data: response };
        } catch (error: unknown) {
            const err = error as { response?: { status?: number }; message?: string };
            const is404 = err.response?.status === 404 || err.message?.includes('404');
            if (!is404) {
                console.error('LCU Request Error:', err.message || 'Unknown error');
            }
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('lcu-export-item-set', async (_event, build) => {
        try {
            const { exportItemSet } = await import('./lcu-connector');
            await exportItemSet(build);
            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            console.error('Export Item Set Error:', err.message || 'Unknown error');
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('lcu-export-rune-page', async (_event, runePage) => {
        try {
            const { exportRunePage } = await import('./lcu-connector');
            await exportRunePage(runePage);
            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            console.error('Export Rune Page Error:', err.message || 'Unknown error');
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('match-history-get', async () => {
        try {
            const { getMatchHistory } = await import('./match-history');
            const games = await getMatchHistory({ canFetchDetails: () => !isCurrentlyInGame() });
            return { success: true, games };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, games: [], error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('lcu-set-summoner-spells', async (_event, spellIds: unknown) => {
        try {
            const { setSummonerSpells } = await import('./lcu-connector');
            await setSummonerSpells(spellIds);
            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('clipboard-write', async (_event, text: string) => {
        try {
            const value = typeof text === 'string' && text.trim() ? text : formatAdcClipboard();
            if (!value) return { success: false, error: 'Nothing to copy' };
            clipboard.writeText(value);
            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Clipboard failed' };
        }
    });

    ipcMain.handle(
        'summoner-mark',
        async (_event, role: TrackedRole, spellName: string, opts?: { clear?: boolean }) => {
            try {
                const ok = markSpellUsed(role, spellName, opts);
                if (ok) pushSummonerUpdate();
                return { success: ok };
            } catch (error: unknown) {
                const err = error as { message?: string };
                return { success: false, error: err.message || 'Mark failed' };
            }
        }
    );

    ipcMain.handle('summoner-toggle', async (_event, role: TrackedRole, spellName: string) => {
        try {
            const res = toggleSpellUsed(role, spellName);
            if (res.success) pushSummonerUpdate();
            return res;
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, active: false, error: err.message || 'Toggle failed' };
        }
    });

    // Live Client Data (in-game, including Practice Tool).
    // Debug/diagnostic only — the app's live path is the State Service.
    ipcMain.handle('live-client-data', async () => {
        try {
            const data = await fetchLiveClientData();
            return { success: !!data, data };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    /* ------------------------------------------------------------------ *
     * Phase 1 — State Service diagnostics.
     *
     * Debug surface for the Phase 1 acceptance test: it makes the event
     * cursor, objective timers and the rotating state log observable without
     * needing any new UI. No renderer writes go through here.
     * ------------------------------------------------------------------ */
    ipcMain.handle('state-service-status', () => {
        try {
            return {
                success: true,
                status: getStateServiceStatus(),
                timers: getObjectiveTimers(),
            };
        } catch (error) {
            return { success: false, error: String(error), status: null, timers: null };
        }
    });

    ipcMain.handle('state-service-events', () => {
        try {
            return {
                success: true,
                events: getRecentGameEvents(),
                snapshots: getRecentGameSnapshots().length,
            };
        } catch (error) {
            return { success: false, error: String(error), events: [], snapshots: 0 };
        }
    });

    ipcMain.handle('state-service-log', (_event, limit?: number) => {
        try {
            return {
                success: true,
                log: getStateServiceLog(typeof limit === 'number' ? limit : 200),
            };
        } catch (error) {
            return { success: false, error: String(error), log: [] };
        }
    });

    ipcMain.handle('state-service-state', () => {
        try {
            return {
                success: true,
                state: getGameState(),
            };
        } catch (error) {
            return { success: false, error: String(error), state: null };
        }
    });

    // Overlay controls
    ipcMain.handle('overlay-toggle', async () => {
        try {
            const visible = toggleOverlayVisibility();
            refreshLiveCadence();
            win?.webContents.send('overlay-visibility-changed', { visible });
            return { success: true, visible };
        } catch (error) {
            console.error('[overlay] Failed to toggle visibility:', error);
            return { success: false, visible: !isOverlayUserHidden() };
        }
    });

    ipcMain.handle('overlay-set-visible', async (_event, visible: boolean) => {
        try {
            setOverlayUserHidden(!visible);
            if (visible && isCurrentlyInGame()) {
                showOverlay();
            }
            refreshLiveCadence();
            win?.webContents.send('overlay-visibility-changed', { visible: !isOverlayUserHidden() });
            return { success: true, visible: !isOverlayUserHidden() };
        } catch (error) {
            console.error('[overlay] Failed to set visibility:', error);
            return { success: false, visible: !isOverlayUserHidden() };
        }
    });

    ipcMain.handle('overlay-toggle-clickthrough', async () => {
        try {
            const clickThrough = toggleClickThrough();
            win?.webContents.send('overlay-clickthrough-changed', { clickThrough });
            return { success: true, clickThrough };
        } catch (error) {
            console.error('[overlay] Failed to change interaction mode:', error);
            return { success: false, clickThrough: isClickThrough() };
        }
    });

    ipcMain.handle('overlay-set-align-mode', async (_event, enabled: boolean) => {
        try {
            const alignMode = setAlignMode(!!enabled);
            return { success: true, alignMode, clickThrough: isClickThrough() };
        } catch (error) {
            console.error('[overlay] Failed to set align mode:', error);
            return { success: false, alignMode: isAlignMode(), clickThrough: isClickThrough() };
        }
    });

    ipcMain.handle('overlay-set-hud-scale', async (_event, scale: number) => {
        if (!Number.isFinite(scale)) {
            return { success: false, hudScale: getHudScale() };
        }
        return { success: true, hudScale: setHudScale(scale) };
    });

    ipcMain.handle('overlay-set-map-scale', async (_event, scale: number) => {
        if (!Number.isFinite(scale)) {
            return { success: false, mapScale: getMapScale() };
        }
        return { success: true, mapScale: setMapScale(scale) };
    });

    ipcMain.handle('overlay-set-chrome-color', async (_event, color: string) => {
        return { success: true, chromeColor: setChromeColor(color) };
    });

    ipcMain.handle('overlay-set-text-scale', async (_event, scale: unknown) => {
        const next = setOverlayTextScale(scale);
        return { success: true, overlayTextScale: next };
    });

    ipcMain.handle('overlay-set-hud-modules', async (_event, modules: unknown) => {
        return { success: true, hudModules: setHudModules(modules) };
    });

    ipcMain.handle('overlay-set-hud-layout', async (_event, layout: unknown) => {
        return { success: true, hudLayout: setHudLayout(layout) };
    });

    ipcMain.handle('catalog-get', () => {
        return { success: true, catalog: loadCatalogCache() };
    });

    ipcMain.handle('catalog-refresh', async () => {
        const catalog = await refreshCatalogCache();
        return { success: !!catalog, catalog };
    });

    ipcMain.handle('mayhem-get', async () => {
        const { loadMayhemBundle } = await import('./mayhem-data');
        const bundle = loadMayhemBundle();
        return { success: !!bundle, bundle };
    });

    ipcMain.handle('mayhem-set-owned', async (_event, ids: unknown) => {
        const { setOwnedMayhemAugmentIds } = await import('./mayhem-state');
        const { notifyMayhemOverlayStateChanged } = await import('./game-monitor');
        const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
        setOwnedMayhemAugmentIds(list);
        notifyMayhemOverlayStateChanged();
        return { success: true };
    });

    ipcMain.handle('mayhem-set-roll', async (_event, ids: unknown) => {
        const { setMayhemRollIds } = await import('./mayhem-state');
        const { notifyMayhemOverlayStateChanged } = await import('./game-monitor');
        const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
        setMayhemRollIds(list);
        notifyMayhemOverlayStateChanged();
        return { success: true };
    });

    ipcMain.handle('mayhem-get-owned', async () => {
        const { getOwnedMayhemAugmentIds } = await import('./mayhem-state');
        return { success: true, owned: getOwnedMayhemAugmentIds() };
    });

    ipcMain.handle('mayhem-get-roll', async () => {
        const { getMayhemRollIds } = await import('./mayhem-state');
        return { success: true, roll: getMayhemRollIds() };
    });

    ipcMain.handle('mayhem-take-augment', async (_event, augmentId: unknown) => {
        const { getOwnedMayhemAugmentIds, setOwnedMayhemAugmentIds, setMayhemPicksTaken, getMayhemRollIds } =
            await import('./mayhem-state');
        const { clearMayhemOffersForDashboard, notifyMayhemOverlayStateChanged, getMayhemLiveOfferIds } =
            await import('./game-monitor');
        if (typeof augmentId !== 'string' || !augmentId) return { success: false };
        const roll = [...new Set([...getMayhemRollIds(), ...getMayhemLiveOfferIds()])];
        if (roll.length > 0 && !roll.includes(augmentId)) {
            return { success: false, error: 'not_on_current_roll' };
        }
        const owned = getOwnedMayhemAugmentIds();
        if (!owned.includes(augmentId)) {
            setOwnedMayhemAugmentIds([...owned, augmentId]);
        }
        const nextOwned = getOwnedMayhemAugmentIds();
        setMayhemPicksTaken(Math.max(nextOwned.length, 1));
        clearMayhemOffersForDashboard();
        notifyMayhemOverlayStateChanged();
        return { success: true, owned: nextOwned };
    });

    ipcMain.handle('mayhem-refresh', async () => {
        const { refreshMayhemBundle } = await import('./mayhem-data');
        try {
            const { bundle, fromNetwork } = await refreshMayhemBundle();
            return { success: true, bundle, fromNetwork };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Mayhem refresh failed' };
        }
    });

    ipcMain.handle('overlay-sync-league-scales', async () => {
        const res = syncScalesFromLeague();
        return { success: true, ...res };
    });

    ipcMain.handle(
        'overlay-adjust-calibration',
        async (_event, target: 'ability' | 'minimap', field: keyof FrameCalibration, delta: number) => {
            const result = adjustCalibration(target, field, delta);
            return { success: true, calibration: result };
        }
    );

    ipcMain.handle('overlay-reset-calibration', async () => {
        const result = resetCalibration();
        return { success: true, calibration: result };
    });

    ipcMain.handle('overlay-get-status', (event) => {
        const res = getGameResolution();
        return {
            success: true,
            ...overlaySlotFor(event.sender.id),
            visible: !isOverlayUserHidden(),
            clickThrough: isClickThrough(),
            alignMode: isAlignMode(),
            inGame: isCurrentlyInGame(),
            hudScale: getHudScale(),
            mapScale: getMapScale(),
            chromeColor: getChromeColor(),
            overlayTextScale: getOverlayTextScale(),
            hudModules: getHudModules(),
            hudLayout: getHudLayout(),
            calibration: getCalibration(),
            gameWidth: res.gameWidth,
            gameHeight: res.gameHeight,
        };
    });

    // Window Controls
    ipcMain.handle('window-minimize', () => {
        if (win) win.minimize();
    });

    ipcMain.handle('window-maximize', () => {
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    });

    ipcMain.handle('window-close', () => {
        if (win) win.close();
    });
});
