import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bundle from './src/data/mayhem/bundle.json';
import { parseMayhemOcrOutput } from './src/logic/mayhem/ocrOutput';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const fixtureDir = path.join(root, 'test-fixtures', 'mayhem-ocr', 'labelled');
const manifestPath = path.join(fixtureDir, 'manifest.json');
const ocrScript = path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1');

interface OcrLine {
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}
interface Fixture {
  id: string;
  label: 'positive' | 'negative';
  synthetic: boolean;
  image: string | null;
  source: string;
  expectedIds: string[];
  expectedCardCount: 0 | 3 | 4;
  notes: string;
  rawOcr?: { text: string; lines: OcrLine[] };
}
interface Manifest {
  schema: string;
  note: string;
  fixtures: Fixture[];
}

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

function normalized(line: OcrLine): boolean {
  const r = line.rect;
  return [r.x, r.y, r.w, r.h].every(
    (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
  );
}

function titleFor(id: string): string | undefined {
  return bundle.augments.find((a) => a.id === id)?.name;
}

const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
const fixtures = raw.fixtures;
ok(Array.isArray(fixtures) && fixtures.length >= 9, 'manifest has the labelled fixture set');

for (const fx of fixtures) {
  ok(Boolean(fx.image || fx.rawOcr), `${fx.id}: has image and/or rawOcr`);
  ok(fx.label === 'positive' || fx.label === 'negative', `${fx.id}: has a label`);
  ok(typeof fx.synthetic === 'boolean', `${fx.id}: declares synthetic`);
  ok(Array.isArray(fx.expectedIds), `${fx.id}: has expectedIds`);
  ok([0, 3, 4].includes(fx.expectedCardCount), `${fx.id}: expectedCardCount is 0/3/4`);
  ok(
    fx.expectedIds.every((id) => Boolean(titleFor(id))),
    `${fx.id}: every expectedId is in our bundle`
  );
  if (fx.image) {
    ok(fs.existsSync(path.join(root, fx.image)), `${fx.id}: image file exists`);
  }
  if (fx.rawOcr) {
    ok(typeof fx.rawOcr.text === 'string', `${fx.id}: rawOcr has text`);
    ok(Array.isArray(fx.rawOcr.lines) && fx.rawOcr.lines.length > 0, `${fx.id}: rawOcr has lines`);
    ok(fx.rawOcr.lines.every(normalized), `${fx.id}: frozen boxes normalized 0..1`);
  }
}

const real = fixtures.find((fx) => !fx.synthetic);
ok(Boolean(real), 'manifest has the non-synthetic real fixture');
if (real) {
  ok(real.image === null, `${real.id}: real image is not committed`);
  ok(real.label === 'negative' && real.expectedIds.length === 0, `${real.id}: real frame is negative`);
  ok(
    real.source === 'https://hexgate.app/screenshots/aram-mayhem-champ-select.webp',
    `${real.id}: real source URL is cited`
  );
  const realLines = real.rawOcr?.lines ?? [];
  const observed = [
    'PICK YOUR CHAMPION', 'AVAILABLE CHAMPS', 'Yasuo', 'Annie', 'Warwick', 'Yorick',
    'Zyra', 'Rakan', 'Varus', 'CHAMP SELECT', 'VARUS', 'YASUO'
  ];
  ok(
    observed.every((line) => realLines.some((l) => l.text === line)),
    `${real.id}: observed champion-select lines are frozen with boxes`
  );
}

ok(
  fixtures.find((fx) => fx.id === 'negative-champion-row')?.label === 'negative',
  'synthetic champion-row fixture is labelled negative'
);

function liveOcr(): void {
  if (process.platform !== 'win32') {
    console.log('skip live -ImagePath OCR (non-Windows)');
    return;
  }
  for (const fx of fixtures.filter((f) => f.synthetic && f.image)) {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ocrScript, '-ImagePath', path.join(root, fx.image!)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const parsed = parseMayhemOcrOutput(out);
    const lines = parsed.lines ?? [];
    ok(lines.length > 0, `${fx.id}: OCR produced lines (no positive may read zero)`);
    ok(lines.every(normalized), `${fx.id}: live boxes normalized 0..1`);

    for (const id of fx.expectedIds) {
      const title = titleFor(id)!;
      ok(parsed.text.includes(title), `${fx.id}: OCR text projection contains ${title}`);
    }

    if (fx.id === 'positive-3-en' || fx.id === 'positive-4-en') {
      const titled = lines.filter((l) => fx.expectedIds.some((id) => l.text === titleFor(id)));
      const xs = titled.map((l) => l.rect.x);
      ok(xs.length === fx.expectedIds.length, `${fx.id}: one box per expected title`);
      ok(new Set(xs).size === xs.length, `${fx.id}: expected titles have distinct x positions`);
    }
  }
}

liveOcr();
if (!process.exitCode) console.log('verify:mayhem-fixtures ok');
