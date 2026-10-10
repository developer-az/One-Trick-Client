import type { Build, Item, RunePage } from '../logic/pykeLogic';
import { getRuneMeta, getStyleMeta } from '../data/runeService';
import type { CatalogItem, CatalogRecommendation } from './types';

const SPELL_NAME: Record<number, string> = {
  4: 'Flash',
  11: 'Smite',
  12: 'Teleport',
  14: 'Ignite',
  3: 'Exhaust',
  7: 'Heal',
  21: 'Barrier',
  6: 'Ghost',
  1: 'Cleanse',
};

function toItem(id: string, items: Map<string, CatalogItem>, reason: string): Item {
  const meta = items.get(id);
  return {
    id,
    name: meta?.name || `Item ${id}`,
    icon: meta?.name?.replace(/[^a-zA-Z0-9]+/g, '_') || id,
    reason,
  };
}

export function recommendationToBuild(
  rec: CatalogRecommendation,
  items: Map<string, CatalogItem>
): Build {
  const starter = rec.starter.map((id, index) =>
    toItem(id, items, index === 0 ? 'Lane start from the live catalog.' : 'Early sustain / components.')
  );
  const core = rec.core.map((id) => toItem(id, items, 'Tag-scored core from the current item set.'));
  const boots = toItem(rec.boots, items, 'Boots for this role / damage type.');
  const situational = rec.situational.map((id) => toItem(id, items, 'Situational answer if the draft asks.'));
  const spells = (rec.summonerSpellIds || []).map((id) => SPELL_NAME[id] || `Spell ${id}`);
  return {
    starter,
    core,
    situational,
    boots,
    buildPath: [...starter, boots, ...core],
    spells: spells.length ? spells : ['Flash', 'Ignite'],
  };
}

export function recommendationToRunes(rec: CatalogRecommendation, pageName: string): RunePage {
  const reasons: Record<number, string> = {};
  for (const id of rec.selectedPerkIds) {
    reasons[id] = getRuneMeta(id).name;
  }
  reasons[rec.primaryStyleId] = getStyleMeta(rec.primaryStyleId).name;
  reasons[rec.subStyleId] = getStyleMeta(rec.subStyleId).name;
  return {
    primaryStyleId: rec.primaryStyleId,
    subStyleId: rec.subStyleId,
    selectedPerkIds: rec.selectedPerkIds.slice(0, 9),
    name: pageName,
    reasons,
  };
}
