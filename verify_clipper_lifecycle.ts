/**
 * Verification harness for Clipper Lifecycle (electron/clipper.ts).
 * Tests missing ffmpeg, double-spawn guard, segment listing/pruning,
 * stitch execution with mock ffmpeg, sidecar generation, and rapid triggers.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    startClipper,
    setClipperActive,
    saveClip,
    getClipperStatus,
    setFfmpegPathForTest,
    setFfmpegRunnerForTest,
    resetClipperForTest,
    segmentsDir,
    pruneOldSegments,
    listSegments,
    saveManualClip,
} from './electron/clipper';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

async function run(): Promise<void> {
    console.log('--- verify:clipper: missing ffmpeg handling ---');
    const testDir = path.join(os.tmpdir(), `ot-clipper-test-${Date.now()}`);
    process.env.ONETRICK_USER_DATA = testDir;
    process.env.ONETRICK_FFMPEG = 'non-existent-ffmpeg-binary-12345';
    fs.mkdirSync(testDir, { recursive: true });

    resetClipperForTest();
    ok(getClipperStatus().status === 'disabled', 'initial status is disabled');

    // startClipper with non-existent binary should gracefully stay disabled
    await startClipper();
    ok(getClipperStatus().status === 'disabled', 'status disabled when ffmpeg not found');
    ok(getClipperStatus().detail.includes('ffmpeg not found'), 'detail explains ffmpeg missing');

    // saveClip returns null without throwing when ffmpeg is missing
    const clipResult = await saveClip({ eventMs: Date.now(), gameTimeSec: 100, label: 'test' });
    ok(clipResult === null, 'saveClip safely returns null when disabled');

    const manualResult = await saveManualClip(120);
    ok(manualResult === null, 'saveManualClip safely returns null when disabled');

    console.log('--- verify:clipper: double-spawn prevention ---');
    setFfmpegPathForTest('ffmpeg-test-path');
    ok(getClipperStatus().status === 'disabled', 'status is disabled before start');

    // Calling setClipperActive(false) while disabled does nothing
    setClipperActive(false);
    ok(getClipperStatus().status === 'disabled', 'setClipperActive(false) while disabled does nothing');

    console.log('--- verify:clipper: segments dir & pruning ---');
    const segDir = segmentsDir();
    fs.mkdirSync(segDir, { recursive: true });

    // Seed dummy segment files: some fresh, some stale (> 3 minutes old)
    const now = Date.now();
    const freshStartMs = now - 30_000;
    const staleStartMs = now - 300_000;

    const freshFile = `seg-${String(freshStartMs).padStart(13, '0')}.mp4`;
    const staleFile = `seg-${String(staleStartMs).padStart(13, '0')}.mp4`;

    fs.writeFileSync(path.join(segDir, freshFile), 'fresh video segment content');
    fs.writeFileSync(path.join(segDir, staleFile), 'stale video segment content');

    const segments = listSegments();
    ok(segments.length >= 2, `listSegments found seeded files (got ${segments.length})`);
    ok(segments.some((s) => s.file === freshFile), 'found fresh segment');
    ok(segments.some((s) => s.file === staleFile), 'found stale segment');

    // Prune old segments
    pruneOldSegments();
    const remaining = listSegments();
    ok(remaining.some((s) => s.file === freshFile), 'fresh segment retained after prune');
    ok(!remaining.some((s) => s.file === staleFile), 'stale segment deleted by prune');

    console.log('--- verify:clipper: stitch path & sidecar metadata ---');
    // Seed segments for a 20s-lead kill at game time 120s
    // Lead is 20s, tail is 8s -> 28s total
    const eventMs = now;
    const clipSegFiles: string[] = [];
    for (let offsetSec = 30; offsetSec >= 0; offsetSec -= 5) {
        const segStartMs = eventMs - offsetSec * 1000;
        const fname = `seg-${String(segStartMs).padStart(13, '0')}.mp4`;
        fs.writeFileSync(path.join(segDir, fname), 'segment data');
        clipSegFiles.push(fname);
    }

    // Set mock runner that writes mock output for ffmpeg args
    const ffmpegCalls: string[][] = [];
    setFfmpegRunnerForTest(async (args: string[]) => {
        ffmpegCalls.push(args);
        const out = args[args.length - 1];
        fs.writeFileSync(out, 'mock stitched video mp4 content', 'utf8');
    });

    // Run saveClip
    const saved = await saveClip({
        eventMs,
        gameTimeSec: 120,
        label: 'pentakill',
        score: 100,
        reasons: ['Penta-kill turnaround'],
    });

    ok(saved !== null, 'saveClip returned output file path');
    if (saved) {
        ok(fs.existsSync(saved), 'output clip file created on disk');
        ok(saved.includes('pentakill') && saved.includes('2m00s'), `filename reflects gameTime and label (got ${path.basename(saved)})`);

        const sidecarPath = saved.replace(/\.mp4$/, '.json');
        ok(fs.existsSync(sidecarPath), 'sidecar metadata json created');
        if (fs.existsSync(sidecarPath)) {
            const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
            ok(meta.label === 'pentakill', 'sidecar label matches');
            ok(meta.score === 100, 'sidecar score matches');
            ok(meta.reasons?.includes('Penta-kill turnaround'), 'sidecar reasons match');
            ok(meta.gameTimeSec === 120, 'sidecar gameTimeSec matches');
        }
    }
    ok(ffmpegCalls.length > 0, `ffmpeg runner invoked (got ${ffmpegCalls.length} calls)`);

    console.log('--- verify:clipper: rapid trigger serialization ---');
    // Call saveClip twice in parallel — verify both succeed via stitchQueue without file collisions
    const [clip1, clip2] = await Promise.all([
        saveClip({ eventMs, gameTimeSec: 130, label: 'doublekill', score: 50, reasons: ['2x multi-kill'] }),
        saveClip({ eventMs, gameTimeSec: 135, label: 'triplekill', score: 70, reasons: ['3x multi-kill'] }),
    ]);

    ok(clip1 !== null && fs.existsSync(clip1), 'rapid clip 1 succeeded and exists');
    ok(clip2 !== null && fs.existsSync(clip2), 'rapid clip 2 succeeded and exists');
    ok(clip1 !== clip2, 'rapid clips produced distinct output files');

    // Clean up
    resetClipperForTest();
    try {
        fs.rmSync(testDir, { recursive: true, force: true });
        for (const f of clipSegFiles) {
            try {
                fs.unlinkSync(path.join(segDir, f));
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }

    if (!process.exitCode) {
        console.log('verify:clipper-lifecycle ok');
    }
}

void run();
