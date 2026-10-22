import { inferSituation } from './situation';
import { scorePlay, type ScoringContext, type PlayLabel } from './scoring';

export interface PlayMomentCue {
  id: string;
  label: string;
  detail: string;
  urgency: 'info' | 'warn' | 'spike';
  maxAgeSec?: number;
}

/** Minimal live state for moment detection (keeps electron build free of overlay UI imports). */
export interface PlayOverlayState {
  inGame: boolean;
  gameTime?: number;
  localPlayer?: {
    championName: string;
    level: number;
    isDead: boolean;
    /** 0–1, from GameState. Optional so old callers still compile. */
    hpPct?: number | null;
    scores?: { kills?: number; deaths?: number; assists?: number };
    summonerSpells?: {
      summonerSpellOne?: { displayName: string };
      summonerSpellTwo?: { displayName: string };
    };
  } | null;
  enemies?: Array<{
    championName: string;
    level?: number;
    isDead?: boolean;
    /** 0–1, from GameState. */
    hpPct?: number | null;
    /** Current bounty gold. */
    bounty?: number | null;
    scores?: { kills?: number; deaths?: number; assists?: number };
  }>;
  /** Number of enemies near the fight (from minimap/vision). */
  enemiesNear?: number;
  /** Number of allies near the fight (excluding self). */
  alliesNear?: number;
  /** Number of towers near the fight. */
  towersNear?: number;
  /** Seconds survived after the last kill, if known. */
  survivedSec?: number | null;
  /** Spell cast within the kill window (e.g. 'Flash'). */
  spellCastInWindow?: string | null;
  /** Kills within the multi-kill window. */
  killStreak?: number;
  /** True if the triggering objective was stolen. */
  objectiveStolen?: boolean;
  enemyBotSummoners?: Array<{
    role: string;
    championName: string;
    spells: Array<{ name: string; short: string; ready: boolean; remaining: number }>;
  }>;
}

export type PlayMomentKind = 'blunder' | 'brilliant' | 'enemy';

export interface PlayRecapEntry {
  gameTime: number;
  kind: PlayMomentKind;
  label: string;
  detail: string;
  hint?: string;
  /** Phase 2 — weighted score + label from the scoring engine. */
  score?: number;
  playLabel?: PlayLabel;
  reasons?: string[];
}

export interface PlayMomentSnapshot {
  gameTime: number;
  localDeaths: number;
  localKills: number;
  localAssists: number;
  localDead: boolean;
  localLevel: number;
  enemyDeaths: Map<string, number>;
}

export function snapshotFromState(state: PlayOverlayState): PlayMomentSnapshot | null {
  if (!state.inGame || !state.localPlayer) return null;
  const scores = state.localPlayer.scores;
  const enemyDeaths = new Map<string, number>();
  for (const e of state.enemies || []) {
    if (e.isDead) enemyDeaths.set(e.championName, (enemyDeaths.get(e.championName) || 0) + 1);
  }
  return {
    gameTime: state.gameTime ?? 0,
    localDeaths: scores?.deaths ?? 0,
    localKills: scores?.kills ?? 0,
    localAssists: scores?.assists ?? 0,
    localDead: state.localPlayer.isDead,
    localLevel: state.localPlayer.level ?? 1,
    enemyDeaths,
  };
}

function momentCue(id: string, label: string, urgency: PlayMomentCue['urgency'], maxAgeSec = 18): PlayMomentCue {
  const t = label.replace(/\s+/g, ' ').trim();
  return {
    id,
    label: t.length <= 18 ? t : `${t.slice(0, 16).trimEnd()}…`,
    detail: '',
    urgency,
    maxAgeSec,
  };
}

function enemyFlashUp(lanes: PlayOverlayState['enemyBotSummoners'], champ: string): boolean {
  if (!lanes?.length || !champ) return false;
  const lane = lanes.find((l) => l.championName.toLowerCase() === champ.toLowerCase());
  const flash = lane?.spells.find((s) => s.name === 'Flash');
  return !!flash?.ready;
}

/**
 * Build a Phase 2 scoring context from the pre- and post-event states.
 *
 * All fields are optional with sensible defaults so existing fixtures keep
 * compiling; the scoring engine treats a missing HP/bounty as "unknown" and
 * skips those rules.
 */
