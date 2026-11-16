/**
 * The Mayhem match monitor's decision core.
 *
 * `game-monitor.ts` owns timers, payloads and the overlay; this module owns the
 * parts that need to be proven without Electron:
 *
 *   1. bounded discovery for an unknown-queue ARAM game (the queue id is not
 *      verified live yet, so a Mayhem game can report a null/unknown queue on
 *      Howling Abyss and must be recognised from augment offers on screen);
 *   2. frame-accurate pick counting (only ids matched on the current frame may
 *      move the counter, never the retained display roll);
 *   3. invalid reads (failed capture, no game window, OCR exception) neither
 *      advance nor reset the visibility/pick streaks.
 *
 * The OCR runner is injected so `verify_mayhem_monitor.ts` can drive the real
 * scan state machine with scripted reads.
 */

import {
  ARAM_QUEUE_IDS,
  MAYHEM_QUEUE_IDS,
  detectMayhemMode,
  type MayhemMode,
  type MayhemModeSignals,
} from './mode';
import {
  createMayhemPickCounterState,
  observeMayhemPickScan,
  type MayhemPickCounterState,
} from './pickCount';

/** Bounded discovery: at most one scan per this window (foreground-only). */
export const MAYHEM_DISCOVERY_INTERVAL_MS = 10_000;
/** Give up discovery after three minutes without an offer read. */
export const MAYHEM_DISCOVERY_WINDOW_MS = 180_000;
/** Two cards on the same frame are required to classify an unknown queue. */
export const MAYHEM_DISCOVERY_MIN_OFFERS = 2;

/** One OCR frame as the monitor sees it (structural subset of MayhemOcrRead). */
export interface MayhemMonitorRead {
  /** Display ids: current matches or the retained roll while the HUD is open. */
  ids: string[];
  /** Ids matched on this frame only; the pick counter reads nothing else. */
  frameIds: string[];
  fresh: boolean;
  valid: boolean;
  fuzzyScore: number;
  blackFrame: boolean;
  foreground: boolean;
}

export interface MayhemDiscoveryState {
  /** First discovery scan of this match; null before the first / after expiry. */
  startedAt: number | null;
  /** Last discovery scan attempt (rate limit: one per interval). */
  lastScanAt: number;
  /** An unknown-queue game showed augment offers: it is Mayhem for this match. */
  latched: boolean;
}

export interface MayhemMonitorState {
  counter: MayhemPickCounterState;
  /** Consecutive valid scans that read at least one offer (single-card HUD gate). */
  scanStreak: number;
  /** Best fuzzy score of the last valid scan. */
  fuzzyScore: number;
  /** Ids the HUD may draw (retained rolls included). */
  displayIds: string[];
  discovery: MayhemDiscoveryState;
}

export function createMayhemMonitorState(): MayhemMonitorState {
  return {
    counter: createMayhemPickCounterState(),
    scanStreak: 0,
    fuzzyScore: 0,
    displayIds: [],
    discovery: { startedAt: null, lastScanAt: 0, latched: false },
  };
}

/**
 * An ARAM game whose queue id is not a known classic-ARAM or Mayhem queue.
 * Classic ARAM (450/100) is never a discovery candidate: it has no augments.
 */
