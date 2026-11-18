export function isAramMap(mapName?: string | null): boolean {
  const map = (mapName || '').trim().toLowerCase();
  // Live Client reports Map12 for Howling Abyss and Map11 for Summoner's Rift.
  return map === 'map12' || map.includes('howling');
}

/** ARAM: Mayhem — Mayhem is signalled by the KIWI/MAYHEM game mode only. */
export function isMayhemGame(gameMode: string | null | undefined, mapName?: string | null): boolean {
  // mapName kept for call-site compatibility; Mayhem is mode-only.
  void mapName;
  const mode = (gameMode || '').toUpperCase();
  return mode.includes('KIWI') || mode.includes('MAYHEM');
}

/** Howling Abyss — classic ARAM and Mayhem. */
export function isAramOrMayhem(gameMode?: string | null, mapName?: string | null): boolean {
  const mode = (gameMode || '').toUpperCase();
  if (isMayhemGame(gameMode, mapName)) return true;
  if (isAramMap(mapName)) return true;
  if (mode.includes('ARAM')) return true;
  return false;
}
