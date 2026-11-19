/**
 * Step C2 — the overlay must not be OCR'd back as augment cards.
 *
 * Content protection (WDA_EXCLUDEFROMCAPTURE) is applied to every overlay
 * surface through one seam, independent of the user's screenshot setting.
 * The seam is exercised directly and its three call sites are pinned in source.
 */
import fs from 'node:fs';
import { mayhemOverlaySelfCaptureProtected } from './electron/overlay-window';

let failures = 0;
function ok(condition: boolean, msg: string): void {
    if (condition) {
        console.log('ok', msg);
    } else {
        failures += 1;
        console.error('FAIL', msg);
    }
}

ok(mayhemOverlaySelfCaptureProtected() === true, 'the overlay is always protected from self-capture');

const source = fs.readFileSync('electron/overlay-window.ts', 'utf8');
const fnAt = source.indexOf('export function mayhemOverlaySelfCaptureProtected(): boolean {');
ok(fnAt >= 0, 'overlay-window.ts exports the self-capture protection seam');
ok(
    fnAt >= 0 && /mayhemOverlaySelfCaptureProtected\(\): boolean \{\s*return true;/.test(source.slice(fnAt)),
    'the seam resolves to protection enabled (true)'
);
ok(
    source.includes('win.setContentProtection(mayhemOverlaySelfCaptureProtected()'),
    'the Electron surface calls setContentProtection through the seam'
);
ok(
    source.includes('nativeSurface.setCaptureProtection(mayhemOverlaySelfCaptureProtected()'),
    'the native surface refresh calls setCaptureProtection through the seam'
);
ok(
    source.includes('captureProtection: mayhemOverlaySelfCaptureProtected()'),
    'native window creation passes captureProtection through the seam'
);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
ok(
    pkg.scripts['verify:mayhem-self-capture'] === 'npx --yes tsx verify_mayhem_self_capture.ts',
    'package.json has a verify:mayhem-self-capture script'
);
ok(
    (pkg.scripts['verify:release'] ?? '').includes('verify:mayhem-self-capture'),
    'verify:release runs verify:mayhem-self-capture'
);

if (failures) {
    console.error(`verify:mayhem-self-capture FAILED (${failures})`);
    process.exit(1);
}
console.log('verify:mayhem-self-capture ok');
