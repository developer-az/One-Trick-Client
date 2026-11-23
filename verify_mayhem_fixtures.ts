import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bundle from './src/data/mayhem/bundle.json';
import { parseMayhemOcrOutput, type MayhemOcrOutput } from './src/logic/mayhem/ocrOutput';
import { classifyMayhemFrame, createMayhemPipelineState } from './src/logic/mayhem/pipeline';
import type { MayhemBundle } from './src/logic/mayhem/types';

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
ok(
  fixtures.find((fx) => fx.id === 'positive-headerless-teal')?.label === 'positive',
  'teal headerless fixture is labelled positive'
);
ok(
  fixtures.find((fx) => fx.id === 'negative-headerless-no-teal')?.label === 'negative',
  'non-teal headerless fixture is labelled negative'
);
ok(
  fixtures.find((fx) => fx.id === 'positive-4-headerless-teal')?.label === 'positive',
  'four-card teal headerless fixture is labelled positive'
);
ok(
  fixtures.find((fx) => fx.id === 'negative-aligned-teal')?.label === 'negative',
  'aligned teal-background fixture is labelled negative'
);
ok(
  fixtures.find((fx) => fx.id === 'negative-full-width-teal')?.label === 'negative',
  'full-width teal fixture is labelled negative'
);
ok(
  fixtures.find((fx) => fx.id === 'positive-gold-teal-geometry')?.label === 'positive' &&
    fixtures.find((fx) => fx.id === 'positive-gold-teal-geometry')?.synthetic === true,
  'gold-body fixture is labelled positive and synthetic'
);

// A hand-built/older payload with aligned strong slots but no explicit gap must
// never pass the pixel gate, even with cardsVisible:true (the fail-closed boundary).
{
  const augments = (bundle as MayhemBundle).augments;
  const gapless = classifyMayhemFrame({
    lines: [
      { text: 'Zephyr', rect: { x: 0.2812, y: 0.3796, w: 0.0958, h: 0.0509 } },
      { text: 'Cinder', rect: { x: 0.4547, y: 0.3796, w: 0.0885, h: 0.0389 } },
      { text: 'Astral', rect: { x: 0.6286, y: 0.3796, w: 0.0786, h: 0.0389 } },
    ],
    augments,
    mode: 'mayhem-likely',
    state: createMayhemPipelineState(),
    now: 60_000_000,
    cardsVisible: true,
    cardSlots: [
      { x: 0.33, body: 9, rim: 9 },
      { x: 0.5, body: 9, rim: 9 },
      { x: 0.67, body: 9, rim: 9 },
    ],
  });
  ok(
    gapless.decision === 'unverified' && gapless.ids.length === 0,
    'aligned strong slots with no gap never satisfy the pixel gate'
  );
}

