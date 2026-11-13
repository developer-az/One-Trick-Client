/**
 * R2-D acceptance: ONE ordered build path.
 *
 * purchasePlan emits one `BUY NEXT` decision + a numbered queue for the whole
 * build (first core → base Boots if absent → recommended mid-tier boots →
 * remaining core → situational). The same order must be what the overlay queue
 * and the Build & runes view render. Boots-versus-item is resolved live with a
 * single rule + human-readable reason; an upgrade that consumes owned boots
 * uses their slot; `1001` is never offered twice; a sell-boots cue agrees with
 * the actionable purchase decision.
 *
 * Frozen suites (verify_purchase_plan / verify_buy_rail / verify_buy_detail /
 * verify_build_boot_slot / verify_overlay_cues) keep their contracts; this file
 * only adds the ordered-plan surface on top.
 */
import { readFileSync } from 'node:fs';
import items from './website/public/api/v1/items.json';
import {
  buyOrderPlanForState,
  type OverlayState,
} from './src/overlay/overlayLogic';
import {
  catalogPriceLookup,
  planBuyOrder,
  resolveBuildOrder,
  type OrderedBuyStep,
} from './src/logic/purchasePlan';
import { supportBootSlotAdvice, trackBuildProgress } from './src/logic/buildProgress';

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

// Pyke-shaped build: two cores, Ionian boots, two situational items.
const BUILD = {
  core: [
    { id: '3179', name: 'Umbral Glaive' },
    { id: '6699', name: 'Voltaic Cyclosword' },
  ],
  boots: { id: '3158', name: 'Ionian Boots of Lucidity' },
  situational: [
    { id: '3107', name: 'Redemption' },
    { id: '3142', name: "Youmuu's Ghostblade" },
  ],
};
const BASE_BOOTS = '1001';
const IONIAN = '3158';
const MID_BOOT_IDS = ['3009', '3158', '3111', '3047', '3006', '3020'];
const UPGRADE_BOOT_IDS = ['3170', '3171', '3172', '3173', '3174', '3168', '3175'];
const inv = (...ids: string[]) => ids.map((id, slot) => ({ itemID: Number(id), displayName: '', count: 1, slot }));
const FILLER = ['3865', '2055', '3071', '3044', '1037', '1028'];

const ids = (steps: OrderedBuyStep[]) => steps.map((s) => s.id);

// ---------------------------------------------------------------------------
// 1) Static surface that the HUD/app must expose.
// ---------------------------------------------------------------------------
{
  const app = readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
  const isNextCount = (app.match(/is-next/g) || []).length;
  ok(isNextCount === 1, `HUD renders the BUY NEXT highlight in exactly one place (found ${isNextCount})`);
  ok(app.includes('data-buy-step'), 'HUD queue icons carry a numbered step marker (data-buy-step)');
  const view = readFileSync('src/app/views/LoadoutView.tsx', 'utf8');
  ok(view.includes('data-build-step'), 'Build & runes view renders numbered steps (data-build-step)');
  const css = readFileSync('src/overlay/overlay-theme.css', 'utf8');
  ok(css.includes('.hud-buy-step') && css.includes('.hud-buy-next-tag'), 'overlay theme styles the BUY NEXT tag and numbered steps');
}

