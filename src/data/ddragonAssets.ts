/**
 * Data Dragon / Community Dragon asset URLs.
 * Champion icons & splashes are the Riot-approved public asset CDN for tools.
 * Tiny cached images only — no runtime blur / no GPU filters on these layers.
 */

let cachedVersion = '16.15.1';

export function getDdragonVersion(): string {
  return cachedVersion;
}

export async function warmDdragonVersion(): Promise<string> {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = (await res.json()) as string[];
    if (versions[0]) cachedVersion = versions[0];
  } catch {
    // keep fallback
  }
  return cachedVersion;
}

/** Square portrait (120×120) — profile switcher, selected champs. */
export function championSquareUrl(championId: string, version = cachedVersion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`;
}

/** Item square — overlay buy path and companion loadout. */
export function itemIconUrl(itemId: string | number, version = cachedVersion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
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
