/**
 * Pre-match loading pet: the overlay must show it from GameStart (or from an
 * InProgress that arrives before the Live Client answers), and the payload must
 * survive the page that was not listening yet.
 *
 * The state machine lives in electron/game-monitor.ts and needs Electron to run
 * end to end, so this harness does both:
 *  - exercises the exported pure predicates/payload,
 *  - reads the wiring in game-monitor.ts / overlay-window.ts and checks the
 *    order that caused the bug: record the payload, replay it on window-created
 *    and on the page's first heartbeat, clear a carried-over user hide, and
 *    hide again when the load is dodged.
 */
import fs from 'fs';
import {
    isPrematchLoadingPhase,
    prematchLoadingPayload,
    shouldReplayOverlayState,
} from './electron/game-monitor';
import { formatOverlayLogLine } from './electron/overlay-log';

let failures = 0;

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        failures += 1;
        console.error('FAIL', msg);
    } else {
        console.log('ok', msg);
    }
}

/** Source with comments removed, so a quoted snippet cannot pass from a comment. */
function code(rel: string): string {
    const raw = fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n');
    return raw
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n+/g, '\n');
}

/** Body of `function name(...) { ... }`, brace-balanced. */
function bodyOf(src: string, name: string): string | null {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) return null;
    // Skip the parameter list first: object-typed params contain their own braces.
    let parens = 0;
    let afterParams = -1;
    for (let i = src.indexOf('(', start); i < src.length; i += 1) {
        if (src[i] === '(') parens += 1;
        else if (src[i] === ')') {
            parens -= 1;
            if (parens === 0) {
                afterParams = i + 1;
                break;
            }
        }
    }
    if (afterParams < 0) return null;
    const open = src.indexOf('{', afterParams);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    return null;
}

console.log('--- verify:prematch-loading: phases ---');
ok(isPrematchLoadingPhase('GameStart', false), 'GameStart enters pre-match loading');
ok(isPrematchLoadingPhase('InProgress', false), 'InProgress with no live board enters pre-match loading');
ok(!isPrematchLoadingPhase('InProgress', true), 'InProgress after beginMatch does not re-enter loading');
ok(!isPrematchLoadingPhase('GameStart', true), 'a running match owns the overlay even on a GameStart label');
for (const phase of ['None', 'Lobby', 'ChampSelect', 'EndOfGame', 'WaitingForStats', 'Reconnect', null]) {
    ok(!isPrematchLoadingPhase(phase, false), `${phase ?? '(null)'} is not pre-match loading`);
}

console.log('--- verify:prematch-loading: payload ---');
const pet = { species: 'pyke', color: 'abyss' } as unknown as Parameters<typeof prematchLoadingPayload>[1];
const payload = prematchLoadingPayload('GameStart', pet);
ok(payload.loading === true, 'payload carries loading=true (the page draws only the pet)');
ok(payload.inGame === true, 'payload keeps inGame=true so the page is not read as idle');
ok(payload.gameflowPhase === 'GameStart', 'payload carries the phase');
ok(payload.gameTime === 0 && payload.trustedGameTime === 0, 'no clock is claimed before the game starts');
ok(payload.pet === pet, 'payload carries the pet preference');

console.log('--- verify:prematch-loading: replay gate ---');
ok(
    shouldReplayOverlayState({ inGame: false, prematchLoading: true, userHidden: false, hasPayload: true }),
    'a payload sent at GameStart is replayed while pre-match loading'
);
ok(
    shouldReplayOverlayState({ inGame: true, prematchLoading: false, userHidden: false, hasPayload: true }),
    'in-match replay still works (unchanged behaviour)'
);
ok(
    !shouldReplayOverlayState({ inGame: false, prematchLoading: true, userHidden: true, hasPayload: true }),
    'a user-hidden overlay is not re-shown by a replay'
);
ok(
    !shouldReplayOverlayState({ inGame: false, prematchLoading: true, userHidden: false, hasPayload: false }),
    'nothing is replayed before any payload was ever sent'
);
ok(
    !shouldReplayOverlayState({ inGame: false, prematchLoading: false, userHidden: false, hasPayload: true }),
    'after the load is dodged (loading cleared) a new window is not sent a stale loading payload'
);

console.log('--- verify:prematch-loading: log lines ---');
const entryLine = formatOverlayLogLine(Date.UTC(2026, 10, 15, 1, 2, 3), 'prematch-loading enter', {
    phase: 'GameStart',
    userHidden: true,
});
ok(entryLine.includes(' prematch-loading enter phase=GameStart'), `enter line: ${entryLine}`);
const exitLine = formatOverlayLogLine(Date.UTC(2026, 10, 15, 1, 2, 4), 'prematch-loading exit', {
    reason: 'phase-None',
});
ok(exitLine.includes(' prematch-loading exit reason=phase-None'), `exit line: ${exitLine}`);

console.log('--- verify:prematch-loading: monitor wiring ---');
const monitor = code('electron/game-monitor.ts');
const overlayWindow = code('electron/overlay-window.ts');

