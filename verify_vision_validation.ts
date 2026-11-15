/**
 * Vision vs API validation — pure scoring/reporting checks.
 *
 * Run: npm run verify:vision-validation
 */

import { createVisionValidator } from './src/logic/visionValidation';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, `${msg} (expected ${e}, got ${a})`);
}

// --- numeric agreement: exact and tolerant ---------------------------------
const exact = createVisionValidator();
eq(exact.check('hp', 512, 512, 10), 'agree', 'equal numbers agree at default tolerance 0');
eq(exact.report().hp.checks, 1, 'an agreeing check is counted');
eq(exact.report().hp.agree, 1, 'agreement is counted');
eq(exact.report().hp.accuracy, 1, 'accuracy is 1 after one agreement');

const strict = createVisionValidator();
eq(strict.check('hp', 512, 514, 10), 'disagree', 'numbers 2 apart disagree at default tolerance 0');

const tolerant = createVisionValidator();
eq(tolerant.check('hp', 512, 514, 10, 3), 'agree', 'HP 512 vs 514 agrees at tolerance 3');
eq(tolerant.check('hp', 512, 516, 10, 3), 'disagree', 'HP 512 vs 516 disagrees at tolerance 3');
eq(tolerant.report().hp.accuracy, 0.5, 'one agree + one disagree gives accuracy 0.5');

// --- strings: trim and ignore case ------------------------------------------
const strings = createVisionValidator();
eq(strings.check('summoner', 'Flash ', 'flash', 20), 'agree', "strings agree ignoring trailing space and case ('Flash ' vs 'flash')");
eq(strings.check('summoner', ' ignite', 'IGNITE ', 21), 'agree', 'strings agree ignoring leading space and case');

// --- mixed types always disagree --------------------------------------------
const mixed = createVisionValidator();
eq(mixed.check('level', 5, '5', 30), 'disagree', 'mixed number/string types disagree');
eq(mixed.check('level', '5', 5, 31), 'disagree', 'mixed string/number types disagree');

// --- null / undefined / non-finite numbers are skipped and not counted ------
const skipped = createVisionValidator();
eq(skipped.check('cs', null, 100, 40), 'skipped', 'null vision is skipped');
eq(skipped.check('cs', 100, null, 41), 'skipped', 'null api is skipped');
eq(skipped.check('cs', undefined, 100, 42), 'skipped', 'undefined vision is skipped');
eq(skipped.check('cs', 100, undefined, 43), 'skipped', 'undefined api is skipped');
eq(skipped.check('cs', Number.NaN, 100, 44), 'skipped', 'NaN vision is skipped');
eq(skipped.check('cs', 100, Number.NaN, 45), 'skipped', 'NaN api is skipped');
eq(skipped.check('cs', Number.POSITIVE_INFINITY, 100, 46), 'skipped', 'infinite vision is skipped');
eq(skipped.check('cs', 100, Number.NEGATIVE_INFINITY, 47), 'skipped', 'negative infinite api is skipped');
const skippedEntry = skipped.report().cs;
ok(
  skippedEntry === undefined ||
    (skippedEntry.checks === 0 && skippedEntry.agree === 0 && skippedEntry.disagree === 0 && skippedEntry.accuracy === null),
  'skipped checks are never counted'
);

// --- accuracy rounds to three decimals --------------------------------------
const accuracy = createVisionValidator();
accuracy.check('cs', 10, 10, 50);
accuracy.check('cs', 20, 20, 51);
accuracy.check('cs', 30, 31, 52);
const accuracyEntry = accuracy.report().cs;
eq(accuracyEntry.checks, 3, 'accuracy fixture has three checks');
eq(accuracyEntry.agree, 2, 'accuracy fixture has two agreements');
eq(accuracyEntry.disagree, 1, 'accuracy fixture has one disagreement');
eq(accuracyEntry.accuracy, 0.667, '2 agree + 1 disagree rounds accuracy to 0.667');

