/**
 * Diagnose one Mayhem roll screenshot through the real capture + reader path.
 *
 *   npx --yes tsx scripts/mayhem-diagnose.ts <path-to-png>
 *
 * Runs the shipped mayhem-ocr.ps1 on the image (no screen capture), parses its
 * full marker stream the way the app does, then prints the raw evidence and the
 * classifier's decision and reasons — i.e. exactly why a scan settles as
 * "Could not verify". Read-only: writes nothing.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bundle from '../src/data/mayhem/bundle.json';
import { parseMayhemOcrOutput } from '../src/logic/mayhem/ocrOutput';
import {
  classifyMayhemFrame,
  createMayhemPipelineState,
} from '../src/logic/mayhem/pipeline';
import type { MayhemBundle } from '../src/logic/mayhem/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = process.argv[2];
if (!image || !fs.existsSync(image)) {
  console.error('usage: npx --yes tsx scripts/mayhem-diagnose.ts <png>');
  process.exit(2);
}

const script = path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1');
const run = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', script, '-ImagePath', path.resolve(image)],
  { cwd: root, encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 32 << 20 }
);
const raw = `${run.stdout ?? ''}`;
if (!raw.trim()) {
  console.error('the capture script printed nothing (is Windows.Media.Ocr available?)');
  console.error(String(run.stderr ?? '').slice(0, 2000));
  process.exit(1);
}

const parsed = parseMayhemOcrOutput(raw);
const augments = (bundle as MayhemBundle).augments;
const evidence = classifyMayhemFrame({
  lines: parsed.lines ?? [],
  augments,
  mode: 'mayhem-likely',
  state: createMayhemPipelineState(),
  now: Date.now(),
  cardsVisible: parsed.cardsVisible,
  cardSlots: parsed.cardSlots,
});

const markers = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith('__OT_'))
  .map((l) => (l.length > 90 ? `${l.slice(0, 90)}…` : l));

console.log('--- capture markers ---');
for (const m of markers) console.log(m);
console.log('\n--- parsed text ---');
console.log(JSON.stringify(parsed.text));
console.log('\n--- parsed evidence ---');
console.log(
  JSON.stringify(
    {
      blackFrame: parsed.blackFrame,
      noTarget: parsed.noTarget,
      fallback: parsed.fallback,
      emptyFrame: parsed.emptyFrame,
      cardsVisible: parsed.cardsVisible,
      cardSlots: parsed.cardSlots,
      cursor: parsed.cursor,
      lines: parsed.lines,
    },
    null,
    1
  )
);

console.log('\n--- classifier ---');
console.log(JSON.stringify({ decision: evidence.decision, ids: evidence.ids, reasons: evidence.reasons }, null, 1));

// Same guard order the app's adapter uses before it trusts a read.
let verdict: string;
if (parsed.blackFrame) verdict = 'REJECTED: black frame (capture is not showing the game)';
else if (parsed.noTarget) verdict = 'REJECTED: no League window targeted (alt-tab / borderless)';
else if (parsed.fallback) verdict = 'REJECTED: fallback capture (could not prove the window on top)';
else if (evidence.decision === 'accept') verdict = 'ACCEPTED: this frame names the roll';
else if (evidence.decision === 'preview') verdict = 'PREVIEW: one card seen, a confirmation read is required';
else verdict = `REJECTED by classifier: ${evidence.reasons.join(', ') || 'unverified'}`;

console.log(`\nVERDICT ${verdict}`);
process.exit(0);
