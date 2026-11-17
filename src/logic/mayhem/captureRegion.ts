/**
 * Capture geometry for `electron/scripts/mayhem-ocr.ps1`, kept pure so the
 * fallback coordinate space can be proven without Windows OCR.
 *
 * The PowerShell script does this arithmetic itself; this module is its
 * mirror. The fallback captures the PRIMARY screen's complete bounds — never
 * the monitor the cursor happens to be on — masks in that screen space, and
 * then crops the same offer band a matched game window would use, relative to
 * the primary bounds (with no window to measure, the game is assumed to fill
 * the primary screen). Masks are physical-pixel screen rectangles and are
 * translated into the capture's own origin, exactly like `Set-MaskRectangles`.
 *
 * `src/logic/mayhem/captureMask.ts` is the Electron-side mask builder; this
 * module owns only the fallback frame's bounds, crop and mask translation.
 */

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A captured frame in screen coordinates (the same space masks use). */
export interface CaptureRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OfferFractions {
  leftFrac: number;
  topFrac: number;
  widthFrac: number;
  heightFrac: number;
}

/** The ps1 defaults: the offer row sits in a centered band of the game frame. */
export const DEFAULT_OFFER_FRACTIONS: OfferFractions = {
  leftFrac: 0.08,
  topFrac: 0.18,
  widthFrac: 0.84,
  heightFrac: 0.62,
};

/** Mirror of the ps1's `[Math]::Max(64, ...)` guard. */
export const MIN_CAPTURE_PX = 64;

/**
 * No game window matched: the fallback frame is the primary screen's FULL
 * bounds. `cursorScreen` is accepted only so callers/tests can show that the
 * monitor under the cursor is deliberately ignored.
 */
export function primaryFallbackRegion(
  primary: ScreenBounds,
  cursorScreen?: ScreenBounds | null
): CaptureRegion {
  // The monitor under the cursor is deliberately ignored: only the primary
  // screen's full bounds define a fallback frame.
  void cursorScreen;
  return {
    left: primary.x,
    top: primary.y,
    width: Math.max(MIN_CAPTURE_PX, primary.width),
    height: Math.max(MIN_CAPTURE_PX, primary.height),
  };
}

/** The offer band of a bounds rect: what the game-window path captures. */
export function fractionalOfferRegion(
  bounds: ScreenBounds,
  fractions: OfferFractions = DEFAULT_OFFER_FRACTIONS
): CaptureRegion {
  return {
    left: bounds.x + Math.trunc(bounds.width * fractions.leftFrac),
    top: bounds.y + Math.trunc(bounds.height * fractions.topFrac),
    width: Math.max(MIN_CAPTURE_PX, Math.trunc(bounds.width * fractions.widthFrac)),
    height: Math.max(MIN_CAPTURE_PX, Math.trunc(bounds.height * fractions.heightFrac)),
  };
}

export interface FallbackCapture {
  /** The full primary-screen frame; masks are applied in this space. */
  capture: CaptureRegion;
  /** The offer band cut from that frame after masking, in screen coordinates. */
  crop: CaptureRegion;
}

/**
 * The whole fallback path (mirrors `Capture-PrimaryScreen` in the ps1): capture
 * the primary screen's full bounds, mask there, then crop the offer band
 * relative to the primary bounds. The cursor's monitor never participates.
 */
export function primaryFallbackCapture(
  primary: ScreenBounds,
  cursorScreen?: ScreenBounds | null,
  fractions: OfferFractions = DEFAULT_OFFER_FRACTIONS
): FallbackCapture {
  return {
    capture: primaryFallbackRegion(primary, cursorScreen),
    crop: fractionalOfferRegion(primary, fractions),
  };
}

/**
 * A screen-space mask rect in the capture frame's local pixels. The ps1 clips
 * the result to the bitmap in `Set-MaskRectangles`; the raw offset is what
 * this mirror pins.
 */
export function screenRectToCapture(rect: ScreenBounds, capture: CaptureRegion): CaptureRegion {
  return {
    left: rect.x - capture.left,
    top: rect.y - capture.top,
    width: rect.width,
    height: rect.height,
  };
}
