import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMayhemOcrOutput, type MayhemOcrOutput } from './src/logic/mayhem/ocrOutput';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

const marker =
  '__OT_LINES__[{"text":"Jeweled Gauntlet","rect":{"x":0.101,"y":0.407,"w":0.435,"h":0.051}}]';

// (a) the structured marker must not change the text projection at all
const plain = parseMayhemOcrOutput(['Jeweled Gauntlet', 'Giant Slayer'].join('\n')).text;
const withMarker = parseMayhemOcrOutput(['Jeweled Gauntlet', 'Giant Slayer', marker].join('\n')).text;
ok(withMarker === plain, 'text with __OT_LINES__ is byte-for-byte the text without it');

// (b) boxes are decoded and stay normalized
const decoded = parseMayhemOcrOutput(marker);
const boxes: NonNullable<MayhemOcrOutput['lines']> = decoded.lines ?? [];
ok(boxes.length === 1, 'one line box decoded');
ok(boxes[0].text === 'Jeweled Gauntlet', 'box text decoded');
const rect = boxes[0].rect;
ok(rect.x === 0.101 && rect.y === 0.407 && rect.w === 0.435 && rect.h === 0.051, 'box fractions decoded');
ok(
  [rect.x, rect.y, rect.w, rect.h].every((v) => v >= 0 && v <= 1),
  'box fractions are normalized to 0..1'
);

// (c2) a crop frame maps crop-local boxes back to full-frame coordinates
const frameMarker =
  '__OT_LINES__{"frame":[0.08,0.18,0.84,0.62],"lines":[{"text":"Giant Slayer","rect":{"x":0.5,"y":0.355,"w":0.1,"h":0.05}}]}';
const framed = parseMayhemOcrOutput(['Giant Slayer', frameMarker].join('\n'));
const framedRect = framed.lines?.[0]?.rect;
ok(framed.text === 'Giant Slayer', 'a framed marker is stripped from the text projection');
ok(Boolean(framedRect), 'a framed marker decodes its line box');
ok(
  framedRect !== undefined &&
    Math.abs(framedRect.x - 0.5) < 1e-9 &&
    Math.abs(framedRect.y - 0.4001) < 1e-9 &&
    Math.abs(framedRect.w - 0.084) < 1e-9 &&
    Math.abs(framedRect.h - 0.031) < 1e-9,
  'crop-local y=0.355 with frame top=0.18/height=0.62 maps to full y≈0.40'
);

// (c) a malformed marker is ignored, never thrown
let malformed: MayhemOcrOutput | undefined;
let threw = false;
try {
  malformed = parseMayhemOcrOutput('Jeweled Gauntlet\n__OT_LINES__{not json');
} catch {
  threw = true;
}
ok(!threw, 'malformed __OT_LINES__ does not throw');
ok(malformed?.lines?.length === 0, 'malformed __OT_LINES__ yields no boxes');
ok(malformed?.text === 'Jeweled Gauntlet', 'malformed marker is stripped from text');

// (c3) the empty-frame marker is decoded and is invisible to the text projection
const emptyMarked = parseMayhemOcrOutput(
  ['__OT_OCR_LANG en-US__', '__OT_EMPTY_FRAME__', '__OT_LINES__{"lines":[]}'].join('\n')
);
ok(emptyMarked.emptyFrame === true, '__OT_EMPTY_FRAME__ parses to emptyFrame=true');
ok(emptyMarked.text === '', 'the empty-frame marker leaves the text projection byte-for-byte empty');
ok(
  parseMayhemOcrOutput('__OT_BLACK_FRAME__\n__OT_LINES__{"lines":[]}').emptyFrame === false,
  'a black-frame capture is not an empty frame'
);
ok(
  parseMayhemOcrOutput('__OT_FALLBACK__\n__OT_LINES__{"lines":[]}').emptyFrame === false,
  'a fallback capture is not an empty frame'
);
ok(
  parseMayhemOcrOutput('__OT_NO_TARGET__').emptyFrame === false,
  'a failed/no-target capture is not an empty frame'
);

