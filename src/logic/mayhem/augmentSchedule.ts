/** Mayhem augment selection happens at these champion levels. */
export const MAYHEM_AUGMENT_LEVELS = [3, 7, 11, 15] as const;

export type MayhemOcrCadence = 'off' | 'snooze' | 'warmup' | 'burst';

const BURST_MS = 52_000;
const WARMUP_XP = 0.55;
const BURST_XP = 0.72;

function stat(stats: Record<string, number>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = stats[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** 0–1 progress toward next level from Live Client championStats, when exposed. */
export function xpProgressToNextLevel(championStats?: Record<string, number> | null): number | null {
  if (!championStats) return null;
  const cur = stat(championStats, ['experience', 'currentXP', 'Experience', 'xp']);
  const need = stat(championStats, [
    'experienceToNextLevel',
    'xpForNextLevel',
    'ExperienceRequired',
    'experienceRequired',
  ]);
  if (cur == null || need == null || need <= 0) return null;
  return Math.max(0, Math.min(1, cur / need));
}

function levelBeforeAugment(level: number): number | null {
  for (const pick of MAYHEM_AUGMENT_LEVELS) {
    if (level === pick - 1) return pick;
  }
  return null;
}

export function isMayhemAugmentLevel(level: number): boolean {
  return (MAYHEM_AUGMENT_LEVELS as readonly number[]).includes(level);
}

export interface MayhemOcrScheduleInput {
  level: number;
  previousLevel: number;
  championStats?: Record<string, number> | null;
  gameTime: number;
  nowMs: number;
  burstUntilMs: number;
}

export interface MayhemOcrScheduleResult {
  cadence: MayhemOcrCadence;
  burstUntilMs: number;
  /** Suggested minimum ms between OCR attempts. */
  intervalMs: number;
  reason: string;
}

/**
 * Level-up sensor + XP bar: burst OCR around 3 / 7 / 11 / 15 picks,
 * warm up as you approach the next augment level, snooze otherwise.
 */
export function planMayhemOcr(input: MayhemOcrScheduleInput): MayhemOcrScheduleResult {
  const { level, previousLevel, championStats, nowMs, burstUntilMs } = input;
  let nextBurst = burstUntilMs;

  if (isMayhemAugmentLevel(level) && level > previousLevel) {
    nextBurst = nowMs + BURST_MS;
    return {
      cadence: 'burst',
      burstUntilMs: nextBurst,
      intervalMs: 1100,
      reason: `Level ${level} augment pick`,
    };
  }

  if (nowMs < burstUntilMs) {
    return {
      cadence: 'burst',
      burstUntilMs: nextBurst,
      intervalMs: 1100,
      reason: 'Augment window',
    };
  }

  const xp = xpProgressToNextLevel(championStats);
  const nextPick = levelBeforeAugment(level);
  if (nextPick != null && xp != null) {
    if (xp >= BURST_XP) {
      nextBurst = nowMs + BURST_MS;
      return {
        cadence: 'burst',
        burstUntilMs: nextBurst,
        intervalMs: 1100,
        reason: `~${Math.round(xp * 100)}% to L${nextPick}`,
      };
    }
    if (xp >= WARMUP_XP) {
      return {
        cadence: 'warmup',
        burstUntilMs: nextBurst,
        intervalMs: 3200,
        reason: `Closing on L${nextPick}`,
      };
    }
  }

  // Early game: first augment approaches quickly even without XP stats.
  if (level <= 2 && input.gameTime > 45 && input.gameTime < 240) {
    return {
      cadence: 'warmup',
      burstUntilMs: nextBurst,
      intervalMs: 3500,
      reason: 'Early L3 window',
    };
  }

  return {
    cadence: 'snooze',
    burstUntilMs: nextBurst,
    intervalMs: 12_000,
    reason: 'Between picks',
  };
}
