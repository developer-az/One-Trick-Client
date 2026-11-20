/**
 * Manual PageDown feedback + retry regressions (first-run fix).
 *
 * A press must always change what the player sees, even when OCR is busy:
 *   1. every press pushes a "Scanning…" patch before the capture await, with a
 *      per-press nonce in payload + fingerprint so the drop guard cannot eat it;
 *   2. every outcome (in-flight, throttled, invalid/preview, accept) pushes a
 *      second patch — no refusal returns silently;
 *   3. a press refused as in-flight sets a pending flag that is consumed once
 *      when the capture slot frees, running one forced manual scan;
 *   4. the auto-scan epoch guard is untouched, so a manual press still
 *      invalidates a stale auto tick.
 *
 * Sections 7-9 replace string-only faith with the real deferred reader and the
 * real hotkey route: a transient Scanning/retry hint must resolve to the
 * explicit outcome, a queued press must run one forced scan, and a zero-offer
 * Scanning press must keep the Mayhem panel/slot alive.
 *
 * Run: npx --yes tsx verify_mayhem_manual_feedback.ts
 */

import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import bundle from './src/data/mayhem/bundle.json';
import {
  buildOverlayPayload,
  getMayhemLiveOfferIds,
  mayhemOcrHintValue,
  overlayFingerprint,
  pushMayhemManualFeedback,
  resetMatchCaches,
  setMayhemHotkeyVerifyHarness,
  triggerManualMayhemOcrFromHotkey,
} from './electron/game-monitor';
import {
  clearPendingMayhemManual,
  detectMayhemOffers,
  isMayhemOcrInFlight,
  noteMayhemManualPressInFlight,
  resetMayhemOcrCache,
  setMayhemOcrRetainOffers,
  takePendingMayhemManual,
} from './electron/mayhem-ocr';
import type { MayhemAugment, MayhemBundle } from './src/logic/mayhem/types';
import {
  isMayhemManualScanHint,
  OverlayMayhemPanel,
  shouldActivateMayhemSlot,
} from './src/overlay/OverlayMayhemPanel';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

function section(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = from >= 0 ? src.indexOf(end, from) : -1;
  return from >= 0 && to > from ? src.slice(from, to) : '';
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, msg: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  ok(false, msg);
}

interface Screen {
  parsed: {
    text: string;
    lines: Array<{ text: string; rect: { x: number; y: number; w: number; h: number } }>;
    target: { pid: number; exe: string; foreground: boolean };
    blackFrame: boolean;
    language: string | null;
    noTarget: boolean;
    fallback: boolean;
  };
  owner: boolean;
}

const THREE_TITLES = ['Jeweled Gauntlet', 'Giant Slayer', 'Recursion'];
const augments = (bundle as MayhemBundle).augments as MayhemAugment[];
function boxedScreen(titles: string[]): Screen {
  const xs = [0.265, 0.435, 0.605];
  return {
    parsed: {
      text: titles.join('\n'),
      lines: titles.map((text, i) => ({ text, rect: { x: xs[i], y: 0.38, w: 0.13, h: 0.04 } })),
      target: { pid: 4242, exe: 'League of Legends', foreground: true },
      blackFrame: false,
      language: 'en-US',
      noTarget: false,
      fallback: false,
    },
    owner: true,
  };
}
const UNVERIFIED_SCREEN: Screen = {
  parsed: {
    text: 'unverifiable text',
    lines: [],
    target: { pid: 4242, exe: 'League of Legends', foreground: true },
    blackFrame: false,
    language: 'en-US',
    noTarget: false,
    fallback: false,
  },
  owner: true,
};

