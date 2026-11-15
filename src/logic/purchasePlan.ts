/**
 * Price- and gold-aware "what to buy now" planning.
 * All prices come from the supplied lookup (the shipped item catalog); nothing is hard-coded.
 */

import { BASE_BOOT_ID, bootChainIds, isBootId } from './bootChains';
import { countFilledItemSlots, resolveOrderedBuyPath, TRINKET_ITEM_IDS } from './buildProgress';
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

export interface OrderedBuildShape {
  core: BuildItemRef[];
  boots: BuildItemRef;
  situational: BuildItemRef[];
}

export type BuySegment = 'core' | 'boots' | 'situational';

/** One entry on the single ordered buy path, numbered for the HUD/app queue. */
export interface OrderedBuyStep {
  rank: number;
  id: string;
  name: string;
  segment: BuySegment;
  owned: boolean;
  /** Remaining gold to finish this step given everything owned (null without prices). */
  cost: number | null;
  reason?: string;
}

export type BootVsItemRule = 'boots-first' | 'item-first' | 'none';

export interface BuyOrderDecision {
  action: 'buy-full' | 'buy-component' | 'save' | 'no-slot' | 'complete' | 'unknown';
  targetId: string | null;
  targetName: string | null;
  /** The exact item to buy NOW — the full step or an affordable component. */
  buy: { id: string; name: string; cost: number } | null;
  needGold: number | null;
}

export interface BuyOrderPlan {
  /** The numbered queue of still-to-buy steps, in resolved order (1..N). */
  steps: OrderedBuyStep[];
  /** The one BUY NEXT decision for the queue head. */
  decision: BuyOrderDecision;
  /** One rule + human-readable reason for the boots-versus-item choice. */
  bootsVsItem: { rule: BootVsItemRule; reason: string };
  /** True when the decision assumed selling the owned boots to free a slot. */
  afterSell: boolean;
}

function ownedMapFromSet(ids: ReadonlySet<string>): Owned {
  const owned: Owned = new Map();
  for (const id of ids) owned.set(id, 1);
  return owned;
}

/** Drop one owned boots entry so the planner sees a free slot (sell-boots model). */
function dropOwnedBoots(
  inventory: Array<{ itemID: number; count?: number }> | undefined
): Array<{ itemID: number; count?: number }> | null {
  if (!inventory) return null;
  for (let i = 0; i < inventory.length; i++) {
    const id = String(inventory[i].itemID);
    if (!isBootId(id) || TRINKET_ITEM_IDS.has(id)) continue;
    return inventory.filter((_, j) => j !== i);
  }
  return null;
}

function segmentFor(itemId: string, build: OrderedBuildShape | null | undefined): BuySegment {
  if (build && itemId === build.boots.id) return 'boots';
  if (build && isBootId(itemId)) return 'boots';
  if (build && build.core.some((c) => c.id === itemId)) return 'core';
  return 'situational';
}

/**
 * The full ordered buy path for a build with ranks, ownership and remaining
 * cost per step. No live champions change here — the same function backs the
 * HUD queue and the Build & runes view so both always show the same order.
 */
export function resolveBuildOrder(
  build: OrderedBuildShape | null | undefined,
  ownedIds: ReadonlySet<string> | null | undefined,
  prices?: PriceLookup | null
): OrderedBuyStep[] {
  const ids = ownedIds ?? new Set<string>();
  const owned = ownedMapFromSet(ids);
  const refs = resolveOrderedBuyPath(build, ids);
  const lookup = prices ?? undefined;
  return refs.map((item, index) => {
    const entry = lookup ? lookup(item.id) : undefined;
    return {
      rank: index + 1,
      id: item.id,
      name: item.name,
      segment: segmentFor(item.id, build),
      owned: ids.has(item.id),
      cost: entry && lookup ? remainingCost(entry, cloneOwned(owned), lookup) : null,
      reason: item.reason,
    };
  });
}

