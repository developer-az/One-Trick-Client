/**
 * HUD skin system (Brief I) — registry, auto mapping, settings persistence
 * shape, static-CSS budget and the geometry guard.
 *
 * Skins are decoration-only. This check proves three things without Electron:
 *   1. every skin has a CSS block and a non-empty inline-SVG ornament set, and
 *      `auto` maps every Data Dragon class tag (unknown -> gothic);
 *   2. the tweaks default, clamp and survive a settings round-trip, and the
 *      electron store/IPC/preload/types carry the same shape;
 *   3. hud-skins.css is static (no animation/filter/blur) and declares no
 *      layout, padding, margin, transform, inset or text-metric property on a
 *      module container — so module boxes and text clipping are identical to
 *      gothic at 1920x1080 / 2560x1440 and 100/125/150% HUD scale.
 *
 * The overlay has no DOM in this process; the geometry guard derives its box
 * metrics from the same pure layout functions the overlay uses
 * (`layoutStyle`) plus each skin's frame variables, and the declaration audit
 * above proves no skin introduces any other layout input.
 *
 * Run: npx --yes tsx verify_hud_skins.ts
 */
import fs from 'node:fs';
import {
  DEFAULT_HUD_SKIN_SETTINGS,
  HUD_SKIN_CHOICES,
  HUD_SKIN_CLASS,
  HUD_SKIN_IDS,
  HUD_SKIN_OPACITY_MIN,
  HUD_SKIN_SCALE_MAX,
  HUD_SKIN_SCALE_MIN,
  HUD_SKIN_TAG_MAP,
  hudSkinVars,
  normalizeHudSkinSettings,
  resolveHudSkin,
  type HudSkin,
} from './src/overlay/hudSkins';
import {
  ORNAMENT_CORNERS,
  ORNAMENT_MIN_PANEL_HEIGHT,
  ornamentEmblemSource,
  ornamentSvgSource,
} from './src/overlay/hudSkinOrnaments';
import { dualRailLayout, layoutStyle, type HudElement } from './src/overlay/hudLayout';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  } else {
    console.log('ok', msg);
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8');
}

const CSS = read('src/overlay/hud-skins.css');
const THEME = read('src/overlay/overlay-theme.css');
const ORNAMENTS_TSX = read('src/overlay/hudSkinOrnaments.tsx');
const OVERLAY_APP = read('src/overlay/OverlayApp.tsx');
const STUDIO = read('src/overlay/HudStudioCanvas.tsx');
const VIEW = read('src/app/views/OverlayView.tsx');
const WINDOW_TS = read('electron/overlay-window.ts');
const MAIN_TS = read('electron/main.ts');
const PRELOAD_TS = read('electron/preload.ts');
const TYPES = read('src/types.d.ts');

interface CssRule {
  selectors: string[];
  body: string;
}

function cssRules(source: string): CssRule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    rules.push({
      selectors: match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      body: match[2],
    });
  }
  return rules;
}

const RULES = cssRules(CSS);

function declarations(body: string): string[] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
}

