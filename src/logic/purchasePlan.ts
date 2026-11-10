/**
 * Price- and gold-aware "what to buy now" planning.
 * All prices come from the supplied lookup (the shipped item catalog); nothing is hard-coded.
 */

import { countFilledItemSlots, TRINKET_ITEM_IDS } from './buildProgress';
import type { BuildItemRef } from './buildProgress';

export interface PriceEntry {
  id: string;
  name: string;
  gold: number;
  from: string[];
}

export type PriceLookup = (id: string) => PriceEntry | undefined;

export function catalogPriceLookup(items: ReadonlyArray<PriceEntry>): PriceLookup {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (id: string) => byId.get(id);
}

export interface PurchasePlan {
  targetId: string;
  targetName: string;
  totalCost: number | null;
  remainingCost: number | null;
  action: 'buy-full' | 'buy-component' | 'save' | 'no-slot' | 'unknown';
  buy: { id: string; name: string; cost: number } | null;
  needGold: number | null;
  cue: string;
}

type Owned = Map<string, number>;

const SLOT_COUNT = 6;

function buildOwned(
  inventory: Array<{ itemID: number; count?: number }> | undefined
): Owned {
  const owned: Owned = new Map();
  for (const item of inventory || []) {
    if (!item.itemID || item.itemID === 0) continue;
    const id = String(item.itemID);
    if (TRINKET_ITEM_IDS.has(id)) continue;
    const copies = item.count ?? 1;
    if (copies <= 0) continue;
    owned.set(id, (owned.get(id) ?? 0) + copies);
  }
  return owned;
}

function cloneOwned(owned: Owned): Owned {
  return new Map(owned);
}

/** Consume one owned copy of `id`; returns true when a copy was available. */
function takeOwned(owned: Owned, id: string): boolean {
  const copies = owned.get(id) ?? 0;
  if (copies <= 0) return false;
  if (copies === 1) owned.delete(id);
  else owned.set(id, copies - 1);
  return true;
}

interface ResolvedNode {
  entry: PriceEntry;
  remaining: number;
}

interface TreeResolution {
  remaining: number;
  /** Uncovered descendants in depth-first from[] order. */
  nodes: ResolvedNode[];
}

/**
 * Allocate owned copies across the recipe tree once and resolve every node.
 * Owning the item itself makes it free and hides its subtree; otherwise its
 * price is reduced by the value of any owned descendants on the recipe tree.
 */
function resolveTree(entry: PriceEntry, owned: Owned, prices: PriceLookup): TreeResolution {
  if (takeOwned(owned, entry.id)) return { remaining: 0, nodes: [] };

  let remaining = entry.gold;
  const nodes: ResolvedNode[] = [];
  for (const childId of entry.from) {
    const child = prices(childId);
    if (!child) continue;
    const childResolution = resolveTree(child, owned, prices);
    remaining -= child.gold - childResolution.remaining;
    nodes.push({ entry: child, remaining: childResolution.remaining }, ...childResolution.nodes);
  }
  return { remaining, nodes };
}

/**
 * Remaining cost for an item given owned copies.
 * Owning the item itself makes it free; otherwise its price is reduced by the
 * value of any owned descendants on the recipe tree.
 */
function remainingCost(entry: PriceEntry, owned: Owned, prices: PriceLookup): number {
  return resolveTree(entry, owned, prices).remaining;
}

function formatGold(value: number): string {
  return `${value.toLocaleString('en-US')}g`;
}

interface ComponentCandidate {
  id: string;
  name: string;
  cost: number;
  fullGold: number;
}

/**
 * Depth-first, from[]-order walk of the recipe tree under `entry`.
 * Every non-owned descendant becomes a candidate if its remaining cost is affordable.
 * Ties keep the first node encountered.
 */
function findBestComponent(
  entry: PriceEntry,
  owned: Owned,
  prices: PriceLookup,
  currentGold: number
): ComponentCandidate | null {
  const { nodes } = resolveTree(entry, owned, prices);
  let best: ComponentCandidate | null = null;

  for (const node of nodes) {
    if (node.remaining <= 0 || node.remaining > currentGold) continue;
    if (!best || node.remaining > best.cost) {
      best = {
        id: node.entry.id,
        name: node.entry.name,
        cost: node.remaining,
        fullGold: node.entry.gold,
      };
    }
  }

  return best;
}

export function planNextPurchase(args: {
  target: BuildItemRef | null;
  inventory: Array<{ itemID: number; count?: number }> | undefined;
  currentGold: number | null;
  prices: PriceLookup;
}): PurchasePlan | null {
  const { target, inventory, currentGold, prices } = args;

  if (!target) return null;

  const entry = prices(target.id);
  if (!entry) {
    return {
      targetId: target.id,
      targetName: target.name,
      totalCost: null,
      remainingCost: null,
      action: 'unknown',
      buy: null,
      needGold: null,
      cue: `Next: ${target.name}.`,
    };
  }

  const totalCost = entry.gold;
  const owned = buildOwned(inventory);
  const remaining = remainingCost(entry, cloneOwned(owned), prices);

  if (currentGold === null) {
    return {
      targetId: target.id,
      targetName: target.name,
      totalCost,
      remainingCost: remaining,
      action: 'unknown',
      buy: null,
      needGold: null,
      cue: `Next: ${target.name}.`,
    };
  }

  const hasFreeSlot = countFilledItemSlots(inventory) < SLOT_COUNT;

  if (currentGold >= remaining) {
    const consumesNothing = remaining === totalCost;
    if (!hasFreeSlot && consumesNothing) {
      return {
        targetId: target.id,
        targetName: target.name,
        totalCost,
        remainingCost: remaining,
        action: 'no-slot',
        buy: null,
        needGold: 0,
        cue: `No free slot for ${target.name} — sell or upgrade an item first.`,
      };
    }

    return {
      targetId: target.id,
      targetName: target.name,
      totalCost,
      remainingCost: remaining,
      action: 'buy-full',
      buy: { id: entry.id, name: target.name, cost: remaining },
      needGold: 0,
      cue: `Buy ${target.name} now (${formatGold(remaining)}).`,
    };
  }

  const needGold = remaining - currentGold;
  const component = findBestComponent(entry, cloneOwned(owned), prices, currentGold);

  if (!component) {
    return {
      targetId: target.id,
      targetName: target.name,
      totalCost,
      remainingCost: remaining,
      action: 'save',
      buy: null,
      needGold,
      cue: `Need ${formatGold(needGold)} more for ${target.name}.`,
    };
  }

  const consumesNothing = component.cost === component.fullGold;
  if (!hasFreeSlot && consumesNothing) {
    return {
      targetId: target.id,
      targetName: target.name,
      totalCost,
      remainingCost: remaining,
      action: 'no-slot',
      buy: null,
      needGold,
      cue: `No free slot for ${target.name} — sell or upgrade an item first.`,
    };
  }

  return {
    targetId: target.id,
    targetName: target.name,
    totalCost,
    remainingCost: remaining,
    action: 'buy-component',
    buy: { id: component.id, name: component.name, cost: component.cost },
    needGold,
    cue: `Buy ${component.name} now (${formatGold(component.cost)}) — ${target.name} needs ${formatGold(needGold)} more.`,
  };
}
