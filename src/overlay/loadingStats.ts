/**
 * Recent-form fold for the pre-match loading card.
 *
 * Pure and electron-free so the monitor (one fetch per load) and the verifier
 * share exactly one implementation. Input games are newest-first, as
 * electron/match-history returns them; `form` is emitted oldest → newest so the
 * 10-segment bar reads left (older) to right (latest).
 */

export type LoadingForm = 'W' | 'L';

export interface LoadingStats {
  /** Rift games on this champion in the fetched history window. */
  games: number;
  /** 0–100, rounded. */
  winRate: number;
  /** "W4" / "L2" — the current run at the newest end, or null with no games. */
  streak: string | null;
  /** (kills + assists) / max(1, deaths), two decimals. */
  kda: number;
  /** Up to the newest 10 results, oldest first. */
  form: LoadingForm[];
}

export interface LoadingMatchLike {
  championId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

/** The card's form bar is 10 segments. */
export const FORM_SEGMENTS = 10;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeLoadingStats(
  matches: ReadonlyArray<LoadingMatchLike> | null | undefined,
  championId: number | null | undefined
): LoadingStats {
  const empty: LoadingStats = { games: 0, winRate: 0, streak: null, kda: 0, form: [] };
  if (!Array.isArray(matches) || typeof championId !== 'number' || !Number.isFinite(championId)) {
    return empty;
  }
  const games = matches.filter((match) => !!match && match.championId === championId);
  if (games.length === 0) return empty;

  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  for (const game of games) {
    if (game.win) wins += 1;
    kills += count(game.kills);
    deaths += count(game.deaths);
    assists += count(game.assists);
  }

  // games[] is newest-first: the streak runs from the newest result.
  const streakMark: LoadingForm = games[0].win ? 'W' : 'L';
  let streakLength = 0;
  while (streakLength < games.length && (games[streakLength].win ? 'W' : 'L') === streakMark) {
    streakLength += 1;
  }

  const form = games
    .slice(0, FORM_SEGMENTS)
    .map((game): LoadingForm => (game.win ? 'W' : 'L'))
    .reverse();

  return {
    games: games.length,
    winRate: Math.round((wins / games.length) * 100),
    streak: `${streakMark}${streakLength}`,
    kda: Math.round(((kills + assists) / Math.max(1, deaths)) * 100) / 100,
    form,
  };
}
