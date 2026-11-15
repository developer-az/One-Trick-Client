/**
 * I1 acceptance: price- and gold-aware next buy.
 * Prices come from the shipped Data Dragon snapshot (website/public/api/v1/items.json);
 * expected values are derived from that catalog, never typed in.
 */
import { readFileSync } from 'node:fs';
import items from './website/public/api/v1/items.json';
import { catalogPriceLookup, planNextPurchase } from './src/logic/purchasePlan';

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
const fmt = (n: number) => n.toLocaleString('en-US');
const prices = catalogPriceLookup(catalog);

const UMBRAL = { id: '3179', name: 'Umbral Glaive' };
const DIRK = '3134';
const HAMMER = '3133';
const LONG_SWORD = '1036';
const IONIAN = { id: '3158', name: 'Ionian Boots of Lucidity' };
const BOOTS = '1001';
const MOTE = '2022';
const inv = (...ids: string[]) => ids.map((id) => ({ itemID: Number(id) }));
// Six non-trinket items, none of them in the Umbral or Ionian recipe trees, plus a trinket.
const FILLER = ['3865', '2055', '3071', '3044', '1037', '1028'];

// Recipe sanity: the tests assume this Data Dragon shape.
ok(JSON.stringify(byId.get(UMBRAL.id)!.from) === JSON.stringify([DIRK, HAMMER]), 'catalog: Umbral = Dirk + Warhammer');

// 1) Cannot afford anything yet.
{
  const gold = price(MOTE) - 50;
  const p = planNextPurchase({ target: UMBRAL, inventory: [], currentGold: gold, prices })!;
  ok(p.totalCost === price(UMBRAL.id), 'cannot-afford: totalCost from catalog');
  ok(p.remainingCost === price(UMBRAL.id), 'cannot-afford: remaining = total with nothing owned');
  ok(p.action === 'save' && p.buy === null, 'cannot-afford: action save');
  ok(p.needGold === price(UMBRAL.id) - gold, 'cannot-afford: needGold = remaining - gold');
  ok(p.cue.includes(fmt(price(UMBRAL.id) - gold)) && p.cue.includes(UMBRAL.name), 'cannot-afford: cue names gold needed and target');
}

// 2) Can afford a component but not the full item: most expensive affordable component on the from-path.
{
  const gold = price(HAMMER) + 10;
  const p = planNextPurchase({ target: UMBRAL, inventory: [], currentGold: gold, prices })!;
  ok(p.action === 'buy-component', 'component: action buy-component');
  ok(p.buy?.id === HAMMER && p.buy.cost === price(HAMMER), 'component: picks Warhammer (priciest affordable)');
  ok(p.needGold === price(UMBRAL.id) - gold, 'component: needGold for the full item');
  ok(p.cue.includes(byId.get(HAMMER)!.name) && p.cue.includes(UMBRAL.name), 'component: cue names component and target');
}

// 3) Owned components lower the remaining cost.
{
  const p = planNextPurchase({ target: UMBRAL, inventory: inv(DIRK), currentGold: 0, prices })!;
  ok(p.remainingCost === price(UMBRAL.id) - price(DIRK), 'owned: remaining = total - Dirk');
  const swords = planNextPurchase({ target: UMBRAL, inventory: inv(LONG_SWORD, LONG_SWORD), currentGold: 0, prices })!;
  ok(swords.remainingCost === price(UMBRAL.id) - 2 * price(LONG_SWORD), 'owned: two Long Swords both count (multiset)');
  const one = planNextPurchase({ target: UMBRAL, inventory: inv(LONG_SWORD), currentGold: 0, prices })!;
  ok(one.remainingCost === price(UMBRAL.id) - price(LONG_SWORD), 'owned: one Long Sword counts once');
  const g = price(UMBRAL.id) - price(DIRK);
  const afford = planNextPurchase({ target: UMBRAL, inventory: inv(DIRK), currentGold: g, prices })!;
  ok(afford.action === 'buy-full' && afford.buy?.id === UMBRAL.id && afford.buy.cost === g, 'owned: exact remaining gold buys the full item');
  const partial = planNextPurchase({ target: UMBRAL, inventory: inv(LONG_SWORD, LONG_SWORD), currentGold: 1100, prices })!;
  ok(partial.action === 'buy-component' && !!partial.buy && partial.buy.cost <= 1100, 'owned: component cost within gold');
}

