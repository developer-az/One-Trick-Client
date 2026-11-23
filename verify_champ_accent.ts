/**
 * verify_champ_accent.ts — the overlay's champion accent.
 *
 * pickAccent() turns a champion's square art into one vivid color that reads on
 * ink. These checks pin the contract:
 *   - a red-dominant image yields a reddish hue with lightness in 55–68%;
 *   - a blue-dominant image yields a bluish hue (the histogram votes, it does
 *     not just average everything into gray);
 *   - black, white, transparent and gray pixels are ignored, and an all-gray
 *     image falls back to the chrome default;
 *   - the soft wash keeps the accent's channels at ~0.14 alpha;
 *   - the overlay root declares both tokens and the renderer applies them.
 *
 * Run: npx --yes tsx verify_champ_accent.ts
 */
import fs from 'node:fs';
import { DEFAULT_ACCENT, accentSoft, pickAccent } from './src/overlay/champAccent';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

/** RGBA buffer from [r, g, b] triples (alpha defaults to 255). */
function rgba(pixels: Array<[number, number, number, number?]>): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b, a], index) => {
    out[index * 4] = r;
    out[index * 4 + 1] = g;
    out[index * 4 + 2] = b;
    out[index * 4 + 3] = a ?? 255;
  });
  return out;
}

function repeat(pixel: [number, number, number, number?], times: number): Array<[number, number, number, number?]> {
  return Array.from({ length: times }, () => pixel);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Independent hex → HSL reader, so the check cannot inherit a module bug. */
function hexToHsl(hex: string): Hsl | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

const LIGHTNESS_MIN = 0.55;
const LIGHTNESS_MAX = 0.68;

console.log('--- verify:champ-accent: dominant hue + lightness ---');
const redImage = rgba([...repeat([190, 30, 24], 12), ...repeat([30, 30, 32], 3)]);
const red = pickAccent(redImage);
const redHsl = hexToHsl(red);
ok(!!redHsl, `red-dominant image returns a hex color (${red})`);
ok(!!redHsl && (redHsl.h <= 30 || redHsl.h >= 330), `red-dominant image stays in the red hue band (hue ${redHsl?.h.toFixed(1)})`);
ok(
  !!redHsl && redHsl.l >= LIGHTNESS_MIN && redHsl.l <= LIGHTNESS_MAX,
  `accent lightness is clamped to 55–68% (got ${redHsl ? (redHsl.l * 100).toFixed(1) : '?'}%)`
);

const blueImage = rgba(repeat([26, 95, 224], 16));
const blue = pickAccent(blueImage);
const blueHsl = hexToHsl(blue);
ok(!!blueHsl && blueHsl.h >= 200 && blueHsl.h <= 260, `blue-dominant image stays blue (hue ${blueHsl?.h.toFixed(1)})`);
ok(
  !!blueHsl && blueHsl.l >= LIGHTNESS_MIN && blueHsl.l <= LIGHTNESS_MAX,
  `blue accent lightness also lands in 55–68% (got ${blueHsl ? (blueHsl.l * 100).toFixed(1) : '?'}%)`
);

/* A very dark vivid red must be lifted onto the ink, not returned as #3a0503. */
const darkRed = pickAccent(rgba(repeat([106, 10, 6], 16)));
const darkRedHsl = hexToHsl(darkRed);
ok(
  !!darkRedHsl && darkRedHsl.l >= LIGHTNESS_MIN,
  `near-black vivid red is lifted to readable lightness (${((darkRedHsl?.l ?? 0) * 100).toFixed(1)}%)`
);

console.log('--- verify:champ-accent: ignores black / white / gray / clear ---');
ok(pickAccent(rgba(repeat([128, 128, 128], 20))) === DEFAULT_ACCENT, 'all-gray image falls back to chrome');
ok(pickAccent(rgba(repeat([0, 0, 0], 20))) === DEFAULT_ACCENT, 'all-black image falls back to chrome');
ok(pickAccent(rgba(repeat([255, 255, 255], 20))) === DEFAULT_ACCENT, 'all-white image falls back to chrome');
ok(pickAccent(rgba(repeat([120, 124, 120], 20))) === DEFAULT_ACCENT, 'near-gray image falls back to chrome');
ok(
  pickAccent(rgba([...repeat([190, 30, 24], 8), ...repeat([0, 0, 0], 8), ...repeat([255, 255, 255], 8)])) !==
    DEFAULT_ACCENT,
  'black/white pixels do not outvote the vivid pixels'
);
ok(
  pickAccent(rgba(repeat([190, 30, 24, 0], 16))) === DEFAULT_ACCENT,
  'fully transparent pixels are ignored'
);
ok(pickAccent(new Uint8Array(0)) === DEFAULT_ACCENT, 'an empty buffer falls back to chrome');
ok(DEFAULT_ACCENT === '#c9ced6', 'default accent is chrome silver');

console.log('--- verify:champ-accent: wash + wiring ---');
const soft = accentSoft('#c81e18');
ok(/^rgba\(200, 30, 24, 0\.14\)$/.test(soft), `accentSoft keeps the accent channels at 0.14 alpha (${soft})`);
ok(accentSoft('not-a-color') === 'rgba(201, 206, 214, 0.14)', 'accentSoft falls back to the chrome wash');

const css = fs.readFileSync('src/overlay/overlay-theme.css', 'utf8');
ok(/--ov-champ:\s*#c9ced6/.test(css), 'overlay root declares --ov-champ (chrome default)');
ok(/--ov-champ-soft:\s*rgba\(201, 206, 214, 0\.14\)/.test(css), 'overlay root declares --ov-champ-soft at 0.14');
ok(/var\(--ov-champ\)/.test(css), 'panels consume var(--ov-champ)');

const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
ok(app.includes('resolveChampionAccent'), 'OverlayApp resolves the champion accent');
ok(app.includes("setProperty('--ov-champ'"), 'OverlayApp sets --ov-champ on the overlay root');
ok(app.includes("setProperty('--ov-champ-soft'"), 'OverlayApp sets --ov-champ-soft on the overlay root');

const accentModule = fs.readFileSync('src/overlay/champAccent.ts', 'utf8');
ok(accentModule.includes('localStorage'), 'accent is cached in localStorage');
ok(/const memoryCache = new Map/.test(accentModule), 'accent is cached in memory');
ok(!/backdrop-filter|filter:\s*blur/.test(accentModule), 'accent module uses no blur');

if (failures) {
  console.error(`verify:champ-accent FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:champ-accent ok');