export function isUnknownQueueAram(signals: MayhemModeSignals): boolean {
  const mode = (signals.gameMode || '').toUpperCase();
  const map = (signals.mapName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const aramMap =
    mode.includes('ARAM') || map.includes('howling') || map === 'map12' || signals.mapId === 12;
  if (!aramMap) return false;
  const queue = signals.queueId;
  if (typeof queue !== 'number' || !Number.isFinite(queue)) return true;
  return !MAYHEM_QUEUE_IDS.includes(queue) && !ARAM_QUEUE_IDS.includes(queue);
}

/** Discovery is live until three minutes after its first scan. */
export function mayhemDiscoveryLive(discovery: MayhemDiscoveryState, now: number): boolean {
  if (discovery.startedAt == null) return false;
  return now - discovery.startedAt < MAYHEM_DISCOVERY_WINDOW_MS;
}

/** Classify with this match's latch (once discovered, it stays Mayhem all game). */
export function mayhemMonitorMode(
  state: MayhemMonitorState,
  signals: MayhemModeSignals
): MayhemMode {
  if (state.discovery.latched) return 'mayhem';
  return detectMayhemMode({
    ...signals,
    augmentOffersDetected:
      state.displayIds.length >= MAYHEM_DISCOVERY_MIN_OFFERS ||
      signals.augmentOffersDetected === true,
  });
}

/** True when the next discovery scan is due (≤1 per interval). */
export function mayhemDiscoveryDue(state: MayhemMonitorState, now: number): boolean {
  if (state.discovery.lastScanAt <= 0) return true;
  return now - state.discovery.lastScanAt >= MAYHEM_DISCOVERY_INTERVAL_MS;
}

/** Is a scan (normal Mayhem or bounded discovery) wanted right now? */
export function mayhemMonitorWantsScan(
  state: MayhemMonitorState,
  signals: MayhemModeSignals,
  now: number
): 'mayhem' | 'discovery' | 'none' {
  if (mayhemMonitorMode(state, signals) === 'mayhem') return 'mayhem';
  if (!isUnknownQueueAram(signals)) return 'none';
  if (state.discovery.startedAt != null && !mayhemDiscoveryLive(state.discovery, now)) return 'none';
  return 'discovery';
}

export interface MayhemMonitorInput {
  now: number;
  level: number;
  isDead: boolean;
  signals: MayhemModeSignals;
  liveAugmentIds: string[];
  /** The in-match level gate / user dismissal. Discovery ignores it. */
  autoOcrAllowed: boolean;
}

export interface MayhemMonitorResult {
  state: MayhemMonitorState;
  /** runOcr actually ran on this tick. */
  scanned: boolean;
  /** Picks newly counted by this scan. */
  counted: number;
  mode: MayhemMode;
  /** This scan ran as bounded discovery (unknown-queue ARAM). */
  discovery: boolean;
}

/**
 * One monitor tick: decide whether to scan, run the injected OCR, then fold the
 * frame into the pick counter and discovery latch. Mirrors what the live poll
 * does, with no Electron dependency.
 */
export async function runMayhemMonitorScan(
  state: MayhemMonitorState,
  input: MayhemMonitorInput,
  runOcr: (minMatches: number) => Promise<MayhemMonitorRead>
): Promise<MayhemMonitorResult> {
  const next: MayhemMonitorState = {
    ...state,
    counter: { ...state.counter },
    displayIds: [...state.displayIds],
    discovery: { ...state.discovery },
  };
  const wanted = mayhemMonitorWantsScan(next, input.signals, input.now);
  if (wanted === 'none') {
    return { state: next, scanned: false, counted: 0, mode: mayhemMonitorMode(next, input.signals), discovery: false };
  }
  const discovery = wanted === 'discovery';
  if (discovery) {
    if (next.discovery.startedAt == null) next.discovery.startedAt = input.now;
    if (!mayhemDiscoveryDue(next, input.now)) {
      return { state: next, scanned: false, counted: 0, mode: 'aram', discovery: true };
    }
    // Every attempt (successful or not) consumes the 10 s slot.
    next.discovery.lastScanAt = input.now;
  } else if (!input.autoOcrAllowed) {
    return { state: next, scanned: false, counted: 0, mode: 'mayhem', discovery: false };
  }

  const read = await runOcr(MAYHEM_DISCOVERY_MIN_OFFERS);
  const before = next.counter.picksTaken;
  // A failed capture / missing game window / OCR exception is not a frame at
  // all: it must not advance or reset either streak.
  const trusted = read.fresh && read.valid && read.foreground && !read.blackFrame;
  if (read.fresh) {
    next.fuzzyScore = read.fuzzyScore;
    if (trusted) {
      next.scanStreak = read.frameIds.length > 0 ? next.scanStreak + 1 : 0;
      next.counter = observeMayhemPickScan(next.counter, {
        offerCount: read.frameIds.length,
        isDead: input.isDead,
        foreground: read.foreground,
        blackFrame: read.blackFrame,
        liveAugmentIds: input.liveAugmentIds,
      });
    }
    next.displayIds = read.ids;
    if (discovery && trusted && read.frameIds.length >= MAYHEM_DISCOVERY_MIN_OFFERS) {
      next.discovery.latched = true;
      next.discovery.startedAt = null;
    }
  }

  let mode: MayhemMode = 'aram';
  if (next.discovery.latched) mode = 'mayhem';
  else if (!discovery) mode = 'mayhem';
  else if (isUnknownQueueAram(input.signals)) mode = 'aram';
  return {
    state: next,
    scanned: true,
    counted: next.counter.picksTaken - before,
    mode,
    discovery,
  };
}
