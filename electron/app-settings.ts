import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface AppSettings {
    /**
     * GPU compositing for One Trick's own windows. Off by default: the overlay
     * and dashboard are mostly static, so software rendering costs a little CPU
     * and keeps the GPU queue entirely for League.
     */
    gpuAcceleration: boolean;
    /** Hide the dashboard to the tray while a match runs (a hidden window never paints). */
    hideDashboardInGame: boolean;
    /** Master switch for the in-game overlay. */
    overlayEnabled: boolean;
    /** Send runes and the item set to the client as soon as you lock in. */
    autoImport: boolean;
    /** Also set summoner spells on lock-in (keeps Flash on the key you use). */
    autoSpells: boolean;
}

const DEFAULTS: AppSettings = {
    gpuAcceleration: false,
    hideDashboardInGame: true,
    overlayEnabled: true,
    autoImport: true,
    autoSpells: false,
};

let current: AppSettings | null = null;
/** GPU mode is fixed for the life of the process; a change needs a relaunch. */
let gpuAtLaunch: boolean | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function settingsFile(): string {
    return path.join(app.getPath('userData'), 'app-settings.json');
}

function normalize(raw: unknown): AppSettings {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
        if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
    }
    return out;
}

/** Synchronous on purpose: read once at startup, before the app is ready. */
export function loadAppSettings(): AppSettings {
    if (current) return current;
    try {
        current = normalize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
    } catch {
        current = { ...DEFAULTS };
    }
    if (gpuAtLaunch === null) gpuAtLaunch = current.gpuAcceleration;
    return current;
}

export function getAppSettings(): AppSettings {
    return { ...loadAppSettings() };
}

export function gpuAccelerationAtLaunch(): boolean {
    loadAppSettings();
    return !!gpuAtLaunch;
}

export function updateAppSettings(patch: unknown): { settings: AppSettings; restartRequired: boolean } {
    const next = normalize({ ...loadAppSettings(), ...(patch && typeof patch === 'object' ? patch : {}) });
    current = next;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
        writeTimer = null;
        fs.promises
            .writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
            .catch((error) => console.warn('[settings] save failed:', error));
    }, 150);
    return { settings: { ...next }, restartRequired: next.gpuAcceleration !== gpuAtLaunch };
}