// ---------------------------------------------------------------------------
// 2) Fresh game: full resolved order, ranked, no duplicates.
// ---------------------------------------------------------------------------
{
  const steps = resolveBuildOrder(BUILD, null);
  ok(steps.length === 6, `resolveBuildOrder: all six steps (got ${steps.length})`);
  ok(ids(steps).join(',') === `3179,${BASE_BOOTS},${IONIAN},6699,3107,3142`, `order: core → base boots → mid boots → core → situational (${ids(steps).join(',')})`);
  ok(steps.every((s, i) => s.rank === i + 1), 'resolveBuildOrder: ranks run 1..N');
  ok(new Set(ids(steps)).size === steps.length, 'resolveBuildOrder: every id appears at most once');
  ok(steps.some((s) => s.id === BASE_BOOTS) && !steps.some((s) => UPGRADE_BOOT_IDS.includes(s.id)), 'mid recommendation: base boots present, no Noxian upgrade');
  ok(steps.find((s) => s.id === BASE_BOOTS)!.segment === 'boots', 'base boots classified as boots segment');
  ok(steps.every((s) => !s.owned), 'resolveBuildOrder without inventory: nothing owned');

  const plan = planBuyOrder({ build: BUILD, inventory: [], currentGold: price('3179') + 500, prices })!;
  ok(!!plan, 'planBuyOrder: plan exists fresh game');
  const q = ids(plan.steps);
  ok(plan.steps.every((s, i) => s.rank === i + 1 && s.rank > 0), 'plan queue: numbered 1..N');
  ok(plan.steps.filter((s) => s.id === BASE_BOOTS).length === 1, 'plan queue: exactly one base-boots entry');
  ok(q[0] === '3179' && q[1] === BASE_BOOTS, `plan queue: first core first, base boots second (${q.slice(0, 2).join(',')})`);
  ok(plan.decision.action === 'buy-full' && plan.decision.buy?.id === '3179', 'plan decision: BUY NEXT is the first core');
  ok(plan.bootsVsItem.rule === 'item-first', 'fresh game: rule item-first (core wins over boots)');
  ok(!!plan.bootsVsItem.reason && plan.bootsVsItem.reason.includes('Umbral') && /boot/i.test(plan.bootsVsItem.reason), 'fresh game: reason names the item and the boots decision');
}

// ---------------------------------------------------------------------------
// 3) First core owned → base Boots become BUY NEXT (base boots if absent).
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: inv('3179'), currentGold: price(BASE_BOOTS), prices })!;
  ok(ids(plan.steps)[0] === BASE_BOOTS, `base boots absent → they lead the queue (${ids(plan.steps)[0]})`);
  ok(plan.decision.buy?.id === BASE_BOOTS && plan.decision.action === 'buy-full', 'BUY NEXT: base Boots');
  ok(plan.bootsVsItem.rule === 'boots-first', 'boots first when base boots are the next step');
  ok(/Boots/.test(plan.bootsVsItem.reason) && /Ionian/.test(plan.bootsVsItem.reason), `boots-first reason readable: "${plan.bootsVsItem.reason}"`);
}

// ---------------------------------------------------------------------------
// 4) Base boots owned → never offered again; mid-tier is next.
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: inv('3179', BASE_BOOTS), currentGold: price(IONIAN) - price(BASE_BOOTS) + 50, prices })!;
  ok(!ids(plan.steps).includes(BASE_BOOTS), 'owned base boots: no duplicate 1001 in the queue');
  ok(ids(plan.steps)[0] === IONIAN, `owned base boots: Ionian leads (${ids(plan.steps)[0]})`);
  ok(plan.decision.buy?.id === IONIAN && plan.decision.action === 'buy-full', 'BUY NEXT: finish Ionian');
  ok(plan.bootsVsItem.rule === 'boots-first', 'still boots-first while finishing mid-tier');
  ok(plan.decision.buy && plan.decision.buy.cost === price(IONIAN) - price(BASE_BOOTS), `upgrade cost uses the owned base boots (${plan.decision.buy?.cost}g)`);
}

// ---------------------------------------------------------------------------
// 5) Mid-tier boots owned → boots segment gone, core2 next.
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: inv('3179', IONIAN), currentGold: price('6699'), prices })!;
  const bootSteps = plan.steps.filter((s) => [BASE_BOOTS, ...MID_BOOT_IDS, ...UPGRADE_BOOT_IDS].includes(s.id));
  ok(bootSteps.length === 0, 'owned mid boots: no boot steps left');
  ok(plan.steps[0]?.id === '6699', `removed core next (${plan.steps[0]?.id})`);
  ok(plan.bootsVsItem.rule === 'item-first', 'boots done → item-first');
  ok(/Boots done/i.test(plan.bootsVsItem.reason), `reason says boots done: "${plan.bootsVsItem.reason}"`);
}

// ---------------------------------------------------------------------------
// 6) Completed build → explicit complete, no BUY NEXT.
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: inv('3179', IONIAN, '6699', '3107', '3142'), currentGold: 5000, prices })!;
  ok(plan.steps.length === 0, 'complete: queue empty');
  ok(plan.decision.action === 'complete' && plan.decision.buy === null, 'complete: explicit decision, no buy');
  ok(plan.bootsVsItem.rule === 'none', 'complete: no boots-vs-item rule');
}

