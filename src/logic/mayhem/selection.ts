/**
 * Which augment the player clicked.
 *
 * The game gives us no pick event: the selection screen is closed by a left
 * click on one of the cards, and the client only stops drawing the roll. The
 * capture already knows where the card columns are, so the cursor position at
 * the first "cards are gone" frame names the card that was clicked.
 *
 * Pure: the OCR script reports the cursor normalized to the captured offer
 * band, the same space the card columns use. Nothing here guesses when the
 * cursor is outside every card; the caller then records the pick without an
 * augment id instead of inventing one.
 */

export interface MayhemCardCursor {
  /** Cursor x normalized to the captured offer band (0..1). */
  x: number;
  /** Cursor y normalized to the captured offer band (0..1). */
  y: number;
}

/** Three centred cards: the shipped layout. */
export const MAYHEM_THREE_CARD_COLUMNS = [0.33, 0.5, 0.67] as const;
/** Four cards: the Maestro headliner deal. */
export const MAYHEM_FOUR_CARD_COLUMNS = [0.245, 0.415, 0.585, 0.755] as const;

/** Both layouts are 0.17 apart; a click this close to a centre is on that card. */
export const MAYHEM_CARD_CLICK_HALF_WIDTH = 0.075;

/**
 * Vertical band of a card inside the offer crop. The crop starts above the
 * card top edge (y 0.14 of the window) and ends near the card bottom (0.80),
 * so a card covers almost the whole crop. The reroll / hide controls sit below
 * that crop, which is what keeps a reroll click from reading as a pick.
 */
const CARD_CLICK_MIN_Y = 0.02;
const CARD_CLICK_MAX_Y = 0.94;

/** The card columns for a roll of `cardCount` cards. */
export function mayhemCardColumns(cardCount: number): readonly number[] {
  return cardCount >= 4 ? MAYHEM_FOUR_CARD_COLUMNS : MAYHEM_THREE_CARD_COLUMNS;
}

/**
 * Index (left to right) of the card under the cursor, or null when the cursor
 * is outside every card. Used for a 3- or 4-card roll only.
 */
export function mayhemCardIndexAtCursor(
  cursor: MayhemCardCursor | null | undefined,
  cardCount: number
): number | null {
  if (!cursor) return null;
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  if (cursor.y < CARD_CLICK_MIN_Y || cursor.y > CARD_CLICK_MAX_Y) return null;
  const columns = mayhemCardColumns(cardCount).slice(0, Math.max(0, cardCount));
  if (columns.length === 0) return null;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < columns.length; index += 1) {
    const distance = Math.abs(columns[index] - cursor.x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || bestDistance > MAYHEM_CARD_CLICK_HALF_WIDTH) return null;
  return bestIndex;
}

/**
 * Resolve the clicked augment id from the roll that just vanished. The display
 * roll is left-to-right, exactly like the card columns, so the index maps
 * directly. An unknown placeholder is returned as the id; callers must not
 * persist or score it.
 */
export function pickedMayhemAugment(
  rollIds: readonly string[],
  cursor: MayhemCardCursor | null | undefined
): { id: string; index: number } | null {
  const count = rollIds.length;
  if (count < 3 || count > 4) return null;
  const index = mayhemCardIndexAtCursor(cursor, count);
  if (index == null) return null;
  const id = rollIds[index];
  return id ? { id, index } : null;
}
