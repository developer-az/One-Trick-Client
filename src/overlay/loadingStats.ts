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

/* ------------------------------------------------------- the loading card */
/*
 * The card is present for the whole load, so its content has four states and
 * the overlay needs one decision, not four conditionals in JSX.
 */

export type LoadingCardState = 'ready' | 'first' | 'pending' | 'neutral';

/**
 * What the card shows right now:
 *  - ready:   games on this champion in the current scope;
 *  - first:   the history loaded and holds no game on this champion;
 *  - pending: the champion is known but its history has not landed yet;
 *  - neutral: nothing is known at all (no pick, no history).
 */
export function loadingCardState(
  championName: string | null | undefined,
  stats: LoadingStats | null | undefined
): LoadingCardState {
  const named = typeof championName === 'string' && championName.trim().length > 0;
  if (stats) return stats.games > 0 ? 'ready' : 'first';
  return named ? 'pending' : 'neutral';
}

/** Fields the overlay must not lose while one load is drawing. */
export interface LoadingCarryOver {
  loading?: boolean;
  championId?: number | null;
  championName?: string | null;
  loadingStats?: LoadingStats | null;
}

/**
 * Keep the champion and its stats for the duration of one load. Payloads
 * replace the overlay state wholesale, so a later payload that omits the stats
 * (a partial send, a replay of an older tick) would blank the card mid-load.
 * Only a completed pick swap drops the old numbers, and leaving the load
 * (`loading` false) drops everything as before.
 */
export function mergeLoadingPayload<T extends LoadingCarryOver>(
  prev: T | null | undefined,
  next: T
): T {
  if (!next.loading || !prev || !prev.loading) return next;
  const nextId = typeof next.championId === 'number' ? next.championId : null;
  const prevId = typeof prev.championId === 'number' ? prev.championId : null;
  const samePick = nextId === null || prevId === null || nextId === prevId;
  const championId = nextId ?? prev.championId ?? null;
  const championName =
    typeof next.championName === 'string' && next.championName.trim().length > 0
      ? next.championName
      : prev.championName ?? null;
  const loadingStats = next.loadingStats ?? (samePick ? prev.loadingStats ?? null : null);
  return { ...next, championId, championName, loadingStats };
}
