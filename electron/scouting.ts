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
const cache = new Map<string, { at: number; value: ScoutingPlayer }>();

function cachePath(): string {
  return path.join(app.getPath('userData'), 'scouting-cache.json');
}

function loadDiskCache(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Record<string, { at: number; value: ScoutingPlayer }>;
    for (const [k, v] of Object.entries(raw)) {
      if (v?.at && v.value) cache.set(k, v);
    }
  } catch {
    /* cold */
  }
}

function flushDiskCache(): void {
  try {
    const out: Record<string, { at: number; value: ScoutingPlayer }> = {};
    for (const [k, v] of cache.entries()) out[k] = v;
    fs.writeFileSync(cachePath(), JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

let diskLoaded = false;

function ensureCache(): void {
  if (!diskLoaded) {
    diskLoaded = true;
    loadDiskCache();
  }
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

async function recentFormFor(puuid: string): Promise<{ wins: number; games: number }> {
  try {
    const ids = (await makeLCURequest('GET', `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=5`)) as {
      games?: { games?: Array<{ json?: { participants?: Array<{ puuid?: string; stats?: { win?: boolean } }> } }> };
    };
    const games = ids?.games?.games || [];
    let wins = 0;
    let n = 0;
    for (const g of games) {
      const me = g.json?.participants?.find((p) => p.puuid === puuid);
      if (!me) continue;
      n++;
      if (me.stats?.win) wins++;
    }
    return { wins, games: n };
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
  const roster = parseChampSelectScoutingSession(session);
  const out: ScoutingPlayer[] = [];
  for (const row of roster) {
    const key = `${row.summonerId}:${row.championId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
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
    out.push(value);
  }
  flushDiskCache();
  return out;
}