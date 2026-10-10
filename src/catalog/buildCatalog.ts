import {
  AUTHORED_CATALOG_PROFILES,
  type CatalogBundle,
  type CatalogChampion,
  type CatalogItem,
  type CatalogRecommendation,
  type CatalogRole,
  type CatalogRuneTree,
} from './types';
import { cdragonPositionToRole, roleFromChampionTags } from './roles';

const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CDRAGON_SUMMARY =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json';
const CDRAGON_RUNE_RECS =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-rune-recommendations.json';

/** Removed / unbuyable leftovers we still sanity-check against live item.json. */
export const DEAD_ITEM_IDS = [
  '3850',
  '3851',
  '3853',
  '3854',
  '3855',
  '3857',
  '3858',
  '3859',
  '3860',
  '3862',
  '3863',
  '3864',
  '3867',
  '3177',
] as const;

const FALLBACK_BOOTS: Record<CatalogRole, string> = {
  Support: '3009',
  Mid: '3020',
  Top: '3047',
  Jungle: '3006',
  Bot: '3006',
};

const FALLBACK_STARTER: Record<CatalogRole, string[]> = {
  Support: ['3865', '2003', '2003'],
  Mid: ['1056', '2003'],
  Top: ['1054', '2003'],
  Jungle: ['1101', '2003'],
  Bot: ['1055', '2003'],
};

const SITUATIONAL_POOL = ['3156', '3026', '3139', '6695', '3143', '6662', '3814', '3179'];

interface DDragonChampion {
  id: string;
  key: string;
  name: string;
  tags: string[];
  info?: { magic?: number; attack?: number };
}

interface DDragonItem {
  name: string;
  gold?: { total?: number; purchasable?: boolean };
  tags?: string[];
  from?: string[];
  into?: string[];
  maps?: Record<string, boolean>;
  requiredAlly?: string;
  hideFromAll?: boolean;
  consumed?: boolean;
}

interface CDragonRuneRec {
  championId: number;
  runeRecommendations?: Array<{
    position?: string;
    mapId?: number;
    isDefaultPosition?: boolean;
    perkIds?: number[];
    primaryPerkStyleId?: number;
    secondaryPerkStyleId?: number;
    summonerSpellIds?: number[];
  }>;
}

interface CDragonSummary {
  id: number;
  alias?: string;
  name?: string;
  roles?: string[];
}

export function determineDamageType(
  tags: string[],
  info?: { magic?: number; attack?: number }
): CatalogChampion['damageType'] {
  if (info && info.magic !== undefined && info.attack !== undefined) {
    if (info.magic > 5 && info.attack > 5) return 'Mixed';
    if (info.magic > info.attack) return 'Magic';
    if (info.attack > info.magic) return 'Physical';
  }
  if (tags.includes('Mage')) return 'Magic';
  if (tags.includes('Marksman') || tags.includes('Assassin') || tags.includes('Fighter')) {
    return 'Physical';
  }
  if (tags.includes('Support')) return 'Magic';
  return 'Physical';
}

function onSummonersRift(item: DDragonItem): boolean {
  return item.maps?.['11'] !== false;
}

function isLivePurchasable(item: DDragonItem): boolean {
  if (item.hideFromAll || item.requiredAlly || item.consumed) return false;
  return item.gold?.purchasable !== false;
}

function legendary(item: CatalogItem): boolean {
  return item.purchasable && item.gold >= 2000 && item.into.length === 0 && !item.tags.includes('Boots');
}

function bootsCandidate(item: CatalogItem): boolean {
  return item.purchasable && item.tags.includes('Boots') && item.gold >= 900 && item.gold <= 1600;
}

function starterCandidate(item: CatalogItem, role: CatalogRole): boolean {
  if (!item.purchasable || item.gold > 550) return false;
  if (item.tags.includes('Trinket')) return false;
  if (role === 'Jungle') return item.tags.includes('Jungle') || item.id === '1101' || item.id === '1102' || item.id === '1103';
  if (role === 'Support') {
    return (
      item.id === '3865' ||
      item.id === '3866' ||
      item.tags.includes('GoldPer') ||
      item.tags.includes('Lane') ||
      item.id === '2003'
    );
  }
  return item.tags.includes('Lane') || ['1054', '1055', '1056', '1082', '3070', '2003'].includes(item.id);
}

