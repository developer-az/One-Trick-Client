import type { WardStatus } from './visionLogic';
import { isAramOrMayhem, isMayhemGame } from './mayhem/mode';
import { isMayhemAugmentLevel } from './mayhem/augmentSchedule';

export interface AramHudState {
  gameTime?: number;
  gameMode?: string | null;
  mapName?: string | null;
  activePlayerLevel?: number;
  localPlayer?: {
    level: number;
    items: Array<{ itemID: number; count?: number }>;
  } | null;
  enemyBotSummoners?: Array<{
    spells: Array<{ short: string; ready: boolean; remaining: number }>;
  }>;
}

export interface AramOverlayCue {
  id: string;
  label: string;
  detail: string;
  urgency: 'spike' | 'warn' | 'info';
  maxAgeSec?: number;
}

/** ARAM / Mayhem — no jungle gank square. */
export function getAramGankStatus(): null {
  return null;
}

/** Brush / oracle reminders suited to Howling Abyss (classic ARAM — not Mayhem augment HUD). */
export function getAramWardStatus(state: AramHudState): WardStatus | null {
  if (isMayhemGame(state.gameMode, state.mapName)) return null;
  const gameTime = state.gameTime ?? 0;
  if (gameTime <= 0) return null;
  const minutes = gameTime / 60;
  const items = state.localPlayer?.items || [];
  const hasOracle = items.some((i) => i.itemID === 3364);
  const pinks = items.filter((i) => i.itemID === 2055).reduce((n, i) => n + (i.count || 1), 0);

  let where: string;
  let why: string;
  let urgency: WardStatus['urgency'] = 'info';

  if (minutes < 2) {
    where = 'Lane bushes';
    why = 'One trinket — know who steps first';
  } else if (!hasOracle && minutes >= 4) {
    where = 'Swap sweeper';
    why = 'Oracle before the next 5v5';
    urgency = 'warn';
  } else if (pinks < 1 && minutes >= 6) {
    where = 'Buy pink';
    why = 'Deny side bush before you push';
    urgency = 'warn';
  } else if (minutes >= 10) {
    where = 'Clear side brush';
    why = 'Sweep before you engage under their tower';
  } else {
    where = 'Brush control';
    why = 'Ward before you facecheck the wave';
  }

  return {
    where,
    why,
    urgency,
    refreshInSec: 0,
    due: urgency === 'warn',
    buyHint: hasOracle ? 'Hold sweeper' : 'Oracle on back',
    controlPlan: where,
    pinksHeld: pinks,
    sweepTargets: [],
  };
}

export function buildAramInGameCues(state: AramHudState): AramOverlayCue[] {
  const cues: AramOverlayCue[] = [];
  const level = state.localPlayer?.level ?? state.activePlayerLevel ?? 1;
  const gameTime = state.gameTime ?? 0;
  const minutes = gameTime / 60;
  const mayhem = isMayhemGame(state.gameMode, state.mapName);

  if (level === 6) {
    cues.push({ id: 'ult-online', label: 'R online', detail: '', urgency: 'spike', maxAgeSec: 24 });
  }

  if (minutes >= 8 && minutes <= 14) {
    cues.push({ id: 'aram-mid', label: 'Group mid', detail: '', urgency: 'info', maxAgeSec: 35 });
  }

  if (mayhem && isMayhemAugmentLevel(level)) {
    cues.push({ id: 'mayhem-pick', label: 'Augment pick', detail: '', urgency: 'spike', maxAgeSec: 20 });
  }

  return cues;
}

export function shouldUseAramOverlay(state: AramHudState): boolean {
  return isAramOrMayhem(state.gameMode, state.mapName);
}
