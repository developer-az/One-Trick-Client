import { sanitizeMayhemBundle } from './bundleSanitize';
import { inferAugmentTags } from './synergy';
import type { MayhemAugment, MayhemBundle, MayhemRarity } from './types';

type AugRow = Record<string, unknown> & {
  augmentId?: string;
  slug?: string;
  name?: { en?: string };
  rarity?: string;
  pickRate?: number;
  pickRateRank?: number;
  retiredPatch?: string | null;
};

function rowToAugment(r: AugRow, legacy: boolean): MayhemAugment {
  const nameObj = r.name as { en?: string } | undefined;
  const name = nameObj?.en || String(r.augmentId);
  const id = String(r.augmentId);
  const slug = String(r.slug || id);
  return {
    id,
    slug,
    name,
    rarity: String(r.rarity || 'silver') as MayhemRarity,
    pickRate: legacy ? 0 : Number(r.pickRate) || 0,
    pickRateRank: legacy ? 9999 : Number(r.pickRateRank) || 999,
    tags: inferAugmentTags(id, slug, name),
    legacy: legacy || undefined,
  };
}

export function slimMayhemFromApi(augDoc: unknown, comboDoc: unknown): MayhemBundle {
  const augMeta = (augDoc as { meta?: { patch?: string; statsDate?: string } }).meta || {};
  const allRows = ((augDoc as { rows?: AugRow[] }).rows || []) as AugRow[];
  const comboRows =
    (comboDoc as { rows: Array<{ championId: string; augmentIds: string[]; types: string[] }> }).rows ||
    [];

  const referencedInCombos = new Set<string>();
  for (const row of comboRows) {
    for (const id of row.augmentIds || []) referencedInCombos.add(id);
  }

  const augments: MayhemAugment[] = [];
  const seen = new Set<string>();

  for (const r of allRows) {
    if (r.retiredPatch) continue;
    const aug = rowToAugment(r, false);
    if (seen.has(aug.id)) continue;
    seen.add(aug.id);
    augments.push(aug);
  }

  for (const r of allRows) {
    if (!r.retiredPatch) continue;
    const id = String(r.augmentId);
    if (seen.has(id) || !referencedInCombos.has(id)) continue;
    seen.add(id);
    augments.push(rowToAugment(r, true));
  }

  const raw: MayhemBundle = {
    meta: {
      patch: augMeta.patch || 'unknown',
      statsDate: augMeta.statsDate || '',
      attribution: 'Data: arammayhem.com',
      source: 'https://arammayhem.com/data/',
      syncedAt: new Date().toISOString(),
    },
    augments,
    combos: comboRows.map((r) => ({
      championId: r.championId,
      augmentIds: r.augmentIds,
      types: r.types || [],
    })),
  };

  return sanitizeMayhemBundle(raw);
}

/** Refresh the bundle at least this often, even when the patch is unchanged. */
export const MAYHEM_BUNDLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type MayhemRefreshReason = 'missing-cache' | 'patch-mismatch' | 'stale' | 'fresh';

export interface MayhemRefreshDecision {
  refresh: boolean;
  reason: MayhemRefreshReason;
}

export interface MayhemBundleMetaLike {
  patch?: string;
  syncedAt?: string;
}

/**
 * The patch identity shared by the two naming schemes.
 *
 * arammayhem labels a patch by season-year (`26.22`) while Data Dragon / the
 * client version use the season counter (`16.23.1`); both advance their minor
 * in lock-step, so the minor is what identifies a patch across the two. A
 * patch without a dot is compared as-is.
 */
function patchKey(patch: string | undefined | null): string {
  const match = /(\d+)\.(\d+)/.exec(String(patch ?? ''));
  return match ? match[2] : String(patch ?? '').trim().toLowerCase();
}

/**
 * When the cached Mayhem data must be re-fetched.
 *
 * Follow the live patch: a cache from another patch is stale by definition
 * (new augments are exactly what a patch changes). The 24 h age keeps
 * pick-rate numbers moving even when the patch did not. No cache at all always
 * refreshes once.
 */
export function shouldRefreshMayhemBundle(input: {
  cached: MayhemBundleMetaLike | null;
  /** Current game patch, e.g. from the Data Dragon version list. */
  currentPatch: string | null;
  nowMs: number;
  maxAgeMs?: number;
}): MayhemRefreshDecision {
  const { cached, currentPatch, nowMs } = input;
  const maxAgeMs = input.maxAgeMs ?? MAYHEM_BUNDLE_MAX_AGE_MS;
  if (!cached) return { refresh: true, reason: 'missing-cache' };

  if (currentPatch) {
    if (patchKey(cached.patch) !== patchKey(currentPatch)) {
      return { refresh: true, reason: 'patch-mismatch' };
    }
  }

  const syncedAt = Date.parse(String(cached.syncedAt ?? ''));
  if (!Number.isFinite(syncedAt)) return { refresh: true, reason: 'stale' };
  if (nowMs - syncedAt > maxAgeMs) return { refresh: true, reason: 'stale' };
  return { refresh: false, reason: 'fresh' };
}

export interface MayhemRefreshRunResult<T> {
  decision: MayhemRefreshDecision;
  /** The data the app should run on: fresh when fetched, existing otherwise. */
  bundle: T | null;
  refreshed: boolean;
  /** Present only when a refresh was attempted and failed. */
  error?: string;
}

/**
 * Apply the freshness policy with an injected fetch, so the failure path is
 * provable without the network: a failed refresh is silent and keeps whatever
 * cached/bundled data the app already had.
 */
export async function refreshMayhemBundleIfStale<T>(input: {
  cached: MayhemBundleMetaLike | null;
  currentPatch: string | null;
  existing: T | null;
  nowMs: number;
  maxAgeMs?: number;
  fetchBundle: () => Promise<T>;
}): Promise<MayhemRefreshRunResult<T>> {
  const decision = shouldRefreshMayhemBundle(input);
  if (!decision.refresh) {
    return { decision, bundle: input.existing, refreshed: false };
  }
  try {
    const bundle = await input.fetchBundle();
    return { decision, bundle, refreshed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { decision, bundle: input.existing, refreshed: false, error: message };
  }
}