function tagScore(item: CatalogItem, tags: string[], role: CatalogRole): number {
  let score = 0;
  for (const tag of tags) {
    if (item.tags.includes(tag)) score += 4;
  }
  if (role === 'Support' && (item.tags.includes('GoldPer') || item.name.includes('Atlas'))) score += 6;
  if (role === 'Jungle' && item.tags.includes('Jungle')) score += 6;
  if (role === 'Mid' && (item.tags.includes('SpellDamage') || item.tags.includes('Mana'))) score += 2;
  if ((role === 'Bot' || role === 'Top') && item.tags.includes('Damage')) score += 2;
  if (item.tags.includes('ArmorPen') || item.tags.includes('SpellVamp') || item.tags.includes('LifeSteal')) {
    score += 1;
  }
  return score;
}

function pickBoots(items: CatalogItem[], tags: string[], role: CatalogRole): string {
  const boots = items.filter(bootsCandidate);
  if (tags.includes('Mage') || tags.includes('Support')) {
    const mage = boots.find((i) => i.id === '3020' || i.id === '3158' || i.id === '3009');
    if (mage) return mage.id;
  }
  if (tags.includes('Marksman') || tags.includes('Assassin')) {
    const swift = boots.find((i) => i.id === '3006' || i.id === '3009');
    if (swift) return swift.id;
  }
  if (tags.includes('Tank')) {
    const tank = boots.find((i) => i.id === '3047' || i.id === '3111');
    if (tank) return tank.id;
  }
  return boots.sort((a, b) => tagScore(b, tags, role) - tagScore(a, tags, role))[0]?.id || FALLBACK_BOOTS[role];
}

function pickStarters(items: CatalogItem[], role: CatalogRole): string[] {
  const pool = items.filter((item) => starterCandidate(item, role));
  const preferred = FALLBACK_STARTER[role]
    .map((id) => pool.find((item) => item.id === id) || items.find((item) => item.id === id))
    .filter((item): item is CatalogItem => !!item)
    .map((item) => item.id);
  if (preferred.length) return preferred.slice(0, 3);
  return pool.slice(0, 2).map((item) => item.id);
}

