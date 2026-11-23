/**
 * Step E guardrail: the overlay ranks augments from the refreshed bundle, not
 * the build-time static import. Delivery is a dedicated one-shot IPC channel
 * (never the ordinary metadata broadcast), and a null/throw never erases a
 * previously good bundle.
 *
 * Wiring is asserted on source (Electron IPC cannot run under tsx); the ranking
 * of an augment that exists only in the refreshed bundle is asserted on real
 * logic. Run: npx --yes tsx verify_mayhem_bundle_wiring.ts
 */
import fs from 'node:fs';
import assert from 'node:assert';
import bundle from './src/data/mayhem/bundle.json';
import { rankMayhemChoices } from './src/logic/mayhem/rank';
import { validateMayhemBundle } from './src/logic/mayhem/bundleSanitize';
import type { MayhemBundle } from './src/logic/mayhem/types';
import type { Champion } from './src/logic/pykeLogic';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}
function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n');
}
function section(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  return from >= 0 && to > from ? src.slice(from, to) : '';
}
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const app = read('src/overlay/OverlayApp.tsx');
const main = read('electron/main.ts');
const monitor = read('electron/game-monitor.ts');
const overlayWindow = read('electron/overlay-window.ts');
const preload = read('electron/preload.ts');
const types = read('src/types.d.ts');

console.log('--- renderer: mount fetch, then subscribe ---');
const mount = section(
  app,
  '  useEffect(() => {\n    let pushed = false;',
  '  useEffect(() => {\n    if (!window.electronAPI?.onOverlayUpdate) return;'
);
ok(mount.length > 0, 'the overlay has a dedicated bundle mount effect');
const fetchAt = mount.indexOf('getMayhemBundle');
const subscribeAt = mount.indexOf('onMayhemBundleUpdate');
ok(fetchAt >= 0, 'mount calls getMayhemBundle()');
ok(subscribeAt >= 0, 'mount subscribes to bundle updates');
ok(fetchAt >= 0 && subscribeAt > fetchAt, 'the mount fetch is issued before the update subscription');
ok(mount.includes('if (res?.success && !pushed) accept(res.bundle, false);'), 'a good fetch result is accepted');
ok(mount.includes('.catch(() => {'), 'a failed fetch is isolated');
ok(mount.includes('} catch {'), 'a throwing bridge is isolated');
ok(mount.includes('unsubBundle?.();'), 'the update subscription is cleaned up on unmount');

console.log('--- renderer: null/throw isolation keeps the last good bundle ---');
const acceptGuardAt = mount.indexOf('if (!isUsableMayhemBundle(value)) return;');
const setStateAt = mount.indexOf('setMayhemBundle(value);');
ok(acceptGuardAt >= 0 && setStateAt > acceptGuardAt, 'only a validated bundle reaches state');
ok(count(app, 'setMayhemBundle(') === 1, 'there is exactly one state writer, so null cannot erase the last bundle');
ok(app.includes('useState<MayhemBundle>(FALLBACK_MAYHEM_BUNDLE)'), 'the static bundle is the explicit last-resort initial state');
ok(count(app, 'FALLBACK_MAYHEM_BUNDLE') === 2, 'the static fallback is only defined and used as the initial state');
ok(
  app.includes('validateMayhemBundle(bundle as MayhemBundle).length === 0'),
  'the renderer validates fetched/pushed bundles with the shared validator'
);

console.log('--- renderer: both rank paths use the reactive bundle ---');
const buildMemo = section(app, '  const build: Build | null = useMemo(() => {', '  const analysis: MatchupAnalysis | null = useMemo(');
ok(buildMemo.includes('adjustBuildForMayhem(base, state.mayhemOwnedIds || [], mayhemBundle)'), 'build adjustment uses the reactive bundle');
ok(buildMemo.includes('mayhemBundle,'), 'build adjustment re-runs when the bundle changes');
const rankMemo = section(app, '  const mayhemRanked = useMemo(() => {', '  // Depend on a 1 Hz tick, not Date.now() at render time:');
ok(rankMemo.includes('rankMayhemChoices(mayhemChampion, owned, displayMayhemOfferIds, mayhemBundle)'), 'ranking uses the reactive bundle');
ok(rankMemo.includes('mayhemBundle]'), 'ranking re-runs when the bundle changes');

console.log('--- dedicated delivery, not the metadata broadcast ---');
const sendFn = section(overlayWindow, 'export function broadcastMayhemBundleUpdate', 'interface OverlayUpdatePayload {');
ok(sendFn.length > 0, 'overlay-window exposes one dedicated bundle-update sender');
ok(sendFn.includes("win.webContents.send('mayhem-bundle-updated', bundle)"), 'the sender uses a dedicated channel');
ok(count(overlayWindow, "webContents.send('mayhem-bundle-updated'") === 1, 'there is exactly one full-bundle send site');
const meta = section(overlayWindow, 'export function broadcastOverlayMeta', '/**\n * One-shot push of a freshly fetched augment bundle.');
ok(!meta.includes('mayhem-bundle-updated'), 'ordinary metadata broadcasts never send a bundle update');
ok(!meta.includes('broadcastMayhemBundleUpdate'), 'no bundle push is embedded in the metadata path');
const bridge = section(preload, '    onMayhemBundleUpdate: (callback:', "    refreshMayhemBundle: () => ipcRenderer.invoke('mayhem-refresh'),");
ok(bridge.includes("ipcRenderer.on('mayhem-bundle-updated', listener)"), 'preload bridges the new channel');
ok(bridge.includes("removeListener('mayhem-bundle-updated', listener)"), 'preload unbridges it on cleanup');
ok(types.includes('onMayhemBundleUpdate?: (callback: (bundle: unknown) => void)'), 'the API type declares the new channel');

