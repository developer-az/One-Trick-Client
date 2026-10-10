/** Versioned One Trick catalog API — shared by website, companion, and overlay. */

export const CATALOG_API_VERSION = 'v1' as const;

export type CatalogRole = 'Top' | 'Jungle' | 'Mid' | 'Bot' | 'Support';

export const CATALOG_ROLES: CatalogRole[] = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

export interface CatalogManifest {
  patch: string;
  generatedAt: string;
  sources: {
    ddragon: string;
    cdragon: string;
    versions: string;
  };
}

export interface CatalogChampion {
  id: string;
  key: string;
  name: string;
  tags: string[];
  roles: CatalogRole[];
  damageType: 'Physical' | 'Magic' | 'Mixed';
}

export interface CatalogItem {
  id: string;
  name: string;
  tags: string[];
  gold: number;
  purchasable: boolean;
  from: string[];
  into: string[];
  maps: Record<string, boolean>;
}

export interface CatalogRune {
  id: number;
  key: string;
  name: string;
  icon: string;
}

export interface CatalogRuneTree {
  id: number;
  key: string;
  name: string;
  icon: string;
  slots: Array<{ runes: CatalogRune[] }>;
}

export interface CatalogRecommendation {
  championId: string;
  role: CatalogRole;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: number[];
  starter: string[];
  core: string[];
  boots: string;
  situational: string[];
}

export interface CatalogAuthoredProfile {
  id: 'pyke-support' | 'pantheon-support' | 'yone-mid';
  championId: string;
  role: CatalogRole;
}

export interface CatalogProfiles {
  authored: CatalogAuthoredProfile[];
}

export interface CatalogBundle {
  manifest: CatalogManifest;
  champions: CatalogChampion[];
  items: CatalogItem[];
  runes: CatalogRuneTree[];
  recommendations: CatalogRecommendation[];
  profiles: CatalogProfiles;
}

export const AUTHORED_CATALOG_PROFILES: CatalogAuthoredProfile[] = [
  { id: 'pyke-support', championId: 'Pyke', role: 'Support' },
  { id: 'pantheon-support', championId: 'Pantheon', role: 'Support' },
  { id: 'yone-mid', championId: 'Yone', role: 'Mid' },
];

export { DEFAULT_CATALOG_API_BASE, CATALOG_API_BASES, SITE_ORIGIN } from './site';
