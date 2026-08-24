import { app, BrowserWindow, ipcMain, globalShortcut, clipboard } from 'electron';
import fs from 'fs';
import path from 'path';
import { connectToLCU, makeLCURequest } from './lcu-connector';
import { fetchLiveClientData } from './live-client';
import {
    startGameMonitor,
    stopGameMonitor,
    isCurrentlyInGame,
    setGameStateChangeHandler,
    setMatchStartHotkeyHandler,
    pushSummonerUpdate,
} from './game-monitor';
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
    getHudModules,
    setHudModules,
    syncScalesFromLeague,
    getCalibration,
    adjustCalibration,
    resetCalibration,
    getGameResolution,
    broadcastOverlayMeta,
    type FrameCalibration,
} from './overlay-window';
import {
    formatAdcClipboard,
    markSpellUsed,
    toggleSpellUsed,
    getSummonerFocus,
    type TrackedRole,
} from './summoner-tracker';
import { startFlashKeyHook, stopFlashKeyHook, isFlashKeyHookActive } from './global-key-hook';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function resolveAppIcon(): string {
    const candidates = [
        path.join(process.env.VITE_PUBLIC || '', 'icon.ico'),
        path.join(process.env.VITE_PUBLIC || '', 'icon.png'),
        path.join(__dirname, '../build/icon.ico'),
        path.join(__dirname, '../build/icon.png'),
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return path.join(process.env.VITE_PUBLIC || '', 'icon.png');
}

function createWindow() {
    win = new BrowserWindow({
        width: 980,
        height: 640,
        minWidth: 760,
        minHeight: 520,
        icon: resolveAppIcon(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // Default true — keep main UI throttled when unfocused/minimized so
            // it does not compete with League for CPU while a match is running.
            backgroundThrottling: true,
        },
        backgroundColor: '#0b0c0e',
        frame: false,
        transparent: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#101114',
            symbolColor: '#d4d8de',
            height: 40
        }
    });

    win.on('closed', () => {
        win = null;
        stopGameMonitor();
        destroyOverlay();
        stopFlashKeyHook();
        globalShortcut.unregisterAll();
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString());
    });

    const loadMain = async () => {
        if (VITE_DEV_SERVER_URL) {
            await win?.loadURL(VITE_DEV_SERVER_URL);
        } else if (!app.isPackaged) {
            await win?.loadURL('http://localhost:5173/');
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
    const { primary } = flashToggleRoles();
    const res = toggleSpellUsed(primary, 'Flash');
    if (res.success) pushSummonerUpdate();
}

function onFlashSecondary(): void {
    const { secondary } = flashToggleRoles();
    if (getSummonerFocus() === 'mid') {
        // Mid: PageDown toggles Ignite, then Teleport as fallback
        let res = toggleSpellUsed(secondary, 'Ignite');
        if (!res.success) res = toggleSpellUsed(secondary, 'Teleport');
        if (!res.success) res = toggleSpellUsed(secondary, 'Flash');
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
function registerFlashHotkeys(): void {
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
    });

    if (hookOk && isFlashKeyHookActive()) {
        return;
    }

    // Fallback — usually insufficient while League is focused
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
            '[overlay] Flash hotkeys fallback incomplete. Prefer fixing uiohook-napi load, ' +
                'or run One Trick as admin if League is elevated.'
        );
    } else {
        console.warn(
            '[overlay] Using Electron globalShortcut fallback for PageUp/PageDown — ' +
                'these often fail while League has focus. Check that uiohook-napi loaded.'
        );
    }
}

function registerOverlayHotkeys() {
    // Avoid Ctrl+Shift+I — Electron/Chromium reserves it for DevTools
    // Ctrl+Shift combos still use globalShortcut (rarely conflict with League).
    const hideOk = globalShortcut.register('CommandOrControl+Shift+H', () => {
        const visible = toggleOverlayVisibility();
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
    stopFlashKeyHook();
    globalShortcut.unregisterAll();
});

app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.onetrick.app');
    }
    createWindow();
    // Overlay is created only when a match starts (see game-monitor) —
    // avoid a permanent fullscreen transparent window sitting idle.
    registerOverlayHotkeys();
    // Re-bind Flash keys every match start (Windows can drop hotkeys after focus fights)
    setMatchStartHotkeyHandler(() => {
        registerFlashHotkeys();
    });

    // Minimize the main window during matches so its renderer/GPU work
    // does not steal frames from League. Restore when the match ends.
    setGameStateChangeHandler((active) => {
        if (!win || win.isDestroyed()) return;
        if (active) {
            if (!win.isMinimized()) win.minimize();
        } else if (win.isMinimized()) {
            win.restore();
        }
    });

    // Start monitoring once LCU may be available — reconnect attempts happen in tick
    // Delay slightly so main window loads first
    setTimeout(() => {
        startGameMonitor();
    }, 2000);

    // IPC Handlers
    ipcMain.handle('lcu-connect', async () => {
        try {
            const credentials = await connectToLCU();
            // Kick monitor after successful connect
            startGameMonitor();
            return { success: true, credentials };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Unknown error' };
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

    // Live Client Data (in-game, including Practice Tool)
    ipcMain.handle('live-client-data', async () => {
        try {
            const data = await fetchLiveClientData();
            return { success: !!data, data };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    // Overlay controls
    ipcMain.handle('overlay-toggle', async () => {
        try {
            const visible = toggleOverlayVisibility();
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

    ipcMain.handle('overlay-set-hud-modules', async (_event, modules: unknown) => {
        return { success: true, hudModules: setHudModules(modules) };
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

    ipcMain.handle('overlay-get-status', () => {
        const res = getGameResolution();
        return {
            success: true,
            visible: !isOverlayUserHidden(),
            clickThrough: isClickThrough(),
            alignMode: isAlignMode(),
            inGame: isCurrentlyInGame(),
            hudScale: getHudScale(),
            mapScale: getMapScale(),
            chromeColor: getChromeColor(),
            hudModules: getHudModules(),
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
