/**
 * The Mayhem match monitor's decision core.
 *
 * `game-monitor.ts` owns timers, payloads and the overlay; this module owns the
 * parts that need to be proven without Electron:
 *
 *   1. the normal Mayhem scan schedule for `mayhem` AND `mayhem-likely` (the
 *      queue id is not verified live yet, so a Mayhem game can report a
 *      null/unknown queue on Howling Abyss); bounded discovery remains for any
 *      other ARAM-family signal, including real Mayhem that reports a classic
 *      ARAM queue id;
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
  isAramMap,
  isMayhemMode,
  type MayhemMode,
  type MayhemModeSignals,
} from './mode';
import {
  createMayhemPickCounterState,
  observeMayhemPickScan,
  type MayhemPickCounterState,
} from './pickCount';
import { isMayhemAugmentHudVisible, MIN_SINGLE_OFFER_SCANS } from './visibility';

/** Bounded discovery: at most one scan per this window (foreground-only). */
export const MAYHEM_DISCOVERY_INTERVAL_MS = 10_000;
/**
 * A discovery burst around a plausible augment window. Bursts are opened by
 * reaching level 3/7/11/15 or dying, so a late first augment is still found.
 */
export const MAYHEM_DISCOVERY_BURST_MS = 90_000;
/** Champion levels that can open the augment shop. */
export const MAYHEM_DISCOVERY_LEVELS: readonly number[] = [3, 7, 11, 15];
/** Two cards on the same frame are required to classify an unknown queue. */
export const MAYHEM_DISCOVERY_MIN_OFFERS = 2;

/** One OCR frame as the monitor sees it (structural subset of MayhemOcrRead). */
export interface MayhemMonitorRead {
  /** Display ids: current matches or the retained roll while the HUD is open. */
  ids: string[];
  /** A single high-confidence match waiting for a consecutive scan. */
  candidateIds: string[];
  /** Ids matched on this frame only; the pick counter reads nothing else. */
  frameIds: string[];
  fresh: boolean;
  valid: boolean;
  fuzzyScore: number;
  blackFrame: boolean;
  /** Recorded for logs: the game window owned the foreground. Not a trust gate. */
  foreground: boolean;
  /** Capture used the primary-screen fallback (no game window matched). */
  fallback?: boolean;
}

export interface MayhemDiscoveryState {
  /** Start of the current 90 s burst; null when no burst is active. */
  burstStartedAt: number | null;
  /** Last discovery scan attempt (rate limit: one per interval). */
  lastScanAt: number;
  /** An unknown-queue game showed augment offers: it is Mayhem for this match. */
  latched: boolean;
  /** Highest augment level that already opened a burst this match. */
  levelBurst: number;
  /** Previous frame's death state, so a death starts one burst on its edge. */
  wasDead: boolean;
}

export interface MayhemMonitorState {
  counter: MayhemPickCounterState;
  /** Consecutive valid scans that read at least one offer (single-card HUD gate). */
  scanStreak: number;
  /** Best fuzzy score of the last valid scan. */
  fuzzyScore: number;
  /** Ids the HUD may draw (retained rolls included). */
  displayIds: string[];
  /** The pending single offer and how many consecutive frames agreed on it. */
  candidateIds: string[];
  candidateScans: number;
  discovery: MayhemDiscoveryState;
}

