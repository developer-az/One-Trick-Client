/**
 * Time-and-scheme map hover cues — no live positions (Riot-safe).
 */

import type { JungleThreat } from './jungleLogic';
import type { ObjectiveTimers } from './gameState';
import type { ProfileId } from './profiles';
import { isSupportStyleProfile, profileFocusLane } from './profiles';
import { shouldShowCannonCue, nextCannon, formatCannonEta } from './waveLogic';

export interface SchemeCueDraft {
  id: string;
  label: string;
  detail: string;
  urgency: 'info' | 'warn' | 'spike';
  maxAgeSec?: number;
}

function laneMatchesJg(focus: 'bot' | 'mid' | 'top', jg: JungleThreat): boolean {
  if (jg.sideBias === 'unknown') return false;
  return jg.sideBias === focus;
}

export function schemeHoverCues(input: {
  profileId: ProfileId;
  gameTimeSec: number;
  jungleThreat: JungleThreat | null;
  objectiveTimers?: ObjectiveTimers | null;
  level: number;
}): SchemeCueDraft[] {
  const cues: SchemeCueDraft[] = [];
  const focus = profileFocusLane(input.profileId);
  const minutes = input.gameTimeSec / 60;
  const jgHot =
    input.jungleThreat &&
    (input.jungleThreat.gankRisk === 'high' || input.jungleThreat.gankRisk === 'medium');
  const jgOnLane = input.jungleThreat && laneMatchesJg(focus, input.jungleThreat);

  if (jgHot && jgOnLane && isSupportStyleProfile(input.profileId) && minutes < 18) {
    cues.push({
      id: 'scheme-hold-lane',
      label: 'Hold bot tri',
      detail: `${input.jungleThreat!.junglerName} hot — hug safe side, ward tri.`,
      urgency: 'spike',
      maxAgeSec: 22,
    });
    return cues;
  }

  if (focus === 'bot' && jgHot && jgOnLane && minutes >= 3 && minutes <= 14) {
    cues.push({
      id: 'hover-bot-tri',
      label: 'Ward bot tri',
      detail: `Jg ${input.jungleThreat!.probability}% bot — sweep before shove.`,
      urgency: 'warn',
      maxAgeSec: 24,
    });
  }

  if (isSupportStyleProfile(input.profileId) && shouldShowCannonCue(input.gameTimeSec) && !jgOnLane) {
    const cannon = nextCannon(input.gameTimeSec);
    if (cannon) {
      const eta = cannon.eta > 0 ? formatCannonEta(cannon.eta) : 'now';
      cues.push({
        id: 'scheme-crash-cannon',
        label: `Crash ${eta}`,
        detail: 'Push cannon → roam window opens after crash.',
        urgency: 'spike',
        maxAgeSec: 18,
      });
    }
  }

  const dragon = input.objectiveTimers?.dragon;
  if (dragon && dragon.inSec >= 0 && dragon.inSec <= 75 && input.level >= 5) {
    cues.push({
      id: 'reset-before-dragon',
      label: dragon.inSec <= 30 ? `Drake ${dragon.inSec}s` : 'Reset for drake',
      detail: 'Base → buy → path bot river before spawn.',
      urgency: dragon.inSec <= 35 ? 'spike' : 'warn',
      maxAgeSec: 28,
    });
  }

  const baron = input.objectiveTimers?.baron;
  if (baron && baron.inSec >= 0 && baron.inSec <= 90 && minutes >= 22) {
    cues.push({
      id: 'reset-before-baron',
      label: baron.inSec <= 40 ? `Baron ${baron.inSec}s` : 'Reset for baron',
      detail: 'Clear vision → group mid before pit.',
      urgency: 'warn',
      maxAgeSec: 32,
    });
  }

  if (focus === 'mid' && jgHot && input.jungleThreat?.sideBias === 'mid' && minutes >= 4 && minutes <= 12) {
    cues.push({
      id: 'hover-mid-river',
      label: 'Hold mid river',
      detail: `Jg threat on mid — play from warded pixel.`,
      urgency: 'warn',
      maxAgeSec: 22,
    });
  }

  return cues;
}