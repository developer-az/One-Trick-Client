/**
 * Shared match-loading predicate (dashboard + overlay + tests).
 * Loading ends when the live game clock advances past a small jitter threshold.
 */

export const LIVE_CLOCK_ADVANCE_SEC = 0.25;

export const LOADING_GAMEFLOW_PHASE = 'GameStart';

export interface MatchLoadingInput {
  phase: string | null;
  gameTime?: number | null;
  trustedGameTime?: number;
  /** Match lifecycle engaged (overlay monitor in-game). */
  matchEngaged?: boolean;
}

function clockAdvancing(gameTime: number | null | undefined, trustedGameTime: number): boolean {
  const gt = gameTime ?? 0;
  if (!Number.isFinite(gt) || gt <= 1) return false;
  return gt > trustedGameTime + LIVE_CLOCK_ADVANCE_SEC;
}

/** True during GameStart or while the match is up but the clock has not started moving. */
export function isMatchLoading(input: MatchLoadingInput): boolean {
  if (input.phase === 'Reconnect') return false;
  if (input.phase === LOADING_GAMEFLOW_PHASE) return true;

  const inProgress = input.phase === 'InProgress';
  const engaged = !!input.matchEngaged || inProgress;
  if (!engaged) return false;

  const trusted = input.trustedGameTime ?? 0;
  if (clockAdvancing(input.gameTime, trusted)) return false;
  if (trusted > LIVE_CLOCK_ADVANCE_SEC) return false;
  return inProgress || !!input.matchEngaged;
}