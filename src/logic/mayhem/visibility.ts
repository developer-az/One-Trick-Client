/** Auto-show overlay only when OCR likely sees the augment shop (not one random word). */
export const MIN_AUTO_AUGMENT_OFFERS_FOR_HUD = 2;

/**
 * Augment HUD is visible only when screen OCR matched real offer names —
 * not when Live Client thinks you might be picking.
 */
export function isMayhemAugmentHudVisible(
  offerIds: string[],
  manualScanActive: boolean
): boolean {
  if (offerIds.length >= MIN_AUTO_AUGMENT_OFFERS_FOR_HUD) return true;
  if (manualScanActive && offerIds.length >= 1) return true;
  return false;
}
