import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { userDataDir } from './paths';
import { overlayLog } from './overlay-log';
import { sanitizeMayhemBundle } from '../src/logic/mayhem/bundleSanitize';
import {
  refreshMayhemBundleIfStale as runMayhemRefreshPolicy,
  slimMayhemFromApi,
  type MayhemBundleMetaLike,
  type MayhemRefreshReason,
} from '../src/logic/mayhem/remote';
import type { MayhemBundle as TypedMayhemBundle } from '../src/logic/mayhem/types';

const AUG_URL = 'https://arammayhem.com/data/v1/latest/augments.json';
const COMBO_URL = 'https://arammayhem.com/data/v1/latest/combos.json';
/** Same patch source the champion catalog uses. */
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
/** The live patch changes at most daily; one lookup is plenty per session/half day. */
const LIVE_PATCH_TTL_MS = 6 * 60 * 60 * 1000;

export type MayhemBundle = {
  meta: {
    patch: string;
    statsDate: string;
    attribution: string;
    source: string;
    syncedAt: string;
  };
  augments: Array<{
    id: string;
    slug: string;
    name: string;
    rarity: string;
    pickRate: number;
    pickRateRank: number;
    tags: string[];
  }>;
  combos: Array<{ championId: string; augmentIds: string[]; types: string[] }>;
};

let memory: MayhemBundle | null = null;

/** A real arammayhem payload has ~160 augments; far fewer means a bad response. */
export const MIN_PLAUSIBLE_AUGMENTS = 50;

/**
 * A payload that may replace the cache or the running data. A renamed/empty
 * `rows` array still parses as JSON but yields zero augments; caching it would
 * disable Mayhem for the session, so it is rejected before any write. `combos`
 * must be an array too: `sanitizeMayhemBundle` iterates it (and each row's
 * `augmentIds`), so a cache with augments but no combos used to throw on the
 * load path instead of falling back to the bundled file.
 */
export function isPlausibleMayhemBundle(bundle: MayhemBundle | null | undefined): boolean {
  return (
    !!bundle &&
    Array.isArray(bundle.augments) &&
    bundle.augments.length >= MIN_PLAUSIBLE_AUGMENTS &&
    Array.isArray(bundle.combos)
  );
}

function cachePath(): string {
  return path.join(userDataDir(), 'mayhem-bundle.json');
}

function bundledPaths(): string[] {
  let root = process.cwd();
  try {
    if (typeof app?.getAppPath === 'function') root = app.getAppPath();
  } catch {
    /* test/CLI harness without Electron: the checkout root is the app root */
  }
  return [
    path.join(root, 'src', 'data', 'mayhem', 'bundle.json'),
    path.join(root, 'dist', 'data', 'mayhem', 'bundle.json'),
  ];
}

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}


