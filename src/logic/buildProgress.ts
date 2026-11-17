/**
 * Track recommended-build purchase progress by item ID (not fuzzy names).
 * Order mirrors real support pacing: core rush → boots → 2nd core → situational.
 * Boots are NOT forced to the front of the checklist.
 */

import {
  ALL_BOOT_IDS,
  BASE_BOOT_ID,
  MID_TIER_BOOT_IDS,
  bootChainIds,
  bootStepName,
  ownsAnyCompleteBoots,
  ownsFinishedBoots,
} from './bootChains';
import { isComponentItemId, isLegendaryItemId } from './itemTier';

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

/** A boots chain step with a human reason. */
function bootStepRef(id: string, recommended: { id: string; name: string; reason?: string }): BuildItemRef {
  const chain = bootChainIds(recommended.id);
  const isLast = chain[chain.length - 1] === id;
  if (id === BASE_BOOT_ID) {
    return {
      id,
      name: bootStepName(id),
      reason: `Base Boots (${bootStepName(id)}) — ${recommended.name} needs Boots first.`,
    };
  }
  if (isLast && recommended.id === id) {
    return {
      id,
      name: bootStepName(id),
      reason: recommended.reason || `Finish ${recommended.name} — mid-tier is enough for support.`,
    };
  }
  return {
    id,
    name: bootStepName(id),
    reason: `Boot path → ${recommended.name}: buy ${bootStepName(id)} next.`,
  };
}

/**
 * The one ordered buy path for a build, resolved live against inventory:
 * first core → base Boots if absent → recommended mid-tier boots → remaining
 * core → situational. A higher boot tier (Noxian upgrade) only ever appears
 * when its ID is the build's own recommendation, and owning any complete boots
 * absorbs the whole boot segment (base Boots are consumed into them, so the
 * base step is never offered again). Every id appears at most once.
 */
export function resolveOrderedBuyPath(
  build: {
    core: BuildItemRef[];
    boots: BuildItemRef;
    situational: BuildItemRef[];
  } | null | undefined,
  ownedIds: ReadonlySet<string>
): BuildItemRef[] {
  if (!build) return [];
  const path: BuildItemRef[] = [];
  const seen = new Set<string>();
  const push = (item: BuildItemRef): void => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    path.push(item);
  };

  // 1) First core — the real first spike, ahead of boots.
  if (build.core[0]) push(build.core[0]);

  // 2) Boots segment, driven by the recommended chain resolved against what is
  //    actually owned: base Boots first when absent, then the mid-tier, then an
  //    upgrade tier only when the build's own recommendation is that upgrade.
  //    Owning a step later on the same line consumes the steps before it (so
  //    1001 is never offered again), and owning complete boots of a different
  //    line stops this segment without re-buying a second pair.
  const chain = bootChainIds(build.boots.id);
  const pendingFor = (id: string | undefined): boolean => !!id && ownedIds.has(id);
  const progress =
    pendingFor(chain[2]) ? 3 : pendingFor(chain[1]) ? 2 : pendingFor(chain[0]) ? 1 : 0;
  if (progress < chain.length) {
    const bootsOwnedElsewhere =
      ownsAnyCompleteBoots(ownedIds) && !ownedIds.has(chain[0]) && !ownedIds.has(chain[1] ?? '');
    if (!(progress === 0 && bootsOwnedElsewhere)) {
      for (let i = progress; i < chain.length; i++) {
        const id = chain[i];
        if (ownedIds.has(id)) continue;
        push(bootStepRef(id, build.boots));
      }
    }
  }

  // 3) Remaining core after the boot segment.
  for (const c of build.core.slice(1)) push(c);

  // 4) Top situational.
  for (const s of build.situational.slice(0, 2)) push(s);

  return path;
}

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

  const path = resolveOrderedBuyPath(build, ownedIds);
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

const INVENTORY_PRESSURE_SKIP = new Set(['2055', '2003', '2010', '2138', '2139', '2140']);

/**
 * Slots occupied by items that meaningfully block finishing the build path
 * (excludes trinkets, pinks, pots, and cheap components).
 */
export function inventoryPressureSlots(
  inventory: Array<{ itemID: number; displayName?: string }> | undefined
): number {
  let pressure = 0;
  for (const row of inventory || []) {
    if (!row.itemID || row.itemID === 0) continue;
    const id = String(row.itemID);
    if (TRINKET_ITEM_IDS.has(id)) continue;
    if (INVENTORY_PRESSURE_SKIP.has(id)) continue;
    if (isComponentItemId(id)) continue;
    pressure += 1;
  }
  return pressure;
}

export interface SupportBuildMaturity {
  legendariesOnPath: number;
  ownedLegendaries: number;
  /** True when only the final legendary (or last path step) remains unowned. */
  nearComplete: boolean;
}

function pathLegendaryStep(item: BuildItemRef, bootsId?: string): boolean {
  if (ALL_BOOT_IDS.has(item.id) || MID_TIER_BOOT_IDS.has(item.id)) return false;
  if (bootsId && item.id === bootsId) return false;
  if (item.id === '1001') return false;
  return isLegendaryItemId(item.id) || item.id === '3865' || item.id === '3877';
}

export function supportBuildMaturity(
  progress: BuildProgress,
  build: { boots?: BuildItemRef } | null | undefined
): SupportBuildMaturity {
  const legendarySteps = progress.path.filter((item) => pathLegendaryStep(item, build?.boots?.id));
  const hasSupportQuest = [...progress.ownedIds].some((id) => SUPPORT_QUEST_IDS.has(id));
  const owned = legendarySteps.filter((item) => {
    if (progress.ownedIds.has(item.id)) return true;
    if (item.id === '3865' && hasSupportQuest) return true;
    if (item.id === '3877' && hasSupportQuest) return true;
    return false;
  });
  const nearComplete =
    legendarySteps.length > 0 && owned.length >= Math.max(1, legendarySteps.length - 1);
  return {
    legendariesOnPath: legendarySteps.length,
    ownedLegendaries: owned.length,
    nearComplete,
  };
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
  opts: { behind?: boolean; build?: { boots?: BuildItemRef } | null } = {}
): SupportBootSlotAdvice | null {
  if (!progress.hasFinishedBoots || !progress.next) return null;
  if (ALL_BOOT_IDS.has(progress.next.id)) return null;

  const filled = countFilledItemSlots(inventory);
  const pressure = inventoryPressureSlots(inventory);
  if (filled < 6 && pressure < 5) return null;

  const maturity = supportBuildMaturity(progress, opts.build ?? null);
  if (!maturity.nearComplete) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: 'Inventory full but build not finished — complete cores before selling MS.',
    };
  }
  if (!isLegendaryItemId(progress.next.id)) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: `Next buy ${progress.next.name} is not your final spike — keep boots for now.`,
    };
  }
  if (pressure < 5) {
    return {
      action: 'keep',
      label: 'Keep boots',
      detail: 'Components and wards filling slots — finish items before selling boots.',
    };
  }

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
