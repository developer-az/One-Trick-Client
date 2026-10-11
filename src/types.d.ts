export { };

declare global {
    interface FrameCalibration {
        dx: number;
        dy: number;
        dw: number;
        dh: number;
    }

    interface OverlayCalibration {
        ability: FrameCalibration;
        minimap: FrameCalibration;
    }

    type HudModuleId = 'sums' | 'gank' | 'vision' | 'buy' | 'action' | 'frames';
    type HudModules = Record<HudModuleId, boolean>;

    interface LcuStatus {
        state: 'searching' | 'connecting' | 'connected';
        phase: string | null;
        summonerName: string | null;
        connectedAt: number | null;
    }

    interface AppSettings {
        /** GPU compositing for One Trick's own windows. Off keeps the GPU for League. */
        gpuAcceleration: boolean;
        /** Hide the dashboard to the tray while a match runs. */
        hideDashboardInGame: boolean;
        /** Master switch for the in-game overlay. */
        overlayEnabled: boolean;
    }

    interface PerfProcessStat {
        type: string;
        name: string;
        cpu: number;
        memoryMb: number;
    }

    interface PerfStats {
        processes: PerfProcessStat[];
        totalCpu: number;
        totalMemoryMb: number;
        overlayWindows: number;
        overlayVisible: boolean;
        gpuAcceleration: boolean;
        gpuActive: boolean;
        hotkeys: { mode: string; error: string | null };
        lcu: LcuStatus;
        inGame: boolean;
        livePollMs: number | null;
        liveReads: number;
    }

    interface Window {
        electronAPI?: {
            connectLCU: () => Promise<{ success: boolean; credentials?: { port: string; token: string; protocol: string }; error?: string }>;
            requestLCU: (method: string, endpoint: string, body?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
            exportItemSet: (build: {
                starter: Array<{ id: string }>;
                core: Array<{ id: string }>;
                boots: { id: string };
                situational: Array<{ id: string }>;
                buildPath: Array<{ id: string }>;
                championKey?: number;
                title?: string;
            }) => Promise<{ success: boolean; error?: string }>;
            exportRunePage: (runePage: {
                name: string;
                primaryStyleId: number;
                subStyleId: number;
                selectedPerkIds: number[];
                current?: boolean;
            }) => Promise<{ success: boolean; error?: string }>;
            clipboardWrite: (text: string) => Promise<{ success: boolean; error?: string }>;
            markSummonerSpell: (
                role: 'Bot' | 'Support' | 'Mid',
                spellName: string,
                opts?: { clear?: boolean }
            ) => Promise<{ success: boolean; error?: string }>;
            toggleSummonerSpell: (
                role: 'Bot' | 'Support' | 'Mid',
                spellName: string
            ) => Promise<{ success: boolean; active: boolean; error?: string }>;
            onUpdate: (callback: (value: unknown) => void) => void;
            windowMinimize: () => Promise<void>;
            windowMaximize: () => Promise<void>;
            windowClose: () => Promise<void>;

            getLiveClientData: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
            toggleOverlay: () => Promise<{ success: boolean; visible: boolean }>;
            setOverlayVisible: (visible: boolean) => Promise<{ success: boolean; visible: boolean }>;
            toggleOverlayClickThrough: () => Promise<{ success: boolean; clickThrough: boolean }>;
            setOverlayAlignMode: (enabled: boolean) => Promise<{ success: boolean; alignMode: boolean; clickThrough: boolean }>;
            setOverlayHudScale: (scale: number) => Promise<{ success: boolean; hudScale: number }>;
            setOverlayMapScale: (scale: number) => Promise<{ success: boolean; mapScale: number }>;
            setOverlayChromeColor: (color: string) => Promise<{ success: boolean; chromeColor: string }>;
            setOverlayHudModules: (modules: Partial<HudModules>) => Promise<{ success: boolean; hudModules: HudModules }>;
            setOverlayHudLayout: (layout: unknown) => Promise<{ success: boolean; hudLayout?: unknown }>;
            getCatalog: () => Promise<{ success: boolean; catalog?: unknown }>;
            refreshCatalog: () => Promise<{ success: boolean; catalog?: unknown }>;
            syncLeagueScales: () => Promise<{ success: boolean; hudScale: number; mapScale: number; source?: string }>;
            adjustOverlayCalibration: (target: 'ability' | 'minimap', field: 'dx' | 'dy' | 'dw' | 'dh', delta: number) => Promise<{ success: boolean; calibration: OverlayCalibration }>;
            resetOverlayCalibration: () => Promise<{ success: boolean; calibration: OverlayCalibration }>;
            getOverlayStatus: () => Promise<{
                success: boolean;
                visible: boolean;
                clickThrough: boolean;
                alignMode?: boolean;
                inGame: boolean;
                hudScale: number;
                mapScale?: number;
                chromeColor?: string;
                hudModules?: HudModules;
                hudLayout?: unknown;
                calibration?: OverlayCalibration;
                gameWidth?: number;
                gameHeight?: number;
            }>;
            onOverlayUpdate: (callback: (payload: unknown) => void) => (() => void) | void;
            onOverlayMeta: (callback: (payload: unknown) => void) => (() => void) | void;
            onOverlayVisibilityChanged: (callback: (payload: { visible: boolean }) => void) => (() => void) | void;

            getLcuStatus?: () => Promise<LcuStatus>;
            onLcuStatus?: (callback: (payload: LcuStatus) => void) => () => void;
            getChampSelect?: () => Promise<{ session: unknown | null }>;
            onChampSelect?: (callback: (session: unknown | null) => void) => () => void;

            getAppSettings?: () => Promise<AppSettings>;
            setAppSettings?: (patch: Partial<AppSettings>) => Promise<{ settings: AppSettings; restartRequired: boolean }>;
            relaunchApp?: () => Promise<void>;
            getPerfStats?: () => Promise<PerfStats>;
            reportOverlayContent?: (hasContent: boolean) => void;
        };
    }
}
