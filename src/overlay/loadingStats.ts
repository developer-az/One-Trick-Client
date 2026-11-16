/**
 * Recent-form fold for the pre-match loading card.
 *
 * Pure and electron-free so the monitor (one fetch per load) and the verifier
 * share exactly one implementation. Input games are newest-first, as
 * electron/match-history returns them; `form` is emitted oldest → newest so the
 * 10-segment bar reads left (older) to right (latest).
 */

export type LoadingForm = 'W' | 'L';

/** Which slice the numbers came from, so the card can label them honestly. */
export type LoadingScope = 'ranked' | 'rift';

export interface LoadingStats {
  /** Games on this champion in the scope below (ranked first, then Rift). */
  games: number;
  /** 0–100, rounded. */
  winRate: number;
  /** "W4" / "L2" — the current run at the newest end, or null with no games. */
  streak: string | null;
  /** (kills + assists) / max(1, deaths), two decimals. */
  kda: number;
  /** Up to the newest 10 results, oldest first. */
  form: LoadingForm[];
  /** null only when there are no games at all. */
  scope: LoadingScope | null;
}

export interface LoadingMatchLike {
  championId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** LCU queue id. Missing is treated as a Rift game (callers already filter). */
  queueId?: number;
}

/** Ranked solo (420) and ranked flex (440). */
export const RANKED_QUEUES = new Set([420, 440]);
/** Summoner's Rift queues, mirroring electron/match-history's RIFT_QUEUES. */
export const RIFT_QUEUES = new Set([400, 420, 430, 440, 480, 490]);

/** The card's form bar is 10 segments. */
export const FORM_SEGMENTS = 10;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeLoadingStats(
  matches: ReadonlyArray<LoadingMatchLike> | null | undefined,
  championId: number | null | undefined
): LoadingStats {
  const empty: LoadingStats = { games: 0, winRate: 0, streak: null, kda: 0, form: [], scope: null };
  if (!Array.isArray(matches) || typeof championId !== 'number' || !Number.isFinite(championId)) {
    return empty;
  }
  const onChampion = matches.filter((match) => !!match && match.championId === championId);
  if (onChampion.length === 0) return empty;

  // Ranked first: the card is a ranked form line. With no ranked game on this
  // champion, fall back to the whole Rift window (the history source is already
  // Rift-only; an absent queueId counts as Rift for fixture callers).
  const ranked = onChampion.filter(
    (game): boolean => typeof game.queueId === 'number' && RANKED_QUEUES.has(game.queueId)
  );
  const scoped =
    ranked.length > 0
      ? ranked
      : onChampion.filter(
          (game) => typeof game.queueId !== 'number' || RIFT_QUEUES.has(game.queueId)
        );
  if (scoped.length === 0) return empty;
  const scope: LoadingScope = ranked.length > 0 ? 'ranked' : 'rift';

  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  for (const game of scoped) {
    if (game.win) wins += 1;
    kills += count(game.kills);
    deaths += count(game.deaths);
    assists += count(game.assists);
  }

  // games[] is newest-first: the streak runs from the newest result.
  const streakMark: LoadingForm = scoped[0].win ? 'W' : 'L';
  let streakLength = 0;
  while (streakLength < scoped.length && (scoped[streakLength].win ? 'W' : 'L') === streakMark) {
    streakLength += 1;
  }

  const form = scoped
    .slice(0, FORM_SEGMENTS)
    .map((game): LoadingForm => (game.win ? 'W' : 'L'))
    .reverse();

  return {
    games: scoped.length,
    winRate: Math.round((wins / scoped.length) * 100),
    streak: `${streakMark}${streakLength}`,
    kda: Math.round(((kills + assists) / Math.max(1, deaths)) * 100) / 100,
    form,
    scope,
  };
}
