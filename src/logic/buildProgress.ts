/**
 * Track recommended-build purchase progress by item ID (not fuzzy names).
 * Order mirrors real support pacing: core rush → boots → 2nd core → situational.
 * Boots are NOT forced to the front of the checklist.
 */

import {
  ALL_BOOT_IDS,
  MID_TIER_BOOT_IDS,
  nextBootStep,
  ownsAnyCompleteBoots,
  ownsFinishedBoots,
} from './bootChains';

export interface BuildItemRef {
  id: string;
  name: string;
  reason?: string;
}

export interface BuildProgress {
  ownedIds: Set<string>;
  /** Ordered path: core → boots → core2 → situational */
  path: BuildItemRef[];
  remaining: BuildItemRef[];
  next: BuildItemRef | null;
  completedCount: number;
  hasBoots: boolean;
  hasFinishedBoots: boolean;
}

/** Support quest chain — owning any stage counts as "have Atlas". Never sell. */
export const SUPPORT_QUEST_IDS = new Set([
  '3865', // World Atlas
  '3866', // Runic Compass
  '3867', // Bounty of Worlds
  '3869', // Celestial Opposition
  '3870', // Dream Maker
  '3871', // Zaz'Zak's
  '3876', // Solstice Sleigh
  '3877', // Bloodsong
]);

export function trackBuildProgress(
  inventory: Array<{ itemID: number; displayName?: string; count?: number }> | undefined,
  build: {
    core: BuildItemRef[];
    boots: BuildItemRef;
    situational: BuildItemRef[];
  } | null | undefined
): BuildProgress {
  const ownedIds = new Set(
    (inventory || [])
      .filter((i) => i.itemID && i.itemID !== 0)
      .map((i) => String(i.itemID))
  );

  const hasBoots = [...ownedIds].some((id) => ALL_BOOT_IDS.has(id));
  const bootDone =
    (build?.boots ? ownsFinishedBoots(ownedIds, build.boots.id) : false) ||
    ownsAnyCompleteBoots(ownedIds);

  if (!build) {
    return {
      ownedIds,
      path: [],
      remaining: [],
      next: null,
      completedCount: 0,
      hasBoots,
      hasFinishedBoots: bootDone,
    };
  }

  const path: BuildItemRef[] = [];
  const pushUnique = (item: BuildItemRef) => {
    if (!path.some((p) => p.id === item.id)) path.push(item);
  };

  // 1) First core (Umbral / first legendary) — real first spike, before boots
  if (build.core[0]) pushUnique(build.core[0]);

  // 2) Boots mid-tier step (only after first core is owned, or if somehow already done)
  const firstCoreOwned =
    !build.core[0] ||
    ownedIds.has(String(build.core[0].id)) ||
    (build.core[0].id === '3865' && [...ownedIds].some((id) => SUPPORT_QUEST_IDS.has(id)));

  const bootStep = nextBootStep(ownedIds, build.boots.id);
  if (bootStep && !bootDone && firstCoreOwned) {
    const chainEnd = bootStep.id === build.boots.id;
    pushUnique({
      id: bootStep.id,
      name: bootStep.name,
      reason: chainEnd
        ? build.boots.reason || 'Finish boots (mid-tier is enough for support).'
        : `Boot path → ${build.boots.name}: buy ${bootStep.name} next.`,
    });
  } else if (build.boots && !bootDone && firstCoreOwned) {
    pushUnique({ ...build.boots });
  }

  // 3) Remaining core
  for (const c of build.core.slice(1)) pushUnique(c);

  // 4) If first core not owned yet, still surface boots after it in the list
  //    (so the full path is visible) but remaining[] will prioritize core first
  if (!firstCoreOwned && bootStep && !bootDone) {
    pushUnique({
      id: bootStep.id,
      name: bootStep.name,
      reason: build.boots.reason || 'Boots after first spike.',
    });
  }

  // 5) Top situational
  for (const s of build.situational.slice(0, 2)) pushUnique(s);

  const hasSupportQuest = [...ownedIds].some((id) => SUPPORT_QUEST_IDS.has(id));

  let completedCount = 0;
  let next: BuildItemRef | null = null;
  const remaining: BuildItemRef[] = [];
  for (const item of path) {
    const isBootStep = ALL_BOOT_IDS.has(item.id) || item.id === build.boots?.id;
    const owned =
      ownedIds.has(String(item.id)) ||
      (isBootStep && bootDone) ||
      (item.id === '3865' && hasSupportQuest) ||
      (item.id === '3877' && hasSupportQuest);
    if (owned) {
      completedCount++;
      continue;
    }
    remaining.push(item);
    if (!next) next = item;
  }

  return {
    ownedIds,
    path,
    remaining,
    next,
    completedCount,
    hasBoots,
    hasFinishedBoots: bootDone,
  };
}

/** Trinket / lens — not counted toward the six item slots. */
export const TRINKET_ITEM_IDS = new Set(['3340', '3363', '3364']);

export function countFilledItemSlots(
  inventory: Array<{ itemID: number }> | undefined
): number {
  return (inventory || []).filter((i) => {
    if (!i.itemID || i.itemID === 0) return false;
    const id = String(i.itemID);
    return !TRINKET_ITEM_IDS.has(id);
  }).length;
}

export interface SupportBootSlotAdvice {
  action: 'sell' | 'keep';
  label: string;
  detail: string;
}

/**
 * Six-slot support: sell boots for the last legendary when inventory is full.
 * Roam boots stay longer; behind = keep MS.
 */
export function supportBootSlotAdvice(
  inventory: Array<{ itemID: number }> | undefined,
  progress: BuildProgress,
  gameTimeSec: number,
  opts: { behind?: boolean } = {}
): SupportBootSlotAdvice | null {
  if (!progress.hasFinishedBoots || !progress.next) return null;
  if (ALL_BOOT_IDS.has(progress.next.id)) return null;

  const filled = countFilledItemSlots(inventory);
  if (filled < 6) return null;

  const minutes = gameTimeSec / 60;
  const ownedBootId = [...progress.ownedIds].find((id) => ALL_BOOT_IDS.has(id) || MID_TIER_BOOT_IDS.has(id));
  const roamBoot = ownedBootId === '3158' || ownedBootId === '3009';

  if (opts.behind) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: 'Full inventory but behind — MS beats one extra component right now.',
    };
  }

  if (roamBoot && minutes < 20) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: 'Roam boots still pay off — finish another core before selling.',
    };
  }

  if (minutes < 13) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: 'Mid game — keep boots until two cores + quest are done.',
    };
  }

  return {
    action: 'sell',
    label: 'Sell boots',
    detail: `Six items — sell boots to buy ${progress.next.name}. Re-buy boots after if gold allows.`,
  };
}

/** Name fallback for items that finished but ID drifted (rare). */
export function inventoryHasName(
  inventory: Array<{ displayName?: string }> | undefined,
  fragments: string[]
): boolean {
  const names = (inventory || []).map((i) => (i.displayName || '').toLowerCase());
  return fragments.some((f) => names.some((n) => n.includes(f)));
}
