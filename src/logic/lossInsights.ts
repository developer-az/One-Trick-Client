import type { GameLike } from './stats';
import { recordAgainst, wilson } from './stats';

export interface LossMatchupInsight {
  enemyChampionId: number;
  games: number;
  wins: number;
  losses: number;
  /** Your win rate in games on this champ vs this enemy. */
  winRate: number;
  low: number;
  high: number;
  /** How often this enemy appeared in your losses on this champ (0–1). */
  lossShare: number;
  avgDeathsWhenLoss: number;
  avgDeathsWhenWin: number;
  hint: string;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Enemies that show up most in losses and where your record vs them is weak.
 * Used to steer loadout/rune prep before queue (not in-game).
 */
export function lossMatchupInsights(
  games: GameLike[],
  championId: number,
  opts: { minGames?: number; limit?: number } = {}
): LossMatchupInsight[] {
  const minGames = opts.minGames ?? 2;
  const limit = opts.limit ?? 6;
  const onChamp = games.filter((g) => g.championId === championId);
  const losses = onChamp.filter((g) => !g.win);
  const wins = onChamp.filter((g) => g.win);
  if (!losses.length) return [];

  const lossCount = new Map<number, number>();
  for (const g of losses) {
    for (const id of g.enemies || []) {
      lossCount.set(id, (lossCount.get(id) || 0) + 1);
    }
  }

  const out: LossMatchupInsight[] = [];
  for (const [enemyChampionId, lossAppearances] of lossCount) {
    const rec = recordAgainst(onChamp, enemyChampionId);
    if (rec.games < minGames) continue;
    const lossShare = lossAppearances / losses.length;
    const deathsInLoss = losses
      .filter((g) => g.enemies?.includes(enemyChampionId))
      .map((g) => g.deaths);
    const deathsInWin = wins
      .filter((g) => g.enemies?.includes(enemyChampionId))
      .map((g) => g.deaths);
    const avgDeathsWhenLoss = avg(deathsInLoss);
    const avgDeathsWhenWin = avg(deathsInWin);

    let hint = 'Prep runes and items for this matchup before queue.';
    if (rec.winRate < 0.4 && rec.games >= 3) {
      hint = 'They have a strong record vs you — counter runes and safer item path.';
    } else if (avgDeathsWhenLoss >= avgDeathsWhenWin + 2 && deathsInLoss.length >= 2) {
      hint = 'Losses vs them are death-heavy — respect all-in windows and defensive stats.';
    } else if (lossShare >= 0.35) {
      hint = 'Shows up in many of your losses on this champ — prioritize their kit in draft.';
    }

    out.push({
      enemyChampionId,
      games: rec.games,
      wins: rec.wins,
      losses: rec.losses,
      winRate: rec.winRate,
      ...wilson(rec.wins, rec.games),
      lossShare,
      avgDeathsWhenLoss,
      avgDeathsWhenWin,
      hint,
    });
  }

  return out
    .sort(
      (a, b) =>
        b.lossShare - a.lossShare ||
        a.winRate - b.winRate ||
        b.losses - a.losses
    )
    .slice(0, limit);
}

export interface ChampLossProfile {
  games: number;
  wins: number;
  losses: number;
  avgKdaLoss: number;
  avgKdaWin: number;
  avgCsPerMinLoss: number;
  avgCsPerMinWin: number;
}

export function championLossProfile(games: GameLike[], championId: number): ChampLossProfile | null {
  const list = games.filter((g) => g.championId === championId);
  if (!list.length) return null;
  const wins = list.filter((g) => g.win);
  const losses = list.filter((g) => !g.win);
  const kda = (g: GameLike) => (g.kills + g.assists) / Math.max(1, g.deaths);
  const csMin = (g: GameLike) => g.cs / Math.max(1, g.durationSec / 60);
  return {
    games: list.length,
    wins: wins.length,
    losses: losses.length,
    avgKdaLoss: avg(losses.map(kda)),
    avgKdaWin: avg(wins.map(kda)),
    avgCsPerMinLoss: avg(losses.map(csMin)),
    avgCsPerMinWin: avg(wins.map(csMin)),
  };
}
