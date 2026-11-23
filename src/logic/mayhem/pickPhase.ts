import { MAYHEM_AUGMENT_LEVELS, xpProgressToNextLevel } from './augmentSchedule';

/** Game seconds after load during which the spawn shop offers the first augment. */
export const MAYHEM_SPAWN_PICK_SECONDS = 120;

/** Required champion level before each augment slot (you start ARAM at 3). */
export function nextMayhemPickLevel(ownedAugmentCount: number): number | null {
  if (ownedAugmentCount < 0 || ownedAugmentCount >= MAYHEM_AUGMENT_LEVELS.length) return null;
  return MAYHEM_AUGMENT_LEVELS[ownedAugmentCount];
}

export interface MayhemPickPhaseInput {
  level: number;
  gameTime: number;
  isDead: boolean;
  wasDead: boolean;
  ownedAugmentCount: number;
  championStats?: Record<string, number> | null;
}

export interface MayhemPickPhase {
  /** Shop / augment UI is likely available — run OCR and show overlay. */
  pickWindowOpen: boolean;
  /** Level requirement met but player must die (or respawn) to open the shop. */
  waitingForDeath: boolean;
  /** Human-readable status for HUD. */
  hint: string;
  nextPickLevel: number | null;
  picksTaken: number;
  ocrBurst: boolean;
}

/**
 * Legacy level estimate, kept exported for older callers/tests.
 *
 * Do NOT use this to decide whether a pick happened: reaching level 3 (or
 * passing 7 / 11 / 15) only opens the augment shop, a player can stay at
 * level 5 without picking. The live pick counter is
 * `observeMayhemPickScan` (src/logic/mayhem/pickCount.ts).
 */
export function inferMayhemPicksTakenFromLevel(level: number, storedOwnedCount: number): number {
  if (storedOwnedCount > 0) return storedOwnedCount;
  return MAYHEM_AUGMENT_LEVELS.filter((pickLevel) => level > pickLevel).length;
}

/**
 * Owned ids and the persisted pick count — no level inference.
 * `_level` stays in the signature so existing call sites keep compiling; the
 * level gate cannot prove a pick, only an augment window/offer disappearance
 * or Live Client augment data can.
 */
export function resolveMayhemPicksTaken(
  _level: number,
  ownedAugmentIds: string[],
  persistedPicksTaken: number
): number {
  const owned = ownedAugmentIds.length;
  return Math.max(owned, Math.max(0, Math.floor(persistedPicksTaken)));
}

/**
 * Mayhem augments are chosen through the shop UI — usually while dead or at spawn.
 * Live Client does not expose offers; level + death is the reliable signal (see LoL wiki / Riot support).
 */
export function computeMayhemPickPhase(input: MayhemPickPhaseInput): MayhemPickPhase {
  const { level, isDead, wasDead, ownedAugmentCount, championStats } = input;
  const picksTaken = Math.min(
    MAYHEM_AUGMENT_LEVELS.length,
    Math.max(0, ownedAugmentCount)
  );
  const nextPickLevel = nextMayhemPickLevel(picksTaken);

  if (nextPickLevel == null) {
    return {
      pickWindowOpen: false,
      waitingForDeath: false,
      hint: 'All augments taken',
      nextPickLevel: null,
      picksTaken,
      ocrBurst: false,
    };
  }

  const levelReady = level >= nextPickLevel;

  let waitingForDeath = false;
  let pickWindowOpen = false;
  let hint = '';

  if (!levelReady) {
    const xp = xpProgressToNextLevel(championStats);
    const xpPct = xp != null ? Math.round(xp * 100) : null;
    hint =
      xpPct != null
        ? `Next augment at L${nextPickLevel} (${xpPct}% there)`
        : `Next augment at L${nextPickLevel}`;
    return {
      pickWindowOpen: false,
      waitingForDeath: false,
      hint,
      nextPickLevel,
      picksTaken,
      ocrBurst: xp != null && xp >= 0.7,
    };
  }

  // The first augment is offered on spawn, alive, in the opening seconds.
  const spawnPick = picksTaken === 0 && input.gameTime < MAYHEM_SPAWN_PICK_SECONDS;
  if ((isDead || spawnPick) && levelReady) {
    pickWindowOpen = true;
    hint =
      picksTaken === 0 ? 'First augment — choose on screen' : `Augment pick (L${nextPickLevel})`;
  } else if (levelReady) {
    waitingForDeath = true;
    hint = `L${nextPickLevel} ready — die to open augment shop`;
  }

  const justDied = isDead && !wasDead;
  const ocrBurst = pickWindowOpen && (justDied || spawnPick);

  return {
    pickWindowOpen,
    waitingForDeath,
    hint,
    nextPickLevel,
    picksTaken,
    ocrBurst,
  };
}
