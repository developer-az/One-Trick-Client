/**
 * Electron adapter for the live coach (`src/logic/coach.ts`).
 *
 * Holds the per-rule cooldown map and converts the engine's pick into the
 * moment-cue shape the overlay already renders. The state map resets on match
 * start (resetMatchCaches) so a new game starts with a clean slate.
 */

import {
    applyCoachCooldowns,
    pickCoachCue,
    type CoachCue,
    type CoachContext,
} from '../src/logic/coach';
import type { GameState, ObjectiveTimers } from '../src/logic/gameState';

/** Shape the overlay's momentCues already consume (see overlayLogic.ts). */
export type CoachMomentCue = Pick<CoachCue, 'id' | 'label' | 'detail' | 'urgency' | 'maxAgeSec'>;

/** Live-payload fallback used when the State Service has no GameState yet. */
export interface CoachFallbackContext {
    gameTime: number;
    level: number;
    isDead: boolean;
    respawnSec: number;
    currentGold: number | null;
    enemies: CoachContext['enemies'];
}

let cooldowns = new Map<string, number>();

export function resetCoachCooldowns(): void {
    cooldowns = new Map();
}

function hpPctFromStats(stats: Record<string, number> | null | undefined): number | null {
    const cur = stats?.currentHealth;
    const max = stats?.maxHealth;
    if (typeof cur !== 'number' || typeof max !== 'number' || !Number.isFinite(cur + max) || max <= 0) {
        return null;
    }
    return Math.max(0, Math.min(1, cur / max));
}

/** Map the app's live payload + objective timers into the coach's context. */
export function coachContextFrom(
    state: GameState | null,
    timers: ObjectiveTimers | null,
    fallback: CoachFallbackContext
): CoachContext | null {
    const self = state?.self;
    const players = state?.players || [];
    const selfRow = players.find((p) => p.isSelf);
    const enemyRows = players.filter((p) => !p.isSelf);

    const gameTime = state?.gameTime ?? fallback.gameTime;
    if (!Number.isFinite(gameTime) || gameTime <= 0) return null;

    return {
        gameTime,
        level: selfRow?.level ?? self?.level ?? fallback.level,
        isDead: selfRow?.isDead ?? fallback.isDead,
        respawnSec: selfRow?.respawnTimer ?? fallback.respawnSec,
        hpPct: self?.hpPct ?? null,
        currentGold: self?.currentGold ?? fallback.currentGold,
        enemies: enemyRows.length
            ? enemyRows.map((p) => ({
                  championName: p.champion,
                  level: p.level,
                  isDead: p.isDead,
                  kills: p.kills,
                  deaths: p.deaths,
              }))
            : fallback.enemies,
        timers: timers ?? { dragon: null, baron: null, herald: null },
    };
}

/**
 * One coach evaluation per overlay tick. Returns at most one cue — the
 * highest-priority rule that is off cooldown — or null.
 */
export function tickCoachCues(
    state: GameState | null,
    timers: ObjectiveTimers | null,
    fallback: CoachFallbackContext
): CoachMomentCue | null {
    const ctx = coachContextFrom(state, timers, fallback);
    if (!ctx) return null;
    const pick = pickCoachCue(ctx, cooldowns);
    cooldowns = applyCoachCooldowns(cooldowns, pick);
    if (!pick) return null;
    return {
        id: pick.cue.id,
        label: pick.cue.label,
        detail: pick.cue.detail,
        urgency: pick.cue.urgency,
        maxAgeSec: pick.cue.maxAgeSec,
    };
}

/** Debug surface for the dashboard: which rules are currently cooling down. */
export function getCoachCooldownState(): Array<{ id: string; lastFiredGameSec: number }> {
    return [...cooldowns.entries()].map(([id, lastFiredGameSec]) => ({ id, lastFiredGameSec }));
}
