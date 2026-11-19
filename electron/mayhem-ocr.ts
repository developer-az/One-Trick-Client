import { app, desktopCapturer, nativeImage, screen } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mayhemFallbackCropRect, maskRectInCapture, mayhemPanelMaskRect } from '../src/logic/mayhem/captureMask';
import { bestAugmentMatchConfidence } from '../src/logic/mayhem/match';
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
import { stabilizeMayhemOffers, type MayhemOfferStabilityState } from '../src/logic/mayhem/offerStability';
import {
  classifyMayhemFrame,
  createMayhemPipelineState,
  type MayhemFrameDecision,
  type MayhemFrameLine,
} from '../src/logic/mayhem/pipeline';
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
/** Hysteresis for the geometry-gated pipeline (lone-card confirm / ignore window). */
const pipelineState = createMayhemPipelineState();
let lastOcrAt = 0;
let lastOcrSnippet = '';
let lastCaptureMethod: 'powershell' | 'desktop' | 'none' = 'none';
let lastFuzzyScore = 0;
let blackFrameSeen = false;
/** One `ocr-target` line per captured window per match (the game pid changes every game). */
let loggedTargetSignature = '';

/** Why a `detectMayhemOffers` call did not capture at all. */
export type MayhemOcrRefusal = 'in-flight' | 'throttled' | 'unsupported' | null;

/**
 * One OCR frame for the monitor.
 *
 * An alias of the monitor's own type, so a field can never be added on one side
 * only, and every return of `detectMayhemOffers` is built by
 * `toMayhemMonitorRead` (which requires an explicit `owner` decision).
 *
 * `refusal` is the scan's own verdict on why it did not run: sampled here, at
 * the moment the throttle/in-flight check decides, instead of by the caller
 * re-reading module state after the await (a scan that finished in the same
 * turn would be mislabelled).
 */
export type MayhemOcrRead = MayhemMonitorRead & {
  refusal: MayhemOcrRefusal;
  /** The geometry-gated pipeline's decision for this frame. */
  decision: MayhemFrameDecision;
};

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
  pipelineState.pending = null;
  pipelineState.ignoreLoneUntil = 0;
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

/**
 * `owner` from the PowerShell target marker; older scripts omit it.
 *
 * A truncated JSON payload (the marker line always starts with `{` because the
 * script uses ConvertTo-Json) is a target line whose owner could not be read:
 * that is present-but-unparsable, so it is reported untrusted. A payload that
 * is not JSON at all is an older key=value line that never reported an owner:
 * absent, so `undefined` (the seam's documented legacy default).
 */
