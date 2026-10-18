import {
  countFilledItemSlots,
  supportBootSlotAdvice,
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
  { itemID: 3135 },
  { itemID: 3364 },
];

ok(countFilledItemSlots(fullInv) === 6, 'six slots ex trinket');

const progress = trackBuildProgress(fullInv, build);
const lateSell = supportBootSlotAdvice(fullInv, progress, 20 * 60, { behind: false });
ok(lateSell?.action === 'sell', 'late full inv suggests sell boots');

const behindKeep = supportBootSlotAdvice(fullInv, progress, 20 * 60, { behind: true });
ok(behindKeep?.action === 'keep', 'behind keeps boots');

if (!process.exitCode) console.log('verify:build-boot-slot ok');
