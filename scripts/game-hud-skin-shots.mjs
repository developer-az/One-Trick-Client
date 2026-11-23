#!/usr/bin/env node
/**
 * Screenshot evidence for the game HUD skin: renders the real ChromeGameHud
 * markup (scripts/game-hud-skin-markup.cts) with the built overlay CSS over a
 * synthetic League-like bottom HUD (health/mana bars with numbers, Q/W/E/R with
 * a cooldown sweep, D/F, items, minimap) and captures PNGs offscreen in
 * Electron. Also samples the centre of the bars and ability icons and fails if
 * the skin changed any of those pixels (no opaque paint over native content).
 *
 * Run `npm run build` first. Usage: node scripts/game-hud-skin-shots.mjs <outDir>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'otc-game-hud-shots'));
fs.mkdirSync(outDir, { recursive: true });
const distAssets = path.join(root, 'dist', 'assets');
const css = fs.readdirSync(distAssets).filter((n) => n.endsWith('.css')).map((n) => pathToFileURL(path.join(distAssets, n)).href);

const sizes = [[1920, 1080], [1366, 768], [2560, 1440], [3440, 1440]];
const markup = JSON.parse(
  execSync(`npx --yes tsx scripts/game-hud-skin-markup.cts "${JSON.stringify(sizes).replace(/"/g, '\\"')}"`, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
);

// Synthetic native HUD, positioned from the same geometry (HUD 20, map 33).
function fakeHud(w, h) {
  const s = h / 1080;
  const g = 0.2;
  const aw = Math.round((540 + 460 * g) * s);
  const ah = Math.round((88 + 62 * g) * s);
  const pad = Math.round((3 + 4 * g) * s);
  const left = w / 2 - aw / 2;
  const top = h - pad - ah;
  const hw = Math.round(aw * 0.92);
  const hh = Math.max(10, Math.round(20 * s));
  const hl = w / 2 - hw / 2;
  const ht = top - Math.round(3 * s) - hh;
  const icon = Math.round(46 * s);
  const ms = Math.round((140 + 220 * ((0.5 + 0.33 * 1.5 - 0.5) / 1.5)) * s);
  const mp = Math.round((2 + 6 * 0.33) * s);
  let icons = '';
  ['Q', 'W', 'E', 'R', 'D', 'F'].forEach((k, i) => {
    const x = left + Math.round(18 * s) + i * (icon + Math.round(8 * s));
    icons += `<div class="ic" data-probe style="left:${x}px;top:${top + Math.round(10 * s)}px;width:${icon}px;height:${icon}px;background:hsl(${i * 50},55%,42%)">${
      i === 2 ? `<div class="cd"></div>` : ''
    }<span>${k}</span></div>`;
  });
  for (let i = 0; i < 6; i += 1) {
    const x = left + aw - Math.round(18 * s) - (6 - i) * (icon * 0.8 + 4);
    icons += `<div class="ic" data-probe style="left:${x}px;top:${top + Math.round(14 * s)}px;width:${icon * 0.8}px;height:${icon * 0.8}px;background:hsl(${30 + i * 40},40%,35%)"></div>`;
  }
  return `
  <div class="fake" style="left:${left}px;top:${top}px;width:${aw}px;height:${ah}px;background:#1b2230;border-radius:4px"></div>
  ${icons}
  <div class="bar" data-probe style="left:${hl}px;top:${ht}px;width:${hw}px;height:${hh / 2}px;background:linear-gradient(90deg,#2fb34a 72%,#222 72%)"><span>1840 / 2560</span></div>
  <div class="bar" data-probe style="left:${hl}px;top:${ht + hh / 2}px;width:${hw}px;height:${hh / 2}px;background:linear-gradient(90deg,#2d6fd6 55%,#222 55%)"><span>640 / 1160</span></div>
  <div class="fake" style="right:${mp}px;bottom:${mp}px;width:${ms}px;height:${ms}px;background:#2f4a33"></div>`;
}

function page(skin, w, h, html, withSkin) {
  return `<!doctype html><html class="overlay-root" data-ov-skin="${skin}" data-ov-skin-orn="on" style="--ov-champ:#c9a45c"><head>
${css.map((h) => `<link rel="stylesheet" href="${h}">`).join('')}
<style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:
radial-gradient(circle at 30% 40%,#4b5f3a,transparent 40%),radial-gradient(circle at 70% 60%,#5a4a36,transparent 45%),#3a4a3a!important}
.fake,.ic,.bar{position:fixed}.ic{border:1px solid #000;color:#fff;font:bold ${Math.round(12 * h / 1080)}px sans-serif;display:flex;align-items:flex-end;justify-content:flex-end;overflow:hidden}
.cd{position:absolute;inset:0;background:conic-gradient(rgba(0,0,0,.6) 0 65%,transparent 65%)}
.bar{color:#fff;font:bold ${Math.max(9, Math.round(11 * h / 1080))}px sans-serif;display:flex;align-items:center;justify-content:center;line-height:1}</style>
</head><body>${fakeHud(w, h)}${withSkin ? html : ''}</body></html>`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otc-ghs-'));
const jobs = [];
for (const [key, html] of Object.entries(markup)) {
  const [skin, res] = key.split('|');
  const [w, h] = res.split('x').map(Number);
  // Full skin set at 1080p; other resolutions for gothic + vanguard.
  if (res !== '1920x1080' && !['gothic', 'vanguard', 'bloodmoon'].includes(skin)) continue;
  for (const withSkin of [true, false]) {
    const file = path.join(tmp, `${skin}-${res}-${withSkin ? 'on' : 'off'}.html`);
    fs.writeFileSync(file, page(skin, w, h, html, withSkin));
    jobs.push({ file, w, h, png: withSkin ? path.join(outDir, `game-hud-${skin}-${res}.png`) : null, key: `${skin}-${res}`, withSkin });
  }
}

const main = path.join(tmp, 'main.cjs');
fs.writeFileSync(
  main,
  `const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const jobs = ${JSON.stringify(jobs)};
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const probes = {};
  for (const j of jobs) {
    const win = new BrowserWindow({ show: false, width: j.w, height: j.h, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
    for (let attempt = 0; ; attempt++) {
      try { await win.loadFile(j.file); break; } catch (e) { if (attempt > 3) throw e; await new Promise((r) => setTimeout(r, 300)); }
    }
    await new Promise((r) => setTimeout(r, 400));
    const rects = await win.webContents.executeJavaScript("[...document.querySelectorAll('[data-probe]')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})");
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: j.w, height: j.h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 200));
    const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const img = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
    const bmp = img.toBitmap(); const size = img.getSize();
    probes[j.key] = probes[j.key] || {};
    probes[j.key][j.withSkin ? 'on' : 'off'] = rects.map(([x, y]) => { const i = (y * size.width + x) * 4; return [bmp[i], bmp[i+1], bmp[i+2]].join(','); });
    if (j.png) fs.writeFileSync(j.png, img.toPNG());
    win.destroy();
    await new Promise((r) => setTimeout(r, 100));
  }
  process.stdout.write('PROBES' + JSON.stringify(probes) + '\\n');
  app.quit();
});`
);
const run = spawnSync(electronPath, [main], { encoding: 'utf8', timeout: 300000 });
const line = (run.stdout || '').split('\n').find((l) => l.startsWith('PROBES'));
if (!line) {
  console.error('electron status', run.status, run.signal, run.error, run.stdout, run.stderr);
  process.exit(1);
}
const probes = JSON.parse(line.slice(6));
let failures = 0;
for (const [key, p] of Object.entries(probes)) {
  const same = p.on.every((v, i) => v === p.off[i]);
  console.log(`${same ? 'ok' : 'FAIL'} ${key}: ${p.on.length} native centre pixels unchanged by the skin`);
  if (!same) failures += 1;
}
console.log(`screenshots in ${outDir}`);
process.exit(failures ? 1 : 0);
