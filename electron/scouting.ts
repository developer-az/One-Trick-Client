import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { makeLCURequest } from './lcu-connector';

export interface ScoutingPlayer {
  summonerId: number;
  championId: number;
  teamId: number;
  rankTier?: string | null;
  rankDivision?: string | null;
  masteryLevel?: number | null;
  recentWins?: number;
  recentGames?: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const DISK_WRITE_DEBOUNCE_MS = 5000;

interface CacheEntry {
  at: number;
  value: ScoutingPlayer;
}

const cache = new Map<string, CacheEntry>();
let diskLoaded = false;
let diskWriteTimer: ReturnType<typeof setTimeout> | null = null;

function cachePath(): string {
  return path.join(app.getPath('userData'), 'scouting-cache.json');
}

function isExpired(entry: CacheEntry | undefined, now = Date.now()): boolean {
  return !entry || !Number.isFinite(entry.at) || now - entry.at >= CACHE_TTL_MS;
}

/** Drop expired rows, then keep the newest CACHE_MAX_ENTRIES by fetchedAt. */
function pruneCache(now = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of cache) {
    if (isExpired(entry, now)) {
      cache.delete(key);
      removed++;
    }
  }
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    const drop = cache.size - CACHE_MAX_ENTRIES;
    for (let i = 0; i < drop; i++) cache.delete(oldest[i][0]);
    removed += drop;
  }
  return removed;
}

function loadDiskCache(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry?.value && !isExpired(entry, now)) cache.set(key, entry);
    }
    pruneCache(now);
  } catch {
    /* cold */
  }
}

function cacheSnapshot(): Record<string, CacheEntry> {
  const out: Record<string, CacheEntry> = {};
  for (const [key, entry] of cache.entries()) out[key] = entry;
  return out;
}

async function writeDiskCache(): Promise<void> {
  pruneCache();
  await fs.promises.writeFile(cachePath(), JSON.stringify(cacheSnapshot()));
}

function writeDiskCacheSync(): void {
  pruneCache();
  fs.writeFileSync(cachePath(), JSON.stringify(cacheSnapshot()));
}

function scheduleDiskFlush(): void {
  if (diskWriteTimer) return;
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    void writeDiskCache().catch(() => {
      /* ignore: cache is optional */
    });
  }, DISK_WRITE_DEBOUNCE_MS);
}

/** Flush pending cache writes immediately (async path used by tests/tools). */
export async function flushScoutingCache(): Promise<void> {
  if (diskWriteTimer) {
    clearTimeout(diskWriteTimer);
    diskWriteTimer = null;
  }
  try {
    await writeDiskCache();
  } catch {
    /* ignore: cache is optional */
  }
}

function ensureCache(): void {
  if (!diskLoaded) {
    diskLoaded = true;
    loadDiskCache();
  }
}

// Electron's app object is unavailable when this module is imported by the
// node-based verify scripts, so only register the quit hook when it exists.
if (typeof app?.on === 'function') {
  app.on('will-quit', () => {
    if (diskWriteTimer) {
      clearTimeout(diskWriteTimer);
      diskWriteTimer = null;
    }
    try {
      writeDiskCacheSync();
    } catch {
      /* ignore: cache is optional */
    }
  });
}

async function rankedFor(summonerId: number): Promise<{ tier: string | null; division: string | null }> {
  try {
    const res = (await makeLCURequest(
      'GET',
      `/lol-ranked/v1/ranked-stats/${summonerId}`
    )) as { queues?: Array<{ queueType?: string; tier?: string; division?: string }> };
    const solo = (res?.queues || []).find((q) => q.queueType === 'RANKED_SOLO_5x5');
    return { tier: solo?.tier ?? null, division: solo?.division ?? null };
  } catch {
    return { tier: null, division: null };
  }
}

async function masteryFor(summonerId: number, championId: number): Promise<number | null> {
  try {
    const res = (await makeLCURequest(
      'GET',
      `/lol-collections/v1/inventories/${summonerId}/champion-mastery/${championId}`
    )) as { championLevel?: number };
    return typeof res?.championLevel === 'number' ? res.championLevel : null;
  } catch {
    return null;
  }
}

