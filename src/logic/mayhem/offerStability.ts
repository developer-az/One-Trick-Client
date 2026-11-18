export function isMayhemRerollOcrText(ocrText: string): boolean {
  return /\breroll\b/i.test(ocrText);
}

/**
 * Consecutive OCR frames without fresh cards before a retained roll is dropped.
 * `verify:mayhem-visibility` freezes the 2-offer HUD threshold; this is the
 * matching give-up count for retention (never keep a stale shop forever).
 */
export const MAYHEM_OFFER_MISS_LIMIT = 2;

export interface MayhemOfferStabilityState {
  rerollPending: boolean;
  /** Consecutive OCR frames that brought no fresh cards while a pick window is open. */
  missCount?: number;
}

/**
 * Keep augment picks stable while the player is deciding (including reroll animations).
 * Never shrink the offer list mid-session unless a full new triple is read, and
 * give up after MAYHEM_OFFER_MISS_LIMIT consecutive frames without fresh cards.
 */
export function stabilizeMayhemOffers(
  previous: string[],
  matched: string[],
  ocrText: string,
  sessionActive: boolean,
  state: MayhemOfferStabilityState
): string[] {
  const next = matched.filter(Boolean).slice(0, 3);
  // mayhem-ocr hands the previous roll straight back when a frame matched no
  // cards; a real re-read always builds a fresh array. Reference equality is
  // the only "nothing new was read" signal the caller provides.
  const stale = matched === previous;
  if (isMayhemRerollOcrText(ocrText)) state.rerollPending = true;

  if (!sessionActive) {
    state.rerollPending = false;
    state.missCount = 0;
    return next;
  }

  if (state.rerollPending) {
    if (next.length >= 3) {
      state.rerollPending = false;
      state.missCount = 0;
      return next;
    }
    return previous.length > 0 ? previous : next;
  }

  if (next.length === 0 || stale) {
    const misses = (state.missCount ?? 0) + 1;
    state.missCount = misses;
    if (misses < MAYHEM_OFFER_MISS_LIMIT) return previous;
    // Cards are gone: drop the stale roll so the HUD can close.
    state.missCount = 0;
    return [];
  }

  state.missCount = 0;
  if (next.length >= 3) return next;
  if (previous.length === 0) return next;
  if (previous.length >= 3 && next.length < 3) return previous;
  if (next.length < previous.length) return previous;
  if (previous.length >= 2 && next.length === 2 && !setsEqual(previous, next)) {
    return mergeOfferIds(previous, next);
  }
  return next;
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Combine partial reads (e.g. 2+1 across OCR frames) up to three distinct ids. */
function mergeOfferIds(previous: string[], next: string[]): string[] {
  const out: string[] = [];
  for (const id of [...previous, ...next]) {
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= 3) break;
  }
  return out;
}
