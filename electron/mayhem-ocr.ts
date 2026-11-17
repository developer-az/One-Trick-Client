import { app, desktopCapturer, screen } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { formatMaskRects, mayhemPanelMaskRect } from '../src/logic/mayhem/captureMask';
import {
  bestAugmentMatchConfidence,
  countOcrContentLines,
  effectiveAutoMinMatches,
  matchAugmentsFromOcr,
} from '../src/logic/mayhem/match';
import { parseMayhemOcrOutput, type MayhemOcrOutput } from '../src/logic/mayhem/ocrOutput';
import {
  mayhemOcrScriptCandidates,
  resolveOcrScriptPath,
} from '../src/logic/mayhem/ocrScriptPath';
import {
  acceptMayhemOfferFrame,
} from '../src/logic/mayhem/offerAcceptance';
import type { MayhemOfferStabilityState } from '../src/logic/mayhem/offerStability';
import { runMayhemOcrOnImageFile } from '../src/logic/mayhem/ocrRunner';
import type { MayhemAugment } from '../src/logic/mayhem/types';
import { overlayLog } from './overlay-log';
import { recordLatency } from './state-service';

function ocrScriptPath(): string {
  const appPath = app.getAppPath();
  return resolveOcrScriptPath(mayhemOcrScriptCandidates(appPath, __dirname));
}

let ocrInFlight = false;
let lastOfferIds: string[] = [];
let lastOcrAt = 0;
let lastOcrSnippet = '';
let lastCaptureMethod: 'powershell' | 'desktop' | 'none' = 'none';
let lastFuzzyScore = 0;
let blackFrameSeen = false;
/** One `ocr-target` line per captured window per match (the game pid changes every game). */
let loggedTargetSignature = '';

export interface MayhemOcrRead {
  /** Display ids: this frame's matches, or the retained roll while a pick session is open. */
  ids: string[];
  /**
   * One high-confidence match that is not display-worthy yet. The monitor
   * promotes it after the same id appears on consecutive scans.
   */
  candidateIds: string[];
  /**
   * Offer ids matched on THIS frame only. Never the retained/display set, so a
   * blank frame reads as zero even while the HUD keeps the previous roll up.
   */
  frameIds: string[];
  /** A real capture + OCR pass ran for this call (not throttled/cached). */
  fresh: boolean;
  /**
   * The capture + OCR pass produced a trustworthy frame. False for a failed
   * capture, no game window or an OCR exception: such reads must neither
   * advance nor reset the visibility/pick streaks.
   */
  valid: boolean;
  /** Best fuzzy score (0–1) of the matched card titles on this pass. */
  fuzzyScore: number;
  blackFrame: boolean;
  /** The game window owned the foreground when it was captured. */
  foreground: boolean;
  /** The capture fell back to the primary screen because no game window matched. */
  fallback?: boolean;
}

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

/** The augment OCR saw an all-black frame this match (exclusive fullscreen). */
export function mayhemOcrBlackFrameSeen(): boolean {
  return blackFrameSeen;
}

/** Called when a match's mode loop starts; the hint is per match, not per pick. */
export function resetMayhemOcrMatchFlags(): void {
  blackFrameSeen = false;
  loggedTargetSignature = '';
}

function displayForCapture(): Electron.Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

function logOcrError(message: string): void {
  console.warn('[mayhem-ocr]', message);
  overlayLog('ocr-error', { message });
}

/** Mask the right-rail mayhem panel so our own HUD never becomes OCR text. */
function captureMaskSpec(): string {
  try {
    const display = displayForCapture();
    return formatMaskRects([mayhemPanelMaskRect(display.bounds, display.scaleFactor || 1)]);
  } catch {
    return '';
  }
}

function logCaptureTarget(parsed: MayhemOcrOutput): void {
  if (parsed.language) overlayLog('ocr-language', { language: parsed.language });
  if (parsed.noTarget) {
    logOcrError('game window not found (League of Legends / RiotWindowClass)');
    return;
  }
  if (parsed.fallback) {
    if (loggedTargetSignature !== 'fallback') {
      loggedTargetSignature = 'fallback';
      overlayLog('ocr-target', { target: 'fallback', source: 'fallback' });
    }
    return;
  }
  const target = parsed.target;
  if (!target) return;
  const signature = `${target.pid}|${target.rect}|${target.frame}`;
  if (signature === loggedTargetSignature) return;
  loggedTargetSignature = signature;
  // Pending in-game verification: the process name, window class and client
  // rect are inferred from the game executable, not yet confirmed live.
  overlayLog('ocr-target', {
    target: 'window',
    source: 'window',
    pid: target.pid ?? 'unknown',
    exe: target.exe ?? 'unknown',
    class: target.className ?? 'unknown',
    rect: target.rect ?? 'unknown',
    frame: target.frame ?? 'unknown',
    black: target.black === true,
    fg: target.foreground !== false,
  });
}