// ---------------------------------------------------------------------------
// 7) Upgrade boots only when the ID is explicitly recommended.
// ---------------------------------------------------------------------------
{
  // Mid-tier recommendation must never emit an upgrade step.
  const mid = planBuyOrder({ build: BUILD, inventory: inv('3179', BASE_BOOTS), currentGold: 5000, prices })!;
  ok(!ids(mid.steps).some((id) => UPGRADE_BOOT_IDS.includes(id)), 'mid recommendation: no Noxian upgrades in the queue');

  // Explicit upgrade recommendation (Yone: Gunmetal Greaves) → chain incl. upgrade.
  const yoneBoots = { id: '3172', name: 'Gunmetal Greaves' };
  const yoneBase = planBuyOrder({ build: { core: BUILD.core, boots: yoneBoots, situational: BUILD.situational }, inventory: inv('3179', BASE_BOOTS, '3006'), currentGold: price('3172'), prices })!;
  ok(ids(yoneBase.steps)[0] === '3172', `explicit upgrade recommended → upgrade step next (${ids(yoneBase.steps)[0]})`);
  ok(yoneBase.decision.buy?.id === '3172', 'BUY NEXT: the explicitly recommended upgrade');
  const yoneFresh = resolveBuildOrder({ core: BUILD.core, boots: yoneBoots, situational: [] }, null);
  ok(ids(yoneFresh).includes(BASE_BOOTS) && ids(yoneFresh).includes('3006') && ids(yoneFresh).includes('3172'), 'upgrade chain: base → mid → upgrade all present when nothing owned');
  const baseIdx = ids(yoneFresh).indexOf(BASE_BOOTS);
  const midIdx = ids(yoneFresh).indexOf('3006');
  const upIdx = ids(yoneFresh).indexOf('3172');
  ok(baseIdx !== -1 && midIdx !== -1 && upIdx !== -1 && baseIdx < midIdx && midIdx < upIdx, 'upgrade chain kept in base → mid → upgrade order');
}

// ---------------------------------------------------------------------------
// 8) Full inventory: upgrades that consume owned boots use their slot.
// ---------------------------------------------------------------------------
{
  // Six filled slots including the owned base Boots and the first core, so the
  // queue head is the Ionian upgrade — an upgrade that consumes owned boots.
  const sixFull = [...inv('3179', '2055', '3071', '3044', '1036', BASE_BOOTS), { itemID: 3364, displayName: 'Lens', count: 1, slot: 6 }];
  const plan = planBuyOrder({ build: BUILD, inventory: sixFull, currentGold: price(IONIAN) - price(BASE_BOOTS) + 100, prices })!;
  ok(plan.decision.action !== 'no-slot', `full inv + owned base boots: upgrade is actionable, not no-slot (${plan.decision.action})`);
  ok(plan.decision.buy?.id === IONIAN, 'full inv + owned base boots: BUY NEXT is the mid-tier upgrade');
}

// ---------------------------------------------------------------------------
// 9) Full inventory, nothing to consume → explicit no-slot.
// ---------------------------------------------------------------------------
{
  const full = [...inv(...FILLER), { itemID: 3364, displayName: 'Lens', count: 1, slot: 6 }];
  const plan = planBuyOrder({ build: BUILD, inventory: full, currentGold: 5000, prices })!;
  ok(plan.decision.action === 'no-slot' && plan.decision.buy === null, 'full inv, nothing owned on the path: explicit no-slot');
}

// ---------------------------------------------------------------------------
// 10) Save state stays explicit with the gold still needed.
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: [], currentGold: 100, prices })!;
  ok(plan.decision.action === 'save' && plan.decision.buy === null, 'low gold: explicit save');
  ok(plan.decision.needGold === price('3179') - 100, `save: needGold is the remaining difference (${plan.decision.needGold})`);
}

// ---------------------------------------------------------------------------
// 11) Affordable components surface as the one BUY NEXT.
// ---------------------------------------------------------------------------
{
  const plan = planBuyOrder({ build: BUILD, inventory: [], currentGold: price('3133') + 20, prices })!;
  ok(plan.decision.action === 'buy-component' && plan.decision.buy?.id === '3133', 'BUY NEXT: Warhammer when only a component is affordable');
  ok(plan.decision.targetId === '3179', 'BUY NEXT target remains Umbral Glaive');
}