function bootsVsItemFor(
  queue: OrderedBuyStep[],
  target: OrderedBuyStep | null,
  build: OrderedBuildShape
): { rule: BootVsItemRule; reason: string } {
  if (!target) {
    return { rule: 'none', reason: 'Build complete — nothing left to buy.' };
  }
  const bootsName = build.boots.name;
  const bootsPending = queue.some((s) => s.segment === 'boots');
  if (target.segment === 'boots') {
    const step = target;
    if (step.id === BASE_BOOT_ID) {
      return {
        rule: 'boots-first',
        reason: `Boots first — base Boots (${formatGold(step.cost ?? 0)}) before ${bootsName}.`,
      };
    }
    const chain = bootChainIds(build.boots.id);
    const upgrade = chain.length > 2 && step.id === chain[2];
    return {
      rule: 'boots-first',
      reason: upgrade
        ? `Boots first — ${step.name} (${formatGold(step.cost ?? 0)}) — upgrade only when recommended.`
        : `Boots first — finish ${step.name} (${formatGold(step.cost ?? 0)}) — base Boots owned.`,
    };
  }
  if (bootsPending) {
    return {
      rule: 'item-first',
      reason: `${target.name} first — first core before boots.`,
    };
  }
  return {
    rule: 'item-first',
    reason: `Boots done — build ${target.name} (${formatGold(target.cost ?? 0)}) next.`,
  };
}

/**
 * One BUY NEXT + a numbered queue for the whole build, resolved live:
 * first core → base Boots if absent → recommended mid-tier boots → remaining
 * core → situational. A higher boot tier is pursued only when its ID is the
 * build's own recommendation; an upgrade that consumes owned boots uses their
 * slot; the base-boots step is never offered twice; freeSlot models a
 * sell-boots cue so the decision agrees with it.
 */
export function planBuyOrder(args: {
  build: OrderedBuildShape | null | undefined;
  inventory: Array<{ itemID: number; count?: number }> | undefined;
  currentGold: number | null;
  prices: PriceLookup | null;
  freeSlot?: boolean;
}): BuyOrderPlan | null {
  const { build, inventory, currentGold, prices } = args;
  if (!build) return null;

  const owned = buildOwned(inventory);
  const ownedIds = new Set(owned.keys());
  const full = resolveBuildOrder(build, ownedIds, prices);
  const queue = full.filter((s) => !s.owned).map((s, i) => ({ ...s, rank: i + 1 }));

  const bootsVsItem = bootsVsItemFor(queue, queue[0] ?? null, build);
  if (!queue.length) {
    return {
      steps: queue,
      decision: { action: 'complete', targetId: null, targetName: null, buy: null, needGold: null },
      bootsVsItem,
      afterSell: false,
    };
  }

  const target = queue[0];
  const targetRef: BuildItemRef = { id: target.id, name: target.name, reason: target.reason };

  if (prices === null) {
    return {
      steps: queue,
      decision: { action: 'unknown', targetId: target.id, targetName: target.name, buy: null, needGold: null },
      bootsVsItem,
      afterSell: false,
    };
  }

  let plan = planNextPurchase({ target: targetRef, inventory, currentGold, prices });
  let afterSell = false;
  // A sell-boots cue frees one slot: re-plan so the rail shows the actionable
  // purchase instead of a contradictory "no free slot".
  if (args.freeSlot && plan?.action === 'no-slot') {
    const slim = dropOwnedBoots(inventory);
    if (slim) {
      afterSell = true;
      plan = planNextPurchase({ target: targetRef, inventory: slim, currentGold, prices });
    }
  }

  if (!plan) {
    return {
      steps: queue,
      decision: { action: 'unknown', targetId: target.id, targetName: target.name, buy: null, needGold: null },
      bootsVsItem,
      afterSell,
    };
  }

  let decision: BuyOrderDecision = {
    action: plan.action,
    targetId: target.id,
    targetName: target.name,
    buy: plan.buy ? { ...plan.buy } : null,
    needGold: plan.needGold,
  };
  // Never re-offer the base-boots step as a component of a different target:
  // the queue already owns it before a mid/upgrade step becomes action-able.
  if (decision.buy && decision.buy.id === BASE_BOOT_ID && target.id !== BASE_BOOT_ID) {
    decision = { ...decision, action: 'save', buy: null };
  }

  return { steps: queue, decision, bootsVsItem, afterSell };
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
