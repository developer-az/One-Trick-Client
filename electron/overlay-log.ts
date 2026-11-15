/**
 * Small lifecycle log for the overlay windows.
 *
 * The overlay problem it exists for is invisible from the outside: the windows
 * kept their always-on-top flag but sat below another topmost window, so the
 * app believed they were shown. A bounded log file makes "raise / rebuild /
 * hide why" reviewable after a match.
 *
 * Constraints: never throws, never blocks the caller with disk IO, at most one
 * flush per second, rotates above 1 MB. Importing this module must not require
 * Electron (the pure formatter is used by verify_overlay_health.ts).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Rotate overlay.log → overlay.log.1 once it grows past this. */
const LOG_MAX_BYTES = 1024 * 1024;
/** Buffered writes: at most one disk append per second. */
const FLUSH_INTERVAL_MS = 1000;
/** Hard cap on buffered lines so a tight log loop cannot grow memory unbounded. */
const MAX_BUFFERED_LINES = 500;

function flatten(value: unknown): string {
    return String(value).replace(/[\r\n]+/g, ' ');
}

/** `<ISO ts> <event> k=v k=v` — always exactly one line. */
export function formatOverlayLogLine(
    ts: number,
    event: string,
    detail?: Record<string, unknown>
): string {
    const time = Number.isFinite(ts) ? ts : Date.now();
    let line = `${new Date(time).toISOString()} ${flatten(event)}`;
    if (detail) {
        for (const [key, value] of Object.entries(detail)) {
            if (value === undefined) continue;
            line += ` ${flatten(key)}=${flatten(value)}`;
        }
    }
    // Detail values are flattened above; keep the whole line single-line regardless.
    return line.replace(/[\r\n]+/g, ' ');
}

let logBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let logChain: Promise<void> = Promise.resolve();

/**
 * Same resolution as electron/paths.ts::userDataDir(), loaded lazily so a test
 * can import this module without Electron present.
 */
async function resolveUserDataDir(): Promise<string> {
    try {
        const paths = await import('./paths');
        const dir = paths.userDataDir();
        if (dir) return dir;
    } catch {
        // Fall through to the shared non-Electron fallback.
    }
    return process.env.ONETRICK_USER_DATA || path.join(os.tmpdir(), 'onetrick-userdata');
}

function logFilePath(userData: string): string {
    return path.join(userData, 'logs', 'overlay.log');
}

/** Size-capped rotation: overlay.log → overlay.log.1, then start fresh. */
function rotateIfNeeded(file: string): void {
    try {
        if (fs.statSync(file).size < LOG_MAX_BYTES) return;
        const rolled = `${file}.1`;
        if (fs.existsSync(rolled)) fs.unlinkSync(rolled);
        fs.renameSync(file, rolled);
    } catch {
        // No file yet, or the OS refused the rename. Never fatal.
    }
}

function flushLog(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (!logBuffer.length) return;
    const chunk = `${logBuffer.join('\n')}\n`;
    logBuffer = [];
    // Disk IO stays off the caller's path (renderer events, the live tick).
    logChain = logChain
        .then(async () => {
            const file = logFilePath(await resolveUserDataDir());
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            rotateIfNeeded(file);
            await fs.promises.appendFile(file, chunk, 'utf8');
        })
        .catch(() => {
            // Logging must never break the match loop.
        });
}

/** Queue one lifecycle line. Buffered, async, never throws. */
export function overlayLog(event: string, detail?: Record<string, unknown>): void {
    try {
        logBuffer.push(formatOverlayLogLine(Date.now(), event, detail));
        if (logBuffer.length > MAX_BUFFERED_LINES) {
            logBuffer.splice(0, logBuffer.length - MAX_BUFFERED_LINES);
        }
        if (!flushTimer) {
            flushTimer = setTimeout(flushLog, FLUSH_INTERVAL_MS);
            flushTimer?.unref?.();
        }
    } catch {
        // Logging must never throw into an Electron event handler.
    }
}
