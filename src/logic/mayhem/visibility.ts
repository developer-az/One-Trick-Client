import { MAYHEM_HIGH_CONFIDENCE_SCORE } from './match';

/** Auto-show overlay only when OCR likely sees the augment shop (not one random word). */
export const MIN_AUTO_AUGMENT_OFFERS_FOR_HUD = 2;

/** A single offer needs this many consecutive scans before it may open the HUD alone. */
export const MIN_SINGLE_OFFER_SCANS = 2;

export interface MayhemSingleOfferEvidence {
  /** Consecutive fresh OCR scans that read exactly this one offer. */
  consecutiveScans: number;
  /** Best fuzzy score (0–1) of the matched card title. */
  fuzzyScore: number;
}

/**
 * Augment HUD is visible only when screen OCR matched real offer names —
 * not when Live Client thinks you might be picking. Two offers are enough;
 * one is allowed for a manual Page Down scan or when the same single card was
 * read in ≥2 consecutive scans at high fuzzy confidence.
 */
export function isMayhemAugmentHudVisible(
  offerIds: string[],
  manualScanActive: boolean,
  singleOffer?: MayhemSingleOfferEvidence
): boolean {
  if (offerIds.length >= MIN_AUTO_AUGMENT_OFFERS_FOR_HUD) return true;
  if (offerIds.length !== 1) return false;
  if (manualScanActive) return true;
  if (!singleOffer) return false;
  return (
    singleOffer.consecutiveScans >= MIN_SINGLE_OFFER_SCANS &&
    singleOffer.fuzzyScore >= MAYHEM_HIGH_CONFIDENCE_SCORE
  );
}
