/**
 * Post-match crash net (2026-11-13).
 *
 * After a match ends the overlay surface (and sometimes the dashboard) can be
 * torn down while a renderer event, a reload timer or a live tick is still in
 * flight. Touching a destroyed Electron window or webContents then throws
 * `TypeError: Object has been destroyed` — an "uncaughtException" that kills
 * the whole app. The guards here make window-touching code survivable:
 *
 * - safeCall(fn, onError)   — run fn, swallow destroyed-object errors, report
 *   anything else through onError, never rethrow.
 * - isWinAlive(win)         — cheap liveness probe that itself never throws.
 * - installCrashNet(log)    — last-chance uncaughtException/unhandledRejection
 *   handlers for the main process. Idempotent.
 *
 * This module must stay importable without Electron: the verify script pokes
 * it with fake window objects under plain node.
 */

/**
 * Run a call, returning its value, or undefined if it throws. Errors whose
 * message mentions "destroyed" are the known post-match teardown race
 * ("Object has been destroyed") and are swallowed silently; any other error
 * is forwarded to onError (which must never throw). Never rethrows.
 */
export function safeCall<T>(fn: () => T, onError?: (e: unknown) => void): T | undefined {
    try {
        return fn();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('destroyed')) return undefined;
        if (onError) {
            try {
                onError(error);
            } catch {
                // The error reporter must never throw into a catch block.
            }
        }
        return undefined;
    }
}

/**
 * Whether a BrowserWindow-like object is still safe to touch: non-null, not
 * destroyed, and its webContents still alive. Everything sits inside a
 * try/catch, so a window that is mid-teardown (methods throwing
 * "Object has been destroyed") counts as dead instead of crashing the caller.
 */
export function isWinAlive(win: unknown): boolean {
    try {
        if (!win) return false;
        const w = win as { isDestroyed?: () => boolean; webContents?: { isDestroyed?: () => boolean } };
        if (typeof w.isDestroyed !== 'function' || w.isDestroyed()) return false;
        if (!w.webContents || typeof w.webContents.isDestroyed !== 'function') return false;
        return !w.webContents.isDestroyed();
    } catch {
        return false;
    }
}

let crashNetInstalled = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Last-chance handlers for the Electron main process. Registers ONCE no
 * matter how many times it is called. Errors whose message contains
 * "Object has been destroyed" are the expected post-match race — they are
 * logged and the process lives on. Any other error is logged loudly too:
 * nothing is swallowed silently beyond the log line, and process.exit is
 * never called from here.
 */
export function installCrashNet(log: (m: string) => void): void {
    if (crashNetInstalled) return;
    crashNetInstalled = true;
    const handle = (kind: string, error: unknown): void => {
        try {
            const message = errorMessage(error);
            if (message.includes('Object has been destroyed')) {
                log(`[crash-net] ${kind} ignored: ${message}`);
                return;
            }
            const stack = error instanceof Error && error.stack ? error.stack : message;
            log(`[crash-net] ${kind}: ${stack}`);
        } catch {
            // Logging must never throw into an Electron event handler.
        }
    };
    process.on('uncaughtException', (error) => handle('uncaughtException', error));
    process.on('unhandledRejection', (error) => handle('unhandledRejection', error));
}