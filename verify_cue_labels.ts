import { compactCueLabel } from './src/overlay/overlayLogic';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

// Short labels pass through untouched.
const short = 'Rotate to the wave';
ok(short.length === 18, 'fixture is exactly 18 chars');
ok(compactCueLabel(short) === short, '18-char label unchanged');

// Long labels cut at a word boundary, never mid-word.
const long = 'Rotate to the objective and sweep';
const cut = compactCueLabel(long);
ok(cut.length <= 18, `long label cut to <=18 chars (${cut.length})`);
ok(long.startsWith(cut), 'long label is a prefix of the original');
ok(long[cut.length] === ' ', 'long label ends at a word boundary');
ok(!/[.,;:!?-]$/.test(cut), 'long label has no trailing punctuation');

// A single long word gets the ellipsis instead of a mid-word cut.
const word = 'A'.repeat(25);
const clipped = compactCueLabel(word);
ok(clipped.endsWith('\u2026'), 'single long word ends with an ellipsis');
ok(clipped.length <= 18, `single long word fits <=18 chars (${clipped.length})`);

// Trailing punctuation at the cut point is trimmed.
const punctuated = compactCueLabel('Ready, set, go! now please');
ok(punctuated === 'Ready, set, go', `trailing punctuation trimmed (${punctuated})`);

// Empty stays empty.
ok(compactCueLabel('') === '', 'empty label stays empty');
