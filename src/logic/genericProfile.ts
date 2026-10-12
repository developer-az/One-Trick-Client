import type { CatalogChampion, CatalogRole } from '../catalog/types';
import { findChampionInCatalog, getCatalog, recommendationFor } from '../catalog/client';
import { catalogItemsById } from '../catalog/client';
import { recommendationToBuild, recommendationToRunes } from '../catalog/loadout';
import type {
  Build,
  Champion,
  DominanceMetrics,
  MatchupAnalysis,
  RunePage,
} from './pykeLogic';
import type { ChampionProfile, GenericProfileId, ProfileRole } from './profiles';

function gradeFor(score: number): DominanceMetrics['grade'] {
  if (score >= 90) return 'S+';
  if (score >= 80) return 'S';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

function focusAllies(role: ProfileRole): ChampionProfile['focusAllies'] {
  if (role === 'Mid' || role === 'Top') return ['YourJungle'];
  if (role === 'Jungle') return ['YourMid'];
  return ['YourADC', 'YourMid'];
}

function primaryEnemy(role: ProfileRole): ChampionProfile['primaryEnemyRole'] {
  if (role === 'Mid') return 'Mid';
  if (role === 'Top') return 'Top';
  if (role === 'Bot') return 'Bot';
  return 'Support';
}

function shortMatchup(
  champion: CatalogChampion,
  role: ProfileRole,
  enemies: Champion[]
): MatchupAnalysis {
  const threats = enemies
    .filter((enemy) => enemy.tags.includes('Tank') || enemy.tags.includes('Assassin'))
    .map((enemy) => enemy.name)
    .slice(0, 3);
  const squishies = enemies
    .filter((enemy) => enemy.tags.includes('Marksman') || enemy.tags.includes('Mage'))
    .map((enemy) => enemy.name)
    .slice(0, 3);
  return {
    title: `${champion.name} ${role}`,
    description: `${champion.tags.join(' / ') || 'Champion'} on ${role} — live catalog recs, not authored doctrine.`,
    winCondition: squishies.length
      ? `Play through ${squishies.join(', ')}.`
      : 'Hit item spikes and take the side that is already winning.',
    aggressionLevel: champion.tags.includes('Assassin') ? 'HIGH' : 'MODERATE',
    primaryTargets: squishies,
    majorThreats: threats,
    tips: [],
    roamAdvice: role === 'Support' || role === 'Jungle' ? 'Roam after the wave is settled.' : undefined,
  };
}

function genericDominance(enemies: Champion[]): DominanceMetrics {
  let score = 52;
  for (const enemy of enemies) {
    if (enemy.tags.includes('Marksman') || enemy.tags.includes('Mage')) score += 4;
    if (enemy.tags.includes('Tank')) score -= 3;
    if (enemy.tags.includes('Assassin')) score -= 2;
  }
  score = Math.max(30, Math.min(88, score));
  return {
    score,
    grade: gradeFor(score),
    title: 'Catalog read',
    summary: 'Generic profile — tags and live rune recs, not a one-trick essay.',
    earlyGameScore: score,
    midGameScore: score,
    lateGameScore: Math.max(30, score - 4),
  };
}

export function createGenericProfile(
  id: GenericProfileId,
  championId: string,
  role: CatalogRole
): ChampionProfile {
  const bundle = getCatalog();
  // Live Client names ("KaiSa", "Wukong", "NunuWillump") aren't always Data
  // Dragon ids, so match by id or compact display name.
  const champion =
    findChampionInCatalog(bundle, { id: championId, name: championId }) ||
    ({
      id: championId,
      key: '0',
      name: championId,
      tags: [],
      roles: [role],
      damageType: 'Physical',
    } satisfies CatalogChampion);
  const rec = recommendationFor(champion, role, bundle);
  const items = catalogItemsById(bundle);

  return {
    id,
    championId: champion.id,
    championKey: Number(champion.key) || 0,
    role,
    label: `${champion.name} ${role}`,
    shortLabel: champion.name,
    runePageName: 'One Trick',
    itemSetTitle: `One Trick · ${champion.name}`,
    brandTitle: 'One Trick',
    focusAllies: focusAllies(role),
    primaryEnemyRole: primaryEnemy(role),
    situationAware: false,
    calculateBuild: () => recommendationToBuild(rec, items),
    calculateRunes: () => recommendationToRunes(rec, 'One Trick'),
    analyzeMatchup: (enemies) => shortMatchup(champion, role, enemies),
    calculateDominance: (enemies) => genericDominance(enemies),
  };
}

export function emptyGenericBuild(): Build {
  return {
    starter: [],
    core: [],
    situational: [],
    boots: { id: '1001', name: 'Boots', icon: 'Boots' },
    buildPath: [],
    spells: ['Flash', 'Ignite'],
  };
}

export function emptyGenericRunes(): RunePage {
  return {
    primaryStyleId: 8000,
    subStyleId: 8200,
    selectedPerkIds: [8008, 9111, 9104, 8014, 8226, 8233, 5008, 5008, 5001],
    name: 'One Trick',
    reasons: {},
  };
}
