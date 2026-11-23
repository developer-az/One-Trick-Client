/**
 * Mayhem first-run defaults + one-time settings migration.
 *
 * Mayhem now ships on. A store written by an older build has `mayhem: false`
 * because that was the install default, so the main-process settings store
 * flips it once and stamps `mayhemDefaultsMigrated`. A stamped store is left
 * alone - a user who turns Mayhem off stays off. The store's first-settle
 * decision (decideSettingsLoad) is asserted behaviourally; only its wiring in
 * loadSettings is source-guarded.
 *
 * Run: npx --yes tsx verify_mayhem_defaults.ts
 */
import fs from 'node:fs';
import assert from 'node:assert';
import {
  DEFAULT_HUD_MODULES,
  MAYHEM_DEFAULTS_MIGRATION_KEY,
  migrateMayhemDefaults,
  normalizeHudModules,
} from './src/overlay/hudModules';
import { dualRailLayout, layoutToHudModules, normalizeHudLayout } from './src/overlay/hudLayout';
import { decideSettingsLoad } from './electron/overlay-window';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n');
}

type Store = {
  hudModules?: Record<string, unknown>;
  hudLayout?: { name?: unknown; elements?: Array<Record<string, unknown>>; stickers?: unknown };
  [key: string]: unknown;
};

function mayhemElement(store: Store): Record<string, unknown> | undefined {
  return store.hudLayout?.elements?.find((el) => el.id === 'mayhem');
}

/* --- 1. Fresh installs render Mayhem without touching any toggle. --- */
ok(DEFAULT_HUD_MODULES.mayhem === true, 'shared DEFAULT_HUD_MODULES ships Mayhem on');
ok(normalizeHudModules({}).mayhem === true, 'missing module key falls back to Mayhem on');
ok(
  dualRailLayout().elements.find((el) => el.id === 'mayhem')?.visible === true,
  'dual-rail default rail shows Mayhem'
);
ok(
  normalizeHudLayout({}).elements.find((el) => el.id === 'mayhem')?.visible === true,
  'renderer layout normalize fills Mayhem visible'
);
ok(layoutToHudModules(dualRailLayout()).mayhem === true, 'dual rail maps to a Mayhem-on module set');

/* Stored choices still win: the renderer normalize is not a forced default. */
ok(normalizeHudModules({ mayhem: false }).mayhem === false, 'explicit stored off survives normalize');
ok(
  normalizeHudLayout({ elements: [{ id: 'mayhem', visible: false }] }).elements.find(
    (el) => el.id === 'mayhem'
  )?.visible === false,
  'explicit stored layout off survives normalize'
);

