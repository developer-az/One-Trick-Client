import { app, desktopCapturer, nativeImage, screen } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mayhemFallbackCropRect, maskRectInCapture, mayhemPanelMaskRect } from '../src/logic/mayhem/captureMask';
import {
  matchAugmentOffersFromOcr,
  bestAugmentMatchConfidence,
  countOcrContentLines,
  effectiveAutoMinMatches,
} from '../src/logic/mayhem/match';
import { parseMayhemOcrOutput, type MayhemOcrOutput } from '../src/logic/mayhem/ocrOutput';
import {
  toMayhemMonitorRead,
  type MayhemMonitorRead,
  type MayhemMonitorReadFields,
} from '../src/logic/mayhem/monitor';
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
import { overlayScaleFromHud } from './overlay-bounds';
import { getHudScale } from './overlay-window';
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

/**
 * One OCR frame for the monitor.
 *
 * An alias of the monitor's own type, so a field can never be added on one side
 * only, and every return of `detectMayhemOffers` is built by
 * `toMayhemMonitorRead` (which requires an explicit `owner` decision).
 */
export type MayhemOcrRead = MayhemMonitorRead;

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

/**
 * The mayhem panel footprint for the desktopCapturer fallback, filled black in
 * the captured display image so our own HUD text never reaches the OCR. The
 * PowerShell path masks inside mayhem-ocr.ps1 from the window it captured; this
 * is the same rect in the fallback image's own pixels.
 */
function maskFallbackPanel(img: Electron.NativeImage, display: Electron.Display): Electron.NativeImage {
  try {
    const scale = display.scaleFactor || 1;
    const size = img.getSize();
    const mask = mayhemPanelMaskRect(display.bounds, scale);
    // The thumbnail starts at the display's own origin, so the screen-space
    // rect is translated into the capture before it is filled.
    const local = maskRectInCapture(mask, {
      x: Math.round(display.bounds.x * scale),
      y: Math.round(display.bounds.y * scale),
      width: size.width,
      height: size.height,
    });
    if (!local) return img;
    const buffer = img.toBitmap();
    if (buffer.length !== size.width * size.height * 4) return img;
    const right = Math.min(size.width, local.x + local.width);
    const bottom = Math.min(size.height, local.y + local.height);
    for (let y = Math.max(0, local.y); y < bottom; y += 1) {
      for (let x = Math.max(0, local.x); x < right; x += 1) {
        const offset = (y * size.width + x) * 4;
        buffer[offset] = 0;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 0;
        buffer[offset + 3] = 255;
      }
    }
    const masked = nativeImage.createFromBitmap(buffer, { width: size.width, height: size.height });
    return masked.isEmpty() ? img : masked;
  } catch {
    return img;
  }
}

/** The hudScale the overlay is currently rendered with, as --overlay-scale. */
function panelScaleForCapture(): number {
  try {
    return overlayScaleFromHud(getHudScale());
  } catch {
    return 0.85;
  }
}

/** `owner` from the PowerShell target marker; older scripts omit it. */
export function parseTargetOwner(raw: string): boolean | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('__OT_TARGET__')) continue;
    try {
      const src = JSON.parse(trimmed.slice('__OT_TARGET__'.length).trim()) as Record<string, unknown>;
      if (typeof src.owner === 'boolean') return src.owner;
      if (typeof src.owner === 'string') {
        const value = src.owner.toLowerCase();
        if (value === 'true') return true;
        if (value === 'false') return false;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  return undefined;
}

function logCaptureTarget(parsed: MayhemOcrOutput, owner: boolean | undefined): void {
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
    owner: owner ?? null,
  });
}

export interface ScreenRead {
  parsed: MayhemOcrOutput;
  owner: boolean | undefined;
}

/** Test seam: replace the PowerShell/desktopCapturer capture+OCR pass. */
export type MayhemScreenReader = () => Promise<ScreenRead>;

