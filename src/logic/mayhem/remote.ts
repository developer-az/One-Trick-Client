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
