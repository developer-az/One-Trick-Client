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

export interface OverlayEnvironment {
    windowMode: LeagueWindowMode;
    recorders: string[];
}

export async function overlayEnvironment(): Promise<OverlayEnvironment> {
    return {
        windowMode: readLeagueHudScales()?.windowMode ?? null,
        recorders: await listRecorders(),
    };
}
