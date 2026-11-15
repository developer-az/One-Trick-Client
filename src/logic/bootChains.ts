/**
 * Season boot lines: supports stop at mid-tier (Ionian / Swiftness / Mercs / Steelcaps).
 * Noxian upgrades (Swiftmarch, Crimson Lucidity, …) are optional and only exported
 * when a build explicitly recommends the upgrade ID (carry profiles).
 */

/** Final upgrade → full chain. Mid-tier keys stop at mid (support-complete). */
const CHAINS: Record<string, string[]> = {
  // Support / mid-tier targets — do NOT auto-push Noxian upgrades
  '3009': ['1001', '3009'], // Boots → Swiftness
  '3158': ['1001', '3158'], // Boots → Ionian
  '3111': ['1001', '3111'], // Boots → Mercs
  '3047': ['1001', '3047'], // Boots → Steelcaps
  '3006': ['1001', '3006'], // Boots → Berserker's
  // Explicit upgrade recommendations (carry / optional)
  '3170': ['1001', '3009', '3170'], // → Swiftmarch
  '3171': ['1001', '3158', '3171'], // → Crimson Lucidity
  '3173': ['1001', '3111', '3173'], // → Crushers
  '3174': ['1001', '3047', '3174'], // → Armored Advance
  '3172': ['1001', '3006', '3172'], // → Gunmetal Greaves
  '1001': ['1001'],
};

/** Base Boots — the shared first step of every boot chain. */
export const BASE_BOOT_ID = '1001';

/** Mid-tier boots that count as "boots done" for supports. */
export const MID_TIER_BOOT_IDS = new Set(['3009', '3158', '3111', '3047', '3006', '3020']);

/** Noxian / finished upgrades. */
export const UPGRADE_BOOT_IDS = new Set(['3170', '3171', '3172', '3173', '3174', '3175', '3168']);

const NAMES: Record<string, string> = {
  '1001': 'Boots',
  '3006': "Berserker's Greaves",
  '3009': 'Boots of Swiftness',
  '3020': "Sorcerer's Shoes",
  '3047': 'Plated Steelcaps',
  '3111': "Mercury's Treads",
  '3158': 'Ionian Boots of Lucidity',
  '3170': 'Swiftmarch',
  '3171': 'Crimson Lucidity',
  '3172': 'Gunmetal Greaves',
  '3173': 'Chainlaced Crushers',
  '3174': 'Armored Advance',
};

/** Map any boot ID to its mid-tier (support-complete) target. */
export function midTierBootId(id: string): string {
  const chain = CHAINS[id] || CHAINS[finalizeBootId(id)];
  if (!chain || chain.length < 2) return id === '1001' ? '1001' : id;
  // Prefer mid-tier slot (index 1); upgrades sit at index 2
  return chain[Math.min(1, chain.length - 1)];
}

/** Normalize to finished upgrade when the ID is on an upgrade line. */
export function finalizeBootId(id: string): string {
  const upgradeOf: Record<string, string> = {
    '3009': '3170',
    '3158': '3171',
    '3111': '3173',
    '3047': '3174',
    '3006': '3172',
  };
  if (UPGRADE_BOOT_IDS.has(id)) return id;
  return upgradeOf[id] || id;
}

/** Shop chain for the recommendation — mid-tier IDs stop before upgrades. */
export function bootChainIds(recommendedId: string): string[] {
  if (CHAINS[recommendedId]) return CHAINS[recommendedId];
  const mid = midTierBootId(recommendedId);
  if (CHAINS[mid]) return CHAINS[mid];
  return [BASE_BOOT_ID, recommendedId];
}

/** Display name for any step on a boot chain. */
export function bootStepName(id: string): string {
  return NAMES[id] || `Item ${id}`;
}

/** True when the ID is a boot at any tier (base, mid, or upgrade). */
export function isBootId(id: string): boolean {
  return ALL_BOOT_IDS.has(id) || MID_TIER_BOOT_IDS.has(id) || UPGRADE_BOOT_IDS.has(id) || id === BASE_BOOT_ID;
}

export function bootChainItems(recommendedId: string): Array<{ id: string; name: string }> {
  return bootChainIds(recommendedId).map((id) => ({
    id,
    name: NAMES[id] || `Item ${id}`,
  }));
}

/** Owns the recommended boot target (mid-tier or explicit upgrade). */
export function ownsFinishedBoots(ownedIds: ReadonlySet<string>, recommendedId: string): boolean {
  const chain = bootChainIds(recommendedId);
  const target = chain[chain.length - 1];
  if (ownedIds.has(target)) return true;
  // Bought the Noxian upgrade of the same line
  const upgrade = finalizeBootId(recommendedId);
  if (ownedIds.has(upgrade)) return true;
  return false;
}

/** Any mid-tier or upgrade boots in inventory — checklist should stop. */
export function ownsAnyCompleteBoots(ownedIds: ReadonlySet<string>): boolean {
  for (const id of ownedIds) {
    if (MID_TIER_BOOT_IDS.has(id) || UPGRADE_BOOT_IDS.has(id)) return true;
  }
  return false;
}

/** Next unowned step; null once mid/upgrade boots exist (any line). */
export function nextBootStep(
  ownedIds: ReadonlySet<string>,
  recommendedId: string
): { id: string; name: string } | null {
  if (ownsAnyCompleteBoots(ownedIds)) return null;
  if (ownsFinishedBoots(ownedIds, recommendedId)) return null;
  const chain = bootChainIds(recommendedId);
  for (const id of chain) {
    if (!ownedIds.has(id)) return { id, name: NAMES[id] || `Item ${id}` };
  }
  return null;
}

export const ALL_BOOT_IDS = new Set([
  ...Object.keys(NAMES),
  '3008', // Gluttonous Greaves
  '3168', // Immortal Path
  '3175', // Spellslinger's
]);