function pickCore(items: CatalogItem[], tags: string[], role: CatalogRole): string[] {
  return items
    .filter(legendary)
    .map((item) => ({ item, score: tagScore(item, tags, role) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.gold - a.item.gold)
    .slice(0, 3)
    .map((row) => row.item.id);
}

function pickSituational(items: CatalogItem[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return SITUATIONAL_POOL.filter((id) => byId.get(id)?.purchasable).slice(0, 4);
}

function defaultPerkIds(role: CatalogRole): {
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
} {
  if (role === 'Support') {
    return {
      primaryStyleId: 8100,
      subStyleId: 8400,
      selectedPerkIds: [9923, 8143, 8137, 8106, 8473, 8242, 5008, 5008, 5001],
    };
  }
  if (role === 'Jungle') {
    return {
      primaryStyleId: 8000,
      subStyleId: 8100,
      selectedPerkIds: [8008, 9111, 9104, 8014, 8139, 8135, 5005, 5008, 5001],
    };
  }
  return {
    primaryStyleId: 8000,
    subStyleId: 8200,
    selectedPerkIds: [8008, 9111, 9104, 8014, 8226, 8233, 5008, 5008, 5001],
  };
}

function defaultSpells(role: CatalogRole): number[] {
  if (role === 'Jungle') return [4, 11];
  if (role === 'Support') return [4, 14];
  if (role === 'Top') return [4, 12];
  return [4, 14];
}

export function buildRecommendation(args: {
  champion: CatalogChampion;
  role: CatalogRole;
  items: CatalogItem[];
  rune?: {
    primaryStyleId: number;
    subStyleId: number;
    selectedPerkIds: number[];
    summonerSpellIds?: number[];
  };
}): CatalogRecommendation {
  const { champion, role, items, rune } = args;
  const fallback = defaultPerkIds(role);
  const starter = pickStarters(items, role);
  const core = pickCore(items, champion.tags, role);
  const boots = pickBoots(items, champion.tags, role);
  const situational = pickSituational(items);
  return {
    championId: champion.id,
    role,
    primaryStyleId: rune?.primaryStyleId || fallback.primaryStyleId,
    subStyleId: rune?.subStyleId || fallback.subStyleId,
    selectedPerkIds:
      rune?.selectedPerkIds && rune.selectedPerkIds.length >= 9
        ? rune.selectedPerkIds.slice(0, 9)
        : fallback.selectedPerkIds,
    summonerSpellIds: rune?.summonerSpellIds?.length ? rune.summonerSpellIds : defaultSpells(role),
    starter: starter.length ? starter : FALLBACK_STARTER[role],
    core: core.length ? core : situational.slice(0, 3),
    boots,
    situational,
  };
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export async function buildCatalogBundle(): Promise<CatalogBundle> {
  const versions = await readJson<string[]>(DDRAGON_VERSIONS);
  const patch = versions[0];
  if (!patch) throw new Error('Data Dragon versions.json returned no patch');

  const [championDoc, itemDoc, runeDoc, summaryDoc, recDoc] = await Promise.all([
    readJson<{ data: Record<string, DDragonChampion> }>(
      `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`
    ),
    readJson<{ data: Record<string, DDragonItem> }>(
      `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`
    ),
    readJson<CatalogRuneTree[]>(
      `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/runesReforged.json`
    ),
    readJson<CDragonSummary[]>(CDRAGON_SUMMARY).catch(() => [] as CDragonSummary[]),
    readJson<CDragonRuneRec[]>(CDRAGON_RUNE_RECS).catch(() => [] as CDragonRuneRec[]),
  ]);

  const summaryByKey = new Map<string, CDragonSummary>();
  for (const row of summaryDoc) {
    if (row.id > 0) summaryByKey.set(String(row.id), row);
  }

  const champions: CatalogChampion[] = Object.values(championDoc.data).map((champ) => {
    const summary = summaryByKey.get(champ.key);
    const rolesFromCdragon = (summary?.roles || [])
      .map((role) => cdragonPositionToRole(role))
      .filter((role): role is CatalogRole => !!role);
    const roles = rolesFromCdragon.length ? rolesFromCdragon : [roleFromChampionTags(champ.tags)];
    return {
      id: champ.id,
      key: champ.key,
      name: champ.name,
      tags: champ.tags,
      roles: [...new Set(roles)],
      damageType: determineDamageType(champ.tags, champ.info),
    };
  });

  const items: CatalogItem[] = Object.entries(itemDoc.data).map(([id, item]) => ({
    id,
    name: item.name,
    tags: item.tags || [],
    gold: item.gold?.total ?? 0,
    purchasable: isLivePurchasable(item) && onSummonersRift(item),
    from: item.from || [],
    into: item.into || [],
    maps: item.maps || {},
  }));

  const recsByChamp = new Map<number, CDragonRuneRec['runeRecommendations']>();
  for (const row of recDoc) {
    recsByChamp.set(row.championId, row.runeRecommendations || []);
  }

  const recommendations: CatalogRecommendation[] = [];
  for (const champion of champions) {
    const numericKey = Number(champion.key);
    const liveRecs = (recsByChamp.get(numericKey) || []).filter((row) => row.mapId === 11);
    const roles = new Set<CatalogRole>(champion.roles);
    for (const row of liveRecs) {
      const role = cdragonPositionToRole(row.position);
      if (role) roles.add(role);
    }
    if (roles.size === 0) roles.add(roleFromChampionTags(champion.tags));

    for (const role of roles) {
      const match =
        liveRecs.find((row) => cdragonPositionToRole(row.position) === role && (row.perkIds || []).length >= 9) ||
        liveRecs.find((row) => row.isDefaultPosition && (row.perkIds || []).length >= 9);
      recommendations.push(
        buildRecommendation({
          champion,
          role,
          items,
          rune: match
            ? {
                primaryStyleId: match.primaryPerkStyleId || 8000,
                subStyleId: match.secondaryPerkStyleId || 8200,
                selectedPerkIds: match.perkIds || [],
                summonerSpellIds: match.summonerSpellIds,
              }
            : undefined,
        })
      );
    }
  }

  return {
    manifest: {
      patch,
      generatedAt: new Date().toISOString(),
      sources: {
        ddragon: `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US`,
        cdragon: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1',
        versions: DDRAGON_VERSIONS,
      },
    },
    champions,
    items,
    runes: runeDoc,
    recommendations,
    profiles: { authored: AUTHORED_CATALOG_PROFILES },
  };
}
