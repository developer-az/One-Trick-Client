/**
 * verify:game-hud-skin — the skin drawn around League's bottom-centre HUD
 * cluster (health/mana, abilities, summoners, items).
 *
 *   1. geometry: the ability rect reproduces ChromeGameHud's frame math, the
 *      health strip sits directly above it, the surround contains both and
 *      stays inside the game view and clear of the minimap, and no decorative
 *      piece enters the interior of the cluster — across 4 resolutions x 6 HUD
 *      scales x 3 map scales plus letterbox/pillarbox;
 *   2. component source: skin only when live (not align mode), aria-hidden,
 *      reuses HudSkinOrnaments, no observers or layout reads;
 *   3. CSS: a block per skin, static paint only, transparent frame;
 *   4. wiring: OverlayApp gate unchanged, frames default off, script wired.
 *
 * Run: npx --yes tsx verify_game_hud_skin.ts
 */
import fs from 'node:fs';
import { computeLeagueGeometry } from './src/overlay/leagueGeometry';
import { gameHudSkinPieces, gameHudSkinRects, type Rect } from './src/overlay/gameHudSkin';
import { HUD_SKIN_IDS } from './src/overlay/hudSkins';
import { DEFAULT_HUD_MODULES } from './src/overlay/hudModules';

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string, quiet = false): void {
  checks += 1;
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  } else if (!quiet) {
    console.log('ok', msg);
  }
}
const read = (p: string) => fs.readFileSync(p, 'utf8');

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;
/** Strict interior overlap (touching edges is fine). */
const overlaps = (a: Rect, b: Rect) =>
  a.left < right(b) - 0.5 && right(a) > b.left + 0.5 && a.top < bottom(b) - 0.5 && bottom(a) > b.top + 0.5;

console.log('--- 1. geometry ---');
{
  // Fixture calibration: ChromeGameHud math reproduced literally.
  const geo = computeLeagueGeometry({ vw: 1920, vh: 1080, hudScale: 20, mapScale: 33 });
  const cal = { ability: { dx: 6, dy: -2, dw: 10, dh: 4 }, minimap: { dx: 0, dy: 0, dw: 0, dh: 0 } };
  const r = gameHudSkinRects({ geo, calibration: cal });
  const w = Math.max(40, geo.abilityW + 10);
  const h = Math.max(24, geo.abilityH + 4);
  const cssLeft = geo.offsetX + geo.gameViewW / 2 + 6; // translateX(-50%) centre
  const cssBottom = geo.displayBottomInset + geo.abilityBottomPad - 2;
  ok(r.ability.width === w && r.ability.height === h, 'ability size matches ChromeGameHud');
  ok(Math.abs(r.ability.left - (cssLeft - w / 2)) < 0.01, 'ability left matches ChromeGameHud centre - w/2');
  ok(Math.abs(geo.vh - bottom(r.ability) - cssBottom) < 0.01, 'ability bottom matches ChromeGameHud');
}

const RES: Array<[number, number, number?, number?]> = [
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [3440, 1440],
  [3440, 1440, 1920, 1080], // pillarbox
  [1920, 1200, 1920, 1080], // letterbox
];
const HUD = [0, 20, 40, 60, 80, 100];
const MAP = [0, 33, 100];
let combos = 0;
for (const [vw, vh, gw, gh] of RES) {
  for (const hudScale of HUD) {
    for (const mapScale of MAP) {
      combos += 1;
      const tag = `${vw}x${vh}${gw ? ` game ${gw}x${gh}` : ''} hud${hudScale} map${mapScale}`;
      const geo = computeLeagueGeometry({ vw, vh, hudScale, mapScale, gameWidth: gw, gameHeight: gh });
      const r = gameHudSkinRects({ geo });
      const { ability: a, health: hl, surround: o, minimap: m } = r;
      for (const [name, rect] of Object.entries({ a, hl, o }) as Array<[string, Rect]>) {
        ok(rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && right(rect) <= vw && bottom(rect) <= vh, `${tag}: ${name} on screen`, true);
      }
      ok(bottom(hl) <= a.top && a.top - bottom(hl) <= Math.ceil(4 * geo.s) + 1, `${tag}: health directly above ability`, true);
      ok(hl.width <= a.width && hl.left >= a.left && right(hl) <= right(a), `${tag}: health no wider than ability`, true);
      ok(o.left <= a.left && right(o) >= right(a) && o.top <= hl.top && bottom(o) >= bottom(a) - 0.5, `${tag}: surround contains cluster`, true);
      ok(o.left >= geo.offsetX && right(o) <= geo.offsetX + geo.gameViewW, `${tag}: surround inside game view (no letterbox bleed)`, true);
      ok(o.top >= geo.offsetY && bottom(o) <= geo.offsetY + geo.gameViewH, `${tag}: surround inside game view vertically`, true);
      ok(!overlaps(o, m), `${tag}: surround clear of minimap`, true);
      const pieces = gameHudSkinPieces(r, geo.s);
      ok(pieces.some((p) => p.kind === 'plate-l') && pieces.some((p) => p.kind === 'plate-r'), `${tag}: side plates drawn`, true);
      for (const p of pieces) {
        const abs: Rect = { ...p.rect, left: p.rect.left + o.left, top: p.rect.top + o.top };
        ok(!overlaps(abs, a) && !overlaps(abs, hl), `${tag}: ${p.kind} stays out of the cluster interior`, true);
        ok(abs.left >= o.left - 0.5 && right(abs) <= right(o) + 0.5 && abs.top >= o.top - 0.5 && bottom(abs) <= bottom(o) + 0.5, `${tag}: ${p.kind} inside surround`, true);
      }
    }
  }
}
ok(failures === 0, `geometry holds across ${combos} resolution/HUD/map combinations`);