async function main(): Promise<void> {
  console.log('--- 1. per-press nonce, hint and fingerprint ---');
  pushMayhemManualFeedback('offers:2');
  const hint1 = mayhemOcrHintValue() || '';
  const p1 = buildOverlayPayload(null, null);
  const fp1 = overlayFingerprint(p1);
  pushMayhemManualFeedback('offers:3');
  const hint2 = mayhemOcrHintValue() || '';
  const p2 = buildOverlayPayload(null, null);
  const fp2 = overlayFingerprint(p2);
  ok(p2.mayhemOcrFeedbackNonce === p1.mayhemOcrFeedbackNonce + 1, 'nonce increments per press');
  ok(
    hint1.startsWith('offers:2') && hint1.includes(`#${p1.mayhemOcrFeedbackNonce}`),
    `the status carries its nonce (${hint1})`
  );
  ok(
    hint2.startsWith('offers:3') && hint2.includes(`#${p2.mayhemOcrFeedbackNonce}`),
    `the next status carries its nonce (${hint2})`
  );
  ok(hint1 !== hint2 && fp1 !== fp2, 'two presses render different text and different fingerprints');

  console.log('--- 2. pending-manual flag semantics ---');
  clearPendingMayhemManual();
  ok(takePendingMayhemManual() === false, 'nothing queued after a clear');
  noteMayhemManualPressInFlight();
  ok(takePendingMayhemManual() === true, 'a queued press is consumed');
  ok(takePendingMayhemManual() === false, 'a queued press is consumed at most once');
  noteMayhemManualPressInFlight();
  clearPendingMayhemManual();
  ok(takePendingMayhemManual() === false, 'match-end clear drops a queued press');
  ok(typeof isMayhemOcrInFlight() === 'boolean', 'the in-flight probe is available');

  const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
  const ocr = fs.readFileSync('electron/mayhem-ocr.ts', 'utf8');
  const panel = fs.readFileSync('src/overlay/OverlayMayhemPanel.tsx', 'utf8');
  const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
  const restore = section(
    monitor,
    'async function restoreMayhemAugmentPanelFromHotkey',
    '/** Diagnostics for the performance panel. */'
  );
  const flush = section(monitor, 'export function flushPendingMayhemManual(', 'function pushMayhemOverlayPatch()');
  const tick = section(monitor, 'async function tickMayhemOcr()', 'export function clearMayhemOffersForDashboard()');
  const fingerprint = section(monitor, 'function overlayFingerprint(', 'let mayhemOfferIds');

  console.log('--- 3. every manual path pushes a patch ---');
  const scanAt = restore.indexOf('await detectMayhemOffers(');
  const scanningAt = restore.indexOf("pushMayhemManualFeedback('Scanning…')");
  ok(scanningAt >= 0 && scanningAt < scanAt, 'a visible Scanning patch is pushed before the capture await');

  const noBundleAt = restore.indexOf("reason: 'no-bundle'");
  ok(
    noBundleAt >= 0 && restore.slice(noBundleAt, noBundleAt + 200).includes('pushMayhemManualFeedback'),
    'the no-bundle refusal also pushes an outcome'
  );

  const freshGuard = restore.indexOf('if (!read.fresh)');
  const nonFresh = restore.slice(freshGuard, restore.indexOf('if (read.decision', freshGuard));
  ok(
    nonFresh.includes('noteMayhemManualPressInFlight()') &&
      nonFresh.includes("pushMayhemManualFeedback('scan-in-flight, retrying…')") &&
      nonFresh.includes("pushMayhemManualFeedback('retrying…')"),
    'in-flight queues a retry and both non-fresh refusals push an outcome'
  );

  const decisionAt = restore.indexOf('if (read.decision');
  const decision = restore.slice(decisionAt, restore.indexOf('mayhemUnverified = false', decisionAt));
  ok(decision.includes('pushMayhemManualFeedback('), 'invalid/preview frames push an outcome');
  ok(
    restore.includes('pushMayhemManualFeedback(`offers:${ids.length}`)'),
    'an accepted scan pushes the offers count'
  );
  const pushes = restore.split('pushMayhemManualFeedback(').length - 1;
  ok(pushes >= 6, `every press path pushes (${pushes} feedback pushes in the restore body)`);
  ok(
    fingerprint.includes('payload.mayhemOcrFeedbackNonce ?? 0'),
    'the overlay fingerprint includes the per-press nonce'
  );

  console.log('--- 4. pending press runs one forced manual scan ---');
  ok(
    flush.includes('takePendingMayhemManual()') &&
      flush.includes('isMayhemOcrInFlight()') &&
      flush.includes('runManual()'),
    'the flush consumes one queued press and runs the forced manual scan'
  );
  const awaitAt = tick.indexOf('await runMayhemMonitorScan');
  const flushAt = tick.indexOf('flushPendingMayhemManual()');
  ok(awaitAt >= 0 && flushAt > awaitAt, 'the auto scan settle flushes a queued press');
  const detectCall = section(restore, 'read = await detectMayhemOffers(', '} finally {');
  ok(
    detectCall.includes('forcedManual: true') && /0,\s*\{\s*minMatches: 1/.test(detectCall),
    'the follow-up path is the forced manual detect (interval 0, forcedManual)'
  );
  ok(
    ocr.includes('let pendingManual = false') && ocr.includes('export function takePendingMayhemManual'),
    'the pending flag lives beside the single OCR slot it guards'
  );

  console.log('--- 5. epoch guard stays intact ---');
  const firstBump = restore.indexOf('mayhemMonitorEpoch += 1');
  const lastBump = restore.lastIndexOf('mayhemMonitorEpoch += 1');
  const write = restore.indexOf('mayhemOfferIds = ids');
  ok(
    firstBump >= 0 &&
      firstBump < scanAt &&
      lastBump > scanAt &&
      freshGuard > scanAt &&
      freshGuard < lastBump &&
      write > lastBump &&
      restore.split('mayhemMonitorEpoch += 1').length - 1 === 2,
    'manual press still bumps, awaits, refuses non-fresh, then writes (2 bumps)'
  );

  console.log('--- 6. overlay renders the hint distinctly from idle text ---');
  ok(
    panel.includes('ocrHint?: string') && panel.includes('{ocrHint ||'),
    'the panel renders the live hint in place of the idle Cannot-verify text'
  );
  ok(
    app.split('ocrHint={state.mayhemOcrHint}').length - 1 === 2,
    'both panel call sites receive the overlay hint'
  );

  console.log('--- 7. deferred reader: transient status resolves to an outcome ---');
  resetMatchCaches();
  resetMayhemOcrCache();
  setMayhemOcrRetainOffers(false);
  const hintGate = deferred<Screen>();
  const scanned = detectMayhemOffers(augments, 0, {
    minMatches: 2,
    readScreen: () => hintGate.promise,
  });
  ok(isMayhemOcrInFlight(), 'the deferred reader holds the OCR slot');
  pushMayhemManualFeedback('Scanning…');
  ok(
    (mayhemOcrHintValue() || '').startsWith('Scanning…'),
    'Scanning… is visible only while the scan is in flight'
  );
  hintGate.resolve(UNVERIFIED_SCREEN);
  await scanned;
  ok(!isMayhemOcrInFlight(), 'the slot is released when the deferred reader resolves');
  const settled = mayhemOcrHintValue() || '';
  ok(
    settled.startsWith('Could not verify — press PageDown to retry'),
    `a settled scan shows the explicit outcome (${settled})`
  );
  ok(
    !settled.includes('Scanning…') && !settled.includes('retrying…'),
    'no stale in-progress wording survives the settle'
  );
  pushMayhemManualFeedback('retrying…');
  ok(
    (mayhemOcrHintValue() || '').startsWith('Could not verify — press PageDown to retry'),
    'a retry hint with no work scheduled reads as the outcome, not as progress'
  );
  pushMayhemManualFeedback('offers:1');
  ok((mayhemOcrHintValue() || '').startsWith('offers:1'), 'the next press replaces the outcome');
  resetMatchCaches();
  ok(!mayhemOcrHintValue(), 'a match reset clears the hint back to idle');

  console.log('--- 8. production hotkey wiring: queued press runs one forced scan ---');
  clearPendingMayhemManual();
  resetMatchCaches();
  resetMayhemOcrCache();
  setMayhemOcrRetainOffers(false);
  let scans = 0;
  const firstGate = deferred<Screen>();
  const forcedGate = deferred<Screen>();
  const reader = (): Promise<Screen> => {
    scans += 1;
    return scans === 1 ? firstGate.promise : forcedGate.promise;
  };
  setMayhemHotkeyVerifyHarness({ readScreen: reader });
  const patches0 = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce;

  // The first PageDown runs the real hotkey route (KIWI payload, injected reader)
  // and holds the single OCR slot — the test never calls detectMayhemOffers.
  const firstPress = triggerManualMayhemOcrFromHotkey();
  ok(isMayhemOcrInFlight(), 'the first press holds the single OCR slot');
  ok(scans === 1, 'the first press captured once');

  // The overlapping press is refused as in-flight, queued and shown its own
  // outcome by the production route — no pending flag or callback is set here.
  await triggerManualMayhemOcrFromHotkey();
  ok(isMayhemOcrInFlight(), 'the refused press left the first capture in the slot');
  ok(scans === 1, 'the refused press never captured');
  const pressPatches = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce - patches0;
  ok(pressPatches > 0, `the presses push visible feedback while the slot is held (${pressPatches})`);
  const refusedHint = mayhemOcrHintValue() || '';
  ok(
    refusedHint.includes('retrying…'),
    `the refused press shows a retry outcome, not silence (${refusedHint})`
  );

  // Settling the scan drives the production post-settle flush, which must
  // consume the queued press and run one forced scan. The test never calls it.
  firstGate.resolve(UNVERIFIED_SCREEN);
  await firstPress;
  await waitFor(() => scans === 2, 'the production flush consumed the queued press');
  ok(scans === 2, `the queued press ran exactly one forced scan (scan count ${scans})`);
  forcedGate.resolve(boxedScreen(THREE_TITLES));
  await waitFor(() => getMayhemLiveOfferIds().length === 3, 'the forced scan committed its roll');
  const finalIds = getMayhemLiveOfferIds();
  ok(
    finalIds.join(',') === 'jeweled_gauntlet,giant_slayer,recursion',
    `final roll ids come from the forced scan (${finalIds.join(',')})`
  );
  const patches = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce - patches0;
  ok(patches > pressPatches, `the forced press added its own feedback (${pressPatches} -> ${patches})`);
  ok((mayhemOcrHintValue() || '').startsWith('offers:3'), 'the final hint is the accepted roll');
  setMayhemHotkeyVerifyHarness(null);

  console.log('--- 9. zero-offer Scanning press keeps the panel and slot alive ---');
  const scanningHint = 'Scanning… · #9';
  // Production after G4: a verified match with zero offers and a live press.
  const verification = 'verified' as const;
  const zeroOffer = {
    mayhemFamily: true,
    moduleOn: true,
    dismissedRecently: false,
    unverified: verification === 'unverified',
    augmentWindow: false,
    offerCount: 0,
    ocrHint: scanningHint,
  };
  ok(isMayhemManualScanHint(scanningHint), 'a live Scanning hint is recognized as manual progress');
  ok(
    isMayhemManualScanHint('Could not verify — press PageDown to retry · #9') &&
      isMayhemManualScanHint('scan-in-flight, retrying… · #9'),
    'a settled or queued retry hint is recognized too'
  );
  ok(
    shouldActivateMayhemSlot(zeroOffer),
    'zero offers plus a Scanning press activates the Mayhem panel'
  );
  ok(
    !shouldActivateMayhemSlot({ ...zeroOffer, mayhemFamily: false }),
    'the ranked path is unchanged by a manual-scan hint'
  );
  // G4 guard: verified + zero offers + live hint must render Scanning chrome,
  // not the old null path. The legacy unverified path is kept alongside it.
  const markup = renderToStaticMarkup(
    React.createElement(OverlayMayhemPanel, {
      championName: 'Ahri',
      ranked: [],
      verification,
      ocrHint: scanningHint,
    })
  );
  ok(
    markup.includes('Scanning…') && !markup.includes('Cannot verify'),
    'zero offers + verified + live Scanning renders chrome (not null/Cannot-verify)'
  );
  const unverifiedMarkup = renderToStaticMarkup(
    React.createElement(OverlayMayhemPanel, {
      championName: 'Ahri',
      ranked: [],
      verification: 'unverified',
      ocrHint: scanningHint,
    })
  );
  ok(
    unverifiedMarkup.includes('Scanning…') && !unverifiedMarkup.includes('Cannot verify'),
    'the unverified Scanning state still renders the live hint'
  );
}

void main().then(() => {
  if (failures > 0) {
    console.error(`verify:mayhem-manual-feedback FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log('verify:mayhem-manual-feedback ok');
});
