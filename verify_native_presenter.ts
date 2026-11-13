/**
 * Native overlay presenter: the HUD leaves Chromium.
 *
 * History: the single-window Electron overlay (Step 2, 2026-11-10) still
 * vanished ~10 min into real matches with every app-side signal healthy.
 * The failure is in Chromium's presentation path (DirectComposition surface
 * promoted to an MPO hardware plane), not in app code — so the remake
 * changes what presents the pixels: Chromium renders the same OverlayApp
 * offscreen, and onetrick-presenter.exe (a plain Win32 layered window)
 * presents the frames. These checks pin that structure.
 *
 * Proven against the pre-remake tree (45d7248), where they fail: no
 * presenter source, no driver, no backend switch.
 */
import fs from 'node:fs';
import {
    PRESENTER_MSG,
    PRESENTER_PIPE_NAME,
    PRESENTER_PROTOCOL_VERSION,
    createPresenterMessageParser,
    encodePresenterMessage,
} from './electron/overlay-presenter';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function read(rel: string): string {
    return fs.readFileSync(rel, 'utf8');
}

// ---- the presenter is a plain Win32 layered window, nothing else ----
const presenterC = read('native/presenter/presenter.c');
ok(presenterC.includes('UpdateLayeredWindow'), 'presenter.c presents with UpdateLayeredWindow');
ok(presenterC.includes('WS_EX_LAYERED'), 'presenter.c creates a layered window');
ok(presenterC.includes('ULW_ALPHA'), 'presenter.c presents with per-pixel alpha (ULW_ALPHA)');
ok(presenterC.includes('WS_EX_TOPMOST'), 'presenter.c stays topmost');
ok(presenterC.includes('WS_EX_TRANSPARENT'), 'presenter.c toggles click-through via WS_EX_TRANSPARENT');
ok(presenterC.includes('WDA_EXCLUDEFROMCAPTURE') || presenterC.includes('0x11'), 'presenter.c supports capture exclusion');
ok(presenterC.includes('onetrick-presenter'), 'presenter.c listens on the onetrick-presenter pipe');
ok(presenterC.includes('presenter.log'), 'presenter.c logs its lifecycle to presenter.log');
ok(presenterC.includes('"created"'), 'presenter.c logs created');
ok(presenterC.includes('destroy frames='), 'presenter.c logs destroy with its frame count');
for (const required of ['PIPE_TYPE_BYTE', 'WM_NCHITTEST', 'WM_MOUSEACTIVATE', 'MA_NOACTIVATE', 'SetTimer', 'no-client-timeout']) {
    ok(presenterC.includes(required), `presenter.c contains ${required}`);
}
for (const banned of ['SetWinEventHook', 'SendInput', 'mouse_event', 'keybd_event', 'SetForegroundWindow', 'SetActiveWindow']) {
    ok(!presenterC.includes(banned), `presenter.c never calls ${banned} (passive/read-only rule)`);
}
for (const banned of ['SetWindowsHookEx', 'ReadProcessMemory', 'WriteProcessMemory', 'CreateRemoteThread', 'WSAStartup']) {
    ok(!presenterC.includes(banned), `presenter.c never calls ${banned} (passive/read-only rule)`);
}

// ---- the driver renders offscreen and forwards paints, never shows a window ----
const driver = read('electron/overlay-presenter.ts');
ok(driver.includes('offscreen: true'), 'driver creates an offscreen renderer window');
ok(driver.includes('show: false'), 'driver never shows the renderer window');
ok(driver.includes('backgroundThrottling: false'), 'driver disables background throttling for the offscreen renderer');
ok(driver.includes("webContents.on('paint'"), 'driver forwards paint events');
ok(driver.includes('toBitmap()'), 'driver ships paint bitmaps to the presenter');
ok(driver.includes('setFrameRate(12)') || driver.includes('NATIVE_FRAME_RATE'), 'driver caps paint rate at the 12 fps HUD budget');
ok(driver.includes('PRESENTER_PIPE_NAME') || driver.includes('onetrick-presenter'), 'driver connects on the presenter pipe');
ok(driver.includes('PresenterSupervisor'), 'driver supervises presenter respawns (in-flight guard, backoff, fallback)');
ok(driver.includes('respawn'), 'driver can respawn a dead presenter');
ok(!driver.includes('setAlwaysOnTop'), 'driver never asserts always-on-top — the presenter owns its z-order');

