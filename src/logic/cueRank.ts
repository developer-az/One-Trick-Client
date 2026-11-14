/**
 * Champion-weighted cue scoring — one pass for profile + moment cues.
 */

import type { CueWeightKind, ProfileId } from './profiles';
import { cueWeightProfileFor } from './profiles';
import type { JungleThreat } from './jungleLogic';
import type { ObjectiveTimers } from './gameState';
import type { ProfileSituation } from './situation';
import { supportBuildMaturity, type BuildProgress } from './buildProgress';
import type { Build } from './pykeLogic';

export interface OverlayCueScorable {
  id: string;
  label: string;
  detail: string;
  rationale?: string;
  confidence?: number;
  urgency: 'info' | 'warn' | 'spike';
  maxAgeSec?: number;
}

export interface DangerFusionContext {
  profileId: ProfileId;
  situation: ProfileSituation;
  jungleThreat: JungleThreat | null;
  botFlashRemainingSec: number | null;
  objectiveTimers: ObjectiveTimers | null | undefined;
  gameTimeSec: number;
  buildProgress?: BuildProgress | null;
  build?: Build | null;
}

function cueKind(id: string): CueWeightKind {
  if (/^moment-/.test(id)) return 'moment';
  if (/^threat-/.test(id)) return 'threat';
  if (/^boot-slot/.test(id)) return 'boot-slot';
  if (/^prey-focus/.test(id)) return 'prey-focus';
  if (/^sum-flash|^flash-up/.test(id)) return 'flash';
  if (/^roam-|^cross-map/.test(id)) return 'roam';
  if (/^cannon-/.test(id)) return 'cannon';
  if (/^scheme-|^hover-|^hold-lane|^reset-/.test(id)) return 'scheme';
  if (/^ult-online|^pan-ult|^yone-ult/.test(id)) return 'ult';
  if (/^buy-/.test(id)) return 'buy';
  if (/^pan-behind|^pan-ahead|^early-window|^xp-hold|^yone-/.test(id)) return 'doctrine';
  if (/^swap-oracle/.test(id)) return 'vision';
  return 'misc';
}

function urgencyBase(urgency: OverlayCueScorable['urgency']): number {
  if (urgency === 'spike') return 42;
  if (urgency === 'warn') return 28;
  return 16;
}

function situationModifier(situation: ProfileSituation, kind: string): number {
  if (situation.state === 'behind' && (kind === 'prey-focus' || kind === 'flash' || kind === 'threat')) return 8;
  if (situation.state === 'ahead' && (kind === 'roam' || kind === 'scheme' || kind === 'cannon')) return 6;
  if (situation.state === 'behind' && kind === 'roam') return -10;
  return 0;
}

function jungleModifier(jg: JungleThreat | null, kind: string, focusLane: 'bot' | 'mid' | 'top'): number {
  if (!jg) return 0;
  const hot = jg.gankRisk === 'high' || jg.gankRisk === 'medium';
  if (!hot) return 0;
  const laneMatch =
    (focusLane === 'bot' && jg.sideBias === 'bot') || (focusLane === 'mid' && jg.sideBias === 'mid');
  if (laneMatch && (kind === 'scheme' || kind === 'roam' || kind === 'cannon')) return -14;
  if (laneMatch && kind === 'doctrine') return -6;
  if (hot && kind === 'flash') return 6;
  return 0;
}

function objectiveModifier(timers: ObjectiveTimers | null | undefined, gameTime: number, kind: string): number {
  if (!timers) return 0;
  const soon = (t: { inSec: number } | null | undefined) => t && t.inSec >= 0 && t.inSec <= 90;
  if (soon(timers.dragon) || soon(timers.baron)) {
    if (kind === 'scheme') return 12;
    if (kind === 'roam') return -8;
  }
  if (gameTime > 0 && kind === 'scheme' && soon(timers.herald)) return 8;
  return 0;
}

function bootSellGate(ctx: DangerFusionContext, id: string): number {
  if (id !== 'boot-slot-sell') return 0;
  if (!ctx.buildProgress) return -24;
  const maturity = supportBuildMaturity(ctx.buildProgress, ctx.build);
  if (!maturity.nearComplete) return -28;
  return 4;
}

export function scoreOverlayCue(cue: OverlayCueScorable, ctx: DangerFusionContext, focusLane: 'bot' | 'mid' | 'top'): number {
  const weights = cueWeightProfileFor(ctx.profileId);
  const kind = cueKind(cue.id);
  const w = weights[kind] ?? weights.misc ?? 0;
  let score = urgencyBase(cue.urgency) + w + situationModifier(ctx.situation, kind);
  score += jungleModifier(ctx.jungleThreat, kind, focusLane);
  score += objectiveModifier(ctx.objectiveTimers, ctx.gameTimeSec, kind);
  score += bootSellGate(ctx, cue.id);

  if (ctx.botFlashRemainingSec !== null && ctx.botFlashRemainingSec < 120 && kind === 'flash') score += 10;
  if (/^moment-/.test(cue.id)) score += weights.moment ?? 14;

  const maxAge = cue.maxAgeSec ?? 30;
  if (maxAge <= 20) score += 6;
  else if (maxAge <= 30) score += 3;

  return Math.max(0, Math.min(100, score));
}

export function rankOverlayCues(
  cues: OverlayCueScorable[],
  ctx: DangerFusionContext,
  focusLane: 'bot' | 'mid' | 'top'
): OverlayCueScorable[] {
  return [...cues]
    .map((cue) => ({ ...cue, confidence: scoreOverlayCue(cue, ctx, focusLane) }))
    .sort((a, b) => {
      if ((b.confidence ?? 0) !== (a.confidence ?? 0)) return (b.confidence ?? 0) - (a.confidence ?? 0);
      return a.id.localeCompare(b.id);
    });
}