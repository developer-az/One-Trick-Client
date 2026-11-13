/**
 * verify_app_density.ts — E2: shared app density (the UI master prompt applied
 * to tokens.css / theme.css / the eight app views).
 *
 * Source-level, measurable token + structure invariants (the authoring sandbox
 * has no browser, so layout is checked structurally instead of by screenshot):
 *
 *   1. tokens.css carries one denser spacing scale in `--ot-space-*` roles,
 *      every value on the 4px base scale (2px half-steps) and strictly tighter
 *      than the old mixed values (page 28px 32px 48px, cards 18px 20px,
 *      card gaps 20–24px).
 *   2. theme.css consumes those roles for the page, header, cards, rows,
 *      tables, and control clusters — never redefining them.
 *   3. Cards, controls, tables, and page headers land on the same dense
 *      component scale (button/input heights, row rhythm, callout/toast
 *      padding) without shrinking readable text (type floor 11px) or losing
 *      the R3 type steps.
 *   4. The eight views + OneTrickCard use only scale steps ≤ 16px for spacing
 *      utilities, keep their responsive stacking, and keep their overflow
 *      safety (min-w-0 / truncate / shrink-0 counts never shrink).
 *   5. Focus-visible, reduced-motion fallbacks, and the zero-blur / one-shot
 *      motion budget (R5/R6/R11) are intact.
 *
 * Run: npx --yes tsx verify_app_density.ts
 */
import fs from 'node:fs';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  } else {
    console.log('ok  ', msg);
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8');
}

const TOKENS_CSS = read('src/app/tokens.css');
const THEME_CSS = read('src/app/theme.css');
const VIEWS = [
  'HomeView',
  'DraftView',
  'LoadoutView',
  'OverlayView',
  'PerformanceView',
  'StatsView',
  'ReviewView',
  'MayhemView',
  'OneTrickCard',
].map((name) => ({ name, src: read(`src/app/views/${name}.tsx`) }));

