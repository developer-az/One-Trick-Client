import bundle from './src/data/mayhem/bundle.json';
import { rankMayhemChoices, suggestMayhemAugments } from './src/logic/mayhem/rank';
import type { MayhemBundle } from './src/logic/mayhem/types';
import type { Champion } from './src/logic/pykeLogic';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const data = bundle as MayhemBundle;
ok(data.augments.length > 100, `bundle augments (${data.augments.length})`);
ok(data.combos.length > 100, `bundle combos (${data.combos.length})`);

const pyke: Champion = {
  id: 'Pyke',
  key: '555',
  name: 'Pyke',
  tags: ['Support', 'Assassin'],
  damageType: 'Physical',
};

const kayn: Champion = {
  id: 'Kayn',
  key: '141',
  name: 'Kayn',
  tags: ['Assassin', 'Fighter'],
  damageType: 'Physical',
};

const dashing = data.augments.find((a) => a.id === 'dashing');
ok(!!dashing, 'dashing augment in bundle');

const ranked = rankMayhemChoices(kayn, [], dashing ? [dashing.id, 'giant_slayer'] : [], data);
ok(ranked.length >= 1, 'ranks candidates');
if (dashing && ranked.length >= 2) {
  ok(ranked[0].augmentId === dashing.id, 'kayn dashing ranks #1 on roll');
  ok(ranked[0].verdict === 'pick', 'top roll gets PICK verdict');
  ok(ranked[1].verdict === 'skip' || ranked[1].verdict === 'alt', 'lower roll not pick');
}

const suggest = suggestMayhemAugments(pyke, [], data, 5);
ok(suggest.length === 5, 'suggest list');

const samira: Champion = {
  id: 'Samira',
  key: '360',
  name: 'Samira',
  tags: ['Marksman', 'Assassin'],
  damageType: 'Physical',
};
const samiraRoll = rankMayhemChoices(
  samira,
  [],
  ['vulnerability', 'draw_your_sword', 'giant_slayer'],
  data
);
const vuln = samiraRoll.find((r) => r.augmentId === 'vulnerability');
ok(!!vuln && vuln.verdict === 'skip', 'Samira: Vulnerability is SKIP not PICK/ALT');
ok(
  samiraRoll[0]?.augmentId === 'draw_your_sword',
  'Samira: god-tier augment beats trap vulnerability on roll'
);

const neeko: Champion = {
  id: 'Neeko',
  key: '518',
  name: 'Neeko',
  tags: ['Mage', 'Support'],
  damageType: 'Magic',
};
const neekoRoll = rankMayhemChoices(neeko, [], ['twin_fire', 'jeweled_gauntlet', 'giant_slayer'], data);
const twin = neekoRoll.find((r) => r.augmentId === 'twin_fire');
ok(!!twin && twin.verdict === 'skip', 'Neeko: Twin Fire is SKIP (AD augment on AP mage)');

if (!process.exitCode) console.log('verify:mayhem ok');
