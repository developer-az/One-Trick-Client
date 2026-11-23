/**
 * Augment offer acceptance: what one OCR frame means for the HUD.
 *
 * The auto scan asks for two matches so a single random card title cannot open
 * the HUD. That left a gap: a real one-card shop (a reroll landing on one
 * card, an occluded second card) produced no display ids at all, so the
 * single-offer gate could never reach its two consecutive scans.
 *
 * `candidateIds` is that pending frame: exactly one matched title at high
 * confidence. The monitor keeps the candidate across scans and promotes it to
 * `ids` only after the same id was read on consecutive qualifying frames.
 *
 * `frameIds` is the trust path and carries bundle-matched ids only; an
 * `unknown:` placeholder is a guess from an unrecognised title, so it can be
 * drawn (`ids`, `placeholderIds`) and ranked, but never latch Mayhem or move
 * the pick counter.
 *
 * Pure (no Electron, no disk); mayhem-ocr owns the previous-id/retain state.
 */

import { MAYHEM_HIGH_CONFIDENCE_SCORE, isUnknownMayhemAugmentId } from './match';
import { stabilizeMayhemOffers, type MayhemOfferStabilityState } from './offerStability';

export interface MayhemOfferAcceptance {
  /** Ids the HUD may draw. */
  ids: string[];
  /** A single high-confidence offer waiting for a consecutive scan. */
  candidateIds: string[];
  /**
   * Ids matched on this frame only, bundle-matched ones exclusively. This is the
   * trust path (discovery latch + pick counter): an `unknown:` placeholder is a
   * guess from an unrecognised title, so it may display but never prove an
   * offer.
   */
  frameIds: string[];
  /** `unknown:` placeholders read on this frame: display/ranking only. */
  placeholderIds: string[];
}

export interface MayhemOfferAcceptanceInput {
  /** OCR text, used for the reroll hint while a pick session retains offers. */
  text: string;
  /** Matched augment ids, best first. */
  matched: string[];
  /** Two for automatic scans; one for a manual PageDown. */
  minMatches: number;
  /** Best fuzzy confidence (0–1) of the matched titles on this frame. */
  fuzzyScore: number;
  /** The display ids the previous frame left behind. */
  previousIds: string[];
  /**
   * A pick session is open: keep the last roll across empty/partial reads.
   * Threaded into the stability guard, whose no-session branch is the live
   * "retain off" path (it clears a stale reroll hint and returns this frame).
   */
  retain: boolean;
  stability: MayhemOfferStabilityState;
}

export function acceptMayhemOfferFrame(input: MayhemOfferAcceptanceInput): MayhemOfferAcceptance {
  const matched = input.matched.filter(Boolean).slice(0, 3);
  // Display and trust are not the same set: a placeholder row may be drawn and
  // ranked, but only a bundle-matched id can latch Mayhem or count a pick.
  const placeholderIds = matched.filter((id) => isUnknownMayhemAugmentId(id));
  const frameIds = matched.filter((id) => !isUnknownMayhemAugmentId(id));
  const highConfidence = input.fuzzyScore >= MAYHEM_HIGH_CONFIDENCE_SCORE;
  let next: string[];
  let candidateIds: string[] = [];

  if (matched.length >= input.minMatches) {
    next = matched;
  } else if (matched.length === 0) {
    next = input.retain ? input.previousIds : [];
  } else if (input.minMatches <= 1) {
    next = matched;
  } else if (matched.length === 1 && highConfidence) {
    // Pending candidate: never display it on its own yet.
    candidateIds = [matched[0]];
    next = input.retain ? input.previousIds : [];
  } else {
    next = input.previousIds;
  }

  const ids = stabilizeMayhemOffers(
    input.previousIds,
    next,
    input.text,
    input.retain,
    input.stability
  );
  return { ids, candidateIds, frameIds, placeholderIds };
}
