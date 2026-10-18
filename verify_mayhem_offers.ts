import { stabilizeMayhemOffers, type MayhemOfferStabilityState } from './src/logic/mayhem/offerStability';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const state: MayhemOfferStabilityState = { rerollPending: false };

const roll = ['a', 'b', 'c'];
const partial = stabilizeMayhemOffers(roll, ['x', 'y'], 'still choosing', true, state);
ok(partial.length === 3 && partial[0] === 'a', 'partial OCR does not drop third offer');

state.rerollPending = false;
const reroll = stabilizeMayhemOffers(roll, ['x', 'y'], 'Reroll 2 left', true, state);
ok(state.rerollPending, 'reroll text arms pending');
ok(reroll.length === 3 && reroll[0] === 'a', 'reroll animation keeps prior triple');

const newRoll = stabilizeMayhemOffers(roll, ['n1', 'n2', 'n3'], 'Reroll', true, state);
ok(!state.rerollPending, 'full triple clears reroll pending');
ok(newRoll.join(',') === 'n1,n2,n3', 'accepts new triple after reroll');

if (!process.exitCode) console.log('verify:mayhem-offers ok');
