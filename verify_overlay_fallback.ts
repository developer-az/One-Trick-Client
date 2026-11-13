/**
 * Overlay fallback + display/power recovery: the native presenter is
 * supervised, and when it cannot be kept alive the Electron overlay takes
 * over without rewriting the saved backend choice.
 *
 * electron is not importable under tsx, so the driver/window checks are
 * source-structure assertions. The supervisor scenario is behavioural.
 */
import fs from 'node:fs';
import { PresenterSupervisor } from './electron/presenter-supervisor';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function read(rel: string): string {
    return fs.readFileSync(rel, 'utf8');
}

function functionBody(source: string, marker: string): string {
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const lf = source.indexOf('\n}\n', start);
    if (lf !== -1) return source.slice(start, lf + 3);
    const crlf = source.indexOf('\r\n}\r\n', start);
    return crlf === -1 ? '' : source.slice(start, crlf + 5);
}

const driver = read('electron/overlay-presenter.ts');
const windowSource = read('electron/overlay-window.ts');

// ---- the driver owns one supervised spawn at a time ----
for (const required of [
    'PresenterSupervisor',
    'noteStarting',
    'noteReady',
    'noteDown',
    'decide(',
    'onFallback',
    'presenter-fallback',
    'private spawning',
]) {
    ok(driver.includes(required), `overlay-presenter.ts contains ${required}`);
}
ok(!driver.includes('MAX_RESPAWNS_PER_MATCH'), 'overlay-presenter.ts has no per-match respawn budget');
ok(driver.includes('if (this.spawning) return;'), 'respawn() refuses a second spawn while one is in flight');
ok(driver.includes('setDisplay'), 'the driver exposes setDisplay for display changes');
ok(driver.includes('refresh(): void'), 'the driver exposes refresh for resume/unlock');

// ---- the Electron overlay is the fallback, not a persisted choice ----
ok(windowSource.includes('backend-fallback'), 'overlay-window.ts logs backend-fallback');
ok(windowSource.includes('onFallback: (reason) => handleNativeFallback(reason)'), 'attach passes onFallback');
ok(
    windowSource.includes("handleNativeFallback(`attach-failed: ${String(error)}`)"),
    'initial attach failure also falls back'
);
for (const required of [
    'display-metrics-changed',
    'display-added',
    'display-removed',
    'resume',
    'unlock-screen',
    'setDisplay',
    'refresh',
]) {
    ok(windowSource.includes(required), `overlay-window.ts handles ${required}`);
}
const fallbackBody = functionBody(windowSource, 'function handleNativeFallback');
ok(fallbackBody !== '', 'handleNativeFallback is a top-level function with a single closing brace');
ok(!fallbackBody.includes('saveSettings('), 'fallback does not persist settings');
ok(!fallbackBody.includes('setOverlayBackend('), 'fallback does not call setOverlayBackend');

// ---- the fallback latches: loadSettings() must not re-arm the native surface ----
ok(windowSource.includes('nativeFallbackLatched'), 'overlay-window.ts latches the native fallback');
const loadBody = functionBody(windowSource, 'function loadSettings(');
ok(loadBody !== '', 'loadSettings is a top-level function with a single closing brace');
ok(loadBody.includes('nativeFallbackLatched'), 'loadSettings honours the fallback latch after its try/catch');
ok(fallbackBody.includes('nativeFallbackLatched = true'), 'handleNativeFallback sets the fallback latch');

// ---- a wedged-but-connected presenter is detected and torn down ----
for (const required of ['presenter-ping-timeout', 'lastPongAt', 'PING_TIMEOUT_MS']) {
    ok(driver.includes(required), `overlay-presenter.ts contains ${required}`);
}

// ---- the old bug: polls during one in-flight spawn burn the budget ----
const supervisor = new PresenterSupervisor();
const first = supervisor.decide(0, { wanted: true });
ok(first.kind === 'respawn' && first.attempt === 1, 'initial wanted decision asks for respawn attempt 1');
supervisor.noteStarting(0);
let extraRespawns = 0;
for (let i = 0; i < 5; i++) {
    const action = supervisor.decide(100 + i, { wanted: true });
    if (action.kind === 'respawn') extraRespawns++;
}
ok(extraRespawns === 0, 'five polls during one in-flight spawn never issue a second respawn');
ok(supervisor.snapshot().respawns === 1, 'in-flight polling leaves the respawn count at 1');

// ---- after READY the supervisor stays quiet until the presenter dies ----
supervisor.noteReady(200);
ok(supervisor.decide(201, { wanted: true }).kind === 'none', 'a ready presenter is left alone');
supervisor.noteDown(202, 'pipe-closed');
ok(supervisor.decide(203, { wanted: true }).kind === 'wait', 'a dead presenter waits out its backoff');
