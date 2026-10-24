import { inferSituation, type ProfileSituation } from './situation';
import { scorePlay, SCORING_CONFIG, type ScoringContext, type PlayLabel } from './scoring';
import { readMomentEvents, type MomentFacts } from './playFacts';

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

/** Grade shown in review. Deaths use Mistake / Blunder; kills use the scorer. */
export type RecapGrade = PlayLabel | 'Mistake' | 'Blunder';

export interface PlayRecapEntry {
  gameTime: number;
  kind: PlayMomentKind;
  label: string;
  detail: string;
  hint?: string;
  /** Phase 2 — weighted score + label from the scoring engine. */
  score?: number;
  playLabel?: RecapGrade;
  reasons?: string[];
}

export function recapGrade(entry: PlayRecapEntry): RecapGrade {
  if (
    entry.playLabel === 'Brilliant' ||
    entry.playLabel === 'Great' ||
    entry.playLabel === 'Good' ||
    entry.playLabel === 'Mistake' ||
    entry.playLabel === 'Blunder'
  ) {
    return entry.playLabel;
  }
  if (entry.kind === 'blunder') return 'Mistake';
  return 'Good';
}

export interface PlayMomentSnapshot {
  gameTime: number;
  localDeaths: number;
  localKills: number;
  localAssists: number;
  localDead: boolean;
  localLevel: number;
  enemyDeaths: Map<string, number>;
  /** Game-times of our kills in the last 10s, so a double across two ticks still counts. */
  recentKillTimes: number[];
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
    recentKillTimes: [],
  };
}