// 3b) Never suggest a component of something already owned.
{
  const p = planNextPurchase({ target: UMBRAL, inventory: inv(DIRK), currentGold: price(LONG_SWORD) + 10, prices })!;
  ok(p.action === 'buy-component' && p.buy?.id === LONG_SWORD, 'owned-subtree: Long Sword only via the Warhammer path');
  const q = planNextPurchase({ target: UMBRAL, inventory: inv(DIRK, HAMMER), currentGold: price(LONG_SWORD) + 10, prices })!;
  ok(q.action === 'save' && q.buy === null, 'owned-subtree: both halves owned -> save for the combine, no Long Sword');
}

// 4) Can afford the full item.
{
  const p = planNextPurchase({ target: UMBRAL, inventory: [], currentGold: price(UMBRAL.id), prices })!;
  ok(p.action === 'buy-full' && p.buy?.id === UMBRAL.id && p.needGold === 0, 'full: buy-full, needGold 0');
  ok(p.cue.includes(UMBRAL.name) && p.cue.includes(fmt(price(UMBRAL.id))), 'full: cue names item and cost');
}

// 5) Full inventory.
{
  const full = [...inv(...FILLER), { itemID: 3364 }];
  const p = planNextPurchase({ target: UMBRAL, inventory: full, currentGold: 5000, prices })!;
  ok(p.action === 'no-slot' && p.buy === null, 'full-inv: no free slot and nothing consumed -> no-slot');
  ok(/slot/i.test(p.cue), 'full-inv: cue mentions the slot');
  const withDirk = [...inv(...FILLER.slice(0, 5), DIRK), { itemID: 3364 }];
  const upgrade = planNextPurchase({ target: UMBRAL, inventory: withDirk, currentGold: price(UMBRAL.id) - price(DIRK), prices })!;
  ok(upgrade.action === 'buy-full', 'full-inv: completing from an owned component is allowed');
  const comp = planNextPurchase({ target: UMBRAL, inventory: withDirk, currentGold: price(HAMMER), prices })!;
  ok(comp.action === 'no-slot', 'full-inv: a component that consumes nothing has no slot');
}

// 6) Boots-slot interplay.
{
  const p = planNextPurchase({ target: IONIAN, inventory: inv(BOOTS), currentGold: price(IONIAN.id) - price(BOOTS), prices })!;
  ok(p.remainingCost === price(IONIAN.id) - price(BOOTS) && p.action === 'buy-full', 'boots: upgrade from owned Boots');
  const mote = planNextPurchase({ target: IONIAN, inventory: inv(BOOTS), currentGold: price(MOTE), prices })!;
  ok(mote.action === 'buy-component' && mote.buy?.id === MOTE, 'boots: buys the missing component');
  const full = [...inv(...FILLER.slice(0, 5), BOOTS), { itemID: 3364 }];
  const up = planNextPurchase({ target: IONIAN, inventory: full, currentGold: price(IONIAN.id) - price(BOOTS), prices })!;
  ok(up.action === 'buy-full', 'boots: full inventory can still upgrade owned Boots');
}

// 7) Unknown gold / unknown price / no target.
{
  const p = planNextPurchase({ target: UMBRAL, inventory: [], currentGold: null, prices })!;
  ok(p.action === 'unknown' && p.totalCost === price(UMBRAL.id), 'null gold: unknown, cost still reported');
  const q = planNextPurchase({ target: { id: '999999', name: 'Nope' }, inventory: [], currentGold: 5000, prices })!;
  ok(q.action === 'unknown' && q.totalCost === null && q.remainingCost === null, 'unknown item: no invented price');
  ok(planNextPurchase({ target: null, inventory: [], currentGold: 5000, prices }) === null, 'no target: null');
}

// 8) No hard-coded prices in the module.
{
  const src = readFileSync('src/logic/purchasePlan.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok(!/\b[1-9]\d{2,}\b/.test(src), 'no numeric literals >= 100 in purchasePlan.ts');
}