// (c4) the name-independent pixel marker decodes and stays invisible to text
const tealMarked = parseMayhemOcrOutput(
  ['__OT_CARDS_VISIBLE 1__', 'Zephyr', '__OT_LINES__{"lines":[]}'].join('\n')
);
ok(tealMarked.cardsVisible === true, '__OT_CARDS_VISIBLE 1__ parses to cardsVisible=true');
ok(tealMarked.text === 'Zephyr', 'the card-pixel marker leaves the text projection unchanged');
ok(
  parseMayhemOcrOutput('__OT_CARDS_VISIBLE 0__').cardsVisible === false,
  '__OT_CARDS_VISIBLE 0__ parses to cardsVisible=false'
);
ok(
  parseMayhemOcrOutput('__OT_CARDS_VISIBLE maybe__').cardsVisible === undefined,
  'a malformed card-pixel marker is ignored'
);
ok(
  parseMayhemOcrOutput('__OT_BLACK_FRAME__').cardsVisible === undefined &&
    parseMayhemOcrOutput('__OT_FALLBACK__').cardsVisible === undefined &&
    parseMayhemOcrOutput('__OT_NO_TARGET__').cardsVisible === undefined,
  'black/fallback/no-target frames carry no card-pixel marker'
);

// (c5) conflicting or malformed visibility markers fail closed; duplicates that
// agree keep their value. A marker-shaped OCR line is just another marker here,
// so a disagreement with the control line yields no visibility verdict.
ok(
  parseMayhemOcrOutput('__OT_CARDS_VISIBLE 0__\n__OT_CARDS_VISIBLE 1__').cardsVisible === undefined,
  'conflicting 0-then-1 visibility markers fail closed'
);
ok(
  parseMayhemOcrOutput('__OT_CARDS_VISIBLE 1__\n__OT_CARDS_VISIBLE 0__').cardsVisible === undefined,
  'conflicting 1-then-0 visibility markers fail closed'
);
ok(
  parseMayhemOcrOutput('__OT_CARDS_VISIBLE 1__\n__OT_CARDS_VISIBLE 1__').cardsVisible === true &&
    parseMayhemOcrOutput('__OT_CARDS_VISIBLE 0__\n__OT_CARDS_VISIBLE 0__').cardsVisible === false,
  'duplicate equal visibility markers keep their value'
);
{
  const mimicked = parseMayhemOcrOutput(
    [
      '__OT_CARDS_VISIBLE 0__',
      'Zephyr',
      '__OT_CARDS_VISIBLE 1__',
      '__OT_LINES__{"lines":[]}',
    ].join('\n')
  );
  ok(mimicked.cardsVisible === undefined, 'a marker-shaped OCR line conflicts and fails closed');
  ok(mimicked.text === 'Zephyr', 'marker-shaped OCR lines stay out of text');
}

// (c6) per-slot card-sized evidence decodes with its slot center, invisible to text
{
  const slotMarked = parseMayhemOcrOutput(
    ['__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8,"gap":0}]', 'Zephyr'].join('\n')
  );
  ok(slotMarked.text === 'Zephyr', 'the card-slot marker stays out of the text projection');
  ok(
    slotMarked.cardSlots?.length === 1 &&
      slotMarked.cardSlots[0].x === 0.245 &&
      slotMarked.cardSlots[0].body === 9 &&
      slotMarked.cardSlots[0].rim === 8 &&
      slotMarked.cardSlots[0].gap === 0,
    'per-slot evidence decodes with its normalized center and explicit gap'
  );
}

// (c7) slot markers arrive in the untrusted OCR stream: a marker-shaped line
// can forge high slot counts. Any duplicate/conflicting marker fails closed, and
// a forged slot marker can never flip the coarse flag it needs to be trusted.
ok(
  parseMayhemOcrOutput(
    [
      '__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8,"gap":0}]',
      '__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8,"gap":0}]',
    ].join('\n')
  ).cardSlots === undefined,
  'duplicate slot markers fail closed'
);
ok(
  parseMayhemOcrOutput(
    [
      '__OT_CARD_SLOTS__[{"x":0.245,"body":0,"rim":0,"gap":0}]',
      '__OT_CARD_SLOTS__[{"x":0.33,"body":9,"rim":8,"gap":0},{"x":0.5,"body":9,"rim":8,"gap":0},{"x":0.67,"body":9,"rim":8,"gap":0}]',
    ].join('\n')
  ).cardSlots === undefined,
  'conflicting slot markers fail closed'
);
{
  const forged = parseMayhemOcrOutput(
    [
      '__OT_CARDS_VISIBLE 0__',
      'Zephyr',
      '__OT_CARD_SLOTS__[{"x":0.33,"body":9,"rim":8,"gap":0},{"x":0.5,"body":9,"rim":8,"gap":0},{"x":0.67,"body":9,"rim":8,"gap":0}]',
    ].join('\n')
  );
  ok(forged.cardsVisible === false, 'CARDS_VISIBLE 0 stays false beside a forged slot marker');
  ok(forged.text === 'Zephyr', 'a forged slot marker stays out of the text projection');
}

