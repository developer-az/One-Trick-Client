/**
 * Passive gold difference from items only.
 *
 * League never exposes another player's gold during your own game. Companion
 * overlays (Blitz, Porofessor, Hexgate) therefore add up the full shop price of
 * the items every player is holding, which the official Live Client Data API
 * reports for all ten players. Consumables and trinkets are left out: they are
 * either used up or free, so they do not represent banked power.
 *
 * The number is "item gold", not total gold earned: unspent gold is invisible
 * to everyone and only becomes power at the next recall.
 */

export interface GoldItemRef {
  itemID?: number;
  /** Full shop price from the Live Client item row. */
  price?: number | null;
  /** The Live Client flags potions, wards and elixirs as consumable. */
  consumable?: boolean;
  count?: number;
}

/** Trinkets are free and always present; they never contribute gold. */
const TRINKET_ITEM_IDS: ReadonlySet<number> = new Set([3340, 3361, 3362, 3363, 3364]);

/** Is this held item part of the item-gold total? */
export function isItemGoldCounted(item: GoldItemRef | null | undefined): boolean {
  if (!item) return false;
  if (!item.itemID || item.itemID <= 0) return false;
  if (item.consumable === true) return false;
  if (TRINKET_ITEM_IDS.has(item.itemID)) return false;
  const price = item.price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

/** Sum of the full shop prices of one player's held items. */
export function itemGoldOf(items: readonly GoldItemRef[] | null | undefined): number {
  let total = 0;
  for (const item of items || []) {
    if (!isItemGoldCounted(item)) continue;
    const count =
      typeof item.count === 'number' && Number.isFinite(item.count) && item.count > 0
        ? Math.floor(item.count)
        : 1;
    total += (item.price as number) * count;
  }
  return total;
}

export interface ItemGoldRow {
  /** Precomputed by the main process from the Live Client item prices. */
  itemGold?: number | null;
}

export interface ItemGoldLead {
  /** Your team's item gold (you + allies). */
  mine: number;
  /** The enemy team's item gold. */
  theirs: number;
  /** `mine - theirs`; positive means your team is richer in items. */
  diff: number;
  /**
   * Every row had a price-backed item-gold value. False means one read was
   * missing (a player row not delivered yet), so the totals are a lower bound.
   */
  complete: boolean;
}

/**
 * Team item-gold totals for the HUD. Returns null until there is at least one
 * enemy row, so a loading screen never shows a fake 0 vs 0 lead.
 */
export function teamItemGoldLead(input: {
  local?: number | null;
  allies?: readonly ItemGoldRow[] | null;
  enemies?: readonly ItemGoldRow[] | null;
}): ItemGoldLead | null {
  const enemies = input.enemies || [];
  if (enemies.length === 0) return null;
  const local = input.local;
  let mine = typeof local === 'number' && Number.isFinite(local) ? local : 0;
  let complete = typeof local === 'number' && Number.isFinite(local);
  for (const ally of input.allies || []) {
    if (typeof ally.itemGold === 'number' && Number.isFinite(ally.itemGold)) {
      mine += ally.itemGold;
    } else {
      complete = false;
    }
  }
  let theirs = 0;
  for (const enemy of enemies) {
    if (typeof enemy.itemGold === 'number' && Number.isFinite(enemy.itemGold)) {
      theirs += enemy.itemGold;
    } else {
      complete = false;
    }
  }
  return { mine, theirs, diff: mine - theirs, complete };
}

/** "850" / "8.2k" / "24.1k" — short enough for the rail. */
export function formatItemGold(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (safe < 1000) return String(safe);
  return `${(safe / 1000).toFixed(1)}k`;
}

/** "+1.2k" / "−850" / "even". */
export function formatGoldLead(diff: number): string {
  if (!Number.isFinite(diff)) return 'even';
  const rounded = Math.round(diff);
  if (rounded === 0) return 'even';
  return `${rounded > 0 ? '+' : '-'}${formatItemGold(Math.abs(rounded))}`;
}
