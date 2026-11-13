/**
 * Destroyed-guards: safe-window.ts absorbs the post-match
 * "Object has been destroyed" crashes.
 *
 * Reproduces the race with fake window objects whose methods throw that exact
 * error: safeCall returns undefined without throwing, isWinAlive reads the
 * teardown as "dead", and installCrashNet registers the process handlers
 * exactly once (idempotent) while logging — never exiting.
 */
import { isWinAlive, safeCall, installCrashNet } from './electron/safe-window';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

// ---- safeCall: destroyed errors are swallowed, never rethrown ----
const destroyed = new TypeError('Object has been destroyed');
const result = safeCall(() => {
    throw destroyed;
});
ok(result === undefined, 'safeCall swallows "Object has been destroyed" and returns undefined');

let leaked = false;
try {
    safeCall(() => {
        throw destroyed;
    });
} catch {
    leaked = true;
}
ok(!leaked, 'safeCall never rethrows the destroyed-class error');

const reported: unknown[] = [];
const realError = new Error('disk is lava');
const failed = safeCall(
    () => {
        throw realError;
    },
    (e) => reported.push(e)
);
ok(failed === undefined, 'safeCall returns undefined when onError handles a non-destroyed error');
ok(reported.length === 1 && reported[0] === realError, 'safeCall forwards non-destroyed errors to onError');

ok(safeCall(() => 42) === 42, 'safeCall returns the value when fn succeeds');

let onErrorBoomed = false;
try {
    safeCall(
        () => {
            throw realError;
        },
        () => {
            throw new Error('onError boom');
        }
    );
} catch {
    onErrorBoomed = true;
}
ok(!onErrorBoomed, 'safeCall survives a throwing onError');
ok(safeCall(() => realError) === realError, 'safeCall returns thrown-free values untouched');

// ---- isWinAlive: teardown and dead windows read as false, never throw ----
ok(
    isWinAlive({
        isDestroyed: () => {
            throw new TypeError('Object has been destroyed');
        },
        webContents: {
            isDestroyed: () => {
                throw new TypeError('Object has been destroyed');
            },
        },
    }) === false,
    'isWinAlive false when the window throws "Object has been destroyed" mid-check'
);
ok(
    isWinAlive({
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => {
                throw new TypeError('Object has been destroyed');
            },
        },
    }) === false,
    'isWinAlive false when webContents throws "Object has been destroyed"'
);
ok(isWinAlive(null) === false, 'isWinAlive false for null');
ok(isWinAlive(undefined) === false, 'isWinAlive false for undefined');
ok(isWinAlive({}) === false, 'isWinAlive false for an object without isDestroyed');
ok(
    isWinAlive({
        isDestroyed: () => true,
        webContents: { isDestroyed: () => false },
    }) === false,
    'isWinAlive false when the window isDestroyed() is true'
);
ok(
    isWinAlive({
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false },
    }) === true,
    'isWinAlive true for a live window'
);
ok(
    isWinAlive({ isDestroyed: () => false, webContents: null }) === false,
    'isWinAlive false when webContents is missing'
);

// ---- installCrashNet: registered once, destroyed errors logged, others loud ----
const beforeException = process.listeners('uncaughtException').length;
const beforeRejection = process.listeners('unhandledRejection').length;
const crashLogs: string[] = [];
installCrashNet((m) => crashLogs.push(m));
installCrashNet((m) => crashLogs.push(m));
installCrashNet((m) => crashLogs.push(m));
if (process.listeners('uncaughtException').length === beforeException + 1) {
    ok(true, 'installCrashNet registers uncaughtException exactly once (idempotent)');
} else {
    ok(
        process.listeners('uncaughtException').length === beforeException + 1,
        `installCrashNet registers uncaughtException exactly once (got ${process.listeners('uncaughtException').length - beforeException})`
    );
}
ok(
    process.listeners('unhandledRejection').length === beforeRejection + 1,
    'installCrashNet registers unhandledRejection exactly once (idempotent)'
);

crashLogs.length = 0;
process.emit('uncaughtException', new TypeError('Object has been destroyed'));
ok(
    crashLogs.length === 1 && crashLogs[0].includes('Object has been destroyed'),
    'uncaughtException with "Object has been destroyed" is logged, not fatal'
);

crashLogs.length = 0;
process.emit('unhandledRejection', new Error('Object has been destroyed'), Promise.resolve());
ok(
    crashLogs.length === 1 && crashLogs[0].includes('Object has been destroyed'),
    'unhandledRejection with "Object has been destroyed" is logged, not fatal'
);

crashLogs.length = 0;
process.emit('uncaughtException', new Error('unrelated failure'));
ok(
    crashLogs.length === 1 && crashLogs[0].includes('unrelated failure'),
    'other errors are logged loudly, not swallowed silently'
);

if (!process.exitCode) {
    console.log('verify:destroyed-guards ok');
}