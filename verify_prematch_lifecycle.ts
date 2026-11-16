/**
 * verify_prematch_lifecycle.ts — behavioral tests for the pre-match loading
 * lifecycle decisions (review fix round on fix-45).
 *
 * Everything here drives the real functions the app runs, with fake timers,
 * fake pages and injected fetchers:
 *   - a requeue inside the 12 s window cancels the finished match's destroy;
 *   - a window created after the loading payload was sent replays it;
 *   - a reload keeps the webContents id and still gets a replay;
 *   - a reconnect straight into InProgress resolves the champion from the
 *     gameflow session (one request, none when identity is unknown);
 *   - the loading path reads the champ-select cache and issues no history
 *     request; an empty cache stays "unknown" (pet only), not "first game";
 *   - the champion accent resets before a changed source resolves;
 *   - the loading card labels ranked form honestly.
 *
 * Run: npx --yes tsx verify_prematch_lifecycle.ts
 */
import fs from 'node:fs';
import {
    createOverlayDestroyGate,
    createPrematchStatsCache,
    championFromGameflowSession,
    isPageReady,
    pageReadyAfterBeat,
    resetPageReadiness,
    resolveLoadingChampion,
    shouldRefreshLoadingStats,
    type OverlayPageBeat,
} from './electron/prematch-loading';
import { shouldReplayOverlayState } from './electron/game-monitor';
import { computeLoadingStats } from './src/overlay/loadingStats';
import { accentCacheKey, accentTransition } from './src/overlay/champAccent';

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

/** Deterministic timer queue: advance() fires everything due, in order. */
class FakeClock {
    private nowMs = 0;
    private sequence = 0;
    private timers = new Map<number, { at: number; fn: () => void }>();
    setTimeout = (fn: () => void, ms: number): number => {
        this.sequence += 1;
        this.timers.set(this.sequence, { at: this.nowMs + ms, fn });
        return this.sequence;
    };
    clearTimeout = (handle: unknown): void => {
        this.timers.delete(handle as number);
    };
    pending(): number {
        return this.timers.size;
    }
    advance(ms: number): void {
        const target = this.nowMs + ms;
        for (;;) {
            let nextId = -1;
            let nextAt = Number.POSITIVE_INFINITY;
            for (const [id, timer] of this.timers) {
                if (timer.at <= target && timer.at < nextAt) {
                    nextAt = timer.at;
                    nextId = id;
                }
            }
            if (nextId < 0) break;
            const timer = this.timers.get(nextId)!;
            this.timers.delete(nextId);
            this.nowMs = timer.at;
            timer.fn();
        }
        this.nowMs = target;
    }
}

