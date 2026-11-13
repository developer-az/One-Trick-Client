// Electron main for scripts/smoke-native-overlay.mjs: drives the REAL compiled
// driver (dist-electron/electron/overlay-presenter.js) and the REAL presenter
// exe with a synthetic overlay page, so the OSR -> crop -> pipe -> layered
// window path can be checked pixel-for-pixel on this machine's DPI scale.
const { app, screen } = require('electron');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
process.env.VITE_DEV_SERVER_URL = process.env.SMOKE_PAGE_URL;
app.getAppPath = () => root; // the driver resolves native/bin from the app path
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const { createNativeSurface } = require(path.join(root, 'dist-electron', 'electron', 'overlay-presenter.js'));
    const d = screen.getPrimaryDisplay();
    const events = [];
    const surface = await createNativeSurface(
        { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scaleFactor: d.scaleFactor || 1 },
        { captureProtection: false, onLoaded: () => events.push('loaded'), onDown: () => events.push('down'), onFallback: (r) => events.push('fallback:' + r) }
    );
    surface.show();
    // overlay-window's keepOverlayOnTop() calls respawn() on a ~1 s cadence in a match.
    setInterval(() => surface.respawn(), 1000);
    console.log('SMOKE-READY scale=' + (d.scaleFactor || 1) + ' bounds=' + JSON.stringify(d.bounds));
    setInterval(() => console.log('STATS ' + JSON.stringify(surface.stats()) + ' ev=' + events.join(',')), 2000);
    process.on('message', () => {});
});