function momentCue(
  id: string,
  label: string,
  urgency: PlayMomentCue['urgency'],
  maxAgeSec = 18,
  detail = ''
): PlayMomentCue {
  const t = label.replace(/\s+/g, ' ').trim();
  return {
    id,
    label: t.length <= 18 ? t : `${t.slice(0, 16).trimEnd()}…`,
    detail: detail.replace(/\s+/g, ' ').trim(),
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

/** True only when we actually track this champion's Flash and it is down. Unknown is not "down". */
function enemyFlashDown(lanes: PlayOverlayState['enemyBotSummoners'], champ: string): boolean {
  if (!lanes?.length || !champ) return false;
  const lane = lanes.find((l) => l.championName.toLowerCase() === champ.toLowerCase());
  const flash = lane?.spells.find((s) => s.name === 'Flash');
  if (!flash) return false;
  return !flash.ready;
}

/**
 * Build a Phase 2 scoring context from the pre- and post-event states.
 *
 * All fields are optional with sensible defaults so existing fixtures keep
 * compiling; the scoring engine treats a missing HP/bounty as "unknown" and
 * skips those rules.
 */
function freshVictims(prev: PlayMomentSnapshot | null, state: PlayOverlayState): NonNullable<PlayOverlayState['enemies']> {
  return (state.enemies || []).filter((e) => e.isDead && !prev?.enemyDeaths.get(e.championName));
}

function kdaBefore(prevState: PlayOverlayState | null, championName: string, fallbackDeaths: number): { kills: number; deaths: number } {
  const prev = (prevState?.enemies || []).find((e) => e.championName === championName);
  if (prev?.scores) return { kills: prev.scores.kills ?? 0, deaths: prev.scores.deaths ?? 0 };
  // The post-kill row already counted this death.
  return { kills: 0, deaths: Math.max(0, fallbackDeaths - 1) };
}

/**
 * Build a Phase 2 scoring context from the pre- and post-event states.
 *
 * Victim HP has to come from the pre-fight row. After the kill the API (and
 * the overlay) report them dead, which would never satisfy "victim HP > 60%".
 * A champion who was already dead is not this kill's victim.
 */
function scoringContextFrom(
  prev: PlayMomentSnapshot | null,
  prevState: PlayOverlayState | null,
  next: PlayOverlayState,
  killStreak: number,
  objectiveStolen: boolean
): ScoringContext {
  const victim = freshVictims(prev, next)[0] || null;
  const victimPrev =
    victim && prevState
      ? (prevState.enemies || []).find((e) => e.championName === victim.championName) || null
      : null;
  const record = victim ? kdaBefore(prevState, victim.championName, victim.scores?.deaths ?? 0) : null;
  return {
    prevSelfHpPct: prevState?.localPlayer?.hpPct ?? null,
    nextSelfHpPct: next.localPlayer?.hpPct ?? null,
    victimHpPct: victimPrev?.hpPct ?? null,
    victimBounty: victimPrev?.bounty ?? victim?.bounty ?? null,
    victimWasFed: !!record && record.kills - record.deaths >= 3,
    enemiesNear: next.enemiesNear ?? 0,
    alliesNear: next.alliesNear ?? 0,
    towersNear: next.towersNear ?? 0,
    survivedSec: next.survivedSec ?? null,
    spellCastInWindow: next.spellCastInWindow ?? null,
    killStreak: Math.max(1, killStreak, next.killStreak ?? 1),
    objectiveStolen: objectiveStolen || !!next.objectiveStolen,
  };
}

function joinSentences(parts: Array<string | null | undefined>): string {
  const clean = parts
    .map((part) => (part || '').replace(/\s+/g, ' ').trim().replace(/\.+$/, ''))
    .filter((part) => part.length > 0);
  if (!clean.length) return '';
  return `${clean.join('. ')}.`;
}

function describeDeath(
  situation: ProfileSituation,
  deaths: number,
  killer: string | null,
  assists: number
): { label: string; detail: string; hint?: string; playLabel: RecapGrade } {
  const ahead = situation.state === 'ahead';
  const who = killer ? (assists > 0 ? `${killer} +${assists}` : killer) : null;
  const label = who ? `Died to ${who}` : situation.state === 'behind' ? 'Death while behind' : `Death ${deaths}`;
  const next =
    ahead
      ? 'You were ahead — this hands them a shutdown window.'
      : situation.state === 'behind'
        ? 'Catch the wave before you fight again.'
        : 'Fix the wave before you walk back up.';
  return {
    label,
    detail: joinSentences([who ? `Killed by ${who}` : `Death ${deaths}`, situation.reasons[0], next]),
    hint: situation.state === 'behind' ? 'Farm the next wave before you fight.' : undefined,
    playLabel: ahead ? 'Blunder' : 'Mistake',
  };
}

function describeKill(
  resultLabel: PlayLabel,
  reasons: string[],
  victims: NonNullable<PlayOverlayState['enemies']>,
  prevState: PlayOverlayState | null,
  flashPick: boolean,
  firstBlood: boolean,
  objectiveName: string | null,
  situation: ProfileSituation
): { label: string; detail: string; hint?: string } {
  const names = victims.map((v) => v.championName).filter((name) => !!name);
  const who = names.length ? names.join(' + ') : null;
  const record = victims[0] ? kdaBefore(prevState, victims[0].championName, victims[0].scores?.deaths ?? 0) : null;
  const recordLine = who && record ? `${who} was ${record.kills}/${record.deaths}` : who;
  const action = flashPick
    ? 'Walk up before Flash is back'
    : objectiveName
      ? `You stole ${objectiveName} — leave before they collapse`
      : situation.state === 'behind'
        ? 'Do not walk it back in — catch the wave first'
        : situation.state === 'ahead'
          ? 'Push the lead onto a plate, then rotate'
          : names.length > 1
            ? 'Push the wave or take the objective, then leave'
            : 'Take the plate or the wave, then leave';
  const why = [firstBlood ? 'First blood' : null, ...reasons].filter((part): part is string => !!part);
  return {
    label: flashPick ? 'Pick — Flash down' : who ? `${resultLabel} on ${who}` : `${resultLabel} kill`,
    detail: joinSentences([why.join(' · ') || null, recordLine, action]),
    hint: flashPick ? 'Capitalize before sums return.' : undefined,
  };
}

const MULTIKILL_WINDOW_SEC = 10;

/**
 * Compare snapshots and live state — overlay cues + recap lines for this tick.
 * Kill recaps are scored by the Phase 2 engine (`scorePlay`). The sentence
 * names who died and why this fight scored, so two Good kills do not share
 * one canned tip. `prevState` is the fight-start overlay row (HP, KDA).
 * `facts` is the Live Client event list, when the caller has it.
 */
export function tickPlayMoments(
  prev: PlayMomentSnapshot | null,
  state: PlayOverlayState,
  prevState?: PlayOverlayState | null,
  facts?: MomentFacts | null
): { cues: PlayMomentCue[]; recap: PlayRecapEntry[]; snapshot: PlayMomentSnapshot | null } {
  const cues: PlayMomentCue[] = [];
  const recap: PlayRecapEntry[] = [];
  const next = snapshotFromState(state);
  if (!next || !state.inGame) return { cues, recap, snapshot: prev };

  const gt = next.gameTime;
  const priorTimes = (prev?.recentKillTimes || []).filter((t) => gt - t <= MULTIKILL_WINDOW_SEC && gt - t >= 0);
  const gainedKills = prev ? Math.max(0, next.localKills - prev.localKills) : 0;
  const recentKillTimes = [...priorTimes];
  for (let i = 0; i < gainedKills; i++) recentKillTimes.push(gt);
  const snapshot: PlayMomentSnapshot = { ...next, recentKillTimes };

  const situation = inferSituation({
    level: next.localLevel,
    enemyLevels: (state.enemies || []).map((e) => e.level || 0),
    scores: state.localPlayer?.scores,
    enemyScores: (state.enemies || []).map((e) => e.scores || {}),
    gameTime: gt,
  });
  const events = readMomentEvents(facts, prev?.gameTime ?? gt, gt, state.localPlayer?.championName || '');

  if (prev) {
    if (next.localDeaths > prev.localDeaths && next.localDead) {
      const death = describeDeath(situation, next.localDeaths, events.deathKiller, events.deathAssists);
      cues.push(momentCue('moment-you-died', death.label, 'warn', 22, death.detail));
      recap.push({
        gameTime: gt,
        kind: 'blunder',
        label: death.label,
        detail: death.detail,
        hint: death.hint,
        playLabel: death.playLabel,
      });
    }

    if (gainedKills > 0) {
      const victims = freshVictims(prev, state);
      const ctx = scoringContextFrom(
        prev,
        prevState ?? null,
        state,
        Math.max(recentKillTimes.length, events.killStreakFromEvent),
        events.objectiveStolen
      );
      const result = scorePlay(ctx);
      const flashPick = victims.some((e) => enemyFlashDown(state.enemyBotSummoners, e.championName));
      const told = describeKill(
        result.label,
        result.reasons,
        victims,
        prevState ?? null,
        flashPick,
        events.firstBlood,
        events.objectiveName,
        situation
      );
      const urgency = result.label === 'Good' ? 'info' : 'spike';
      cues.push(momentCue(`moment-kill-${Math.round(gt)}`, told.label, urgency, result.label === 'Good' ? 12 : 20, told.detail));
      recap.push({
        gameTime: gt,
        kind: 'brilliant',
        label: told.label,
        detail: told.detail,
        hint: told.hint,
        score: result.score,
        playLabel: result.label,
        reasons: result.reasons,
      });
    } else if (events.objectiveStolen && events.objectiveName) {
      recap.push({
        gameTime: gt,
        kind: 'brilliant',
        label: `Stole ${events.objectiveName}`,
        detail: `Stole ${events.objectiveName}. Leave before they collapse on the pit.`,
        score: SCORING_CONFIG.objectiveSteal,
        playLabel: SCORING_CONFIG.objectiveSteal >= SCORING_CONFIG.thresholds.brilliant
          ? 'Brilliant'
          : SCORING_CONFIG.objectiveSteal >= SCORING_CONFIG.thresholds.great
            ? 'Great'
            : 'Good',
        reasons: ['Objective steal'],
      });
      cues.push(
        momentCue(
          `moment-steal-${Math.round(gt)}`,
          `Stole ${events.objectiveName}`,
          'spike',
          18,
          `Stole ${events.objectiveName}. Leave before they collapse on the pit.`
        )
      );
    }

    if (next.localAssists > prev.localAssists && gainedKills === 0) {
      const helped = freshVictims(prev, state);
      const who = helped[0]?.championName;
      recap.push({
        gameTime: gt,
        kind: 'brilliant',
        label: who ? `Assist on ${who}` : 'Assist',
        detail: who
          ? `Assist on ${who}. Hold the wave with the teammate who took the kill.`
          : 'Hold the wave with the teammate who took the kill.',
        playLabel: 'Good',
      });
    }

    for (const e of state.enemies || []) {
      if (!e.isDead) continue;
      const wasDead = prev.enemyDeaths.get(e.championName);
      if (wasDead) continue;
      if (enemyFlashUp(state.enemyBotSummoners, e.championName)) {
        const detail = `${e.championName} died with Flash still up. Punish before they respawn.`;
        cues.push(momentCue(`moment-enemy-${norm(e.championName)}`, 'Enemy died w/ Flash', 'info', 16, detail));
        recap.push({
          gameTime: gt,
          kind: 'enemy',
          label: `${e.championName} died with Flash up`,
          detail,
        });
      }
    }
  }

  return { cues, recap, snapshot };
}

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}
