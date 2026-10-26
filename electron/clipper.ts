/**
 * Medal-style auto-clipping — ffmpeg ring buffer of the desktop.
 *
 * Writes fixed-length segments while a match runs, then stitches
 * [event - lead, event + tail] into clips/ when a Great+ play fires.
 * The stitch waits out the tail so the file includes the aftermath, not just
 * the frames already on disk when the kill happened.
 *
 * Design notes:
 * - **Off unless the user turns Auto-clip on.** A desktop capture costs frames.
 *   The rest of the app must fully work with it off.
 * - **ffmpeg is optional.** If no binary is found, the recorder stays disabled
 *   and reports why.
 * - Recording runs for the match and stops when the match ends or Auto-clip is
 *   turned off. It does not watch foreground focus.
 * - Nothing here sends input or reads memory: it records the screen the user
 *   already sees, exactly like OBS/Medal do.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { userDataDir } from './paths';
import {
    CLIP_MAX_PER_MATCH,
    clipFileName,
    clipSidecarName,
    planClip,
    pruneSegments,
    parseSegmentFileName,
    segmentStartFromCounter,
    type SegmentInfo,
} from '../src/logic/clipper-plan';

const SEGMENT_SEC = 5;
const RETENTION_SEC = 120;
const CLIP_LEAD_SEC = 20;
const CLIP_TAIL_SEC = 8;
/**
 * 12fps 720p ultrafast. Capture still reads the desktop, so this stays off
 * until the user opts in. 30fps veryfast was enough to cost a ranked game frames.
 */
const FPS = 12;
const CAPTURE_H = 720;
/** Numbers at least this large are wall-clock ms, not ffmpeg's segment counter. */
const WALL_CLOCK_MIN_MS = 1e11;

export type ClipperStatus = 'disabled' | 'idle' | 'recording' | 'stitching' | 'error';

let status: ClipperStatus = 'disabled';
let statusDetail = 'Not started';
let ffmpegPath: string | null = null;
let ffmpegKnown = false;
let locateFfmpegTask: Promise<string | null> | null = null;
let ffmpegProc: ChildProcessWithoutNullStreams | null = null;
let recording = false;
let activeStitches = 0;
let stitchQueue: Promise<unknown> = Promise.resolve();
/** User setting. Off by default so a match does not start a screen capture. */
let autoClipEnabled = false;
/** Wall-clock ms of segment index 0 for the current recording session. */
let segmentEpochMs = 0;
let starting: Promise<void> | null = null;

interface QueuedClip {
    timer: ReturnType<typeof setTimeout>;
    opts: ClipRequest;
}

const queued = new Map<string, QueuedClip>();

interface ClipRequest {
    eventMs: number;
    gameTimeSec: number;
    label: string;
    score?: number;
    reasons?: string[];
    leadSec?: number;
    tailSec?: number;
}

function clipsDir(): string {
    return path.join(userDataDir(), 'clips');
}

function segmentsDir(): string {
    return path.join(os.tmpdir(), 'onetrick-clips-segments');
}

/** Locate ffmpeg: bundled resource first, then PATH. Never throws. */
async function findFfmpeg(): Promise<string | null> {
    const candidates = [
        process.env.ONETRICK_FFMPEG || '',
        path.join(process.resourcesPath || '', 'ffmpeg.exe'),
        path.join(process.resourcesPath || '', 'ffmpeg'),
        'ffmpeg',
    ].filter((p) => p.length > 0);
    for (const candidate of candidates) {
        const found = await probeFfmpeg(candidate);
        if (found) return candidate;
    }
    return null;
}

function locateFfmpeg(): Promise<string | null> {
    if (ffmpegPath) return Promise.resolve(ffmpegPath);
    if (!locateFfmpegTask) {
        locateFfmpegTask = findFfmpeg().then((found) => {
            ffmpegKnown = true;
            ffmpegPath = found;
            return found;
        });
    }
    return locateFfmpegTask;
}

/** Probe ffmpeg once so the Performance page can say why no videos exist. Does not record. */
export function ensureClipperProbed(): Promise<void> {
    return locateFfmpeg().then(() => undefined);
}

function probeFfmpeg(candidate: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const probe = spawn(candidate, ['-version'], { windowsHide: true, stdio: 'ignore' });
            probe.on('error', () => resolve(false));
            probe.on('close', (code) => {
                try {
                    probe.kill();
                } catch {
                    /* ignore */
                }
                resolve(code === 0);
            });
        } catch {
            resolve(false);
        }
    });
}

/** Start the recorder if ffmpeg exists. Idempotent and failure-tolerant. */
export async function startClipper(): Promise<void> {
    if (!autoClipEnabled) {
        if (!recording && status !== 'error') {
            status = 'idle';
            statusDetail = 'Auto-clip is off. Turn it on in Performance to record moments.';
        }
        return;
    }
    if (recording || status === 'stitching') return;
    if (starting) return starting;
    starting = prepareClipper().finally(() => {
        starting = null;
    });
    return starting;
}

