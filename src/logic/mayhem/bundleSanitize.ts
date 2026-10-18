import type { MayhemAugment, MayhemBundle, MayhemCombo } from './types';

/** Editorial labels from arammayhem.com — not Riot item tags. */
export const KNOWN_COMBO_TYPES = new Set([
  'god',
  'strong',
  'blackTech',
  'entertainment',
  'trap',
  'bug',
]);

export function normalizeComboTypes(types: string[]): string[] {
  return (types || []).filter((t) => KNOWN_COMBO_TYPES.has(t));
}

export interface BundleSanitizeStats {
  combosIn: number;
  combosOut: number;
  combosDroppedMissingAugment: number;
  combosDroppedEmptyTypesOnSingle: number;
}

export function sanitizeMayhemBundle(
  bundle: MayhemBundle,
  stats?: BundleSanitizeStats
): MayhemBundle {
  const augmentIds = new Set(bundle.augments.map((a) => a.id));
  let droppedMissing = 0;
  let droppedSilentSingle = 0;

  const combos: MayhemCombo[] = [];
  for (const raw of bundle.combos) {
    const types = normalizeComboTypes(raw.types);
    const augmentIdsInCombo = raw.augmentIds.filter((id) => augmentIds.has(id));
    if (augmentIdsInCombo.length !== raw.augmentIds.length) {
      droppedMissing += 1;
      continue;
    }
    if (augmentIdsInCombo.length === 0) continue;

    if (augmentIdsInCombo.length === 1 && types.length === 0) {
      droppedSilentSingle += 1;
      continue;
    }

    combos.push({
      championId: raw.championId,
      augmentIds: augmentIdsInCombo,
      types,
    });
  }

  if (stats) {
    stats.combosIn = bundle.combos.length;
    stats.combosOut = combos.length;
    stats.combosDroppedMissingAugment = droppedMissing;
    stats.combosDroppedEmptyTypesOnSingle = droppedSilentSingle;
  }

  return { ...bundle, combos };
}

export function validateMayhemBundle(bundle: MayhemBundle): string[] {
  const errors: string[] = [];
  const augIds = new Set(bundle.augments.map((a) => a.id));

  for (const combo of bundle.combos) {
    for (const id of combo.augmentIds) {
      if (!augIds.has(id)) errors.push(`combo references missing augment: ${id}`);
    }
    for (const t of combo.types) {
      if (!KNOWN_COMBO_TYPES.has(t)) errors.push(`unknown combo type: ${t}`);
    }
    if (combo.augmentIds.length === 1 && combo.types.length === 0) {
      errors.push(`single-augment combo without editorial type: ${combo.championId}/${combo.augmentIds[0]}`);
    }
  }

  const live = bundle.augments.filter((a) => !a.legacy);
  if (live.length < 50) errors.push(`too few live augments: ${live.length}`);

  return errors;
}

export function isLiveMayhemAugment(aug: MayhemAugment): boolean {
  return !aug.legacy;
}