function readBundled(): MayhemBundle | null {
  for (const p of bundledPaths()) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as MayhemBundle;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * `loadMayhemBundle()` runs on the OCR tick (450–1100 ms while a shop is open),
 * so a cache the sanitizer rejects must not be re-read, re-parsed and
 * re-sanitized on every tick. Each distinct rejection (reason + detail) is
 * reported once, through the overlay log so a packaged build carries it in
 * overlay.log; a later, different failure of the same reason still surfaces.
 */
const loggedCacheRejections = new Set<string>();

function logCacheRejection(reason: string, detail: Record<string, unknown> = {}): void {
  const key = `${reason}|${JSON.stringify(detail)}`;
  if (loggedCacheRejections.has(key)) return;
  loggedCacheRejections.add(key);
  overlayLog('mayhem-cache-rejected', { reason, ...detail });
}

function badCachePath(): string {
  return `${cachePath()}.bad`;
}

/**
 * Move a cache the sanitizer rejected out of the way. `memory = null` alone
 * would only hide it for one tick: the next `readCache()` re-reads the file,
 * and `readCacheMeta()` would keep reporting it as a valid cache, so the
 * refresh policy saw nothing to repair. Renaming makes the cache genuinely
 * absent (the bundled file wins, and `missing-cache` triggers a re-sync) while
 * keeping the bad payload for diagnosis. A previous `.bad` is replaced.
 */
function quarantineBadCache(): void {
  try {
    fs.rmSync(badCachePath(), { force: true });
    fs.renameSync(cachePath(), badCachePath());
    overlayLog('mayhem-cache-quarantined', { file: badCachePath() });
  } catch (error) {
    // No cache file on disk (the rejection came from the in-memory copy), or
    // the file is locked. Leaving it in place means every OCR tick re-reads and
    // re-rejects it, so the failure must be visible in overlay.log.
    overlayLog('mayhem-cache-quarantine-failed', {
      file: cachePath(),
      error: String(error),
    });
  }
}

/** Why a cache on disk may not be used. Every kind is quarantined. */
export type MayhemCacheRejection = 'implausible' | 'unsanitizable' | 'malformed';

/**
 * One cache read: an accepted (already sanitized) bundle, or the rejection that
 * says why the file must be moved aside. Every rejection returns the file to
 * the bundled fallback and a `missing-cache` refresh: an implausible or
 * unsanitizable bundle, and JSON that does not parse at all (which used to
 * return a bare null and be re-read on every 450-1100 ms OCR tick).
 */
type MayhemCacheRead =
  | { bundle: MayhemBundle; fromFile: boolean }
  | { reason: MayhemCacheRejection; fromFile: boolean };

/** Sanitize a plausible cache bundle; a structural failure is a rejection, not a throw. */
function acceptCacheBundle(bundle: MayhemBundle, fromFile: boolean): MayhemCacheRead {
  try {
    const sanitized = sanitizeMayhemBundle(bundle as TypedMayhemBundle) as MayhemBundle;
    memory = sanitized;
    return { bundle: sanitized, fromFile };
  } catch (error) {
    // A structurally valid-but-broken bundle (e.g. a combo row without
    // augmentIds) must fall back to the bundled file, never throw on the
    // per-tick load path: a rejected hotkey promise / an ocr-poll-error every
    // tick is worse than stale data. Drop the in-memory copy too; the caller
    // quarantines the file when the rejection came from disk.
    memory = null;
    logCacheRejection('unsanitizable-bundle', { error: String(error) });
    return { reason: 'unsanitizable', fromFile };
  }
}

function readCache(): MayhemCacheRead | null {
  if (memory) {
    if (isPlausibleMayhemBundle(memory)) return acceptCacheBundle(memory, false);
    // A truthy-but-empty cache (a bad payload cached by an older build) must
    // not shadow the bundled file for the whole session.
    logCacheRejection('implausible-memory', { augments: memory.augments?.length ?? 0 });
    memory = null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(cachePath(), 'utf8');
  } catch {
    // No cache file at all (first run, or a completed quarantine): not a
    // rejection, the bundled file simply answers.
    return null;
  }
  let parsed: MayhemBundle;
  try {
    parsed = JSON.parse(raw) as MayhemBundle;
  } catch (error) {
    // A truncated/hand-edited JSON file parses nowhere but is re-read by every
    // 450-1100 ms OCR tick. It must be quarantined like an implausible one:
    // bundled data answers, and the refresh policy sees `missing-cache`.
    logCacheRejection('malformed-json', { error: String(error) });
    return { reason: 'malformed', fromFile: true };
  }
  if (!isPlausibleMayhemBundle(parsed)) {
    logCacheRejection('implausible-file', { augments: parsed?.augments?.length ?? 0 });
    return { reason: 'implausible', fromFile: true };
  }
  return acceptCacheBundle(parsed, true);
}

/** Write only a plausible bundle: a bad payload never replaces a good cache. */
function writeCache(bundle: MayhemBundle): boolean {
  if (!isPlausibleMayhemBundle(bundle)) {
    console.warn(
      `[mayhem] refused to cache an implausible bundle (${bundle?.augments?.length ?? 0} augments, need ${MIN_PLAUSIBLE_AUGMENTS})`
    );
    return false;
  }
  memory = bundle;
  // A fresh, accepted bundle earns new rejection reports if it later fails.
  loggedCacheRejections.clear();
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(bundle), 'utf8');
    return true;
  } catch (error) {
    console.warn('[mayhem] cache write failed:', error);
    return false;
  }
}

function normalizeBundle(raw: MayhemBundle | null): MayhemBundle | null {
  if (!isPlausibleMayhemBundle(raw)) return null;
  try {
    return sanitizeMayhemBundle(raw as TypedMayhemBundle) as MayhemBundle;
  } catch (error) {
    // A structurally valid-but-broken bundle (e.g. a combo row without
    // augmentIds) must fall back to the bundled file, never throw on the
    // per-tick load path: a rejected hotkey promise / an ocr-poll-error every
    // tick is worse than stale data. Drop the in-memory copy too; the caller
    // quarantines the file when the rejection came from disk.
    memory = null;
    logCacheRejection('unsanitizable-bundle', { error: String(error) });
    return null;
  }
}

