import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const exe = resolve('native/bin/onetrick-presenter.exe');
const source = readFileSync(resolve('native/presenter/presenter.c'), 'utf8');
const children = new Set();
let serial = 0;
let failed = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, condition, detail = 'assertion failed') {
  console.log(`${condition ? 'ok' : 'FAIL'} ${name}${condition ? '' : `: ${detail}`}`);
  if (!condition) failed = true;
}
function packet(type, payload = Buffer.alloc(0)) {
  const b = Buffer.allocUnsafe(8 + payload.length);
  b.writeUInt32LE(type, 0); b.writeUInt32LE(payload.length, 4); payload.copy(b, 8);
  return b;
}
function words(...values) {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
  return b;
}
function start(timeout = 30000) {
  const id = `${process.pid}-${++serial}`;
  const pipe = `\\\\.\\pipe\\onetrick-presenter-test-${id}`;
  const log = join(tmpdir(), `onetrick-presenter-test-${id}.log`);
  const child = spawn(exe, ['--pipe', pipe, '--log', log, '--connect-timeout-ms', String(timeout)], { stdio: 'ignore' });
  children.add(child);
  return { child, pipe, log };
}
function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
async function waitExit(child, ms) {
  if (exited(child)) return true;
  return Promise.race([new Promise((r) => child.once('exit', () => r(true))), sleep(ms).then(() => false)]);
}
async function connect(pipe, child) {
  for (let i = 0; i < 60; i++) {
    if (exited(child)) throw new Error(`presenter exited ${child.exitCode}`);
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect(pipe);
        s.once('connect', () => { s.removeListener('error', reject); s.on('error', () => {}); resolve(s); });
        s.once('error', reject);
      });
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ECONNREFUSED') throw e;
      await sleep(50);
    }
  }
  throw new Error('test pipe did not appear');
}
function replies(socket) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiting = [];
  socket.on('data', (part) => {
    buffer = Buffer.concat([buffer, part]);
    while (buffer.length >= 8) {
      const n = buffer.readUInt32LE(4);
      if (buffer.length < 8 + n) break;
      const msg = { type: buffer.readUInt32LE(0), payload: buffer.subarray(8, 8 + n) };
      buffer = buffer.subarray(8 + n);
      const next = waiting.shift();
      if (next) next(msg); else queue.push(msg);
    }
  });
  return () => Promise.race([
    queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r)),
    sleep(2500).then(() => { throw new Error('reply timeout'); }),
  ]);
}
async function send(socket, type, payload, mode = 'whole') {
  const b = packet(type, payload);
  if (mode === 'split') {
    socket.write(b.subarray(0, 8));
    socket.write(b.subarray(8));
  } else if (mode === 'bytes') {
    for (const byte of b) socket.write(Buffer.from([byte]));
  } else if (!socket.write(b)) await new Promise((r) => socket.once('drain', r));
}
const native = String.raw`
using System;
using System.Runtime.InteropServices;
public static class N {
 [DllImport("user32.dll", CharSet=CharSet.Ansi)] public static extern IntPtr FindWindow(string c, string n);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrA")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern int GetGuiResources(IntPtr process, int flags);
 [DllImport("user32.dll", CharSet=CharSet.Ansi)] public static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
 [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
}
`;
async function ps(body) {
  const script = `Add-Type -TypeDefinition @'\n${native}\n'@\n${body}`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 8000 });
  return stdout.trim();
}
async function windowState() {
  const out = await ps(`$h=[N]::FindWindow('OneTrickPresenter',[NullString]::Value); if($h -eq [IntPtr]::Zero){throw 'window missing'}; $style=[N]::GetWindowLongPtr($h,-20).ToInt64(); $hit=[N]::SendMessage($h,0x84,[IntPtr]::Zero,[IntPtr](10 -bor (10 -shl 16))).ToInt64(); $activate=[N]::SendMessage($h,0x21,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64(); "$style,$([N]::IsWindowVisible($h)),$hit,$activate"`);
  const [style, visible, hit, activate] = out.split(',');
  return { style: Number(style), visible: visible === 'True', hit: Number(hit), activate: Number(activate) };
}
async function sample(pid) {
  const out = await ps(`$p=Get-Process -Id ${pid} -ErrorAction Stop; "$($p.HandleCount),$([N]::GetGuiResources($p.Handle,0)),$([N]::GetGuiResources($p.Handle,1)),$($p.WorkingSet64)"`);
  return out.split(',').map(Number);
}
async function test() {
  if (!existsSync(exe)) { check('presenter binary exists', false, 'run npm run build:presenter first'); return; }
  if (!source.includes('"--pipe"') || !source.includes('"--log"')) {
    check('isolated HELLO handshake', false, 'current binary ignores --pipe/--log; spawning it would touch the real pipe/log');
    return;
  }
  const idle = start(1500);
  try { check('no-client timeout exits cleanly', await waitExit(idle.child, 4000) && idle.child.exitCode === 0); }
  finally { if (!exited(idle.child)) idle.child.kill(); }
  const main = start();
  let socket;
  try {
    socket = await connect(main.pipe, main.child);
    const reply = replies(socket);
    await send(socket, 2, Buffer.concat([words(0, 0, 1, 1), Buffer.alloc(4)]));
    await send(socket, 8);
    check('FRAME before HELLO survives', (await reply()).type === 102 && !exited(main.child));
    for (const mode of ['whole', 'split', 'bytes']) {
      await send(socket, 1, words(1, 640, 360), mode);
      check(`HELLO ${mode} READY`, (await reply()).type === 101);
      await send(socket, 8, Buffer.alloc(0), mode);
      check(`PING ${mode} PONG`, (await reply()).type === 102 && !exited(main.child));
    }
    for (const [name, p] of [['bad version', words(2, 640, 360)], ['zero width', words(1, 0, 360)], ['width 16385', words(1, 16385, 360)]]) {
      await send(socket, 1, p);
      check(`${name} ERROR and alive`, (await reply()).type === 103 && !exited(main.child));
    }
    for (const [name, p] of [
      ['size mismatch', Buffer.concat([words(0, 0, 2, 2), Buffer.alloc(4)])],
      ['overflow dimensions', words(0, 0, 0xffffffff, 0xffffffff)],
      ['outside DIB', Buffer.concat([words(700, 400, 1, 1), Buffer.alloc(4)])],
    ]) {
      await send(socket, 2, p);
      await send(socket, 8);
      check(`FRAME ${name} survives`, (await reply()).type === 102 && !exited(main.child));
    }
    await send(socket, 999);
    await send(socket, 8);
    check('unknown type survives', (await reply()).type === 102 && !exited(main.child));
    await send(socket, 5, Buffer.from([1]));
    await send(socket, 6, words(0, 0, 640, 360));
    await send(socket, 3);
    await sleep(120);
    let state = await windowState();
    const required = 0x80000 | 0x20 | 0x8000000 | 0x80 | 0x8;
    check('shown window styles and visibility', (state.style & required) === required && state.visible, JSON.stringify(state));
    check('click-through hit test and no activation', state.hit === -1 && state.activate === 3, JSON.stringify(state));
    await send(socket, 5, Buffer.from([0]));
    state = await windowState();
    check('click-through off clears style and hit test', (state.style & 0x20) === 0 && state.hit === 1, JSON.stringify(state));
    await send(socket, 5, Buffer.from([1]));
    await send(socket, 2, Buffer.concat([words(0, 0, 640, 360), Buffer.alloc(640 * 360 * 4)]));
    const magenta = Buffer.alloc(40 * 30 * 4);
    for (let i = 0; i < magenta.length; i += 4) { magenta[i] = 255; magenta[i + 2] = 255; magenta[i + 3] = 255; }
    await send(socket, 2, Buffer.concat([words(100, 60, 40, 30), magenta]));
    await sleep(300);
    const pixels = await ps(`Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap 640,360; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $a=$b.GetPixel(110,70); $z=$b.GetPixel(400,300); "$($a.R),$($a.G),$($a.B);$($z.R),$($z.G),$($z.B)"; $g.Dispose(); $b.Dispose()`);
    const [a, z] = pixels.split(';').map((s) => s.split(',').map(Number));
    check('magenta dirty rect appears on screen', a[0] > 240 && a[1] < 20 && a[2] > 240, pixels);
    check('outside dirty rect is not magenta', !(z[0] > 240 && z[1] < 20 && z[2] > 240), pixels);
    // Regression: Electron's OSR image can be 1px larger than the surface (DPI rounding).
    // A 641x361 frame on the 640x360 surface must be clipped, not dropped, and its
    // rows must not shear (right half magenta, left half transparent).
    const wide = Buffer.alloc(641 * 361 * 4);
    for (let yy = 0; yy < 361; yy++) for (let xx = 320; xx < 641; xx++) { const o = (yy * 641 + xx) * 4; wide[o] = 255; wide[o + 2] = 255; wide[o + 3] = 255; }
    await send(socket, 2, Buffer.concat([words(0, 0, 641, 361), wide]));
    await sleep(300);
    const widePx = await ps(`Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap 640,360; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $r=@(@(400,10),@(400,300),@(100,10),@(100,300)); ($r | ForEach-Object { $c=$b.GetPixel($_[0],$_[1]); "$($c.R),$($c.G),$($c.B)" }) -join ';'; $g.Dispose(); $b.Dispose()`);
    const [w1, w2, w3, w4] = widePx.split(';').map((s) => s.split(',').map(Number));
    const isMagenta = (p) => p[0] > 240 && p[1] < 20 && p[2] > 240;
    check('oversize (surface+1px) frame is clipped, not dropped, without shear', isMagenta(w1) && isMagenta(w2) && !isMagenta(w3) && !isMagenta(w4), widePx);
    // A separate PowerShell process owns the competitor until its stdin closes.
    const competitorCode = `Add-Type -TypeDefinition @'
${native}
'@
$h=[N]::CreateWindowEx(0x88,'STATIC','ot-competitor',[uint32]2415919104,10,10,60,60,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
$h.ToInt64()
[Console]::Out.Flush()
[Console]::ReadLine() | Out-Null
[N]::DestroyWindow($h) | Out-Null`;
    const competitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(competitorCode, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'] });
    children.add(competitor);
    try {
      const competitorHandle = Number((await Promise.race([new Promise((r) => competitor.stdout.once('data', r)), sleep(8000).then(() => { throw new Error('competitor startup timeout'); })])).toString().trim());
      if (!Number.isSafeInteger(competitorHandle) || competitorHandle === 0) throw new Error('competitor did not publish HWND');
      let above = false; let lastZ = '';
      const zDeadline = Date.now() + 3000;
      while (Date.now() < zDeadline) {
        await sleep(250);
        const z = await ps(`$h=[N]::FindWindow('OneTrickPresenter',[NullString]::Value); $c=[IntPtr]${competitorHandle}; $p=[N]::GetWindow($h,3); $found=$false; while($p -ne [IntPtr]::Zero){if($p -eq $c){$found=$true;break}; $p=[N]::GetWindow($p,3)}; "$([N]::IsWindowVisible($c)),$([N]::GetWindowLongPtr($c,-20).ToInt64()),$found"`);
        lastZ = z; const [competitorVisible, competitorStyle, competitorAbove] = z.split(',');
        above = competitorVisible === 'True' && (Number(competitorStyle) & 0x8) !== 0 && competitorAbove === 'False' && !exited(competitor);
        if (above) break;
      }
      check('presenter regains z order', above, lastZ);
    } finally { competitor.stdin.end('\n'); await waitExit(competitor, 1000); if (!exited(competitor)) competitor.kill(); }
    await send(socket, 4);
    await sleep(100);
    check('HIDE makes window invisible', !(await windowState()).visible);
    socket.end();
    check('socket close exits promptly', await waitExit(main.child, 3000));
  } finally { socket?.destroy(); if (!exited(main.child)) main.child.kill(); }
  const oversized = start();
  try {
    const s = await connect(oversized.pipe, oversized.child);
    const h = Buffer.alloc(8); h.writeUInt32LE(2, 0); h.writeUInt32LE(257 * 1024 * 1024, 4); s.write(h);
    check('oversize header exits cleanly', await waitExit(oversized.child, 3000) && oversized.child.exitCode === 0);
    s.destroy();
  } finally { if (!exited(oversized.child)) oversized.child.kill(); }
  const leak = start();
  let s;
  try {
    s = await connect(leak.pipe, leak.child);
    const reply = replies(s);
    await send(s, 1, words(1, 1920, 1080));
    check('leak run HELLO READY', (await reply()).type === 101);
    await send(s, 6, words(-20000, -20000, 1920, 1080));
    await send(s, 3);
    const full = packet(2, Buffer.concat([words(0, 0, 1920, 1080), Buffer.alloc(1920 * 1080 * 4)]));
    const dirty = packet(2, Buffer.concat([words(100, 60, 200, 100), Buffer.alloc(200 * 100 * 4)]));
    const samples = [];
    for (let i = 1; i <= 3000; i++) {
      if (!s.write(i % 2 ? full : dirty)) await new Promise((r) => s.once('drain', r));
      if (i % 500 === 0) {
        await send(s, 8);
        if ((await reply()).type !== 102) throw new Error('leak run lost PONG');
        samples.push(await sample(leak.child.pid));
      }
      await sleep(10);
    }
    console.log(`samples handles,gdi,user,workingSet64 ${samples.map((x, i) => `${(i + 1) * 500}:${x.join(',')}`).join(' ')}`);
    const first = samples[0], last = samples.at(-1);
    check('GDI objects stable', last[1] <= first[1] + 2, `${first[1]} -> ${last[1]}`);
    check('USER objects stable', last[2] <= first[2] + 2, `${first[2]} -> ${last[2]}`);
    check('handles stable', last[0] <= first[0] + 20, `${first[0]} -> ${last[0]}`);
    check('working set stable', last[3] <= first[3] + 64 * 1024 * 1024, `${first[3]} -> ${last[3]}`);
    await send(s, 4); s.end();
    check('leak run exits promptly', await waitExit(leak.child, 3000));
  } finally { s?.destroy(); if (!exited(leak.child)) leak.child.kill(); }
}
try { await test(); } catch (e) { check('probe completed', false, e.stack || String(e)); }
finally { for (const child of children) if (!exited(child)) child.kill(); if (failed) process.exitCode = 1; }