function varBlock(skin: HudSkin, name: string): string | null {
  for (const rule of RULES) {
    if (!rule.selectors.some((s) => s === `[data-ov-skin='${skin}']`)) continue;
    for (const decl of declarations(rule.body)) {
      const [key, ...rest] = decl.split(':');
      if (key.trim() === name) return rest.join(':').trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log('--- verify:hud-skins: registry ---');
// ---------------------------------------------------------------------------
for (const skin of HUD_SKIN_IDS) {
  ok(varBlock(skin, '--ov-skin-radius') !== null, `${skin}: CSS block defines its frame radius`);
  const corners = ORNAMENT_CORNERS.map((corner) => ornamentSvgSource(skin, corner));
  ok(
    corners.every((svg) => /<(path|circle)\b/.test(svg) && svg.includes('stroke="currentColor"')),
    `${skin}: every corner ships an inline SVG mark in currentColor`
  );
}
ok(
  HUD_SKIN_IDS.every((skin) => ORNAMENTS_TSX.includes(`${skin}: [`)),
  'every skin id has an ornament set in hudSkinOrnaments.tsx'
);
ok(HUD_SKIN_CHOICES[0] === 'auto', 'Auto is offered as a selection');
ok(HUD_SKIN_IDS.length === 7, 'seven concrete skins in the library');

// Every Data Dragon class tag maps to a skin; unknown falls back to gothic.
const DD_TAGS = ['Assassin', 'Mage', 'Tank', 'Support', 'Marksman', 'Fighter'];
for (const tag of DD_TAGS) {
  const skin = HUD_SKIN_TAG_MAP[tag];
  ok(!!skin && (HUD_SKIN_IDS as readonly string[]).includes(skin), `auto: ${tag} -> a real skin (${skin})`);
  ok(resolveHudSkin('auto', [tag]) === skin, `resolveHudSkin('auto', ['${tag}']) picks ${skin}`);
  ok(HUD_SKIN_CLASS[skin] === tag, `${skin} is themed for ${tag}`);
}
ok(resolveHudSkin('auto', ['Unknown']) === 'gothic', 'auto: unknown class tag -> gothic');
ok(resolveHudSkin('auto', []) === 'gothic', 'auto: no champion tags -> gothic');
ok(resolveHudSkin('auto', null) === 'gothic', 'auto: null tags -> gothic');
ok(resolveHudSkin('auto', ['Mage', 'Assassin']) === 'arcane', 'auto uses the primary (first) tag');
ok(resolveHudSkin('warden', ['Mage']) === 'warden', 'an explicit pick ignores champion tags');

// ---------------------------------------------------------------------------
console.log('--- settings: defaults, clamping, persistence ---');
// ---------------------------------------------------------------------------
const defaults = normalizeHudSkinSettings(undefined);
ok(
  JSON.stringify(defaults) === JSON.stringify(DEFAULT_HUD_SKIN_SETTINGS),
  `defaults are gothic + ornaments on + 92% + 100% + champion tint (${JSON.stringify(defaults)})`
);
ok(defaults.hudSkin === 'gothic', 'gothic is the default skin (the shipped look)');
ok(defaults.hudSkinOpacity === 92, 'panel alpha defaults to the current 0.92 backing');

const clamped = normalizeHudSkinSettings({
  hudSkin: 'bloodmoon',
  hudSkinOrnaments: false,
  hudSkinOpacity: 10,
  hudSkinScale: 900,
  hudSkinUseChampColor: false,
});
ok(clamped.hudSkin === 'bloodmoon' && clamped.hudSkinOrnaments === false, 'valid picks survive normalization');
ok(
  clamped.hudSkinOpacity === HUD_SKIN_OPACITY_MIN && clamped.hudSkinOpacity === 80,
  `opacity clamps up to the R5 floor (${clamped.hudSkinOpacity})`
);
ok(clamped.hudSkinScale === HUD_SKIN_SCALE_MAX && clamped.hudSkinScale === 150, `scale clamps to 150 (${clamped.hudSkinScale})`);
ok(normalizeHudSkinSettings({ hudSkinOpacity: 500 }).hudSkinOpacity === 100, 'opacity clamps down to 100');
ok(normalizeHudSkinSettings({ hudSkinScale: 5 }).hudSkinScale === HUD_SKIN_SCALE_MIN, 'scale clamps up to 75');
ok(normalizeHudSkinSettings({ hudSkinOpacity: 91.6 }).hudSkinOpacity === 92, 'opacity rounds to whole percent');
ok(normalizeHudSkinSettings({ hudSkin: 'nope' }).hudSkin === 'gothic', 'unknown skin id falls back to gothic');
ok(normalizeHudSkinSettings({ hudSkinOpacity: Number.NaN }).hudSkinOpacity === 92, 'NaN opacity falls back to default');

const vars = hudSkinVars({ ...DEFAULT_HUD_SKIN_SETTINGS, hudSkinOpacity: 85, hudSkinScale: 120, hudSkinUseChampColor: true });
ok(vars['--ov-skin-panel-alpha'] === '0.85', 'CSS var: opacity percent -> alpha');
ok(vars['--ov-skin-orn-scale'] === '1.2', 'CSS var: ornament percent -> scale');
ok(vars['--ov-skin-orn'] === 'var(--ov-champ)', 'CSS var: champion tint reads --ov-champ');
ok(
  hudSkinVars({ ...DEFAULT_HUD_SKIN_SETTINGS, hudSkinUseChampColor: false })['--ov-skin-orn'].includes('chrome'),
  'CSS var: tint off falls back to chrome silver'
);

const roundTrip = JSON.parse(JSON.stringify(DEFAULT_HUD_SKIN_SETTINGS));
ok(
  JSON.stringify(normalizeHudSkinSettings(roundTrip)) === JSON.stringify(DEFAULT_HUD_SKIN_SETTINGS),
  'settings survive a JSON round-trip unchanged'
);

// ---------------------------------------------------------------------------
console.log('--- persistence wiring: store + IPC + bridge + types ---');
// ---------------------------------------------------------------------------
ok(
  WINDOW_TS.includes('hudSkin') && WINDOW_TS.includes('overlay-settings.json'),
  'overlay-window.ts persists the skin with the overlay settings file'
);
ok(/hudSkin,\s*\n\s*overlayBackend: backend,/.test(WINDOW_TS), 'the settings write includes hudSkin');
ok(/hudSkin = normalizeHudSkinSettings\(settings\.hudSkin\)/.test(WINDOW_TS), 'the settings load restores hudSkin');
ok(/export function setHudSkin/.test(WINDOW_TS), 'overlay-window.ts exports setHudSkin');
ok(/export function getHudSkin/.test(WINDOW_TS), 'overlay-window.ts exports getHudSkin');
ok(
  /export function setHudSkin[\s\S]{0,400}?saveSettings\(\);[\s\S]{0,200}?broadcastOverlayMeta\(\);/.test(WINDOW_TS),
  'setHudSkin persists and broadcasts live to a running overlay'
);
ok(/hudSkin,\s*\n\s*pet: getAppSettings\(\)\.pet,/.test(WINDOW_TS), 'overlay-meta carries hudSkin to the running overlay');
ok(MAIN_TS.includes("ipcMain.handle('overlay-set-hud-skin'"), 'main.ts handles overlay-set-hud-skin');
ok(MAIN_TS.includes('setHudSkin(skin)'), 'main.ts calls the overlay store setter');
ok(/hudSkin: getHudSkin\(\)/.test(MAIN_TS), 'overlay-get-status returns hudSkin (restart/hydrate)');
ok(PRELOAD_TS.includes("setOverlayHudSkin: (skin: unknown) => ipcRenderer.invoke('overlay-set-hud-skin', skin)"), 'preload exposes setOverlayHudSkin');
ok(TYPES.includes('interface HudSkinSettings'), 'types.d.ts declares HudSkinSettings');
ok(TYPES.includes('setOverlayHudSkin: (skin: Partial<HudSkinSettings>)'), 'types.d.ts types the bridge');
ok(/hudSkin\?: HudSkinSettings;/.test(TYPES), 'getOverlayStatus carries hudSkin');
// One normalization implementation: electron imports the pure renderer module.
ok(
  WINDOW_TS.includes("from '../src/overlay/hudSkins'") && WINDOW_TS.includes('normalizeHudSkinSettings'),
  'overlay-window.ts imports normalizeHudSkinSettings from src/overlay/hudSkins.ts'
);
ok(!/function normalizeHudSkinSettings\(/.test(WINDOW_TS), 'overlay-window.ts no longer duplicates the normalizer');
const HUD_SKINS_TS = read('src/overlay/hudSkins.ts');
ok(
  /hudSkinOpacity: clampInt\([\s\S]{0,120}?HUD_SKIN_OPACITY_MIN/.test(HUD_SKINS_TS) &&
    /hudSkinScale: clampInt\([\s\S]{0,120}?HUD_SKIN_SCALE_MIN/.test(HUD_SKINS_TS),
  'the shared normalizer clamps opacity 80–100 and scale 75–150'
);
ok(
  read('tsconfig.electron.json').includes('src/overlay/hudSkins.ts'),
  'the electron tsconfig includes the shared pure hudSkins module'
);

// ---------------------------------------------------------------------------
console.log('--- live propagation into the overlay ---');
// ---------------------------------------------------------------------------
ok(OVERLAY_APP.includes('normalizeHudSkinSettings(meta.hudSkin)'), 'OverlayApp applies hudSkin from overlay-meta');
ok(OVERLAY_APP.includes("setAttribute('data-ov-skin'"), 'OverlayApp sets data-ov-skin on the root');
ok(OVERLAY_APP.includes("setAttribute('data-ov-skin-orn'"), 'OverlayApp sets the ornament toggle attribute');
ok(OVERLAY_APP.includes('hudSkinVars(hudSkin)'), 'OverlayApp applies the tweak CSS variables');
ok(OVERLAY_APP.includes('resolveHudSkin('), 'OverlayApp resolves Auto by champion class');
ok(OVERLAY_APP.includes('<HudSkinOrnaments'), 'panel chrome renders the ornament set');
ok(
  /data-hud-section="summoners"[\s\S]{0,200}?<HudSkinOrnaments/.test(OVERLAY_APP) &&
    /data-hud-section="respawns"[\s\S]{0,200}?<HudSkinOrnaments/.test(OVERLAY_APP),
  'the left Summoners rail cards render the same ornament set'
);
ok(
  /hudSkinChromeValue = useMemo\(/.test(OVERLAY_APP),
  'the skin context value is memoized (skin switch only re-renders on settings change)'
);
ok(
  /useEffect\(\(\) => \{[\s\S]{0,900}?data-ov-skin[\s\S]{0,900}?\}, \[activeHudSkin, hudSkin\]\)/.test(OVERLAY_APP),
  'the root skin effect depends only on the resolved skin and its tweaks'
);
ok(STUDIO.includes('data-ov-skin={skin}'), 'HUD Studio canvas takes the resolved skin');
ok(STUDIO.includes('export const HudSkinPreview'), 'HUD Studio exposes a live skin preview for settings cards');
ok(VIEW.includes('title="HUD Skin"'), 'OverlayView has the HUD Skin section');
ok(VIEW.includes('HudSkinPreview'), 'settings cards render the live preview');
ok(VIEW.includes('setOverlayHudSkin'), 'settings changes push to a running overlay');
ok(VIEW.includes('aria-pressed={active}'), 'skin cards expose their pressed state');

// ---------------------------------------------------------------------------
console.log('--- hud-skins.css stays static (R5/R6/R11) ---');
// ---------------------------------------------------------------------------
ok(!/@keyframes/.test(CSS), 'no @keyframes');
ok(!/\banimation\s*:/.test(CSS), 'no animation declarations');
ok(!/\bbackdrop-filter\s*:/.test(CSS), 'no backdrop-filter');
ok(!/\bfilter\s*:/.test(CSS), 'no filter');
ok(!/drop-shadow\(/.test(CSS), 'no drop-shadow');
ok(!/blur\(/.test(CSS), 'no blur');
ok(!/\btransition\s*:/.test(CSS), 'no transitions (skin switching is instant, no repaint loop)');
ok(!/\bwill-change\s*:/.test(CSS), 'no will-change');
ok(!/box-shadow\s*:/.test(CSS), 'no box-shadow (and therefore no box-shadow blur)');
ok(!/@import/.test(CSS), 'no CSS imports');
// The overlay theme keeps its no-animation contract after the hook additions.
ok(/--ov-skin-radius/.test(THEME) && /--ov-skin-clip/.test(THEME), 'overlay-theme.css reads the skin hook variables');
ok(!/backdrop-filter\s*:/.test(THEME), 'overlay theme still ships no backdrop-filter');

// ---------------------------------------------------------------------------
console.log('--- ornament SVG budget ---');
// ---------------------------------------------------------------------------
for (const skin of HUD_SKIN_IDS) {
  for (const corner of ORNAMENT_CORNERS) {
    const bytes = Buffer.byteLength(ornamentSvgSource(skin, corner), 'utf8');
    ok(bytes <= 2048, `${skin}/${corner}: SVG ${bytes} B <= 2048 B`);
  }
  const emblem = ornamentEmblemSource(skin);
  if (emblem) {
    const bytes = Buffer.byteLength(emblem, 'utf8');
    ok(bytes <= 2048, `${skin}/emblem: SVG ${bytes} B <= 2048 B`);
  }
}
ok(
  Buffer.byteLength(ORNAMENTS_TSX, 'utf8') < 12000,
  `ornament module stays small (${Buffer.byteLength(ORNAMENTS_TSX, 'utf8')} B)`
);

// ---------------------------------------------------------------------------
console.log('--- ornaments never cover text (CSS gutter + short-panel variant) ---');
// ---------------------------------------------------------------------------
ok(ORNAMENT_MIN_PANEL_HEIGHT >= 34, `historical minimum panel height stays ${ORNAMENT_MIN_PANEL_HEIGHT}px (>= 34)`);
ok(
  !ORNAMENTS_TSX.includes('createTreeWalker') &&
    !ORNAMENTS_TSX.includes('new ResizeObserver') &&
    !ORNAMENTS_TSX.includes('new MutationObserver') &&
    !ORNAMENTS_TSX.includes('document.fonts') &&
    !ORNAMENTS_TSX.includes('getBoundingClientRect') &&
    !ORNAMENTS_TSX.includes('clientHeight'),
  'the ornaments component does no runtime measurement (no observers, text walk or layout reads)'
);
ok(
  /--ov-skin-orn-size:\s*clamp\(4px,\s*calc\(6px \* var\(--ov-skin-orn-scale/.test(CSS),
  'ornament size is clamped to the 6px padding gutter'
);
ok(
  /\.ov-skin-orn--tl\s*\{[^}]*top:\s*-1px[^}]*left:\s*-1px/.test(CSS) &&
    /\.ov-skin-orn--br\s*\{[^}]*bottom:\s*-1px[^}]*right:\s*-1px/.test(CSS),
  'corners sit on the border edge with negative offsets (outside the content box)'
);
ok(
  /\.ov-panel--short\s*>\s*\.ov-skin-orn-host\s*\{[^}]*display:\s*none/.test(CSS),
  'the known one-line panel variant hides its marks with a static class (min-height rule, no measurement)'
);
ok(CSS.includes('.ov-skin-orn-host') && /display:\s*contents/.test(CSS),
  'the ornament host adds no layout box');
ok(
  /:root\[data-ov-skin='bloodmoon'\] \.hud-rail-card/.test(CSS),
  'the left-rail section cards take the skin frame (bloodmoon hairline)'
);
ok(
  /html\.overlay-root \.hud-rail-card\s*\{[^}]*border-radius:\s*var\(--ov-skin-radius/.test(THEME),
  'the left-rail cards read the shared skin radius hook (no per-module fork, no layout change)'
);

// ---------------------------------------------------------------------------
console.log('--- skins cannot change module layout (D2 declaration ban) ---');
// ---------------------------------------------------------------------------
const MODULE_CONTAINERS = [
  '.ov-panel',
  '.hud-overlay-panel',
  '.hud-rail-card',
  '.hud-rail-stack',
  '.hud-overlay-scale',
  '.hud-chrome-header',
  '.hud-chrome-title',
  '.hud-chrome-meta',
  '.hud-chip',
  '.hud-chrome-cue',
  '.hud-ward',
  '.hud-gank',
  '.hud-studio-pin',
  '.hud-studio-stage',
  '.hud-studio-game',
];
/** Properties that would move a box or change how text wraps/clips. */
const LAYOUT_PROPS = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-inline',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'transform',
  'translate',
  'rotate',
  'scale',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'gap',
  'order',
  'display',
  'float',
  'grid-template-columns',
  'grid-template-rows',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'overflow',
  'text-overflow',
  'zoom',
  'contain',
]);

const banned: string[] = [];
for (const rule of RULES) {
  for (const selector of rule.selectors) {
    // Decorative layers are allowed to position themselves:
    //  - pseudo-elements (the arcane rings, hunter ticks)
    //  - ornament spans (absolutely placed marks)
    //  - the dashboard-only preview scope (settings cards, never the live HUD)
    if (/::?(before|after)\b/.test(selector)) continue;
    if (selector.includes('.ov-skin-orn')) continue;
    if (selector.includes('.hud-skin-scope') || selector.includes('.hud-skin-preview')) continue;
    const hitsContainer = MODULE_CONTAINERS.some((container) => selector.includes(container));
    if (!hitsContainer) continue;
    for (const decl of declarations(rule.body)) {
      const name = decl.split(':')[0].trim().toLowerCase();
      if (LAYOUT_PROPS.has(name)) {
        banned.push(`${selector} { ${decl} }`);
      }
    }
  }
}
ok(
  banned.length === 0,
  `hud-skins.css declares no layout/padding/margin/transform/inset/text-metric property on a module container${
    banned.length ? ` (found: ${banned.join(' | ')})` : ''
  }`
);

// ---------------------------------------------------------------------------
console.log('--- geometry guard: boxes + text clipping identical per skin (D2) ---');
// ---------------------------------------------------------------------------
const PANEL_WIDTH = 220; // RAIL_PANEL_SIZE.width (OverlayApp)
const OUTER_PAD = 16; // 8px horizontal panel padding each side (worst case)
const CONTENT_HEIGHT: Record<string, number> = { sums: 68, gank: 56, vision: 48, buy: 56, action: 40, mayhem: 60, frames: 0 };

function letterbox(vw: number, vh: number) {
  const displayAspect = vw / vh;
  const gameAspect = 1920 / 1080;
  let gameViewW: number;
  let gameViewH: number;
  let offsetX: number;
  let offsetY: number;
  if (displayAspect > gameAspect) {
    gameViewH = vh;
    gameViewW = vh * gameAspect;
    offsetX = (vw - gameViewW) / 2;
    offsetY = 0;
  } else {
    gameViewW = vw;
    gameViewH = vw / gameAspect;
    offsetX = 0;
    offsetY = (vh - gameViewH) / 2;
  }
  return { offsetX, offsetY, gameViewW, gameViewH, vw, vh };
}

/** Frame width a skin asks for (live HUD hook, border-box: content shrinks). */
function frameWidth(skin: HudSkin): number {
  const raw = varBlock(skin, '--ov-skin-border-width');
  const px = raw ? parseFloat(raw) : 1;
  return Number.isFinite(px) ? px : 1;
}

interface ModuleMetric {
  id: string;
  left: number | null;
  right: number | null;
  top: number;
  width: number;
  height: number;
  contentWidth: number;
}

function metricsFor(skin: HudSkin): ModuleMetric[] {
  const layout = dualRailLayout();
  const border = frameWidth(skin);
  const out: ModuleMetric[] = [];
  for (const viewport of [
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    const geo = letterbox(viewport[0], viewport[1]);
    for (const overlayScale of [1, 1.25, 1.5]) {
      for (const el of layout.elements) {
        if (!el.visible) continue;
        const style = layoutStyle(el as HudElement, geo);
        const width = PANEL_WIDTH + 2 * border;
        const height = (CONTENT_HEIGHT[el.id] ?? 48) + 2 * border;
        out.push({
          id: `${viewport[0]}x${viewport[1]}@${overlayScale}:${el.id}`,
          left: typeof style.left === 'number' ? Math.round((style.left as number) * overlayScale * 100) / 100 : null,
          right: typeof style.right === 'number' ? Math.round((style.right as number) * overlayScale * 100) / 100 : null,
          top: Math.round((style.top as number) * overlayScale * 100) / 100,
          width,
          height,
          contentWidth: PANEL_WIDTH - 2 * border - OUTER_PAD,
        });
      }
    }
  }
  return out;
}

const gothicMetrics = JSON.stringify(metricsFor('gothic'));
for (const skin of HUD_SKIN_IDS) {
  const same = JSON.stringify(metricsFor(skin)) === gothicMetrics;
  ok(same, `${skin}: module boxes, offsets and text width match gothic (1080p/1440p × 100/125/150%)`);
  ok(frameWidth(skin) === 1, `${skin}: frame stays a 1px hairline (border-box content width unchanged)`);
}
for (const skin of HUD_SKIN_IDS) {
  const rules = RULES.filter((rule) =>
    rule.selectors.some((s) => s === `[data-ov-skin='${skin}']`)
  );
  const textProps = rules.flatMap((rule) =>
    declarations(rule.body).filter((d) => /^(font-size|line-height|letter-spacing)\s*:/.test(d))
  );
  ok(textProps.length === 0, `${skin}: no text-metric overrides (clipping identical to gothic)`);
}

// Skin CSS is applied through one attribute on the root; the studio preview
// scope draws the same classes, so settings cards show the real CSS.
ok(/(?:^|\n)\[data-ov-skin='gothic'\]/.test(CSS), 'gothic has an explicit CSS block (default look)');
ok(!(HUD_SKIN_IDS as readonly string[]).includes('auto'), 'auto is a selection, never a CSS skin block');

if (failures > 0) {
  console.error(`verify:hud-skins FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('verify:hud-skins ok');
