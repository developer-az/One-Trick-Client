import {
  countFilledItemSlots,
  inventoryPressureSlots,
  supportBootSlotAdvice,
  supportBuildMaturity,
  trackBuildProgress,
} from './src/logic/buildProgress';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

const build = {
  core: [
    { id: '3179', name: 'Umbral Glaive' },
    { id: '3877', name: 'Bloodsong' },
  ],
  boots: { id: '3158', name: 'Ionian Boots of Lucidity' },
  situational: [{ id: '3107', name: 'Redemption' }],
};

const fullInv = [
  { itemID: 3865 },
  { itemID: 3179 },
  { itemID: 3158 },
  { itemID: 3877 },
  { itemID: 2055 },
  { itemID: 3134 },
  { itemID: 3364 },
];

ok(countFilledItemSlots(fullInv) === 6, 'six slots ex trinket');
ok(inventoryPressureSlots(fullInv) >= 5, 'pressure counts finished items not pink');

const progress = trackBuildProgress(fullInv, build);
const maturity = supportBuildMaturity(progress, build);
ok(maturity.nearComplete, 'near-complete legendary path');

const lateSell = supportBootSlotAdvice(fullInv, progress, 20 * 60, { behind: false, build });
ok(lateSell?.action === 'sell', 'late full inv suggests sell boots');

const componentSoup = [
  { itemID: 3865 },
  { itemID: 3158 },
  { itemID: 1036 },
  { itemID: 1037 },
  { itemID: 1028 },
  { itemID: 1033 },
  { itemID: 3364 },
];
ok(countFilledItemSlots(componentSoup) === 6, 'component soup fills slots');
ok(inventoryPressureSlots(componentSoup) < 5, 'components do not inflate pressure');
const soupProgress = trackBuildProgress(componentSoup, build);
const soupSell = supportBootSlotAdvice(componentSoup, soupProgress, 20 * 60, { behind: false, build });
ok(soupSell?.action !== 'sell', 'component soup must not sell boots');

const behindKeep = supportBootSlotAdvice(fullInv, progress, 20 * 60, { behind: true, build });
ok(behindKeep?.action === 'keep', 'behind keeps boots');

if (!process.exitCode) console.log('verify:build-boot-slot ok');