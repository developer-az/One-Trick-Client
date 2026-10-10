/**
 * Support vision plan: purpose-driven wards + buy schedule.
 * Early game: potions first — no Control Ward until first real back (~2:30+).
 * With sweeper / pink in inventory: name the exact job (deny gank path, pit, sweep).
 */

import { isSupportStyleProfile, profileFocusLane, type ProfileId } from './profiles';
import type { JungleThreat } from './jungleLogic';

export interface WardCue {
  id: string;
  label: string;
  detail: string;
  urgency: 'info' | 'warn' | 'spike';
  refreshSec: number;
}

/** Stealth-ward mental cycle for "re-ward this spot" reminders (not Live Client CD). */
const REWARD_CYCLE = 90;

export interface WardStatus {
  /** Purpose — what this ward is for (not a vague place name alone). */
  where: string;
  /** Why / how — kept short for the chip. */
  why: string;
  urgency: WardCue['urgency'];
  refreshInSec: number;
  wardScore?: number;
  due: boolean;
  buyHint: string;
  controlPlan: string;
  /** Pinks currently held (from inventory). */
  pinksHeld: number;
  /** Sweep targets when Oracle is equipped. */
  sweepTargets?: string[];
}

export interface VisionBuyPlan {
  controlWardsToBuy: number;
  controlWardsExpectedByNow: number;
  holdInInventory: number;
  trinket: 'stealth' | 'oracle' | 'farsight';
  shopLine: string;
}

/**
 * Optimal Control Ward cadence for engage supports (Pyke / Pantheon).
 * Before first back: 0 pinks — user needs pots + Atlas, not a pink on the open.
 */
export function visionBuyPlan(
  gameTime: number,
  profileId: ProfileId,
  opts?: { hasUmbral?: boolean; hasOracle?: boolean; controlWardCount?: number }
): VisionBuyPlan {
  const minutes = gameTime / 60;
  const held = opts?.controlWardCount ?? 0;
  const hasOracle = !!opts?.hasOracle;
  const hasUmbral = !!opts?.hasUmbral;
  const support = isSupportStyleProfile(profileId);

  // No pink recommendation until first-back window — potions matter more
  if (minutes < 2.4) {
    return {
      controlWardsToBuy: 0,
      controlWardsExpectedByNow: 0,
      holdInInventory: 0,
      trinket: 'stealth',
      shopLine: support ? 'Pots first — pink on first back' : 'Trinket river',
    };
  }

  let expected = 0;
  if (minutes >= 2.5) expected = 1;
  if (minutes >= 5) expected = 2;
  if (minutes >= 8) expected = 3;
  if (minutes >= 12) expected = 4;
  if (minutes >= 16) expected = 5;
  if (minutes >= 22) expected = 6;

  let hold = support ? 1 : 0;
  if (minutes >= 12) hold = support ? 2 : 1;
  if (minutes >= 20) hold = 1;

  let toBuy = Math.max(0, hold - held);
  if (support && minutes >= 4.5 && minutes <= 5.5 && held < 1) toBuy = Math.max(toBuy, 1);
  if (support && minutes >= 13 && minutes <= 15.5 && held < 2) toBuy = Math.max(toBuy, 2 - held);

  let trinket: VisionBuyPlan['trinket'] = 'stealth';
  if (profileFocusLane(profileId) === 'mid') {
    trinket = minutes >= 14 || hasUmbral ? 'farsight' : 'stealth';
  } else if (hasOracle) {
    trinket = 'oracle';
  } else if (hasUmbral || minutes >= 8.5) {
    trinket = 'oracle';
  }

  const shopBits: string[] = [];
  if (toBuy > 0) shopBits.push(`Control Ward ×${toBuy}`);
  if (trinket === 'oracle' && !hasOracle) shopBits.push('swap Oracle Lens');
  if (trinket === 'farsight') shopBits.push('Farsight OK');
  if (shopBits.length === 0) shopBits.push(held >= hold ? `hold ${held} pink` : 'vision OK');

  return {
    controlWardsToBuy: toBuy,
    controlWardsExpectedByNow: expected,
    holdInInventory: hold,
    trinket,
    shopLine: shopBits.join(' · '),
  };
}

function rewardCountdown(gameTime: number): { refreshInSec: number; due: boolean; cycleIndex: number } {
  if (gameTime <= 0) return { refreshInSec: REWARD_CYCLE, due: false, cycleIndex: 0 };
  const cycleIndex = Math.floor(gameTime / REWARD_CYCLE);
  const elapsed = gameTime - cycleIndex * REWARD_CYCLE;
  const refreshInSec = Math.max(0, Math.ceil(REWARD_CYCLE - elapsed - 1e-6));
  const due = refreshInSec <= 12;
  return { refreshInSec, due, cycleIndex };
}

