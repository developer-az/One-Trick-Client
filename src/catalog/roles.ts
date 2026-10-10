import type { CatalogRole } from './types';
import { CATALOG_ROLES } from './types';

const LCU_ROLE: Record<string, CatalogRole> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  MID: 'Mid',
  BOTTOM: 'Bot',
  BOT: 'Bot',
  UTILITY: 'Support',
  SUPPORT: 'Support',
  ADC: 'Bot',
  NONE: 'Mid',
};

const LIVE_ROLE: Record<string, CatalogRole> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  MID: 'Mid',
  BOTTOM: 'Bot',
  BOT: 'Bot',
  UTILITY: 'Support',
  SUPPORT: 'Support',
  ADC: 'Bot',
};

export function isCatalogRole(value: unknown): value is CatalogRole {
  return typeof value === 'string' && (CATALOG_ROLES as string[]).includes(value);
}

export function roleFromLcuPosition(position: string | null | undefined): CatalogRole | null {
  if (!position) return null;
  return LCU_ROLE[position.trim().toUpperCase()] || null;
}

export function roleFromLivePosition(position: string | null | undefined): CatalogRole | null {
  if (!position) return null;
  return LIVE_ROLE[position.trim().toUpperCase()] || roleFromLcuPosition(position);
}

/** Tag heuristic when Live Client / LCU omit assigned position. */
export function roleFromChampionTags(tags: string[] | null | undefined): CatalogRole {
  const t = tags || [];
  if (t.includes('Support')) return 'Support';
  if (t.includes('Marksman')) return 'Bot';
  if (t.includes('Assassin') || t.includes('Mage')) return 'Mid';
  if (t.includes('Tank') || t.includes('Fighter')) return 'Top';
  return 'Mid';
}

export function cdragonPositionToRole(position: string | null | undefined): CatalogRole | null {
  if (!position) return null;
  const upper = position.trim().toUpperCase();
  if (upper === 'NONE') return null;
  return roleFromLcuPosition(upper);
}
