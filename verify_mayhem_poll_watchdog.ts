/**
 * Brief E - the overlay/OCR chain must survive a bad scan.
 *
 * Proven here, with no Electron:
 *
 *   1. a scan that NEVER settles does not stop the next poll from being armed
 *      (the chain is driven with injected timers and a hung promise);
 *   2. automatic OCR stays available when `nextMayhemPickLevel` is null (all
 *      slots counted) and the level is at/after the last augment level;
 *   3. `resetMayhemMatchState` clears the owned augments (and roll/picksTaken),
 *      so a previous match cannot inflate this match's resolved pick count;
 *   4. a discovery-latched match routes as `mayhem` through the game-monitor
 *      helper while mode.ts still labels queue 450 `aram`;
 *   5. a hotkey route decision emits an overlay.log record with key + routed +
 *      reason;
 *   6. a slow scan that finishes after an out-of-band purge cannot write the
 *      purged roll back (its cloned displayIds are stale), and the scan ticket
 *      reads the module epoch itself so a caller cannot pin a wrong one; the
 *      purge/clear paths and a manual scan are all shown to advance it;
 *   7. a bad/empty upstream bundle is rejected before any cache write, an
 *      invalid cache falls back to the bundled file (including a cache with no
 *      combos, which used to throw), a failed refresh keeps a stale-but-valid
 *      cache, and concurrent refreshes share one fetch;
 *   8. ALL rejected cache kinds (implausible shape, unsanitizable bundle,
 *      unparseable JSON) are quarantined to `mayhem-bundle.json.bad`, so the OCR
 *      tick stops re-reading them, the bundled file answers, and the refresh
 *      policy sees `missing-cache` and rewrites the cache.
 *
 * Run: npx --yes tsx verify_mayhem_poll_watchdog.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// mayhem-state resolves its user data dir lazily on each call; point it at a
// throwaway directory before the first write.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'otc-poll-watchdog-'));
process.env.ONETRICK_USER_DATA = userData;

import {
  createMayhemMonitorState,
  createMayhemPollChain,
  mayhemAutoOcrWanted,
  runMayhemMonitorScan,
  type MayhemMonitorRead,
  type MayhemPollTimers,
} from './src/logic/mayhem/monitor';
import { detectMayhemMode, type MayhemModeSignals } from './src/logic/mayhem/mode';
import { nextMayhemPickLevel } from './src/logic/mayhem/pickPhase';
import { MAYHEM_AUGMENT_LEVELS } from './src/logic/mayhem/augmentSchedule';
import {
  getMayhemPicksTaken,
  getMayhemRollIds,
  getOwnedMayhemAugmentIds,
  resetMayhemMatchState,
  setMayhemPicksTaken,
  setMayhemRollIds,
  setOwnedMayhemAugmentIds,
} from './electron/mayhem-state';
import {
  beginMayhemScanTicket,
  clearMayhemOffersForDashboard,
  commitMayhemMonitorScan,
  dismissMayhemAugmentPanelFromHotkey,
  getMayhemMonitorEpoch,
  logMayhemHotkeyRoute,
  mayhemModeForRouting,
} from './electron/game-monitor';
import { loadMayhemBundle, refreshMayhemBundle, refreshMayhemBundleIfStale, resetMayhemBundleMemoryForTest } from './electron/mayhem-data';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeTimers extends MayhemPollTimers {
  /** Deliver the oldest armed timer; false when none is armed. */
  fireNext(): boolean;
  /** Timers currently armed. */
  count(): number;
}

function fakeTimers(): FakeTimers {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    set(callback: () => void): unknown {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    clear(handle: unknown): void {
      pending.delete(handle as number);
    },
    fireNext(): boolean {
      const first = pending.keys().next();
      if (first.done) return false;
      const callback = pending.get(first.value);
      pending.delete(first.value);
      callback?.();
      return true;
    },
    count(): number {
      return pending.size;
    },
  };
}

