/**
 * PageUp / PageDown routing, kept pure so the actual main-process handler can
 * be proven without Electron.
 *
 * In every ARAM-family game (Howling Abyss / ARAM-ish game mode, including a
 * plain classic 450 match) the two keys belong to the Mayhem panel: PageUp
 * dismisses, PageDown runs one manual scan. Only outside ARAM-family do they
 * toggle the Flash / Ignite tracking, as before.
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
