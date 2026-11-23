import { execFile } from 'child_process';
import { readLeagueHudScales, type LeagueWindowMode } from './league-settings';

/**
 * Things outside One Trick that decide what an overlay costs.
 *
 * In borderless, League presents straight to the screen until any window
 * covers it; then Windows composites every frame. That is normally cheap,
 * but screen recorders can switch to a full-display capture path at the same
 * moment. Measured on one PC: any window over borderless League (even Task
 * Manager) took it from ~170 to ~20 FPS, while windowed mode was unaffected.
 */

/** Executable name (lower case) → name shown to the user. */
const RECORDERS: Record<string, string> = {
    'medal.exe': 'Medal',
    'medalencoder.exe': 'Medal',
    'obs64.exe': 'OBS',
    'obs32.exe': 'OBS',
    'streamlabs obs.exe': 'Streamlabs',
    'streamlabs desktop.exe': 'Streamlabs',
    'xsplit.core.exe': 'XSplit',
    'bandicam.exe': 'Bandicam',
    'action.exe': 'Action!',
    'outplayed.exe': 'Outplayed',
};

const CACHE_MS = 30_000;
let cached: { at: number; recorders: string[] } | null = null;
let pending: Promise<string[]> | null = null;

/** Parse `tasklist /fo csv /nh` output into recorder names, de-duplicated. */
export function recordersFromTasklist(csv: string): string[] {
    const found = new Set<string>();
    for (const line of csv.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        const name = m && RECORDERS[m[1].toLowerCase()];
        if (name) found.add(name);
    }
    return [...found].sort();
}

function listRecorders(): Promise<string[]> {
    if (process.platform !== 'win32') return Promise.resolve([]);
    if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.recorders);
    if (pending) return pending;
    pending = new Promise<string[]>((resolve) => {
        execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
            const recorders = error ? [] : recordersFromTasklist(stdout);
            cached = { at: Date.now(), recorders };
            pending = null;
            resolve(recorders);
        });
    });
    return pending;
}

/** `reg query ... /v OverlayTestMode` output → true when MPO is disabled (value 5). */
export function mpoOffFromReg(stdout: string): boolean {
    const m = stdout.match(/OverlayTestMode\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    return !!m && parseInt(m[1], 16) === 5;
}

/**
 * `reg query ... /v DirectXUserGlobalSettings` output → Windows 11
 * "Optimizations for windowed games" on/off; null when Windows never stored it.
 */
export function windowedOptimizationsFromReg(stdout: string): boolean | null {
    const m = stdout.match(/SwapEffectUpgradeEnable=(\d)/);
    return m ? m[1] === '1' : null;
}

function regQuery(key: string, value: string): Promise<string> {
    if (process.platform !== 'win32') return Promise.resolve('');
    return new Promise((resolve) => {
        // A missing value exits non-zero with empty stdout; the parsers treat that as "not set".
        execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (_error, stdout) => resolve(stdout || ''));
    });
}

export interface OverlayEnvironment {
    windowMode: LeagueWindowMode;
    recorders: string[];
    /** MPO disabled via Dwm OverlayTestMode=5 (takes effect after a restart). */
    mpoOff: boolean | null;
    /** Windows 11 "Optimizations for windowed games"; null = never set. */
    windowedGameOptimizations: boolean | null;
}

let settingsCache: { at: number; mpoOff: boolean | null; windowedGameOptimizations: boolean | null } | null = null;

async function windowsSettings(): Promise<{ mpoOff: boolean | null; windowedGameOptimizations: boolean | null }> {
    if (process.platform !== 'win32') return { mpoOff: null, windowedGameOptimizations: null };
    if (settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache;
    const [dwm, dx] = await Promise.all([
        regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm', 'OverlayTestMode'),
        regQuery('HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', 'DirectXUserGlobalSettings'),
    ]);
    settingsCache = { at: Date.now(), mpoOff: mpoOffFromReg(dwm), windowedGameOptimizations: windowedOptimizationsFromReg(dx) };
    return settingsCache;
}

export async function overlayEnvironment(): Promise<OverlayEnvironment> {
    const [recorders, settings] = await Promise.all([listRecorders(), windowsSettings()]);
    return {
        windowMode: readLeagueHudScales()?.windowMode ?? null,
        recorders,
        mpoOff: settings.mpoOff,
        windowedGameOptimizations: settings.windowedGameOptimizations,
    };
}
