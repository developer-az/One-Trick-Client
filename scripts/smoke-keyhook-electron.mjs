/** Run: npm run smoke:keyhook-electron — do NOT use `electron -e "..."` on Windows (treats code as a path). */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { app } = require('electron');

app.whenReady().then(() => {
  const { startFlashKeyHook, getKeyHookStatus } = require('../dist-electron/electron/global-key-hook.js');
  const ok = startFlashKeyHook({
    onPrimary: () => console.log('PRIMARY'),
    onSecondary: () => console.log('SECONDARY'),
  });
  console.log('start', ok, JSON.stringify(getKeyHookStatus()));
  setTimeout(() => {
    console.log('final', JSON.stringify(getKeyHookStatus()));
    app.quit();
  }, 4000);
});
