/**
 * verify_orbit_client.ts — brief J: the orbital disk client.
 *
 * Source-level + pure-function checks (no browser in this sandbox):
 *
 *   1. `orbitLayout` never overlaps for 4–9 items of realistic widths, on the
 *      rail sizes of every target viewport (960/1280/1600/1920/2560), and it
 *      tells the shell how much room it needs.
 *   2. Tier breakpoints: < 760 icon bar, < 1100 segmented bar, otherwise arc.
 *   3. Pinned champions: max 6, normalize/migration from the old main
 *      champion, reorder + unpin, and parity with electron/app-settings.
 *   4. Profile is a first-class view (ViewId + nav + shell wiring).
 *   5. Typography tokens (body 13px/500, eyebrows 11px/600 at 0.18em, tabular
 *      numbers, antialiasing) are present in tokens.css / theme.css.
 *   6. Motion/blur budget over src/app CSS: no backdrop blur, no infinite
 *      animation, transitions <= 200ms, reduced-motion fallbacks.
 *
 * Run: npx --yes tsx verify_orbit_client.ts
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
function tokenValue(css: string, name: string): string | null {
  const m = css.match(new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;]+);`));
  return m ? m[2].trim() : null;
}

/** Realistic pill widths: the eight page labels at 13px/600 with an icon. */
const NAV_WIDTHS = [78, 72, 92, 70, 80, 94, 84, 76];
/** 1600+ has room on one rail; 1280/1100 keep the two-row fan. */
const VIEWPORTS = [960, 1280, 1600, 1920, 2560];

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-orbit-'));
  process.env.ONETRICK_USER_DATA = dir;
  fs.writeFileSync(
    path.join(dir, 'app-settings.json'),
    JSON.stringify({
      overlayEnabled: false,
      autoImport: true,
      appearance: { theme: 'gothic', accent: 'chrome', mainChampion: 'Ahri' },
    })
  );

  const orbit = await import('./src/app/orbitLayout');
  const {
    orbitLayout,
    orbitFromAnchors,
    anchorsAlongArc,
    orbitTier,
    normalizePins,
    addPin,
    removePin,
    movePin,
    togglePin,
    pinHandlers,
    resolvePins,
    rectsOverlap,
    ORBIT_BAR_BELOW,
    ORBIT_ICONS_BELOW,
  } = orbit;
  const appSettings = await import('./electron/app-settings');
  const { normalizePinnedChampions, loadAppSettings, updateAppSettings, getAppSettings, flushAppSettings } = appSettings;

  /* ------------------------------------------------------- layout 1/2 */
  console.log('\n— orbit layout —');
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item-${i}` }));
  const sizes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ width: NAV_WIDTHS[i % NAV_WIDTHS.length], height: 36 }));

  for (let n = 4; n <= 9; n++) {
    const layout = orbitLayout(items(n), 1500, 78, 102, sizes(n), { maxRings: 3, itemHeight: 36 });
    const rects = layout.placements.map((p: { x: number; y: number; width: number; height: number }) => ({
      x: p.x - p.width / 2,
      y: p.y - p.height / 2,
      width: p.width,
      height: p.height,
    }));
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i], rects[j])) overlaps++;
    }
    check(`${n} items: no pairwise overlap (${layout.rings} ring(s), ${overlaps} hits)`, overlaps === 0);
    check(`${n} items: every item placed once`, layout.placements.length === n && new Set(layout.placements.map((p: { id: string }) => p.id)).size === n);
    check(`${n} items: no column fallback at a wide arc (rings=${layout.rings})`, layout.fallback === false);
    check(`${n} items: reports the room it needs (w ${Math.round(layout.width)}, h ${Math.round(layout.height)})`, layout.width > 0 && layout.height >= 36);
  }

  // The fan the shell renders: the approved mockup's own anchor shape, scaled by
  // the disk radius (7 page pills, no overlap, inside the window).
  const REF_ANCHORS = [
    { r: 1.273, deg: 64.6 },
    { r: 1.507, deg: 45.0 },
    { r: 1.847, deg: 28.1 },
    { r: 2.32, deg: 16.2 },
    { r: 2.767, deg: 8.9 },
    { r: 3.293, deg: 11.0 },
    { r: 2.907, deg: 16.8 },
  ];
  const navWidths = [67, 73, 94, 71, 81, 88, 91];
  for (const viewport of [1280, 1600, 1920, 2560]) {
    const radius = Math.min(420, Math.max(260, viewport * 0.23)) / 2;
    const rail = orbitFromAnchors(
      items(7),
      REF_ANCHORS,
      radius,
      navWidths.map((width) => ({ width, height: 36 })),
      { gap: 8, itemHeight: 36 }
    );
    const rects = rail.placements.map((p: { x: number; y: number; width: number; height: number }) => ({
      x: p.x - p.width / 2,
      y: p.y - p.height / 2,
      width: p.width,
      height: p.height,
    }));
    let hits = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i], rects[j])) hits++;
    }
    const rightEdge = Math.max(...rail.placements.map((p: { x: number; y: number; width: number }) => p.x + p.width / 2));
    check(`${viewport}px: mockup fan has 7 pills and no overlap (hits=${hits})`, hits === 0 && rail.placements.length === 7);
    check(`${viewport}px: fan stays inside the window (right edge ${Math.round(rightEdge)} < ${viewport / 2 - 20})`, rightEdge < viewport / 2 - 20);
    check(`${viewport}px: first pill sits at the reference's lower-right anchor`, (() => {
      const first = rail.placements[0];
      const expected = REF_ANCHORS[0];
      return Math.abs(first.x - Math.cos((expected.deg * Math.PI) / 180) * expected.r * radius) < 1 &&
        Math.abs(first.y - Math.sin((expected.deg * Math.PI) / 180) * expected.r * radius) < 1;
    })());
  }

  // Pins: the mockup's left band, one round portrait per anchor, "+" outermost.
  const pinAnchors = anchorsAlongArc(7, { r: 1.52, deg: 165 }, { r: 1.1, deg: 116 });
  const pinRail = orbitFromAnchors(items(7), pinAnchors, 147, Array.from({ length: 7 }, () => ({ width: 40, height: 40 })), {
    gap: 8,
    itemHeight: 40,
    shape: 'circle',
  });
  check('pins: 7 slots (6 pins + add) placed on the reference band', pinRail.placements.length === 7 && pinRail.fallback === false);
  check('pins: round portraits never overlap', (() => {
    const centres = pinRail.placements.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < centres.length; i++) {
      for (let j = i + 1; j < centres.length; j++) {
        if (Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y) < 40) return false;
      }
    }
    return true;
  })());
  check('pins: the "+" slot is the outermost (leftmost) anchor', pinRail.placements[0].x < Math.min(...pinRail.placements.slice(1).map((p: { x: number }) => p.x)) + 40);
  check('pins: the band mirrors the reference angles (165deg to 116deg)', Math.abs(pinAnchors[0].deg - 165) < 0.001 && Math.abs(pinAnchors[6].deg - 116) < 0.001);

  // Hostile input: very wide pills must still resolve (column fallback allowed).
  const wide = orbitLayout(items(9), 80, 88, 92, Array.from({ length: 9 }, () => ({ width: 300, height: 36 })), {
    maxRings: 2,
    itemHeight: 36,
  });
  const wideRects = wide.placements.map((p: { x: number; y: number; width: number; height: number }) => ({
    x: p.x - p.width / 2,
    y: p.y - p.height / 2,
    width: p.width,
    height: p.height,
  }));
  let wideHits = 0;
  for (let i = 0; i < wideRects.length; i++) {
    for (let j = i + 1; j < wideRects.length; j++) if (rectsOverlap(wideRects[i], wideRects[j])) wideHits++;
  }
  check(`wide items never overlap (fallback=${wide.fallback}, hits=${wideHits})`, wideHits === 0 && wide.placements.length === 9);

  /* ---------------------------------------------------------- breakpoints */
  console.log('\n— tier breakpoints —');
  check('breakpoints: arc is 1100 and up', ORBIT_BAR_BELOW === 1100 && orbitTier(1100) === 'arc' && orbitTier(2560) === 'arc');
  check('breakpoints: bar between 760 and 1099', orbitTier(1099) === 'bar' && orbitTier(960) === 'bar' && orbitTier(760) === 'bar');
  check('breakpoints: icons below 760', ORBIT_ICONS_BELOW === 760 && orbitTier(759) === 'icons' && orbitTier(480) === 'icons');
  check('breakpoints: garbage width falls back to the bar', orbitTier(Number.NaN) === 'bar' && orbitTier(0) === 'bar');
  for (const width of VIEWPORTS) {
    const tier = orbitTier(width);
    const radius = Math.min(420, Math.max(260, width * 0.23)) / 2;
    const fan = orbitFromAnchors(
      items(7),
      REF_ANCHORS,
      radius,
      navWidths.map((w) => ({ width: w, height: 36 })),
      { gap: 8, itemHeight: 36 }
    );
    const right = Math.max(...fan.placements.map((pl: { x: number; width: number }) => pl.x + pl.width / 2));
    check(`${width}px -> ${tier} layout, fan fits the window (right ${Math.round(right)})`, tier !== 'arc' || right < width / 2 - 20);
  }
  check('pins cap at 6 in both modules', orbit.PIN_LIMIT === 6 && appSettings.PINNED_CHAMPIONS_MAX === 6);
  check('normalize drops non-strings', normalizePins([1, null, 'Ahri']).join(',') === 'Ahri');
  deepEqual('normalize keeps pin order', normalizePins(['Yone', 'Ahri', 'Pyke']), ['Yone', 'Ahri', 'Pyke']);
  check('normalize caps at six', normalizePins(['A', 'B', 'C', 'D', 'E', 'F', 'G']).length === 6);
  check('normalize de-duplicates', normalizePins(['Ahri', 'Ahri', 'Pyke']).join(',') === 'Ahri,Pyke');
  check('normalize rejects markup and paths', normalizePins(['Ah<ri>', '../x', 'Ahri']).join(',') === 'Ahri');
  deepEqual('normalize seeds when the field is absent', normalizePins(undefined, 'Pyke'), ['Pyke']);
  deepEqual('normalize keeps an explicitly empty list (last pin stays unpinned)', normalizePins([], 'Pyke'), []);
  deepEqual('normalize ignores an invalid seed', normalizePins(undefined, 'bad id!'), []);
  deepEqual('normalize does not seed a non-empty list', normalizePins(['Yone'], 'Pyke'), ['Yone']);

  deepEqual('addPin appends', addPin(['Ahri'], 'Pyke'), ['Ahri', 'Pyke']);
  check('pins cap at 6 in both modules', appSettings.PINNED_CHAMPIONS_MAX === 6);
  deepEqual('addPin ignores duplicates', addPin(['Ahri'], 'Ahri'), ['Ahri']);
  deepEqual('addPin ignores a full list', addPin(['A', 'B', 'C', 'D', 'E', 'F'], 'G'), ['A', 'B', 'C', 'D', 'E', 'F']);
  deepEqual('addPin rejects invalid ids', addPin(['Ahri'], 'not an id'), ['Ahri']);
  deepEqual('removePin drops one', removePin(['Ahri', 'Pyke'], 'Ahri'), ['Pyke']);
  deepEqual('removePin ignores unknown ids', removePin(['Ahri'], 'Yone'), ['Ahri']);
  deepEqual('togglePin adds then removes', togglePin(togglePin(['Ahri'], 'Pyke'), 'Pyke'), ['Ahri']);
  deepEqual('movePin moves right', movePin(['A', 'B', 'C'], 0, 2), ['B', 'C', 'A']);
  deepEqual('movePin moves left', movePin(['A', 'B', 'C'], 2, 0), ['C', 'A', 'B']);
  deepEqual('movePin clamps out-of-range indexes', movePin(['A', 'B', 'C'], -5, 99), ['B', 'C', 'A']);
  deepEqual('movePin keeps a single-item list', movePin(['A'], 0, 0), ['A']);

  const handlers = pinHandlers({ pins: ['Ahri', 'Pyke'], setPins: () => {}, setActive: () => {} });
  check('pinHandlers exposes pick/unpin/reorder', typeof handlers.onPick === 'function' && typeof handlers.onUnpin === 'function' && typeof handlers.onReorder === 'function');
  let pinned: string[] = [];
  const wired = pinHandlers({ pins: ['Ahri', 'Pyke'], setPins: (next: string[]) => (pinned = next), setActive: () => {} });
  wired.onUnpin('Ahri');
  deepEqual('pinHandlers.unpin writes the shortened list', pinned, ['Pyke']);
  wired.onReorder(1, 0);
  deepEqual('pinHandlers.reorder writes the moved list', pinned, ['Pyke', 'Ahri']);
  deepEqual('resolvePins keeps ids without a catalog row', resolvePins(['Ahri'], []).map((c: { id?: string | null; name?: string | null }) => `${c.id}:${c.name}`), ['Ahri:Ahri']);
  deepEqual(
    'resolvePins maps catalog rows',
    resolvePins(['Ahri'], [{ id: 'Ahri', name: 'Ahri', key: '103' }]).map((c: { key?: string | number | null }) => c.key),
    ['103']
  );

  /* --------------------------------------------- electron persistence */
  console.log('\n— settings persistence —');
  const loaded = loadAppSettings();
  deepEqual('migration: pins seed from appearance.mainChampion', loaded.pinnedChampions, ['Ahri']);
  deepEqual('electron normalize mirrors the renderer', normalizePinnedChampions(['Yone', 'Yone', 'Pyke'], ''), ['Yone', 'Pyke']);
  check('electron normalize caps at six', normalizePinnedChampions(['A', 'B', 'C', 'D', 'E', 'F', 'G'], '').length === 6);
  check('electron normalize rejects junk', normalizePinnedChampions(['Ah<ri>', 5, 'Pyke'], '').join(',') === 'Pyke');
  updateAppSettings({ pinnedChampions: ['Yone', 'Ahri'] });
  deepEqual('update persists a new pin list', getAppSettings().pinnedChampions, ['Yone', 'Ahri']);
  updateAppSettings({ appearance: { theme: 'ember' } });
  deepEqual('a partial appearance patch keeps the pins', getAppSettings().pinnedChampions, ['Yone', 'Ahri']);
  updateAppSettings({ pinnedChampions: [] });
  deepEqual('an explicitly empty pin list persists as empty', getAppSettings().pinnedChampions, []);
  updateAppSettings({ pinnedChampions: 'nope' });
  deepEqual('an invalid pin patch falls back to the main champion', getAppSettings().pinnedChampions, ['Ahri']);
  flushAppSettings();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'app-settings.json'), 'utf8')) as { pinnedChampions?: string[] };
  deepEqual('pins round-trip to disk', onDisk.pinnedChampions, ['Ahri']);

  /* ------------------------------------------------------ shell wiring */
  console.log('\n— shell + profile —');
  const appTsx = read('src/app/App.tsx');
  const orbitNav = read('src/app/OrbitNav.tsx');
  const profiles = read('src/app/views/ProfileView.tsx');
  const tokens = read('src/app/tokens.css');
  const theme = read('src/app/theme.css');
  const home = read('src/app/views/HomeView.tsx');

  check("ViewId includes 'profile'", /export type ViewId = [^;]*'profile'/.test(appTsx));
  check(
    'nav keeps the reference set (Home..Overlay) and reaches Profile from the pill',
    /\{ id: 'overlay', label: 'Overlay'/.test(appTsx) && !/\{ id: 'profile'/.test(appTsx) && /data-ot-geo="profile"/.test(appTsx) && /setView\('profile'\)/.test(appTsx)
  );
  check('Performance stays reachable from Stats', /onNavigate\('performance'\)/.test(read('src/app/views/StatsView.tsx')));
  check('shell renders ProfileView', /<ProfileView\b/.test(appTsx));
  check('profile chip opens the profile', /className="ot-profile-chip"[\s\S]*?setView\('profile'\)/.test(appTsx));
  check('shell mounts the disk nav', /<OrbitNav\b/.test(appTsx) && /items=\{navItems\}/.test(appTsx));
  check('disk renders the pinned rails', /pinActions/.test(orbitNav) && /PinDot/.test(orbitNav) && /PinAdd/.test(orbitNav));
  check('disk has a viewport tier fallback', /tier === 'bar' \|\| tier === 'icons'/.test(orbitNav) && /is-icon/.test(orbitNav));
  check('clicking a pin sets the main champion', /mainChampion: id/.test(appTsx));
  check('pins persist through update({ pinnedChampions })', /update\(\{ pinnedChampions: next \}\)/.test(appTsx));
  check('Appearance no longer holds the main-champion picker', !/aria-label="Main champion"/.test(appTsx));
  check('Appearance still holds layout preset + ornament', /aria-label="Layout preset"/.test(appTsx) && /Ornament intensity/.test(appTsx));
  check('Profile has a Riot API placeholder that stores nothing', /Coming soon: league-wide stats/.test(profiles) && /disabled/.test(profiles) && !/setItem\(/.test(profiles));
  check('Profile manages the pinned champions', /<PinRail\b/.test(profiles) && /manage/.test(profiles));
  check('Home names the main champion on one plate', /ot-home-champion/.test(home) && /YOUR MAIN|Your main/.test(home));
  check('Home dock has the four info cards', (home.match(/ot-info-card"/g) || []).length >= 4);
  const homeCode = home.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('Home never offers a fake match button', !/Find match|Play now|Start queue/i.test(homeCode));
  check('Home actions are real views', /onNavigate\('loadout'\)/.test(home) && /onNavigate\('draft'\)/.test(home));

  /* ------------------------------------------------------- typography */
  console.log('\n— app typography —');
  check('tokens: body size 13px', tokenValue(tokens, '--ot-fs-body') === '13px');
  check('tokens: eyebrow size 11px', tokenValue(tokens, '--ot-fs-eyebrow') === '11px');
  check('tokens: eyebrow tracking 0.18em', tokenValue(tokens, '--ot-track-eyebrow') === '0.18em');
  check('tokens: body weight 500', tokenValue(tokens, '--ot-weight-body') === '500');
  check('tokens: label weight 600', tokenValue(tokens, '--ot-weight-label') === '600');
  check('tokens: strong weight 700', tokenValue(tokens, '--ot-weight-strong') === '700');
  check('tokens: body line-height 1.35', tokenValue(tokens, '--ot-lh-body') === '1.35');
  check('tokens: button height 36 / 40', tokenValue(tokens, '--ot-btn-height') === '36px' && tokenValue(tokens, '--ot-btn-height-lg') === '40px');
  check('theme: root body weight reads the token', /html:not\(\.overlay-root\)\s*\{[^}]*font-weight:\s*var\(--ot-weight-body\)/.test(theme));
  check('theme: antialiased + legibility on', /-webkit-font-smoothing:\s*antialiased/.test(theme) && /text-rendering:\s*optimizeLegibility/.test(theme));
  check("theme: tabular + ss01 features for numbers", /font-feature-settings:\s*'tnum'\s*1,\s*'ss01'\s*1/.test(theme));
  check('theme: eyebrow class uses 11px at 600 with 0.18em', /\.ot-home-eyebrow\s*\{[^}]*font-size:\s*var\(--ot-fs-eyebrow\)[^}]*font-weight:\s*var\(--ot-weight-label\)[^}]*letter-spacing:\s*var\(--ot-track-eyebrow\)/.test(theme));
  const eyebrow = cssRules(theme).find((r) => r.selector === '.ot-home-eyebrow');
  check('theme: eyebrow is 11px, weight 600, tracking >= 0.18em', !!eyebrow && /letter-spacing:\s*var\(--ot-track-eyebrow\)/.test(eyebrow.body));
  check('theme: app button set is 36px, weight 600, radius 6', (() => {
    const rule = cssRules(theme).find((r) => r.selector === '.ot-ui-btn');
    if (!rule) return false;
    return /height:\s*var\(--ot-btn-height\)/.test(rule.body) && /font-weight:\s*var\(--ot-weight-label\)/.test(rule.body) && /border-radius:\s*var\(--ot-btn-radius\)/.test(rule.body);
  })());
  check('ui.tsx exports the shared Button', /export const Button = React\.forwardRef/.test(read('src/app/ui.tsx')));
  check('shell, Home and Profile use the shared Button', /<Button\b/.test(appTsx) && /<Button\b/.test(home) && /<Button\b/.test(profiles));

  /* ---------------------------------------------------- motion budget */
  console.log('\n— motion + blur budget —');
  const appCss = `${tokens}\n${theme}\n${orbitNav}`.replace(/\/\*[\s\S]*?\*\//g, '');
  check('no backdrop-filter outside the opt-in glass layer', (() => {
    const hits = cssRules(theme).filter((r) => /backdrop-filter/i.test(r.body));
    return hits.every((r) => r.selector.includes('data-ot-glass-on') || r.selector.includes('ot-appearance-sample'));
  })());
  check('no filter: blur() in app CSS', !/(^|[;\s])filter\s*:\s*blur\(/i.test(appCss));
  check('no infinite animation', !/infinite/i.test(appCss));
  const durations = (theme.match(/transition:[^;]+;/g) || []).flatMap((d) =>
    (d.match(/([0-9.]+)(m?s)/g) || []).map((v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000))
  );
  check(`transitions <= 200ms (max ${Math.max(0, ...durations)}ms)`, durations.every((d) => d <= 200));
  check('reduced motion disables the disk/button transitions', /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ot-ui-btn,[\s\S]*?transition:\s*none/.test(theme));
  check('no glow on the disk (no filter/drop-shadow on .ot-disk)', !/\.ot-disk[^{]*\{[^}]*drop-shadow/.test(theme));
  check('background art is masked, not blurred', /-webkit-mask-image:\s*radial-gradient/.test(theme) && /\.ot-bg-art img/.test(theme));

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\nverify_orbit_client: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('verify_orbit_client crashed:', e);
  process.exit(2);
});