function liveOcr(): void {
  if (process.platform !== 'win32') {
    console.log('skip live -ImagePath OCR (non-Windows)');
    return;
  }
  const augments = (bundle as MayhemBundle).augments;
  // Classify the LIVE PowerShell read of the PNG — text, boxes, slot evidence
  // and the coarse flag exactly as the Electron pipeline receives them — never
  // the reconstructed manifest literals the text matrix reasons about.
  const liveDecision = (parsed: MayhemOcrOutput) =>
    classifyMayhemFrame({
      lines: parsed.lines ?? [],
      augments,
      mode: 'mayhem-likely',
      state: createMayhemPipelineState(),
      now: 60_000_000,
      cardsVisible: parsed.cardsVisible,
      cardSlots: parsed.cardSlots,
    });
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

    const strongAt = (centers: number[]): number =>
      (parsed.cardSlots ?? []).filter(
        (slot) => centers.some((c) => Math.abs(slot.x - c) <= 0.03) && (slot.body >= 8 || slot.rim >= 7)
      ).length;

    if (fx.id === 'positive-headerless-teal') {
      ok(parsed.cardsVisible === true, `${fx.id}: teal bodies/rims set the pixel gate`);
      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
      ok(strongAt([0.33, 0.5, 0.67]) >= 2, `${fx.id}: card-sized teal evidence on the 3-card columns`);
      const live = liveDecision(parsed);
      ok(
        live.decision === 'accept' && live.ids.length === 3 &&
          live.cardCount === 3 && live.knownIds.length === 0 && live.placeholderIds.length === 3,
        `${fx.id}: live PNG classifies accept with 3 placeholders`
      );
    }
    if (fx.id === 'positive-gold-teal-geometry') {
      ok(parsed.cardsVisible === true, `${fx.id}: gold bodies set the pixel gate`);
      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
      const goldCardSlots = (parsed.cardSlots ?? []).filter(
        (slot) => [0.33, 0.5, 0.67].some((c) => Math.abs(slot.x - c) <= 0.03)
      );
      ok(
        goldCardSlots.length >= 2 && goldCardSlots.every((slot) => slot.body >= 8 && slot.gap === 0),
        `${fx.id}: gold bodies yield body>=8 with clean gaps on the card columns`
      );
      const live = liveDecision(parsed);
      ok(
        live.decision === 'accept' && live.reasons.includes('all-unknown-card-pixels') &&
          live.ids.length === 3 && live.cardCount === 3 &&
          live.knownIds.length === 0 && live.placeholderIds.length === 3,
        `${fx.id}: live PNG classifies accept via all-unknown-card-pixels`
      );
    }
    if (fx.id === 'negative-headerless-no-teal') {
      ok(parsed.cardsVisible === false, `${fx.id}: non-teal bodies/rims clear the pixel gate`);
      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
      ok(strongAt([0.33, 0.5, 0.67, 0.245, 0.415, 0.585, 0.755]) === 0, `${fx.id}: no card-sized evidence in any slot`);
      const live = liveDecision(parsed);
      ok(
        live.decision === 'unverified' && live.ids.length === 0 &&
          live.placeholderIds.length === 0,
        `${fx.id}: live PNG classifies unverified with no ids`
      );
    }
    if (fx.id === 'positive-4-headerless-teal') {
      ok(parsed.cardsVisible === true, `${fx.id}: teal bodies/rims set the pixel gate`);
      ok(lines.length === 4, `${fx.id}: four boxed unfamiliar titles`);
      ok(strongAt([0.245, 0.415, 0.585, 0.755]) >= 2, `${fx.id}: card-sized teal evidence on the 4-card columns`);
      const live = liveDecision(parsed);
      ok(
        live.decision === 'accept' && live.ids.length === 4 &&
          live.cardCount === 4 && live.knownIds.length === 0 && live.placeholderIds.length === 4,
        `${fx.id}: live PNG classifies accept with 4 placeholders`
      );
    }
    if (fx.id === 'negative-aligned-teal') {
      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
      ok(strongAt([0.33, 0.5, 0.67, 0.245, 0.415, 0.585, 0.755]) === 0, `${fx.id}: wide teal band is not card-sized evidence`);
      ok(parsed.cardsVisible === false, `${fx.id}: region sampler does not claim a global teal hit`);
      const live = liveDecision(parsed);
      ok(
        live.decision === 'unverified' && live.ids.length === 0 &&
          live.placeholderIds.length === 0,
        `${fx.id}: live PNG classifies unverified with no ids`
      );
    }
    if (fx.id === 'negative-full-width-teal') {
      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
      ok(parsed.cardsVisible === true, `${fx.id}: full-width teal band sets the coarse flag`);
      ok(
        (parsed.cardSlots ?? []).length === 7 &&
          (parsed.cardSlots ?? []).every((slot) => (slot.gap ?? 0) > 0),
        `${fx.id}: teal leaks into every inter-card gap`
      );
      const live = liveDecision(parsed);
      ok(
        live.decision === 'unverified' && live.ids.length === 0 &&
          live.placeholderIds.length === 0,
        `${fx.id}: live PNG classifies unverified with no ids`
      );
    }

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
