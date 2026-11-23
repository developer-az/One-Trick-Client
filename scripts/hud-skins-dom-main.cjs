#!/usr/bin/env node
// Offscreen Electron host for verify-hud-skins-dom.mjs. Loads the harness page
// (built overlay CSS + the real ornament markup), waits for its measurement
// result and prints it as one HUD_DOM_RESULT line.
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const page = process.env.HUD_DOM_PAGE;
  if (!page) {
    console.error('HUD_DOM_PAGE is required');
    app.exit(2);
    return;
  }
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await win.loadFile(page);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const result = await win.webContents.executeJavaScript('window.__hudDomResult || null', true);
      if (result) {
        console.log('HUD_DOM_RESULT ' + JSON.stringify(result));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('hud-skins-dom host failed:', String(error));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