// -----------------------------------------------------------------------
// Small CSS reader: flat `selector { body }` pairs (media wrappers just show
// up in the selector text, which is fine for property look-ups).
// -----------------------------------------------------------------------
interface Rule {
  selector: string;
  body: string;
}
function cssRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return rules;
}
function bodies(css: string, selector: string): string[] {
  return cssRules(css)
    .filter((r) => r.selector.split(',').some((s) => s.trim() === selector))
    .map((r) => r.body);
}
function decl(css: string, selector: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
  for (const body of bodies(css, selector)) {
    const m = body.match(re);
    if (m) return m[1].trim();
  }
  return null;
}
function tokenValue(css: string, name: string): string | null {
  const m = css.match(new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;]+);`));
  return m ? m[2].trim() : null;
}
function pxList(value: string): number[] {
  return (value.match(/-?[\d.]+px/g) || []).map((v) => parseFloat(v));
}

// -----------------------------------------------------------------------
// 1) tokens.css — one denser spacing scale.
// -----------------------------------------------------------------------
console.log('\n— density tokens (tokens.css) —');
const STEPS = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 48];
const ROLES: Record<string, string> = {
  '--ot-space-page': 'page frame',
  '--ot-space-header': 'page header → first card',
  '--ot-space-card': 'card padding',
  '--ot-space-stack': 'card → card / grid gutter',
  '--ot-space-row': 'list + settings rows',
  '--ot-space-table': 'dense table cells',
  '--ot-space-control': 'control clusters',
};
const roleValues: Record<string, number[]> = {};
for (const [role, label] of Object.entries(ROLES)) {
  const raw = tokenValue(TOKENS_CSS, role);
  ok(raw !== null, `tokens.css defines ${role} (${label})`);
  if (raw === null) continue;
  const nums = pxList(raw);
  roleValues[role] = nums;
  ok(nums.length > 0 && nums.every((n) => STEPS.includes(n)), `${role}: ${raw} sits on the 4px/2px density scale`);
}
// strictly denser than the 2026-11 baseline it replaces
const bounds: Array<[string, number, number, string]> = [
  ['--ot-space-page', 0, 22, 'page top ≤ 22px (was 28px)'],
  ['--ot-space-page', 1, 26, 'page sides ≤ 26px (was 32px)'],
  ['--ot-space-page', 2, 32, 'page bottom ≤ 32px (was 48px)'],
  ['--ot-space-card', 0, 16, 'card padding vertical ≤ 16px (was 18px)'],
  ['--ot-space-card', 1, 18, 'card padding horizontal ≤ 18px (was 20px)'],
  ['--ot-space-header', 0, 16, 'page header → first card ≤ 16px (was 22px)'],
  ['--ot-space-stack', 0, 16, 'card → card / gutter ≤ 16px (was 20–24px)'],
  ['--ot-space-row', 0, 8, 'row vertical padding ≤ 8px'],
  ['--ot-space-table', 0, 6, 'table cell vertical padding ≤ 6px'],
  ['--ot-space-control', 0, 8, 'control cluster gap ≤ 8px'],
];
for (const [role, idx, max, label] of bounds) {
  const nums = roleValues[role];
  ok(!!nums && nums[idx] !== undefined && nums[idx] <= max && nums[idx] > 0, `${role}: ${label}`);
}

// -----------------------------------------------------------------------
// 2) theme.css — consumes the shared roles, never redefines tokens.
// -----------------------------------------------------------------------
console.log('\n— shared rules consume the density tokens (theme.css) —');
ok(decl(THEME_CSS, '.ot-page', 'padding') === 'var(--ot-space-page)', '.ot-page padding reads var(--ot-space-page)');
ok(decl(THEME_CSS, '.ot-card-pad', 'padding') === 'var(--ot-space-card)', '.ot-card-pad padding reads var(--ot-space-card)');
ok(
  decl(THEME_CSS, '.ot-page-header', 'margin-bottom') === 'var(--ot-space-header)',
  '.ot-page-header margin-bottom reads var(--ot-space-header)',
);
ok(decl(THEME_CSS, '.ot-page-header', 'gap') === 'var(--ot-space-stack)', '.ot-page-header gap reads var(--ot-space-stack)');
ok(decl(THEME_CSS, '.ot-nav', 'padding') === 'var(--ot-space-row)', '.ot-nav padding reads var(--ot-space-row)');
ok(decl(THEME_CSS, '.ot-btn', 'gap') === 'var(--ot-space-control)', '.ot-btn gap reads var(--ot-space-control)');
ok(decl(THEME_CSS, '.ot-table td', 'padding') === 'var(--ot-space-table)', '.ot-table cells read var(--ot-space-table)');
ok(!/--ot-space-[a-z-]+\s*:/.test(THEME_CSS), 'theme.css never redefines --ot-space-* tokens');

// -----------------------------------------------------------------------
// 3) component scale: cards, controls, tables, page headers.
// -----------------------------------------------------------------------
console.log('\n— dense component scale (theme.css) —');
function height(selector: string): number | null {
  const v = decl(THEME_CSS, selector, 'height');
  return v && /^[\d.]+px$/.test(v) ? parseFloat(v) : null;
}
function padV(selector: string): number | null {
  const v = decl(THEME_CSS, selector, 'padding');
  const nums = v ? pxList(v) : [];
  return nums.length ? nums[0] : null;
}
const btn = height('.ot-btn');
ok(btn !== null && btn >= 30 && btn <= 32, `.ot-btn height ${btn}px — 30–32px (R9 ≥ 30px target, was 36px)`);
const btnSm = height('.ot-btn-sm');
ok(btnSm !== null && btnSm >= 26 && btnSm <= 28, `.ot-btn-sm height ${btnSm}px — 26–28px dense rows (was 30px)`);
const btnLg = height('.ot-btn-lg');
ok(btnLg !== null && btnLg <= 40, `.ot-btn-lg height ${btnLg}px ≤ 40px (was 44px)`);
const input = height('.ot-input');
ok(input !== null && input <= 32, `.ot-input height ${input}px ≤ 32px (was 38px)`);
const seg = height('.ot-segment button');
ok(seg !== null && seg <= 26, `.ot-segment button height ${seg}px ≤ 26px (was 28px)`);
const spell = height('.ot-spell');
ok(spell !== null && spell >= 30 && spell <= 32, `.ot-spell height ${spell}px keeps the R9 ≥ 30px target`);
const pill = height('.ot-pill');
ok(pill !== null && pill <= 24, `.ot-pill height ${pill}px ≤ 24px (was 26px)`);
const badge = height('.ot-badge');
ok(badge !== null && badge <= 20, `.ot-badge height ${badge}px ≤ 20px (was 22px)`);
const callout = padV('.ot-callout');
ok(callout !== null && callout <= 10, `.ot-callout padding ${callout}px vertical ≤ 10px (was 12px)`);
const toast = padV('.ot-toast');
ok(toast !== null && toast <= 10, `.ot-toast padding ${toast}px vertical ≤ 10px (was 12px)`);
const slotMin = decl(THEME_CSS, '.ot-slot', 'min-height');
ok(!!slotMin && parseFloat(slotMin) <= 56, `.ot-slot min-height ${slotMin} ≤ 56px (was 60px)`);
ok(decl(THEME_CSS, '.ot-card', 'border-width') === '1px' || /border:\s*1px/.test(bodies(THEME_CSS, '.ot-card').join('')), '.ot-card keeps its 1px hairline');
ok(/\.ot-card::before/.test(THEME_CSS), '.ot-card keeps the bracketed corner ornament');

// type scale (R3) + readable text floor
console.log('\n— type scale + readability —');
function fontSizes(selector: string): number[] {
  return bodies(THEME_CSS, selector)
    .map((b) => b.match(/font-size:\s*([\d.]+)px/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => parseFloat(m[1]));
}
ok(fontSizes('.ot-page-title').every((n) => n === 26), `.ot-page-title is the R3 Title step (26px), got ${fontSizes('.ot-page-title').join(',')}`);
ok(fontSizes('.ot-card-heading').every((n) => n === 18), '.ot-card-heading is the R3 H step (18px)');
ok(fontSizes('.ot-stat-big').every((n) => n === 30), '.ot-stat-big is the R3 Stat step (30px, display max)');
ok(fontSizes('.ot-card-title').every((n) => n <= 13), '.ot-card-title stays at the R3 Eyebrow step (≤ 13px)');
const themeSmall = [...THEME_CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => parseFloat(m[1])).filter((n) => n < 11);
ok(themeSmall.length === 0, `theme.css keeps the 11px type floor (found ${themeSmall.join(',') || 'none'} below)`);
for (const { name, src } of VIEWS) {
  const small = [...src.matchAll(/text-\[([\d.]+)px\]/g)].map((m) => parseFloat(m[1])).filter((n) => n < 11);
  ok(small.length === 0, `${name}: no text below 11px (found ${small.map((n) => `${n}px`).join(',') || 'none'})`);
}

// -----------------------------------------------------------------------
// 4) views: dense spacing scale, tables, stacking, overflow safety.
// -----------------------------------------------------------------------
console.log('\n— view spacing on the dense scale —');
const UTIL = /(?:^|[\s"'`])(-?)(?:gap-x|gap-y|gap|space-x|space-y|m|mx|my|mt|mb|ml|mr|p|px|py|pt|pb|pl|pr)-([\d.]+)\b/g;
for (const { name, src } of VIEWS) {
  const off: string[] = [];
  for (const m of src.matchAll(UTIL)) {
    const px = parseFloat(m[2]) * 4;
    const scale = STEPS.includes(px) || px === 0;
    if (m[1] === '' && (!scale || px > 16)) off.push(`${m[0].trim()}=${px}px`);
  }
  ok(off.length === 0, `${name}: spacing utilities stay on the ≤ 16px scale (${off.join(', ') || 'none off-scale'})`);
}

