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
import { CHAMPION_POSITIONS } from '../logic/championPositions';

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

/** Answers to specific threats, per archetype: burst, healing, crowd control, armor or magic stacking. */
const SITUATIONAL_BY_ARCHETYPE: Record<string, string[]> = {
  marksman: ['3036', '3026', '3139', '6333', '3156'],
  mage: ['3157', '3102', '3165', '3135'],
  assassinAd: ['3814', '6695', '3156', '6333', '3026'],
  assassinAp: ['3157', '3102', '3135', '3165'],
  fighterAd: ['3053', '6333', '3156', '3026', '3075'],
  fighterAp: ['3157', '3102', '3065', '4401'],
  tank: ['3143', '4401', '3075', '6665', '3065'],
  enchanter: ['3222', '3107', '3190', '3102'],
  supportTank: ['3190', '3143', '4401', '3075', '3107'],
};

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

/** Summoner's Rift items use 4-digit ids; 6-digit ids are mode variants of the same item. */
function riftItem(item: CatalogItem): boolean {
  return item.purchasable && item.id.length <= 4;
}

function legendary(item: CatalogItem): boolean {
  return riftItem(item) && item.gold >= 2000 && item.into.length === 0 && !item.tags.includes('Boots');
}

function bootsCandidate(item: CatalogItem): boolean {
  return riftItem(item) && item.tags.includes('Boots') && item.gold >= 900 && item.gold <= 1600;
}

