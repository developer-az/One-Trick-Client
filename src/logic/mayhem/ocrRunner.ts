import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseMayhemOcrOutput } from './ocrOutput';
import { resolveOcrScriptPath } from './ocrScriptPath';

/**
 * Resolve mayhem-ocr.ps1 from a repo root or an Electron app root.
 * In a packaged build the app root is `.../resources/app.asar`, so the
 * resolved script must come from `app.asar.unpacked` (PowerShell cannot read
 * inside the archive).
 */
export function mayhemOcrScriptPath(
  repoRoot: string,
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  return resolveOcrScriptPath(
    [
      path.join(repoRoot, 'electron', 'scripts', 'mayhem-ocr.ps1'),
      path.join(repoRoot, 'dist-electron', 'electron', 'scripts', 'mayhem-ocr.ps1'),
    ],
    exists
  );
}

/** Run Windows.Media.Ocr on a PNG via mayhem-ocr.ps1 (no screen capture). */
export function runMayhemOcrOnImageFile(imagePath: string, repoRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = mayhemOcrScriptPath(repoRoot);
    if (!fs.existsSync(script)) {
      reject(new Error(`OCR script missing: ${script}`));
      return;
    }
    if (!fs.existsSync(imagePath)) {
      reject(new Error(`Image missing: ${imagePath}`));
      return;
    }
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', imagePath],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    ps.stdout.on('data', (c) => {
      out += String(c);
    });
    ps.stderr.on('data', (c) => {
      err += String(c);
    });
    ps.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(err.trim() || `OCR exit ${code}`));
        return;
      }
      resolve(parseMayhemOcrOutput(out).text);
    });
    ps.on('error', reject);
  });
}