async function prepareClipper(): Promise<void> {
    if (!ffmpegPath) {
        await locateFfmpeg();
        if (!ffmpegPath) {
            status = 'disabled';
            statusDetail = 'ffmpeg not found — auto-clipping off. Install ffmpeg or bundle it to enable.';
            return;
        }
    }
    try {
        fs.mkdirSync(segmentsDir(), { recursive: true });
        fs.mkdirSync(clipsDir(), { recursive: true });
        pruneOldSegments();
    } catch (error) {
        status = 'error';
        statusDetail = `Cannot create clip folders: ${String(error)}`;
        return;
    }
    if (!recording) {
        statusDetail = 'Ready — recording starts with the next match.';
        status = 'idle';
    }
}

/**
 * Apply the Auto-clip setting. When it is on and a match is running, recording
 * starts. When it is off, any capture stops and ffmpeg is not probed.
 */
export function syncAutoClip(enabled: boolean, recordNow: boolean): void {
    autoClipEnabled = enabled;
    if (!enabled) {
        if (recording) stopRecording();
        else if (status !== 'error') {
            status = 'idle';
            statusDetail = 'Auto-clip is off. Turn it on in Performance to record moments.';
        }
        return;
    }
    void startClipper().then(() => {
        if (autoClipEnabled) setClipperActive(recordNow);
    });
}

/** Pause when the game ends; segments stay so a queued tail can still stitch. */
export function setClipperActive(active: boolean): void {
    if (!autoClipEnabled) {
        if (recording) stopRecording();
        return;
    }
    if (!ffmpegPath) {
        if (!active) return;
        void startClipper().then(() => {
            if (autoClipEnabled && !recording) startRecording();
        });
        return;
    }
    if (active && !recording) {
        startRecording();
    } else if (!active && recording) {
        stopRecording();
        status = 'idle';
        statusDetail = 'Match over — ring buffer paused.';
    }
}

function startRecording(): void {
    if (!autoClipEnabled || !ffmpegPath || recording || ffmpegProc) return;
    const dir = segmentsDir();
    // Clear stale segments from a previous session first.
    try {
        for (const f of fs.readdirSync(dir)) {
            if (parseSegmentFileName(f) !== null) fs.unlinkSync(path.join(dir, f));
        }
    } catch {
        /* ignore */
    }
    segmentEpochMs = Date.now();
    const gop = String(FPS * SEGMENT_SEC);
    const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-fflags', '+genpts',
        '-f', 'gdigrab',
        '-framerate', String(FPS),
        '-draw_mouse', '0',
        '-i', 'desktop',
        '-vf', `scale=-2:${CAPTURE_H}`,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-crf', '32',
        '-pix_fmt', 'yuv420p',
        '-g', gop,
        '-keyint_min', gop,
        '-f', 'segment',
        '-segment_time', String(SEGMENT_SEC),
        '-segment_start_number', '0',
        '-reset_timestamps', '1',
        path.join(dir, 'seg-%013d.mp4'),
    ];
    try {
        const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr?.on('data', (c) => {
            const text = String(c).trim();
            if (text) console.warn('[clipper]', text.slice(0, 200));
        });
        proc.on('error', (error) => {
            console.warn('[clipper] recorder died:', error);
            recording = false;
            status = 'error';
            statusDetail = String(error);
        });
        ffmpegProc = proc;
        recording = true;
        status = 'recording';
        statusDetail = 'Recording ring buffer (last 2 min).';
    } catch (error) {
        status = 'error';
        statusDetail = String(error);
    }
}

function stopRecording(): void {
    if (ffmpegProc) {
        try {
            // Closing stdin lets ffmpeg finalise the last segment cleanly.
            ffmpegProc.stdin?.end();
            ffmpegProc.kill();
        } catch {
            /* ignore */
        }
        ffmpegProc = null;
    }
    recording = false;
    // A kill that was still waiting for its tail should stitch whatever was captured.
    flushQueued();
}

function listSegments(): SegmentInfo[] {
    const dir = segmentsDir();
    try {
        const rows: Array<{ file: string; startMs: number; index: number | null }> = [];
        for (const file of fs.readdirSync(dir)) {
            const n = parseSegmentFileName(file);
            if (n === null) continue;
            if (n >= WALL_CLOCK_MIN_MS) {
                rows.push({ file, startMs: n, index: null });
                continue;
            }
            if (segmentEpochMs <= 0) continue;
            rows.push({
                file,
                startMs: segmentStartFromCounter(n, segmentEpochMs, SEGMENT_SEC),
                index: n,
            });
        }
        let maxIndex = -1;
        for (const row of rows) {
            if (row.index !== null && row.index > maxIndex) maxIndex = row.index;
        }
        const now = Date.now();
        return rows.map((row) => {
            let durationSec = SEGMENT_SEC;
            if (row.index !== null && row.index === maxIndex) {
                durationSec = Math.min(SEGMENT_SEC, Math.max(0, (now - row.startMs) / 1000));
            }
            return { file: row.file, startMs: row.startMs, durationSec };
        });
    } catch {
        return [];
    }
}