// ---- protocol: encode/decode round-trip over split deliveries ----
const seen: Array<{ type: number; payload: Buffer }> = [];
const parser = createPresenterMessageParser((type, payload) => {
    seen.push({ type, payload: Buffer.from(payload) });
});
const helloPayload = Buffer.alloc(12);
helloPayload.writeUInt32LE(PRESENTER_PROTOCOL_VERSION, 0);
helloPayload.writeUInt32LE(1920, 4);
helloPayload.writeUInt32LE(1080, 8);
const framePayload = Buffer.concat([
    Buffer.from([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]),
    Buffer.from([9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255, 6, 6, 6, 255]),
]);
const stream = Buffer.concat([
    encodePresenterMessage(PRESENTER_MSG.HELLO, helloPayload),
    encodePresenterMessage(PRESENTER_MSG.FRAME, framePayload),
    encodePresenterMessage(PRESENTER_MSG.PING, Buffer.alloc(0)),
]);
// Feed the stream in awkward splits: 3 bytes, then 5, then the rest in 7-byte chunks.
parser.push(stream.subarray(0, 3));
parser.push(stream.subarray(3, 8));
for (let i = 8; i < stream.length; i += 7) {
    parser.push(stream.subarray(i, Math.min(i + 7, stream.length)));
}
ok(seen.length === 3, 'parser delivers all three messages across split chunks');
ok(seen[0]?.type === PRESENTER_MSG.HELLO && seen[0]?.payload.equals(helloPayload), 'parser decodes HELLO payload intact');
ok(seen[1]?.type === PRESENTER_MSG.FRAME && seen[1]?.payload.equals(framePayload), 'parser decodes FRAME payload intact');
ok(seen[2]?.type === PRESENTER_MSG.PING && seen[2]?.payload.length === 0, 'parser decodes empty PING');
let oversizeThrew = false;
try {
    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(PRESENTER_MSG.FRAME, 0);
    bad.writeUInt32LE(300 * 1024 * 1024, 4);
    parser.push(bad);
} catch {
    oversizeThrew = true;
}
ok(oversizeThrew, 'parser refuses an oversize message length instead of allocating blindly');
ok(PRESENTER_PIPE_NAME === '\\\\.\\pipe\\onetrick-presenter', 'pipe name is the documented named pipe');
ok(PRESENTER_PROTOCOL_VERSION === 1, 'protocol version is 1');
ok(
    presenterC.includes('PROTOCOL_VERSION 1') || presenterC.includes('#define PROTOCOL_VERSION 1'),
    'presenter.c agrees on protocol version 1'
);

// ---- backend switch: native is opt-in, electron is the default, unlocked stays Electron ----
const ow = read('electron/overlay-window.ts');
ok(ow.includes("let backend: OverlayBackend = 'electron'"), 'overlay-window.ts defaults the backend to electron in source');
ok(ow.includes('readPackagedOverlayBackend'), 'overlay-window.ts reads the packaged build default for the backend');
ok(ow.includes('overlayBackend'), 'overlay-window.ts persists the overlayBackend setting');
ok(ow.includes('getOverlayBackend'), 'overlay-window.ts exports getOverlayBackend');
ok(ow.includes('isNativeLocked()'), 'overlay-window.ts gates native paths on isNativeLocked()');
ok(ow.includes("process.platform === 'win32'"), 'native backend is Windows-only');
ok(ow.includes('electronSurfaceActive'), 'overlay-window.ts tracks when the Electron window is the surface');
for (const fn of ['showOverlay', 'hideOverlay', 'destroyOverlay', 'keepOverlayOnTop', 'healOverlayWindows']) {
    ok(ow.includes(fn), `overlay-window.ts still exports ${fn}`);
}
ok((ow.match(/new BrowserWindow\(/g) || []).length === 1, 'overlay-window.ts still contains exactly one `new BrowserWindow(` (the Electron surface)');
ok(ow.includes('createNativeOverlayWindow'), 'overlay-window.ts creates the native surface in one place');
ok(ow.includes("backend: 'native'"), 'overlay-window.ts logs the native backend in lifecycle lines');

// ---- packaging: the presenter ships, the test build selects the backend ----
const pkg = JSON.parse(read('package.json')) as {
    build?: { extraResources?: Array<{ from?: string; to?: string }> };
    scripts?: Record<string, string>;
};
ok(
    (pkg.build?.extraResources ?? []).some(
        (r) => r.from === 'native/bin/onetrick-presenter.exe' && r.to === 'onetrick-presenter.exe'
    ),
    'package.json ships onetrick-presenter.exe as an extra resource'
);
ok(typeof pkg.scripts?.['build:presenter'] === 'string', 'package.json has a build:presenter script');
ok((pkg.scripts?.pack ?? '').includes('build:presenter'), 'pack builds the presenter');
ok((pkg.scripts?.dist ?? '').includes('build:presenter'), 'dist builds the presenter');
ok(typeof pkg.scripts?.['verify:native-presenter'] === 'string', 'package.json has a verify:native-presenter script');
ok((pkg.scripts?.['verify:release'] ?? '').includes('verify:native-presenter'), 'verify:release runs verify:native-presenter');
const buildPresenter = read('scripts/build-presenter.mjs');
ok(buildPresenter.includes('native/presenter/presenter.c'), 'build-presenter.mjs compiles presenter.c');
ok(buildPresenter.includes('onetrick-presenter.exe'), 'build-presenter.mjs outputs onetrick-presenter.exe');
const paths = read('electron/paths.ts');
ok(paths.includes('nativePresenterPath'), 'paths.ts exports nativePresenterPath');
const ps1 = read('scripts/package-test-build.ps1');
ok(ps1.includes('build:presenter'), 'package-test-build.ps1 builds the presenter');
ok(ps1.includes('overlayBackend'), 'package-test-build.ps1 stamps overlayBackend into the test build');
ok(ps1.includes('presenter.log'), 'package-test-build.ps1 acceptance evidence is presenter.log');