function scoringContextFrom(prevState: PlayOverlayState | null, next: PlayOverlayState): ScoringContext {
  const victimNext = (next.enemies || []).find((e) => e.isDead) || null;
  // Victim HP/bounty must come from the pre-fight state — post-kill they are
  // dead (hpPct 0), which would never satisfy the "victim HP >60%" rule.
  const victimPrev =
    victimNext && prevState
      ? (prevState.enemies || []).find((e) => e.championName === victimNext.championName) || null
      : null;
  const victimAlive = victimPrev ?? victimNext;
  return {
    prevSelfHpPct: prevState?.localPlayer?.hpPct ?? null,
    nextSelfHpPct: next.localPlayer?.hpPct ?? null,
    victimHpPct: victimAlive?.hpPct ?? null,
    victimBounty: victimAlive?.bounty ?? null,
    victimWasFed: (victimAlive?.scores?.kills ?? 0) - (victimAlive?.scores?.deaths ?? 0) >= 3,
    enemiesNear: next.enemiesNear ?? 0,
    alliesNear: next.alliesNear ?? 0,
    towersNear: next.towersNear ?? 0,
    survivedSec: next.survivedSec ?? null,
    spellCastInWindow: next.spellCastInWindow ?? null,
    killStreak: next.killStreak ?? 1,
    objectiveStolen: next.objectiveStolen ?? false,
  };
}

/**
 * Compare snapshots and live state — overlay cues + recap lines for this tick.
 * Kill recaps are scored by the Phase 2 engine (`scorePlay`), so a low-HP
 * turnaround is labelled Brilliant with its reasons, not a generic line.
 * `prevState` (the fight-start state, optional for old callers) is what makes
 * the low-HP and victim-HP rules work.
 */
export function tickPlayMoments(
  prev: PlayMomentSnapshot | null,
  state: PlayOverlayState,
  prevState?: PlayOverlayState | null
): { cues: PlayMomentCue[]; recap: PlayRecapEntry[] } {
  const cues: PlayMomentCue[] = [];
  const recap: PlayRecapEntry[] = [];
  const next = snapshotFromState(state);
  if (!next || !state.inGame) return { cues, recap };

  const gt = next.gameTime;
  const situation = inferSituation({
    level: next.localLevel,
    enemyLevels: (state.enemies || []).map((e) => e.level || 0),
    scores: state.localPlayer?.scores,
    enemyScores: (state.enemies || []).map((e) => e.scores || {}),
    gameTime: gt,
  });

  if (prev) {
    if (next.localDeaths > prev.localDeaths && next.localDead) {
      const behind = situation.state === 'behind';
      const label = behind ? 'Death while behind' : 'You died';
      const detail = behind
        ? situation.reasons[0] || 'Play safer until items spike.'
        : 'Reset wave / sum timers before re-engage.';
      cues.push(momentCue('moment-you-died', label, 'warn', 22));
      recap.push({
        gameTime: gt,
        kind: 'blunder',
        label,
        detail,
        hint: behind ? 'Farm catch-up before fighting.' : undefined,
      });
    }

    if (next.localKills > prev.localKills) {
      const ctx = scoringContextFrom(prevState ?? null, state);
      const result = scorePlay(ctx);
      const flashPick = (state.enemies || []).some(
        (e) => e.isDead && !enemyFlashUp(state.enemyBotSummoners, e.championName)
      );
      const detail = result.reasons.length > 0 ? result.reasons.join(' · ') : 'Convert to plate / obj if safe.';

      if (flashPick) {
        cues.push(momentCue('moment-pick', 'Pick — Flash down', 'spike', 20));
      }
      recap.push({
        gameTime: gt,
        kind: 'brilliant',
        label: flashPick ? 'Pick with Flash down' : `${result.label} play`,
        detail,
        hint: flashPick ? 'Capitalize before sums return.' : undefined,
        score: result.score,
        playLabel: result.label,
        reasons: result.reasons,
      });
    }

    if (next.localAssists > prev.localAssists && next.localKills === prev.localKills) {
      recap.push({
        gameTime: gt,
        kind: 'brilliant',
        label: 'Assist',
        detail: 'Stay on tempo with your team.',
      });
    }

    for (const e of state.enemies || []) {
      if (!e.isDead) continue;
      const wasDead = prev.enemyDeaths.get(e.championName);
      if (wasDead) continue;
      if (enemyFlashUp(state.enemyBotSummoners, e.championName)) {
        cues.push(momentCue(`moment-enemy-${norm(e.championName)}`, 'Enemy died w/ Flash', 'info', 16));
        recap.push({
          gameTime: gt,
          kind: 'enemy',
          label: `${e.championName} died with Flash up`,
          detail: 'Punish before they respawn.',
        });
      }
    }
  }

  return { cues, recap };
}

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}
