import { inferSituation } from './situation';

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
    scores?: { kills?: number; deaths?: number; assists?: number };
  }>;
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
 * Compare snapshots and live state — overlay cues + recap lines for this tick.
 */
export function tickPlayMoments(
  prev: PlayMomentSnapshot | null,
  state: PlayOverlayState
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
      const flashPick = (state.enemies || []).some(
        (e) => e.isDead && !enemyFlashUp(state.enemyBotSummoners, e.championName)
      );
      if (flashPick) {
        cues.push(momentCue('moment-pick', 'Pick — Flash down', 'spike', 20));
        recap.push({
          gameTime: gt,
          kind: 'brilliant',
          label: 'Pick with Flash down',
          detail: 'Capitalize before sums return.',
          hint: 'Keep limit-testing if this pattern works.',
        });
      } else {
        recap.push({
          gameTime: gt,
          kind: 'brilliant',
          label: 'Kill secured',
          detail: 'Convert to plate / obj if safe.',
        });
      }
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
