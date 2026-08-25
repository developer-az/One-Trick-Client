import {
  championCdragonIconUrl,
  championCdragonSquareUrl,
  championSquareUrl,
  getDdragonVersion,
} from './ddragonAssets';

export type ChampionRef = {
  id: string;
  key: string;
  name: string;
};

const byId = new Map<string, ChampionRef>();
const byName = new Map<string, ChampionRef>();
const byKey = new Map<string, ChampionRef>();
const byCompact = new Map<string, ChampionRef>();

export function compactChampToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function remember(ref: ChampionRef, token: string | null | undefined, map: Map<string, ChampionRef>): void {
  if (!token) return;
  map.set(token, ref);
}

export function ingestChampionCatalog(
  champs: Array<{ id: string; key: string | number; name: string }>
): void {
  for (const champ of champs) {
    const ref: ChampionRef = {
      id: champ.id,
      key: String(champ.key),
      name: champ.name,
    };
    remember(ref, champ.id.toLowerCase(), byId);
    remember(ref, champ.name.toLowerCase(), byName);
    remember(ref, String(champ.key), byKey);
    remember(ref, compactChampToken(champ.id), byCompact);
    remember(ref, compactChampToken(champ.name), byCompact);
  }
}

function lookupToken(token: string | null | undefined): ChampionRef | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return byKey.get(trimmed.slice(1)) || null;
  const lower = trimmed.toLowerCase();
  return byId.get(lower) || byName.get(lower) || byCompact.get(compactChampToken(trimmed)) || null;
}

export function resolveChampionRef(input: {
  id?: string | null;
  name?: string | null;
  key?: string | number | null;
}): ChampionRef | null {
  const key = input.key != null && String(input.key) !== '' ? String(input.key) : '';
  if (key) {
    const byNumeric = byKey.get(key);
    if (byNumeric) return byNumeric;
  }
  return lookupToken(input.id) || lookupToken(input.name);
}

function pushUnique(urls: string[], url: string | null | undefined): void {
  if (!url || urls.includes(url)) return;
  urls.push(url);
}

/** Ordered icon URLs: live DDragon, then Community Dragon so a patch miss still paints. */
export function championAssetSources(
  input: {
    id?: string | null;
    name?: string | null;
    key?: string | number | null;
  },
  version = getDdragonVersion()
): string[] {
  const ref = resolveChampionRef(input);
  const urls: string[] = [];

  if (ref) {
    pushUnique(urls, championSquareUrl(ref.id, version));
    pushUnique(urls, championCdragonSquareUrl(ref.id));
    pushUnique(urls, championCdragonIconUrl(ref.key));
    pushUnique(urls, championCdragonSquareUrl(ref.key));
  }

  if (input.key != null && String(input.key) !== '') {
    pushUnique(urls, championCdragonIconUrl(input.key));
    pushUnique(urls, championCdragonSquareUrl(input.key));
  }

  if (input.id) {
    pushUnique(urls, championSquareUrl(input.id, version));
    pushUnique(urls, championCdragonSquareUrl(input.id));
  }

  if (input.name) {
    const compactId = input.name.replace(/[^a-zA-Z0-9]/g, '');
    if (compactId) pushUnique(urls, championSquareUrl(compactId, version));
    pushUnique(urls, championCdragonSquareUrl(input.name));
  }

  return urls;
}
