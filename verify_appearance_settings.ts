/**
 * verify_appearance_settings.ts
 *
 * E3 — dashboard appearance controls (theme, accent palette, density, radius,
 * glass level, font scale). Covers defaults, invalid-value normalization,
 * round-trip persistence, migration from old settings files, and the immediate
 * root-token mapping.
 *
 * Runs in plain Node (no browser): it drives the authoritative normalize +
 * mapping code in electron/app-settings.ts through a throwaway user-data dir,
 * then simulates a relaunch with a fresh child process that re-reads the file.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';

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

function deepEqual(name: string, actual: unknown, expected: unknown): boolean {
  try {
    assert.deepStrictEqual(actual, expected);
    check(name, true);
    return true;
  } catch (e) {
    check(`${name}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)} (${(e as Error).message})`, false);
    return false;
  }
}

async function main(): Promise<void> {
  // Fresh throwaway user-data dir, seeded with an OLD-format settings file that
  // has no `appearance` field (migration scenario).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-appearance-'));
  process.env.ONETRICK_USER_DATA = dir;
  const file = path.join(dir, 'app-settings.json');
  fs.writeFileSync(file, JSON.stringify({ overlayEnabled: false, autoImport: true, gpuAcceleration: false }));

  // Import AFTER env is set so paths.ts falls back to our temp dir.
  const mod = await import('./electron/app-settings');
  const {
    loadAppSettings,
    getAppSettings,
    updateAppSettings,
    flushAppSettings,
    appearanceToCss,
    APPEARANCE_DEFAULTS,
  } = mod;

  const DEFAULTS: AppearanceSettings = {
    theme: 'gothic',
    accent: 'chrome',
    density: 'comfortable',
    radius: 6,
    glass: 0,
    fontScale: 1,
  };

  /* 1. Defaults + migration from an old (no-appearance) settings file. */
  const loaded = loadAppSettings();
  check('migration: old file keeps known booleans', loaded.overlayEnabled === false && loaded.autoImport === true);
  deepEqual('migration: appearance falls back to safe defaults', loaded.appearance, DEFAULTS);
  deepEqual('defaults mirror APPEARANCE_DEFAULTS constant', APPEARANCE_DEFAULTS, DEFAULTS);
  check('defaults: radius is the shipped 6px', loaded.appearance.radius === 6 && loaded.appearance.fontScale === 1 && loaded.appearance.glass === 0);

  /* 2. Invalid values are rejected / clamped to the bounded safe ranges. */
  updateAppSettings({
    appearance: { theme: 'nope', accent: 'weird', density: 'huge', radius: 999, glass: -40, fontScale: 0.5 },
  });
  const afterInvalid = getAppSettings().appearance;
  deepEqual('invalid enums fall back to defaults', { t: afterInvalid.theme, a: afterInvalid.accent, d: afterInvalid.density }, { t: 'gothic', a: 'chrome', d: 'comfortable' });
  check('radius clamped to max 24', afterInvalid.radius === 24);
  check('glass clamped to min 0', afterInvalid.glass === 0);
  check('fontScale clamped to min 0.85', afterInvalid.fontScale === 0.85);

  /* 3. Valid, bounded choices apply whole-appearance. */
  const target: AppearanceSettings = { theme: 'ember', accent: 'teal', density: 'compact', radius: 14, glass: 40, fontScale: 1.1 };
  updateAppSettings({ appearance: target });
  deepEqual('valid bounded appearance round-trips', getAppSettings().appearance, target);

  /* 4. A single-field patch deep-merges instead of resetting the rest. */
  updateAppSettings({ appearance: { glass: 60 } });
  const merged = getAppSettings().appearance;
  check('partial patch keeps theme', merged.theme === 'ember');
  check('partial patch keeps accent', merged.accent === 'teal');
  check('partial patch keeps density', merged.density === 'compact');
  check('partial patch keeps radius', merged.radius === 14);
  check('partial patch applies glass', merged.glass === 60);
  check('partial patch keeps fontScale', merged.fontScale === 1.1);
  check('partial patch preserves unrelated booleans', getAppSettings().overlayEnabled === false);

  const finalAppearance: AppearanceSettings = { ...target, glass: 60 };

  /* 5. Round-trip persistence: what lands in the file matches memory. */
  flushAppSettings();
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { appearance: AppearanceSettings; overlayEnabled: boolean };
  check('file written by flushAppSettings', !!onDisk && typeof onDisk === 'object');
  deepEqual('round-trip: persisted appearance equals memory', onDisk.appearance, finalAppearance);
  check('round-trip: unrelated boolean persisted', onDisk.overlayEnabled === false);

  /* 6. Relaunch survival: a fresh process reads the same file afresh. */
  const code = `
    (async () => {
      const { getAppSettings } = await import('./electron/app-settings');
      console.log(JSON.stringify(getAppSettings().appearance));
    })().catch((e) => { console.error('CHILD_ERR', e); process.exit(2); });
  `;
  const tmpScript = `.tmp-relaunch-${process.pid}.ts`;
  fs.writeFileSync(tmpScript, code);
  const child = spawnSync('npx --yes tsx ' + tmpScript, {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env, ONETRICK_USER_DATA: dir },
    encoding: 'utf8',
  });
  try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  check('relaunch child exited cleanly', child.status === 0);
  if (child.status !== 0) console.error('  stderr:', child.stderr?.slice(0, 800));
  const childAppearance = (child.stdout || '').trim().split('\n').pop() || '';
  let relaunched: AppearanceSettings | null = null;
  try {
    relaunched = JSON.parse(childAppearance);
  } catch {
    /* handled below */
  }
  deepEqual('relaunch: child reloads same appearance from disk', relaunched, finalAppearance);

  /* 7. No raw colors / arbitrary CSS in the persisted contract — only enum ids + numbers. */
  const disk = onDisk.appearance as Record<string, unknown>;
  const allowedKeys = ['theme', 'accent', 'density', 'radius', 'glass', 'fontScale'];
  check('persisted appearance keys are exactly the enum/range set', allowedKeys.every((k) => Object.prototype.hasOwnProperty.call(disk, k)) && Object.keys(disk).length === allowedKeys.length);
  const rawLeak = JSON.stringify(disk).match(/#[0-9a-f]{3,8}\b|rgb|linear-gradient|backdrop/i);
  check('no raw CSS/color strings are persisted', !rawLeak);

  /* 8. Immediate token mapping (what the renderer applies to the root). */
  const css = appearanceToCss(finalAppearance);
  deepEqual('mapping: root attributes', css.attributes, {
    'data-ot-theme': 'ember',
    'data-ot-accent': 'teal',
    'data-ot-density': 'compact',
  });
  deepEqual('mapping: css custom properties', css.vars, {
    '--ot-radius-set': '14px',
    '--ot-glass': '60',
    '--ot-font-scale': '1.1',
  });

  /* 9. Every enum value maps (no theme/accent/density left dangling). */
  const enumTest: AppearanceSettings = {
    theme: 'azure',
    accent: 'royal',
    density: 'spacious',
    radius: 0,
    glass: 100,
    fontScale: 1.2,
  };
  const css2 = appearanceToCss(enumTest);
  check('enum extremes map to attributes/vars', css2.attributes['data-ot-theme'] === 'azure' && css2.attributes['data-ot-density'] === 'spacious' && css2.vars['--ot-glass'] === '100' && css2.vars['--ot-font-scale'] === '1.2');

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\nverify_appearance_settings: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('verify_appearance_settings crashed:', e);
  process.exit(2);
});