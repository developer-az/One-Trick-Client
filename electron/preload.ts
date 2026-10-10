import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    connectLCU: () => ipcRenderer.invoke('lcu-connect'),
    requestLCU: (method: string, endpoint: string, body?: unknown) => ipcRenderer.invoke('lcu-request', method, endpoint, body),
    onUpdate: (callback: (value: unknown) => void) => ipcRenderer.on('main-process-message', (_event, value) => callback(value)),
    exportItemSet: (build: {
        starter: Array<{ id: string }>;
        core: Array<{ id: string }>;
        boots: { id: string };
        situational: Array<{ id: string }>;
        buildPath: Array<{ id: string }>;
        championKey?: number;
        title?: string;
    }) => ipcRenderer.invoke('lcu-export-item-set', build),
    exportRunePage: (runePage: {
        name: string;
        primaryStyleId: number;
        subStyleId: number;
        selectedPerkIds: number[];
        current?: boolean;
    }) => ipcRenderer.invoke('lcu-export-rune-page', runePage),
    clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard-write', text),
    markSummonerSpell: (role: string, spellName: string, opts?: { clear?: boolean }) =>
        ipcRenderer.invoke('summoner-mark', role, spellName, opts),
    toggleSummonerSpell: (role: string, spellName: string) =>
        ipcRenderer.invoke('summoner-toggle', role, spellName),
    windowMinimize: () => ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => ipcRenderer.invoke('window-maximize'),
    windowClose: () => ipcRenderer.invoke('window-close'),

    // Live Client + Overlay
    getLiveClientData: () => ipcRenderer.invoke('live-client-data'),
    toggleOverlay: () => ipcRenderer.invoke('overlay-toggle'),
    setOverlayVisible: (visible: boolean) => ipcRenderer.invoke('overlay-set-visible', visible),
    toggleOverlayClickThrough: () => ipcRenderer.invoke('overlay-toggle-clickthrough'),
    setOverlayAlignMode: (enabled: boolean) => ipcRenderer.invoke('overlay-set-align-mode', enabled),
    setOverlayHudScale: (scale: number) => ipcRenderer.invoke('overlay-set-hud-scale', scale),
    setOverlayMapScale: (scale: number) => ipcRenderer.invoke('overlay-set-map-scale', scale),
    setOverlayChromeColor: (color: string) => ipcRenderer.invoke('overlay-set-chrome-color', color),
    setOverlayHudModules: (modules: unknown) => ipcRenderer.invoke('overlay-set-hud-modules', modules),
    setOverlayHudLayout: (layout: unknown) => ipcRenderer.invoke('overlay-set-hud-layout', layout),
    getCatalog: () => ipcRenderer.invoke('catalog-get'),
    refreshCatalog: () => ipcRenderer.invoke('catalog-refresh'),
    syncLeagueScales: () => ipcRenderer.invoke('overlay-sync-league-scales'),
    adjustOverlayCalibration: (target: 'ability' | 'minimap', field: 'dx' | 'dy' | 'dw' | 'dh', delta: number) =>
        ipcRenderer.invoke('overlay-adjust-calibration', target, field, delta),
    resetOverlayCalibration: () => ipcRenderer.invoke('overlay-reset-calibration'),
    getOverlayStatus: () => ipcRenderer.invoke('overlay-get-status'),
    onOverlayUpdate: (callback: (payload: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
        ipcRenderer.on('overlay-update', listener);
        return () => ipcRenderer.removeListener('overlay-update', listener);
    },
    onOverlayMeta: (callback: (payload: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
        ipcRenderer.on('overlay-meta', listener);
        return () => ipcRenderer.removeListener('overlay-meta', listener);
    },
    onOverlayVisibilityChanged: (callback: (payload: { visible: boolean }) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: { visible: boolean }) => callback(payload);
        ipcRenderer.on('overlay-visibility-changed', listener);
        return () => ipcRenderer.removeListener('overlay-visibility-changed', listener);
    },
});