export interface DetectMayhemOffersOptions {
  minMatches?: number;
  /**
   * The match is already Mayhem (queue/latch), so a roll of cards the bundle
   * does not know must still display. Without it a title-case junk line cannot
   * become a placeholder on a classic ARAM read.
   */
  mayhemMatch?: boolean;
  /** Injected reader, so a verify can drive the real parse/accept path. */
  readScreen?: MayhemScreenReader;
}

/**
 * A hung PowerShell must never be able to wedge the scan loop: the child is
 * killed and the call rejects, so `ocrInFlight` is released in the finally and
 * later scans still run.
 */
const OCR_PROCESS_TIMEOUT_MS = 30_000;

function runPowerShellCaptureAndOcr(): Promise<ScreenRead> {
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
      // Ownership: the game window or this process (our overlay) must own the
      // foreground, so a browser sitting over the game's rect cannot be read
      // as an offer frame.
      '-OwnerPid',
      String(process.pid),
      // The panel mask is derived inside the script from the captured frame;
      // only the overlay's own scale crosses the boundary.
      '-PanelScale',
      panelScaleForCapture().toFixed(3),
    ];
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let out = '';
    let err = '';
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const removeTemp = (): void => {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      removeTemp();
      action();
    };
    killTimer = setTimeout(() => {
      try {
        ps.kill();
      } catch {
        /* already gone */
      }
      finish(() => {
        logOcrError(`PowerShell capture/OCR timed out after ${OCR_PROCESS_TIMEOUT_MS} ms`);
        reject(new Error(`PowerShell capture/OCR timed out after ${OCR_PROCESS_TIMEOUT_MS} ms`));
      });
    }, OCR_PROCESS_TIMEOUT_MS);
    ps.stdout.on('data', (c) => {
      out += String(c);
    });
    ps.stderr.on('data', (c) => {
      err += String(c);
    });
    ps.on('close', (code) => {
      finish(() => {
        if (code !== 0 && code !== null) {
          reject(new Error(err.trim() || `PowerShell capture/OCR exit ${code}`));
          return;
        }
        lastCaptureMethod = 'powershell';
        resolve({ parsed: parseMayhemOcrOutput(out), owner: parseTargetOwner(out) });
      });
    });
    ps.on('error', (error) => finish(() => reject(error)));
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
    // Blank the mayhem panel in the full frame first, then cut the offer band:
    // the panel is inside the band and its text must not reach the OCR.
    const masked = maskFallbackPanel(img, display);
    // Same offer band as the PowerShell capture (0.08/0.18/0.84x0.62): a
    // wider fallback crop could read UI outside the cards the OCR expects.
    const crop = mayhemFallbackCropRect(width, height);
    const cropped = masked.crop({
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
    });
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

async function readScreenText(): Promise<ScreenRead> {
  if (process.platform === 'win32') {
    try {
      return await runPowerShellCaptureAndOcr();
    } catch (error) {
      logOcrError(`PowerShell capture failed, trying desktopCapturer: ${String(error)}`);
    }
  }
  const png = await captureCenterRegionPng();
  if (!png) {
    return {
      parsed: { text: '', target: null, blackFrame: false, language: null, noTarget: true, fallback: false },
      owner: undefined,
    };
  }
  const text = await runWindowsOcrOnFile(png);
  return {
    parsed: { text, target: null, blackFrame: false, language: null, noTarget: false, fallback: true },
    owner: undefined,
  };
}

/**
 * Read augment card titles from the game window (Windows OCR).
 * Returns enough metadata for the monitor to know whether it may trust this
 * frame (fresh read, a real game window, non-black). `foreground` is recorded
 * for logs only: the overlay can steal focus while the game is still captured.
 *
 * Every return crosses `toMayhemMonitorRead`, so `owner` (the trust gate) is a
 * required decision on all of them — the success path once returned a bare
 * literal that silently dropped it.
 */
