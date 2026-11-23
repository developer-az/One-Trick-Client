/**
 * PageUp / PageDown routing, kept pure so the actual main-process handler can
 * be proven without Electron.
 *
 * In every ARAM-family game (Howling Abyss / ARAM-ish game mode, including a
 * plain classic 450 match) the two keys belong to the Mayhem panel: PageUp
 * toggles it (dismiss a visible roll, restore a dismissed/hidden one),
 * PageDown always restores with one manual scan. Only outside ARAM-family do
 * they toggle the Flash / Ignite tracking, as before.
 */

export type HotkeyRoute = 'mayhem-dismiss' | 'mayhem-scan' | 'flash-primary' | 'flash-secondary';

export interface HotkeyContext {
  /** A live board exists right now. */
  inGame: boolean;
  /** Howling Abyss / ARAM-ish mode, any classification (including `aram`). */
  aramFamily: boolean;
}

const PRIMARY_KEYS = new Set(['PageUp', 'Prior', 'num9']);
const SECONDARY_KEYS = new Set(['PageDown', 'Next', 'num3']);

/**
 * Route one hotkey press. Returns null for a key this router does not own.
 * `aramFamily` wins over `inGame`: the classic ARAM manual scan is exactly the
 * case that must still reach the Mayhem panel while the board is live.
 */
export function routeHotkey(key: string, ctx: HotkeyContext): HotkeyRoute | null {
  if (!ctx.inGame) return null;
  const primary = PRIMARY_KEYS.has(key);
  const secondary = SECONDARY_KEYS.has(key);
  if (!primary && !secondary) return null;
  if (ctx.aramFamily) return primary ? 'mayhem-dismiss' : 'mayhem-scan';
  return primary ? 'flash-primary' : 'flash-secondary';
}

/**
 * What one PageUp press does to the augment panel: hide the roll it can see,
 * or bring a dismissed/hidden roll back.
 */
export type MayhemPageUpAction = 'dismiss' | 'restore';

export interface MayhemPageUpInput {
  /** The augment HUD is on screen right now. */
  panelVisible: boolean;
  /** The player's dismissal window is still open. */
  dismissed: boolean;
  /** A capture/OCR scan is already running, so a second read is not fresh. */
  scanInFlight: boolean;
}

export type MayhemPageUpReason = 'panel-visible' | 'dismissed' | 'panel-hidden' | 'scan-in-flight';

export interface MayhemPageUpDecision {
  action: MayhemPageUpAction;
  /**
   * A restore must never commit a read that is not fresh: an in-flight scan
   * still answers with the previous roll, and writing it would purge or
   * resurrect the panel the player is looking at.
   */
  suppressNonFreshWrite: boolean;
  /** Why the action was chosen; goes into the one overlay.log route line. */
  reason: MayhemPageUpReason;
}

/**
 * PageUp is a toggle, so the key that only ever dismissed can no longer be the
 * only thing it does. A visible, non-dismissed panel is still hidden exactly as
 * before; anything else takes the restore path PageDown uses. Keeping this
 * decision pure is what lets the toggle be proven without Electron.
 */
export function decideMayhemPageUp(input: MayhemPageUpInput): MayhemPageUpDecision {
  if (input.panelVisible && !input.dismissed) {
    return { action: 'dismiss', suppressNonFreshWrite: false, reason: 'panel-visible' };
  }
  if (input.scanInFlight) {
    // Same rule as PageDown: the dismissal is still cleared (so the next scan
    // can show the roll) but the in-flight read must not be written.
    return { action: 'restore', suppressNonFreshWrite: true, reason: 'scan-in-flight' };
  }
  return {
    action: 'restore',
    suppressNonFreshWrite: false,
    reason: input.dismissed ? 'dismissed' : 'panel-hidden',
  };
}