function runPowerShellCaptureAndOcr(): Promise<MayhemOcrOutput> {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `onetrick-mayhem-${Date.now()}.png`);
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ocrScriptPath(),
      '-CaptureScreen',
      '-UseGameWindow',
      '-ImagePath',
      tmp,
    ];
    const mask = captureMaskSpec();
    if (mask) args.push('-MaskRects', mask);
    const ps = spawn('powershell.exe', args, { windowsHide: true });
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
      resolve(parseMayhemOcrOutput(out));
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
    logOcrError(`desktop capture failed: ${String(error)}`);
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

async function readScreenText(): Promise<MayhemOcrOutput> {
  if (process.platform === 'win32') {
    try {
      return await runPowerShellCaptureAndOcr();
    } catch (error) {
      logOcrError(`PowerShell capture failed, trying desktopCapturer: ${String(error)}`);
    }
  }
  const png = await captureCenterRegionPng();
  if (!png) {
    return { text: '', target: null, blackFrame: false, language: null, noTarget: true, fallback: false };
  }
  const text = await runWindowsOcrOnFile(png);
  return { text, target: null, blackFrame: false, language: null, noTarget: false, fallback: true };
}

/**
 * Read augment card titles from the game window (Windows OCR).
 * Returns enough metadata for the pick counter to know whether it may trust
 * this frame (fresh read, foreground, non-black).
 */
export async function detectMayhemOffers(
  augments: MayhemAugment[],
  minIntervalMs = 2800,
  opts: { minMatches?: number } = {}
): Promise<MayhemOcrRead> {
  const minMatches = opts.minMatches ?? 1;
  const idle: MayhemOcrRead = {
    ids: lastOfferIds,
    candidateIds: [],
    frameIds: [],
    fresh: false,
    valid: false,
    fuzzyScore: lastFuzzyScore,
    blackFrame: blackFrameSeen,
    foreground: true,
    fallback: false,
  };
  if (process.platform !== 'win32') return idle;
  const now = Date.now();
  if (now - lastOcrAt < minIntervalMs) return idle;
  if (ocrInFlight) return idle;
  ocrInFlight = true;
  lastOcrAt = now;
  const ocrStart = performance.now();
  try {
    const parsed = await readScreenText();
    logCaptureTarget(parsed);
    if (parsed.blackFrame) {
      blackFrameSeen = true;
      overlayLog('ocr-black-frame', { reason: 'exclusive-fullscreen-or-hidden-window' });
    }
    // A foreground read is only trusted when the game window itself was
    // captured. A fallback (no game window matched) captured the primary screen
    // and cropped its offer band: usable, but it cannot prove what was on top.
    // Assume foreground for manual scans; the counter refuses to count picks
    // from a fallback frame (see runMayhemMonitorScan).
    const foreground = parsed.fallback
      ? true
      : parsed.target
        ? parsed.target.foreground !== false
        : false;
    const base: MayhemOcrRead = {
      ids: lastOfferIds,
      candidateIds: [],
      frameIds: [],
      fresh: true,
      valid: true,
      fuzzyScore: lastFuzzyScore,
      blackFrame: parsed.blackFrame,
      foreground,
      fallback: parsed.fallback,
    };
    if (parsed.noTarget) {
      lastCaptureMethod = 'none';
      return { ...base, valid: false, foreground: false };
    }
    lastOcrSnippet = parsed.text.slice(0, 400);
    if (!parsed.text.trim()) {
      lastCaptureMethod = 'none';
      lastFuzzyScore = 0;
      return { ...base, fuzzyScore: 0 };
    }
    const fuzzyScore = bestAugmentMatchConfidence(parsed.text, augments);
    const effectiveMin = effectiveAutoMinMatches({
      configured: minMatches,
      fuzzyScore,
      contentLines: countOcrContentLines(parsed.text),
    });
    const matched = matchAugmentsFromOcr(parsed.text, augments);
    lastFuzzyScore = fuzzyScore;
    const accepted = applyMatchedOffers(parsed.text, matched, effectiveMin, fuzzyScore);
    return {
      ids: accepted.ids,
      candidateIds: accepted.candidateIds,
      frameIds: accepted.frameIds,
      fresh: true,
      valid: true,
      fuzzyScore,
      blackFrame: parsed.blackFrame,
      foreground,
      fallback: parsed.fallback,
    };
  } catch (error) {
    logOcrError(String(error));
    return { ...idle, fresh: true, valid: false };
  } finally {
    recordLatency('ocr.mayhem', performance.now() - ocrStart);
    ocrInFlight = false;
  }
}

/** Back-compat wrapper for callers that only need the ids. */
export async function detectMayhemOfferIds(
  augments: MayhemAugment[],
  minIntervalMs = 2800,
  opts: { minMatches?: number } = {}
): Promise<string[]> {
  return (await detectMayhemOffers(augments, minIntervalMs, opts)).ids;
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
  lastFuzzyScore = 0;
  offerStability.rerollPending = false;
}

function applyMatchedOffers(
  text: string,
  matched: string[],
  minMatches: number,
  fuzzyScore: number
): { ids: string[]; candidateIds: string[]; frameIds: string[] } {
  const accepted = acceptMayhemOfferFrame({
    text,
    matched,
    minMatches,
    fuzzyScore,
    previousIds: lastOfferIds,
    retain: retainOffersOnEmptyMatch,
    stability: offerStability,
  });
  lastOfferIds = accepted.ids;
  return accepted;
}