// ---------------------------------------------------------------------------
// 12) Sell-boots cue agrees with the actionable purchase decision.
// ---------------------------------------------------------------------------
{
  const sellInventory = [
    { itemID: 3865, displayName: 'World Atlas', count: 1, slot: 0 },
    { itemID: 3179, displayName: 'Umbral Glaive', count: 1, slot: 1 },
    { itemID: 3158, displayName: 'Ionian Boots of Lucidity', count: 1, slot: 2 },
    { itemID: 3877, displayName: 'Bloodsong', count: 1, slot: 3 },
    { itemID: 2055, displayName: 'Control Ward', count: 1, slot: 4 },
    { itemID: 3135, displayName: 'Mortal Reminder', count: 1, slot: 5 },
    { itemID: 3364, displayName: 'Oracle Lens', count: 1, slot: 6 },
  ];
  const progress = trackBuildProgress(sellInventory, BUILD);
  const advice = supportBootSlotAdvice(sellInventory, progress, 20 * 60, { behind: false });
  ok(advice?.action === 'sell', 'fixture: full inv + finished boots + late game says sell boots');

  const state: OverlayState = {
    inGame: true,
    gameTime: 20 * 60,
    localPlayer: {
      championName: 'Pyke',
      level: 14,
      isDead: false,
      items: sellInventory as OverlayState['localPlayer'] extends infer L ? (L extends { items: infer I } ? I : never) : never,
      currentGold: 3200,
      scores: { kills: 5, deaths: 3, assists: 6, creepScore: 100, wardScore: 20 },
    },
    enemies: [],
  };
  const order = buyOrderPlanForState(state, BUILD, prices)!;
  ok(!!order, 'buy order plan exists when the sell cue exists');
  ok(order.afterSell === true, 'sell cue ⇒ plan frees a slot (agreement)');
  ok(['buy-full', 'buy-component', 'save'].includes(order.decision.action), `sell cue ⇒ actionable buy decision, never no-slot (${order.decision.action})`);
  ok(order.decision.buy !== null, 'sell cue ⇒ a concrete item is BUY NEXT');

  // Behind → keep boots: the plan must NOT assume a freed slot.
  const behindState: OverlayState = {
    ...state,
    localPlayer: { ...state.localPlayer!, level: 1, scores: { kills: 0, deaths: 5, assists: 1, creepScore: 20, wardScore: 0 } },
    enemies: [
      { championName: 'Jinx', level: 6, position: 'BOTTOM' },
      { championName: 'Nautilus', level: 5, position: 'UTILITY' },
    ],
  };
  const keepAdvice = supportBootSlotAdvice(behindState.localPlayer!.items, progress, behindState.gameTime ?? 0, { behind: true });
  ok(keepAdvice?.action === 'keep', 'behind fixture: keep boots');
  const keepOrder = buyOrderPlanForState(behindState, BUILD, prices)!;
  ok(keepOrder.afterSell === false, 'keep cue ⇒ no freed slot');
}

// ---------------------------------------------------------------------------
// 13) Rule set is closed and reasons stay human-readable.
// ---------------------------------------------------------------------------
{
  for (const [label, plan] of [
    ['fresh', planBuyOrder({ build: BUILD, inventory: [], currentGold: 100, prices })!],
    ['boots', planBuyOrder({ build: BUILD, inventory: inv('3179'), currentGold: 500, prices })!],
    ['done', planBuyOrder({ build: BUILD, inventory: inv('3179', IONIAN), currentGold: 5000, prices })!],
  ] as Array<[string, NonNullable<ReturnType<typeof planBuyOrder>>]>) {
    ok(['boots-first', 'item-first', 'none'].includes(plan.bootsVsItem.rule), `${label}: rule is one of the closed set (${plan.bootsVsItem.rule})`);
    ok(typeof plan.bootsVsItem.reason === 'string' && plan.bootsVsItem.reason.trim().length > 4 && plan.bootsVsItem.reason.length < 160, `${label}: reason is human-readable ("${plan.bootsVsItem.reason}")`);
  }
}

if (!process.exitCode) console.log('verify:purchase-order ok');
