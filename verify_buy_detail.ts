/**
 * HUD buy rail detail: the rail must say WHICH item to buy and for how much,
 * using the same planning inputs/guards as buyRailLine (which stays frozen).
 */
import items from './website/public/api/v1/items.json';
import { trackBuildProgress } from './src/logic/buildProgress';
import { catalogPriceLookup } from './src/logic/purchasePlan';
import {
  buyRailDetail,
  buyRailLine,
  type OverlayState,
} from './src/overlay/overlayLogic';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

const catalog = items as Array<{ id: string; name: string; gold: number; from: string[] }>;
const byId = new Map(catalog.map((i) => [i.id, i]));
const price = (id: string) => byId.get(id)!.gold;
const prices = catalogPriceLookup(catalog);

const build = {
  core: [{ id: '3179', name: 'Umbral Glaive' }],
  boots: { id: '3158', name: 'Ionian Boots of Lucidity' },
  situational: [],
};
const HAMMER = '3133';
const DIRK = '3134';
const FULL = '3179';

function state(itemIds: string[], gold: number | null | undefined) {
  const inv = itemIds.map((id, slot) => ({ itemID: Number(id), displayName: '', count: 1, slot }));
  return {
    inGame: true,
    localPlayer: { championName: 'Pyke', level: 5, isDead: false, items: inv, currentGold: gold as number },
  } as OverlayState;
}

function detail(itemIds: string[], gold: number | null | undefined, withPrices = true) {
  const s = state(itemIds, gold);
  return buyRailDetail(s, trackBuildProgress(s.localPlayer?.items, build), withPrices ? prices : null);
}

function line(itemIds: string[], gold: number | null | undefined, withPrices = true) {
  const s = state(itemIds, gold);
  return buyRailLine(s, trackBuildProgress(s.localPlayer?.items, build), withPrices ? prices : null);
}

// ---- buy-full -------------------------------------------------------------
{
  const d = detail([], price(FULL))!;
  ok(!!d, 'buy-full: detail present');
  ok(d.name === byId.get(FULL)!.name, `buy-full: name is the target (${d.name})`);
  ok(d.itemId === FULL, 'buy-full: itemId is the target');
  ok(d.cost === price(FULL), `buy-full: cost is full price (${d.cost})`);
  ok(d.goldShort === 0, 'buy-full: no gold short');
  ok(d.kind === 'buy-full', 'buy-full: kind');
  ok(d.partOf === null, 'buy-full: partOf null');
  ok(Number.isInteger(d.cost), 'buy-full: cost integer');
}
// ---- buy-component --------------------------------------------------------
{
  const d = detail([], price(HAMMER))!;
  ok(!!d, 'buy-component: detail present');
  ok(d.name === byId.get(HAMMER)!.name, `buy-component: name is the component (${d.name})`);
  ok(d.itemId === HAMMER, 'buy-component: itemId is the component');
  ok(d.cost === price(HAMMER), `buy-component: cost is the component price (${d.cost})`);
  ok(d.goldShort === 0, 'buy-component: no gold short');
  ok(d.kind === 'buy-component', 'buy-component: kind');
  ok(d.partOf === byId.get(FULL)!.name, `buy-component: partOf is the target (${d.partOf})`);
  ok(Number.isInteger(d.cost), 'buy-component: cost integer');
}
// ---- save ------------------------------------------------------------------
{
  const d = detail([DIRK], 100)!;
  const remaining = price(FULL) - price(DIRK);
  ok(!!d, 'save: detail present');
  ok(d.name === byId.get(FULL)!.name, `save: name is the target being saved toward (${d.name})`);
  ok(d.itemId === FULL, 'save: itemId is the target');
  ok(d.cost === remaining, `save: cost is the target remaining cost (${d.cost})`);
  ok(d.goldShort === remaining - 100, `save: goldShort is what is missing (${d.goldShort})`);
  ok(d.kind === 'save', 'save: kind');
  ok(d.partOf === null, 'save: partOf null');
  ok(Number.isInteger(d.cost), 'save: cost integer');
}
// ---- goldShort uses current gold even when affordable ---------------------
{
  const d = detail([], price(HAMMER) + 500)!;
  ok(d?.goldShort === 0, 'affordable: goldShort clamps to 0');
}
// ---- null wherever buyRailLine is null / no-slot ---------------------------
const NULL_CASES: Array<{ label: string; ids: string[]; gold: number | null | undefined; withPrices: boolean }> = [
  { label: 'no catalog', ids: [], gold: 3000, withPrices: false },
  { label: 'unknown gold (undefined)', ids: [], gold: undefined, withPrices: true },
  { label: 'unknown gold (null)', ids: [], gold: null, withPrices: true },
  { label: 'NaN gold', ids: [], gold: Number.NaN, withPrices: true },
  { label: 'build complete', ids: [FULL, '3158'], gold: 3000, withPrices: true },
];
for (const c of NULL_CASES) {
  ok(line(c.ids, c.gold, c.withPrices) === null, `${c.label}: buyRailLine is null (frozen contract)`);
  ok(detail(c.ids, c.gold, c.withPrices) === null, `${c.label}: buyRailDetail is null`);
}
// no-slot specifically is a non-null line but no purchasable detail.
{
  const s = state(['3865', '2055', '3071', '3044', '1037', '1028'], 5000);
  const l = buyRailLine(s, trackBuildProgress(s.localPlayer?.items, build), prices);
  ok(l?.action === 'no-slot', 'no-slot: rail line still reports no-slot');
  ok(buyRailDetail(s, trackBuildProgress(s.localPlayer?.items, build), prices) === null, 'no-slot: no detail');
}
// ---- fractional live gold: integer cost, no fractional shortfall ----------
{
  const d = detail([], 566.546)!;
  ok(Number.isInteger(d.cost), 'fractional gold: cost integer');
  ok(d.goldShort !== null && Number.isInteger(d.goldShort), 'fractional gold: goldShort integer');
  ok(d.goldShort === Math.max(0, d.cost - 566), 'fractional gold: floors live gold');
}
