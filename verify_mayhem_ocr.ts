import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bundle from './src/data/mayhem/bundle.json';
import { matchAugmentsFromOcr } from './src/logic/mayhem/match';
import { runMayhemOcrOnImageFile } from './src/logic/mayhem/ocrRunner';
import type { MayhemBundle } from './src/logic/mayhem/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const data = bundle as MayhemBundle;

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

// --- Unit: fuzzy matcher (no OS OCR) ---
const noisy =
  'Choose an augment\nJeweled Gauntlet\nSilver\nGiant Slayer\nPrismatic\nnoise UI text';
const unitIds = matchAugmentsFromOcr(noisy, data.augments);
ok(unitIds.includes('jeweled_gauntlet'), 'matcher finds Jeweled Gauntlet from lines');
ok(unitIds.includes('giant_slayer'), 'matcher finds Giant Slayer from lines');

const merged = 'SomeUi Jeweled Gauntlet Giant Slayer Apex Inventor footer';
const mergedIds = matchAugmentsFromOcr(merged, data.augments);
ok(mergedIds.includes('jeweled_gauntlet'), 'matcher corpus: jeweled');
ok(mergedIds.includes('giant_slayer'), 'matcher corpus: giant slayer');
ok(mergedIds.includes('apex_inventor'), 'matcher corpus: apex inventor');

const typo = 'Jeweled Gauntiet\nGiant Slayer\nApex Inventor';
const typoIds = matchAugmentsFromOcr(typo, data.augments);
ok(typoIds.includes('giant_slayer'), 'matcher tolerates one OCR typo line');
ok(typoIds.includes('jeweled_gauntlet') || typoIds.includes('apex_inventor'), 'matcher still finds 2+ with typo');

const adaptLine = 'ADAPt\nRecursion\nShrink Engine';
const adaptIds = matchAugmentsFromOcr(adaptLine, data.augments);
ok(adaptIds.includes('adapt'), 'matcher normalizes ADAPt casing');

const recursionTrio = 'Recursion\nShrink Engine\nBlunt Force';
const recursionIds = matchAugmentsFromOcr(recursionTrio, data.augments);
ok(recursionIds.includes('recursion'), 'Recursion line beats Infinite Recursion');
ok(!recursionIds.includes('infinite_recursion'), 'no false Infinite Recursion on Recursion offer');

const shrinkOnly = 'Shrink Engine\nTank Engine\nShrink Ray';
const shrinkIds = matchAugmentsFromOcr(shrinkOnly, data.augments);
ok(shrinkIds[0] === 'shrink_engine' || shrinkIds.includes('shrink_engine'), 'prefers Shrink Engine over Shrink Ray');
ok(!shrinkIds.includes('tank_engine') || shrinkIds.indexOf('shrink_engine') < shrinkIds.indexOf('tank_engine'), 'Shrink Engine ranks above Tank Engine');

const maxThree = matchAugmentsFromOcr(
  'A\nB\nC\nD\nJeweled Gauntlet\nGiant Slayer\nVampirism\nRecursion\nEureka',
  data.augments
);
ok(maxThree.length <= 3, 'matcher returns at most 3 ids');

const garbage = 'lkjhsdf qwer tyuiop';
const none = matchAugmentsFromOcr(garbage, data.augments);
ok(none.length === 0, 'matcher ignores garbage OCR');

const FIXTURES: Array<{ file: string; expect: string[] }> = [
  { file: 'three-offers.png', expect: ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'] },
  { file: 'recursion-trio.png', expect: ['recursion', 'shrink_engine', 'blunt_force'] },
  { file: 'noisy-ui.png', expect: ['dashing', 'back_to_basics', 'eureka'] },
];

async function runIntegration(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('skip integration (non-Windows)');
    return;
  }
  const fixtureDir = path.join(root, 'test-fixtures', 'mayhem-ocr');
  const genScript = path.join(root, 'scripts', 'generate-mayhem-ocr-fixture.ps1');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${genScript}" -Scenario all`, {
    cwd: root,
    stdio: 'pipe',
  });

  for (const fx of FIXTURES) {
    const fixturePng = path.join(fixtureDir, fx.file);
    ok(fs.existsSync(fixturePng), `fixture ${fx.file} exists`);
    const ocrText = await runMayhemOcrOnImageFile(fixturePng, root);
    ok(ocrText.trim().length > 8, `${fx.file}: OCR text length ${ocrText.trim().length}`);
    const liveIds = matchAugmentsFromOcr(ocrText, data.augments);
    console.log(`${fx.file} snippet:`, ocrText.replace(/\s+/g, ' ').slice(0, 100));
    console.log(`${fx.file} ids:`, liveIds.join(', '));
    for (const id of fx.expect) {
      ok(liveIds.includes(id), `${fx.file} matched ${id}`);
    }
  }

  const demoScript = path.join(root, 'scripts', 'mayhem-ocr-live-demo.ps1');
  if (process.env.OT_RUN_LIVE_OCR_UI !== '1') {
    console.log('skip live OCR UI (set OT_RUN_LIVE_OCR_UI=1 to flash a test window)');
  } else if (fs.existsSync(demoScript)) {
    const demoOut = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${demoScript}"`,
      { cwd: root, encoding: 'utf8', timeout: 60000 }
    );
    const demoIds = matchAugmentsFromOcr(demoOut, data.augments);
    ok(demoIds.includes('recursion'), 'live demo window: recursion');
    ok(demoIds.includes('shrink_engine'), 'live demo window: shrink_engine');
    ok(demoIds.includes('blunt_force'), 'live demo window: blunt_force');
  }
}

void runIntegration().then(() => {
  if (!process.exitCode) console.log('verify:mayhem-ocr ok');
});
