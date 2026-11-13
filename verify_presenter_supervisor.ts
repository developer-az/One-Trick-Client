/**
 * Presenter supervisor: deterministic respawn/backoff/fallback decisions.
 *
 * The supervisor is pure apart from its own state: every call receives the
 * clock as a number, so these checks can drive it through the exact failure
 * sequences the native overlay driver will later feed it.
 */
import { PresenterSupervisor } from './electron/presenter-supervisor';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

// ---- initial state: down + wanted -> respawn attempt 1 ----
const initial = new PresenterSupervisor();
const first = initial.decide(0, { wanted: true });
ok(
    first.kind === 'respawn' && first.attempt === 1,
    'initial down + wanted returns respawn attempt 1'
);
ok(initial.snapshot().respawns === 0, 'decide() does not consume the respawn count before noteStarting()');
initial.noteStarting(0);
ok(initial.snapshot().inFlight === true, 'noteStarting() marks a spawn in flight');
ok(initial.snapshot().respawns === 1, 'noteStarting() records the spawn attempt');

// ---- the old bug: in-flight spawn must block every further respawn ----
const inflight = new PresenterSupervisor();
const start = inflight.decide(0, { wanted: true });
ok(start.kind === 'respawn', 'first wanted decision asks for a respawn');
inflight.noteStarting(0);
let extraRespawns = 0;
for (let i = 0; i < 5; i++) {
    const action = inflight.decide(100 + i, { wanted: true });
    if (action.kind === 'respawn') extraRespawns++;
    ok(action.kind === 'none', `in-flight decide #${i + 1} returns none`);
}
ok(extraRespawns === 0, 'five polls during one in-flight spawn never issue a second respawn');
ok(inflight.snapshot().respawns === 1, 'in-flight polling leaves the respawn count at 1');

// ---- backoff: 1s, 2s, 4s, 8s, then the 8s cap ----
const backoff = new PresenterSupervisor({ failureWindowMs: 0 });
backoff.noteDown(0, 'failure-1');
const wait1 = backoff.decide(0, { wanted: true });
ok(wait1.kind === 'wait' && wait1.untilMs === 1_000, 'first failure waits until failureTime + 1s');
backoff.noteStarting(1_000);
backoff.noteDown(1_000, 'failure-2');
const wait2 = backoff.decide(1_000, { wanted: true });
ok(wait2.kind === 'wait' && wait2.untilMs === 3_000, 'second consecutive failure waits until failureTime + 2s');
backoff.noteStarting(3_000);
backoff.noteDown(3_000, 'failure-3');
const wait3 = backoff.decide(3_000, { wanted: true });
ok(wait3.kind === 'wait' && wait3.untilMs === 7_000, 'third consecutive failure waits until failureTime + 4s');
backoff.noteStarting(7_000);
backoff.noteDown(7_000, 'failure-4');
const wait4 = backoff.decide(7_000, { wanted: true });
ok(wait4.kind === 'wait' && wait4.untilMs === 15_000, 'fourth consecutive failure waits until failureTime + 8s');
backoff.noteStarting(15_000);
backoff.noteDown(15_000, 'failure-5');
const wait5 = backoff.decide(15_000, { wanted: true });
ok(wait5.kind === 'wait' && wait5.untilMs === 23_000, 'fifth consecutive failure keeps the 8s backoff cap');
const readyAgain = backoff.decide(23_000, { wanted: true });
ok(readyAgain.kind === 'respawn', 'once backoff elapses the next decision is a respawn');

// ---- 4 failures inside the window: one fallback, then none forever ----
const burst = new PresenterSupervisor();
for (let i = 0; i < 4; i++) burst.noteDown(i, `burst-${i + 1}`);
const fallback = burst.decide(3, { wanted: true });
ok(fallback.kind === 'fallback', 'four failures within 60s return a fallback');
ok(fallback.kind === 'fallback' && fallback.reason.includes('burst-4'), 'fallback reason names the last failure');
ok(burst.snapshot().fellBack === true, 'fallback is sticky');
let noneAfterFallback = 0;
for (const now of [3, 4, 1_000, 999_999]) {
    if (burst.decide(now, { wanted: true }).kind === 'none') noneAfterFallback++;
}
ok(noneAfterFallback === 4, 'after the one fallback every later decide returns none');
burst.noteDown(1_000_000, 'post-fallback');
ok(burst.decide(1_000_001, { wanted: true }).kind === 'none', 'post-fallback failures do not re-trigger respawn or fallback');

// ---- failures spread beyond the window never trigger fallback ----
const spread = new PresenterSupervisor();
spread.noteDown(0, 'spread-1');
spread.noteDown(61_000, 'spread-2');
spread.noteDown(122_000, 'spread-3');
spread.noteDown(183_000, 'spread-4');
const spreadDecision = spread.decide(183_000, { wanted: true });
ok(spreadDecision.kind !== 'fallback', 'four failures spread beyond 60s do not trigger fallback');
ok(spread.snapshot().fellBack === false, 'spread failures leave fallback unset');
ok(spreadDecision.kind === 'wait', 'a down presenter still observes backoff after spread failures');

