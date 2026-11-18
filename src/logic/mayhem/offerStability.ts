export function isMayhemRerollOcrText(ocrText: string): boolean {
  return /\breroll\b/i.test(ocrText);
}

export interface MayhemOfferStabilityState {
  rerollPending: boolean;
}

/** Normalize one frame's matched ids: drop blanks, de-dupe, keep card order. */
function freshOfferIds(matched: string[]): string[] {
  const out: string[] = [];
  for (const id of matched) {
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * The shop dealt a new roll.
 *
 * The Reroll button sits outside the OCR crop, so the word "reroll" is never
 * part of the read text. The offers themselves are the signal: a reroll
 * replaces every card, so the fresh ids share nothing with the previous roll.
 * A partial read of the SAME roll always keeps at least one shared id.
 */
export function isNewMayhemOfferRoll(previous: string[], next: string[]): boolean {
  if (!previous.length || !next.length) return false;
  return !next.some((id) => previous.includes(id));
}

/**
 * Keep augment picks stable while the player is deciding (including reroll
 * animations).
 *
 * A disjoint offer set is a reroll and is accepted even when only one or two
 * cards were read — the old roll must not survive a reroll. The never-shrink
 * rule only protects a partial read of the same roll (overlap).
 */
export function stabilizeMayhemOffers(
  previous: string[],
  matched: string[],
  ocrText: string,
  sessionActive: boolean,
  state: MayhemOfferStabilityState
): string[] {
  const next = freshOfferIds(matched);
  if (isMayhemRerollOcrText(ocrText)) state.rerollPending = true;

  if (!sessionActive) {
    state.rerollPending = false;
    return next;
  }

  // New roll: trust it, even a 1-2 card read, and arm the fast poll until the
  // full triple is on screen (a partial reroll read must not stall the HUD).
  // `rerollPending` belongs to the roll, not to the HUD: it outlives a
  // `setMayhemOcrRetainOffers(false)` tick and is cleared here as soon as the
  // triple is read (or by `resetMayhemOcrCache` at match start).
  if (isNewMayhemOfferRoll(previous, next)) {
    state.rerollPending = next.length < 3;
    return next;
  }

  if (state.rerollPending) {
    if (next.length >= 3) {
      state.rerollPending = false;
      return next;
    }
    // Same roll, incomplete animation read: keep the previous triple.
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
