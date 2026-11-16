/**
 * verify_client_revamp.ts — brief G: ornate gothic framing + champion-driven
 * shell, layout presets and ornament intensity.
 *
 * Runs in plain Node (no browser) and checks three layers:
 *
 *   1. Persisted appearance contract (electron/app-settings.ts): defaults for
 *      mainChampion / layoutPreset / ornament, clamping, enum validation,
 *      migration from old settings without the new fields.
 *   2. Renderer mirror parity (src/app/hooks.ts appearanceCssMap) plus the
 *      ornament threshold buckets and the main-champion resolution helper.
 *   3. Static CSS/structure invariants from the UI master prompt (R5/R6/R9/R11
 *      + amendment B2): no blur, no loops, <=200ms transitions, reduced-motion
 *      fallback, ink-scrimmed banner text, .ot-orn-* class prefix, masked
 *      .ot-splash reuse, keyboard-capable picker wiring.
 *
 * Run: npx --yes tsx verify_client_revamp.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`ok   - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

function deepEqual(name: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepStrictEqual(actual, expected);
    check(name, true);
  } catch (e) {
    check(`${name}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)} (${(e as Error).message})`, false);
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8');
}

interface Rule {
  selector: string;
  body: string;
}
function cssRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return rules;
}
function rulesFor(css: string, selector: string): Rule[] {
  return cssRules(css).filter((r) => r.selector.split(',').some((s) => s.trim() === selector));
}
function decl(css: string, selector: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
  for (const rule of rulesFor(css, selector)) {
    const m = rule.body.match(re);
    if (m) return m[1].trim();
  }
  return null;
}
function tokenValue(css: string, name: string): string | null {
  const m = css.match(new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;]+);`));
  return m ? m[2].trim() : null;
}
function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (i: number): number => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-client-revamp-'));
  process.env.ONETRICK_USER_DATA = dir;
  const settingsFile = path.join(dir, 'app-settings.json');
  // Old-format file: no appearance, no champion fields at all.
  fs.writeFileSync(settingsFile, JSON.stringify({ overlayEnabled: false, autoImport: true, gpuAcceleration: false }));

  const appSettings = await import('./electron/app-settings');
  const {
    APPEARANCE_DEFAULTS,
    APPEARANCE_ACCENTS,
    APPEARANCE_LAYOUTS,
    appearanceToCss,
    clampOrnament,
    loadAppSettings,
    normalizeMainChampion,
    ornamentLevel,
    updateAppSettings,
    getAppSettings,
    flushAppSettings,
  } = appSettings;
  const hooks = await import('./src/app/hooks');
  const { appearanceCssMap, ornamentBucket, mainChampionId } = hooks;

  /* ------------------------------------------------------------------ 1 */
  console.log('\n— appearance contract —');
  check('defaults: mainChampion is empty (follows most-played)', APPEARANCE_DEFAULTS.mainChampion === '');
  check('defaults: layoutPreset is compact', APPEARANCE_DEFAULTS.layoutPreset === 'compact');
  check('defaults: ornament is 50', APPEARANCE_DEFAULTS.ornament === 50);
  check('accents include champion', (APPEARANCE_ACCENTS as string[]).includes('champion'));
  deepEqual('layout presets are compact/showcase', APPEARANCE_LAYOUTS, ['compact', 'showcase']);

  const migrated = loadAppSettings();
  check('migration: old file keeps known booleans', migrated.overlayEnabled === false && migrated.autoImport === true);
  deepEqual('migration: no appearance falls back to all defaults', migrated.appearance, APPEARANCE_DEFAULTS);
  check(
    'migration: new fields default on an old appearance object',
    (() => {
      updateAppSettings({ appearance: { theme: 'ember', accent: 'teal', density: 'compact', radius: 10, glass: 20, fontScale: 1.1 } });
      const a = getAppSettings().appearance;
      return a.theme === 'ember' && a.accent === 'teal' && a.mainChampion === '' && a.layoutPreset === 'compact' && a.ornament === 50;
    })()
  );

  check('ornament clamps above 100', clampOrnament(999) === 100);
  check('ornament clamps below 0', clampOrnament(-20) === 0);
  check('ornament rounds to integer', clampOrnament(50.4) === 50 && clampOrnament(50.6) === 51);
  check('ornament invalid falls back to 50', clampOrnament(Number.NaN) === 50 && clampOrnament(Number.POSITIVE_INFINITY) === 50);
  check('ornament accepts numeric strings via normalize', (() => {
    updateAppSettings({ appearance: { ornament: '70' } });
    return getAppSettings().appearance.ornament === 70;
  })());
  updateAppSettings({ appearance: { ornament: -5 } });
  check('persisted ornament clamps to 0', getAppSettings().appearance.ornament === 0);
  updateAppSettings({ appearance: { ornament: 400 } });
  check('persisted ornament clamps to 100', getAppSettings().appearance.ornament === 100);
  updateAppSettings({ appearance: { ornament: null } });
  check('null ornament falls back to the 50 default', getAppSettings().appearance.ornament === 50);

  check('mainChampion: valid Data Dragon id kept', normalizeMainChampion('AurelionSol') === 'AurelionSol');
  check('mainChampion: whitespace trimmed', normalizeMainChampion('  Ahri  ') === 'Ahri');
  check('mainChampion: markup/characters rejected', normalizeMainChampion('Ah<ri>') === '' && normalizeMainChampion('../x') === '');
  check('mainChampion: non-string rejected', normalizeMainChampion(103 as unknown as string) === '');
  check('mainChampion: overlong id rejected', normalizeMainChampion('A'.repeat(41)) === '');

  updateAppSettings({ appearance: { mainChampion: 'Ahri', layoutPreset: 'showcase', ornament: 100, accent: 'champion' } });
  const chosen = getAppSettings().appearance;
  check('valid new fields round-trip', chosen.mainChampion === 'Ahri' && chosen.layoutPreset === 'showcase' && chosen.ornament === 100 && chosen.accent === 'champion');
  updateAppSettings({ appearance: { layoutPreset: 'huge' as unknown as AppearanceLayout, accent: 'weird' as unknown as AppearanceAccent } });
  const rejected = getAppSettings().appearance;
  check('invalid layoutPreset falls back to compact', rejected.layoutPreset === 'compact');
  check('invalid accent falls back to chrome', rejected.accent === 'chrome');
  check('partial invalid patch keeps the main champion', rejected.mainChampion === 'Ahri');

  /* ------------------------------------------------------------------ 2 */
  console.log('\n— renderer mirror + thresholds —');
  const cases: AppearanceSettings[] = [
    { ...APPEARANCE_DEFAULTS },
    { ...APPEARANCE_DEFAULTS, accent: 'champion', mainChampion: 'Ahri', layoutPreset: 'showcase', ornament: 100 },
    { ...APPEARANCE_DEFAULTS, accent: 'royal', mainChampion: 'Pyke', layoutPreset: 'compact', ornament: 0 },
    { ...APPEARANCE_DEFAULTS, theme: 'azure', density: 'spacious', radius: 18, glass: 45, fontScale: 1.15, mainChampion: 'Yone', layoutPreset: 'showcase', ornament: 75 },
  ];
  for (const [i, app] of cases.entries()) {
    deepEqual(`appearanceToCss ↔ appearanceCssMap parity (case ${i + 1})`, appearanceToCss(app), appearanceCssMap(app));
  }
  deepEqual('mapping: ornament 0 bucket + var', appearanceToCss({ ...APPEARANCE_DEFAULTS, ornament: 0 }).vars['--ot-ornament'], '0');
  check('mapping: ornament 0 is the none bucket', appearanceToCss({ ...APPEARANCE_DEFAULTS, ornament: 0 }).attributes['data-ot-ornament'] === 'none');
  check('mapping: ornament 50 is the light bucket', appearanceToCss({ ...APPEARANCE_DEFAULTS, ornament: 50 }).attributes['data-ot-ornament'] === 'light');
  check('mapping: ornament 100 is the full bucket', appearanceToCss({ ...APPEARANCE_DEFAULTS, ornament: 100 }).attributes['data-ot-ornament'] === 'full');
  check('mapping: layout attribute present', appearanceToCss({ ...APPEARANCE_DEFAULTS, layoutPreset: 'showcase' }).attributes['data-ot-layout'] === 'showcase');

  check('threshold: 0 = none', ornamentLevel(0) === 'none');
  check('threshold: 1 = light', ornamentLevel(1) === 'light');
  check('threshold: 74 = light', ornamentLevel(74) === 'light');
  check('threshold: 75 = full', ornamentLevel(75) === 'full');
  check('threshold: 100 = full', ornamentLevel(100) === 'full');
  check('threshold: invalid = default light', ornamentLevel(Number.NaN) === 'light');
  let thresholdMismatch = '';
  for (let v = 0; v <= 100; v += 5) {
    if (ornamentLevel(v) !== ornamentBucket(v)) thresholdMismatch = `${v}: ${ornamentLevel(v)} vs ${ornamentBucket(v)}`;
  }
  check(`thresholds: renderer bucket mirrors app-settings for 0..100 ${thresholdMismatch}`, thresholdMismatch === '');

  const catalog = [
    { id: 'Ahri', key: '103' },
    { id: 'Katarina', key: '55' },
    { id: 'Pyke', key: '555' },
  ];
  const game = (championId: number, at: number): MatchSummary => ({
    gameId: at,
    at,
    durationSec: 1800,
    queueId: 420,
    championId,
    win: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    role: 'Mid',
  });
  check(
    'main champion defaults to the most-played champion',
    mainChampionId({ ...APPEARANCE_DEFAULTS }, [game(103, 1), game(55, 2), game(103, 3)], catalog) === 'Ahri'
  );
  check(
    'most-played tie resolves to the most recent game',
    mainChampionId({ ...APPEARANCE_DEFAULTS }, [game(55, 9), game(103, 4)], catalog) === 'Katarina'
  );
  check(
    'explicit main champion wins over history',
    mainChampionId({ ...APPEARANCE_DEFAULTS, mainChampion: 'Pyke' }, [game(103, 9)], catalog) === 'Pyke'
  );
  check('no history and no choice = no champion', mainChampionId({ ...APPEARANCE_DEFAULTS }, null, catalog) === '');
  check(
    'unknown numeric key resolves to none',
    mainChampionId({ ...APPEARANCE_DEFAULTS }, [game(9999, 1)], catalog) === ''
  );

  /* ------------------------------------------------------------------ 3 */
  console.log('\n— CSS + structure (R5/R6/R9/R11, B2) —');
  const tokens = read('src/app/tokens.css');
  const theme = read('src/app/theme.css');
  const ornaments = read('src/app/ornaments.tsx');
  const appTsx = read('src/app/App.tsx');
  const homeView = read('src/app/views/HomeView.tsx');
  const ui = read('src/app/ui.tsx');
  // Brief J shell pieces the superceded shell checks now read.
  const orbitNav = read('src/app/OrbitNav.tsx');
  const pinnedChampions = read('src/app/PinnedChampions.tsx');

  check('tokens.css defines --ot-champ', !!tokenValue(tokens, '--ot-champ'));
  check('tokens.css defines --ot-champ-soft', !!tokenValue(tokens, '--ot-champ-soft'));
  check('tokens.css defines --ot-ornament default', tokenValue(tokens, '--ot-ornament') === '0.5');

  // No blur anywhere in the client CSS except the grandfathered glass layer,
  // which only applies while the user turns glass on.
  const appCss = `${tokens}\n${theme}`;
  check('no filter: blur() in app CSS', !/(^|[;\s])filter\s*:\s*blur\(/i.test(appCss));
  const backdropRules = cssRules(theme).filter((r) => /backdrop-filter/i.test(r.body));
  check('backdrop-filter exists only in the opt-in glass layer', backdropRules.length > 0 && backdropRules.every((r) => r.selector.includes('data-ot-glass-on')));
  check('no backdrop-filter in the new ornament module', !/backdropFilter|backdrop-filter/i.test(ornaments));

  // Motion budget: nothing loops, transitions <=200ms, one-shot fade <=300ms.
  const appCssNoComments = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
  check('no infinite animation in app CSS', !/infinite/i.test(appCssNoComments));
  const durations = (appCss.match(/transition:[^;]+;/g) || []).flatMap((d) =>
    (d.match(/([0-9.]+)(m?s)/g) || []).map((v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000))
  );
  check(`transitions are <=200ms (max ${Math.max(0, ...durations)}ms)`, durations.every((d) => d <= 200));
  const animations = (appCss.match(/animation:[^;]+;/g) || []).filter((a) => !/none/.test(a));
  const animMs = animations.flatMap((d) =>
    (d.match(/([0-9.]+)(m?s)/g) || []).map((v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000))
  );
  check(`animations are one-shot and <=300ms (max ${Math.max(0, ...animMs)}ms)`, animMs.every((d) => d <= 300));
  const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ot-orn-strip\s*\{[^}]*transition\s*:\s*none/.test(theme);
  check('reduced motion keeps ornament transitions off', reduced);

  // Banner: masked splash reused, gradient scrim, ink plate behind text.
  check('banner reuses the existing masked .ot-splash', !!decl(theme, '.ot-orn-strip .ot-splash img', 'mask-image') || /\.ot-orn-strip \.ot-splash img/.test(theme));
  check('.ot-hero is not redefined (B2)', rulesFor(theme, '.ot-hero').length === 1);
  check('the ornament layer adds no animation of its own', !/animation:[^;]*ot-orn/.test(appCssNoComments));
  const heroScrim = decl(theme, '.ot-orn-hero-scrim', 'background') || '';
  const stripScrim = decl(theme, '.ot-orn-strip-scrim', 'background') || '';
  check('hero art darkens with a linear-gradient scrim', /linear-gradient/.test(heroScrim));
  check('strip art darkens with a linear-gradient scrim', /linear-gradient/.test(stripScrim));
  const stripTextBg = decl(theme, '.ot-orn-strip-text', 'background') || '';
  const plateAlpha = Number((stripTextBg.match(/var\(--ot-bg\)\s*(\d+)%/) || [])[1] || '0');
  check(`banner copy sits on an ink plate >= 60% (got ${plateAlpha}%)`, plateAlpha >= 60);
  check('banner copy uses --ot-text on the plate', decl(theme, '.ot-orn-strip-name', 'color') === 'var(--ot-text)');
  const lightText = tokenValue(tokens, '--ot-text') || '#e9ebef';
  const ink = tokenValue(tokens, '--ot-bg') || '#0a0a0c';
  const ratio = contrast(lightText, ink);
  check(`banner text contrast >= 4.5:1 (${ratio.toFixed(1)}:1)`, ratio >= 4.5);

  // Ornament layer: bucket rules and class prefix.
  const ornamentClasses = Array.from(theme.matchAll(/\.(ot-orn-[a-z-]+)/g)).map((m) => m[1]);
  check('ornament classes all use the .ot-orn-* prefix (B2)', ornamentClasses.length > 5 && ornamentClasses.every((c) => c.startsWith('ot-orn-')));
  check('ornament 0 hides the crest/filigree layers', cssRules(theme).some((r) => r.selector.includes("[data-ot-ornament='none']") && r.selector.includes('.ot-orn-crest') && /display\s*:\s*none/.test(r.body)));
  check('ornament 50 keeps the light filigree layer', cssRules(theme).some((r) => r.selector.includes("[data-ot-ornament='light']") && r.selector.includes('.ot-orn-filigree')));
  check('ornament 100 adds the card corner flourish', cssRules(theme).some((r) => r.selector.includes("[data-ot-ornament='full']") && r.selector.includes('.ot-card::before') && /background-image/.test(r.body)));
  check('ornament 100 adds the card-eyebrow hairline', cssRules(theme).some((r) => r.selector.includes("[data-ot-ornament='full']") && r.selector.includes('.ot-card-title::after') && /linear-gradient/.test(r.body)));
  check('engraved title scales tracking with --ot-ornament', /font-variant-caps:\s*small-caps/.test(decl(theme, '.ot-orn-title', 'letter-spacing') === null ? '' : theme) && /calc\(0\.04em \+ var\(--ot-ornament\)/.test(theme));
  check('champion accent maps --ot-gold to --ot-champ', !!decl(theme, "[data-ot-accent='champion']", '--ot-gold'));
  check('active nav + focus ring read --ot-champ', rulesFor(theme, '.ot-nav.is-active').some((r) => /var\(--ot-champ\)/.test(r.body)) && /outline-color:\s*var\(--ot-champ\)/.test(theme));

  // Layout presets.
  check('showcase preset exists as data-ot-layout', theme.includes("[data-ot-layout='showcase']"));
  check('showcase hero grows the splash art', !!decl(theme, "[data-ot-layout='showcase'] .ot-hero .ot-splash img", 'width'));
  check('showcase hero avoids min-height tricks (R7)', !/\[data-ot-layout='showcase'\] \.ot-hero \{[^}]*min-height/.test(theme));
  check('compact preset keeps a slim strip', !!decl(theme, "[data-ot-layout='compact'] .ot-orn-strip", 'min-height'));

  // Champion accent: single implementation, imported from the overlay.
  const hooksSrc = read('src/app/hooks.ts');
  check('hooks import the overlay accent resolver', /from '\.\.\/overlay\/champAccent'/.test(hooksSrc) && /resolveChampionAccent/.test(hooksSrc) && /accentSoft/.test(hooksSrc));
  check('no duplicated pickAccent / pixel reading in the client', !/function pickAccent|getImageData|createImageBitmap/.test(ornaments) && !/function pickAccent|getImageData|createImageBitmap/.test(hooksSrc));
  check('banner splash uses championSplashUrl', /championSplashUrl\(id\)/.test(ornaments));
  check(
    'shell owns one masked full-bleed champion image',
    /className="ot-bg"/.test(appTsx) &&
      /className="ot-bg-art"[\s\S]{0,400}?src=\{championSplashUrl\(mainChampionKey\)\}/.test(appTsx) &&
      /\.ot-bg-art img\s*\{[^}]*-webkit-mask-image:\s*radial-gradient/.test(theme)
  );

  // Shell wiring.
  check(
    'champion backdrop replaces the strip on every view',
    /<div className="ot-shell" data-ot-view=\{view\}>/.test(appTsx) &&
      /className="ot-bg-ink"/.test(appTsx) &&
      /\.ot-shell\[data-ot-view='home'\]\s*\{\s*--ot-bg-art:\s*1;/.test(theme) &&
      /\.ot-shell\[data-ot-view='stats'\][\s\S]{0,200}--ot-bg-art:\s*0\.34;/.test(theme) &&
      !/<ChampionStrip/.test(appTsx)
  );
  check('App resolves the main champion and applies the accent', /mainChampionId\(ap, history\.games, catalog\.champions\)/.test(appTsx) && /useChampionAccent\(mainChampion, ap\.accent === 'champion'\)/.test(appTsx));
  check(
    'Home names your main champion on its own plate',
    /ot-home-champion ot-orn-title/.test(homeView) &&
      /<span>Your main<\/span>/.test(homeView) &&
      /const bannerName = bannerChampion\.name \|\| bannerChampion\.id/.test(homeView) &&
      /\{bannerName\}/.test(homeView)
  );
  check('shell has a sidebar filigree divider', /<Filigree \/>/.test(appTsx));

  // Appearance controls.
  check(
    'pins replace the Appearance main-champion picker',
    !/aria-label="Main champion"/.test(appTsx) &&
      /aria-label="Pinned champions"/.test(appTsx) &&
      /<OrbitNav\b[\s\S]{0,400}?pins=\{pinnedChampions\}/.test(appTsx) &&
      /className="ot-pin-add"/.test(pinnedChampions)
  );
  check(
    'picking a champion opts into the champion palette',
    (appTsx.match(/accent: ap\.accent === 'chrome' \? 'champion' : ap\.accent/g) || []).length >= 2 &&
      /const selectChampion = \(champion: Champion, role: CatalogRole\) => \{[\s\S]{0,300}?accent: ap\.accent === 'chrome' \? 'champion' : ap\.accent/.test(appTsx) &&
      /setActive: \(id: string\) =>[\s\S]{0,300}?accent: ap\.accent === 'chrome' \? 'champion' : ap\.accent/.test(appTsx)
  );
  check('Appearance has the layout preset control', /aria-label="Layout preset"/.test(appTsx) && /APPEARANCE_LAYOUT_OPTIONS/.test(appTsx));
  check('Appearance has the ornament intensity slider', /Ornament intensity/.test(appTsx) && /min=\{0\}[\s\S]*?max=\{100\}[\s\S]*?ornament: Number\(e\.target\.value\)/.test(appTsx));
  check('champion picker keeps combobox keyboard handling', /role="listbox"/.test(ui) && /ArrowDown/.test(ui) && /ArrowUp/.test(ui) && /Enter/.test(ui));
  check(
    'pin slots show the champion portrait',
    /<Portrait champion=\{champion\} size=\{40\} className="ot-pin-portrait" \/>/.test(pinnedChampions) &&
      /\.ot-pin\.is-active \.ot-pin-portrait\s*\{[^}]*border-color:\s*var\(--ot-champ\)/.test(theme) &&
      /data-ot-geo="pin"/.test(orbitNav) &&
      /<PinDot\b/.test(orbitNav)
  );

  // Every view adopts the engraved title class.
  const views = ['HomeView', 'DraftView', 'LoadoutView', 'OverlayView', 'PerformanceView', 'StatsView', 'ReviewView', 'MayhemView'];
  const missing = views.filter((v) => !/ot-orn-title/.test(read(`src/app/views/${v}.tsx`)));
  check(`all eight views adopt .ot-orn-title (${missing.join(', ') || 'none missing'})`, missing.length === 0);

  check('type scale untouched: .ot-orn-title sets no font-size', !/font-size/.test(decl(theme, '.ot-orn-title', 'letter-spacing') || '') && !rulesFor(theme, '.ot-orn-title').some((r) => /font-size/.test(r.body)));
  check('stationary ornament: filigree SVG draws 1px currentColor strokes', /stroke="currentColor"/.test(ornaments) && /strokeWidth="1"/.test(ornaments));

  flushAppSettings();
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\nverify_client_revamp: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('verify_client_revamp crashed:', e);
  process.exit(2);
});