export function createMayhemMonitorState(): MayhemMonitorState {
  return {
    counter: createMayhemPickCounterState(),
    scanStreak: 0,
    fuzzyScore: 0,
    displayIds: [],
    candidateIds: [],
    candidateScans: 0,
    discovery: { burstStartedAt: null, lastScanAt: 0, latched: false, levelBurst: 0, wasDead: false },
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

/**
 * An ARAM-family match the bounded discovery path may observe: Howling Abyss
 * or an ARAM `gameMode`, whatever the queue id says.
 *
 * Real Mayhem can report classic ARAM queues (450/100) even though it has
 * augments, so the queue id cannot veto capture. Discovery still only runs
 * around its bounded triggers and never changes the mode classification by
 * itself.
 */
export function isMayhemDiscoverySignals(signals: MayhemModeSignals): boolean {
  const mode = (signals.gameMode || '').toUpperCase();
  return mode.includes('ARAM') || isAramMap(signals.mapName, signals.mapId);
}

/**
 * A frame the monitor may use at all: a fresh, valid, non-black read. Focus is
 * deliberately ignored — our overlay can own the foreground while the game is
 * still what was captured. A primary-screen fallback is usable for display
 * (the offers may be real) but is not target-trustworthy for counting.
 */
export function isUsableMayhemFrame(read: MayhemMonitorRead): boolean {
  return read.fresh && read.valid && !read.blackFrame;
}

/**
 * A frame that may move the pick counter: a usable read of the game window
 * itself. A fallback primary-screen capture cannot prove the offers were on
 * top, so it never counts. `foreground` stays on the read for logs only.
 */
export function isTrustedMayhemFrame(read: MayhemMonitorRead): boolean {
  return isUsableMayhemFrame(read) && read.fallback !== true;
}

/** Discovery is live for 90 s after its burst was opened. */
export function mayhemDiscoveryLive(discovery: MayhemDiscoveryState, now: number): boolean {
  if (discovery.burstStartedAt == null) return false;
  return now - discovery.burstStartedAt < MAYHEM_DISCOVERY_BURST_MS;
}

/**
 * Open a discovery burst around a plausible augment window: reaching level
 * 3/7/11/15, or a rising death edge (augments are usually chosen dead or at
 * spawn).
 *
 * By default only an unknown-queue ARAM is eligible. Callers that know real
 * Mayhem can report a classic queue id pass `anyAramQueue` so an ARAM-family
 * match is observed regardless of the reported queue.
 * Returns true while a burst is active after this call.
 */
export function noteMayhemDiscoveryTrigger(
  state: MayhemMonitorState,
  input: { now: number; level: number; isDead: boolean; signals: MayhemModeSignals },
  options: { anyAramQueue?: boolean } = {}
): boolean {
  const discovery = state.discovery;
  const eligible = options.anyAramQueue
    ? isMayhemDiscoverySignals(input.signals)
    : isUnknownQueueAram(input.signals);
  if (!discovery.latched && eligible) {
    const levelHit = MAYHEM_DISCOVERY_LEVELS.find(
      (level) => input.level >= level && level > discovery.levelBurst
    );
    const deathEdge = input.isDead && !discovery.wasDead;
    if (levelHit != null) discovery.levelBurst = levelHit;
    if (levelHit != null || deathEdge) discovery.burstStartedAt = input.now;
  }
  discovery.wasDead = input.isDead;
  return !discovery.latched && mayhemDiscoveryLive(discovery, input.now);
}

/**
 * A manual PageDown read. Any ARAM-family game may scan (the caller gates on
 * that), but only an unknown-queue match may be classified from it: classic
 * ARAM 450 must stay ARAM even when augment cards are on screen.
 */
export function noteMayhemManualScan(
  state: MayhemMonitorState,
  signals: MayhemModeSignals,
  read: MayhemMonitorRead
): boolean {
  const usable = isUsableMayhemFrame(read);
  if (!isUnknownQueueAram(signals) || !usable || read.frameIds.length < MAYHEM_DISCOVERY_MIN_OFFERS) {
    return false;
  }
  state.discovery.latched = true;
  state.discovery.burstStartedAt = null;
  return true;
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

/**
 * Is a scan (normal Mayhem or bounded discovery) wanted right now?
 *
 * `mayhem-likely` (unknown-queue Howling Abyss) is a Mayhem mode: it runs the
 * normal schedule exactly like `mayhem`. Bounded discovery remains as the
 * fallback for any other ARAM-family signal (including a real Mayhem that
 * reports a classic queue id), and only while its burst is live.
 */
export function mayhemMonitorWantsScan(
  state: MayhemMonitorState,
  signals: MayhemModeSignals,
  now: number
): 'mayhem' | 'discovery' | 'none' {
  if (isMayhemMode(mayhemMonitorMode(state, signals))) return 'mayhem';
  if (!isMayhemDiscoverySignals(signals)) return 'none';
  if (!mayhemDiscoveryLive(state.discovery, now)) return 'none';
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
  /** A PageDown manual scan keeps a single offer visible. */
  manualScanActive?: boolean;
}

/** What the HUD should do with the frame just folded in. */
export type MayhemHudAction = 'show' | 'keep' | 'purge';

export interface MayhemMonitorResult {
  state: MayhemMonitorState;
  /** runOcr actually ran on this tick. */
  scanned: boolean;
  /** Picks newly counted by this scan. */
  counted: number;
  mode: MayhemMode;
  /** This scan ran as bounded discovery (unknown-queue ARAM). */
  discovery: boolean;
  /**
   * `show` opens/keeps the augment HUD; `keep` retains an unshown single-offer
   * candidate for the next scan; `purge` clears on a confirmed valid empty
   * frame. Invalid frames always return `keep`.
   */
  hudAction: MayhemHudAction;
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
  // Level/death triggers can open a burst even when this call starts before
  // the caller scheduled a poll (the live tick also calls this).
  noteMayhemDiscoveryTrigger(next, {
    now: input.now,
    level: input.level,
    isDead: input.isDead,
    signals: input.signals,
  });
  const wanted = mayhemMonitorWantsScan(next, input.signals, input.now);
  if (wanted === 'none') {
    return {
      state: next,
      scanned: false,
      counted: 0,
      mode: mayhemMonitorMode(next, input.signals),
      discovery: false,
      hudAction: 'keep',
    };
  }
  const discovery = wanted === 'discovery';
  if (discovery) {
    if (!mayhemDiscoveryDue(next, input.now)) {
      return { state: next, scanned: false, counted: 0, mode: 'aram', discovery: true, hudAction: 'keep' };
    }
    // Every attempt (successful or not) consumes the 10 s slot.
    next.discovery.lastScanAt = input.now;
  } else if (!input.autoOcrAllowed) {
    return { state: next, scanned: false, counted: 0, mode: 'mayhem', discovery: false, hudAction: 'keep' };
  }

  const read = await runOcr(MAYHEM_DISCOVERY_MIN_OFFERS);
  const before = next.counter.picksTaken;
  // A failed capture / missing game window / OCR exception is not a frame at
  // all: it must not advance or reset either streak. Focus is not part of the
  // decision: the overlay may own the foreground while the game is captured.
  const usable = isUsableMayhemFrame(read);
  // Only a real game-window frame may count: the primary-screen fallback can
  // show offers but cannot prove the game was on top.
  const targetCapture = isTrustedMayhemFrame(read);
  const offers = read.frameIds.length;
  if (read.fresh) {
    next.fuzzyScore = read.fuzzyScore;
    if (usable) {
      next.scanStreak = offers > 0 ? next.scanStreak + 1 : 0;
      next.counter = observeMayhemPickScan(next.counter, {
        offerCount: offers,
        isDead: input.isDead,
        foreground: targetCapture,
        blackFrame: read.blackFrame,
        liveAugmentIds: input.liveAugmentIds,
      });
      // A single high-confidence offer is pending, not displayable: promote it
      // only after the same id was read on consecutive qualifying frames.
      if (read.ids.length === 0 && read.candidateIds.length === 1) {
        const id = read.candidateIds[0];
        const same = next.candidateIds.length === 1 && next.candidateIds[0] === id;
        next.candidateIds = [id];
        next.candidateScans = same ? next.candidateScans + 1 : 1;
        next.displayIds = next.candidateScans >= MIN_SINGLE_OFFER_SCANS ? [id] : [];
      } else {
        next.candidateIds = [];
        next.candidateScans = 0;
        next.displayIds = read.ids;
      }
    }
    if (discovery && usable && offers >= MAYHEM_DISCOVERY_MIN_OFFERS) {
      next.discovery.latched = true;
      next.discovery.burstStartedAt = null;
    }
  }

  // A single high-confidence offer is not visible yet; keep it so the next
  // scan can make it consecutive. Only a confirmed empty frame purges.
  const visible = isMayhemAugmentHudVisible(next.displayIds, input.manualScanActive === true, {
    consecutiveScans: next.scanStreak,
    fuzzyScore: next.fuzzyScore,
  });
  const hudAction: MayhemHudAction = visible ? 'show' : usable && offers === 0 ? 'purge' : 'keep';

  // Classification is the monitor's own (latch first, then the frame's offers):
  // `mayhem-likely` stays honest for the unknown queue while still getting the
  // normal Mayhem behaviour everywhere.
  return {
    state: next,
    scanned: true,
    counted: next.counter.picksTaken - before,
    mode: mayhemMonitorMode(next, input.signals),
    discovery,
    hudAction,
  };
}
