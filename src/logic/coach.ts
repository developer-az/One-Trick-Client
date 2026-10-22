/**
 * Live coach rule engine (pure logic, no Electron / overlay imports).
 *
 * Consumes the same data the rest of the app already extracts — objective
 * respawn timers, enemy state, self gold/HP/level — and emits short,
 * rate-limitable tips. This is the "rule engine first" layer: instant,
 * offline, and honest about what the data supports.
 *
 * Every rule returns the state values that triggered it in `detail`, so a bad
 * tip can be diagnosed from the log without re-playing the game.
 */

import type { ObjectiveTimers } from './gameState';

export type CoachUrgency = 'info' | 'warn' | 'spike';

export interface CoachCue {
  id: string;
  label: string;
  detail: string;
  urgency: CoachUrgency;
  /** How long (seconds) the tip stays relevant once fired. */
  maxAgeSec: number;
  /** Per-rule cooldown (seconds) — two dragon calls must not stack. */
  cooldownSec: number;
}

export interface CoachEnemy {
  championName: string;
  level: number;
  isDead: boolean;
  kills: number;
  deaths: number;
}

export interface CoachContext {
  gameTime: number;
  level: number;
  isDead: boolean;
  /** Respawn seconds remaining while dead, 0 when alive. */
  respawnSec: number;
  /** 0–1, or null when the API did not report health this tick. */
  hpPct: number | null;
  /** Unspent gold, or null. */
  currentGold: number | null;
  enemies: CoachEnemy[];
  timers: ObjectiveTimers;
}

export interface CoachPick {
  cue: CoachCue;
  /** Game-time seconds the rule fired at (for the cooldown map). */
  firedAt: number;
}

/** Tunables in one place — thresholds, not logic. */
export const COACH_CONFIG = {
  /** Objective call window: warn this many seconds before it spawns. */
  objectiveLeadSec: 45,
  /** Gold tiers that justify a recall nudge (early → late game). */
  recallGoldTiers: [900, 1600, 2400, 3400],
  /** Danger thresholds. */
  dangerHpPct: 0.3,
  dangerMinEnemiesAlive: 2,
  /** What counts as a fed enemy (kills minus deaths). */
  fedThreshold: 3,
  /** Spike levels worth a one-shot tip. */
  spikeLevels: [11, 16],
  /** Objective names for labels. */
  objectiveNames: { dragon: 'Dragon', baron: 'Baron', herald: 'Herald' } as const,
} as const;

type ObjectiveKey = keyof typeof COACH_CONFIG.objectiveNames;

const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const aliveEnemies = (enemies: CoachEnemy[]): CoachEnemy[] => enemies.filter((e) => !e.isDead);

/** Highest-value rule wins per slot; lower priority is suppressed. */
const RULE_PRIORITY: Record<string, number> = {
  'coach-respawn-obj': 100,
  'coach-danger': 90,
  'coach-obj-soon': 80,
  'coach-obj-now': 75,
  'coach-numbers': 60,
  'coach-recall': 40,
  'coach-fed': 30,
  'coach-spike': 20,
};

function objectiveCall(timers: ObjectiveTimers, gameTime: number): CoachPick | null {
  // A timer that just came due (within a small grace) means "spawning now".
  for (const key of ['dragon', 'baron', 'herald'] as ObjectiveKey[]) {
    const t = timers[key];
    if (!t) continue;
    const inSec = t.nextSpawnAt - gameTime;
    const name = COACH_CONFIG.objectiveNames[key];
    if (inSec >= 0 && inSec <= COACH_CONFIG.objectiveLeadSec) {
      const spawning = inSec <= 10;
      return {
        firedAt: gameTime,
        cue: {
          id: spawning ? 'coach-obj-now' : 'coach-obj-soon',
          label: spawning ? `${name} spawning` : `${name} in ${fmtClock(inSec)}`,
          detail: spawning
            ? `${name} respawns now — ward and contest as a group.`
            : `${name} up in ${fmtClock(inSec)} — shove your lane and reset before it.`,
          urgency: spawning ? 'spike' : 'warn',
          maxAgeSec: Math.max(12, Math.min(30, Math.round(inSec) + 10)),
          cooldownSec: spawning ? 60 : 90,
        },
      };
    }
  }
  return null;
}

function respawnDisadvantage(
  ctx: CoachContext,
  timers: ObjectiveTimers,
  gameTime: number
): CoachPick | null {
  if (!ctx.isDead || ctx.respawnSec <= 0) return null;
  for (const key of ['dragon', 'baron'] as ObjectiveKey[]) {
    const t = timers[key];
    if (!t) continue;
    const inSec = t.nextSpawnAt - gameTime;
    if (inSec > 0 && inSec <= COACH_CONFIG.objectiveLeadSec && ctx.respawnSec > inSec) {
      const name = COACH_CONFIG.objectiveNames[key];
      return {
        firedAt: gameTime,
        cue: {
          id: 'coach-respawn-obj',
          label: `You miss ${name}`,
          detail: `Respawn ${fmtClock(ctx.respawnSec)} vs ${name} in ${fmtClock(inSec)} — team fights 4v5 or gives it up.`,
          urgency: 'warn',
          maxAgeSec: Math.round(inSec) + 8,
          cooldownSec: 120,
        },
      };
    }
  }
  return null;
}