// ---- noteReady alone does not forgive failures ----
const quickReady = new PresenterSupervisor();
quickReady.noteDown(0, 'first');
quickReady.noteStarting(10);
quickReady.noteReady(20);
ok(quickReady.snapshot().failures === 1, 'noteReady() does not clear the failure counter');
quickReady.noteDown(30, 'second');
ok(quickReady.snapshot().failures === 2, 'a quick death after READY still counts as another failure');

// ---- sustained health (>= 120s) clears the consecutive counter ----
const healthyDecide = new PresenterSupervisor();
healthyDecide.noteDown(0, 'old-1');
healthyDecide.noteDown(100, 'old-2');
healthyDecide.noteDown(200, 'old-3');
healthyDecide.noteReady(300);
ok(healthyDecide.decide(300, { wanted: true }).kind === 'none', 'a healthy presenter needs no respawn');
ok(healthyDecide.snapshot().failures === 3, 'short health does not clear earlier failures');
const healthyAt = 300 + 120_000;
ok(healthyDecide.decide(healthyAt, { wanted: true }).kind === 'none', 'sustained health remains none');
ok(healthyDecide.snapshot().failures === 0, 'decide() clears failures after 120s of health');
healthyDecide.noteDown(healthyAt + 1, 'late-crash');
ok(healthyDecide.snapshot().failures === 1, 'a late crash after sustained health is strike one, not strike four');
const late = healthyDecide.decide(healthyAt + 1, { wanted: true });
ok(
    late.kind === 'wait' && late.untilMs === healthyAt + 1_001,
    'the late crash gets the first 1s backoff, not an immediate fallback'
);

const healthyDown = new PresenterSupervisor();
healthyDown.noteDown(0, 'old-1');
healthyDown.noteDown(1, 'old-2');
healthyDown.noteDown(2, 'old-3');
healthyDown.noteReady(10);
healthyDown.noteDown(10 + 120_000, 'late-crash');
ok(healthyDown.snapshot().failures === 1, 'noteDown() also clears failures after 120s of health');

// ---- wanted=false never respawns (or falls back while off) ----
const off = new PresenterSupervisor();
ok(off.decide(0, { wanted: false }).kind === 'none', 'initial down + unwanted returns none');
off.noteDown(0, 'off-1');
off.noteDown(1, 'off-2');
off.noteDown(2, 'off-3');
off.noteDown(3, 'off-4');
ok(off.decide(4, { wanted: false }).kind === 'none', 'unwanted presenter never respawns, even after failures');
ok(off.snapshot().fellBack === false, 'unwanted polling does not issue a fallback');
const onAgain = off.decide(4, { wanted: true });
ok(onAgain.kind === 'fallback', 'when wanted returns inside the window, the existing burst falls back once');

// ---- reset() clears everything, including sticky fallback ----
const reset = new PresenterSupervisor();
for (let i = 0; i < 4; i++) reset.noteDown(i, `reset-${i + 1}`);
reset.decide(3, { wanted: true });
ok(reset.snapshot().fellBack === true, 'supervisor has fallen back before reset');
reset.reset();
const cleared = reset.snapshot();
ok(
    cleared.inFlight === false &&
        cleared.failures === 0 &&
        cleared.respawns === 0 &&
        cleared.fellBack === false &&
        cleared.healthySince === null &&
        cleared.lastReason === null,
    'reset() restores the initial snapshot'
);
const afterReset = reset.decide(100, { wanted: true });
ok(
    afterReset.kind === 'respawn' && afterReset.attempt === 1,
    'after reset a new match gets respawn attempt 1'
);

// ---- snapshot reflects the live state ----
const snap = new PresenterSupervisor();
const empty = snap.snapshot();
ok(
    empty.inFlight === false &&
        empty.failures === 0 &&
        empty.respawns === 0 &&
        empty.fellBack === false &&
        empty.healthySince === null &&
        empty.lastReason === null,
    'fresh snapshot is empty'
);
snap.noteStarting(0);
const starting = snap.snapshot();
ok(starting.inFlight === true && starting.respawns === 1, 'snapshot shows an in-flight first attempt');
snap.noteReady(100);
const ready = snap.snapshot();
ok(ready.inFlight === false && ready.healthySince === 100, 'snapshot records when the presenter became healthy');
snap.noteDown(200, 'pipe-closed');
const down = snap.snapshot();
ok(
    down.inFlight === false &&
        down.healthySince === null &&
        down.failures === 1 &&
        down.lastReason === 'pipe-closed',
    'snapshot records the down reason and failure'
);
