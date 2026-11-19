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
import { MAYHEM_AUGMENT_LEVELS } from './augmentSchedule';
import { nextMayhemPickLevel } from './pickPhase';
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
/**
 * Hard bounds on the discovery path for one match. Every death edge used to
 * re-arm the 90 s burst, so a classic ARAM could spawn a PowerShell capture and
 * a full-screen grab for the whole game; these caps keep discovery a bounded
 * probe that stops once it has spent its budget or repeatedly found nothing.
 */
export const MAX_DISCOVERY_SCANS = 30;
export const MAX_DISCOVERY_BURSTS = 6;
/**
 * Two bursts in a row that read no offer at all end discovery for the match —
 * unless a new augment level (7/11/15) opens the next burst, which clears the
 * empty streak: a black frame or a shop that was not open yet must not cost the
 * later augment windows their only chance.
 */
export const MAX_DISCOVERY_EMPTY_BURSTS = 2;

/** One OCR frame as the monitor sees it (the type `MayhemOcrRead` aliases). */
export interface MayhemMonitorRead {
  /** Display ids: current matches or the retained roll while the HUD is open. */
  ids: string[];
  /** A single high-confidence match waiting for a consecutive scan. */
  candidateIds: string[];
  /**
   * Bundle-matched ids on this frame only; the pick counter reads nothing else.
   * Never an `unknown:` placeholder: placeholders never latch DISCOVERY and
   * never move the pick counter. Display ids / `augmentOffersDetected` are not
   * proof of Mayhem mode either — they only feed the mode hint.
   */
  frameIds: string[];
  /**
   * Card rows THIS frame read: bundle matches plus `unknown:` placeholders, and
   * never the retained display roll. A 3-row shop from a patch newer than the
   * bundle is still a real shop for the pick counter's arm gate, while a
   * retained roll or a 1-known-plus-junk read is not.
   */
  frameDisplayCount: number;
  fresh: boolean;
  valid: boolean;
  fuzzyScore: number;
  blackFrame: boolean;
  /** Recorded for logs: the game window owned the foreground. Not a trust gate. */
  foreground: boolean;
  /**
   * The foreground window belonged to the game or to this app (the overlay).
   * False means a foreign window owned the screen inside the game rect, so the
   * captured pixels cannot prove an offer. Required: a read must decide it, and
   * the single seam below defaults an older capture script's missing flag to
   * trusted instead of letting a hand-built literal omit the gate.
   */
  owner: boolean;
  /** Capture used the primary-screen fallback (no game window matched). */
  fallback?: boolean;
}

/** A read before the trust gate is attached: everything except `owner`. */
export type MayhemMonitorReadFields = Omit<MayhemMonitorRead, 'owner'>;

/**
 * The single seam every OCR frame crosses before the monitor sees it.
 *
 * `owner` is a required argument (it may be `undefined` for an older capture
 * script that omits it) so a read cannot be built without deciding the trust
 * gate. The old bug was an object literal on one return path that simply left
 * `owner` out, which made the gate stand down for every real offer frame. A
 * script that reports no owner at all is the documented legacy case and defaults
 * to trusted here, in one place, so it can never happen by omission.
 */
