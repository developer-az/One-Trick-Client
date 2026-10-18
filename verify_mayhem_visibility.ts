import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

ok(!isMayhemAugmentHudVisible([], false), 'no offers while playing');
ok(!isMayhemAugmentHudVisible(['twin_fire'], false), 'one offer alone does not open HUD');
ok(isMayhemAugmentHudVisible(['twin_fire', 'recursion'], false), 'two offers = augment shop');
ok(isMayhemAugmentHudVisible(['twin_fire'], true), 'manual scan can show one offer');

if (!process.exitCode) console.log('verify:mayhem-visibility ok');
