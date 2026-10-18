export function isAramMap(mapName?: string | null): boolean {
  const map = (mapName || '').toLowerCase();
  return map.includes('howling');
}

/** ARAM: Mayhem — Live Client often reports generic ARAM on Howling Abyss. */
export function isMayhemGame(gameMode: string | null | undefined, mapName?: string | null): boolean {
  const mode = (gameMode || '').toUpperCase();
  if (mode.includes('KIWI') || mode.includes('MAYHEM')) return true;
  if (isAramMap(mapName) && mode.includes('ARAM')) return true;
  return false;
}

/** Howling Abyss — classic ARAM and Mayhem. */
export function isAramOrMayhem(gameMode?: string | null, mapName?: string | null): boolean {
  const mode = (gameMode || '').toUpperCase();
  if (isMayhemGame(gameMode, mapName)) return true;
  if (isAramMap(mapName)) return true;
  if (mode.includes('ARAM')) return true;
  return false;
}
