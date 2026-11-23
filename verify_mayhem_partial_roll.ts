/**
 * A full card row with one title the bundle does not know (patch-day card or
 * one misread) is still a roll. Real-match case: Flashy (not in the 26.22
 * bundle) + Upgrade Sheen + Weapon of Destiny stayed "Could not verify" all
 * match because every card had to match.
 */
import bundle from './src/data/mayhem/bundle.json';
import {
  classifyMayhemFrame,
  createMayhemPipelineState,
  type MayhemFrameLine,
} from './src/logic/mayhem/pipeline';
import type { MayhemBundle } from './src/logic/mayhem/types';

const augments = (bundle as MayhemBundle).augments;
const idOf = (name: string): string => {
  const aug = augments.find((a) => a.name === name);
  if (!aug) throw new Error(`bundle has no ${name}`);
  return aug.id;
};

function ok(cond: boolean, label: string): void {
  console.log(`${cond ? 'ok' : 'FAIL'} ${label}`);
  if (!cond) process.exitCode = 1;
}

/** Titles at the 3-card columns in the shop name row (y ≈ 0.41). */
const row = (titles: string[], columns = [0.33, 0.5, 0.67]): MayhemFrameLine[] =>
  titles.map((text, i) => ({
    text,
    rect: { x: columns[i] - 0.05, y: 0.4, w: 0.1, h: 0.025 },
  }));

const classify = (lines: MayhemFrameLine[]) =>
  classifyMayhemFrame({
    lines,
    augments,
    mode: 'mayhem-likely',
    state: createMayhemPipelineState(),
    now: 1_000,
  });

ok(!augments.some((a) => a.name === 'Flashy'), 'fixture premise: Flashy is not in the bundle');

const flashy = classify(row(['Flashy', 'Upgrade Sheen', 'Weapon of Destiny']));
ok(flashy.decision === 'accept', `screenshot roll is accepted (${flashy.decision}, ${flashy.reasons})`);
ok(
  flashy.knownIds.length === 2 &&
    flashy.knownIds.includes(idOf('Upgrade Sheen')) &&
    flashy.knownIds.includes(idOf('Weapon of Destiny')),
  'only the two bundle cards are trusted ids'
);
ok(
  flashy.ids.length === 3 && flashy.ids[0].startsWith('unknown:') && flashy.ids[1] === idOf('Upgrade Sheen'),
  `display keeps card order with a placeholder for Flashy (${flashy.ids})`
);
ok(flashy.placeholderIds.length === 1, 'one placeholder');

const allKnown = classify(row(['Infernal Soul', 'FireFox', 'ADAPt']));
ok(allKnown.decision === 'accept' && allKnown.knownIds.length === 3, 'second screenshot roll (all known) accepted');

const misread = classify(row(['Infernal Soul', 'FireFox', 'AD#P1']));
ok(misread.decision === 'accept' && misread.knownIds.length === 2, 'one misread title no longer blocks the roll');

const oneKnown = classify(row(['Upgrade Sheen', 'Zzqx Plorb', 'Wobble Fnord']));
ok(oneKnown.decision !== 'accept' && oneKnown.ids.length === 0, 'one known + two junk stays rejected');

const champ = classify(row(['Upgrade Sheen', 'Weapon of Destiny', 'Blitzcrank']));
ok(champ.decision !== 'accept' && champ.ids.length === 0, 'two known + a champion name is not a roll');

const four = classify(
  row(['Upgrade Sheen', 'Weapon of Destiny', 'Zzqx Plorb', 'Wobble Fnord'], [0.245, 0.415, 0.585, 0.755])
);
ok(four.decision !== 'accept' && four.ids.length === 0, 'two known on a four-card row stays rejected');

const offRow = classify(
  row(['Flashy', 'Upgrade Sheen', 'Weapon of Destiny']).map((l) => ({ ...l, rect: { ...l.rect, y: 0.7 } }))
);
ok(offRow.decision !== 'accept', 'titles outside the shop name row still carry nothing');

if (!process.exitCode) console.log('verify:mayhem-partial-roll ok');
