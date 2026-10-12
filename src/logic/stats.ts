/**
 * Aggregates over your own recent games. Win rates come with a Wilson score
 * interval so a 3-0 record reads as "small sample", not "100%".
 */

export interface GameLike {
  championId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  durationSec: number;
  role: string | null;
  enemies?: number[];
  laneOpponent?: number | null;
}

export interface Record_ {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  /** 95% Wilson interval for the true win rate. */
  low: number;
  high: number;
}

export interface ChampionStats extends Record_ {
  championId: number;
  /** (K + A) / max(1, D) over all games. */
  kda: number;
  csPerMin: number;
  mainRole: string | null;
}

/** Wilson score interval, z = 1.96. */
export function wilson(wins: number, games: number, z = 1.96): { low: number; high: number } {
  if (games <= 0) return { low: 0, high: 1 };
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

export function record(games: GameLike[]): Record_ {
  const wins = games.filter((g) => g.win).length;
  const n = games.length;
  return { games: n, wins, losses: n - wins, winRate: n ? wins / n : 0, ...wilson(wins, n) };
}

function mode(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
  return best;
}

export function byChampion(games: GameLike[]): ChampionStats[] {
  const groups = new Map<number, GameLike[]>();
  for (const g of games) groups.set(g.championId, [...(groups.get(g.championId) || []), g]);
  return [...groups.entries()]
    .map(([championId, list]) => {
      const k = list.reduce((s, g) => s + g.kills, 0);
      const d = list.reduce((s, g) => s + g.deaths, 0);
      const a = list.reduce((s, g) => s + g.assists, 0);
      const cs = list.reduce((s, g) => s + g.cs, 0);
      const minutes = list.reduce((s, g) => s + g.durationSec, 0) / 60;
      return {
        championId,
        ...record(list),
        kda: (k + a) / Math.max(1, d),
        csPerMin: minutes > 0 ? cs / minutes : 0,
        mainRole: mode(list.map((g) => g.role)),
      };
    })
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
}

/** Your record in games where `enemyId` was on the other team (optionally as your lane opponent). */
export function recordAgainst(games: GameLike[], enemyId: number, opts: { championId?: number; laneOnly?: boolean } = {}): Record_ {
  return record(
    games.filter(
      (g) =>
        (opts.championId === undefined || g.championId === opts.championId) &&
        (opts.laneOnly ? g.laneOpponent === enemyId : !!g.enemies?.includes(enemyId))
    )
  );
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