// (c8) a slot needs an explicitly present, finite gap. Missing/invalid/non-finite
// gap is dropped at parse time, so it can never count as card alignment evidence.
{
  const missing = parseMayhemOcrOutput('__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8}]');
  ok(
    (missing.cardSlots ?? []).length === 0,
    'a slot with no gap is dropped, not defaulted to gap 0'
  );
  const invalid = parseMayhemOcrOutput(
    '__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8,"gap":null},' +
      '{"x":0.5,"body":9,"rim":8,"gap":1e400},{"x":0.67,"body":9,"rim":8,"gap":"0"}]'
  );
  ok(
    (invalid.cardSlots ?? []).length === 0,
    'slots with null/non-finite/string gap are dropped'
  );
  const mixed = parseMayhemOcrOutput(
    '__OT_CARD_SLOTS__[{"x":0.245,"body":9,"rim":8},{"x":0.5,"body":9,"rim":8,"gap":0}]'
  );
  ok(
    (mixed.cardSlots ?? []).length === 1 && mixed.cardSlots?.[0].x === 0.5,
    'gapless slots are dropped while an explicit gap:0 slot survives'
  );
}

// (d) the script emits the marker with boxes when OCR runs on a file
function live(): void {
  if (process.platform !== 'win32') {
    console.log('skip -ImagePath OCR (non-Windows)');
    return;
  }
  const script = path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1');
  const fixture = path.join(root, 'test-fixtures', 'mayhem-ocr', 'three-offers.png');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otc-ocr-lines-'));
  let image = fixture;
  try {
    if (!fs.existsSync(image)) {
      image = path.join(tempDir, 'tiny.png');
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Drawing; ' +
            '$b = New-Object System.Drawing.Bitmap 480, 80; ' +
            '$g = [System.Drawing.Graphics]::FromImage($b); ' +
            '$g.Clear([System.Drawing.Color]::White); ' +
            '$f = New-Object System.Drawing.Font "Arial", 24; ' +
            '$g.DrawString("Jeweled Gauntlet", $f, [System.Drawing.Brushes]::Black, 4, 8); ' +
            `$b.Save('${image}', [System.Drawing.Imaging.ImageFormat]::Png); ` +
            '$g.Dispose(); $f.Dispose(); $b.Dispose()',
        ],
        { stdio: 'pipe' }
      );
    }
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', image],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const line = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith('__OT_LINES__'));
    ok(Boolean(line), 'ps1 -ImagePath emits __OT_LINES__ marker');
    let boxes: MayhemOcrOutput['lines'] = [];
    try {
      const payload = JSON.parse(line ? line.slice('__OT_LINES__'.length) : '') as
        | MayhemOcrOutput['lines']
        | { frame: number[]; lines: MayhemOcrOutput['lines'] };
      // -ImagePath carries an identity frame; a capture carries the crop frame.
      boxes = Array.isArray(payload) ? payload : payload.lines;
    } catch {
      boxes = [];
    }
    ok(Array.isArray(boxes) && boxes.length > 0, 'marker carries at least one box');
    ok(
      boxes.every(
        (b) =>
          b &&
          typeof b.text === 'string' &&
          b.rect &&
          [b.rect.x, b.rect.y, b.rect.w, b.rect.h].every(
            (v) => typeof v === 'number' && v >= 0 && v <= 1
          )
      ),
      'every emitted box is normalized to 0..1'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

live();
if (!process.exitCode) console.log('verify:mayhem-ocr-lines ok');
