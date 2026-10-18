import type { Champion } from '../pykeLogic';
import { CHAMPION_POSITIONS } from '../championPositions';
import { resolveChampionRef } from '../../data/championCatalog';

function damageTypeFromTags(tags: string[]): Champion['damageType'] {
  if (tags.includes('Mage')) return 'Magic';
  if (tags.includes('Marksman') || tags.includes('Assassin') || tags.includes('Fighter')) return 'Physical';
  if (tags.includes('Tank') || tags.includes('Support')) return 'Physical';
  return 'Physical';
}

/** Live-client name → DDragon id (Pyke, MissFortune, …) for combo tables. */
export function championForMayhem(
  liveName: string | null | undefined,
  roster: Champion[]
): Champion | null {
  const name = liveName?.trim();
  if (!name) return null;

  const ref = resolveChampionRef({ name });
  if (ref) {
    const full =
      roster.find((c) => c.id === ref.id) ||
      roster.find((c) => c.name.toLowerCase() === ref.name.toLowerCase());
    if (full && (full.tags?.length || full.damageType)) return full;

    const tags = full?.tags?.length ? full.tags : rosterTagsForId(ref.id);
    return {
      id: ref.id,
      key: ref.key,
      name: ref.name,
      tags: tags.length ? tags : ['Fighter'],
      damageType: full?.damageType || damageTypeFromTags(tags),
    };
  }

  const lower = name.toLowerCase();
  return (
    roster.find((c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower) || null
  );
}

function rosterTagsForId(championId: string): string[] {
  const role = CHAMPION_POSITIONS[championId]?.[0];
  if (role === 'Bot') return ['Marksman'];
  if (role === 'Support') return ['Support'];
  if (role === 'Mid') return ['Mage'];
  if (role === 'Jungle') return ['Fighter'];
  if (role === 'Top') return ['Fighter'];
  return [];
}
