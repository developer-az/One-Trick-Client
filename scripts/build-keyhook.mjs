// Builds native/bin/onetrick-keys.exe (keyboard-only hotkey helper) from
// native/keyhook/keyhook.c with whichever MinGW compiler is available.
// Linux/macOS: apt install gcc-mingw-w64-x86-64 (or brew install mingw-w64).
// Windows: any MinGW-w64 gcc on PATH (MSYS2, w64devkit, winlibs).
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const LLVM_MINGW_TAG = '20260908';
const LLVM_MINGW_URL = `https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_TAG}/llvm-mingw-${LLVM_MINGW_TAG}-ucrt-x86_64.zip`;
const LLVM_MINGW_DIR = `llvm-mingw-${LLVM_MINGW_TAG}-ucrt-x86_64`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native/keyhook/keyhook.c');
const outDir = path.join(root, 'native/bin');
const out = path.join(outDir, 'onetrick-keys.exe');
const optional = process.argv.includes('--optional');

const llvmMingwGcc = [
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'gcc.exe'),
  'C:\\llvm-mingw\\bin\\gcc.exe',
  path.join(process.env.ProgramFiles || '', 'llvm-mingw', 'bin', 'gcc.exe'),
];
const compilers = [
  'x86_64-w64-mingw32-gcc',
  ...(process.platform === 'win32' ? ['gcc', 'clang', ...llvmMingwGcc] : []),
];
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

function tryCopyFromInstalledApp() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(local, 'Programs', 'One Trick', 'resources', 'onetrick-keys.exe'),
    path.join(local, 'Programs', 'one-trick', 'resources', 'onetrick-keys.exe'),
  ];
  for (const srcExe of candidates) {
    if (!fs.existsSync(srcExe)) continue;
    fs.copyFileSync(srcExe, out);
    console.log(`[keyhook] copied ${path.relative(root, out)} from ${srcExe}`);
    process.exit(0);
  }
}

tryCopyFromInstalledApp();

function tryFetchLlvmMingwAndBuild() {
  if (process.platform !== 'win32') return false;
  const toolRoot = path.join(root, 'native', 'toolchain');
  const gcc = path.join(toolRoot, LLVM_MINGW_DIR, 'bin', 'gcc.exe');
  const zip = path.join(toolRoot, `${LLVM_MINGW_DIR}.zip`);
  try {
    if (!fs.existsSync(gcc)) {
      fs.mkdirSync(toolRoot, { recursive: true });
      if (!fs.existsSync(zip)) {
        console.log(`[keyhook] downloading llvm-mingw ${LLVM_MINGW_TAG} (one-time)...`);
        execSync(
          `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${LLVM_MINGW_URL}' -OutFile '${zip.replace(/'/g, "''")}'"`,
          { stdio: 'inherit' }
        );
      }
      if (!fs.existsSync(gcc)) {
        console.log('[keyhook] extracting llvm-mingw...');
        execSync(
          `powershell -NoProfile -Command "Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${toolRoot.replace(/'/g, "''")}' -Force"`,
          { stdio: 'inherit' }
        );
      }
    }
    if (!fs.existsSync(gcc)) return false;
    execFileSync(gcc, ['-O2', '-s', '-mwindows', '-Wall', '-Wextra', '-o', out, src], { stdio: 'inherit' });
    console.log(`[keyhook] built ${path.relative(root, out)} with llvm-mingw gcc`);
    return true;
  } catch (error) {
    console.warn('[keyhook] llvm-mingw fetch/build failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

if (tryFetchLlvmMingwAndBuild()) {
  process.exit(0);
}

const msg = '[keyhook] no MinGW-w64 compiler found; PageUp/PageDown will fall back to Electron globalShortcut.';
if (optional) {
  console.warn(msg);
  process.exit(0);
}
console.error(msg);
process.exit(1);