export function toMayhemMonitorRead(
  fields: MayhemMonitorReadFields,
  owner: boolean | undefined
): MayhemMonitorRead {
  return { ...fields, owner: owner ?? true };
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
  /** Discovery scans actually run this match (bounded by MAX_DISCOVERY_SCANS). */
  scans: number;
  /** Discovery bursts opened this match (bounded by MAX_DISCOVERY_BURSTS). */
  bursts: number;
  /** Offers read during the current burst; a burst that reads none is wasted. */
  burstOffers: number;
  /** Consecutive finished bursts that read zero offers (a new level clears it). */
  emptyBursts: number;
  /** Discovery is closed for the rest of this match (budget or no results). */
  exhausted: boolean;
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
    discovery: {
      burstStartedAt: null,
      lastScanAt: 0,
      latched: false,
      levelBurst: 0,
      wasDead: false,
      scans: 0,
      bursts: 0,
      burstOffers: 0,
      emptyBursts: 0,
      exhausted: false,
    },
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
 * itself, with the foreground owned by the game or by our overlay. A fallback
 * primary-screen capture cannot prove the offers were on top, and a
 * `owner === false` frame means something else (a browser, say) owned the
 * foreground inside the game rect — the captured pixels were not the game's.
 * `foreground` stays on the read for logs only.
 */
export function isTrustedMayhemFrame(read: MayhemMonitorRead): boolean {
  return isUsableMayhemFrame(read) && read.fallback !== true && read.owner !== false;
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
    if (levelHit != null) {
      // A new augment window is a genuinely new chance, and it opens a new
      // per-level budget: a spent scan/burst budget (or an exhausted flag) from
      // the previous level must not close discovery for the rest of the match,
      // which is exactly how levels 7/11/15 used to lose their shop window.
      discovery.levelBurst = levelHit;
      discovery.emptyBursts = 0;
      discovery.exhausted = false;
      discovery.scans = 0;
      discovery.bursts = 0;
      discovery.burstStartedAt = null;
      discovery.burstOffers = 0;
    }
    if (!discovery.exhausted && (levelHit != null || deathEdge)) {
      // A trigger inside a live burst does not extend it: the burst is already
      // scanning, and re-arming on every death is what made discovery run for
      // a whole classic-ARAM game.
      if (!mayhemDiscoveryLive(discovery, input.now)) {
        if (discovery.bursts > 0 && discovery.burstOffers === 0) {
          // The burst that just ended never read a single offer.
          discovery.emptyBursts += 1;
        }
        if (
          discovery.emptyBursts >= MAX_DISCOVERY_EMPTY_BURSTS ||
          discovery.bursts >= MAX_DISCOVERY_BURSTS ||
          discovery.scans >= MAX_DISCOVERY_SCANS
        ) {
          discovery.exhausted = true;
          discovery.burstStartedAt = null;
        } else {
          discovery.bursts += 1;
          discovery.burstStartedAt = input.now;
          discovery.burstOffers = 0;
        }
      }
    }
  }
  discovery.wasDead = input.isDead;
  return !discovery.latched && !discovery.exhausted && mayhemDiscoveryLive(discovery, input.now);
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
  // Display ids (which may be `unknown:` placeholders) only raise the
  // `augmentOffersDetected` hint: they are not proof of Mayhem mode. Only the
  // known-`frameIds` latch above proves the match, so placeholders never latch
  // DISCOVERY on a classic ARAM match.
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
  if (state.discovery.exhausted) return 'none';
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
    // Every attempt (successful or not) consumes the 10 s slot and one unit of
    // the match's bounded discovery budget.
    next.discovery.lastScanAt = input.now;
    next.discovery.scans += 1;
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
  // A roll from a patch newer than the bundle can show 1-2 known cards with the
  // rest as `unknown:` placeholders. The pick counter only arms on a full roll,
  // so without this a stale bundle would silently stop counting picks for the
  // match. A real shop is either two known offers or a full 3-row frame (two
  // placeholders beside one known card). The row count must come from this
  // frame (`frameDisplayCount`), not from `ids`: `ids` is the retained roll on
  // an empty/partial read, and a placeholder row is not proof of an offer. A
  // frame with no known id at all (junk) still counts nothing.
  const proofOffers =
    offers >= 2 || (offers >= 1 && read.frameDisplayCount >= 3)
      ? Math.max(offers, 2)
      : offers;
  if (read.fresh) {
    next.fuzzyScore = read.fuzzyScore;
    if (usable) {
      next.scanStreak = offers > 0 ? next.scanStreak + 1 : 0;
      next.counter = observeMayhemPickScan(next.counter, {
        offerCount: proofOffers,
        isDead: input.isDead,
        foreground: targetCapture,
        blackFrame: read.blackFrame,
        liveAugmentIds: input.liveAugmentIds,
        hasDisplayedOffers: read.frameDisplayCount > 0,
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
    if (discovery && usable && offers > 0) next.discovery.burstOffers += offers;
    if (discovery && usable && offers >= MAYHEM_DISCOVERY_MIN_OFFERS) {
      next.discovery.latched = true;
      next.discovery.burstStartedAt = null;
    }
  }
  if (discovery && !next.discovery.latched && next.discovery.scans >= MAX_DISCOVERY_SCANS) {
    // The budget is spent: no further burst may open this match.
    next.discovery.exhausted = true;
    next.discovery.burstStartedAt = null;
  }

  // A single high-confidence offer is not visible yet; keep it so the next
  // scan can make it consecutive. Only a confirmed empty frame purges.
  const visible = isMayhemAugmentHudVisible(next.displayIds, input.manualScanActive === true, {
    consecutiveScans: next.scanStreak,
    fuzzyScore: next.fuzzyScore,
  });
  const hudAction: MayhemHudAction = visible
    ? 'show'
    : usable && offers === 0 && read.frameDisplayCount === 0
      ? 'purge'
      : 'keep';

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

/**
 * May the automatic OCR run at this level?
 *
 * `nextPick === null` means every augment slot is counted - or the owned count
 * leaked from an earlier match. It must not disable scanning for the rest of
 * the game: the last augment is taken at level 15+, so keep scanning from the
 * last augment level instead of switching the poll off permanently.
 */
export function mayhemAutoOcrWanted(input: {
  level: number;
  /** Resolved picks (owned augments + persisted counter). */
  ownedCount: number;
  /** The HUD already shows offers: keep scanning regardless of the level gate. */
  hudVisible: boolean;
}): boolean {
  const nextPick = nextMayhemPickLevel(Math.max(0, Math.floor(input.ownedCount)));
  if (nextPick != null) return input.level >= nextPick || input.hudVisible;
  const lastLevel = MAYHEM_AUGMENT_LEVELS[MAYHEM_AUGMENT_LEVELS.length - 1];
  return input.level >= lastLevel || input.hudVisible;
}

/** Highest augment level the champion level has reached (3/7/11/15), else null. */
export function mayhemAugmentLevelEdge(level: number): number | null {
  let edge: number | null = null;
  for (const pickLevel of MAYHEM_AUGMENT_LEVELS) {
    if (level >= pickLevel) edge = pickLevel;
  }
  return edge;
}

/**
 * The pick-level gate with a level-up re-arm, as the live poll uses it.
 *
 * `mayhemAutoOcrWanted` throttles scanning while no augment window is
 * expected, but the pick count it reads is an estimate that can run one pick
 * ahead (owned ids / LCU / the persisted counter). When it does, `nextPick`
 * lands past the player's real level and the plain gate would switch scanning
 * off for the rest of the match — at exactly level 7 the panel never returns.
 * A new augment level edge therefore grants one fresh attempt, so a raised
 * level can never strand the panel; within the same edge the gate still
 * throttles exactly as before.
 *
 * `rearmedAtLevel` is the edge that already spent its re-arm (or null before
 * the first blocked tick); callers carry the returned value to the next call.
 */
export function mayhemAutoOcrGate(input: {
  level: number;
  ownedCount: number;
  hudVisible: boolean;
  rearmedAtLevel: number | null;
}): { wanted: boolean; rearmedAtLevel: number | null } {
  if (mayhemAutoOcrWanted(input)) {
    return { wanted: true, rearmedAtLevel: input.rearmedAtLevel };
  }
  const edge = mayhemAugmentLevelEdge(input.level);
  if (edge != null && edge > (input.rearmedAtLevel ?? 0)) {
    return { wanted: true, rearmedAtLevel: edge };
  }
  return { wanted: false, rearmedAtLevel: input.rearmedAtLevel };
}

/** Injectable one-shot timers, so the poll chain can be proven without Electron. */
export interface MayhemPollTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface MayhemPollChainOptions {
  /** One scan. It may reject or never settle; neither may end the chain. */
  runTick(): Promise<void>;
  /** Delay before the next scan, read when the next poll is armed. */
  nextDelayMs(): number;
  /** The match is still live; a false lets the chain stop. */
  isLive(): boolean;
  onTickError?(error: unknown): void;
  timers?: MayhemPollTimers;
}

export interface MayhemPollChain {
  start(delayMs: number): void;
  stop(): void;
  /** A poll is armed or a scan is still running. */
  isRunning(): boolean;
}

const FALLBACK_MAYHEM_POLL_MS = 15_000;

/**
 * The Mayhem OCR poll chain.
 *
 * The next poll is armed BEFORE the scan is awaited, so rescheduling lives
 * outside the scan's promise. A hung PowerShell OCR (or any other scan that
 * never settles) therefore cannot end the chain for the rest of the match; the
 * next tick still fires and can revive the panel.
 */
export function createMayhemPollChain(options: MayhemPollChainOptions): MayhemPollChain {
  const timers: MayhemPollTimers = options.timers ?? {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let handle: unknown = null;
  let armed = false;
  let ticking = 0;
  let stopped = true;

  const safeDelay = (): number => {
    try {
      const delay = options.nextDelayMs();
      return Number.isFinite(delay) && delay >= 0 ? delay : FALLBACK_MAYHEM_POLL_MS;
    } catch {
      return FALLBACK_MAYHEM_POLL_MS;
    }
  };

  const fire = (): void => {
    handle = null;
    armed = false;
    if (stopped || !options.isLive()) return;
    arm(safeDelay());
    ticking += 1;
    let tick: Promise<void>;
    try {
      tick = options.runTick();
    } catch (error) {
      ticking -= 1;
      options.onTickError?.(error);
      return;
    }
    tick.then(
      () => {
        ticking -= 1;
      },
      (error) => {
        ticking -= 1;
        options.onTickError?.(error);
      }
    );
  };

  function arm(delayMs: number): void {
    if (stopped) return;
    armed = true;
    handle = timers.set(fire, Math.max(0, delayMs));
  }

  return {
    start(delayMs: number): void {
      stopped = false;
      if (armed) timers.clear(handle);
      arm(delayMs);
    },
    stop(): void {
      stopped = true;
      if (armed) timers.clear(handle);
      handle = null;
      armed = false;
    },
    isRunning(): boolean {
      return !stopped && (armed || ticking > 0);
    },
  };
}