/**
 * Stitch a clip for a scored moment. `gameTimeSec` labels the file; the
 * wall-clock trigger is `eventMs`. Returns the clip path, or null.
 */
export async function saveClip(opts: ClipRequest): Promise<string | null> {
    if (!ffmpegPath) return null;
    const segments = listSegments();
    if (!segments.length) {
        statusDetail = 'Trigger arrived but no segments exist yet.';
        return null;
    }
    const plan = planClip(segments, {
        eventMs: opts.eventMs,
        leadSec: opts.leadSec ?? CLIP_LEAD_SEC,
        tailSec: opts.tailSec ?? CLIP_TAIL_SEC,
    });
    if (!plan) {
        statusDetail = 'Trigger arrived but the ring buffer does not cover it.';
        return null;
    }

    activeStitches += 1;
    status = 'stitching';
    statusDetail = 'Stitching clip…';
    const name = clipFileName(opts.gameTimeSec, opts.label);
    fs.mkdirSync(clipsDir(), { recursive: true });
    const outPath = path.join(clipsDir(), name);

    const task = stitchQueue.then(async () => {
        try {
            await stitch(plan.parts, outPath);
            fs.writeFileSync(
                path.join(clipsDir(), clipSidecarName(name)),
                JSON.stringify(
                    {
                        label: opts.label,
                        score: opts.score ?? null,
                        reasons: opts.reasons ?? [],
                        gameTimeSec: opts.gameTimeSec,
                        savedAt: Date.now(),
                        truncatedLead: plan.truncatedLead,
                    },
                    null,
                    2
                ),
                'utf8'
            );
            statusDetail = `Saved ${name}`;
            clipListCache = null;
            pruneOldSegments();
            return outPath;
        } catch (error) {
            statusDetail = `Stitch failed: ${String(error)}`;
            return null;
        } finally {
            activeStitches -= 1;
            if (activeStitches === 0) {
                status = recording ? 'recording' : 'idle';
            }
        }
    });
    stitchQueue = task.then(() => {}, () => {});
    return task;
}

/**
 * Re-encode only what must change. First and last parts are cut with -ss/-t;
 * multi-segment clips go through the concat demuxer so middle parts copy.
 */
const MAX_STITCH_PARTS = 16;

function stitch(
    parts: { file: string; startSec: number; durationSec: number }[],
    outPath: string
): Promise<void> {
    const dir = segmentsDir();
    if (parts.length > MAX_STITCH_PARTS) {
        return Promise.reject(new Error('clip span too long'));
    }
    if (parts.length === 1) {
        const p = parts[0];
        return runFfmpeg([
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', p.startSec.toFixed(3),
            '-t', p.durationSec.toFixed(3),
            '-i', path.join(dir, p.file),
            '-c', 'copy',
            outPath,
        ]);
    }
    const jobId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const manifest: string[] = [];
    const tmpFiles: string[] = [];
    const cutNext = (index: number): Promise<void> => {
        if (index >= parts.length) {
            const listFile = path.join(dir, `clip-parts-${jobId}.txt`);
            fs.writeFileSync(listFile, manifest.join('\n'), 'utf8');
            return runFfmpeg([
                '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', listFile,
                '-c', 'copy',
                outPath,
            ]).finally(() => {
                for (const tmp of tmpFiles) {
                    try {
                        fs.unlinkSync(tmp);
                    } catch {
                        /* ignore */
                    }
                }
                try {
                    fs.unlinkSync(listFile);
                } catch {
                    /* ignore */
                }
            });
        }
        const p = parts[index];
        const tmp = path.join(dir, `clip-part-${jobId}-${index}.mp4`);
        tmpFiles.push(tmp);
        manifest.push(`file '${tmp.replace(/\\/g, '/')}'`);
        return runFfmpeg([
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', p.startSec.toFixed(3),
            '-t', p.durationSec.toFixed(3),
            '-i', path.join(dir, p.file),
            '-c', 'copy',
            tmp,
        ]).then(() => cutNext(index + 1));
    };
    return cutNext(0);
}

let ffmpegRunner: ((args: string[]) => Promise<void>) | null = null;

