#!/usr/bin/env node
// Windows smoke test: real Electron offscreen renderer + real driver + real
// presenter. Serves a tiny test page, launches Electron, then samples actual
// screen pixels (DPI-aware) to prove the frame lands where it should and the
// rest stays transparent. Run `npm run electron:build && npm run build:presenter` first.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'scripts/smoke/native-overlay-page.html'));
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(page); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const electron = (await import('electron')).default;
const child = spawn(electron, [path.join(root, 'scripts/smoke/native-overlay-main.cjs')], { env: { ...process.env, SMOKE_PAGE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; let scale = 1;
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sample(points, scaleFactor) {
  const list = points.map(([x, y]) => `@(${Math.round(x * scaleFactor)},${Math.round(y * scaleFactor)})`).join(',');
  const ps = `Add-Type -AssemblyName System.Drawing,System.Windows.Forms
Add-Type @'
using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
'@
[D]::SetProcessDPIAware() | Out-Null
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
foreach($p in @(${list})){ $c=$bmp.GetPixel($p[0],$p[1]); "$($c.R),$($c.G),$($c.B)" }`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { timeout: 20000 }).toString().trim().split(/\r?\n/).map((l) => l.split(',').map(Number));
}
try {
  const deadline = Date.now() + 25000;
  while (!out.includes('SMOKE-READY') && Date.now() < deadline) await sleep(200);
  check('driver reached READY with the real presenter', out.includes('SMOKE-READY'), out.slice(-300));
  scale = Number((/scale=([\d.]+)/.exec(out) || [0, 1])[1]);
  await sleep(4000);
  // magenta panel centre (DIP 350,250); empty area (DIP 900,100); panel edge inside (DIP 205,155)
  const [inside, edge, empty] = sample([[350, 250], [205, 155], [900, 100]], scale);
  const magenta = (p) => p[0] > 240 && p[1] < 20 && p[2] > 240;
  check('magenta panel at the right physical position', magenta(inside), `scale=${scale} px=${inside}`);
  check('panel corner pixel also lands (no shift/crop)', magenta(edge), `px=${edge}`);
  check('empty area is transparent (not magenta/green)', !magenta(empty) && !(empty[1] > 240 && empty[0] < 20), `px=${empty}`);
  const stats = [...out.matchAll(/STATS (\{.*?\})/g)].map((m) => JSON.parse(m[1])).pop();
  check('frames flowing and presenter alive', !!stats && stats.alive && stats.frames > 5, JSON.stringify(stats));
  check('no frames dropped as corrupt', !!stats && stats.framesDropped < 3, JSON.stringify(stats));
  // Kill the presenter mid-run: the supervised respawn must bring the HUD back.
  execFileSync('taskkill', ['/F', '/IM', 'onetrick-presenter.exe'], { stdio: 'ignore' });
  let after = [0, 0, 0]; const trail = [];
  for (let i = 0; i < 14 && !magenta(after); i++) { await sleep(1000); after = sample([[350, 250], [900, 100]], scale)[0]; trail.push(after.join(':')); }
  await sleep(2500); // let the next STATS line print
  const stats2 = [...out.matchAll(/STATS (\{.*?\})/g)].map((m) => JSON.parse(m[1])).pop();
  check('presenter respawned after being killed', !!stats2 && stats2.alive && stats2.respawns >= 1, JSON.stringify(stats2));
  check('HUD is back on screen after the respawn', magenta(after), `px=${after} trail=${trail.join(' ')}`);
} catch (e) {
  check('smoke completed', false, String(e));
} finally {
  if (process.env.SMOKE_VERBOSE) console.log(out.split(/\r?\n/).filter((l) => !l.startsWith('STATS')).join('\n'));
  child.kill();
  try { execFileSync('taskkill', ['/F', '/IM', 'onetrick-presenter.exe'], { stdio: 'ignore' }); } catch { /* already gone */ }
  server.close();
  if (failed) process.exitCode = 1;
}