export function loadMayhemBundle(): MayhemBundle | null {
  // A rejected cache falls back to the file shipped with the app instead of
  // leaving the session with no augments at all. Every rejection kind (an
  // implausible shape, a bundle the sanitizer cannot process, or JSON that does
  // not parse) is moved aside, so the OCR tick stops re-reading and re-parsing
  // it.
  const cached = readCache();
  if (cached && 'bundle' in cached) return cached.bundle;
  if (cached) quarantineBadCache();
  return normalizeBundle(readBundled());
}

/**
 * Drop the in-memory copy so the next `loadMayhemBundle()` reads the cache file
 * again. For verify scripts that exercise the quarantine paths in one process.
 */
export function resetMayhemBundleMemoryForTest(): void {
  memory = null;
}

async function fetchBundle(): Promise<MayhemBundle> {
  const [augDoc, comboDoc] = await Promise.all([readJson(AUG_URL), readJson(COMBO_URL)]);
  const bundle = slimMayhemFromApi(augDoc, comboDoc) as MayhemBundle;
  if (!isPlausibleMayhemBundle(bundle)) {
    throw new Error(
      `implausible augment payload (${bundle?.augments?.length ?? 0} augments, need ${MIN_PLAUSIBLE_AUGMENTS})`
    );
  }
  return bundle;
}

export interface MayhemFetchResult {
  bundle: MayhemBundle;
  fromNetwork: boolean;
}

/**
 * One network refresh at a time. Startup and match start both refresh, and two
 * concurrent fetches could race their cache writes (and double the request);
 * every caller in the burst awaits the same promise.
 */
let inFlightFetch: Promise<MayhemFetchResult> | null = null;

function fetchBundleOnce(): Promise<MayhemFetchResult> {
  if (inFlightFetch) return inFlightFetch;
  const load = (async (): Promise<MayhemFetchResult> => {
    const bundle = await fetchBundle();
    writeCache(bundle);
    return { bundle, fromNetwork: true };
  })();
  const shared = load.finally(() => {
    inFlightFetch = null;
  });
  inFlightFetch = shared;
  return shared;
}

export async function refreshMayhemBundle(): Promise<MayhemFetchResult> {
  try {
    return await fetchBundleOnce();
  } catch (error) {
    console.warn('[mayhem] refresh failed:', error);
    const fallback = loadMayhemBundle();
    if (!fallback) throw error;
    return { bundle: fallback, fromNetwork: false };
  }
}

let livePatchLookup: { patch: string | null; at: number } | null = null;

/** Current game patch (Data Dragon head), or null when offline. */
async function currentGamePatch(): Promise<string | null> {
  const now = Date.now();
  if (livePatchLookup && now - livePatchLookup.at < LIVE_PATCH_TTL_MS) return livePatchLookup.patch;
  try {
    const versions = (await readJson(DDRAGON_VERSIONS)) as unknown;
    const patch = Array.isArray(versions) ? String(versions[0] ?? '') : '';
    livePatchLookup = { patch: patch || null, at: now };
  } catch {
    livePatchLookup = { patch: null, at: now };
  }
  return livePatchLookup.patch;
}

/** Meta of the bundle written by a previous refresh — null when no cache exists. */
function readCacheMeta(): MayhemBundleMetaLike | null {
  if (memory) {
    const live = isPlausibleMayhemBundle(memory) ? memory : null;
    if (live) return live.meta;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as MayhemBundle;
    return isPlausibleMayhemBundle(parsed) ? parsed.meta : null;
  } catch {
    return null;
  }
}

/**
 * Follow the live patch: refresh the cached data at app start / match start
 * when the patch moved (or the cache is a day old). Offline is not an error —
 * the cached or bundled bundle keeps working exactly as before.
 */
export async function refreshMayhemBundleIfStale(currentPatch?: string | null): Promise<{
  bundle: MayhemBundle | null;
  refreshed: boolean;
  reason: MayhemRefreshReason;
}> {
  const existing = loadMayhemBundle();
  const meta = readCacheMeta();
  const patch = currentPatch ?? (await currentGamePatch());
  const result = await runMayhemRefreshPolicy<MayhemBundle>({
    cached: meta,
    currentPatch: patch,
    existing,
    nowMs: Date.now(),
    fetchBundle: async () => (await fetchBundleOnce()).bundle,
  });
  if (result.error) console.warn('[mayhem] stale refresh kept cached data:', result.error);
  return {
    bundle: result.bundle ?? loadMayhemBundle(),
    refreshed: result.refreshed,
    reason: result.decision.reason,
  };
}