function runFfmpeg(args: string[]): Promise<void> {
    if (ffmpegRunner) return ffmpegRunner(args);
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            reject(new Error('ffmpeg missing'));
            return;
        }
        const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        proc.stderr?.on('data', (c) => {
            err += String(c);
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`));
        });
    });
}

function pruneOldSegments(): void {
    const stale = pruneSegments(listSegments(), Date.now(), RETENTION_SEC + 60);
    for (const file of stale) {
        try {
            fs.unlinkSync(path.join(segmentsDir(), file));
        } catch {
            /* ignore */
        }
    }
}

export interface SavedClip {
    name: string;
    path: string;
    bytes: number;
    mtimeMs: number;
}

const CLIP_LIST_LIMIT = 24;
const CLIP_LIST_STAT_CAP = 200;
const CLIP_LIST_CACHE_MS = 4_000;
let clipListCache: { at: number; clips: SavedClip[] } | null = null;

function listSavedClips(): SavedClip[] {
    const now = Date.now();
    if (clipListCache && now - clipListCache.at < CLIP_LIST_CACHE_MS) return clipListCache.clips;
    const dir = clipsDir();
    let clips: SavedClip[] = [];
    try {
        const names = fs.readdirSync(dir).filter((name) => name.endsWith('.mp4'));
        const capped = names.length > CLIP_LIST_STAT_CAP ? names.slice(0, CLIP_LIST_STAT_CAP) : names;
        const rows: SavedClip[] = [];
        for (const name of capped) {
            try {
                const full = path.join(dir, name);
                const st = fs.statSync(full);
                if (!st.isFile()) continue;
                rows.push({ name, path: full, bytes: st.size, mtimeMs: st.mtimeMs });
            } catch {
                /* a file can disappear between read and stat */
            }
        }
        rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
        clips = rows.slice(0, CLIP_LIST_LIMIT);
    } catch {
        clips = [];
    }
    clipListCache = { at: now, clips };
    return clips;
}

/** Current recorder state for the Performance tab. */
export function getClipperStatus(): {
    status: ClipperStatus;
    detail: string;
    clipsDir: string;
    ffmpeg: 'ready' | 'missing' | 'unknown';
    clips: SavedClip[];
} {
    return {
        status,
        detail: statusDetail,
        clipsDir: clipsDir(),
        ffmpeg: ffmpegPath ? 'ready' : ffmpegKnown ? 'missing' : 'unknown',
        clips: listSavedClips(),
    };
}

/** Manual trigger from the dashboard: save what is already in the buffer. */
export async function saveManualClip(gameTimeSec: number): Promise<string | null> {
    return saveClip({
        eventMs: Date.now(),
        gameTimeSec,
        label: 'manual',
        tailSec: 1,
    });
}

/**
 * Save a moment after the tail has been recorded. Calling saveClip on the
 * kill frame would end the file at "now" and drop the 8s after the fight.
 */
export function queueClip(opts: ClipRequest): void {
    if (!autoClipEnabled || !ffmpegPath || !recording) return;
    if (queued.size >= CLIP_MAX_PER_MATCH) return;
    const key = `${Math.round(opts.eventMs / 1000)}:${opts.label}`;
    if (queued.has(key)) return;
    const delay = (CLIP_TAIL_SEC + SEGMENT_SEC) * 1000 + 700;
    const timer = setTimeout(() => {
        queued.delete(key);
        void saveClip(opts).catch((error) => console.warn('[clipper] trigger failed:', error));
    }, delay);
    queued.set(key, { timer, opts });
}

function flushQueued(): void {
    const jobs = [...queued.values()];
    queued.clear();
    for (const job of jobs) {
        clearTimeout(job.timer);
        void saveClip(job.opts).catch((error) => console.warn('[clipper] trigger failed:', error));
    }
}

export function setAutoClipEnabledForTest(enabled: boolean): void {
    autoClipEnabled = enabled;
}

export function setFfmpegPathForTest(p: string | null): void { ffmpegPath = p; }
export function setStatusForTest(s: ClipperStatus, detail: string): void { status = s; statusDetail = detail; }
export function setFfmpegRunnerForTest(r: ((args: string[]) => Promise<void>) | null): void { ffmpegRunner = r; }
export function resetClipperForTest(): void {
    for (const job of queued.values()) clearTimeout(job.timer);
    queued.clear();
    autoClipEnabled = false;
    segmentEpochMs = 0;
    ffmpegRunner = null;
    stopRecording();
    status = 'disabled';
    statusDetail = 'Not started';
    ffmpegPath = null;
    ffmpegKnown = false;
    locateFfmpegTask = null;
    clipListCache = null;
    activeStitches = 0;
    stitchQueue = Promise.resolve();
}
export { runFfmpeg, stitch, segmentsDir, clipsDir, pruneOldSegments, startRecording, stopRecording, listSegments };
