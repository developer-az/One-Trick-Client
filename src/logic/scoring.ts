/**
 * Phase 2 — Brilliant scoring engine (pure logic, no Electron/UI imports).
 *
 * Inputs are the pre-fight and post-event GameState slices plus the triggering
 * event, all normalised by the state engine. Outputs a weighted score, a label
 * (Brilliant / Great / Good) and the reasons that earned it — the overlay and
 * the post-game review render those strings verbatim.
 *
 * Everything that tunes the engine lives in `SCORING_CONFIG` so tuning is one
 * object, never a code change.
 */

/** Weights and thresholds. Tune here, not in the scoring logic. */
export interface ScoringConfig {
  baseKill: number;
  lowHpVictimFullHp: number;
  outnumbered: number;
  multiKill: { double: number; triple: number; quadra: number; penta: number };
  objectiveSteal: number;
  shutdown: number;
  towerDiveSurvive: number;
  spellAssist: number;
  thresholds: { brilliant: number; great: number };
  /** Human-readable reason strings, indexed by rule name. */
  reasons: {
    lowHpVictimFullHp: string;
    outnumbered: string;
    multiKill: (n: number) => string;
    objectiveSteal: string;
    shutdown: string;
    towerDiveSurvive: string;
    spellAssist: (spell: string) => string;
  };
}

export const SCORING_CONFIG: ScoringConfig = {
  baseKill: 10,
  lowHpVictimFullHp: 60,
  outnumbered: 30,
  multiKill: { double: 20, triple: 35, quadra: 60, penta: 100 },
  objectiveSteal: 50,
  shutdown: 20,
  towerDiveSurvive: 25,
  spellAssist: 15,
  thresholds: { brilliant: 70, great: 45 },
  reasons: {
    lowHpVictimFullHp: 'Low-HP turnaround',
    outnumbered: 'Fought outnumbered',
    multiKill: (n) => `${n}x multi-kill`,
    objectiveSteal: 'Objective steal',
    shutdown: 'Shutdown on a fed enemy',
    towerDiveSurvive: 'Tower-dive survival',
    spellAssist: (spell) => `Secured with ${spell}`,
  },
};

/** Kill/assistance context the scoring engine needs, drawn from GameState. */
export interface ScoringContext {
  /** Pre-fight self HP percent, 0–1, or null if unavailable. */
  prevSelfHpPct: number | null;
  /** Post-event self HP percent, 0–1, or null if unavailable. */
  nextSelfHpPct: number | null;
  /** Victim's HP percent at the moment of death, 0–1, or null. */
  victimHpPct: number | null;
  /** Victim's bounty in gold, or null. */
  victimBounty: number | null;
  /** Whether the victim had a shutdown bounty (kills without dying recently). */
  victimWasFed: boolean;
  /** Number of enemies near the fight, from minimap or visibility. */
  enemiesNear: number;
  /** Number of allies near the fight (excluding self). */
  alliesNear: number;
  /** Number of towers near the fight, for tower-dive detection. */
  towersNear: number;
  /** Seconds survived after the kill; null if still fighting. */
  survivedSec: number | null;
  /** Spell cast within the kill window, e.g. 'Flash' or 'R'. */
  spellCastInWindow: string | null;
  /** Number of kills within the multi-kill window (1 = single). */
  killStreak: number;
  /** True if this kill was an objective (dragon/baron/herald) and stolen. */
  objectiveStolen: boolean;
}

export type PlayLabel = 'Brilliant' | 'Great' | 'Good';

export interface ScoringResult {
  score: number;
  label: PlayLabel;
  reasons: string[];
}

/** Score a single play from a fight-start and post-event context. */
export function scorePlay(ctx: ScoringContext, config: ScoringConfig = SCORING_CONFIG): ScoringResult {
  let score = config.baseKill;
  const reasons: string[] = [];

  // Rule 1: Low-HP turnaround — self was <30% at fight start, victim was near full.
  if (
    ctx.prevSelfHpPct !== null &&
    ctx.prevSelfHpPct < 0.3 &&
    ctx.victimHpPct !== null &&
    ctx.victimHpPct > 0.6
  ) {
    score += config.lowHpVictimFullHp;
    reasons.push(config.reasons.lowHpVictimFullHp);
  }

  // Rule 2: Outnumbered — 2+ enemies near, 0 allies near.
  if (ctx.enemiesNear >= 2 && ctx.alliesNear === 0) {
    score += config.outnumbered;
    reasons.push(config.reasons.outnumbered);
  }

  // Rule 3: Multi-kill.
  if (ctx.killStreak >= 2) {
    const key =
      ctx.killStreak >= 5 ? 'penta' : ctx.killStreak === 4 ? 'quadra' : ctx.killStreak === 3 ? 'triple' : 'double';
    score += config.multiKill[key];
    reasons.push(config.reasons.multiKill(ctx.killStreak));
  }

  // Rule 4: Objective steal.
  if (ctx.objectiveStolen) {
    score += config.objectiveSteal;
    reasons.push(config.reasons.objectiveSteal);
  }

  // Rule 5: Shutdown on a fed enemy (bounty >= 500 gold).
  if (ctx.victimWasFed || (ctx.victimBounty !== null && ctx.victimBounty >= 500)) {
    score += config.shutdown;
    reasons.push(config.reasons.shutdown);
  }

  // Rule 6: Tower-dive and survive >3s after.
  if (ctx.towersNear > 0 && ctx.survivedSec !== null && ctx.survivedSec > 3) {
    score += config.towerDiveSurvive;
    reasons.push(config.reasons.towerDiveSurvive);
  }

  // Rule 7: Kill within spell-cast window (Flash or ultimate).
  if (ctx.spellCastInWindow) {
    score += config.spellAssist;
    reasons.push(config.reasons.spellAssist(ctx.spellCastInWindow));
  }

  const label: PlayLabel =
    score >= config.thresholds.brilliant ? 'Brilliant' : score >= config.thresholds.great ? 'Great' : 'Good';

  return { score, label, reasons };
}