// --- no checks means null accuracy ------------------------------------------
const empty = createVisionValidator();
eq(empty.report(), {}, 'report is empty before any counted checks');
const neverChecked = createVisionValidator();
neverChecked.check('hp', null, 100, 5);
const neverCheckedEntry = neverChecked.report().hp;
ok(
  neverCheckedEntry === undefined ||
    (neverCheckedEntry.checks === 0 && neverCheckedEntry.accuracy === null),
  'a field with no counted checks has null accuracy (or is absent)'
);

// --- logging: once per field per match, exact format -----------------------
const lines: string[] = [];
const logged = createVisionValidator((line) => lines.push(line));

eq(logged.check('hp', 100, 101, 125.4), 'disagree', 'first HP mismatch disagrees');
eq(lines.length, 1, 'first mismatch logs once');
eq(
  lines[0],
  '[vision] hp mismatch: vision=100 api=101 at 02:05',
  'mismatch line uses the exact format and 125.4 seconds formats as 02:05'
);

eq(logged.check('hp', 200, 202, 130), 'disagree', 'second HP mismatch disagrees');
eq(lines.length, 1, 'repeated mismatch on the same field does not log again in the same match');
eq(logged.report().hp.checks, 2, 'repeated mismatch still increments checks');
eq(logged.report().hp.disagree, 2, 'repeated mismatch still increments disagreements');
eq(logged.report().hp.accuracy, 0, 'two disagreements give accuracy 0');

eq(logged.check('mana', 300, 301, 135), 'disagree', 'a different field can disagree');
eq(lines.length, 2, 'a separate field logs separately');
eq(
  lines[1],
  '[vision] mana mismatch: vision=300 api=301 at 02:15',
  'separate field mismatch uses its own exact line'
);

// --- resetMatch clears counts and once-per-field log memory -----------------
logged.resetMatch();
const afterReset = logged.report();
const hpAfterReset = afterReset.hp;
const manaAfterReset = afterReset.mana;
ok(
  (!hpAfterReset ||
    (hpAfterReset.checks === 0 &&
      hpAfterReset.agree === 0 &&
      hpAfterReset.disagree === 0 &&
      hpAfterReset.accuracy === null)) &&
    (!manaAfterReset ||
      (manaAfterReset.checks === 0 &&
        manaAfterReset.agree === 0 &&
        manaAfterReset.disagree === 0 &&
        manaAfterReset.accuracy === null)),
  'resetMatch clears counts for every field'
);

eq(logged.check('hp', 400, 401, 140), 'disagree', 'the same field can disagree after reset');
eq(lines.length, 3, 'resetMatch allows the field to log again');
eq(lines[2], '[vision] hp mismatch: vision=400 api=401 at 02:20', 'post-reset log line is exact');
eq(logged.report().hp.checks, 1, 'post-reset checks start from zero');
eq(logged.report().hp.disagree, 1, 'post-reset disagreements start from zero');

// --- report exposes only counts/accuracy/lastDisagreement, never a corrected value
const inspection = createVisionValidator();
inspection.check('hp', 123, 456, 61.5);
inspection.check('hp', 130, 131, 64);
const inspected = inspection.report().hp;
eq(
  Object.keys(inspected).sort(),
  ['accuracy', 'agree', 'checks', 'disagree', 'lastDisagreement'],
  'report entries contain only counts, accuracy and lastDisagreement'
);
ok(!('corrected' in inspected), 'report entry never stores a corrected value');
ok(!('value' in inspected), 'report entry never stores a replacement value');
eq(
  Object.keys(inspected.lastDisagreement ?? {}).sort(),
  ['api', 'gameTime', 'vision'],
  'lastDisagreement stores only the original vision/api values and gameTime'
);
eq(inspected.lastDisagreement?.vision, 130, 'lastDisagreement keeps the vision value unchanged');
eq(inspected.lastDisagreement?.api, 131, 'lastDisagreement keeps the API value unchanged');
eq(inspected.lastDisagreement?.gameTime, 64, 'lastDisagreement keeps the gameTime unchanged');
eq(inspected.checks, 2, 'report keeps the check count');
eq(inspected.agree, 0, 'report keeps the agree count');
eq(inspected.disagree, 2, 'report keeps the disagree count');
eq(inspected.accuracy, 0, 'report keeps the computed accuracy');

if (!process.exitCode) console.log('verify:vision-validation ok');