interface LCUMatchParticipant {
  participantId?: number | string;
  puuid?: string;
  stats?: { win?: boolean };
}

interface LCUMatchIdentity {
  participantId?: number | string;
  player?: { puuid?: string };
}

interface LCUMatchGameJson {
  participants?: LCUMatchParticipant[];
  participantIdentities?: LCUMatchIdentity[];
}

function sameParticipantId(a: number | string | undefined, b: number | string | undefined): boolean {
  return a !== undefined && b !== undefined && String(a) === String(b);
}

/**
 * LCU match history keeps identity in participantIdentities[].player.puuid and
 * links it to participants[] by participantId. Some older/other payloads do
 * put puuid directly on the participant, so accept that as a fallback too.
 */
function participantForPuuid(
  game: LCUMatchGameJson | undefined,
  puuid: string
): LCUMatchParticipant | undefined {
  const participants = game?.participants || [];
  const identity = (game?.participantIdentities || []).find((row) => row?.player?.puuid === puuid);
  if (identity) {
    const linked = participants.find((row) => sameParticipantId(row.participantId, identity.participantId));
    if (linked) return linked;
  }
  return participants.find((row) => row.puuid === puuid);
}

/** Pure recent-form fold over an LCU match-history response. */
export function recentFormFromMatchHistory(
  history: unknown,
  puuid: string
): { wins: number; games: number } {
  const games =
    (history as { games?: { games?: Array<{ json?: LCUMatchGameJson }> } } | null)?.games?.games || [];
  let wins = 0;
  let n = 0;
  for (const game of games) {
    const me = participantForPuuid(game?.json, puuid);
    if (!me) continue;
    n++;
    if (me.stats?.win) wins++;
  }
  return { wins, games: n };
}

async function recentFormFor(puuid: string): Promise<{ wins: number; games: number }> {
  try {
    const history = await makeLCURequest(
      'GET',
      `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=5`
    );
    return recentFormFromMatchHistory(history, puuid);
  } catch {
    return { wins: 0, games: 0 };
  }
}

export function parseChampSelectScoutingSession(session: unknown): Array<{ summonerId: number; championId: number; teamId: number; puuid?: string }> {
  if (!session || typeof session !== 'object') return [];
  const myTeam = (session as { myTeam?: Array<Record<string, unknown>> }).myTeam || [];
  const theirTeam = (session as { theirTeam?: Array<Record<string, unknown>> }).theirTeam || [];
  const rows = [...myTeam, ...theirTeam];
  const out: Array<{ summonerId: number; championId: number; teamId: number; puuid?: string }> = [];
  for (const row of rows) {
    const summonerId = Number(row.summonerId);
    const championId = Number(row.championId);
    const teamId = Number(row.team);
    if (!summonerId || !championId) continue;
    out.push({
      summonerId,
      championId,
      teamId,
      puuid: typeof row.puuid === 'string' ? row.puuid : undefined,
    });
  }
  return out;
}

export async function fetchScoutingForSession(session: unknown): Promise<ScoutingPlayer[]> {
  ensureCache();
  let dirty = pruneCache() > 0;
  const roster = parseChampSelectScoutingSession(session);
  const out: ScoutingPlayer[] = [];
  for (const row of roster) {
    const key = `${row.summonerId}:${row.championId}`;
    const hit = cache.get(key);
    if (hit && !isExpired(hit)) {
      out.push(hit.value);
      continue;
    }
    const ranked = await rankedFor(row.summonerId);
    const mastery = await masteryFor(row.summonerId, row.championId);
    const form = row.puuid ? await recentFormFor(row.puuid) : { wins: 0, games: 0 };
    const value: ScoutingPlayer = {
      summonerId: row.summonerId,
      championId: row.championId,
      teamId: row.teamId,
      rankTier: ranked.tier,
      rankDivision: ranked.division,
      masteryLevel: mastery,
      recentWins: form.wins,
      recentGames: form.games,
    };
    cache.set(key, { at: Date.now(), value });
    dirty = true;
    out.push(value);
  }
  const pruned = pruneCache() > 0;
  if (dirty || pruned) scheduleDiskFlush();
  return out;
}