export function parseTargetOwner(raw: string): boolean | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('__OT_TARGET__')) continue;
    const payload = trimmed.slice('__OT_TARGET__'.length).trim();
    try {
      const src = JSON.parse(payload) as Record<string, unknown>;
      if (typeof src.owner === 'boolean') return src.owner;
      if (typeof src.owner === 'string') {
        const value = src.owner.toLowerCase();
        if (value === 'true') return true;
        if (value === 'false') return false;
      }
    } catch {
      return payload.startsWith('{') ? false : undefined;
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

/** One bounded, redacted line per classified frame (no summoner names, no card text). */
function logMayhemFrame(detail: {
  reason: string;
  lineCount: number;
  cardCount: number;
  target: string;
  owner: boolean | undefined;
  acceptedIds: string[];
  decision: MayhemFrameDecision;
}): void {
  overlayLog('mayhem-frame', {
    reason: detail.reason.slice(0, 200),
    lineCount: detail.lineCount,
    cardCount: detail.cardCount,
    target: detail.target,
    owner: detail.owner ?? null,
    acceptedIds: detail.acceptedIds,
    decision: detail.decision,
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
  /** A forced manual read (PageDown): the only case a `preview` decision is honoured. */
  forcedManual?: boolean;
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
  const mayhemMatch = opts.mayhemMatch === true;
  const idleFields = {
    ids: lastOfferIds,
    candidateIds: [],
    frameIds: [],
    frameDisplayCount: 0,
    fresh: false,
    valid: false,
    fuzzyScore: lastFuzzyScore,
    blackFrame: blackFrameSeen,
    foreground: true,
    fallback: false,
  } satisfies MayhemMonitorReadFields;
  // A throttled/idle read never counts (fresh is false); it still crosses the
  // seam so the gate is a decision on every return, never an omission.
  const idle = { ...toMayhemMonitorRead(idleFields, undefined), decision: 'unverified' as const };
  /** A call that actually captured: it crosses the seam and carries no refusal. */
  const ran = (
    fields: MayhemMonitorReadFields,
    trust: boolean | undefined,
    decision: MayhemFrameDecision = 'unverified'
  ): MayhemOcrRead => ({
    ...toMayhemMonitorRead(fields, trust),
    refusal: null,
    decision,
  });
  // Non-Windows has no capture/OCR path at all: this is not a throttle, and the
  // hotkey log must not claim one. Sentinels stay untrusted/unusable.
  if (process.platform !== 'win32') return { ...idle, refusal: 'unsupported' };
  const now = Date.now();
  if (now - lastOcrAt < minIntervalMs) return { ...idle, refusal: 'throttled' };
  if (ocrInFlight) return { ...idle, refusal: 'in-flight' };
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
      frameDisplayCount: 0,
      fresh: true,
      valid: true,
      fuzzyScore: lastFuzzyScore,
      blackFrame: parsed.blackFrame,
      foreground,
      fallback: parsed.fallback,
    } satisfies MayhemMonitorReadFields;
    if (parsed.noTarget) {
      lastCaptureMethod = 'none';
      return ran({ ...baseFields, valid: false, foreground: false }, owner);
    }
    lastOcrSnippet = parsed.text.slice(0, 400);
    const lines = parsed.lines;
    // Windows OCR succeeded on a real game window and saw zero lines. That is a
    // genuine empty scan the monitor needs to count a completed pick; it emits
    // no ids and keeps a full roll from being invented out of nothing. A failed,
    // black, fallback or box-less NONEMPTY read stays invalid below.
    const emptyGameFrame =
      parsed.emptyFrame === true &&
      Boolean(parsed.target) &&
      !parsed.blackFrame && !parsed.fallback && !parsed.noTarget &&
      (lines?.length ?? 0) === 0 && !parsed.text.trim();
    if (emptyGameFrame) {
      lastCaptureMethod = 'none';
      lastFuzzyScore = 0;
      return ran(
        {
          ids: [], candidateIds: [], frameIds: [], frameDisplayCount: 0,
          fresh: true, valid: true, fuzzyScore: 0,
          blackFrame: false,
          foreground,
          fallback: false,
        },
        owner,
        'unverified'
      );
    }
    // Without per-line boxes geometry cannot verify a roll. The legacy
    // text-only matcher is gone: such a frame cannot identify, arm, evict or
    // purge anything. `lastOcrSnippet` is the only retained diagnostic.
    if (!lines || lines.length === 0 || !parsed.text.trim()) {
      lastCaptureMethod = 'none';
      lastFuzzyScore = 0;
      return ran(
        {
          ids: [], candidateIds: [], frameIds: [], frameDisplayCount: 0,
          fresh: true, valid: false, fuzzyScore: 0,
          blackFrame: parsed.blackFrame,
          foreground,
          fallback: parsed.fallback,
        },
        owner,
        'unverified'
      );
    }
    const fuzzyScore = bestAugmentMatchConfidence(parsed.text, augments);
    lastFuzzyScore = fuzzyScore;

    // Geometry-gated pipeline: NO id is emitted until classifyMayhemFrame
    // accepts the frame. A preview is only honoured for a forced manual read;
    // unverified emits nothing at all.
    const evidence = classifyMayhemFrame({
      lines: lines as MayhemFrameLine[],
      augments,
      mode: mayhemMatch ? 'mayhem' : 'classic',
      state: pipelineState,
      now,
    });
    const decision: MayhemFrameDecision =
      !opts.forcedManual && evidence.decision === 'preview' ? 'unverified' : evidence.decision;
    const acceptedIds = decision === 'accept' ? evidence.ids : [];
    const frameIds = decision === 'accept' ? evidence.knownIds : [];
    logMayhemFrame({
      reason: evidence.reasons.join(','),
      lineCount: lines.length,
      cardCount: evidence.cardCount,
      target: parsed.target ? 'window' : parsed.fallback ? 'fallback' : 'none',
      owner,
      acceptedIds,
      decision,
    });
    if (decision === 'accept') {
      // Keep reroll/fast-poll bookkeeping; the pipeline owns the display ids
      // (so a four-card roll is not re-capped by stabilize's 3-id helper).
      stabilizeMayhemOffers(lastOfferIds, acceptedIds, parsed.text, retainOffersOnEmptyMatch, offerStability);
      lastOfferIds = acceptedIds;
    }
    return ran(
      {
        ids: acceptedIds,
        candidateIds: [],
        frameIds,
        frameDisplayCount: evidence.cardCount,
        fresh: true,
        valid: decision === 'accept',
        fuzzyScore,
        blackFrame: parsed.blackFrame,
        foreground,
        fallback: parsed.fallback,
      },
      owner,
      decision
    );
  } catch (error) {
    logOcrError(String(error));
    return ran({ ...idleFields, fresh: true, valid: false }, undefined);
  } finally {
    recordLatency('ocr.mayhem', performance.now() - ocrStart);
    ocrInFlight = false;
  }
}

/** While a Mayhem pick session is active, keep the last good OCR roll instead of clearing on a miss. */
let retainOffersOnEmptyMatch = false;
const offerStability: MayhemOfferStabilityState = { rerollPending: false };

/**
 * `retain` follows whether the HUD is on screen, but `rerollPending` belongs to
 * the roll: a 1-card reroll read arms the 550 ms fast poll, and clearing it here
 * would drop back to the 1.4 s idle gap for exactly the frames that need the
 * quick retry. The flag is inert while retain is off — the poll reads it only
 * when the HUD is up, and a retain-off frame passes through the stability
 * guard's no-session branch, which clears it — and `stabilizeMayhemOffers`
 * clears it as soon as the full roll is on screen, so it cannot leak forever.
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
  pipelineState.pending = null;
  pipelineState.ignoreLoneUntil = 0;
}

