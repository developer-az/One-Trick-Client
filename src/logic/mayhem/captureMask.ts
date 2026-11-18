/**
 * Screen-capture masking for the augment OCR.
 *
 * The overlay draws its own HUD panels over the game, and the mayhem panel
 * sits on the right rail — inside the region the OCR crop reads. Rather than
 * toggling capture protection (which would also hide the HUD from the user's
 * recordings), the capture paints black over the panel footprint before the
 * frame goes to Windows OCR.
 *
 * The PowerShell capture computes that footprint itself from the window it
 * captured (mayhem-ocr.ps1 / Get-PanelMaskRect), so the mask and the pixels
 * can never come from different displays. `mayhemPanelMaskRect` below remains
 * for the desktopCapturer fallback, whose frame is a DIP display thumbnail and
 * therefore needs the whole-rect DIP → physical conversion.
 *
 * The rect is the shipped right-rail default (`x = 0.982`, `y = 0.26`,
 * 380×220 CSS px, see src/overlay/hudLayout.ts + OverlayApp's mayhem panel).
 *
 * Serialisation contract (desktopCapturer fallback): `formatMaskRects` and
 * `parseMaskRects` speak the `x,y,w,h;x,y,w,h` string that mayhem-ocr.ps1
 * parses for its mask rectangles. Nothing on the live Electron path uses them —
 * the PowerShell capture derives its mask internally from the frame it
 * captured — but they stay the documented shape for a fallback capture that
 * must ship its mask across the process boundary, and `verify_mayhem_live.ts`
 * pins the round trip. Do not delete them.
 */

import { DEFAULT_OFFER_FRACTIONS, MIN_CAPTURE_PX } from './captureRegion';

export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Panel footprint in CSS pixels (max width used by OverlayApp). */
export const MAYHEM_PANEL_WIDTH_DIP = 380;
export const MAYHEM_PANEL_HEIGHT_DIP = 220;
export const MAYHEM_PANEL_RIGHT_FRAC = 0.982;
export const MAYHEM_PANEL_TOP_FRAC = 0.26;

/**
 * Panel rect in physical screen pixels for a display's DIP bounds.
 *
 * The PS1 sets `SetProcessDPIAware()`, so it works in physical pixels while
 * Electron's `display.bounds` are DIP. The whole rect — origin, rail anchor and
 * footprint — must be scaled, or at 125% the mask sits up and to the left of
 * the rail and covers the augment cards.
 */
export function mayhemPanelMaskRect(
  displayBounds: { x: number; y: number; width: number; height: number },
  scaleFactor = 1
): PhysicalRect {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const width = Math.round(MAYHEM_PANEL_WIDTH_DIP * scale);
  const height = Math.round(MAYHEM_PANEL_HEIGHT_DIP * scale);
  const right =
    Math.round(displayBounds.x * scale) +
    Math.round(displayBounds.width * scale * MAYHEM_PANEL_RIGHT_FRAC);
  const top =
    Math.round(displayBounds.y * scale) +
    Math.round(displayBounds.height * scale * MAYHEM_PANEL_TOP_FRAC);
  return { x: right - width, y: top, width, height };
}

/**
 * The offer band cut from a full-screen desktopCapturer frame, in physical
 * pixels. Mirrors the PowerShell script's `Get-OfferGeometry` (truncated
 * fractions, 64 px floor) so the fallback crop and the window capture read the
 * same region of the screen.
 */
export function mayhemFallbackCropRect(width: number, height: number): PhysicalRect {
  return {
    x: Math.trunc(width * DEFAULT_OFFER_FRACTIONS.leftFrac),
    y: Math.trunc(height * DEFAULT_OFFER_FRACTIONS.topFrac),
    width: Math.max(MIN_CAPTURE_PX, Math.trunc(width * DEFAULT_OFFER_FRACTIONS.widthFrac)),
    height: Math.max(MIN_CAPTURE_PX, Math.trunc(height * DEFAULT_OFFER_FRACTIONS.heightFrac)),
  };
}

/**
 * Serialise mask rects for the PowerShell capture: `x,y,w,h;x,y,w,h`.
 *
 * Fallback-path contract only (see the file header); `parseMaskRects` is its
 * inverse and `verify_mayhem_live.ts` pins the round trip.
 */
export function formatMaskRects(rects: PhysicalRect[]): string {
  return rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`)
    .join(';');
}

/** Inverse of `formatMaskRects`: the mask rects a fallback capture reported. */
export function parseMaskRects(spec: string): PhysicalRect[] {
  if (!spec) return [];
  const out: PhysicalRect[] = [];
  for (const part of spec.split(';')) {
    const numbers = part.split(',').map((n) => Number(n.trim()));
    if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) continue;
    const [x, y, width, height] = numbers;
    if (width > 0 && height > 0) out.push({ x, y, width, height });
  }
  return out;
}

/** Intersect a screen-space mask with the capture rect, in capture-local coords. */
export function maskRectInCapture(
  mask: PhysicalRect,
  capture: PhysicalRect
): PhysicalRect | null {
  const left = Math.max(mask.x, capture.x);
  const top = Math.max(mask.y, capture.y);
  const right = Math.min(mask.x + mask.width, capture.x + capture.width);
  const bottom = Math.min(mask.y + mask.height, capture.y + capture.height);
  if (right <= left || bottom <= top) return null;
  return { x: left - capture.x, y: top - capture.y, width: right - left, height: bottom - top };
}