async function main(): Promise<void> {
  console.log('--- 1. a hung scan cannot end the poll chain ---');
  {
    const timers = fakeTimers();
    let scans = 0;
    // A capture/OCR that never settles: this is the PowerShell hang.
    const hung = new Promise<void>(() => {});
    const chain = createMayhemPollChain({
      runTick: () => {
        scans += 1;
        return hung;
      },
      nextDelayMs: () => 900,
      isLive: () => true,
      timers,
    });
    chain.start(1200);
    ok(chain.isRunning(), 'chain is armed after start');
    ok(timers.fireNext(), 'the first poll fires');
    ok(scans === 1, 'scan 1 started');
    ok(timers.count() === 1, 'next poll armed while scan 1 is still pending');
    ok(chain.isRunning(), 'chain still running with a hung scan in flight');
    ok(timers.fireNext(), 'a later poll still fires with scan 1 never settled');
    ok(scans === 2, 'scan 2 started (the chain did not die with the hung scan)');
    chain.stop();
    ok(!chain.isRunning(), 'stop() ends the chain');
    ok(!timers.fireNext(), 'no poll is left armed after stop()');
  }

  console.log('--- 1b. a rejected scan leaves the next poll armed ---');
  {
    const timers = fakeTimers();
    const errors: unknown[] = [];
    let scans = 0;
    const chain = createMayhemPollChain({
      runTick: () => {
        scans += 1;
        return Promise.reject(new Error('powershell failed'));
      },
      nextDelayMs: () => 700,
      isLive: () => true,
      onTickError: (error) => errors.push(error),
      timers,
    });
    chain.start(50);
    timers.fireNext();
    await sleep(0);
    ok(scans === 1, 'the rejected scan ran');
    ok(errors.length === 1, 'the scan failure was reported');
    ok(timers.count() === 1, 'the next poll is still armed after a rejected scan');
    chain.stop();
  }

  console.log('--- 2. auto OCR survives nextPickLevel === null ---');
  {
    const lastAugmentLevel = MAYHEM_AUGMENT_LEVELS[MAYHEM_AUGMENT_LEVELS.length - 1];
    ok(nextMayhemPickLevel(4) === null, 'four counted picks leave no next pick level (precondition)');
    ok(
      mayhemAutoOcrWanted({ level: 15, ownedCount: 4, hudVisible: false }),
      'level 15 still scans with all slots counted'
    );
    ok(
      mayhemAutoOcrWanted({ level: lastAugmentLevel + 3, ownedCount: 6, hudVisible: false }),
      'later levels still scan after an over-counted pick set'
    );
    ok(
      !mayhemAutoOcrWanted({ level: 7, ownedCount: 4, hudVisible: false }),
      'the over-counted case does not scan the whole game'
    );
    ok(
      mayhemAutoOcrWanted({ level: 2, ownedCount: 4, hudVisible: true }),
      'a visible HUD keeps scanning even below the last level'
    );
    ok(
      !mayhemAutoOcrWanted({ level: 6, ownedCount: 1, hudVisible: false }),
      'normal gate: nothing to do before the next augment level'
    );
    ok(
      mayhemAutoOcrWanted({ level: 7, ownedCount: 1, hudVisible: false }),
      'normal gate: level 7 scans with one pick counted'
    );
  }

  console.log('--- 3. resetMayhemMatchState clears owned augments ---');
  {
    setOwnedMayhemAugmentIds(['twin_fire', 'recursion']);
    setMayhemPicksTaken(4);
    setMayhemRollIds(['a', 'b']);
    ok(getOwnedMayhemAugmentIds().length === 2, 'owned augments written for the finished match');
    resetMayhemMatchState();
    ok(getOwnedMayhemAugmentIds().length === 0, 'reset clears owned (no leak into the next match)');
    ok(getMayhemPicksTaken() === 0, 'reset still clears picksTaken');
    ok(getMayhemRollIds().length === 0, 'reset still clears roll');
  }

  console.log('--- 3b. a slow scan cannot resurrect a purged roll ---');
  {
    const signals: MayhemModeSignals = {
      gameMode: 'ARAM',
      mapName: 'Map12',
      queueId: 2400,
      mapId: 12,
    };
    const now = Date.now();
    const input = {
      now,
      level: 7,
      isDead: false,
      signals,
      liveAugmentIds: [] as string[],
      autoOcrAllowed: true,
      manualScanActive: false,
    };
    const frame = (ids: string[], owner: boolean | undefined = true): MayhemMonitorRead => ({
      ids,
      candidateIds: [],
      frameIds: ids,
      frameDisplayCount: ids.length,
      fresh: true,
      valid: true,
      fuzzyScore: 0.9,
      blackFrame: false,
      foreground: true,
      owner,
    });

    const state = createMayhemMonitorState();
    state.displayIds = ['alpha', 'beta', 'gamma'];
    state.scanStreak = 3;
    state.fuzzyScore = 0.9;
    // The tick snapshots the engine right before the slow capture/OCR await.
    // The ticket reads the module epoch itself: a caller cannot pass a wrong one.
    const ticket = beginMayhemScanTicket(state);
    ok(ticket.epoch === getMayhemMonitorEpoch(), 'the ticket carries the module epoch, not a caller guess');
    let resolveRead: (read: MayhemMonitorRead) => void = () => undefined;
    const pendingRead = new Promise<MayhemMonitorRead>((resolve) => {
      resolveRead = resolve;
    });
    const slowTick = runMayhemMonitorScan(state, input, () => pendingRead);

    // Meanwhile the roll is purged out of band (a pick, Page Up, or the pick
    // phase sync). This is the real exported clear path, not a hand-set number:
    // if clearMayhemLiveOffers ever stopped bumping, this check fails.
    state.displayIds = [];
    state.scanStreak = 0;
    state.fuzzyScore = 0;
    state.candidateIds = [];
    state.candidateScans = 0;
    const epochBeforePurge = getMayhemMonitorEpoch();
    clearMayhemOffersForDashboard();
    const epochAfterPurge = getMayhemMonitorEpoch();
    ok(
      epochAfterPurge > epochBeforePurge,
      `clearing the display advances the epoch (${epochBeforePurge} → ${epochAfterPurge})`
    );
    ok(epochAfterPurge > ticket.epoch, 'the purge moved the epoch past the scan snapshot');

    resolveRead(frame(['alpha', 'beta', 'gamma']));
    const slow = await slowTick;
    ok(slow.state.displayIds.length === 3, 'the slow scan cloned the pre-purge roll (precondition)');

    const stale = commitMayhemMonitorScan(ticket, { state, epoch: epochAfterPurge }, slow);
    ok(!stale.applied, 'write-back from before the purge is refused');
    ok(stale.state.displayIds.length === 0, 'the purged roll is not resurrected');
    ok(stale.displayIds.length === 0, 'the live offer list stays purged');

    const freshTicket = beginMayhemScanTicket(state);
    const quick = await runMayhemMonitorScan(
      state,
      { ...input, now: now + 1000 },
      () => Promise.resolve(frame(['alpha', 'beta', 'gamma']))
    );
    const fresh = commitMayhemMonitorScan(freshTicket, { state, epoch: getMayhemMonitorEpoch() }, quick);
    ok(
      fresh.applied && fresh.displayIds.join(',') === 'alpha,beta,gamma',
      'an uncontested scan still writes its roll back'
    );

    // The manual PageDown scan is authoritative too. It cannot run in this
    // harness (no game), so its contract is pinned as an ORDERING on the real
    // function: bump, then the capture await, then a second bump, then the roll
    // write. A literal grep for "two bumps somewhere" would stay green if the
    // second bump drifted after the write.
    const monitorSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'game-monitor.ts'), 'utf8');
    const manualStart = monitorSource.indexOf('export async function triggerManualMayhemOcrFromHotkey');
    const manualEnd = monitorSource.indexOf('/** Diagnostics for the performance panel. */', manualStart);
    const manual = manualStart >= 0 && manualEnd > manualStart ? monitorSource.slice(manualStart, manualEnd) : '';
    const firstBump = manual.indexOf('mayhemMonitorEpoch += 1');
    const scanAt = manual.indexOf('await detectMayhemOffers(');
    const lastBump = manual.lastIndexOf('mayhemMonitorEpoch += 1');
    const rollWrite = manual.indexOf('mayhemOfferIds = ids');
    ok(
      manual.length > 0 &&
        firstBump >= 0 &&
        scanAt > firstBump &&
        lastBump > scanAt &&
        rollWrite > lastBump,
      `a manual scan bumps, awaits, bumps again, then writes the roll ` +
        `(bump@${firstBump}, scan@${scanAt}, bump@${lastBump}, write@${rollWrite})`
    );
    // A non-fresh manual read means no OCR ran (a scan was already in flight):
    // writing its empty/retained ids would purge the live panel.
    const nonFreshGuard = manual.indexOf('if (!read.fresh)');
    ok(
      nonFreshGuard > scanAt && nonFreshGuard < lastBump,
      `the manual scan refuses a non-fresh read before the epoch bump and write ` +
        `(guard@${nonFreshGuard})`
    );
    const section = (startMarker: string, endMarker: string): string => {
      const start = monitorSource.indexOf(startMarker);
      const end = monitorSource.indexOf(endMarker, start);
      return start >= 0 && end > start ? monitorSource.slice(start, end) : '';
    };
    const purgeBody = section(
      'function purgeMayhemOffersFromScreen',
      'function applyMayhemOfferVisibilityAfterOcr'
    );
    const clearBody = section('function clearMayhemLiveOffers', 'function beginMayhemPickSession');
    ok(
      purgeBody.includes('mayhemMonitorEpoch += 1') && clearBody.includes('mayhemMonitorEpoch += 1'),
      'both out-of-band clear paths (purge and clear) bump the epoch'
    );
  }

  console.log('--- 4. latched discovery routes as mayhem; mode.ts keeps 450 aram ---');
  {
    const classicAramSignals: MayhemModeSignals = {
      gameMode: 'ARAM',
      mapName: 'Map12',
      queueId: 450,
      mapId: 12,
      augmentOffersDetected: false,
    };
    const unlatched = createMayhemMonitorState();
    ok(
      mayhemModeForRouting(unlatched, classicAramSignals) === 'aram',
      'unlatched queue 450 still routes as aram'
    );
    ok(detectMayhemMode(classicAramSignals) === 'aram', 'mode.ts labels queue 450 aram');

    const latched = createMayhemMonitorState();
    latched.discovery.latched = true;
    ok(detectMayhemMode(classicAramSignals) === 'aram', 'mode.ts precedence is unchanged by the latch');
    ok(
      mayhemModeForRouting(latched, classicAramSignals) === 'mayhem',
      'a discovery-latched match routes as mayhem through game-monitor'
    );
    ok(
      detectMayhemMode({ ...classicAramSignals, augmentOffersDetected: true }) === 'aram',
      'mode.ts still lets the classic queue beat offered augments'
    );
  }

  console.log('--- 5. hotkey route decisions reach overlay.log ---');
  {
    const direct = logMayhemHotkeyRoute({
      key: 'PageDown',
      routed: true,
      reason: 'offers:2',
    });
    ok(
      direct.includes('hotkey') &&
        direct.includes('key=PageDown') &&
        direct.includes('routed=true') &&
        direct.includes('reason=offers:2'),
      `the route record carries key + routed + reason (${direct})`
    );

    // The real PageUp route: no match is running in this harness, so it must
    // log "not routed" instead of failing silently.
    dismissMayhemAugmentPanelFromHotkey();

    const logFile = path.join(userData, 'logs', 'overlay.log');
    const needle = 'hotkey key=PageUp routed=false reason=not-in-game';
    let text = '';
    for (let i = 0; i < 50 && !text.includes(needle); i += 1) {
      await sleep(100);
      try {
        text = fs.readFileSync(logFile, 'utf8');
      } catch {
        text = '';
      }
    }
    ok(text.includes(needle), `overlay.log contains "${needle}"`);
    ok(
      text.includes('hotkey key=PageDown routed=true reason=offers:2'),
      'overlay.log contains the PageDown OCR route record'
    );
  }

  console.log('--- 1c. game-monitor wires the chain (regression guard) ---');
  {
    const monitor = fs.readFileSync(path.join(process.cwd(), 'electron', 'game-monitor.ts'), 'utf8');
    ok(monitor.includes('createMayhemPollChain({'), 'game-monitor builds the poll chain');
    const schedule = monitor.slice(
      monitor.indexOf('function scheduleMayhemPoll'),
      monitor.indexOf('function nextMayhemPollDelayMs')
    );
    ok(
      !/tickMayhemOcr\(\)\.finally/.test(schedule),
      'the next poll is no longer chained behind the scan promise'
    );
  }

  console.log('--- 6. a bad upstream payload cannot poison the cache ---');
  {
    const cacheFile = path.join(userData, 'mayhem-bundle.json');
    const repoBundlePath = path.join(process.cwd(), 'src', 'data', 'mayhem', 'bundle.json');
    const bundled = JSON.parse(fs.readFileSync(repoBundlePath, 'utf8')) as {
      meta: Record<string, unknown>;
      augments: Array<Record<string, unknown>>;
      combos: unknown[];
    };
    const realFetch = globalThis.fetch;

    // 6a0. A cache with plenty of augments but no combos used to throw inside
    // sanitizeMayhemBundle, so the bundled fallback was never reached and every
    // tick logged ocr-poll-error. It must fall back, never reject.
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ meta: bundled.meta, augments: bundled.augments.slice(0, 60) })
    );
    let combosLess: ReturnType<typeof loadMayhemBundle> = null;
    let combosLessError = '';
    try {
      combosLess = loadMayhemBundle();
    } catch (error) {
      combosLessError = String(error);
    }
    ok(combosLessError === '', `a combos-less cache does not throw (${combosLessError})`);
    ok(
      !!combosLess && combosLess.augments.length === bundled.augments.length,
      'a combos-less cache falls back to the bundled bundle'
    );

    // 6a. An empty cache file (the truncated payload an older build could
    // write) must not hide the bundled file for the whole session.
    fs.writeFileSync(cacheFile, JSON.stringify({ meta: { patch: 'bad' }, augments: [], combos: [] }));
    const fromBadCache = loadMayhemBundle();
    ok(
      !!fromBadCache && fromBadCache.augments.length === bundled.augments.length,
      'an empty cache falls back to the bundled bundle'
    );

    // Seed a stale-but-valid cache with a marker augment, so a failed refresh
    // proves which bundle answered.
    const staleCache = {
      ...bundled,
      meta: { ...bundled.meta, patch: 'test-old', syncedAt: new Date().toISOString() },
      augments: [
        ...bundled.augments,
        { ...bundled.augments[0], id: 'stale-marker', slug: 'stale-marker' },
      ],
    };
    const staleText = JSON.stringify(staleCache);
    fs.writeFileSync(cacheFile, staleText);

    // 6b. A failed refresh (offline) keeps the stale-but-valid cache.
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      const stale = await refreshMayhemBundleIfStale('test-new');
      ok(
        stale.refreshed === false && stale.reason === 'patch-mismatch',
        'a cache from another patch is due for refresh'
      );
      ok(
        !!stale.bundle && stale.bundle.augments.some((a) => a.id === 'stale-marker'),
        'a failed refresh still answers with the stale-but-valid cache'
      );
      ok(
        fs.readFileSync(cacheFile, 'utf8') === staleText,
        'a failed refresh leaves the cache file untouched'
      );
    } finally {
      globalThis.fetch = realFetch;
    }

    const apiDocs = {
      augments: {
        meta: { patch: '16.23', statsDate: '2026-11-18' },
        rows: bundled.augments.map((a) => ({
          augmentId: a.id,
          slug: a.slug,
          name: { en: a.name },
          rarity: a.rarity,
          pickRate: a.pickRate,
          pickRateRank: a.pickRateRank,
        })),
      },
      combos: { rows: bundled.combos },
    };

    // 6c. An empty/renamed `rows` payload parses as JSON but has no augments:
    // it must be rejected before any write, with the cache still answering.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes('combos') ? apiDocs.combos : { meta: {}, rows: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const empty = await refreshMayhemBundle();
      ok(empty.fromNetwork === false, 'an empty augment payload is rejected (fallback used)');
      ok(empty.bundle.augments.some((a) => a.id === 'stale-marker'), 'the good cache still answers');
      ok(
        fs.readFileSync(cacheFile, 'utf8') === staleText,
        'the rejected payload never overwrote the cache'
      );
    } finally {
      globalThis.fetch = realFetch;
    }

    // 6d. Startup and match start refresh together: one fetch, one cache write.
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const url = String(input);
      const body = url.includes('combos') ? apiDocs.combos : apiDocs.augments;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const [first, second] = await Promise.all([refreshMayhemBundle(), refreshMayhemBundle()]);
      ok(first.fromNetwork && second.fromNetwork, 'both concurrent callers refreshed');
      ok(first.bundle === second.bundle, 'both concurrent callers share one fetched bundle');
      ok(calls === 2, `one request pair for two concurrent refreshes (saw ${calls})`);
      const written = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { augments: unknown[] };
      ok(written.augments.length === bundled.augments.length, 'the fetched payload was cached');
    } finally {
      globalThis.fetch = realFetch;
    }

    // 6e. ALL cache rejections are quarantined. An implausible file used to
    // return a bare null, so every 450-1100 ms OCR tick re-read and re-parsed it
    // for the rest of the match; an unsanitizable one was moved aside but never
    // exercised; JSON that does not parse was a bare `null` as well, so a
    // truncated file was re-read on every tick forever. Each rejection must
    // leave `.bad` behind, let the bundled file answer, and let the refresh
    // policy see a missing cache and rewrite it.
    const badFile = `${cacheFile}.bad`;
    const rejections: Array<{ name: string; payload?: unknown; raw?: string }> = [
      {
        name: 'unsanitizable',
        payload: {
          meta: bundled.meta,
          augments: bundled.augments.slice(0, 60),
          combos: [{ championId: 'x' }],
        },
      },
      {
        name: 'implausible',
        payload: { meta: bundled.meta, augments: bundled.augments.slice(0, 3), combos: [] },
      },
      {
        name: 'malformed',
        raw: '{"meta":{"patch":"x"},"augments":[{"id":"broken"',
      },
    ];
    for (const rejection of rejections) {
      resetMayhemBundleMemoryForTest();
      const badText = rejection.raw ?? JSON.stringify(rejection.payload);
      fs.writeFileSync(cacheFile, badText);

      const loaded = loadMayhemBundle();
      ok(
        !!loaded && loaded.augments.length === bundled.augments.length,
        `${rejection.name} cache: the bundled augments answer`
      );
      ok(!fs.existsSync(cacheFile), `${rejection.name} cache: the rejected file is moved aside`);
      ok(
        fs.existsSync(badFile) && fs.readFileSync(badFile, 'utf8') === badText,
        `${rejection.name} cache: the bad payload is kept in mayhem-bundle.json.bad`
      );

      const badMtime = fs.statSync(badFile).mtimeMs;
      const again = loadMayhemBundle();
      ok(
        !!again && again.augments.length === bundled.augments.length,
        `${rejection.name} cache: the next tick still answers from the bundled file`
      );
      ok(
        fs.statSync(badFile).mtimeMs === badMtime,
        `${rejection.name} cache: the second load does not re-quarantine or re-read .bad`
      );

      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes('combos') ? apiDocs.combos : apiDocs.augments;
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
      try {
        const refreshed = await refreshMayhemBundleIfStale('quarantine-test');
        ok(
          refreshed.reason === 'missing-cache',
          `${rejection.name} cache: the refresh policy sees a missing cache (${refreshed.reason})`
        );
        const rewritten = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { augments: unknown[] };
        ok(
          fs.existsSync(cacheFile) && rewritten.augments.length === bundled.augments.length,
          `${rejection.name} cache: the refresh rewrote the cache`
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    }
  }

  if (failures > 0) {
    console.error(`verify:mayhem-poll-watchdog FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-poll-watchdog ok');
}

void main();