export async function detectMayhemOffers(
  augments: MayhemAugment[],
  minIntervalMs = 2800,
  opts: DetectMayhemOffersOptions = {}
): Promise<MayhemOcrRead> {
  const minMatches = opts.minMatches ?? 1;
  const mayhemMatch = opts.mayhemMatch === true;
  const idleFields = {
    ids: lastOfferIds,
    candidateIds: [],
    frameIds: [],
    fresh: false,
    valid: false,
    fuzzyScore: lastFuzzyScore,
    blackFrame: blackFrameSeen,
    foreground: true,
    fallback: false,
  } satisfies MayhemMonitorReadFields;
  // A throttled/idle read never counts (fresh is false); it still crosses the
  // seam so the gate is a decision on every return, never an omission.
  const idle = toMayhemMonitorRead(idleFields, undefined);
  if (process.platform !== 'win32') return idle;
  const now = Date.now();
  if (now - lastOcrAt < minIntervalMs) return idle;
  if (ocrInFlight) return idle;
  ocrInFlight = true;
  lastOcrAt = now;
  const ocrStart = performance.now();
  try {
    const readScreen = opts.readScreen ?? readScreenText;
    const { parsed, owner } = await readScreen();
    logCaptureTarget(parsed, owner);
    if (parsed.blackFrame) {
      blackFrameSeen = true;
      overlayLog('ocr-black-frame', { reason: 'exclusive-fullscreen-or-hidden-window' });
    }
    // Keep the focus state for logs. It no longer gates trust on its own: our
    // overlay can own the foreground while the game window is still what was
    // captured. `owner` is the trust gate: the foreground must belong to the
    // game or to us, so a browser over the game rect can never count.
    // A fallback (no game window matched) captured the primary screen: its
    // offers may display, but it never counts a pick.
    // Assume foreground for manual scans; the counter refuses to count picks
    // from a fallback frame (see runMayhemMonitorScan).
    const foreground = parsed.fallback
      ? true
      : parsed.target
        ? parsed.target.foreground !== false
        : false;
    const baseFields = {
      ids: lastOfferIds,
      candidateIds: [],
      frameIds: [],
      fresh: true,
      valid: true,
      fuzzyScore: lastFuzzyScore,
      blackFrame: parsed.blackFrame,
      foreground,
      fallback: parsed.fallback,
    } satisfies MayhemMonitorReadFields;
    if (parsed.noTarget) {
      lastCaptureMethod = 'none';
      return toMayhemMonitorRead({ ...baseFields, valid: false, foreground: false }, owner);
    }
    lastOcrSnippet = parsed.text.slice(0, 400);
    if (!parsed.text.trim()) {
      lastCaptureMethod = 'none';
      lastFuzzyScore = 0;
      return toMayhemMonitorRead({ ...baseFields, fuzzyScore: 0 }, owner);
    }
    const fuzzyScore = bestAugmentMatchConfidence(parsed.text, augments);
    const effectiveMin = effectiveAutoMinMatches({
      configured: minMatches,
      fuzzyScore,
      contentLines: countOcrContentLines(parsed.text),
    });
    const matched = matchAugmentOffersFromOcr(parsed.text, augments, mayhemMatch);
    lastFuzzyScore = fuzzyScore;
    const accepted = applyMatchedOffers(parsed.text, matched.ids, effectiveMin, fuzzyScore);
    return toMayhemMonitorRead(
      {
        ids: accepted.ids,
        candidateIds: accepted.candidateIds,
        // Trust path only: `unknown:` placeholders stay on the display roll.
        frameIds: accepted.frameIds,
        fresh: true,
        valid: true,
        fuzzyScore,
        blackFrame: parsed.blackFrame,
        foreground,
        fallback: parsed.fallback,
      },
      owner
    );
  } catch (error) {
    logOcrError(String(error));
    return toMayhemMonitorRead({ ...idleFields, fresh: true, valid: false }, undefined);
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

/**
 * `retain` follows whether the HUD is on screen, but `rerollPending` belongs to
 * the roll: a 1-card reroll read arms the 550 ms fast poll, and clearing it here
 * would drop back to the 1.4 s idle gap for exactly the frames that need the
 * quick retry. The flag is inert while retain is off (the poll reads it only
 * when the HUD is up) and `stabilizeMayhemOffers` clears it as soon as the full
 * roll is on screen, so it cannot leak forever.
 */
export function setMayhemOcrRetainOffers(retain: boolean): void {
  retainOffersOnEmptyMatch = retain;
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
