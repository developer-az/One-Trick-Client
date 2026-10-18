import bundle from './src/data/mayhem/bundle.json';
import { matchAugmentsFromOcr } from './src/logic/mayhem/match';
import type { MayhemBundle } from './src/logic/mayhem/types';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const data = bundle as MayhemBundle;
const text = `Pick an augment\nDashing\nGiant Slayer\nJeweled Gauntlet\nReroll`;
const ids = matchAugmentsFromOcr(text, data.augments);
ok(ids.includes('dashing'), 'matches dashing');
ok(ids.length >= 2, 'multiple augments');
ok(!ids.some((id) => id.startsWith('quest_')), 'ignores reroll/pick chrome');

const questUi = `Quest\nSilver\nGold\nRecursion\nShrink Engine\nBlunt Force`;
const questIds = matchAugmentsFromOcr(questUi, data.augments);
ok(questIds.includes('recursion'), 'real cards from quest shop UI');
ok(questIds.includes('shrink_engine'), 'second real card');
ok(!questIds.includes('quest_urfs_champion'), 'lone Quest label does not add Urf quest');

const mergedQuest = `Recursion Shrink Engine Blunt Force quest reroll silver`;
const mergedIds = matchAugmentsFromOcr(mergedQuest, data.augments);
ok(mergedIds.includes('recursion'), 'corpus fallback keeps real offers');
ok(mergedIds.length >= 3, 'corpus fills third augment when two lines matched');
ok(!mergedIds.includes('quest_steel_your_heart'), 'corpus does not invent quest augments');

const twoLine = `Twin Fire\nGiant Slayer\nJeweled Gauntlet`;
const twoIds = matchAugmentsFromOcr(twoLine, data.augments);
ok(twoIds.length === 3, `three cards from separate lines (${twoIds.join(',')})`);

if (!process.exitCode) console.log('verify:mayhem-match ok');