function starterCandidate(item: CatalogItem, role: CatalogRole): boolean {
  if (!riftItem(item) || item.gold > 550) return false;
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

/**
 * Item archetypes. Data Dragon tags items by the stats they give (Damage,
 * SpellDamage, CriticalStrike...) and champions by class (Mage, Tank...), so a
 * build needs a class -> stat weighting; comparing the two tag sets directly
 * never matches. Weights are relative stat priorities per archetype.
 */
type StatWeights = Partial<Record<string, number>>;

const ARCHETYPES: Record<string, StatWeights> = {
  marksman: { CriticalStrike: 3, AttackSpeed: 2.5, Damage: 2, OnHit: 1.2, LifeSteal: 1, ArmorPenetration: 0.8 },
  mage: { SpellDamage: 3, MagicPenetration: 2, AbilityHaste: 1.2, CooldownReduction: 1.2, Mana: 1 },
  assassinAd: { Damage: 2.5, ArmorPenetration: 3, AbilityHaste: 1.2, CooldownReduction: 1.2, NonbootsMovement: 0.6 },
  assassinAp: { SpellDamage: 3, MagicPenetration: 2.5, AbilityHaste: 1, CooldownReduction: 1, NonbootsMovement: 0.5 },
  fighterAd: { Damage: 2, Health: 2, AbilityHaste: 1.8, CooldownReduction: 1.8, LifeSteal: 0.8, SpellVamp: 0.8, Armor: 0.4 },
  fighterAp: { SpellDamage: 2.5, Health: 2, AbilityHaste: 1.2, CooldownReduction: 1.2, MagicPenetration: 1, SpellVamp: 1.5 },
  tank: { Health: 3, Armor: 2, SpellBlock: 2, MagicResist: 2, AbilityHaste: 1, CooldownReduction: 1, Aura: 0.8 },
  enchanter: { ManaRegen: 2.5, AbilityHaste: 2, CooldownReduction: 2, SpellDamage: 1.2, HealthRegen: 1.2, Aura: 0.5, Active: 0.5 },
  supportTank: { Health: 3, Armor: 1.5, SpellBlock: 1.5, MagicResist: 1.5, Aura: 2, Active: 1.2, AbilityHaste: 1 },
};

/** Stat tags that are wasted on the wrong damage type. */
const PHYSICAL_ONLY = ['CriticalStrike', 'ArmorPenetration', 'LifeSteal'];
const MAGIC_ONLY = ['SpellDamage', 'MagicPenetration'];

/**
 * Champions that build ability power although Data Dragon's class tags and
 * attack/magic ratings point to physical or "mixed".
 */
const BUILDS_AP = new Set([
  'Akali', 'Diana', 'Ekko', 'Elise', 'Evelynn', 'Fizz', 'Gragas', 'Gwen', 'Kassadin', 'Katarina', 'Kayle',
  'Kennen', 'Lillia', 'Mordekaiser', 'Nidalee', 'Rumble', 'Shyvana', 'Singed', 'Sylas', 'Teemo', 'Vladimir',
]);

export function buildsMagic(champion: Pick<CatalogChampion, 'id' | 'tags' | 'damageType'>): boolean {
  if (BUILDS_AP.has(champion.id)) return true;
  return champion.damageType === 'Magic' || (champion.damageType === 'Mixed' && champion.tags.includes('Mage'));
}

export function archetypeFor(tags: string[], damageType: CatalogChampion['damageType'], role: CatalogRole): string {
  const [primary] = tags;
  const magic = damageType === 'Magic';
  if (role === 'Support') {
    if (tags.includes('Tank') || primary === 'Fighter') return 'supportTank';
    if (primary === 'Mage') return 'mage';
    return 'enchanter';
  }
  switch (primary) {
    case 'Marksman':
      return magic ? 'mage' : 'marksman';
    case 'Mage':
      return 'mage';
    case 'Assassin':
      return magic ? 'assassinAp' : 'assassinAd';
    case 'Tank':
      return 'tank';
    case 'Fighter':
      return magic ? 'fighterAp' : 'fighterAd';
    case 'Support':
      return magic ? 'mage' : 'tank';
    default:
      return magic ? 'mage' : 'fighterAd';
  }
}

export function itemFit(item: CatalogItem, archetype: string, damageType: CatalogChampion['damageType']): number {
  const weights = ARCHETYPES[archetype] || {};
  let score = 0;
  for (const tag of item.tags) score += weights[tag] || 0;
  // An item built around the other damage type is mostly wasted.
  if (damageType === 'Magic' && item.tags.some((t) => PHYSICAL_ONLY.includes(t)) && !item.tags.some((t) => MAGIC_ONLY.includes(t))) score -= 3;
  if (damageType === 'Physical' && item.tags.some((t) => MAGIC_ONLY.includes(t)) && !item.tags.some((t) => PHYSICAL_ONLY.includes(t) || t === 'Damage')) score -= 3;
  // Mana-regeneration auras are support items; carries and bruisers skip them.
  if (item.tags.includes('ManaRegen') && archetype !== 'enchanter' && archetype !== 'supportTank') score -= 2.5;
  // Gold-per and jungle items belong to their own roles.
  if (item.tags.includes('GoldPer') || item.tags.includes('Jungle')) score -= 10;
  return score;
}

const ARCHETYPE_BOOTS: Record<string, string[]> = {
  marksman: ['3006'],
  mage: ['3020'],
  assassinAd: ['3158', '3047'],
  assassinAp: ['3020'],
  fighterAd: ['3047', '3111'],
  fighterAp: ['3111', '3020'],
  tank: ['3047', '3111'],
  enchanter: ['3158'],
  supportTank: ['3047', '3111'],
};

function pickBoots(items: CatalogItem[], archetype: string, role: CatalogRole): string {
  const boots = items.filter(bootsCandidate);
  for (const id of ARCHETYPE_BOOTS[archetype] || []) {
    if (boots.some((b) => b.id === id)) return id;
  }
  return FALLBACK_BOOTS[role];
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

function pickCore(items: CatalogItem[], archetype: string, damageType: CatalogChampion['damageType']): string[] {
  const seen = new Set<string>();
  return items
    .filter(legendary)
    .map((item) => ({ item, score: itemFit(item, archetype, damageType) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.gold - a.item.gold || a.item.id.localeCompare(b.item.id))
    .filter((row) => (seen.has(row.item.name) ? false : (seen.add(row.item.name), true)))
    .slice(0, 3)
    .map((row) => row.item.id);
}

function pickSituational(items: CatalogItem[], archetype: string, core: string[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (SITUATIONAL_BY_ARCHETYPE[archetype] || [])
    .filter((id) => byId.get(id)?.purchasable && !core.includes(id))
    .slice(0, 4);
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
  const damage = buildsMagic(champion) ? 'Magic' : 'Physical';
  const archetype = archetypeFor(champion.tags, damage, role);
  const core = pickCore(items, archetype, damage);
  const boots = pickBoots(items, archetype, role);
  const situational = pickSituational(items, archetype, core);
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
    const known = CHAMPION_POSITIONS[champ.id];
    const roles = known?.length ? known : rolesFromCdragon.length ? rolesFromCdragon : [roleFromChampionTags(champ.tags)];
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
