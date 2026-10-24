/**
 * Clip planner — pure math for the ring-buffer recorder.
 *
 * The recorder (electron/clipper.ts) writes fixed-length segments. A planned
 * clip names them `seg-<startWallMs>.mp4`. ffmpeg's segment muxer writes
 * `seg-<index>.mp4` instead, and the recorder maps that index through
 * `segmentStartFromCounter` before calling `planClip`. When a play moment fires, this module decides
 * which segments cover [event - leadSec, event + tailSec] and what cut
 * ranges to use, so a clip starts before the fight and ends after it.
 *
 * Pure on purpose: all timing math is unit-tested without ffmpeg or a game.
 */

export interface SegmentInfo {
    /** Wall-clock ms at the segment's first frame. */
    startMs: number;
    /** File name, e.g. `seg-1737600000000.mp4`. */
    file: string;
    /** Nominal length in seconds (the recorder's segment_time). */
    durationSec: number;
}

export interface ClipWindow {
    /** Wall-clock ms the moment fired. */
    eventMs: number;
    /** Seconds before the event to include. */
    leadSec: number;
    /** Seconds after the event to include. */
    tailSec: number;
}

export interface ClipPart {
    file: string;
    /** Seconds into this segment where the clip starts. */
    startSec: number;
    /** Seconds to take from this segment. */
    durationSec: number;
}

export interface ClipPlan {
    parts: ClipPart[];
    /** Wall-clock ms the stitched clip would begin. */
    clipStartMs: number;
    /** Wall-clock ms the stitched clip would end. */
    clipEndMs: number;
    /** True when the ring buffer cannot cover the full lead (app started late). */
    truncatedLead: boolean;
}

const SEG_PREFIX = 'seg-';
const SEG_SUFFIX = '.mp4';

export function segmentFileName(startMs: number): string {
    return `${SEG_PREFIX}${Math.round(startMs)}${SEG_SUFFIX}`;
}

/**
 * Parse a segment file name.
 * Wall-clock names (`seg-<ms>.mp4`) and ffmpeg's counter (`seg-0000000000000.mp4`)
 * both parse. Index 0 is the first segment of a session, so 0 is valid.
 * Anything that is not an integer is null.
 */
export function parseSegmentFileName(file: string): number | null {
    if (!file.startsWith(SEG_PREFIX) || !file.endsWith(SEG_SUFFIX)) return null;
    const raw = file.slice(SEG_PREFIX.length, -SEG_SUFFIX.length);
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Map ffmpeg's segment counter onto the wall clock the session started at. */
export function segmentStartFromCounter(index: number, epochMs: number, segmentSec: number): number {
    return epochMs + index * segmentSec * 1000;
}

/**
 * Compute the stitch plan for a clip window. `segments` may be unordered and
 * may contain unrelated files (they are filtered). Segments that start after
 * the window ends, or end before it begins, are excluded.
 */
export function planClip(segments: SegmentInfo[], win: ClipWindow): ClipPlan | null {
    const startMs = win.eventMs - win.leadSec * 1000;
    const endMs = win.eventMs + win.tailSec * 1000;

    const relevant = segments
        .filter((s) => parseSegmentFileName(s.file) !== null)
        .filter((s) => s.startMs < endMs && s.startMs + s.durationSec * 1000 > startMs)
        .sort((a, b) => a.startMs - b.startMs);

    if (!relevant.length) return null;

    const parts: ClipPart[] = [];
    for (const seg of relevant) {
        const segEndMs = seg.startMs + seg.durationSec * 1000;
        const from = Math.max(startMs, seg.startMs);
        const to = Math.min(endMs, segEndMs);
        const durationSec = (to - from) / 1000;
        if (durationSec <= 0.2) continue; // skip slivers from rounding
        parts.push({
            file: seg.file,
            startSec: (from - seg.startMs) / 1000,
            durationSec,
        });
    }
    if (!parts.length) return null;

    const first = relevant[0];
    return {
        parts,
        clipStartMs: startMs,
        clipEndMs: endMs,
        truncatedLead: first.startMs > startMs + 500, // more than a frame late
    };
}

/** Which segments the ring buffer should keep, given retention and now. */
export function pruneSegments(segments: SegmentInfo[], nowMs: number, retentionSec: number): string[] {
    const cutoff = nowMs - retentionSec * 1000;
    return segments
        .filter((s) => parseSegmentFileName(s.file) !== null && s.startMs + s.durationSec * 1000 < cutoff)
        .map((s) => s.file);
}

/**
 * Clip file name: `<mm:ss>_<label-slug>.mp4`, e.g. `14m32s_brilliant.mp4`.
 * Anything that would make a messy filename is slugified out.
 */
export function clipFileName(gameTimeSec: number, label: string): string {
    const m = Math.floor(Math.max(0, gameTimeSec) / 60);
    const s = Math.floor(Math.max(0, gameTimeSec) % 60);
    const slug =
        label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'play';
    return `${m}m${s.toString().padStart(2, '0')}s_${slug}.mp4`;
}

/** Sidecar JSON name for a clip. */
export function clipSidecarName(clipFile: string): string {
    return clipFile.replace(/\.mp4$/, '.json');
}