console.log('--- only genuinely successful refreshes deliver ---');
const startup = section(main, '    // Follow the live patch on startup:', '    // IPC Handlers');
ok(startup.includes('result.refreshed && result.bundle'), 'startup only acts on a real refresh');
ok(startup.includes('broadcastMayhemBundleUpdate(result.bundle)'), 'startup delivers the refreshed bundle');
const manual = section(main, "    ipcMain.handle('mayhem-refresh', async () => {", "    ipcMain.handle('overlay-sync-league-scales', async");
ok(/fromNetwork && bundle[\s\S]*?broadcastMayhemBundleUpdate\(bundle\)/.test(manual), 'manual refresh delivers only on a network success');
ok(manual.includes("console.warn('[mayhem] overlay bundle push failed:'"), 'a failed overlay push cannot fail the manual refresh');
const matchStart = section(monitor, '    // Follow the live patch: a new patch adds augments', '    clearPlayRecap();');
ok(matchStart.includes('result.refreshed && result.bundle'), 'match start only acts on a real refresh');
ok(matchStart.includes('broadcastMayhemBundleUpdate(result.bundle)'), 'match start delivers the refreshed bundle (mid-match refresh delivery)');
ok(count(main, 'broadcastMayhemBundleUpdate(') === 2, 'main pushes at startup and on manual network refresh only');
ok(count(monitor, 'broadcastMayhemBundleUpdate(') === 1, 'game-monitor pushes once at match start only');
const mayhemGet = section(main, "    ipcMain.handle('mayhem-get', async () => {", "    ipcMain.handle('mayhem-set-owned', async");
ok(mayhemGet.includes('try {') && mayhemGet.includes("console.warn('[mayhem] bundle read failed:'"), 'the mount read isolates loadMayhemBundle() and logs failure');
ok(mayhemGet.includes('return { success: false }'), 'a failed mount read returns a clean refusal instead of throwing');

console.log('--- an augment absent from the static bundle ranks normally from the refreshed one ---');
const base = bundle as MayhemBundle;
const NEW_ID = 'verify_refreshed_only_augment';
const refreshed: MayhemBundle = {
  ...base,
  augments: [
    ...base.augments,
    {
      id: NEW_ID,
      slug: 'verify-refreshed-only',
      name: 'Refreshed Only Augment',
      rarity: 'gold',
      pickRate: 0.5,
      pickRateRank: 1,
      tags: ['ap'],
    },
  ],
  combos: [...base.combos, { championId: 'Kayn', augmentIds: [NEW_ID], types: ['strong'] }],
};
assert.equal(validateMayhemBundle(base).length, 0, 'static bundle passes the shared validator');
assert.equal(validateMayhemBundle(refreshed).length, 0, 'refreshed bundle passes the shared validator');
const kayn: Champion = {
  id: 'Kayn',
  key: '141',
  name: 'Kayn',
  tags: ['Assassin', 'Fighter'],
  damageType: 'Physical',
};
const fromStatic = rankMayhemChoices(kayn, [], [NEW_ID], base);
const fromRefreshed = rankMayhemChoices(kayn, [], [NEW_ID], refreshed);
ok(
  fromStatic.length === 1 && fromStatic[0].reasons?.includes('Not in the database for this patch'),
  'the static bundle shows the new augment only as an unknown placeholder'
);
ok(
  fromRefreshed.length === 1 &&
    fromRefreshed[0].augmentId === NEW_ID &&
    fromRefreshed[0].name === 'Refreshed Only Augment' &&
    !fromRefreshed[0].reasons?.includes('Not in the database for this patch'),
  'the refreshed bundle ranks the new augment normally (no stale/static fallback)'
);

console.log('--- renderer keeps and ranks all four cards ---');
const displaySection = section(app, '  const displayMayhemOfferIds = useMemo(() => {', '  const mayhemRanked = useMemo(() => {');
ok(displaySection.length > 0, 'the renderer has a displayed-roll derivation');
ok(!displaySection.includes('slice(0, 3)'), 'the renderer does not truncate the roll to three cards');
const fourIds = ['recursion', 'eureka', 'goliath', 'dashing'];
ok(rankMayhemChoices(kayn, [], fourIds, base).length === 4, 'four incoming ids are all ranked (renderer-facing)');

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log('verify_mayhem_bundle_wiring: PASS');
}
