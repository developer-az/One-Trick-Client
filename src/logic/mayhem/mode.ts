/**
 * Queue ids Riot uses for ARAM Mayhem. Kept in one place so the classifier can
 * be updated without touching every call site (the exact id is not verified
 * against a live game yet — see the open question in the handoff).
 */
export const MAYHEM_QUEUE_IDS: readonly number[] = [2400];

/** Classic ARAM queues. They share Howling Abyss with Mayhem but have no augments. */
export const ARAM_QUEUE_IDS: readonly number[] = [450, 100];

/** Howling Abyss is map 12 in the Live Client (`mapName: "Map12"`). */
export const HOWLING_ABYSS_MAP_ID = 12;

/**
 * `mayhem-likely` is an unknown-queue Howling Abyss game: it gets every Mayhem
 * feature (the Live Client reports generic `ARAM`/`Map12` for real Mayhem), but
 * a known classic queue still wins.
 */
export type MayhemMode = 'mayhem' | 'mayhem-likely' | 'aram' | 'other';

export interface MayhemModeSignals {
  gameMode?: string | null;
  mapName?: string | null;
  /** From the loading payload / gameflow session, kept for the whole match. */
  queueId?: number | null;
  mapId?: number | null;
  /**
   * At least two augment cards were matched on screen. Only used as a fallback
   * when the queue is unknown — a classic ARAM queue id always wins.
   */
  augmentOffersDetected?: boolean;
}

/**
 * Howling Abyss by map name (`Howling Abyss` / `Map12`) or map id.
 * The Live Client sends "Map12" for both classic ARAM and Mayhem.
 */
export function isAramMap(mapName?: string | null, mapId?: number | null): boolean {
  if (mapId === HOWLING_ABYSS_MAP_ID) return true;
  const map = (mapName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return map.includes('howling') || map === 'map12';
}

function queueKind(queueId?: number | null): 'mayhem' | 'aram' | null {
  if (typeof queueId !== 'number' || !Number.isFinite(queueId)) return null;
  if (MAYHEM_QUEUE_IDS.includes(queueId)) return 'mayhem';
  if (ARAM_QUEUE_IDS.includes(queueId)) return 'aram';
  return null;
}

/**
 * Classify a game into Mayhem / Mayhem-likely / classic ARAM / anything else.
 *
 * The Live Client reports `gameMode: "ARAM"` on `Map12` for real Mayhem and
 * its queue id is often unknown, so Howling Abyss with no known classic queue
 * is `mayhem-likely`: every Mayhem feature is enabled without claiming the
 * match is definitely Mayhem.
 *
 * Precedence: a known Mayhem queue or a KIWI/MAYHEM mode string wins; a known
 * classic ARAM queue (450/100) is a hard `aram` even when OCR saw augments; a
 * known non-ARAM queue on Howling Abyss is Mayhem; an unknown queue on
 * Howling Abyss is `mayhem-likely`.
 */
export function detectMayhemMode(signals: MayhemModeSignals): MayhemMode {
  const mode = (signals.gameMode || '').toUpperCase();
  const modeSaysMayhem = mode.includes('KIWI') || mode.includes('MAYHEM');
  const queue = queueKind(signals.queueId);
  const howling = isAramMap(signals.mapName, signals.mapId);

  if (queue === 'mayhem') return 'mayhem';
  if (modeSaysMayhem) return 'mayhem';
  if (queue === 'aram') return 'aram';

  if (howling) {
    // Known queue that is not classic ARAM on the shared map: Mayhem.
    if (queue === null && typeof signals.queueId === 'number' && Number.isFinite(signals.queueId)) {
      return 'mayhem';
    }
    if (signals.augmentOffersDetected) return 'mayhem';
    return 'mayhem-likely';
  }

  if (mode.includes('ARAM')) {
    if (signals.augmentOffersDetected) return 'mayhem';
    return 'aram';
  }
  return 'other';
}

/** Mayhem or its Howling-Abyss fallback: every Mayhem feature applies. */
export function isMayhemMode(mode: MayhemMode | null | undefined): boolean {
  return mode === 'mayhem' || mode === 'mayhem-likely';
}

/** ARAM: Mayhem — Live Client often reports generic ARAM on Howling Abyss. */
export function isMayhemGame(
  gameMode: string | null | undefined,
  mapName?: string | null,
  signals?: Omit<MayhemModeSignals, 'gameMode' | 'mapName'>
): boolean {
  return isMayhemMode(detectMayhemMode({ ...signals, gameMode, mapName }));
}

/** Howling Abyss — classic ARAM and Mayhem. */
export function isAramOrMayhem(
  gameMode?: string | null,
  mapName?: string | null,
  signals?: Omit<MayhemModeSignals, 'gameMode' | 'mapName'>
): boolean {
  return detectMayhemMode({ ...signals, gameMode, mapName }) !== 'other';
}
