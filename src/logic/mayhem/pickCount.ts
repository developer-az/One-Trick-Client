/**
 * Counting the augments a player has taken.
 *
 * The level gate (3 / 7 / 11 / 15) is NOT a pick counter: level 3 only means
 * the first augment became available, and a player can sit at level 5 for a
 * while without ever opening the shop. A pick is only counted when
 *   - the Live Client reports the owned augments (authoritative), or
 *   - offers were read in ≥2 consecutive scans and then gone for ≥2
 *     consecutive scans, while alive, from a trusted game-window capture
 *     (`isTrustedMayhemFrame`) with a non-black frame.
 */

import { isUnknownMayhemAugmentId } from './match';

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
  /**
   * The scan came from a trusted game-window capture — the OCR read target
   * passed `isTrustedMayhemFrame` (real game window, fresh read), NOT whether
   * the game owned the OS foreground. The field keeps the old name because its
   * writer lives in src/logic/mayhem/monitor.ts.
   */
  foreground: boolean;
  /** Captured frame was black (exclusive fullscreen blocks BitBlt). */
  blackFrame: boolean;
  /** Live Client owned augment ids, when the game exposes them. */
  liveAugmentIds?: string[];
  /**
   * This frame displayed card rows even when no id was known. An all-unknown
   * patch-day roll shows rows with zero matched ids; treating it as an empty
   * frame would advance the empty streak and book a phantom pick.
   */
  hasDisplayedOffers?: boolean;
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
    // Rows on screen with no known id are a shop the bundle cannot read, not an
    // empty frame: neither the empty streak nor the armed roll may change.
    if (scan.hasDisplayedOffers) return state;
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

/**
 * How long after a pick an offer gap may still turn out to be a reroll.
 *
 * A reroll reads as offers → empty (shop animating) → a disjoint new roll
 * within a second or two. The next augment level is minutes away, so a
 * disjoint roll that appears inside this window cannot be the new pick level.
 */
export const MAYHEM_REROLL_PICK_WINDOW_MS = 8000;

/**
 * Undo a pick that a reroll's empty gap produced.
 *
 * The counter has to act on the frames it sees; it cannot know at empty-time
 * whether the shop is refreshing or the player picked. When the next roll is
 * disjoint from the roll that vanished, the gap was the shop re-dealing: take
 * the spurious pick back. Returns `reverted: false` (and the same state) for an
 * overlapping roll (a misread of the same shop) or a roll that arrives after
 * the window (a real new pick level).
 *
 * An `unknown:` placeholder is a guess, never evidence about the roll, so a
 * placeholder-only set on either side can never move the counter — in either
 * direction. On patch day the next shop can be three placeholders; without the
 * guard they are trivially disjoint from a known roll and would undo a pick the
 * player really took (the counter is authoritative when `owned` is empty).
 */
export function revertMayhemRerollPick(
  state: MayhemPickCounterState,
  previousRollIds: string[],
  nextRollIds: string[],
  elapsedSincePickMs: number
): { state: MayhemPickCounterState; reverted: boolean } {
  if (state.picksTaken <= 0) return { state, reverted: false };
  if (!previousRollIds.length || !nextRollIds.length) return { state, reverted: false };
  if (nextRollIds.every((id) => isUnknownMayhemAugmentId(id))) return { state, reverted: false };
  if (previousRollIds.every((id) => isUnknownMayhemAugmentId(id))) return { state, reverted: false };
  if (!Number.isFinite(elapsedSincePickMs)) return { state, reverted: false };
  if (elapsedSincePickMs < 0 || elapsedSincePickMs > MAYHEM_REROLL_PICK_WINDOW_MS) {
    return { state, reverted: false };
  }
  if (nextRollIds.some((id) => previousRollIds.includes(id))) return { state, reverted: false };
  return {
    state: { ...state, picksTaken: state.picksTaken - 1 },
    reverted: true,
  };
}
