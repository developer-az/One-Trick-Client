import { ingestChampionCatalog } from '../data/championCatalog';
import { warmDdragonVersion } from '../data/ddragonAssets';
import { buildCatalogBundle, buildRecommendation } from './buildCatalog';
import { roleFromChampionTags } from './roles';
import {
  DEFAULT_CATALOG_API_BASE,
  type CatalogBundle,
  type CatalogChampion,
  type CatalogItem,
  type CatalogRecommendation,
  type CatalogRole,
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

function applyBundle(bundle: CatalogBundle): CatalogBundle {
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
  const existing = findRecommendation(bundle, champion.id, role);
  if (existing) return existing;
  return buildRecommendation({
    champion,
    role,
    items: bundle?.items || [],
  });
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

  const bases = [opts?.apiBase, localApiBase(), DEFAULT_CATALOG_API_BASE].filter(
    (value, index, list): value is string => !!value && list.indexOf(value) === index
  );

  for (const base of bases) {
    const staticBundle = await fetchStaticApi(base);
    if (staticBundle?.champions?.length) {
      const current = cached;
      if (!current || staticBundle.manifest.patch >= current.manifest.patch) {
        applyBundle(staticBundle);
      }
      break;
    }
  }

  try {
    await warmDdragonVersion();
    const live = await buildCatalogBundle();
    const current = cached;
    if (!current || live.manifest.patch >= current.manifest.patch || live.champions.length > current.champions.length) {
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
