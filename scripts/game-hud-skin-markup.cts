/**
 * Prints JSON { "<skin>|<w>x<h>": "<markup>" } of the real ChromeGameHud
 * (live mode, frames on) rendered with react-dom/server under every skin.
 * Used by scripts/game-hud-skin-shots.mjs. Run via `npx tsx`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module');
Module._extensions['.css'] = () => undefined;
/* eslint-disable @typescript-eslint/no-require-imports */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ChromeGameHud } = require('../src/overlay/ChromeGameHud');
const { HudSkinChromeProvider } = require('../src/overlay/hudSkinOrnaments');
const { HUD_SKIN_IDS } = require('../src/overlay/hudSkins');
/* eslint-enable @typescript-eslint/no-require-imports */

const sizes: Array<[number, number]> = JSON.parse(process.argv[2] || '[[1920,1080]]');
const out: Record<string, string> = {};
for (const [w, h] of sizes) {
  (globalThis as { window?: unknown }).window = { innerWidth: w, innerHeight: h, addEventListener() {}, removeEventListener() {} };
  for (const skin of HUD_SKIN_IDS) {
    out[`${skin}|${w}x${h}`] = renderToStaticMarkup(
      React.createElement(
        HudSkinChromeProvider,
        { value: { skin, ornaments: true } },
        React.createElement(ChromeGameHud, { hudScale: 20, mapScale: 33, enabled: true, showGuides: false })
      )
    );
  }
}
process.stdout.write(JSON.stringify(out));
