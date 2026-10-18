/** Runtime smoke: native helper starts and reports ready (no Electron). */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, 'native', 'bin', 'onetrick-keys.exe');
if (!fs.existsSync(exe)) {
  console.error('FAIL missing', exe);
  process.exit(1);
}

const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
let out = '';
proc.stdout.setEncoding('ascii');
proc.stdout.on('data', (chunk) => {
  out += chunk;
});
const done = new Promise((resolve) => {
  const t = setTimeout(() => resolve('timeout'), 4000);
  const check = () => {
    if (out.includes('R\n') || out.trim() === 'R') {
      clearTimeout(t);
      resolve('ready');
    }
  };
  proc.stdout.on('data', check);
  check();
});
const result = await done;
try {
  proc.stdin.end();
} catch {
  /* ignore */
}
proc.kill();
if (result === 'ready') {
  console.log('verify:keyhook-spawn ok');
  process.exit(0);
}
console.error('FAIL keyhook did not report ready:', out);
process.exit(1);