function dangerCue(ctx: CoachContext, gameTime: number): CoachPick | null {
  if (ctx.isDead || ctx.hpPct === null) return null;
  const alive = aliveEnemies(ctx.enemies);
  if (ctx.hpPct < COACH_CONFIG.dangerHpPct && alive.length >= COACH_CONFIG.dangerMinEnemiesAlive) {
    return {
      firedAt: gameTime,
      cue: {
        id: 'coach-danger',
        label: 'Danger — back off',
        detail: `${Math.round(ctx.hpPct * 100)}% HP with ${alive.length} enemies alive. Reset before you get picked.`,
        urgency: 'spike',
        maxAgeSec: 18,
        cooldownSec: 45,
      },
    };
  }
  return null;
}

function numbersAdvantage(ctx: CoachContext, timers: ObjectiveTimers, gameTime: number): CoachPick | null {
  const dead = ctx.enemies.filter((e) => e.isDead);
  if (dead.length < 2 || ctx.isDead) return null;
  // Only meaningful while no objective timer is racing — otherwise the
  // objective call already covers the moment.
  for (const key of ['dragon', 'baron', 'herald'] as ObjectiveKey[]) {
    const t = timers[key];
    if (t && t.nextSpawnAt - gameTime >= 0 && t.nextSpawnAt - gameTime <= 60) return null;
  }
  const names = dead.map((e) => e.championName).slice(0, 2).join(' + ');
  return {
    firedAt: gameTime,
    cue: {
      id: 'coach-numbers',
      label: `${dead.length} enemies down`,
      detail: `${names} dead — take space, vision or an objective now.`,
      urgency: 'spike',
      maxAgeSec: 22,
      cooldownSec: 60,
    },
  };
}

function recallWindow(ctx: CoachContext, gameTime: number): CoachPick | null {
  if (ctx.isDead || ctx.currentGold === null) return null;
  // Only fire when a gold tier has been crossed since the last recall tip.
  const tier = COACH_CONFIG.recallGoldTiers.findIndex((t) => ctx.currentGold! >= t);
  if (tier < 0) return null;
  return {
    firedAt: gameTime,
    cue: {
      id: 'coach-recall',
      label: `Gold: ${ctx.currentGold}`,
      detail: `${ctx.currentGold}g banked — recall on the next safe window, don't walk it back dead.`,
      urgency: 'info',
      maxAgeSec: 20,
      cooldownSec: 75,
    },
  };
}

function fedEnemyCue(ctx: CoachContext, gameTime: number): CoachPick | null {
  const fed = aliveEnemies(ctx.enemies).find(
    (e) => e.kills - e.deaths >= COACH_CONFIG.fedThreshold
  );
  if (!fed) return null;
  return {
    firedAt: gameTime,
    cue: {
      id: 'coach-fed',
      label: `${fed.championName} is fed`,
      detail: `${fed.championName} is +${fed.kills - fed.deaths} — don't solo him; play for picks with your team.`,
      urgency: 'info',
      maxAgeSec: 30,
      cooldownSec: 180,
    },
  };
}

function spikeCue(ctx: CoachContext, gameTime: number): CoachPick | null {
  const isSpike = (COACH_CONFIG.spikeLevels as readonly number[]).includes(ctx.level);
  if (!isSpike || ctx.isDead) return null;
  return {
    firedAt: gameTime,
    cue: {
      id: 'coach-spike',
      label: `Level ${ctx.level} spike`,
      detail: `Level ${ctx.level} — your next item/ult power window. Look for a fight in the next minute.`,
      urgency: 'info',
      maxAgeSec: 25,
      cooldownSec: 300,
    },
  };
}

/**
 * Evaluate every rule and return the highest-priority pick that is not on
 * cooldown. Pure: the caller owns the cooldown map (gameTime → last fired).
 */
export function pickCoachCue(ctx: CoachContext, cooldowns: Map<string, number>): CoachPick | null {
  const candidates = [
    respawnDisadvantage(ctx, ctx.timers, ctx.gameTime),
    dangerCue(ctx, ctx.gameTime),
    objectiveCall(ctx.timers, ctx.gameTime),
    numbersAdvantage(ctx, ctx.timers, ctx.gameTime),
    recallWindow(ctx, ctx.gameTime),
    fedEnemyCue(ctx, ctx.gameTime),
    spikeCue(ctx, ctx.gameTime),
  ].filter((p): p is CoachPick => !!p);

  const ready = candidates.filter((p) => {
    const last = cooldowns.get(p.cue.id);
    return last === undefined || ctx.gameTime - last >= p.cue.cooldownSec;
  });
  if (!ready.length) return null;

  // Highest-priority ready rule wins the single slot.
  return ready.reduce((best, cur) =>
    (RULE_PRIORITY[cur.cue.id] ?? 0) > (RULE_PRIORITY[best.cue.id] ?? 0) ? cur : best
  );
}

/**
 * Update the cooldown map after a pick is emitted. Returns a new map so
 * callers can keep reset logic trivial.
 */
export function applyCoachCooldowns(
  cooldowns: Map<string, number>,
  pick: CoachPick | null
): Map<string, number> {
  if (!pick) return cooldowns;
  const next = new Map(cooldowns);
  next.set(pick.cue.id, pick.firedAt);
  return next;
}