const enter = bodyOf(monitor, 'enterPrematchLoading');
ok(!!enter, 'enterPrematchLoading exists');
ok(!!enter && enter.includes('if (prematchLoading) return;'), 'entering twice in one load sends nothing extra');
ok(!!enter && enter.includes("overlayLog('prematch-loading enter'"), 'entry is logged as prematch-loading enter');
ok(
    !!enter && /setOverlayUserHidden\(false\)/.test(enter),
    'entry clears a user hide carried over from the previous match'
);
ok(
    !!enter && enter.includes('createOverlayWindow()') && enter.includes('showOverlay()'),
    'entry creates and shows the overlay'
);
ok(
    !!enter && /sendFullOverlayUpdate\(\s*prematchLoadingPayload\(/.test(enter),
    'entry sends the loading payload through sendFullOverlayUpdate (so it is kept for replay)'
);
ok(
    !!enter && !/sendOverlayUpdate\(/.test(enter),
    'entry never sends the loading payload through the non-recording sendOverlayUpdate'
);

const full = bodyOf(monitor, 'sendFullOverlayUpdate');
ok(
    !!full && /lastSentOverlayPayload = payload;[\s\S]*sendOverlayUpdate\(payload\)/.test(full),
    'sendFullOverlayUpdate records the payload before sending it'
);

const replay = bodyOf(monitor, 'replayOverlayState');
ok(!!replay, 'replayOverlayState exists');
ok(
    !!replay && replay.includes('shouldReplayOverlayState('),
    'replayOverlayState uses the shared replay gate'
);
ok(
    !!replay && replay.includes('sendOverlayUpdate(lastSentOverlayPayload)'),
    'replayOverlayState re-sends the recorded payload to the new page'
);
ok(
    !!replay && replay.includes("overlayLog('prematch-loading replay-loading'"),
    'replay is logged as prematch-loading replay-loading'
);

const created = bodyOf(monitor, 'handleOverlayWindowCreated');
ok(
    !!created && created.includes("replayOverlayState('window-created')"),
    'a window created after the send triggers a replay (the original bug path)'
);

const pageReady = bodyOf(monitor, 'handleOverlayPageReady');
ok(
    !!pageReady && pageReady.includes("replayOverlayState('page-ready')"),
    'the page ready signal also triggers a replay (covers the backend fallback window)'
);
ok(
    monitor.includes('setOverlayPageReadyHandler(handleOverlayPageReady)'),
    'startGameMonitor registers the page-ready replay'
);
ok(
    monitor.includes('setOverlayPageReadyHandler(null)'),
    'stopGameMonitor unregisters the page-ready replay'
);

const exit = bodyOf(monitor, 'exitPrematchLoading');
ok(!!exit, 'exitPrematchLoading exists');
ok(!!exit && exit.includes('if (!prematchLoading) return;'), 'exit is a no-op when not loading');
ok(!!exit && exit.includes("overlayLog('prematch-loading exit'"), 'exit is logged as prematch-loading exit');
ok(!!exit && exit.includes('hideOverlay()'), 'exit hides the overlay for a dodge/cancel');
ok(!!exit && exit.includes('loading: false'), 'exit clears the loading flag on the page');
ok(!!exit && exit.includes('if (!hide) return;'), 'a match takeover exits without hiding');

const onPhase = bodyOf(monitor, 'onPhase');
ok(!!onPhase, 'onPhase exists');
ok(
    !!onPhase && onPhase.includes('isPrematchLoadingPhase(phase, inGame)'),
    'onPhase decides loading from the phase and the live-match flag'
);
ok(
    !!onPhase && onPhase.includes('enterPrematchLoading(phase)'),
    'onPhase enters pre-match loading (was: GameStart only)'
);
ok(
    !!onPhase && /exitPrematchLoading\(`phase-\$\{phase \?\? 'none'\}`,\s*true\)/.test(onPhase),
    'onPhase exits and hides when the phase leaves the loading phases'
);
ok(
    !!onPhase && !onPhase.includes("phase === 'GameStart' &&"),
    'the old GameStart-only branch is gone'
);

const begin = bodyOf(monitor, 'beginMatch');
ok(
    !!begin && begin.includes("exitPrematchLoading('match-start', false)"),
    'beginMatch leaves loading without hiding (the live board takes over)'
);

console.log('--- verify:prematch-loading: overlay window wiring ---');
const setHandler = bodyOf(overlayWindow, 'setOverlayPageReadyHandler');
ok(!!setHandler, 'setOverlayPageReadyHandler exists');
const heartbeat = bodyOf(overlayWindow, 'noteOverlayHeartbeat');
ok(!!heartbeat, 'noteOverlayHeartbeat exists');
ok(
    !!heartbeat && /if \(!previous && overlayPageReadyHandler\)/.test(heartbeat),
    'only the first beat of a page fires the ready hook (not every beat)'
);
ok(
    !!heartbeat && heartbeat.includes('overlayPageReadyHandler()'),
    'the first beat calls the ready hook'
);
ok(
    /forgetSlot[\s\S]*overlayBeats.delete/.test(overlayWindow),
    'a closed page forgets its beat, so a recreated window replays again'
);

if (failures) {
    console.error(`verify:prematch-loading FAILED (${failures})`);
    process.exit(1);
}
console.log('verify:prematch-loading ok');
