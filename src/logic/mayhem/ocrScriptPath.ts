import fs from 'fs';
import path from 'path';

/**
 * Windows PowerShell cannot read a script that lives inside `app.asar`:
 * `-File` is an OS open, and the asar archive is not a real directory.
 * electron-builder unpacks the matching files next to the archive as
 * `app.asar.unpacked`; that copy is what a child process must run.
 */
export function toUnpackedAsarPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (!/(^|\/)app\.asar\//.test(normalized)) return filePath;
  return filePath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/**
 * First candidate whose unpacked sibling exists, then the candidates
 * themselves. Preferring the unpacked copy matters because Electron's patched
 * `fs.existsSync` answers true for files inside `app.asar` — which is exactly
 * the path PowerShell cannot open.
 */
export function resolveOcrScriptPath(
  candidates: string[],
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  for (const candidate of candidates) {
    const unpacked = toUnpackedAsarPath(candidate);
    if (unpacked !== candidate && exists(unpacked)) return unpacked;
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return candidates[0] || '';
}

/** Candidate mayhem-ocr.ps1 locations for an app root (repo checkout or packaged). */
export function mayhemOcrScriptCandidates(
  appPath: string,
  dirname: string
): string[] {
  return [
    path.join(dirname, 'scripts', 'mayhem-ocr.ps1'),
    path.join(appPath, 'electron', 'scripts', 'mayhem-ocr.ps1'),
    path.join(appPath, 'dist-electron', 'electron', 'scripts', 'mayhem-ocr.ps1'),
  ];
}
