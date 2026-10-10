/**
 * Champion profile abstraction — authored Pyke / Pantheon / Yone stay deep.
 * Every other Live Client champion resolves to generic:{championId}:{role}.
 */
import { findChampionInCatalog, getCatalog, inferCatalogRole } from '../catalog/client';
import { isCatalogRole, roleFromChampionTags } from '../catalog/roles';
import type { CatalogRole } from '../catalog/types';
import { resolveChampionRef } from '../data/championCatalog';
import {
  analyzeMatchup,
  calculateBuild,
  calculateDominanceFactor,
  calculateRunes,
  type Build,
  type Champion,
  type DominanceMetrics,
  type MatchupAnalysis,
  type RunePage,
} from './pykeLogic';
import {
  analyzeYoneMatchup,
  calculateYoneBuild,
  calculateYoneDominance,
  calculateYoneRunes,
} from './yoneLogic';
import {
  analyzePantheonMatchup,
  calculatePantheonBuild,
  calculatePantheonDominance,
  calculatePantheonRunes,
} from './pantheonLogic';
import type { ProfileSituation } from './situation';
import { createGenericProfile } from './genericProfile';

export type AuthoredProfileId = 'pyke-support' | 'pantheon-support' | 'yone-mid';
export type GenericProfileId = `generic:${string}:${CatalogRole}`;
export type ProfileId = AuthoredProfileId | GenericProfileId;

export type ProfileRole = 'Support' | 'Mid' | 'Top' | 'Jungle' | 'Bot';

const GENERIC_ID = /^generic:([A-Za-z0-9]+):(Support|Mid|Top|Jungle|Bot)$/;

export interface ChampionProfile {
  id: ProfileId;
  /** Data Dragon champion id */
  championId: string;
  /** Numeric champion key for LCU item-set association */
  championKey: number;
  role: ProfileRole;
  label: string;
  shortLabel: string;
  runePageName: string;
  itemSetTitle: string;
  brandTitle: string;
  /**
   * Ally slots that matter for this profile's scoring, most important first.
   * Pyke / Pantheon (support): ADC then Mid. Yone (mid): Jungle — never Mid.
   */
  focusAllies: Array<'YourADC' | 'YourMid' | 'YourJungle'>;
  /** Enemy role that is the primary matchup focus */
  primaryEnemyRole: 'Support' | 'Mid' | 'Bot' | 'Top';
  /** True when live behind/even/ahead state changes the recommendations. */
  situationAware: boolean;
  /** Second ally arg: Pyke/Pantheon = mid laner; Yone = jungler */
  calculateBuild: (
    enemies: Champion[],
    yourADC?: Champion | null,
    allyPartner?: Champion | null,
    situation?: ProfileSituation | null
  ) => Build;
  calculateRunes: (
    enemies: Champion[],
    build?: Build,
    yourADC?: Champion | null,
    allyPartner?: Champion | null,
    situation?: ProfileSituation | null
  ) => RunePage;
  analyzeMatchup: (
    enemies: Champion[],
    build?: Build,
    yourADC?: Champion | null,
    allyPartner?: Champion | null,
    situation?: ProfileSituation | null
  ) => MatchupAnalysis;
  calculateDominance: (
    enemies: Champion[],
    build: Build,
    yourADC?: Champion | null,
    allyPartner?: Champion | null,
    situation?: ProfileSituation | null
  ) => DominanceMetrics;
}

const pykeSupport: ChampionProfile = {
  id: 'pyke-support',
  championId: 'Pyke',
  championKey: 555,
  role: 'Support',
  label: 'Pyke Support',
  shortLabel: 'Pyke',
  runePageName: 'One Trick',
  itemSetTitle: 'One Trick · Pyke',
  brandTitle: 'One Trick',
  focusAllies: ['YourADC', 'YourMid'],
  primaryEnemyRole: 'Support',
  situationAware: false,
  calculateBuild,
  calculateRunes,
  analyzeMatchup,
  calculateDominance: (enemies, build) => calculateDominanceFactor(enemies, build),
};

const pantheonSupport: ChampionProfile = {
  id: 'pantheon-support',
  championId: 'Pantheon',
  championKey: 80,
  role: 'Support',
  label: 'Pantheon Support',
  shortLabel: 'Pantheon',
  runePageName: 'One Trick',
  itemSetTitle: 'One Trick · Pantheon',
  brandTitle: 'One Trick',
  // Engage support: the ADC is who you play through, mid is the roam target.
  focusAllies: ['YourADC', 'YourMid'],
  primaryEnemyRole: 'Support',
  situationAware: true,
  calculateBuild: (enemies, adc, allyMid, situation) =>
    calculatePantheonBuild(enemies, adc, allyMid, situation),
  calculateRunes: (enemies, _build, adc, allyMid, situation) =>
    calculatePantheonRunes(enemies, adc, allyMid, situation),
  analyzeMatchup: (enemies, build, adc, allyMid, situation) =>
    analyzePantheonMatchup(enemies, build, adc, allyMid, situation),
  calculateDominance: (enemies, build, adc, allyMid, situation) =>
    calculatePantheonDominance(enemies, build, adc, allyMid, situation),
};

