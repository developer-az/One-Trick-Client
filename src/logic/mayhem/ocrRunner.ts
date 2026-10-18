import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Resolve mayhem-ocr.ps1 from repo root (works in tsx verify without Electron). */
export function mayhemOcrScriptPath(repoRoot: string): string {
  const bundled = path.join(repoRoot, 'electron', 'scripts', 'mayhem-ocr.ps1');
  const dist = path.join(repoRoot, 'dist-electron', 'electron', 'scripts', 'mayhem-ocr.ps1');
  if (fs.existsSync(bundled)) return bundled;
  if (fs.existsSync(dist)) return dist;
  return bundled;
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
      resolve(out);
    });
    ps.on('error', reject);
  });
}
