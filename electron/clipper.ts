/**
 * Medal-style auto-clipping — ffmpeg ring buffer of the League window.
 *
 * Writes fixed-length segments while a match runs and League is focused, then
 * stitches [event - lead, event + tail] into clips/ when a trigger fires.
 * Triggers come from the play-moment engine (scored Brilliant/Great plays) or
 * the dashboard's manual button.
 *
 * Design notes:
 * - **ffmpeg is optional.** If no binary is found, the recorder stays disabled
 *   and reports why — the app must fully work without it.
 * - Recording pauses when the game ends or League loses focus.
 * - Nothing here sends input or reads memory: it records the screen the user
 *   already sees, exactly like OBS/Medal do.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import {
    clipFileName,
    clipSidecarName,
    planClip,
    pruneSegments,
    parseSegmentFileName,
    type SegmentInfo,
} from '../src/logic/clipper-plan';

const SEGMENT_SEC = 5;
const RETENTION_SEC = 120;
const CLIP_LEAD_SEC = 20;
const CLIP_TAIL_SEC = 8;
/** Recording fps + size. 720p keeps CPU/GPU cost low; quality setting later. */
const FPS = 30;
const CAPTURE_H = 720;

export type ClipperStatus = 'disabled' | 'idle' | 'recording' | 'stitching' | 'error';

let status: ClipperStatus = 'disabled';
let statusDetail = 'Not started';
let ffmpegPath: string | null = null;
let ffmpegProc: ChildProcessWithoutNullStreams | null = null;
let recording = false;

function clipsDir(): string {
    return path.join(app.getPath('userData'), 'clips');
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
    if (recording || status === 'stitching') return;
    if (!ffmpegPath) {
        ffmpegPath = await findFfmpeg();
        if (!ffmpegPath) {
            status = 'disabled';
            statusDetail = 'ffmpeg not found — auto-clipping off. Install ffmpeg or bundle it to enable.';
            return;
        }
    }
    try {
        fs.mkdirSync(segmentsDir(), { recursive: true });
        fs.mkdirSync(clipsDir(), { recursive: true });
    } catch (error) {
        status = 'error';
        statusDetail = `Cannot create clip folders: ${String(error)}`;
        return;
    }
    statusDetail = 'Ready — recording starts with the next match.';
    status = 'idle';
}

/** Pause when the game ends or focus is lost; segments stay for later triggers. */
export function setClipperActive(active: boolean): void {
    if (!ffmpegPath) return;
    if (active && !recording) {
        startRecording();
    } else if (!active && recording) {
        stopRecording();
        status = 'idle';
        statusDetail = 'Match over — ring buffer paused.';
    }
}

function startRecording(): void {
    if (!ffmpegPath) return;
    const dir = segmentsDir();
    // Clear stale segments from a previous session first.
    try {
        for (const f of fs.readdirSync(dir)) {
            if (parseSegmentFileName(f) !== null) fs.unlinkSync(path.join(dir, f));
        }
    } catch {
        /* ignore */
    }
    const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-fflags', '+genpts',
        '-f', 'gdigrab',
        '-framerate', String(FPS),
        '-draw_mouse', '1',
        '-i', 'desktop',
        '-vf', `scale=-2:${CAPTURE_H}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-f', 'segment',
        '-segment_time', String(SEGMENT_SEC),
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
}

function listSegments(): SegmentInfo[] {
    const dir = segmentsDir();
    try {
        return fs
            .readdirSync(dir)
            .map((file) => {
                const startMs = parseSegmentFileName(file);
                return startMs === null ? null : { startMs, file, durationSec: SEGMENT_SEC };
            })
            .filter((s): s is SegmentInfo => !!s);
    } catch {
        return [];
    }
}

/**
 * Stitch a clip for a scored moment. `gameTimeSec` labels the file; the
 * wall-clock trigger is `eventMs`. Returns the clip path, or null.
 */
export async function saveClip(opts: {
    eventMs: number;
    gameTimeSec: number;
    label: string;
    score?: number;
    reasons?: string[];
}): Promise<string | null> {
    if (!ffmpegPath) return null;
    const segments = listSegments();
    if (!segments.length) {
        statusDetail = 'Trigger arrived but no segments exist yet.';
        return null;
    }
    const plan = planClip(segments, {
        eventMs: opts.eventMs,
        leadSec: CLIP_LEAD_SEC,
        tailSec: CLIP_TAIL_SEC,
    });
    if (!plan) {
        statusDetail = 'Trigger arrived but the ring buffer does not cover it.';
        return null;
    }

    const prevStatus = status;
    status = 'stitching';
    statusDetail = 'Stitching clip…';
    const name = clipFileName(opts.gameTimeSec, opts.label);
    const outPath = path.join(clipsDir(), name);
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
        status = prevStatus;
        statusDetail = `Saved ${name}`;
        pruneOldSegments();
        return outPath;
    } catch (error) {
        status = prevStatus;
        statusDetail = `Stitch failed: ${String(error)}`;
        return null;
    }
}

/**
 * Re-encode only what must change. First and last parts are cut with -ss/-t;
 * multi-segment clips go through the concat demuxer so middle parts copy.
 */
function stitch(
    parts: { file: string; startSec: number; durationSec: number }[],
    outPath: string
): Promise<void> {
    const dir = segmentsDir();
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
    const manifest: string[] = [];
    const tmpFiles: string[] = [];
    const cutNext = (index: number): Promise<void> => {
        if (index >= parts.length) {
            const listFile = path.join(dir, 'clip-parts.txt');
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
        const tmp = path.join(dir, `clip-part-${index}.mp4`);
        tmpFiles.push(tmp);
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

function runFfmpeg(args: string[]): Promise<void> {
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

/** Current recorder state for the Performance tab. */
export function getClipperStatus(): { status: ClipperStatus; detail: string; clipsDir: string } {
    return { status, detail: statusDetail, clipsDir: clipsDir() };
}

/** Manual trigger from the dashboard: save the last ~28s with a generic label. */
export async function saveManualClip(gameTimeSec: number): Promise<string | null> {
    return saveClip({
        eventMs: Date.now(),
        gameTimeSec,
        label: 'manual',
    });
}