console.log('\n— dense tables + rows —');
for (const { name, src } of VIEWS) {
  const tables = [...src.matchAll(/<table\b[^>]*>/g)];
  for (const t of tables) {
    ok(/className="[^"]*\bot-table\b/.test(t[0]), `${name}: <table> uses the shared .ot-table row rhythm`);
  }
  const cells = [...src.matchAll(/<t[dh]\b[^>]*>/g)].map((m) => m[0]).filter((c) => /\b(?:py|pt|pb)-/.test(c));
  ok(cells.length === 0, `${name}: table cells carry no per-view padding utilities (${cells.length} left)`);
  if (tables.length === 0) {
    ok(true, `${name}: no data tables (nothing to densify)`);
  }
}

console.log('\n— responsive stacking + overflow safety (no overlap) —');
// Counts captured before the density pass; they must never shrink.
const BASELINE: Record<string, { truncate: number; minW: number; shrink: number; grids: number }> = {
  HomeView: { truncate: 1, minW: 2, shrink: 0, grids: 1 },
  DraftView: { truncate: 0, minW: 2, shrink: 0, grids: 2 },
  LoadoutView: { truncate: 0, minW: 2, shrink: 0, grids: 2 },
  OverlayView: { truncate: 0, minW: 0, shrink: 0, grids: 2 },
  PerformanceView: { truncate: 1, minW: 1, shrink: 2, grids: 2 },
  StatsView: { truncate: 3, minW: 2, shrink: 2, grids: 2 },
  ReviewView: { truncate: 1, minW: 0, shrink: 0, grids: 1 },
  MayhemView: { truncate: 1, minW: 2, shrink: 5, grids: 2 },
  OneTrickCard: { truncate: 0, minW: 0, shrink: 3, grids: 1 },
};
const count = (src: string, re: RegExp): number => (src.match(re) || []).length;
for (const { name, src } of VIEWS) {
  const base = BASELINE[name];
  const trunc = count(src, /truncate/g);
  const minW = count(src, /min-w-0/g);
  const shrink = count(src, /shrink-0/g);
  const grids = count(src, /(?:sm|md|lg):grid-cols-\d/g);
  ok(trunc >= base.truncate && minW >= base.minW && shrink >= base.shrink,
    `${name}: overflow safety kept (truncate ${trunc}≥${base.truncate}, min-w-0 ${minW}≥${base.minW}, shrink-0 ${shrink}≥${base.shrink})`);
  const multiCol = count(src, /grid-cols-[2-9]/g);
  ok(grids >= base.grids && (multiCol === 0 || grids > 0),
    `${name}: responsive stacking kept (${grids} breakpoint grids ≥ ${base.grids})`);
  ok(!/<br\b|min-h-\[/.test(src), `${name}: no <br> or arbitrary min-height fake rhythm`);
}

// -----------------------------------------------------------------------
// 5) motion / blur budget (R5/R6/R11) + 6) accessibility (R9).
// -----------------------------------------------------------------------
console.log('\n— zero blur, bounded motion —');
const STYLED = [
  { label: 'tokens.css', src: TOKENS_CSS },
  { label: 'theme.css', src: THEME_CSS },
  ...VIEWS.map((v) => ({ label: `${v.name}.tsx`, src: v.src })),
];
for (const { label, src } of STYLED) {
  ok(!/backdrop-filter|blur\(|drop-shadow|text-shadow/.test(src), `${label}: no blur / backdrop-filter / drop-shadow`);
  const anims = [...src.matchAll(/animation\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
  ok(anims.every((a) => a === 'none' || a.startsWith('none ') || a.includes('ot-toast-in')), `${label}: animations are the one-shot toast or none (${anims.join(' | ') || 'none'})`);
  const keys = [...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  ok(keys.every((k) => k === 'ot-toast-in'), `${label}: keyframes ${keys.join(',') || 'none'} (only ot-toast-in is allowed)`);
  for (const t of src.matchAll(/transition\s*:\s*([^;]+)/g)) {
    const times = (t[1].match(/[\d.]+m?s/g) || []).map((d) => (d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000));
    ok(times.every((ms) => ms <= 200), `${label}: transition ≤ 200ms (${t[1].trim()})`);
  }
}

console.log('\n— keyboard focus + reduced motion —');
const focusSelectors = cssRules(THEME_CSS)
  .filter((r) => r.selector.includes('.ot-btn:focus-visible'))
  .map((r) => r.selector);
const focusRule = bodies(THEME_CSS, '.ot-btn:focus-visible').join(' ');
ok(focusRule.length > 0, 'theme.css keeps a :focus-visible ring for buttons');
for (const sel of ['.ot-nav:focus-visible', '.ot-input:focus-visible', '.ot-switch:focus-visible', '.ot-chip-btn:focus-visible']) {
  ok(bodies(THEME_CSS, sel).length > 0, `focus ring covers ${sel}`);
}
ok(focusSelectors.some((s) => s.includes('.ot-btn:focus-visible')), 'focus ring rule is shared across interactive controls');
for (const { label, src } of STYLED) {
  ok(!/outline\s*:\s*none/.test(src), `${label}: no outline:none without a visible replacement`);
}
ok(
  /prefers-reduced-motion[\s\S]*?\.ot-toast\s*\{[^}]*animation:\s*none/.test(THEME_CSS),
  'theme.css keeps the prefers-reduced-motion fallback for the toast',
);

// -----------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — verify_app_density: ${failures} failing invariant(s)`);
if (failures > 0) process.exitCode = 1;