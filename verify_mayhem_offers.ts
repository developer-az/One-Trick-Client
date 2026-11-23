import {
  stabilizeMayhemOffers,
  isNewMayhemOfferRoll,
  type MayhemOfferStabilityState,
} from './src/logic/mayhem/offerStability';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const roll = ['a', 'b', 'c'];

// A reroll replaces every card and the Reroll button is outside the OCR crop,
// so the offer set itself is the signal: a disjoint 1-2 card read is the new roll.
const disjointState: MayhemOfferStabilityState = { rerollPending: false };
const disjointPartial = stabilizeMayhemOffers(roll, ['x', 'y'], 'still choosing', true, disjointState);
ok(disjointPartial.join(',') === 'x,y', 'disjoint 2-card read is accepted as the new roll');
ok(disjointState.rerollPending, 'partial new roll arms the fast poll until the triple lands');

const disjointOneState: MayhemOfferStabilityState = { rerollPending: false };
const disjointOne = stabilizeMayhemOffers(roll, ['z'], 'still choosing', true, disjointOneState);
ok(disjointOne.join(',') === 'z', 'disjoint 1-card read is accepted as the new roll');
ok(disjointOneState.rerollPending, '1-card new roll keeps pending armed');

ok(
  isNewMayhemOfferRoll(roll, ['x', 'y']) && !isNewMayhemOfferRoll(roll, ['b', 'c']),
  'disjoint ids are a new roll, overlapping ids are not'
);

// A partial read of the SAME roll always shares an id: it must not shrink the triple.
const overlapState: MayhemOfferStabilityState = { rerollPending: false };
const overlap = stabilizeMayhemOffers(roll, ['b', 'c'], 'still choosing', true, overlapState);
ok(overlap.join(',') === 'a,b,c', 'overlapping 2-card read retains the previous triple');
ok(!overlapState.rerollPending, 'overlapping same-roll read does not arm pending');

const overlapTwoState: MayhemOfferStabilityState = { rerollPending: false };
const overlapTwo = stabilizeMayhemOffers(roll, ['a', 'b'], 'still choosing', true, overlapTwoState);
ok(overlapTwo.join(',') === 'a,b,c', 'overlapping 2-card read keeps all three ids');

// The legacy OCR text signal still arms pending; an overlapping animation read
// keeps the prior triple instead of dropping to the partial read.
const rerollAnimState: MayhemOfferStabilityState = { rerollPending: false };
const rerollAnim = stabilizeMayhemOffers(roll, ['b', 'c'], 'Reroll 2 left', true, rerollAnimState);
ok(rerollAnimState.rerollPending, 'reroll text arms pending');
ok(rerollAnim.join(',') === 'a,b,c', 'reroll animation keeps prior triple on overlapping read');

const fullState: MayhemOfferStabilityState = { rerollPending: true };
const newRoll = stabilizeMayhemOffers(roll, ['n1', 'n2', 'n3'], 'Reroll', true, fullState);
ok(!fullState.rerollPending, 'full triple clears reroll pending');
ok(newRoll.join(',') === 'n1,n2,n3', 'accepts new triple after reroll');

if (!process.exitCode) console.log('verify:mayhem-offers ok');
