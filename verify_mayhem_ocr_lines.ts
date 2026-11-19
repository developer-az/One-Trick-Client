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