const yoneMid: ChampionProfile = {
  id: 'yone-mid',
  championId: 'Yone',
  championKey: 777,
  role: 'Mid',
  label: 'Yone Mid',
  shortLabel: 'Yone',
  runePageName: 'One Trick',
  itemSetTitle: 'One Trick · Yone',
  brandTitle: 'One Trick',
  // You ARE mid — ally context is jungle pathing / dive sync, not another mid
  focusAllies: ['YourJungle'],
  primaryEnemyRole: 'Mid',
  situationAware: false,
  calculateBuild: (enemies, _adc, allyJungle) => calculateYoneBuild(enemies, allyJungle),
  calculateRunes: (enemies, _build, _adc, allyJungle) => {
    const page = calculateYoneRunes(enemies, allyJungle);
    return { ...page, name: 'One Trick' };
  },
  analyzeMatchup: (enemies, build, _adc, allyJungle) => analyzeYoneMatchup(enemies, build, allyJungle),
  calculateDominance: (enemies, build, _adc, allyJungle) =>
    calculateYoneDominance(enemies, build, allyJungle),
};

export const AUTHORED_PROFILES: ChampionProfile[] = [pykeSupport, pantheonSupport, yoneMid];

/** Authored one-tricks — UI switcher still leads with these. */
export const PROFILES: ChampionProfile[] = AUTHORED_PROFILES;

export const AUTHORED_PROFILE_IDS: AuthoredProfileId[] = AUTHORED_PROFILES.map(
  (p) => p.id as AuthoredProfileId
);

export const PROFILE_IDS: AuthoredProfileId[] = AUTHORED_PROFILE_IDS;

export function isAuthoredProfileId(value: unknown): value is AuthoredProfileId {
  return typeof value === 'string' && (AUTHORED_PROFILE_IDS as string[]).includes(value);
}

export function isGenericProfileId(value: unknown): value is GenericProfileId {
  return typeof value === 'string' && GENERIC_ID.test(value);
}

export function isProfileId(value: unknown): value is ProfileId {
  return isAuthoredProfileId(value) || isGenericProfileId(value);
}

export function parseGenericProfileId(id: string): { championId: string; role: CatalogRole } | null {
  const match = GENERIC_ID.exec(id);
  if (!match) return null;
  return { championId: match[1], role: match[2] as CatalogRole };
}

export function genericProfileId(championId: string, role: CatalogRole): GenericProfileId {
  return `generic:${championId}:${role}`;
}

const genericCache = new Map<string, ChampionProfile>();
let genericCatalogStamp = '';

export function invalidateGenericProfiles(): void {
  genericCache.clear();
  genericCatalogStamp = '';
}

function refreshGenericCache(): void {
  const stamp = getCatalog()?.manifest.generatedAt || '';
  if (stamp !== genericCatalogStamp) {
    genericCache.clear();
    genericCatalogStamp = stamp;
  }
}

function authoredByChampion(token: string): ChampionProfile | null {
  const compact = token.toLowerCase().replace(/[^a-z]/g, '');
  return (
    AUTHORED_PROFILES.find((p) => p.championId.toLowerCase().replace(/[^a-z]/g, '') === compact) ||
    null
  );
}

export function getProfile(id: ProfileId | string | null | undefined): ChampionProfile {
  if (isAuthoredProfileId(id)) {
    return AUTHORED_PROFILES.find((p) => p.id === id) || pykeSupport;
  }
  if (isGenericProfileId(id)) {
    refreshGenericCache();
    const hit = genericCache.get(id);
    if (hit) return hit;
    const parsed = parseGenericProfileId(id);
    if (!parsed) return pykeSupport;
    const profile = createGenericProfile(id, parsed.championId, parsed.role);
    genericCache.set(id, profile);
    return profile;
  }
  return pykeSupport;
}

export function profileFromChampionName(
  name: string | null | undefined,
  role?: CatalogRole | null
): ChampionProfile | null {
  if (!name) return null;
  const authored = authoredByChampion(name);
  if (authored) return authored;

  const catalogChamp = findChampionInCatalog(getCatalog(), { name, id: name });
  const ref = catalogChamp || resolveChampionRef({ name, id: name });
  const championId = catalogChamp?.id || ref?.id || name.replace(/[^a-zA-Z0-9]/g, '');
  if (!championId) return null;
  const resolvedRole =
    (role && isCatalogRole(role) ? role : null) ||
    inferCatalogRole(catalogChamp, null) ||
    roleFromChampionTags(catalogChamp?.tags);
  return getProfile(genericProfileId(championId, resolvedRole));
}

export function profileIdFromChampion(
  name: string | null | undefined,
  role?: CatalogRole | null
): ProfileId {
  return profileFromChampionName(name, role)?.id || 'pyke-support';
}

export function profileFocusLane(profileId: ProfileId): 'mid' | 'bot' {
  if (profileId === 'yone-mid') return 'mid';
  if (isGenericProfileId(profileId)) {
    const role = parseGenericProfileId(profileId)?.role;
    if (role === 'Mid' || role === 'Top' || role === 'Jungle') return 'mid';
  }
  return 'bot';
}

export function isSupportStyleProfile(profileId: ProfileId): boolean {
  if (profileId === 'pyke-support' || profileId === 'pantheon-support') return true;
  if (isGenericProfileId(profileId)) {
    const role = parseGenericProfileId(profileId)?.role;
    return role === 'Support' || role === 'Bot';
  }
  return false;
}

const STORAGE_KEY = 'dominator.activeProfile';

export function loadStoredProfileId(): ProfileId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isProfileId(v)) return v;
  } catch {
    /* ignore */
  }
  return 'pyke-support';
}

export function storeProfileId(id: ProfileId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