/** Purpose-first ward cues — each line answers "what job does this ward do?" */
export function buildWardCues(
  gameTime: number,
  profileId: ProfileId,
  jg: JungleThreat | null
): WardCue[] {
  if (gameTime <= 0) return [];
  const minutes = gameTime / 60;
  const cues: WardCue[] = [];
  const jgBot = jg?.sideBias === 'bot' || jg?.gankRisk === 'high';
  const { due, cycleIndex } = rewardCountdown(gameTime);
  const jgName = jg?.junglerName || 'jg';

  if (profileFocusLane(profileId) !== 'mid') {
    if (minutes >= 1.0 && minutes <= 1.5) {
      cues.push({
        id: 'ward-open',
        label: 'Deny invade info',
        detail: jgBot
          ? `Pixel brush — deny ${jgName} invade + first path into bot.`
          : 'Pixel / river mouth — first info win before crab.',
        urgency: 'warn',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes >= 2.0 && minutes <= 2.5) {
      cues.push({
        id: 'ward-scuttle',
        label: 'Track crab start',
        detail: `River brush before 2:15 — know which side ${jgName} took crab.`,
        urgency: jg?.gankRisk === 'high' ? 'spike' : 'warn',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes > 2.5 && minutes < 8 && due) {
      cues.push({
        id: `ward-refresh-${cycleIndex}`,
        label: 'Cover gank entrance',
        detail: jgBot
          ? `Tri or river — cover ${jgName}'s bot path while you shove.`
          : 'River brush on crash — cover the entrance you leave through.',
        urgency: 'info',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes >= 3.5 && minutes <= 6 && jgBot) {
      cues.push({
        id: 'ward-deep',
        label: 'Track leave path',
        detail: `${jgName} bot — ward raptor entrance on crash leave so you see the recall/path.`,
        urgency: 'warn',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes >= 4.0 && minutes <= 5.2) {
      cues.push({
        id: 'ward-drake1',
        label: 'Secure dragon approach',
        detail: 'Pit pink + river clear — deny their walk-up, not random lane bush.',
        urgency: 'warn',
        refreshSec: 90,
      });
    }
    if (minutes >= 8.5 && minutes <= 10) {
      cues.push({
        id: 'ward-oracle',
        label: 'Clear fight fog',
        detail: 'Swap Sweeper — clear river/pit wards before the next fight.',
        urgency: 'spike',
        refreshSec: 60,
      });
    }
    if (minutes >= 13 && minutes <= 15.5) {
      cues.push({
        id: 'ward-drake-soul',
        label: 'Own the objective',
        detail: '2 pinks: pit deny + entrance cut. Sweep jungle before spawn.',
        urgency: 'spike',
        refreshSec: 90,
      });
    }
  } else {
    if (minutes >= 1.1 && minutes <= 1.6) {
      cues.push({
        id: 'yone-ward-open',
        label: 'Know jg start',
        detail: jgBot
          ? 'Bot-side river — protects you + bot from early path.'
          : 'One river bush by 1:25 — know which side jg started.',
        urgency: 'warn',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes >= 2.8 && minutes <= 4.0 && (due || jg?.gankRisk === 'high')) {
      cues.push({
        id: 'yone-ward-gank',
        label: 'Cover gank path',
        detail: jg
          ? `${jg.junglerName}: ward the river they path. Short E only with vision.`
          : 'River ward before trading E — no fog all-ins.',
        urgency: jg?.gankRisk === 'high' ? 'spike' : 'warn',
        refreshSec: REWARD_CYCLE,
      });
    }
    if (minutes >= 12 && minutes <= 16) {
      cues.push({
        id: 'yone-ward-obj',
        label: 'Enable flank fog',
        detail: 'Enemy jungle entrance before dragon — E-R flank needs their fog denied.',
        urgency: 'warn',
        refreshSec: 90,
      });
    }
  }

  return cues;
}

function sweepTargetList(
  minutes: number,
  profileId: ProfileId,
  jg: JungleThreat | null,
  hasOracle: boolean,
  pinksHeld: number
): string[] {
  if (!hasOracle && pinksHeld <= 0) return [];
  const targets: string[] = [];
  if (hasOracle) {
    if (minutes < 8) {
      targets.push(profileFocusLane(profileId) === 'mid' ? 'Sweep river bush before E trade' : 'Sweep pixel / river before crash leave');
    } else if (minutes < 14) {
      targets.push('Sweep pit + river entrance before obj walk-up');
      if (jg?.gankRisk !== 'low') targets.push(`Clear ${jg?.junglerName || 'jg'} path brush`);
    } else {
      targets.push('Sweep enemy jg entrance + pit before spawn');
      targets.push('Clear flank brush your team walks through');
    }
  }
  if (pinksHeld > 0) {
    if (minutes < 6) targets.push(`Plant pink (${pinksHeld} held): deny gank entrance on shove`);
    else if (minutes < 14) targets.push(`Plant pink (${pinksHeld} held): pit or reset river`);
    else targets.push(`Plant pink (${pinksHeld} held): pit deny — refill on back`);
  }
  return targets.slice(0, 3);
}

/**
 * Compact ward read — purpose first, count pinks, list sweep jobs when equipped.
 */
export function buildWardStatus(
  gameTime: number,
  profileId: ProfileId,
  jg: JungleThreat | null,
  wardScore?: number,
  inv?: { hasUmbral?: boolean; hasOracle?: boolean; controlWardCount?: number }
): WardStatus | null {
  if (gameTime <= 0) return null;

  const { refreshInSec, due } = rewardCountdown(gameTime);
  const plan = visionBuyPlan(gameTime, profileId, inv);
  const cues = buildWardCues(gameTime, profileId, jg);
  const jgBot = jg?.sideBias === 'bot' || jg?.gankRisk === 'high';
  const minutes = gameTime / 60;
  const pinksHeld = inv?.controlWardCount ?? 0;
  const hasOracle = !!inv?.hasOracle;

  let where: string;
  let why: string;
  let urgency: WardStatus['urgency'] = due ? 'warn' : 'info';

  if (minutes < 2.4) {
    where = 'Open info only';
    why = 'Trinket river — buy pots, pink on first back';
    urgency = 'info';
  } else if (cues.length > 0) {
    const top = cues[0];
    where = top.label;
    why = top.detail;
    urgency = top.urgency;
  } else if (profileFocusLane(profileId) === 'mid') {
    where = 'Cover gank path';
    why = jgBot ? 'Bot-side river while shoving' : 'River bush on shove side';
  } else if (minutes >= 12) {
    where = 'Own the objective';
    why = due ? 'Re-ward pit + entrance before spawn' : 'Pit deny + entrance cut';
  } else {
    where = jgBot ? 'Cover bot gank path' : 'Cover crash leave';
    why = due ? 'Re-ward the entrance you play through' : 'River/tri on shove';
  }

  const sweepTargets = sweepTargetList(minutes, profileId, jg, hasOracle, pinksHeld);

  let buyHint = plan.shopLine;
  if (minutes < 2.4) {
    buyHint = 'Pots > pink';
  } else if (hasOracle && sweepTargets.length) {
    buyHint = pinksHeld > 0 ? `SWEEP · ${pinksHeld} pink` : 'SWEEP ready';
  } else if (plan.trinket === 'oracle' && !hasOracle) {
    buyHint = plan.controlWardsToBuy > 0
      ? `SWEEP + pink ×${plan.controlWardsToBuy}`
      : 'Swap Oracle Lens';
  } else if (plan.controlWardsToBuy > 0) {
    buyHint = `Buy pink ×${plan.controlWardsToBuy}`;
  } else if (pinksHeld > 0) {
    buyHint = `${pinksHeld} pink held`;
  } else if (due) {
    buyHint = 'WARD NOW';
  } else {
    buyHint = `${refreshInSec}s`;
  }

  const controlPlan = supportControlPlanText(minutes, plan, pinksHeld, hasOracle, sweepTargets);

  return {
    where,
    why,
    urgency:
      due || plan.controlWardsToBuy > 0 || (plan.trinket === 'oracle' && !hasOracle)
        ? urgency === 'info'
          ? 'warn'
          : urgency
        : urgency,
    refreshInSec,
    wardScore,
    due:
      due ||
      plan.controlWardsToBuy >= 2 ||
      (plan.trinket === 'oracle' && !hasOracle && minutes >= 8.5 && minutes <= 10),
    buyHint,
    controlPlan,
    pinksHeld,
    sweepTargets: sweepTargets.length ? sweepTargets : undefined,
  };
}

function supportControlPlanText(
  minutes: number,
  plan: VisionBuyPlan,
  pinksHeld: number,
  hasOracle: boolean,
  sweepTargets: string[]
): string {
  if (minutes < 2.4) {
    return 'Opening: Health Potions + Atlas. Control Ward on first back — not on the open buy.';
  }
  const sweep = hasOracle && sweepTargets.length ? ` Sweep: ${sweepTargets[0]}.` : '';
  if (minutes < 8) {
    return `Lane: hold ${plan.holdInInventory} pink (have ${pinksHeld}). Plant to deny gank path, not random bush.${sweep}`;
  }
  if (minutes < 14) {
    return `Oracle on + hold ${plan.holdInInventory} pinks. Pace ~${plan.controlWardsExpectedByNow} bought.${sweep}`;
  }
  return `Objectives: pit pink + entrance cut. Refill to ${plan.holdInInventory}. Pace ~${plan.controlWardsExpectedByNow}+.${sweep}`;
}
