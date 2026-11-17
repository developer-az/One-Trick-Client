/**
 * Item tier heuristics when the full catalog bundle is not loaded (overlay / verify).
 * Aligns with `isLegendaryCatalogItem` in buildCatalog when metadata is present.
 */

import type { CatalogItem } from '../catalog/types';
import { isLegendaryCatalogItem } from '../catalog/buildCatalog';
import { ALL_BOOT_IDS, MID_TIER_BOOT_IDS } from './bootChains';
import { SUPPORT_QUEST_IDS, TRINKET_ITEM_IDS } from './buildProgress';

const CONSUMABLE_IDS = new Set(['2003', '2010', '2138', '2139', '2140', '2031', '2033']);
const NON_PRESSURE_IDS = new Set(['2055', '1001']);

/** Finished legendaries and epic support items that block a build slot meaningfully. */
const KNOWN_FINISHED_IDS = new Set([
  '1055',
  '1056',
  '1082',
  '3020',
  '3044',
  '3053',
  '3070',
  '3078',
  '3107',
  '3109',
  '3110',
  '3111',
  '3112',
  '3115',
  '3116',
  '3117',
  '3124',
  '3133',
  '3134',
  '3137',
  '3139',
  '3142',
  '3143',
  '3153',
  '3165',
  '3170',
  '3171',
  '3172',
  '3173',
  '3174',
  '3179',
  '3181',
  '3193',
  '3508',
  '3742',
  '3748',
  '3814',
  '3869',
  '3870',
  '3871',
  '3876',
  '3877',
]);

export function isComponentItemId(id: string): boolean {
  if (TRINKET_ITEM_IDS.has(id) || CONSUMABLE_IDS.has(id) || NON_PRESSURE_IDS.has(id)) return false;
  if (ALL_BOOT_IDS.has(id) || MID_TIER_BOOT_IDS.has(id)) return id === '1001';
  if (KNOWN_FINISHED_IDS.has(id)) return false;
  if (SUPPORT_QUEST_IDS.has(id) && id !== '3865') {
    return id !== '3877' && id !== '3869';
  }
  const n = Number(id);
  if (Number.isNaN(n)) return false;
  if (n < 3000) return true;
  return false;
}

export function isLegendaryItemId(id: string, catalogItem?: Pick<CatalogItem, 'id' | 'gold' | 'into' | 'tags' | 'purchasable'> | null): boolean {
  if (catalogItem && catalogItem.id === id) return isLegendaryCatalogItem(catalogItem);
  if (TRINKET_ITEM_IDS.has(id) || CONSUMABLE_IDS.has(id) || NON_PRESSURE_IDS.has(id)) return false;
  if (ALL_BOOT_IDS.has(id) || MID_TIER_BOOT_IDS.has(id)) return false;
  if (isComponentItemId(id)) return false;
  if (KNOWN_FINISHED_IDS.has(id)) return true;
  if (SUPPORT_QUEST_IDS.has(id) && (id === '3877' || id === '3869')) return true;
  const n = Number(id);
  return !Number.isNaN(n) && n >= 3000;
}