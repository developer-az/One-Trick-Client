/**
 * Global PageUp / PageDown (and Numpad 9 / 3) capture while League has focus.
 *
 * Uses `onetrick-keys.exe` (native/keyhook/keyhook.c): a tiny helper process
 * with a keyboard-only WH_KEYBOARD_LL hook on its own thread. It replaces
 * uiohook-napi, which also installed a system-wide WH_MOUSE_LL hook and pushed
 * every mouse movement through Electron's main thread for the whole match.
 *
 * Caveat (UIPI): if League runs elevated and One Trick does not, Windows will
 * not deliver keys from the elevated process to a lower-integrity hook. Run
 * One Trick as admin in that case (or don't elevate League).
 */
import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface FlashKeyHandlers {
    onPrimary: () => void;
    onSecondary: () => void;
}

export type KeyHookMode = 'native' | 'starting' | 'unavailable' | 'stopped';

let child: ChildProcess | null = null;
let handlers: FlashKeyHandlers | null = null;
let mode: KeyHookMode = 'stopped';
let lastError: string | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let restartAttempts = 0;
let stopping = false;
let lastFireAt = 0;
const DEBOUNCE_MS = 150;
const MAX_RESTARTS = 5;

function helperPath(): string | null {
    const candidates = app.isPackaged
        ? [path.join(process.resourcesPath, 'onetrick-keys.exe')]
        : [
              path.join(__dirname, '../native/bin/onetrick-keys.exe'),
              path.join(process.cwd(), 'native/bin/onetrick-keys.exe'),
          ];
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // try next
        }
    }
    return null;
}

function fire(kind: 'P' | 'S'): void {
    if (!handlers) return;
    const now = Date.now();
    if (now - lastFireAt < DEBOUNCE_MS) return;
    lastFireAt = now;
    if (kind === 'P') handlers.onPrimary();
    else handlers.onSecondary();
}

function scheduleRestart(): void {
    if (stopping || restartTimer || restartAttempts >= MAX_RESTARTS) {
        if (restartAttempts >= MAX_RESTARTS) mode = 'unavailable';
        return;
    }
    restartAttempts += 1;
    restartTimer = setTimeout(() => {
        restartTimer = null;
        spawnHelper();
    }, 1000 * restartAttempts);
}

function spawnHelper(): boolean {
    if (process.platform !== 'win32') {
        mode = 'unavailable';
        lastError = 'Global hotkeys need Windows';
        return false;
    }
    const exe = helperPath();
    if (!exe) {
        mode = 'unavailable';
        lastError = 'Hotkey helper (onetrick-keys.exe) is missing from this build';
        return false;
    }

    mode = 'starting';
    let proc: ChildProcess;
    try {
        proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
        mode = 'unavailable';
        lastError = error instanceof Error ? error.message : String(error);
        return false;
    }
    child = proc;

    let buffer = '';
    proc.stdout?.setEncoding('ascii');
    proc.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line === 'P' || line === 'S') {
                fire(line);
            } else if (line === 'R') {
                mode = 'native';
                lastError = null;
                restartAttempts = 0;
            } else if (line.startsWith('E')) {
                lastError = `Windows refused the keyboard hook (${line.slice(1).trim()})`;
            }
            nl = buffer.indexOf('\n');
        }
    });
    proc.on('error', (error) => {
        lastError = error.message;
    });
    proc.on('exit', () => {
        if (child === proc) child = null;
        if (stopping) {
            mode = 'stopped';
            return;
        }
        mode = 'starting';
        scheduleRestart();
    });
    return true;
}

/**
 * Start (or keep) the hotkey helper. Safe to call repeatedly: later calls only
 * swap handlers. Returns false when the native path is unavailable so callers
 * can fall back to Electron's globalShortcut.
 */
export function startFlashKeyHook(next: FlashKeyHandlers): boolean {
    handlers = next;
    stopping = false;
    if (child && !child.killed) return true;
    return spawnHelper();
}

export function stopFlashKeyHook(): void {
    stopping = true;
    handlers = null;
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    if (child) {
        try {
            child.stdin?.end();
            child.kill();
        } catch {
            // ignore
        }
        child = null;
    }
    mode = 'stopped';
}

export function isFlashKeyHookActive(): boolean {
    return mode === 'native' || mode === 'starting';
}

export function getKeyHookStatus(): { mode: KeyHookMode; error: string | null } {
    return { mode, error: lastError };
}
