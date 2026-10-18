import { app, desktopCapturer, screen } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { matchAugmentsFromOcr } from '../src/logic/mayhem/match';
import {
  stabilizeMayhemOffers,
  type MayhemOfferStabilityState,
} from '../src/logic/mayhem/offerStability';
import { runMayhemOcrOnImageFile } from '../src/logic/mayhem/ocrRunner';
import type { MayhemAugment } from '../src/logic/mayhem/types';

function ocrScriptPath(): string {
  const nextToBundle = path.join(__dirname, 'scripts', 'mayhem-ocr.ps1');
  if (fs.existsSync(nextToBundle)) return nextToBundle;
  return path.join(app.getAppPath(), 'electron', 'scripts', 'mayhem-ocr.ps1');
}

let ocrInFlight = false;
let lastOfferIds: string[] = [];
let lastOcrAt = 0;
let lastOcrSnippet = '';
let lastCaptureMethod: 'powershell' | 'desktop' | 'none' = 'none';

export function getMayhemOcrDebug(): {
  lastSnippet: string;
  lastOfferIds: string[];
  captureMethod: string;
} {
  return {
    lastSnippet: lastOcrSnippet,
    lastOfferIds: [...lastOfferIds],
    captureMethod: lastCaptureMethod,
  };
}

function displayForCapture(): Electron.Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

function runPowerShellCaptureAndOcr(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `onetrick-mayhem-${Date.now()}.png`);
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ocrScriptPath(),
        '-CaptureScreen',
        '-UseGameWindow',
        '-ImagePath',
        tmp,
      ],
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
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      if (code !== 0 && code !== null) {
        reject(new Error(err.trim() || `PowerShell capture/OCR exit ${code}`));
        return;
      }
      lastCaptureMethod = 'powershell';
      resolve(out);
    });
    ps.on('error', reject);
  });
}

async function captureCenterRegionPng(): Promise<Buffer | null> {
  try {
    const display = displayForCapture();
    const scale = display.scaleFactor || 1;
    const width = Math.floor(display.size.width * scale);
    const height = Math.floor(display.size.height * scale);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });
    const displayId = String(display.id);
    const source =
      sources.find((s) => s.display_id === displayId) ||
      sources.find((s) => s.name.toLowerCase().includes('screen')) ||
      sources[0];
    const img = source?.thumbnail;
    if (!img || img.isEmpty()) return null;
    const crop = {
      x: Math.floor(width * 0.1),
      y: Math.floor(height * 0.2),
      width: Math.floor(width * 0.8),
      height: Math.floor(height * 0.55),
    };
    const cropped = img.crop(crop);
    lastCaptureMethod = 'desktop';
    return cropped.toPNG();
  } catch (error) {
    console.warn('[mayhem-ocr] desktop capture failed:', error);
    return null;
  }
}

async function runWindowsOcrOnFile(png: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `onetrick-mayhem-${Date.now()}.png`);
  fs.writeFileSync(tmp, png);
  try {
    return await runMayhemOcrOnImageFile(tmp, app.getAppPath());
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function readScreenText(): Promise<string> {
  if (process.platform === 'win32') {
    try {
      return await runPowerShellCaptureAndOcr();
    } catch (error) {
      console.warn('[mayhem-ocr] PowerShell capture failed, trying desktopCapturer:', error);
    }
  }
  const png = await captureCenterRegionPng();
  if (!png) return '';
  return runWindowsOcrOnFile(png);
}

/**
 * Read augment card titles from the center of the screen (Windows OCR).
 */
export async function detectMayhemOfferIds(
  augments: MayhemAugment[],
  minIntervalMs = 2800,
  opts: { minMatches?: number } = {}
): Promise<string[]> {
  const minMatches = opts.minMatches ?? 1;
  if (process.platform !== 'win32') return lastOfferIds;
  const now = Date.now();
  if (now - lastOcrAt < minIntervalMs) return lastOfferIds;
  if (ocrInFlight) return lastOfferIds;
  ocrInFlight = true;
  lastOcrAt = now;
  try {
    const text = await readScreenText();
    lastOcrSnippet = text.slice(0, 400);
    if (!text.trim()) {
      lastCaptureMethod = 'none';
      return lastOfferIds;
    }
    const matched = matchAugmentsFromOcr(text, augments);
    return applyMatchedOffers(text, matched, minMatches);
  } catch (error) {
    console.warn('[mayhem-ocr]', error);
    return lastOfferIds;
  } finally {
    ocrInFlight = false;
  }
}

/** While a Mayhem pick session is active, keep the last good OCR roll instead of clearing on a miss. */
let retainOffersOnEmptyMatch = false;
const offerStability: MayhemOfferStabilityState = { rerollPending: false };

export function setMayhemOcrRetainOffers(retain: boolean): void {
  retainOffersOnEmptyMatch = retain;
  if (!retain) offerStability.rerollPending = false;
}

export function isMayhemOcrRerollPending(): boolean {
  return offerStability.rerollPending;
}

export function resetMayhemOcrCache(): void {
  lastOfferIds = [];
  lastOcrAt = 0;
  lastOcrSnippet = '';
  lastCaptureMethod = 'none';
  offerStability.rerollPending = false;
}

function applyMatchedOffers(text: string, matched: string[], minMatches: number): string[] {
  const previous = lastOfferIds;
  let next = matched.slice(0, 3);

  if (matched.length >= minMatches) {
    next = matched.slice(0, 3);
  } else if (matched.length === 0) {
    if (!retainOffersOnEmptyMatch) {
      lastOfferIds = [];
      return lastOfferIds;
    }
    next = previous;
  } else if (minMatches <= 1 && matched.length >= 1) {
    next = matched.slice(0, 3);
  } else {
    next = previous;
  }

  if (retainOffersOnEmptyMatch) {
    lastOfferIds = stabilizeMayhemOffers(previous, next, text, true, offerStability);
  } else {
    lastOfferIds = next;
  }
  return lastOfferIds;
}
