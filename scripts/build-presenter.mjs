// Builds native/bin/onetrick-presenter.exe (native overlay presenter) from
// native/presenter/presenter.c with whichever MinGW compiler is available.
// Linux/macOS: apt install gcc-mingw-w64-x86-64 (or brew install mingw-w64).
// Windows: any MinGW-w64 gcc on PATH (MSYS2, w64devkit, winlibs).
// Non-optional: a missing presenter fails the build, like the keyhook — the
// native overlay backend cannot run without it.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native/presenter/presenter.c');
const outDir = path.join(root, 'native/bin');
const out = path.join(outDir, 'onetrick-presenter.exe');

const compilers = [
  'x86_64-w64-mingw32-gcc',
  ...(process.platform === 'win32'
    ? [
        'gcc',
        'clang',
        'C:\\llvm-mingw\\bin\\gcc.exe',
        path.join(process.env.ProgramFiles || '', 'llvm-mingw', 'bin', 'gcc.exe'),
      ]
    : []),
];
fs.mkdirSync(outDir, { recursive: true });

for (const cc of compilers) {
  try {
    execFileSync(
      cc,
      ['-O2', '-s', '-mwindows', '-Wall', '-Wextra', '-o', out, src],
      { stdio: 'inherit' }
    );
    console.log(`[presenter] built ${path.relative(root, out)} with ${cc}`);
    process.exit(0);
  } catch {
    // try next compiler
  }
}

console.error(
  '[presenter] no MinGW-w64 compiler found; install gcc-mingw-w64-x86-64 ' +
    '(Linux: apt install gcc-mingw-w64-x86-64) or put a MinGW gcc on PATH.'
);
process.exit(1);
