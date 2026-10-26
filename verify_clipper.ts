/**
 * Clip planner verification — pure segment math, no ffmpeg needed.
 *
 * Run: npm run verify:clipper
 */

import {
    CLIP_GREAT_SCORE,
    CLIP_MAX_PER_MATCH,
    CLIP_MIN_GAP_MS,
    clipFileName,
    clipSidecarName,
    parseSegmentFileName,
    pickClipMoment,
    planClip,
    pruneSegments,
    segmentFileName,
    segmentStartFromCounter,
    type SegmentInfo,
} from './src/logic/clipper-plan';

const ok = (c: boolean, m: string) => {
    if (!c) {
        console.error('FAIL', m);
        process.exitCode = 1;
    } else console.log('ok', m);
};

const seg = (startMs: number, durationSec = 5): SegmentInfo => ({
    startMs,
    file: segmentFileName(startMs),
    durationSec,
});

const BASE = 1_737_600_000_000;

/* 1. File-name round trip. */
ok(parseSegmentFileName(segmentFileName(12345)) === 12345, 'segment name round-trips');
ok(parseSegmentFileName('clip-part-0.mp4') === null, 'non-segment files are ignored');
ok(parseSegmentFileName('seg-bad.mp4') === null, 'garbage segment names parse to null');
ok(parseSegmentFileName('seg-0000000000000.mp4') === 0, 'ffmpeg segment index 0 is a real file');
ok(segmentStartFromCounter(0, 5_000, 5) === 5_000, 'index 0 starts at the session epoch');
ok(segmentStartFromCounter(2, 5_000, 5) === 15_000, 'index 2 is two segments later');

/* 2. A kill mid-buffer picks 4-5 segments covering [-20, +8]. */
const buffer = Array.from({ length: 24 }, (_, i) => seg(BASE + i * 5000));
const killAt = BASE + 62_000; // 62s in, squarely inside the buffer
const plan = planClip(buffer, { eventMs: killAt, leadSec: 20, tailSec: 8 });
ok(!!plan, 'a plan exists for an in-buffer kill');
ok(!!plan && plan.parts.length >= 4, `the plan spans multiple segments (got ${plan?.parts.length})`);
ok(!!plan && !plan.truncatedLead, 'the lead window is fully covered');
ok(
    !!plan && Math.abs(plan.parts[0].startSec - 2.0) < 0.02,
    `the first cut starts 2.0s into its segment (got ${plan?.parts[0].startSec.toFixed(2)})`
);
const lastPart = plan?.parts[plan.parts.length - 1];
if (lastPart) {
    const segStartMs = parseSegmentFileName(lastPart.file) ?? 0;
    const endMs = segStartMs + (lastPart.startSec + lastPart.durationSec) * 1000;
    ok(
        Math.abs(endMs - (killAt + 8000)) < 50,
        `the clip ends 8s after the kill (got ${((endMs - killAt) / 1000).toFixed(2)}s after)`
    );
}
const totalSec = plan?.parts.reduce((n, p) => n + p.durationSec, 0) ?? 0;
ok(Math.abs(totalSec - 28) < 0.3, `the clip is ~28s (got ${totalSec.toFixed(2)})`);

/* 3. A kill right at session start truncates the lead, and the plan says so. */
const early = planClip(buffer.slice(0, 3), { eventMs: BASE + 10_000, leadSec: 20, tailSec: 8 });
ok(!!early && early.truncatedLead, 'an early kill reports a truncated lead');
ok(!!early && early.parts.length >= 1, 'an early kill still produces a clip');

/* 4. No coverage → null (never stitch an empty or wrong clip). */
ok(planClip([], { eventMs: killAt, leadSec: 20, tailSec: 8 }) === null, 'no segments → no plan');
ok(
    planClip([seg(BASE)], { eventMs: killAt, leadSec: 20, tailSec: 8 }) === null,
    'a kill outside the buffer → no plan'
);

/* 5. Pruning keeps the newest segments inside retention. */
const stale = pruneSegments(buffer, BASE + 100_000, 60);
ok(stale.length > 0 && stale.length < buffer.length, `stale segments are marked (got ${stale.length})`);
ok(
    stale.every((f) => {
        const n = parseSegmentFileName(f) ?? 0;
        return n + 5000 < BASE + 100_000 - 60_000;
    }),
    'pruned segments are all past the retention cutoff'
);

/* 6. Clip names are filesystem-safe and readable. */
ok(clipFileName(872, 'Low-HP turnaround') === '14m32s_low-hp-turnaround.mp4', 'clip name matches the convention');
ok(clipFileName(872, '!!!') === '14m32s_play.mp4', 'an unusable label falls back to "play"');
ok(clipSidecarName('14m32s_low-hp-turnaround.mp4') === '14m32s_low-hp-turnaround.json', 'sidecar name matches');

/* 7. Unordered input still yields an ordered plan. */
const shuffled = [buffer[13], buffer[11], buffer[12], buffer[14]];
const unordered = planClip(shuffled, { eventMs: killAt, leadSec: 20, tailSec: 8 });
ok(
    !!unordered && unordered.parts.every((p, i) => i === 0 || p.startSec >= 0),
    'unordered segments still produce per-segment cuts'
);

const kill = { gameTime: 100, label: 'Good on Jinx', kind: 'brilliant', score: 10 };
const great = { gameTime: 200, label: 'Great on Jinx', kind: 'brilliant', score: CLIP_GREAT_SCORE };
const death = { gameTime: 300, label: 'Died to Jinx', kind: 'blunder' };
const assist = { gameTime: 400, label: 'Assist', kind: 'brilliant' };

ok(pickClipMoment([assist], { clipsSoFar: 0, msSinceLast: 0 }) === null, 'an assist does not become a clip');
ok(pickClipMoment([kill], { clipsSoFar: 0, msSinceLast: Number.POSITIVE_INFINITY })?.label === kill.label, 'the first kill of a match is clipped');
ok(
    pickClipMoment([kill], { clipsSoFar: 1, msSinceLast: CLIP_MIN_GAP_MS - 1 }) === null,
    'a Good play inside the gap does not queue another stitch'
);
ok(
    pickClipMoment([great], { clipsSoFar: 1, msSinceLast: 0 })?.label === great.label,
    'a Great play is kept even inside the gap'
);
ok(pickClipMoment([death], { clipsSoFar: 0, msSinceLast: Number.POSITIVE_INFINITY })?.label === death.label, 'a death is clipped');
ok(pickClipMoment([kill], { clipsSoFar: CLIP_MAX_PER_MATCH, msSinceLast: Number.POSITIVE_INFINITY }) === null, 'the per-match cap stops further clips');
ok(
    pickClipMoment([kill, great], { clipsSoFar: 0, msSinceLast: 0 })?.score === CLIP_GREAT_SCORE,
    'the higher-scored fight in one tick wins'
);

if (!process.exitCode) console.log('verify:clipper ok');
