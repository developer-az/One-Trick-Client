import bundle from './src/data/mayhem/bundle.json';
import { sanitizeMayhemBundle, validateMayhemBundle } from './src/logic/mayhem/bundleSanitize';
import type { MayhemBundle } from './src/logic/mayhem/types';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const raw = bundle as MayhemBundle;
const stats = {
  combosIn: 0,
  combosOut: 0,
  combosDroppedMissingAugment: 0,
  combosDroppedEmptyTypesOnSingle: 0,
};
const clean = sanitizeMayhemBundle(raw, stats);

ok(clean.augments.filter((a) => !a.legacy).length >= 150, 'live augment count');
ok(stats.combosOut <= stats.combosIn, 'sanitize only removes combos');
const errors = validateMayhemBundle(clean);
ok(errors.length === 0, errors.length ? errors.slice(0, 3).join('; ') : 'sanitized bundle passes validation');

if (!process.exitCode) {
  console.log(
    `sanitize: ${stats.combosIn} → ${stats.combosOut} combos (dropped ${stats.combosDroppedMissingAugment} broken, ${stats.combosDroppedEmptyTypesOnSingle} untyped singles)`
  );
  console.log('verify:mayhem-bundle ok');
}
