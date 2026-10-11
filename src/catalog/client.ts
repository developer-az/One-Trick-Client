import { ingestChampionCatalog } from '../data/championCatalog';
import { warmDdragonVersion } from '../data/ddragonAssets';
import { buildCatalogBundle, buildRecommendation } from './buildCatalog';
import { CHAMPION_POSITIONS } from '../logic/championPositions';
import { roleFromChampionTags } from './roles';
import { CATALOG_API_BASES, DEFAULT_CATALOG_API_BASE } from './site';
import type {
  CatalogBundle,
  CatalogChampion,
  CatalogItem,
  CatalogRecommendation,
  CatalogRole,
} from './types';

const STORAGE_KEY = 'onetrick.catalog.v1';

let cached: CatalogBundle | null = null;
const listeners = new Set<() => void>();

export function getCatalog(): CatalogBundle | null {
  return cached;
}

export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Catalog roles come from the curated position table when it knows the champion (CDragon never reports Jungle). */
function withPositions(bundle: CatalogBundle): CatalogBundle {
  return {
    ...bundle,
    champions: bundle.champions.map((c) => {
      const known = CHAMPION_POSITIONS[c.id];
      return known?.length ? { ...c, roles: [...known] } : c;
    }),
  };
}

function applyBundle(raw: CatalogBundle): CatalogBundle {
  const bundle = withPositions(raw);
  cached = bundle;
  ingestChampionCatalog(bundle.champions);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
    }
  } catch {
    /* quota / private mode */
  }
  notify();
  return bundle;
}

function readLocalCache(): CatalogBundle | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogBundle;
    if (!parsed?.manifest?.patch || !Array.isArray(parsed.champions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Compare "16.10.1" vs "16.9.1" numerically — string comparison gets this backwards. */
export function comparePatch(a: string | undefined, b: string | undefined): number {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function catalogApiUrl(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
}

async function fetchStaticApi(base: string): Promise<CatalogBundle | null> {
  try {
    const [manifest, champions, items, runes, recommendations, profiles] = await Promise.all([
      fetch(catalogApiUrl(base, 'manifest.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(catalogApiUrl(base, 'champions.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(catalogApiUrl(base, 'items.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(catalogApiUrl(base, 'runes.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(catalogApiUrl(base, 'recommendations.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(catalogApiUrl(base, 'profiles.json')).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    ]);
    return { manifest, champions, items, runes, recommendations, profiles };
  } catch {
    return null;
  }
}

function localApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  const base = import.meta.env?.BASE_URL || '/';
  try {
    return new URL('api/v1/', window.location.origin + (base.endsWith('/') ? base : `${base}/`)).toString().replace(/\/$/, '');
  } catch {
    return `${window.location.origin}/api/v1`;
  }
}

export function findChampionInCatalog(
  bundle: CatalogBundle | null,
  input: { id?: string | null; name?: string | null; key?: string | number | null }
): CatalogChampion | null {
  if (!bundle) return null;
  const key = input.key != null && String(input.key) !== '' ? String(input.key) : '';
  if (key) {
    const byKey = bundle.champions.find((c) => c.key === key);
    if (byKey) return byKey;
  }
  const id = (input.id || '').toLowerCase();
  if (id) {
    const byId = bundle.champions.find((c) => c.id.toLowerCase() === id);
    if (byId) return byId;
  }
  const name = (input.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (name) {
    return (
      bundle.champions.find(
        (c) =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === name ||
          c.id.toLowerCase().replace(/[^a-z0-9]/g, '') === name
      ) || null
    );
  }
  return null;
}

export function findRecommendation(
  bundle: CatalogBundle | null,
  championId: string,
  role: CatalogRole
): CatalogRecommendation | null {
  if (!bundle) return null;
  return (
    bundle.recommendations.find((row) => row.championId === championId && row.role === role) ||
    bundle.recommendations.find((row) => row.championId === championId) ||
    null
  );
}

export function recommendationFor(
  champion: CatalogChampion,
  role: CatalogRole,
  bundle: CatalogBundle | null = cached
): CatalogRecommendation {
  // Items are always rebuilt from the live item list: published recommendations
  // can predate a scoring fix or a patch. Runes and spells come from CDragon's
  // per-champion recommendations when the bundle has them.
  const existing = findRecommendation(bundle, champion.id, role);
  const built = buildRecommendation({
    champion,
    role,
    items: bundle?.items || [],
    rune: existing
      ? {
          primaryStyleId: existing.primaryStyleId,
          subStyleId: existing.subStyleId,
          selectedPerkIds: existing.selectedPerkIds,
          summonerSpellIds: existing.summonerSpellIds,
        }
      : undefined,
  });
  return bundle?.items?.length ? built : existing || built;
}

export function inferCatalogRole(champion: CatalogChampion | null, assigned?: CatalogRole | null): CatalogRole {
  if (assigned) return assigned;
  if (!champion) return 'Mid';
  return champion.roles[0] || roleFromChampionTags(champion.tags);
}

/**
 * Load last-good catalog, then refresh from the static API and live DDragon/CDragon.
 * Mid-week champion ships do not wait on an installer.
 */
export async function warmCatalog(opts?: {
  apiBase?: string;
  electronGet?: () => Promise<CatalogBundle | null>;
}): Promise<CatalogBundle | null> {
  const local = readLocalCache();
  if (local) applyBundle(local);

  if (opts?.electronGet) {
    try {
      const fromMain = await opts.electronGet();
      if (fromMain?.champions?.length) applyBundle(fromMain);
    } catch {
      /* renderer can still fetch */
    }
  }

  if (!cached) {
    // First launch (or cleared cache): paint immediately from the bundled snapshot.
    try {
      const { SNAPSHOT_BUNDLE } = await import('./snapshot');
      if (SNAPSHOT_BUNDLE?.champions?.length) applyBundle(SNAPSHOT_BUNDLE);
    } catch {
      /* snapshot missing from this build */
    }
  }

  const bases = [opts?.apiBase, localApiBase(), ...CATALOG_API_BASES, DEFAULT_CATALOG_API_BASE].filter(
    (value, index, list): value is string => !!value && list.indexOf(value) === index
  );

  for (const base of bases) {
    const staticBundle = await fetchStaticApi(base);
    if (staticBundle?.champions?.length) {
      const current = cached;
      if (!current || comparePatch(staticBundle.manifest.patch, current.manifest.patch) >= 0) {
        applyBundle(staticBundle);
      }
      break;
    }
  }

  try {
    await warmDdragonVersion();
    const live = await buildCatalogBundle();
    const current = cached;
    if (
      !current ||
      comparePatch(live.manifest.patch, current.manifest.patch) >= 0 ||
      live.champions.length > current.champions.length
    ) {
      applyBundle(live);
    }
  } catch {
    /* keep last-good */
  }

  return cached;
}

export function catalogItemsById(bundle: CatalogBundle | null = cached): Map<string, CatalogItem> {
  return new Map((bundle?.items || []).map((item) => [item.id, item]));
}
