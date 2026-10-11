// Builds native/bin/onetrick-keys.exe (keyboard-only hotkey helper) from
// native/keyhook/keyhook.c with whichever MinGW compiler is available.
// Linux/macOS: apt install gcc-mingw-w64-x86-64 (or brew install mingw-w64).
// Windows: any MinGW-w64 gcc on PATH (MSYS2, w64devkit, winlibs).
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native/keyhook/keyhook.c');
const outDir = path.join(root, 'native/bin');
const out = path.join(outDir, 'onetrick-keys.exe');
const optional = process.argv.includes('--optional');

const compilers = ['x86_64-w64-mingw32-gcc', ...(process.platform === 'win32' ? ['gcc'] : [])];
fs.mkdirSync(outDir, { recursive: true });

for (const cc of compilers) {
  try {
    execFileSync(cc, ['-O2', '-s', '-mwindows', '-Wall', '-Wextra', '-o', out, src], { stdio: 'inherit' });
    console.log(`[keyhook] built ${path.relative(root, out)} with ${cc}`);
    process.exit(0);
  } catch {
    // try next compiler
  }
}

const msg = '[keyhook] no MinGW-w64 compiler found; PageUp/PageDown will fall back to Electron globalShortcut.';
if (optional) {
  console.warn(msg);
  process.exit(0);
}
console.error(msg);
process.exit(1);