console.log('--- 2. component source ---');
const HUD_TSX = read('src/overlay/ChromeGameHud.tsx');
ok(/\{!showGuides && <GameHudSkin /.test(HUD_TSX), 'skin renders only when not in align mode');
ok(HUD_TSX.includes('<HudSkinOrnaments'), 'skin reuses HudSkinOrnaments');
ok(HUD_TSX.includes('useHudSkinChrome()'), 'skin reads the existing skin context');
ok(/className="game-hud-skin"[\s\S]{0,80}aria-hidden/.test(HUD_TSX), 'skin is aria-hidden');
ok(HUD_TSX.includes('chrome-frame-ability'), 'ability anchor box still rendered (handoff check)');
for (const banned of ['ResizeObserver', 'MutationObserver', 'getBoundingClientRect', 'offsetWidth', 'clientHeight', 'requestAnimationFrame', 'setInterval']) {
  ok(!HUD_TSX.includes(banned) && !read('src/overlay/gameHudSkin.ts').includes(banned), `no ${banned} in the skin path`);
}

console.log('--- 3. CSS ---');
const CSS = read('src/overlay/game-hud-skin.css');
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
for (const skin of HUD_SKIN_IDS) {
  ok(code.includes(`.game-hud-skin[data-ov-skin='${skin}']`), `${skin}: has a game HUD skin block`);
}
ok(/\.game-hud-skin\s*\{[^}]*pointer-events:\s*none/.test(code), '.game-hud-skin is pointer-events: none');
ok(/\.game-hud-skin \*\s*\{[^}]*pointer-events:\s*none/.test(code), 'every skin child is pointer-events: none');
ok(/\.ghs-frame\s*\{[^}]*background:\s*transparent/.test(code), 'frame centre stays transparent');
for (const [re, label] of [
  [/@keyframes/, '@keyframes'],
  [/\banimation\s*:/, 'animation'],
  [/\btransition\s*:/, 'transition'],
  [/backdrop-filter\s*:/, 'backdrop-filter'],
  [/(^|[^-])filter\s*:/m, 'filter'],
  [/blur\(/, 'blur'],
  [/box-shadow\s*:/, 'box-shadow'],
  [/will-change\s*:/, 'will-change'],
  [/@import/, '@import'],
] as Array<[RegExp, string]>) {
  ok(!re.test(code), `game-hud-skin.css has no ${label}`);
}
ok(HUD_TSX.includes("import './game-hud-skin.css'"), 'stylesheet imported by ChromeGameHud');

console.log('--- 4. wiring ---');
const APP = read('src/overlay/OverlayApp.tsx');
ok(APP.includes('const showFrames = alignMode || (hudModules.frames && !compactPanel);'), 'OverlayApp showFrames gate unchanged');
ok(APP.includes("enabled={showFrames && (alignMode || slotHasModule('frames'))}"), 'ChromeGameHud enabled gate unchanged');
ok(DEFAULT_HUD_MODULES.frames === false, 'frames module stays off by default');
ok(/frames:\s*\{[^}]*Game HUD \+ minimap frame\/skin/.test(read('src/app/views/OverlayView.tsx')), 'Frames hint describes the game HUD skin');
const pkg = JSON.parse(read('package.json'));
ok(pkg.scripts['verify:game-hud-skin'] === 'npx --yes tsx verify_game_hud_skin.ts', 'verify:game-hud-skin script exists');
ok(String(pkg.scripts['verify:release']).includes('npm run verify:game-hud-skin'), 'wired into verify:release');

console.log(`\n${checks} checks, ${failures} failures`);
if (failures) process.exit(1);