/* --- 2. A stamped store keeps the user's off switch exactly. --- */
const optedOut: Store = {
  [MAYHEM_DEFAULTS_MIGRATION_KEY]: true,
  hudScale: 42,
  preferLeagueCfg: false,
  hudModules: { sums: true, gank: true, vision: true, buy: true, action: true, mayhem: false, frames: false },
  hudLayout: {
    name: 'Mine',
    elements: [{ id: 'mayhem', visible: false, x: 0.982, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' }],
  },
};

const honoured = migrateMayhemDefaults(optedOut);
ok(honoured.migrated === false, 'stamped store is not migrated again');
ok(honoured.settings === optedOut, 'stamped store is returned untouched');
ok(honoured.settings.hudModules?.mayhem === false, 'stamped store keeps Mayhem off');
ok(mayhemElement(honoured.settings)?.visible === false, 'stamped store keeps the Mayhem element hidden');
ok(
  normalizeHudModules(JSON.parse(JSON.stringify(honoured.settings)).hudModules).mayhem === false,
  'stamped store still off after a disk round trip'
);

/* --- 3. A legacy store (off, no marker) is flipped once and stamped. --- */
const legacyElements = [
  { id: 'sums', visible: false, x: 0.018, y: 0.078, scale: 1, opacity: 1, anchor: 'tl' },
  { id: 'mayhem', visible: false, x: 0.982, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' },
  { id: 'frames', visible: false, x: 0.5, y: 0.82, scale: 1, opacity: 1, anchor: 'center' },
];
const legacyStickers = [{ id: 'pin-1', kind: 'text', label: 'ONE TRICK', x: 0.5, y: 0.5, scale: 1, opacity: 1 }];
const skin = { style: 'gothic', trim: 'gold' };
const legacyStore: Store = {
  hudScale: 42,
  mapScale: 55,
  preferLeagueCfg: false,
  hudModules: { sums: false, gank: true, vision: true, buy: true, action: true, mayhem: false, frames: false },
  hudLayout: { name: 'Mine', elements: legacyElements, stickers: legacyStickers },
  hudSkin: skin,
  overlayBackend: 'native',
};

const migrated = migrateMayhemDefaults(legacyStore);
ok(migrated.migrated === true, 'legacy store migrates');
ok(migrated.settings[MAYHEM_DEFAULTS_MIGRATION_KEY] === true, 'legacy store gains the migration marker');
ok(migrated.settings.hudModules?.mayhem === true, 'legacy store turns Mayhem on');
ok(mayhemElement(migrated.settings)?.visible === true, 'legacy store makes the Mayhem element visible');

const untouched = (migrated.settings.hudLayout?.elements ?? []).filter((el) => el.id !== 'mayhem');
assert.deepStrictEqual(untouched, legacyElements.filter((el) => el.id !== 'mayhem'));
ok(migrated.settings.hudLayout?.stickers === legacyStickers, 'stickers untouched');
ok(migrated.settings.hudModules?.sums === false, 'other module toggles untouched');
ok(
  migrated.settings.hudModules?.gank === true &&
    migrated.settings.hudModules?.frames === false &&
    migrated.settings.hudModules?.action === true,
  'every other module value preserved'
);
ok(migrated.settings.hudScale === 42 && migrated.settings.mapScale === 55, 'unrelated settings untouched');
ok(migrated.settings.hudSkin === skin && migrated.settings.overlayBackend === 'native', 'skin/backend untouched');
/* Purity: the parsed store passed in is not mutated (a failed write must not
 * leave memory disagreeing with disk). */
ok(legacyStore.hudModules?.mayhem === false, 'migration input is not mutated');

/* --- 4. Second load after the user turns Mayhem off keeps it off. --- */
const userSavedOff = JSON.parse(JSON.stringify(migrated.settings)) as Store;
userSavedOff.hudModules = { ...userSavedOff.hudModules, mayhem: false };
if (userSavedOff.hudLayout?.elements) {
  userSavedOff.hudLayout.elements = userSavedOff.hudLayout.elements.map((el) =>
    el.id === 'mayhem' ? { ...el, visible: false } : el
  );
}
const relaunched = migrateMayhemDefaults(userSavedOff);
ok(relaunched.migrated === false, 'relaunch sees the marker and skips migration');
ok(normalizeHudModules(relaunched.settings.hudModules).mayhem === false, 'relaunch keeps the user off switch');
ok(mayhemElement(relaunched.settings)?.visible === false, 'relaunch keeps the element hidden');

/* --- 4b. The settings-load decision itself is proven behaviourally. --- */
const legacyModules = { ...DEFAULT_HUD_MODULES, mayhem: false };
const unstamped: Store = {
  hudModules: legacyModules,
  hudLayout: { elements: [{ id: 'mayhem', visible: false }] },
};
const firstLoad = decideSettingsLoad(false, unstamped);
ok(firstLoad.migrate === true && firstLoad.write === true, 'no marker: migrate + write on the first load');
ok(firstLoad.useStoredHudModules === true, 'the first load reads the stored module map');
ok(firstLoad.log === true, 'the first load logs the settings-migrated outcome');

const stamped: Store = {
  [MAYHEM_DEFAULTS_MIGRATION_KEY]: true,
  hudModules: legacyModules,
};
const stampedLoad = decideSettingsLoad(false, stamped);
ok(stampedLoad.migrate === false && stampedLoad.write === false, 'marker present: no migrate and no write');
ok(stampedLoad.log === true, 'the settling load still logs once when nothing was migrated');

const settledLoad = decideSettingsLoad(true, unstamped);
ok(
  settledLoad.useStoredHudModules === false &&
    settledLoad.migrate === false &&
    settledLoad.write === false &&
    settledLoad.log === false,
  'a settled process re-reads nothing, re-flips nothing and does not log again'
);

/* A user's stamped mayhem:false survives two loads in one process: the first
 * reads it, the second must leave the live map alone. */
{
  let live = normalizeHudModules(DEFAULT_HUD_MODULES);
  for (const wasSettled of [false, true]) {
    const decision = decideSettingsLoad(wasSettled, stamped);
    if (decision.useStoredHudModules) live = normalizeHudModules(stamped.hudModules);
    if (decision.migrate) {
      live = normalizeHudModules(migrateMayhemDefaults(stamped).settings.hudModules);
    }
  }
  ok(live.mayhem === false, 'a stamped user off switch survives two loads');
}

/* --- 5. Main-process copy + store wiring (thin source guard; behaviour is
 * proven through decideSettingsLoad above). --- */
const electronSource = read('electron/overlay-window.ts');
/* The main process must not keep a private twin of the shared defaults: it
 * imports src/overlay/hudModules, so the two cannot drift apart. */
ok(
  /import\s*\{[^}]*\bDEFAULT_HUD_MODULES\b[^}]*\}\s*from\s*'\.\.\/src\/overlay\/hudModules'/.test(electronSource),
  'main process imports the shared DEFAULT_HUD_MODULES'
);
ok(
  /import\s*\{[^}]*\bHUD_MODULE_IDS\b[^}]*\}\s*from\s*'\.\.\/src\/overlay\/hudModules'/.test(electronSource),
  'main process imports the shared HUD_MODULE_IDS'
);
ok(!/const DEFAULT_HUD_MODULES\b/.test(electronSource), 'no private DEFAULT_HUD_MODULES literal in the main process');
ok(!/const HUD_MODULE_IDS\b/.test(electronSource), 'no private HUD_MODULE_IDS literal in the main process');
ok(!/function normalizeHudModules\(/.test(electronSource), 'main process reuses the shared module normalizer');
ok(
  !/id:\s*'mayhem',\s*visible:\s*false/.test(electronSource),
  'no main-process widget default hides Mayhem'
);
ok(electronSource.includes('migrateMayhemDefaults(settings)'), 'loadSettings runs the one-time migration');
ok(
  electronSource.includes('decideSettingsLoad(wasSettled, settings)'),
  'loadSettings delegates its first-settle decision to decideSettingsLoad'
);
ok(electronSource.includes('mayhemDefaultsMigrated: true'), 'saved settings stamp the migration marker');
ok(electronSource.includes('writeMigratedMayhemSettings('), 'migration result is persisted in place');
ok(/overlayLog\(\s*'settings-migrated'/.test(electronSource), 'the migration outcome is logged as settings-migrated');

if (!process.exitCode) console.log('verify:mayhem-defaults ok');
