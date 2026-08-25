/**
 * Data Dragon / Community Dragon asset URLs.
 * Champion icons & splashes are the Riot-approved public asset CDN for tools.
 * Tiny cached images only — no runtime blur / no GPU filters on these layers.
 *
 * Version is subscribed so React can re-render after warmDdragonVersion() —
 * first paint used to stick on a stale patch and 404 until a full remount.
 */

const FALLBACK_VERSION = '15.1.1';

let cachedVersion = FALLBACK_VERSION;
const listeners = new Set<() => void>();

export function getDdragonVersion(): string {
  return cachedVersion;
}

export function getDdragonFallbackVersion(): string {
  return FALLBACK_VERSION;
}

export function subscribeDdragonVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyVersion(): void {
  listeners.forEach((listener) => listener());
}

export async function warmDdragonVersion(): Promise<string> {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = (await res.json()) as string[];
    if (versions[0] && versions[0] !== cachedVersion) {
      cachedVersion = versions[0];
      notifyVersion();
    }
  } catch {
    // keep fallback
  }
  return cachedVersion;
}

/** Square portrait (120×120) — profile switcher, selected champs. */
export function championSquareUrl(championId: string, version = cachedVersion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`;
}

/** Community Dragon square — accepts DDragon id, display name, or numeric key. */
export function championCdragonSquareUrl(idOrKey: string | number): string {
  return `https://cdn.communitydragon.org/latest/champion/${encodeURIComponent(String(idOrKey))}/square`;
}

/** Numeric champion-icons pack — reliable when Live Client only has a key. */
export function championCdragonIconUrl(numericKey: string | number): string {
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${numericKey}.png`;
}

/** Item square — overlay buy path and companion loadout. */
export function itemIconUrl(itemId: string | number, version = cachedVersion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

export function itemIconFallbackUrl(itemId: string | number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${FALLBACK_VERSION}/img/item/${itemId}.png`;
}

/**
 * Centered splash crop via loading screen art — atmospheric header only.
 * Browser HTTP cache handles repeat visits; CSS opacity, no filters.
 */
export function championSplashUrl(championId: string, skin = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skin}.jpg`;
}

/** Compact loading screen (308×560) — lighter than full splash if needed. */
export function championLoadingUrl(championId: string, skin = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championId}_${skin}.jpg`;
}

/**
 * Official LoL mark from Community Dragon static assets (fan-tool safe CDN).
 * Keep small in the UI — decorative only.
 */
export function leagueMarkUrl(): string {
  return 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/icons/lol_icon.png';
}
