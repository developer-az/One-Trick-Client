/**
 * I1b acceptance: the HUD buy rail says what to buy now (uses purchasePlan).
 * Prices come from the shipped Data Dragon snapshot; expected values are derived from it.
 */
import items from './website/public/api/v1/items.json';
import { trackBuildProgress } from './src/logic/buildProgress';
import { catalogPriceLookup } from './src/logic/purchasePlan';
import { buyRailLine, type OverlayState } from './src/overlay/overlayLogic';

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
const fmt = (n: number) => `${n.toLocaleString('en-US')}g`;
const prices = catalogPriceLookup(catalog);

const build = {
  core: [{ id: '3179', name: 'Umbral Glaive' }],
  boots: { id: '3158', name: 'Ionian Boots of Lucidity' },
  situational: [],
};
const HAMMER = '3133';
const DIRK = '3134';

function line(itemIds: string[], gold: number | undefined, withPrices = true) {
  const inv = itemIds.map((id, slot) => ({ itemID: Number(id), displayName: '', count: 1, slot }));
  const state = {
    inGame: true,
    localPlayer: { championName: 'Pyke', level: 5, isDead: false, items: inv, currentGold: gold as number },
  } as OverlayState;
  return buyRailLine(state, trackBuildProgress(inv, build), withPrices ? prices : null);
}

// Full item affordable.
{
  const l = line([], price('3179'))!;
  ok(l.action === 'buy-full' && l.buyId === '3179', 'buy-full: buys the target');
  ok(l.text.includes(fmt(price('3179'))), 'buy-full: text shows the cost');
}
// Component affordable.
{
  const l = line([], price(HAMMER))!;
  ok(l.action === 'buy-component' && l.buyId === HAMMER, 'component: buyId is the component');
  ok(l.text.includes(fmt(price(HAMMER))), 'component: text shows the component cost');
  ok(l.title.includes(byId.get(HAMMER)!.name) && l.title.includes('Umbral Glaive'), 'component: title names component and target');
}
// Saving.
{
  const l = line([DIRK], 100)!;
  const need = price('3179') - price(DIRK) - 100;
  ok(l.action === 'save' && l.buyId === null, 'save: nothing to buy');
  ok(l.text.includes(fmt(need)), 'save: text shows gold still needed after owned Dirk');
}
// Full inventory, nothing to combine.
{
  const l = line(['3865', '2055', '3071', '3044', '1037', '1028'], 5000)!;
  ok(l.action === 'no-slot' && /slot/i.test(l.text), 'no-slot: text mentions the slot');
}
// Short enough for the rail.
{
  for (const l of [line([], price('3179'))!, line([], price(HAMMER))!, line([DIRK], 100)!]) {
    ok(l.text.length <= 24, `text fits the rail (${l.text})`);
  }
}
// No price data, unknown gold, or nothing left to buy -> no line (HUD stays as today).
ok(line([], 3000, false) === null, 'no catalog: null');
ok(line([], undefined) === null, 'unknown gold: null');
ok(line(['3179', '3158'], 3000) === null, 'build complete: null');
