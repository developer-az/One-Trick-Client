export function isMayhemRerollOcrText(ocrText: string): boolean {
  return /\breroll\b/i.test(ocrText);
}

export interface MayhemOfferStabilityState {
  rerollPending: boolean;
}

/**
 * Keep augment picks stable while the player is deciding (including reroll animations).
 * Never shrink the offer list mid-session unless a full new triple is read.
 */
export function stabilizeMayhemOffers(
  previous: string[],
  matched: string[],
  ocrText: string,
  sessionActive: boolean,
  state: MayhemOfferStabilityState
): string[] {
  const next = matched.filter(Boolean).slice(0, 3);
  if (isMayhemRerollOcrText(ocrText)) state.rerollPending = true;

  if (!sessionActive) {
    state.rerollPending = false;
    return next;
  }

  if (state.rerollPending) {
    if (next.length >= 3) {
      state.rerollPending = false;
      return next;
    }
    return previous.length > 0 ? previous : next;
  }

  if (next.length === 0) return previous;
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
