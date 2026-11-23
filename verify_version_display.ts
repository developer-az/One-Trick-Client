/**
 * The running client must identify its own build everywhere the user looks:
 * the package version is read once, carried in the window title and rendered
 * with the same `v<version>` badge in the dashboard and overlay.
 */
import fs from 'node:fs';
import { readAppVersion, windowTitleFor } from './electron/build-info-logic';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

const version = readAppVersion({ name: 'one-trick', version: '1.7.1-test.16' });
ok(version === '1.7.1-test.16', `readAppVersion returns 1.7.1-test.16 (${version})`);
ok(readAppVersion({ version: 42 }) === null && readAppVersion(null) === null, 'readAppVersion: bad input -> null');

const title = windowTitleFor(null, version ?? '');
ok(title.includes('v1.7.1-test.16'), `windowTitleFor includes version (${title})`);
ok(title === 'One Trick v1.7.1-test.16', `windowTitleFor: plain build (${title})`);
const testTitle = windowTitleFor('first-run', version ?? '');
ok(testTitle === 'One Trick v1.7.1-test.16 · TEST BUILD first-run', `windowTitleFor: test build (${testTitle})`);

const badge = `v${version}`;
ok(badge === 'v1.7.1-test.16', `badge format is v1.7.1-test.16 (${badge})`);
ok(testTitle.includes(badge) && title.includes(badge), 'title carries the same badge as the UI');

// The mount-time status read must carry the same version as the overlay-meta
// push: that push can land before React subscribes, leaving the chrome bare.
const read = (rel: string): string => fs.readFileSync(rel, 'utf8');
const MAIN = read('electron/main.ts');
const TYPES = read('src/types.d.ts');
const OVERLAY_APP = read('src/overlay/OverlayApp.tsx');

const statusHandler = MAIN.match(/ipcMain\.handle\('overlay-get-status'[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
ok(
  /version:\s*(?:appVersion\s*\?\?\s*)?app\.getVersion\(\)/.test(statusHandler),
  'overlay-get-status payload carries version from the same source as overlay-meta'
);
const statusType = TYPES.match(/getOverlayStatus:\s*\(\)\s*=>\s*Promise<\{[\s\S]*?\}>/)?.[0] ?? '';
ok(/\bversion\?:\s*string;/.test(statusType), 'getOverlayStatus bridge type exposes optional version');
ok(
  /if \(typeof meta\.version === 'string'\) setAppVersion\(meta\.version\);/.test(OVERLAY_APP),
  'applyMeta consumes version into the appVersion state both chrome titles read'
);
ok(
  /getOverlayStatus\?\.\(\)\.then\(\(res\) => \{[\s\S]*?applyMeta\(res\)/.test(OVERLAY_APP),
  'mount status call feeds applyMeta, so status.version reaches appVersion'
);
ok(
  /One Trick\{appVersion \? ` v\$\{appVersion\}` : ''\}/.test(OVERLAY_APP) &&
    /One Trick\{version \? ` v\$\{version\}` : ''\}/.test(OVERLAY_APP),
  'both chrome titles keep the plain One Trick fallback when version is absent'
);