/** A promise plus its resolver, for "fetch still in flight" cases. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function main(): Promise<void> {
console.log('--- verify:prematch-lifecycle: requeue cancels the delayed destroy ---');
{
    const clock = new FakeClock();
    let inGame = false;
    let destroyed = 0;
    const gate = createOverlayDestroyGate({
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        isInGame: () => inGame,
        destroy: () => {
            destroyed += 1;
        },
    });
    gate.schedule();
    ok(gate.pending(), 'a finished match arms the delayed destroy');
    clock.advance(11_999);
    ok(destroyed === 0, 'nothing is destroyed before the 12 s elapse');
    // Quick requeue: the next load owns the overlay again.
    inGame = true;
    gate.cancel();
    ok(!gate.pending(), 'entering the next load cancels the pending destroy');
    clock.advance(20_000);
    ok(destroyed === 0, 'the pet window survives the requeue (timer never fires)');

    // No requeue: the destroy still happens.
    inGame = false;
    gate.schedule();
    clock.advance(11_999);
    ok(destroyed === 0, 'the re-armed destroy still waits the full delay');
    clock.advance(1);
    ok(destroyed === 1, 'without a requeue the finished match destroys the window once');
    ok(!gate.pending(), 'the fired destroy clears itself');

    // A reschedule moves the deadline instead of stacking timers.
    gate.schedule();
    clock.advance(9_000);
    gate.schedule();
    clock.advance(9_000);
    ok(destroyed === 1, 'rescheduling restarts the 12 s window (old deadline never fires)');
    clock.advance(3_000);
    ok(destroyed === 2, 'the moved deadline fires once');

    // A match that started for real must never destroy its own window.
    inGame = true;
    gate.schedule();
    clock.advance(12_000);
    ok(destroyed === 2, 'a live match is never destroyed by a stale gate');
}

console.log('--- verify:prematch-lifecycle: a dodged load tears the hidden window down ---');
{
    const clock = new FakeClock();
    let inGame = false;
    let destroyed = 0;
    const gate = createOverlayDestroyGate({
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        isInGame: () => inGame,
        destroy: () => {
            destroyed += 1;
        },
    });
    // A finished match armed it, the requeue cancelled it, then the requeue was
    // dodged: nothing will ever draw into the hidden window again.
    gate.schedule();
    gate.cancel();
    gate.schedule();
    clock.advance(11_999);
    ok(destroyed === 0, 'a dodged load keeps the hidden window for the 12 s grace');
    clock.advance(1);
    ok(destroyed === 1, 'a dodged load tears the hidden window down after 12 s');
    // A new load cancels the teardown and must not destroy the pet window.
    gate.schedule();
    inGame = true;
    gate.cancel();
    clock.advance(20_000);
    ok(destroyed === 1, 'a new load cancels the dodge teardown');
}

console.log('--- verify:prematch-lifecycle: page reload gets another replay ---');
{
    const beats = new Map<number, OverlayPageBeat>();
    const logLines: string[] = [];
    let replays = 0;
    const beat = (id: number): void => {
        const wasReady = pageReadyAfterBeat(beats, id, { frames: true, pageVisible: true }, 1_000);
        if (!wasReady) replays += 1;
    };
    ok(!isPageReady(beats, 7), 'a fresh webContents id is not ready yet');
    beat(7);
    ok(replays === 1, 'the first heartbeat of a page fires the replay hook');
    ok(isPageReady(beats, 7), 'the page is ready after its first beat');
    beat(7);
    ok(replays === 1, 'later heartbeats never replay again');

    const reset = resetPageReadiness(beats, 7, 'did-start-navigation', (line) => logLines.push(line));
    ok(reset === true, 'navigation reset reports the page it cleared');
    ok(!isPageReady(beats, 7), 'a reload/navigation clears readiness for the same id');
    ok(logLines[0] === 'page-readiness-reset', 'the reset is logged for the overlay log');
    beat(7);
    ok(replays === 2, 'the remounted page (same id) gets its own replay');

    ok(resetPageReadiness(beats, 99, 'did-finish-load') === false, 'resetting an unknown page is a no-op');
    resetPageReadiness(beats, 7, 'did-finish-load');
    beat(7);
    ok(replays === 3, 'did-finish-load also opens a fresh page mount');
    resetPageReadiness(beats, 7, 'render-process-gone');
    beat(7);
    ok(replays === 4, 'a crashed renderer reloads into a fresh page mount too');
}

console.log('--- verify:prematch-lifecycle: window recreated after send replays ---');
{
    let payloadSent = false;
    let replaySends = 0;
    const onWindowCreated = (): void => {
        if (
            shouldReplayOverlayState({
                inGame: false,
                prematchLoading: true,
                userHidden: false,
                hasPayload: payloadSent,
            })
        ) {
            replaySends += 1;
        }
    };
    onWindowCreated();
    ok(replaySends === 0, 'a window created before any payload exists gets nothing');
    payloadSent = true;
    onWindowCreated();
    ok(replaySends === 1, 'a window recreated after the loading send replays the payload');
    ok(
        !shouldReplayOverlayState({
            inGame: false,
            prematchLoading: true,
            userHidden: true,
            hasPayload: true,
        }),
        'a user hide still suppresses the replay'
    );
}

console.log('--- verify:prematch-lifecycle: reconnect champion from the session ---');
{
    const session = {
        gameData: {
            playerChampionSelections: [
                { championId: 64, puuid: 'someone-else' },
                { championId: 246, puuid: 'me-puuid' },
            ],
            teamOne: [{ championId: 103, summonerId: 42 }],
            teamTwo: [],
        },
    };
    ok(
        championFromGameflowSession(session, { puuid: 'me-puuid' })?.championId === 246,
        'playerChampionSelections wins and matches by puuid'
    );
    ok(
        championFromGameflowSession(
            { gameData: { teamOne: [{ championId: 103, summonerId: 42 }] } },
            { summonerId: 42 }
        )?.championId === 103,
        'the teams fallback matches by summonerId'
    );
    ok(
        championFromGameflowSession(session, { puuid: 'no-such-puuid' }) === null,
        'a different summoner resolves nothing'
    );
    ok(championFromGameflowSession(session, null) === null, 'no local identity resolves nothing');
    ok(championFromGameflowSession(null, { puuid: 'me-puuid' }) === null, 'a missing session resolves nothing');
    ok(
        championFromGameflowSession(
            { gameData: { playerChampionSelections: [{ championId: 0, puuid: 'me-puuid' }] } },
            { puuid: 'me-puuid' }
        ) === null,
        'champion id 0 (no lock yet) is not a pick'
    );

    let sessionFetches = 0;
    const champion = await resolveLoadingChampion({
        getIdentity: () => ({ puuid: 'me-puuid' }),
        fetchSession: async () => {
            sessionFetches += 1;
            return session;
        },
    });
    ok(champion?.championId === 246, 'a reconnect resolves the champion through one session read');
    ok(sessionFetches === 1, 'exactly one session request when the pick is unknown');

    let blindFetches = 0;
    const blind = await resolveLoadingChampion({
        getIdentity: () => null,
        fetchSession: async () => {
            blindFetches += 1;
            return session;
        },
    });
    ok(blind === null, 'no identity means the champion stays unknown');
    ok(blindFetches === 0, 'no identity means no LCU request at all');

    const failed = await resolveLoadingChampion({
        getIdentity: () => ({ summonerId: 42 }),
        fetchSession: async () => {
            throw new Error('offline');
        },
    });
    ok(failed === null, 'a failed session read degrades to the pet only');
}

console.log('--- verify:prematch-lifecycle: loading path issues no history request ---');
{
    const fixture = [
        { championId: 555, win: true, kills: 8, deaths: 2, assists: 10, queueId: 420 },
        { championId: 555, win: false, kills: 2, deaths: 6, assists: 5, queueId: 440 },
        { championId: 555, win: true, kills: 6, deaths: 3, assists: 9, queueId: 400 },
        { championId: 99, win: false, kills: 0, deaths: 10, assists: 0, queueId: 420 },
    ];
    let fetches = 0;
    const cache = createPrematchStatsCache({
        fetchHistory: async () => {
            fetches += 1;
            return fixture;
        },
    });
    ok(cache.statsFor(555) === null, 'an unloaded cache gives no card (pet only), never a fake first game');
    ok(fetches === 0, 'reading the loading stats makes zero history requests');
    ok(!cache.loaded(), 'the cache reports unknown before the prefetch');

    await cache.prefetch();
    ok(fetches === 1, 'the champ-select prefetch is the only history request');
    const stats = cache.statsFor(555);
    ok(!!stats, 'after the prefetch the loading path has a card');
    ok(stats?.scope === 'ranked', 'ranked games take precedence over normals');
    ok(stats?.games === 2, `only ranked games on this champion count (got ${stats?.games})`);
    ok(stats?.winRate === 50, `ranked win % from the ranked slice (got ${stats?.winRate}%)`);
    ok(fetches === 1, 're-reading the card never fetches again');

    await cache.prefetch();
    ok(fetches === 1, 'a second prefetch in the same champ select is free');
    cache.reset();
    ok(cache.statsFor(555) === null, 'a reset cache is unknown again');
    await cache.prefetch();
    ok(fetches === 2, 'a new champ select prefetches once more');

    // Empty cache vs. loaded-but-no-games are different states.
    const empty = createPrematchStatsCache({ fetchHistory: async () => [] });
    await empty.prefetch();
    const firstGame = empty.statsFor(555);
    ok(firstGame?.games === 0 && firstGame?.scope === null, 'a loaded empty history is the first-game state');
    ok(empty.loaded(), 'empty history is still "loaded", unlike a missing cache');
}

console.log('--- verify:prematch-lifecycle: a late prefetch refreshes the active load ---');
{
    // The fetch is still in flight when GameStart arrives: the cache is unknown
    // then, and the card must appear when it lands — no new request from loading.
    const pending = deferred<Array<{ championId: number; win: boolean; kills: number; deaths: number; assists: number; queueId?: number }>>();
    let fetches = 0;
    const cache = createPrematchStatsCache({
        fetchHistory: () => {
            fetches += 1;
            return pending.promise;
        },
    });
    const prefetch = cache.prefetch();
    ok(!cache.loaded() && cache.statsFor(64) === null, 'GameStart with the prefetch in flight has no card yet');
    const loading = true;
    const loadToken = 1;
    ok(
        cache.statsFor(64) === null && fetches === 1,
        'the loading read neither waits nor issues a second history request'
    );
    pending.resolve([{ championId: 64, win: true, kills: 5, deaths: 1, assists: 8, queueId: 420 }]);
    await prefetch;
    ok(cache.loaded() && cache.statsFor(64)?.games === 1, 'the in-flight prefetch still fills the card when it lands');
    ok(fetches === 1, 'the late card costs no extra history request');
    ok(
        shouldRefreshLoadingStats({
            loading,
            loadToken,
            activeToken: loadToken,
            championId: 64,
            loadingChampionId: 64,
        }),
        'the monitor may resend the payload for the same load and champion'
    );

    const refresh = shouldRefreshLoadingStats;
    ok(
        !refresh({ loading: false, loadToken: 1, activeToken: 1, championId: 64, loadingChampionId: 64 }),
        'a prefetch landing after the load exited never resends'
    );
    ok(
        !refresh({ loading: true, loadToken: 1, activeToken: 2, championId: 64, loadingChampionId: 64 }),
        'a prefetch from an older load never restats a newer one'
    );
    ok(
        !refresh({ loading: true, loadToken: 2, activeToken: 2, championId: 64, loadingChampionId: 246 }),
        'a prefetch for a swapped-away champion never restats the new pick'
    );
    ok(
        !refresh({ loading: true, loadToken: 2, activeToken: 2, championId: null, loadingChampionId: null }),
        'an unknown champion cannot fold a card'
    );
}

console.log('--- verify:prematch-lifecycle: cache resets per champ select ---');
{
    const oldFetch = deferred<Array<{ championId: number; win: boolean; kills: number; deaths: number; assists: number; queueId?: number }>>();
    const newFetch = deferred<Array<{ championId: number; win: boolean; kills: number; deaths: number; assists: number; queueId?: number }>>();
    let fetches = 0;
    const cache = createPrematchStatsCache({
        fetchHistory: () => {
            fetches += 1;
            return fetches === 1 ? oldFetch.promise : newFetch.promise;
        },
    });
    const first = cache.prefetch();
    ok(fetches === 1, 'the first champ select starts a prefetch');
    // A new champ select starts before the old request answers.
    cache.reset();
    ok(!cache.loaded() && cache.statsFor(64) === null, 'a new champ-select session starts with an unknown cache');
    const second = cache.prefetch();
    ok(fetches === 2, 'the new champ select fetches again instead of reusing stale games');
    oldFetch.resolve([{ championId: 64, win: true, kills: 1, deaths: 1, assists: 1, queueId: 420 }]);
    await first;
    ok(cache.statsFor(64) === null, 'an older in-flight prefetch can never repopulate the reset cache');
    newFetch.resolve([{ championId: 64, win: false, kills: 0, deaths: 5, assists: 2, queueId: 420 }]);
    await second;
    ok(cache.statsFor(64)?.games === 1, 'the current prefetch fills the cache');
    ok(cache.statsFor(64)?.winRate === 0, 'the cache holds the new games, not the stale page');
    ok(fetches === 2, 'the stale request never started a third fetch');
}

console.log('--- verify:prematch-lifecycle: ranked card label ---');
{
    const ranked = computeLoadingStats(
        [
            { championId: 7, win: true, kills: 1, deaths: 1, assists: 1, queueId: 420 },
            { championId: 7, win: false, kills: 1, deaths: 1, assists: 1, queueId: 430 },
        ],
        7
    );
    ok(ranked.scope === 'ranked' && ranked.games === 1, 'one ranked game scopes to ranked');
    const rift = computeLoadingStats(
        [{ championId: 7, win: true, kills: 1, deaths: 1, assists: 1, queueId: 430 }],
        7
    );
    ok(rift.scope === 'rift' && rift.games === 1, 'no ranked game falls back to all Rift queues');
    const unknownSource = computeLoadingStats(
        [{ championId: 7, win: true, kills: 1, deaths: 1, assists: 1 }],
        7
    );
    ok(unknownSource.scope === 'rift', 'an absent queueId still counts as Rift (fixture callers)');
    const empty = computeLoadingStats([], 7);
    ok(empty.scope === null && empty.games === 0, 'no games has no scope label');
    const card = fs.readFileSync('src/overlay/LoadingCard.tsx', 'utf8');
    ok(card.includes("stats.scope === 'ranked'"), 'the card keys its label off the scope');
    ok(card.includes("'ranked '"), 'the ranked label is rendered');
    ok(card.includes('First game on this champion'), 'the first-game empty state survives');
}

console.log('--- verify:prematch-lifecycle: champion accent resets on source change ---');
{
    const same = accentTransition('k64', 'k64');
    ok(same.reset === false && same.resolve === true, 'the same pick does not reset the accent');
    const swap = accentTransition('k64', 'k246');
    ok(swap.reset === true && swap.resolve === true, 'a changed pick resets to chrome before resolving');
    const cleared = accentTransition('k64', null);
    ok(cleared.reset === true && cleared.resolve === false, 'an unknown pick resets and resolves nothing');
    const first = accentTransition(null, 'k246');
    ok(first.reset === true && first.resolve === true, 'the first pick resets the chrome default too');
    ok(accentCacheKey({ key: 64 }) === 'k64', 'accent keys follow the numeric champion id');
    ok(accentCacheKey({ name: 'Aurelion Sol' }) === 'naurelionsol', 'accent keys fall back to the name');
    ok(accentCacheKey({}) === '', 'an empty source has no key');

    const app = code('src/overlay/OverlayApp.tsx');
    ok(app.includes('accentTransition(accentPreviousKey.current, key)'), 'OverlayApp decides from the source key');
    ok(
        /if \(transition\.reset\) apply\(DEFAULT_ACCENT\);/.test(app),
        'OverlayApp applies chrome before resolving a changed source'
    );
    ok(
        /accentApplyToken\.current !== token/.test(app),
        'a stale resolved accent is dropped by token comparison'
    );
}

console.log('--- verify:prematch-lifecycle: production wiring ---');
{
    const monitor = code('electron/game-monitor.ts');
    const enter = bodyOf(monitor, 'enterPrematchLoading');
    ok(!!enter, 'enterPrematchLoading exists');
    ok(!!enter && enter.includes('overlayDestroyGate.cancel()'), 'entering a load cancels the stale destroy');
    ok(
        !!enter && enter.indexOf('overlayDestroyGate.cancel()') < enter.indexOf('if (prematchLoading) return;'),
        'the cancel runs before the once-per-load early return'
    );
    ok(!!enter && !/getMatchHistory\b/.test(enter), 'the loading entry never reads match history');
    ok(!!enter && !/loadPrematchStats/.test(enter), 'the old per-load history fetch is gone');
    ok(
        !!enter && enter.includes('prematchStatsFromCache('),
        'the loading entry folds the champ-select cache only'
    );
    ok(
        !!enter && !/prematchHistoryCache\.prefetch\(/.test(enter),
        'the loading entry never starts a history request'
    );
    ok(
        !!enter && /if \(!loadingChampion\) void resolvePrematchChampionFromSession\(\)/.test(enter),
        'the session read runs only when no champ-select pick is known'
    );
    ok(
        monitor.includes('getMatchHistorySummaries({ count: 60 })'),
        'the prefetch asks for 60 summaries and no details'
    );
    ok(
        /function createPrematchStatsCache|\bcreatePrematchStatsCache\(/.test(monitor),
        'the monitor uses the shared cache controller'
    );
    const prefetch = bodyOf(monitor, 'prefetchHistoryForChampSelect');
    ok(!!prefetch && prefetch.includes('prematchHistoryCache.prefetch()'), 'champ select starts the prefetch');
    ok(
        !!prefetch && prefetch.includes('shouldRefreshLoadingStats('),
        'a prefetch that lands mid-load is checked against the active load/champion'
    );
    ok(
        !!prefetch && prefetch.includes('sendPrematchLoadingPayload()'),
        'a valid late prefetch resends the loading payload'
    );
    const beginSession = bodyOf(monitor, 'beginChampSelectSession');
    ok(!!beginSession, 'a new champ select has its own session start');
    ok(
        !!beginSession && beginSession.includes('prematchHistoryCache.reset()'),
        'a new champ select drops the previous history snapshot'
    );
    ok(
        !!beginSession && /champSelectSession \+= 1/.test(beginSession),
        'the session token advances so older prefetches cannot repopulate'
    );
    const onPhase = bodyOf(monitor, 'onPhase');
    ok(
        !!onPhase && /phase === 'ChampSelect'/.test(onPhase) && onPhase.includes('beginChampSelectSession()'),
        'onPhase starts a fresh session on champ-select entry'
    );
    ok(
        !!onPhase && onPhase.includes('prefetchHistoryForChampSelect()'),
        'onPhase prefetches on champ-select entry'
    );
    const exit = bodyOf(monitor, 'exitPrematchLoading');
    ok(!!exit, 'exitPrematchLoading exists');
    ok(
        !!exit && exit.includes('overlayDestroyGate.schedule()'),
        'a dodged load schedules the hidden window teardown'
    );
    ok(
        !!exit &&
            exit.indexOf('overlayDestroyGate.schedule()') > exit.indexOf('hideOverlay()') &&
            exit.indexOf('if (!hide) return;') < exit.indexOf('overlayDestroyGate.schedule()'),
        'only the no-match (hide) exit schedules the teardown, after hiding'
    );
    const resolveSession = bodyOf(monitor, 'resolvePrematchChampionFromSession');
    ok(
        !!resolveSession && resolveSession.includes("'/lol-gameflow/v1/session'"),
        'the reconnect champion is read from the gameflow session'
    );
    ok(
        !!resolveSession && resolveSession.includes('waitForLocalSummoner('),
        'the session read waits for the client sumoner event instead of a second request'
    );
    ok(monitor.includes("lcuSocket.on('summoner', onSummoner)"), 'summoner events feed the identity cache');

    const overlayWindow = code('electron/overlay-window.ts');
    const arm = bodyOf(overlayWindow, 'armPageReadiness');
    ok(!!arm, 'overlay-window arms page readiness for a webContents');
    for (const signal of ['did-start-navigation', 'did-finish-load', 'render-process-gone']) {
        ok(!!arm && arm.includes(`resetOverlayPageReadiness(contentsId, '${signal}')`), `${signal} clears readiness`);
    }
    ok(
        overlayWindow.includes('armPageReadiness(win);'),
        'both the Electron overlay and the OSR page arm it'
    );
    const heartbeat = bodyOf(overlayWindow, 'noteOverlayHeartbeat');
    ok(
        !!heartbeat && heartbeat.includes('pageReadyAfterBeat(overlayBeats, webContentsId, beat, now)'),
        'the heartbeat uses the shared first-beat decision'
    );

    const history = code('electron/match-history.ts');
    ok(history.includes('export function getMatchHistorySummaries'), 'match-history exposes summaries-only reads');
    const summaries = bodyOf(history, 'getMatchHistorySummaries');
    ok(!!summaries && summaries.includes('detailLimit: 0'), 'the summaries path asks for no per-game details');
    ok(
        !!summaries && summaries.includes('canFetchDetails: () => false'),
        'the summaries path can never fetch details'
    );
    ok(!!summaries && summaries.includes('summariesInFlight'), 'summaries never join a detail in-flight slot');
}

if (failures) {
    console.error(`verify:prematch-lifecycle FAILED (${failures})`);
    process.exit(1);
}
console.log('verify:prematch-lifecycle ok');
}

void main();
