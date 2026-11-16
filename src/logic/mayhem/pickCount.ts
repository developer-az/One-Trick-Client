/**
 * Counting the augments a player has taken.
 *
 * The level gate (3 / 7 / 11 / 15) is NOT a pick counter: level 3 only means
 * the first augment became available, and a player can sit at level 5 for a
 * while without ever opening the shop. A pick is only counted when
 *   - the Live Client reports the owned augments (authoritative), or
 *   - offers were read in ≥2 consecutive scans and then gone for ≥2
 *     consecutive scans, while alive, with the game in the foreground and a
 *     non-black captured frame.
 */

export const MAYHEM_PICK_OFFER_SCANS_REQUIRED = 2;
export const MAYHEM_PICK_EMPTY_SCANS_REQUIRED = 2;

export interface MayhemPickCounterState {
  picksTaken: number;
  /** Consecutive fresh OCR scans that read ≥2 offers. */
  offerScans: number;
  /** Consecutive fresh OCR scans that read no offers. */
  emptyScans: number;
}

export interface MayhemPickScan {
  /** Distinct augment ids matched on this scan (0 when OCR saw no cards). */
  offerCount: number;
  isDead: boolean;
  /** The game window owns the foreground, so the pick screen was on top. */
  foreground: boolean;
  /** Captured frame was black (exclusive fullscreen blocks BitBlt). */
  blackFrame: boolean;
  /** Live Client owned augment ids, when the game exposes them. */
  liveAugmentIds?: string[];
}

export function createMayhemPickCounterState(picksTaken = 0): MayhemPickCounterState {
  return { picksTaken: Math.max(0, Math.floor(picksTaken)), offerScans: 0, emptyScans: 0 };
}

/**
 * Live Client ground truth: `/activeplayer` may carry an `augments` array
 * (Arena-style modes). Accept either plain ids or `{ id | augmentId }` rows.
 */
export function readLiveAugmentIds(source: unknown): string[] {
  if (!source || typeof source !== 'object') return [];
  const raw = (source as { augments?: unknown }).augments;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (typeof row === 'string' && row) out.push(row);
    else if (row && typeof row === 'object') {
      const rec = row as { id?: unknown; augmentId?: unknown; name?: unknown };
      const id =
        typeof rec.augmentId === 'string'
          ? rec.augmentId
          : typeof rec.id === 'string'
            ? rec.id
            : typeof rec.name === 'string'
              ? rec.name
              : null;
      if (id) out.push(id);
    }
  }
  return [...new Set(out)];
}

/** One fresh OCR scan through the hysteresis counter. */
export function observeMayhemPickScan(
  state: MayhemPickCounterState,
  scan: MayhemPickScan
): MayhemPickCounterState {
  const authoritative = scan.liveAugmentIds?.length ?? 0;
  if (authoritative > 0) {
    return {
      picksTaken: Math.max(state.picksTaken, authoritative),
      offerScans: 0,
      emptyScans: 0,
    };
  }

  // No trustworthy frame: keep the streak we already had.
  if (scan.blackFrame || !scan.foreground) return state;

  if (scan.offerCount >= MAYHEM_PICK_OFFER_SCANS_REQUIRED) {
    return { picksTaken: state.picksTaken, offerScans: state.offerScans + 1, emptyScans: 0 };
  }

  if (scan.offerCount === 0) {
    const emptyScans = state.emptyScans + 1;
    const offersWereUp = state.offerScans >= MAYHEM_PICK_OFFER_SCANS_REQUIRED;
    if (offersWereUp && emptyScans >= MAYHEM_PICK_EMPTY_SCANS_REQUIRED && !scan.isDead) {
      return { picksTaken: state.picksTaken + 1, offerScans: 0, emptyScans: 0 };
    }
    return { picksTaken: state.picksTaken, offerScans: state.offerScans, emptyScans };
  }

  // A single partial read (one card / an OCR miss) proves nothing either way.
  return state;
}
