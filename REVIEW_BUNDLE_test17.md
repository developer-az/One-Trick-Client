# REVIEW BUNDLE - test17 (regenerated)

Generated: 2026-11-20 00:53:28 -05:00
Base: 08e9b71 (08e9b7151b06a4b0492b353b91feca7c8559be67)
HEAD: d62a76b (d62a76bfe3c2f1ae23da65c126959675d3e73895)
Branch: fix/mayhem-first-run
Scope: DOCS/EVIDENCE lane, regenerated in place. No source/test edits, no commits, no version bump.
The bundle itself is untracked and self-excluded from its own diff (listed by name only).
Documentation/meta files (PLAN.md, HANDOFF.md, BRIEF-*.md) are listed by name only; their content is intentionally excluded.

## 1. Working tree state

### git status --short
```
 M PLAN.md
 M electron/game-monitor.ts
 M electron/match-lifecycle.ts
 M electron/mayhem-ocr.ts
 M electron/scripts/mayhem-ocr.ps1
 M scripts/make_mayhem_fixtures.ps1
 M src/logic/mayhem/ocrOutput.ts
 M src/logic/stateEngine.ts
 M src/overlay/OverlayApp.tsx
 M src/overlay/OverlayMayhemPanel.tsx
 M test-fixtures/mayhem-ocr/labelled/manifest.json
 M verify_mayhem_fixtures.ts
 M verify_mayhem_ocr_lines.ts
 M verify_mayhem_text_matrix.ts
?? BRIEF-G4-IMPL.md
?? BRIEF-G4-TEST.md
?? BRIEF-G5-FEED.md
?? BRIEF-Q1-F1-queue-fix.md
?? BRIEF-Q1-GATE-ALL-TESTS.md
?? BRIEF-Q1-queue-first.md
?? HANDOFF.md
?? REVIEW_BUNDLE_test17.md
?? test-fixtures/mayhem-ocr/labelled/positive-gold-teal-geometry.png
?? verify_mayhem_manual_feedback.ts
```

### git diff --name-only
```
PLAN.md
electron/game-monitor.ts
electron/match-lifecycle.ts
electron/mayhem-ocr.ts
electron/scripts/mayhem-ocr.ps1
scripts/make_mayhem_fixtures.ps1
src/logic/mayhem/ocrOutput.ts
src/logic/stateEngine.ts
src/overlay/OverlayApp.tsx
src/overlay/OverlayMayhemPanel.tsx
test-fixtures/mayhem-ocr/labelled/manifest.json
verify_mayhem_fixtures.ts
verify_mayhem_ocr_lines.ts
verify_mayhem_text_matrix.ts
```

## 2. Documentation/meta files - names only, content excluded

Untracked docs: BRIEF-G4-IMPL.md, BRIEF-G4-TEST.md, BRIEF-G5-FEED.md, BRIEF-Q1-F1-queue-fix.md, BRIEF-Q1-GATE-ALL-TESTS.md, BRIEF-Q1-queue-first.md, HANDOFF.md, REVIEW_BUNDLE_test17.md.
Tracked-modified doc: PLAN.md (excluded from the stats and the diff below).
No content from any of these files is embedded in this bundle.

## 3. Tracked diff stats (git diff HEAD --stat, PLAN.md excluded)
```
 electron/game-monitor.ts                        | 123 +++++++++++++++++++++---
 electron/match-lifecycle.ts                     |   7 +-
 electron/mayhem-ocr.ts                          |  30 ++++++
 electron/scripts/mayhem-ocr.ps1                 |  14 ++-
 scripts/make_mayhem_fixtures.ps1                |   6 ++
 src/logic/mayhem/ocrOutput.ts                   |  11 ++-
 src/logic/stateEngine.ts                        |   8 +-
 src/overlay/OverlayApp.tsx                      |  30 ++++--
 src/overlay/OverlayMayhemPanel.tsx              |  59 ++++++++++--
 test-fixtures/mayhem-ocr/labelled/manifest.json |  94 ++++++++++++++----
 verify_mayhem_fixtures.ts                       |  23 +++++
 verify_mayhem_ocr_lines.ts                      |  28 ++++++
 verify_mayhem_text_matrix.ts                    |  36 ++++++-
 13 files changed, 412 insertions(+), 57 deletions(-)
```

## 4. Full tracked diff (git diff HEAD, PLAN.md excluded; bundle self-excluded)
```diff
diff --git a/electron/game-monitor.ts b/electron/game-monitor.ts
index 102d215..6480bf2 100644
--- a/electron/game-monitor.ts
+++ b/electron/game-monitor.ts
@@ -119,12 +119,17 @@ import { isMayhemAugmentHudVisible } from '../src/logic/mayhem/visibility';
 import { decideMayhemPageUp } from '../src/logic/mayhem/hotkey';
 import { loadMayhemBundle, refreshMayhemBundleIfStale } from './mayhem-data';
 import {
+    clearPendingMayhemManual,
     detectMayhemOffers,
+    isMayhemOcrInFlight,
     isMayhemOcrRerollPending,
     mayhemOcrBlackFrameSeen,
+    noteMayhemManualPressInFlight,
     resetMayhemOcrCache,
     resetMayhemOcrMatchFlags,
     setMayhemOcrRetainOffers,
+    takePendingMayhemManual,
+    type MayhemScreenReader,
 } from './mayhem-ocr';
 import {
     getMayhemPicksTaken,
@@ -773,9 +778,14 @@ async function restoreMayhemAugmentPanelFromHotkey(key: MayhemHotkeyKey): Promis
     // as non-fresh must still let the next scan show the roll.
     mayhemUserDismissedUntilMs = 0;
     mayhemAugmentDismissedAt = 0;
+    // Every press gets an immediate, visible status change before any await.
+    mayhemManualRestoreActive = true;
+    pushMayhemManualFeedback('Scanning…');
     const bundle = loadMayhemBundle();
     if (!bundle?.augments?.length) {
         logMayhemHotkeyRoute({ key, routed: false, reason: 'no-bundle' });
+        mayhemManualRestoreActive = false;
+        pushMayhemManualFeedback('retrying…');
         return;
     }
     // The player asked for this roll: invalidate any auto scan that started
@@ -788,11 +798,15 @@ async function restoreMayhemAugmentPanelFromHotkey(key: MayhemHotkeyKey): Promis
         read = await detectMayhemOffers(
             bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
             0,
-            { minMatches: 1, mayhemMatch: modeMayhem, forcedManual: true }
+            { minMatches: 1, mayhemMatch: modeMayhem, forcedManual: true, readScreen: mayhemVerifyReader }
         );
     } finally {
         mayhemHotkeyRestoreInFlight -= 1;
     }
+    mayhemManualRestoreActive = false;
+    // This pass just released the OCR slot: run any press that was queued while
+    // it was held (possibly by a different key press during this scan).
+    flushPendingMayhemManual();
     const ids = read.ids;
     logMayhemHotkeyRoute({
         key,
@@ -813,6 +827,14 @@ async function restoreMayhemAugmentPanelFromHotkey(key: MayhemHotkeyKey): Promis
     // so writing them here would purge the panel the player is looking at — the
     // recovery key must not destroy it.
     if (!read.fresh) {
+        // The press still counts: queue one forced scan to run as soon as the
+        // capture that holds the slot settles, and show the retry status now.
+        if (read.refusal === 'in-flight') {
+            noteMayhemManualPressInFlight();
+            pushMayhemManualFeedback('scan-in-flight, retrying…');
+        } else {
+            pushMayhemManualFeedback('retrying…');
+        }
         return;
     }
     // A preview (one card awaiting a second read) and an unverified frame are
@@ -822,9 +844,8 @@ async function restoreMayhemAugmentPanelFromHotkey(key: MayhemHotkeyKey): Promis
         if (read.decision === 'unverified' && mayhemOfferIds.length === 0) {
             // Nothing verified is on screen: show the persistent retry panel.
             mayhemUnverified = true;
-            pushMayhemOverlayPatch();
-            notifyMayhemOverlayStateChanged();
         }
+        pushMayhemManualFeedback(read.decision === 'preview' ? 'preview · retrying…' : 'retrying…');
         return;
     }
     mayhemUnverified = false;
@@ -847,8 +868,7 @@ async function restoreMayhemAugmentPanelFromHotkey(key: MayhemHotkeyKey): Promis
         mayhemManualScanUntilMs = 0;
     }
     applyMayhemOfferVisibilityAfterOcr();
-    pushMayhemOverlayPatch();
-    notifyMayhemOverlayStateChanged();
+    pushMayhemManualFeedback(`offers:${ids.length}`);
 }
 
 /** Diagnostics for the performance panel. */
@@ -1210,9 +1230,8 @@ function buildOverlayPayload(live: LiveClientAllGameData | null, gameflowPhase:
         mayhemPickHint: mayhemPickPhase.hint,
         mayhemWaitingForDeath: mayhemPickPhase.waitingForDeath,
         mayhemAugmentDismissedAt: mayhemAugmentDismissedAt || undefined,
-        mayhemOcrHint: mayhemOcrBlackFrameSeen()
-            ? 'Use borderless for augment detection'
-            : undefined,
+        mayhemOcrHint: mayhemOcrHintValue(),
+        mayhemOcrFeedbackNonce,
         timestamp: Date.now(),
     };
 
@@ -1266,6 +1285,7 @@ function overlayFingerprint(payload: ReturnType<typeof buildOverlayPayload>): st
         payload.mayhemWaitingForDeath ? 1 : 0,
         payload.mayhemAugmentDismissedAt ?? 0,
         payload.mayhemOcrHint || '',
+        payload.mayhemOcrFeedbackNonce ?? 0,
     ].join('~');
 }
 
@@ -1279,6 +1299,16 @@ let mayhemUnverified = false;
 function mayhemVerificationValue(): 'verified' | 'unverified' {
     return mayhemUnverified ? 'unverified' : 'verified';
 }
+/** Bumped on every manual press so its hint always changes the overlay fingerprint. */
+let mayhemOcrFeedbackNonce = 0;
+/** Transient manual-scan status shown instead of the idle "Cannot verify" text. */
+let mayhemOcrFeedbackHint: string | undefined;
+/** A settled press with no accept: an explicit prompt, never a claim of running work. */
+const MAYHEM_OCR_UNVERIFIED_OUTCOME = 'Could not verify — press PageDown to retry';
+/** A manual restore is between its Scanning push and its OCR settle. */
+let mayhemManualRestoreActive = false;
+/** Verify seam: an injected reader drives the real hotkey/poll scans without a capture. */
+let mayhemVerifyReader: MayhemScreenReader | undefined;
 /**
  * The roll that vanished when the pick counter fired. A reroll re-deals the
  * shop within seconds; a disjoint roll inside the window means that "pick" was
@@ -1727,6 +1757,64 @@ function startMayhemPoll(): void {
     scheduleMayhemPoll(1200);
 }
 
+/** The manual-scan status (with its per-press nonce) or the black-frame warning. */
+function mayhemOcrHintValue(): string | undefined {
+    if (!mayhemOcrFeedbackHint) {
+        return mayhemOcrBlackFrameSeen() ? 'Use borderless for augment detection' : undefined;
+    }
+    // "Scanning…"/"retrying…" is only true while a capture is in flight (a
+    // queued press keeps one in flight too). Once it settles the press has
+    // ended, so report its outcome instead of implying retry work is running.
+    const transient =
+        mayhemOcrFeedbackHint === 'Scanning…' || mayhemOcrFeedbackHint.includes('retrying…');
+    const working = isMayhemOcrInFlight() || mayhemManualRestoreActive;
+    const hint = transient && !working ? MAYHEM_OCR_UNVERIFIED_OUTCOME : mayhemOcrFeedbackHint;
+    return `${hint} · #${mayhemOcrFeedbackNonce}`;
+}
+
+/** Force a fresh overlay patch with a visible manual-scan status. */
+function pushMayhemManualFeedback(hint: string): void {
+    mayhemOcrFeedbackNonce += 1;
+    mayhemOcrFeedbackHint = hint;
+    pushMayhemOverlayPatch();
+}
+
+/**
+ * Verify-only harness: prime a live Mayhem match and inject the screen reader
+ * every production detectMayhemOffers call uses. Pass null to restore idle.
+ */
+export function setMayhemHotkeyVerifyHarness(harness: {
+    readScreen: MayhemScreenReader;
+    gameMode?: string;
+    mapName?: string;
+} | null): void {
+    mayhemVerifyReader = harness?.readScreen;
+    if (!harness) return;
+    inGame = true;
+    const payload = buildOverlayPayload(null, null);
+    lastGoodPayload = {
+        ...payload,
+        gameMode: harness.gameMode ?? 'KIWI',
+        mapName: harness.mapName ?? 'Map11',
+    };
+}
+
+/** Run the manual scan a press queued while another capture held the OCR slot. */
+export function flushPendingMayhemManual(
+    runManual: () => void = () => {
+        void triggerManualMayhemOcrFromHotkey();
+    }
+): void {
+    if (!takePendingMayhemManual()) return;
+    if (isMayhemOcrInFlight()) {
+        // The scan that just settled was not the one holding the slot; wait for
+        // the real in-flight pass to finish before retrying.
+        noteMayhemManualPressInFlight();
+        return;
+    }
+    runManual();
+}
+
 function pushMayhemOverlayPatch(): void {
     if (!lastGoodPayload) return;
     const merged = mergedMayhemOfferIds(mayhemOfferIds);
@@ -1739,16 +1827,16 @@ function pushMayhemOverlayPatch(): void {
         mayhemPickHint: mayhemPickPhase.hint,
         mayhemWaitingForDeath: mayhemPickPhase.waitingForDeath,
         mayhemAugmentDismissedAt: mayhemAugmentDismissedAt || undefined,
-        mayhemOcrHint: mayhemOcrBlackFrameSeen()
-            ? 'Use borderless for augment detection'
-            : undefined,
+        mayhemOcrHint: mayhemOcrHintValue(),
+        mayhemOcrFeedbackNonce,
         timestamp: Date.now(),
     };
     const fp = overlayFingerprint(payload);
     if (fp === lastOverlayFingerprint) return;
     lastGoodPayload = payload;
     lastOverlayFingerprint = fp;
-    sendFullOverlayUpdate(payload);
+    // The verify harness counts patches through the nonce; it has no BrowserWindow.
+    if (!mayhemVerifyReader) sendFullOverlayUpdate(payload);
 }
 
 /** Dashboard owned/roll edits — push merged offers without waiting for the next live poll. */
@@ -1845,13 +1933,16 @@ async function tickMayhemOcr(): Promise<void> {
             const read = await detectMayhemOffers(
                 bundle.augments as import('../src/logic/mayhem/types').MayhemAugment[],
                 minGap,
-                { minMatches, mayhemMatch: active }
+                { minMatches, mayhemMatch: active, readScreen: mayhemVerifyReader }
             );
             scan.decision = read.decision;
             scan.unverifiedFrame = read.fresh && !read.valid && read.decision === 'unverified';
             return read;
         }
     );
+    // This scan just released the OCR slot: a PageDown press that arrived while
+    // it ran must not be dropped — run it now as a forced manual scan.
+    flushPendingMayhemManual();
     // Only a scan that no purge/reset overtook may write back: its cloned state
     // predates the purge and would re-show the roll the player already picked.
     const commit = commitMayhemMonitorScan(
@@ -1935,6 +2026,10 @@ export function getMayhemLiveOfferIds(): string[] {
 }
 
 function resetMatchCaches(): void {
+    clearPendingMayhemManual();
+    mayhemManualRestoreActive = false;
+    mayhemOcrFeedbackNonce = 0;
+    mayhemOcrFeedbackHint = undefined;
     mayhemPickVoidRollIds = [];
     mayhemPickVoidAtMs = 0;
     lastChampSelectEnemies = [];
@@ -2770,4 +2865,6 @@ export {
     momentCueContent,
     resetMatchCaches,
     liveTick,
+    mayhemOcrHintValue,
+    pushMayhemManualFeedback,
 };
diff --git a/electron/match-lifecycle.ts b/electron/match-lifecycle.ts
index aec6bc9..58c81bc 100644
--- a/electron/match-lifecycle.ts
+++ b/electron/match-lifecycle.ts
@@ -37,6 +37,9 @@ export const LIVE_SILENCE_END_MS = 60_000;
 /** When the match clock is deep into the game, tolerate longer Live Client / LCU gaps. */
 export const LIVE_SILENCE_MIDGAME_END_MS = 180_000;
 
+/** Trusted clock past this point proves a live match; a short socket drop is not game over. */
+const MIDGAME_PROOF_SEC = 300;
+
 export { LIVE_CLOCK_ADVANCE_SEC, isMatchLoading, type MatchLoadingInput } from '../src/logic/matchLoading';
 import { LIVE_CLOCK_ADVANCE_SEC } from '../src/logic/matchLoading';
 
@@ -91,8 +94,10 @@ export function shouldEndMatch(input: EndMatchInput): boolean {
     }
 
     // Socket dropped and the lockfile is gone, or the phase is unknown.
+    // A trusted mid-game clock keeps the HUD up until the full 180 s silence;
+    // only a menu/terminal phase or a real end can end it sooner.
     const silenceLimit =
-        input.trustedGameTime >= 300 ? LIVE_SILENCE_MIDGAME_END_MS : LIVE_SILENCE_END_MS;
+        input.trustedGameTime >= MIDGAME_PROOF_SEC ? LIVE_SILENCE_MIDGAME_END_MS : LIVE_SILENCE_END_MS;
     return input.liveSilenceMs >= silenceLimit;
 }
 
diff --git a/electron/mayhem-ocr.ts b/electron/mayhem-ocr.ts
index 78712b8..7aef0a6 100644
--- a/electron/mayhem-ocr.ts
+++ b/electron/mayhem-ocr.ts
@@ -35,6 +35,8 @@ function ocrScriptPath(): string {
 }
 
 let ocrInFlight = false;
+/** A PageDown press was refused because another capture held the single OCR slot. */
+let pendingManual = false;
 let lastOfferIds: string[] = [];
 /** Hysteresis for the geometry-gated pipeline (lone-card confirm / ignore window). */
 const pipelineState = createMayhemPipelineState();
@@ -84,6 +86,28 @@ export function mayhemOcrBlackFrameSeen(): boolean {
   return blackFrameSeen;
 }
 
+/** True while a capture/OCR pass holds the single scan slot. */
+export function isMayhemOcrInFlight(): boolean {
+  return ocrInFlight;
+}
+
+/** Remember a manual press that could not run because a capture was in flight. */
+export function noteMayhemManualPressInFlight(): void {
+  pendingManual = true;
+}
+
+/** Consume the queued manual press once, so at most one follow-up scan runs. */
+export function takePendingMayhemManual(): boolean {
+  if (!pendingManual) return false;
+  pendingManual = false;
+  return true;
+}
+
+/** Drop a queued manual press (match end). */
+export function clearPendingMayhemManual(): void {
+  pendingManual = false;
+}
+
 /** Called when a match's mode loop starts; the hint is per match, not per pick. */
 export function resetMayhemOcrMatchFlags(): void {
   blackFrameSeen = false;
@@ -227,6 +251,8 @@ function logMayhemFrame(detail: {
   owner: boolean | undefined;
   acceptedIds: string[];
   decision: MayhemFrameDecision;
+  /** Per-slot mean body RGB (`x=r,g,b;…`) so a real run records gold-window evidence. */
+  slotBodyRgb: string;
 }): void {
   overlayLog('mayhem-frame', {
     reason: detail.reason.slice(0, 200),
@@ -236,6 +262,7 @@ function logMayhemFrame(detail: {
     owner: detail.owner ?? null,
     acceptedIds: detail.acceptedIds,
     decision: detail.decision,
+    slotBodyRgb: detail.slotBodyRgb,
   });
 }
 
@@ -572,6 +599,9 @@ export async function detectMayhemOffers(
       owner,
       acceptedIds,
       decision,
+      slotBodyRgb: (parsed.cardSlots ?? [])
+        .map((s) => `${s.x}=${s.bodyR ?? '?'},${s.bodyG ?? '?'},${s.bodyB ?? '?'}`)
+        .join(';'),
     });
     if (decision === 'accept') {
       // Keep reroll/fast-poll bookkeeping; the pipeline owns the display ids
diff --git a/electron/scripts/mayhem-ocr.ps1 b/electron/scripts/mayhem-ocr.ps1
index a6752e9..78de88b 100644
--- a/electron/scripts/mayhem-ocr.ps1
+++ b/electron/scripts/mayhem-ocr.ps1
@@ -199,11 +199,17 @@ $CARD_GAP_OFFSET = 0.085
 
 function Test-CardBody {
   param([int]$R, [int]$G, [int]$B)
-  return (($R -le 12) -and
+  $teal = (($R -le 12) -and
           ($G -ge 7 -and $G -le 32) -and
           ($B -ge 7 -and $B -le 36) -and
           ([Math]::Abs($G - $B) -le 7) -and
           ($G -gt ($R + 4)))
+  # Gold-rarity bodies are warm, not teal: accept them so a gold roll is not stuck "Cannot verify".
+  $gold = (($R -ge 150 -and $R -le 230) -and
+          ($G -ge 120 -and $G -le 190) -and
+          ($B -ge 40 -and $B -le 130) -and
+          ([Math]::Abs($R - $G) -le 60))
+  return ($teal -or $gold)
 }
 
 function Get-CardSlotEvidence {
@@ -217,12 +223,15 @@ function Get-CardSlotEvidence {
   $body = 0
   $rim = 0
   $gap = 0
+  # Mean body RGB is logged so a real run can confirm the gold window without trusting the predicate.
+  $sumR = 0; $sumG = 0; $sumB = 0; $bodySamples = 0
   foreach ($dx in @(-0.02, 0.0, 0.02)) {
     foreach ($dy in @(-0.02, 0.0, 0.02)) {
       $x = [int][Math]::Round($cx + $dx * $w)
       $y = [int][Math]::Round($bodyY + $dy * $h)
       if ($x -lt 0 -or $x -ge $w -or $y -lt 0 -or $y -ge $h) { continue }
       $c = $Bitmap.GetPixel($x, $y)
+      $sumR += [int]$c.R; $sumG += [int]$c.G; $sumB += [int]$c.B; $bodySamples += 1
       if (Test-CardBody -R $c.R -G $c.G -B $c.B) { $body += 1 }
     }
   }
@@ -252,6 +261,9 @@ function Get-CardSlotEvidence {
     body = $body
     rim = $rim
     gap = $gap
+    bodyR = $(if ($bodySamples -gt 0) { [int][Math]::Round($sumR / $bodySamples) } else { 0 })
+    bodyG = $(if ($bodySamples -gt 0) { [int][Math]::Round($sumG / $bodySamples) } else { 0 })
+    bodyB = $(if ($bodySamples -gt 0) { [int][Math]::Round($sumB / $bodySamples) } else { 0 })
   }
 }
 
diff --git a/scripts/make_mayhem_fixtures.ps1 b/scripts/make_mayhem_fixtures.ps1
index da112a3..ec14238 100644
--- a/scripts/make_mayhem_fixtures.ps1
+++ b/scripts/make_mayhem_fixtures.ps1
@@ -192,3 +192,9 @@ Draw-HeaderlessFixture 'negative-aligned-teal.png' `
 Draw-HeaderlessFixture 'negative-full-width-teal.png' `
   ([System.Drawing.Color]::FromArgb(8, 22, 26)) `
   ([System.Drawing.Color]::FromArgb(60, 180, 190)) $unfamiliar $threeX -FullWidthTealBand
+# Gold bodies on the same 3-card geometry. The rim is bright but just outside
+# the gold body range, so neither rim contrast nor the gaps can count: only the
+# new gold body predicate can set the pixel gate here.
+Draw-HeaderlessFixture 'positive-gold-teal-geometry.png' `
+  ([System.Drawing.Color]::FromArgb(201, 169, 98)) `
+  ([System.Drawing.Color]::FromArgb(200, 170, 135)) $unfamiliar
diff --git a/src/logic/mayhem/ocrOutput.ts b/src/logic/mayhem/ocrOutput.ts
index 7c54966..53eb733 100644
--- a/src/logic/mayhem/ocrOutput.ts
+++ b/src/logic/mayhem/ocrOutput.ts
@@ -24,6 +24,10 @@ export interface MayhemCardSlot {
    * Hand-built reads may omit it, but the parser drops such slots: only an explicit finite gap carries evidence.
    */
   gap?: number;
+  /** Mean RGB of the sampled body patch, for logging only; absent in older/hand-built reads. */
+  bodyR?: number;
+  bodyG?: number;
+  bodyB?: number;
 }
 
 export interface MayhemOcrOutput {
@@ -208,7 +212,12 @@ function cardSlotsFromJson(json: string): MayhemCardSlot[] {
       typeof v === 'number' && Number.isFinite(v) ? v : undefined;
     const x = num(src.x), body = num(src.body), rim = num(src.rim), gap = num(src.gap);
     if (x === undefined || body === undefined || rim === undefined || gap === undefined) continue;
-    slots.push({ x: unit(x), body, rim, gap });
+    const slot: MayhemCardSlot = { x: unit(x), body, rim, gap };
+    const r = num(src.bodyR), g = num(src.bodyG), b = num(src.bodyB);
+    if (r !== undefined) slot.bodyR = r;
+    if (g !== undefined) slot.bodyG = g;
+    if (b !== undefined) slot.bodyB = b;
+    slots.push(slot);
   }
   return slots;
 }
diff --git a/src/logic/stateEngine.ts b/src/logic/stateEngine.ts
index c8baa38..5522fea 100644
--- a/src/logic/stateEngine.ts
+++ b/src/logic/stateEngine.ts
@@ -32,6 +32,8 @@ import {
 
 /** Consecutive failed polls before we admit the match is over. */
 const FAILURES_TO_NOT_IN_GAME = 3;
+/** Past this trusted clock, only the match lifecycle may decide the match ended. */
+const MIDGAME_CLOCK_SEC = 60;
 /** Rolling fight-start buffer, in milliseconds of real time. */
 const DEFAULT_SNAPSHOT_WINDOW_MS = 10_000;
 /** Bounded debug log ring. */
@@ -211,7 +213,11 @@ export function createStateEngine(deps: StateEngineDeps): StateEngine {
             failures += 1;
             // "Not in game" is a normal state (lobby, loading screen, game
             // over) — a single blip must not blank a live match.
-            if (failures >= FAILURES_TO_NOT_IN_GAME) markNotInGame(`${failures} failed reads`);
+            const silenceMs = lastSuccessAt > 0 ? Math.max(0, now() - lastSuccessAt) : 0;
+            const midgame = state.inGame && state.gameTime > MIDGAME_CLOCK_SEC && silenceMs > 0;
+            if (failures >= FAILURES_TO_NOT_IN_GAME && !midgame) {
+                markNotInGame(`${failures} failed reads`);
+            }
             lastFingerprint = '';
             return {
                 ok: false,
diff --git a/src/overlay/OverlayApp.tsx b/src/overlay/OverlayApp.tsx
index 6940b24..6989610 100644
--- a/src/overlay/OverlayApp.tsx
+++ b/src/overlay/OverlayApp.tsx
@@ -75,7 +75,11 @@ import {
 } from '../logic/mayhem';
 import type { MayhemBundle } from '../logic/mayhem/types';
 import { validateMayhemBundle } from '../logic/mayhem/bundleSanitize';
-import { OverlayMayhemPanel } from './OverlayMayhemPanel';
+import {
+  isMayhemManualScanHint,
+  OverlayMayhemPanel,
+  shouldActivateMayhemSlot,
+} from './OverlayMayhemPanel';
 import { OverlayPet } from './OverlayPet';
 import { LoadingCard } from './LoadingCard';
 import { cardRect } from './loadingScreenGeometry';
@@ -976,14 +980,20 @@ export const OverlayApp: React.FC = () => {
     () => false
   );
 
-  // An unverified frame activates the slot with ZERO offer ids so the persistent
-  // "press PageDown to retry" panel can render — a verified roll still needs ids.
+  // An unverified frame OR a live PageDown press activates the slot with ZERO
+  // offer ids so the persistent retry/scanning panel can render — a verified
+  // roll still needs ids.
   const mayhemUnverified = state.mayhemVerification === 'unverified';
-  const mayhemPanelActive =
-    (inMayhem || inAram) &&
-    hudModules.mayhem &&
-    !mayhemDismissedRecently &&
-    (mayhemUnverified || (!!state.mayhemAugmentWindow && displayMayhemOfferIds.length > 0));
+  const mayhemPanelActive = shouldActivateMayhemSlot({
+    mayhemFamily: inMayhem || inAram,
+    moduleOn: hudModules.mayhem,
+    dismissedRecently: mayhemDismissedRecently,
+    unverified: mayhemUnverified,
+    augmentWindow: !!state.mayhemAugmentWindow,
+    offerCount: displayMayhemOfferIds.length,
+    ocrHint: state.mayhemOcrHint,
+  });
+  const mayhemScanHintActive = (inMayhem || inAram) && isMayhemManualScanHint(state.mayhemOcrHint);
 
   const mayhemLayoutPos =
     layoutElement(hudLayout, 'mayhem') ||
@@ -1102,7 +1112,7 @@ export const OverlayApp: React.FC = () => {
         hudModules.buy &&
         buyQueue.length > 0 &&
         slotHasModule('buy')) ||
-      (mayhemPanelActive &&
+      ((mayhemPanelActive || mayhemScanHintActive) &&
         (slotHasModule('mayhem') || slotHasModule('vision') || slot?.id === 'slot-center' || slot?.id === 'slot-0'))
     );
   })();
@@ -1773,6 +1783,7 @@ export const OverlayApp: React.FC = () => {
                   ranked={mayhemRanked}
                   mode="roll"
                   verification={state.mayhemVerification}
+                  ocrHint={state.mayhemOcrHint}
                 />
               </div>
             </OverlayChromePanel>
@@ -1855,6 +1866,7 @@ export const OverlayApp: React.FC = () => {
                   ranked={mayhemRanked}
                   mode="roll"
                   verification={state.mayhemVerification}
+                  ocrHint={state.mayhemOcrHint}
                 />
               ) : null}
               {!inAram && showGank ? <GankSquare threat={gankStatus} compact /> : null}
diff --git a/src/overlay/OverlayMayhemPanel.tsx b/src/overlay/OverlayMayhemPanel.tsx
index 92b3db7..d91b1f2 100644
--- a/src/overlay/OverlayMayhemPanel.tsx
+++ b/src/overlay/OverlayMayhemPanel.tsx
@@ -26,6 +26,43 @@ function shortenReason(text: string): string {
   return `${space > 18 ? cut.slice(0, space) : cut}…`;
 }
 
+/** Idle prompt — shown only when no press left a status; a finished scan has its own outcome text. */
+const MAYHEM_IDLE_CANNOT_VERIFY =
+  'Cannot verify the augment screen — press PageDown to retry (borderless window required in fullscreen)';
+
+/**
+ * A PageDown press is live (or just settled with no roll): its hint is the only
+ * content on screen, so the empty slot must still wake up instead of looking dead.
+ */
+// eslint-disable-next-line react-refresh/only-export-components
+export function isMayhemManualScanHint(hint?: string): boolean {
+  if (!hint) return false;
+  return (
+    hint.startsWith('Scanning…') ||
+    hint.startsWith('Could not verify') ||
+    hint.includes('retrying…')
+  );
+}
+
+/** Panel/slot activation, shared with the verify so the zero-offer press is testable. */
+// eslint-disable-next-line react-refresh/only-export-components
+export function shouldActivateMayhemSlot(input: {
+  mayhemFamily: boolean;
+  moduleOn: boolean;
+  dismissedRecently: boolean;
+  unverified: boolean;
+  augmentWindow: boolean;
+  offerCount: number;
+  ocrHint?: string;
+}): boolean {
+  if (!input.mayhemFamily || !input.moduleOn || input.dismissedRecently) return false;
+  return (
+    input.unverified ||
+    isMayhemManualScanHint(input.ocrHint) ||
+    (input.augmentWindow && input.offerCount > 0)
+  );
+}
+
 export const OverlayMayhemPanel: React.FC<{
   championName: string;
   ranked: RankedMayhemChoice[];
@@ -34,15 +71,15 @@ export const OverlayMayhemPanel: React.FC<{
   pickHint?: string;
   waitingForDeath?: boolean;
   verification?: MayhemVerification;
-}> = ({ championName, ranked, detecting, mode, pickHint, waitingForDeath, verification }) => {
-  // A frame the app could not verify must never show stale advice or claim a
-  // pick: the persistent panel only asks for a forced manual retry.
+  ocrHint?: string;
+}> = ({ championName, ranked, detecting, mode, pickHint, waitingForDeath, verification, ocrHint }) => {
+  // Never show stale advice or claim a pick. The hint is either a live Scanning
+  // status or a finished scan's explicit outcome; only an idle monitor falls
+  // back to the long Cannot-verify prompt.
   if (verification === 'unverified') {
     return (
       <div className="hud-overlay-panel ov-panel--short px-2 py-1.5">
-        <div className="hud-chrome-meta !text-[11px]">
-          Cannot verify the augment screen — press PageDown to retry (borderless window required in fullscreen)
-        </div>
+        <div className="hud-chrome-meta !text-[11px]">{ocrHint || MAYHEM_IDLE_CANNOT_VERIFY}</div>
       </div>
     );
   }
@@ -50,6 +87,16 @@ export const OverlayMayhemPanel: React.FC<{
   const resolvedMode =
     mode ?? (detecting ? (ranked.length ? 'roll' : 'reading') : ranked.length ? 'roll' : 'suggest');
 
+  // A live PageDown with zero offers has no ranked rows to show; keep the short
+  // Scanning chrome visible instead of letting the empty slot go blank.
+  if (verification === 'verified' && !ranked.length && isMayhemManualScanHint(ocrHint)) {
+    return (
+      <div className="hud-overlay-panel ov-panel--short px-2 py-1.5">
+        <div className="hud-chrome-meta !text-[11px]">{ocrHint}</div>
+      </div>
+    );
+  }
+
   if (!ranked.length && resolvedMode !== 'reading' && !waitingForDeath && !pickHint) return null;
 
   const best = ranked.reduce<RankedMayhemChoice | null>(
diff --git a/test-fixtures/mayhem-ocr/labelled/manifest.json b/test-fixtures/mayhem-ocr/labelled/manifest.json
index b3c8aaa..d63a83a 100644
--- a/test-fixtures/mayhem-ocr/labelled/manifest.json
+++ b/test-fixtures/mayhem-ocr/labelled/manifest.json
@@ -565,13 +565,13 @@
                            }
                          ],
                          "cardSlots": [
-                           { "x": 0.33, "body": 9, "rim": 9 },
-                           { "x": 0.5, "body": 9, "rim": 9 },
-                           { "x": 0.67, "body": 9, "rim": 9 },
-                           { "x": 0.245, "body": 3, "rim": 4 },
-                           { "x": 0.415, "body": 6, "rim": 8 },
-                           { "x": 0.585, "body": 6, "rim": 8 },
-                           { "x": 0.755, "body": 3, "rim": 4 }
+                           { "x": 0.33, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.5, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.67, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.245, "body": 3, "rim": 4, "gap": 3 },
+                           { "x": 0.415, "body": 6, "rim": 8, "gap": 6 },
+                           { "x": 0.585, "body": 6, "rim": 8, "gap": 6 },
+                           { "x": 0.755, "body": 3, "rim": 4, "gap": 3 }
                          ],
                          "cardsVisible": true
                        }
@@ -617,13 +617,13 @@
                            }
                          ],
                          "cardSlots": [
-                           { "x": 0.33, "body": 0, "rim": 0 },
-                           { "x": 0.5, "body": 0, "rim": 0 },
-                           { "x": 0.67, "body": 0, "rim": 0 },
-                           { "x": 0.245, "body": 0, "rim": 0 },
-                           { "x": 0.415, "body": 0, "rim": 0 },
-                           { "x": 0.585, "body": 0, "rim": 0 },
-                           { "x": 0.755, "body": 0, "rim": 0 }
+                           { "x": 0.33, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.5, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.67, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.245, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.415, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.585, "body": 0, "rim": 0, "gap": 0 },
+                           { "x": 0.755, "body": 0, "rim": 0, "gap": 0 }
                          ],
                          "cardsVisible": false
                        }
@@ -646,13 +646,13 @@
                            { "text": "Nebula", "rect": { "x": 0.7068, "y": 0.3796, "w": 0.0948, "h": 0.0389 } }
                          ],
                          "cardSlots": [
-                           { "x": 0.33, "body": 6, "rim": 8 },
-                           { "x": 0.5, "body": 6, "rim": 8 },
-                           { "x": 0.67, "body": 6, "rim": 8 },
-                           { "x": 0.245, "body": 9, "rim": 9 },
-                           { "x": 0.415, "body": 9, "rim": 9 },
-                           { "x": 0.585, "body": 9, "rim": 9 },
-                           { "x": 0.755, "body": 9, "rim": 9 }
+                           { "x": 0.33, "body": 6, "rim": 8, "gap": 6 },
+                           { "x": 0.5, "body": 6, "rim": 8, "gap": 6 },
+                           { "x": 0.67, "body": 6, "rim": 8, "gap": 6 },
+                           { "x": 0.245, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.415, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.585, "body": 9, "rim": 9, "gap": 0 },
+                           { "x": 0.755, "body": 9, "rim": 9, "gap": 0 }
                          ],
                          "cardsVisible": true
                        }
@@ -712,6 +712,58 @@
                          ],
                          "cardsVisible": true
                        }
+                     },
+                     {
+                       "id": "positive-gold-teal-geometry",
+                       "label": "positive",
+                       "synthetic": true,
+                       "image": "test-fixtures/mayhem-ocr/labelled/positive-gold-teal-geometry.png",
+                       "source": "scripts/make_mayhem_fixtures.ps1 (System.Drawing; unfamiliar titles; gold bodies on the teal-card geometry)",
+                       "expectedIds": [],
+                       "expectedCardCount": 3,
+                       "notes": "Three unfamiliar titles at card columns x=0.33/0.50/0.67 with gold (#c9a962) bodies and non-gold rims, no shop text. Body>=8 on the bounded card slots sets the pixel gate; synthetic.",
+                       "rawOcr": {
+                         "text": "Zephyr\nCinder\nAstral",
+                         "lines": [
+                           {
+                             "text": "Zephyr",
+                             "rect": {
+                               "x": 0.2812,
+                               "y": 0.3796,
+                               "w": 0.0958,
+                               "h": 0.0509
+                             }
+                           },
+                           {
+                             "text": "Cinder",
+                             "rect": {
+                               "x": 0.4547,
+                               "y": 0.3796,
+                               "w": 0.0885,
+                               "h": 0.0389
+                             }
+                           },
+                           {
+                             "text": "Astral",
+                             "rect": {
+                               "x": 0.6286,
+                               "y": 0.3796,
+                               "w": 0.0786,
+                               "h": 0.0389
+                             }
+                           }
+                         ],
+                         "cardSlots": [
+                           { "x": 0.33, "body": 9, "rim": 0, "gap": 0 },
+                           { "x": 0.5, "body": 9, "rim": 0, "gap": 0 },
+                           { "x": 0.67, "body": 9, "rim": 0, "gap": 0 },
+                           { "x": 0.245, "body": 3, "rim": 0, "gap": 3 },
+                           { "x": 0.415, "body": 6, "rim": 0, "gap": 6 },
+                           { "x": 0.585, "body": 6, "rim": 0, "gap": 6 },
+                           { "x": 0.755, "body": 3, "rim": 0, "gap": 3 }
+                         ],
+                         "cardsVisible": true
+                       }
                      }
                  ]
 }
diff --git a/verify_mayhem_fixtures.ts b/verify_mayhem_fixtures.ts
index e7e57f9..fae5280 100644
--- a/verify_mayhem_fixtures.ts
+++ b/verify_mayhem_fixtures.ts
@@ -121,6 +121,11 @@ ok(
   fixtures.find((fx) => fx.id === 'negative-full-width-teal')?.label === 'negative',
   'full-width teal fixture is labelled negative'
 );
+ok(
+  fixtures.find((fx) => fx.id === 'positive-gold-teal-geometry')?.label === 'positive' &&
+    fixtures.find((fx) => fx.id === 'positive-gold-teal-geometry')?.synthetic === true,
+  'gold-body fixture is labelled positive and synthetic'
+);
 
 // A hand-built/older payload with aligned strong slots but no explicit gap must
 // never pass the pixel gate, even with cardsVisible:true (the fail-closed boundary).
@@ -195,6 +200,24 @@ function liveOcr(): void {
         `${fx.id}: live PNG classifies accept with 3 placeholders`
       );
     }
+    if (fx.id === 'positive-gold-teal-geometry') {
+      ok(parsed.cardsVisible === true, `${fx.id}: gold bodies set the pixel gate`);
+      ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
+      const goldCardSlots = (parsed.cardSlots ?? []).filter(
+        (slot) => [0.33, 0.5, 0.67].some((c) => Math.abs(slot.x - c) <= 0.03)
+      );
+      ok(
+        goldCardSlots.length >= 2 && goldCardSlots.every((slot) => slot.body >= 8 && slot.gap === 0),
+        `${fx.id}: gold bodies yield body>=8 with clean gaps on the card columns`
+      );
+      const live = liveDecision(parsed);
+      ok(
+        live.decision === 'accept' && live.reasons.includes('all-unknown-card-pixels') &&
+          live.ids.length === 3 && live.cardCount === 3 &&
+          live.knownIds.length === 0 && live.placeholderIds.length === 3,
+        `${fx.id}: live PNG classifies accept via all-unknown-card-pixels`
+      );
+    }
     if (fx.id === 'negative-headerless-no-teal') {
       ok(parsed.cardsVisible === false, `${fx.id}: non-teal bodies/rims clear the pixel gate`);
       ok(lines.length === 3, `${fx.id}: three boxed unfamiliar titles`);
diff --git a/verify_mayhem_ocr_lines.ts b/verify_mayhem_ocr_lines.ts
index 6aca566..88325f6 100644
--- a/verify_mayhem_ocr_lines.ts
+++ b/verify_mayhem_ocr_lines.ts
@@ -207,6 +207,34 @@ ok(
   );
 }
 
+// (c9) gold-body evidence rides the same slot marker and schema as teal: no new
+// field, and the same fail-closed rules for a missing gap.
+{
+  const goldMarked = parseMayhemOcrOutput(
+    ['__OT_CARDS_VISIBLE 1__', '__OT_CARD_SLOTS__[{"x":0.33,"body":9,"rim":0,"gap":0}]', 'Zephyr'].join('\n')
+  );
+  const goldSlot = goldMarked.cardSlots?.[0];
+  ok(
+    goldMarked.cardsVisible === true && goldMarked.text === 'Zephyr',
+    'gold-body evidence keeps the coarse flag and text projection unchanged'
+  );
+  ok(
+    goldSlot !== undefined &&
+      Object.keys(goldSlot).sort().join(',') === 'body,gap,rim,x' &&
+      goldSlot.body === 9 && goldSlot.rim === 0 && goldSlot.gap === 0,
+    'gold body evidence decodes with the unchanged card-slot schema (no new fields)'
+  );
+  ok(
+    parseMayhemOcrOutput('__OT_CARD_SLOTS__[{"x":0.33,"body":9,"rim":0}]').cardSlots?.length === 0,
+    'a gold-shaped slot with no explicit gap still fails closed'
+  );
+  const tealSlot = parseMayhemOcrOutput('__OT_CARD_SLOTS__[{"x":0.33,"body":9,"rim":9,"gap":0}]').cardSlots?.[0];
+  ok(
+    tealSlot?.body === 9 && tealSlot?.rim === 9 && tealSlot?.gap === 0,
+    'teal slot evidence still decodes unchanged beside gold support'
+  );
+}
+
 // (d) the script emits the marker with boxes when OCR runs on a file
 function live(): void {
   if (process.platform !== 'win32') {
diff --git a/verify_mayhem_text_matrix.ts b/verify_mayhem_text_matrix.ts
index 095fa79..0e4586c 100644
--- a/verify_mayhem_text_matrix.ts
+++ b/verify_mayhem_text_matrix.ts
@@ -101,10 +101,8 @@ async function main(): Promise<void> {
       parts.push(`__OT_CARDS_VISIBLE ${f.rawOcr.cardsVisible ? 1 : 0}__`);
     }
     if (f.rawOcr.cardSlots) {
-      // Frozen fixtures predate the explicit-gap contract; the live sampler emits
-      // gap:0 for these bounded teal patches, so model that in the marker.
-      const slots = f.rawOcr.cardSlots.map((s) => ({ ...s, gap: s.gap ?? 0 }));
-      parts.push(`__OT_CARD_SLOTS__${JSON.stringify(slots)}`);
+      // Frozen slots are the sampler's own output, gaps included; no adapter gap.
+      parts.push(`__OT_CARD_SLOTS__${JSON.stringify(f.rawOcr.cardSlots)}`);
     }
     parts.push(f.rawOcr.text, `__OT_LINES__${JSON.stringify(f.rawOcr.lines)}`);
     return parseMayhemOcrOutput(parts.join('\n'));
@@ -385,6 +383,36 @@ async function main(): Promise<void> {
         gated.ids.every((id) => gated.placeholderIds.includes(id))
     );
   }
+  {
+    const goldFx = fixture('positive-gold-teal-geometry');
+    const goldSlots = (parsedFixture(goldFx).cardSlots ?? []).filter((s) =>
+      [0.33, 0.5, 0.67].some((c) => Math.abs(s.x - c) <= 0.03)
+    );
+    assert(
+      'gold fixture freezes the sampler gaps at the card columns',
+      goldSlots.length === 3 && goldSlots.every((s) => s.body >= 8 && s.gap === 0)
+    );
+    const gatedGold = fromFixture(goldFx, 7000);
+    assert(
+      'headerless all-unknown row with gold bodies accepts via card pixels',
+      gatedGold.cardCount === 3 && gatedGold.decision === 'accept' &&
+        gatedGold.reasons.includes('all-unknown-card-pixels') &&
+        gatedGold.ids.length === 3 && gatedGold.knownIds.length === 0 &&
+        gatedGold.placeholderIds.length === 3
+    );
+    // Identical gold bodies, but leaking gaps: still one band, not three cards.
+    const leakingGold = classifyMayhemFrame({
+      lines: frameLines(goldFx), augments, mode: 'mayhem-likely',
+      state: createMayhemPipelineState(), now: 7000,
+      cardsVisible: true,
+      cardSlots: (parsedFixture(goldFx).cardSlots ?? []).map((s) => ({ ...s, gap: 6 })),
+    });
+    assert(
+      'gold bodies with leaking gaps still fail closed',
+      leakingGold.decision === 'unverified' && leakingGold.ids.length === 0 &&
+        leakingGold.knownIds.length === 0 && leakingGold.placeholderIds.length === 0
+    );
+  }
   {
     const ungated = fromFixture(fixture('negative-headerless-no-teal'), 7000);
     assert(
```

## 5. Untracked files

### verify_mayhem_manual_feedback.ts (untracked verify file, full diff via --no-index /dev/null)
```diff
diff --git a/verify_mayhem_manual_feedback.ts b/verify_mayhem_manual_feedback.ts
new file mode 100644
index 0000000..1853d5f
--- /dev/null
+++ b/verify_mayhem_manual_feedback.ts
@@ -0,0 +1,401 @@
+/**
+ * Manual PageDown feedback + retry regressions (first-run fix).
+ *
+ * A press must always change what the player sees, even when OCR is busy:
+ *   1. every press pushes a "Scanning…" patch before the capture await, with a
+ *      per-press nonce in payload + fingerprint so the drop guard cannot eat it;
+ *   2. every outcome (in-flight, throttled, invalid/preview, accept) pushes a
+ *      second patch — no refusal returns silently;
+ *   3. a press refused as in-flight sets a pending flag that is consumed once
+ *      when the capture slot frees, running one forced manual scan;
+ *   4. the auto-scan epoch guard is untouched, so a manual press still
+ *      invalidates a stale auto tick.
+ *
+ * Sections 7-9 replace string-only faith with the real deferred reader and the
+ * real hotkey route: a transient Scanning/retry hint must resolve to the
+ * explicit outcome, a queued press must run one forced scan, and a zero-offer
+ * Scanning press must keep the Mayhem panel/slot alive.
+ *
+ * Run: npx --yes tsx verify_mayhem_manual_feedback.ts
+ */
+
+import fs from 'node:fs';
+import React from 'react';
+import { renderToStaticMarkup } from 'react-dom/server';
+import bundle from './src/data/mayhem/bundle.json';
+import {
+  buildOverlayPayload,
+  getMayhemLiveOfferIds,
+  mayhemOcrHintValue,
+  overlayFingerprint,
+  pushMayhemManualFeedback,
+  resetMatchCaches,
+  setMayhemHotkeyVerifyHarness,
+  triggerManualMayhemOcrFromHotkey,
+} from './electron/game-monitor';
+import {
+  clearPendingMayhemManual,
+  detectMayhemOffers,
+  isMayhemOcrInFlight,
+  noteMayhemManualPressInFlight,
+  resetMayhemOcrCache,
+  setMayhemOcrRetainOffers,
+  takePendingMayhemManual,
+} from './electron/mayhem-ocr';
+import type { MayhemAugment, MayhemBundle } from './src/logic/mayhem/types';
+import {
+  isMayhemManualScanHint,
+  OverlayMayhemPanel,
+  shouldActivateMayhemSlot,
+} from './src/overlay/OverlayMayhemPanel';
+
+let failures = 0;
+function ok(cond: boolean, msg: string): void {
+  if (!cond) {
+    failures += 1;
+    console.error('FAIL', msg);
+  } else {
+    console.log('ok', msg);
+  }
+}
+
+function section(src: string, start: string, end: string): string {
+  const from = src.indexOf(start);
+  const to = from >= 0 ? src.indexOf(end, from) : -1;
+  return from >= 0 && to > from ? src.slice(from, to) : '';
+}
+
+function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
+  let resolve!: (value: T) => void;
+  const promise = new Promise<T>((res) => {
+    resolve = res;
+  });
+  return { promise, resolve };
+}
+
+async function waitFor(predicate: () => boolean, msg: string): Promise<void> {
+  for (let i = 0; i < 200; i += 1) {
+    if (predicate()) return;
+    await new Promise<void>((resolve) => setTimeout(resolve, 5));
+  }
+  ok(false, msg);
+}
+
+interface Screen {
+  parsed: {
+    text: string;
+    lines: Array<{ text: string; rect: { x: number; y: number; w: number; h: number } }>;
+    target: { pid: number; exe: string; foreground: boolean };
+    blackFrame: boolean;
+    language: string | null;
+    noTarget: boolean;
+    fallback: boolean;
+  };
+  owner: boolean;
+}
+
+const THREE_TITLES = ['Jeweled Gauntlet', 'Giant Slayer', 'Recursion'];
+const augments = (bundle as MayhemBundle).augments as MayhemAugment[];
+function boxedScreen(titles: string[]): Screen {
+  const xs = [0.265, 0.435, 0.605];
+  return {
+    parsed: {
+      text: titles.join('\n'),
+      lines: titles.map((text, i) => ({ text, rect: { x: xs[i], y: 0.38, w: 0.13, h: 0.04 } })),
+      target: { pid: 4242, exe: 'League of Legends', foreground: true },
+      blackFrame: false,
+      language: 'en-US',
+      noTarget: false,
+      fallback: false,
+    },
+    owner: true,
+  };
+}
+const UNVERIFIED_SCREEN: Screen = {
+  parsed: {
+    text: 'unverifiable text',
+    lines: [],
+    target: { pid: 4242, exe: 'League of Legends', foreground: true },
+    blackFrame: false,
+    language: 'en-US',
+    noTarget: false,
+    fallback: false,
+  },
+  owner: true,
+};
+
+async function main(): Promise<void> {
+  console.log('--- 1. per-press nonce, hint and fingerprint ---');
+  pushMayhemManualFeedback('offers:2');
+  const hint1 = mayhemOcrHintValue() || '';
+  const p1 = buildOverlayPayload(null, null);
+  const fp1 = overlayFingerprint(p1);
+  pushMayhemManualFeedback('offers:3');
+  const hint2 = mayhemOcrHintValue() || '';
+  const p2 = buildOverlayPayload(null, null);
+  const fp2 = overlayFingerprint(p2);
+  ok(p2.mayhemOcrFeedbackNonce === p1.mayhemOcrFeedbackNonce + 1, 'nonce increments per press');
+  ok(
+    hint1.startsWith('offers:2') && hint1.includes(`#${p1.mayhemOcrFeedbackNonce}`),
+    `the status carries its nonce (${hint1})`
+  );
+  ok(
+    hint2.startsWith('offers:3') && hint2.includes(`#${p2.mayhemOcrFeedbackNonce}`),
+    `the next status carries its nonce (${hint2})`
+  );
+  ok(hint1 !== hint2 && fp1 !== fp2, 'two presses render different text and different fingerprints');
+
+  console.log('--- 2. pending-manual flag semantics ---');
+  clearPendingMayhemManual();
+  ok(takePendingMayhemManual() === false, 'nothing queued after a clear');
+  noteMayhemManualPressInFlight();
+  ok(takePendingMayhemManual() === true, 'a queued press is consumed');
+  ok(takePendingMayhemManual() === false, 'a queued press is consumed at most once');
+  noteMayhemManualPressInFlight();
+  clearPendingMayhemManual();
+  ok(takePendingMayhemManual() === false, 'match-end clear drops a queued press');
+  ok(typeof isMayhemOcrInFlight() === 'boolean', 'the in-flight probe is available');
+
+  const monitor = fs.readFileSync('electron/game-monitor.ts', 'utf8');
+  const ocr = fs.readFileSync('electron/mayhem-ocr.ts', 'utf8');
+  const panel = fs.readFileSync('src/overlay/OverlayMayhemPanel.tsx', 'utf8');
+  const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
+  const restore = section(
+    monitor,
+    'async function restoreMayhemAugmentPanelFromHotkey',
+    '/** Diagnostics for the performance panel. */'
+  );
+  const flush = section(monitor, 'export function flushPendingMayhemManual(', 'function pushMayhemOverlayPatch()');
+  const tick = section(monitor, 'async function tickMayhemOcr()', 'export function clearMayhemOffersForDashboard()');
+  const fingerprint = section(monitor, 'function overlayFingerprint(', 'let mayhemOfferIds');
+
+  console.log('--- 3. every manual path pushes a patch ---');
+  const scanAt = restore.indexOf('await detectMayhemOffers(');
+  const scanningAt = restore.indexOf("pushMayhemManualFeedback('Scanning…')");
+  ok(scanningAt >= 0 && scanningAt < scanAt, 'a visible Scanning patch is pushed before the capture await');
+
+  const noBundleAt = restore.indexOf("reason: 'no-bundle'");
+  ok(
+    noBundleAt >= 0 && restore.slice(noBundleAt, noBundleAt + 200).includes('pushMayhemManualFeedback'),
+    'the no-bundle refusal also pushes an outcome'
+  );
+
+  const freshGuard = restore.indexOf('if (!read.fresh)');
+  const nonFresh = restore.slice(freshGuard, restore.indexOf('if (read.decision', freshGuard));
+  ok(
+    nonFresh.includes('noteMayhemManualPressInFlight()') &&
+      nonFresh.includes("pushMayhemManualFeedback('scan-in-flight, retrying…')") &&
+      nonFresh.includes("pushMayhemManualFeedback('retrying…')"),
+    'in-flight queues a retry and both non-fresh refusals push an outcome'
+  );
+
+  const decisionAt = restore.indexOf('if (read.decision');
+  const decision = restore.slice(decisionAt, restore.indexOf('mayhemUnverified = false', decisionAt));
+  ok(decision.includes('pushMayhemManualFeedback('), 'invalid/preview frames push an outcome');
+  ok(
+    restore.includes('pushMayhemManualFeedback(`offers:${ids.length}`)'),
+    'an accepted scan pushes the offers count'
+  );
+  const pushes = restore.split('pushMayhemManualFeedback(').length - 1;
+  ok(pushes >= 6, `every press path pushes (${pushes} feedback pushes in the restore body)`);
+  ok(
+    fingerprint.includes('payload.mayhemOcrFeedbackNonce ?? 0'),
+    'the overlay fingerprint includes the per-press nonce'
+  );
+
+  console.log('--- 4. pending press runs one forced manual scan ---');
+  ok(
+    flush.includes('takePendingMayhemManual()') &&
+      flush.includes('isMayhemOcrInFlight()') &&
+      flush.includes('runManual()'),
+    'the flush consumes one queued press and runs the forced manual scan'
+  );
+  const awaitAt = tick.indexOf('await runMayhemMonitorScan');
+  const flushAt = tick.indexOf('flushPendingMayhemManual()');
+  ok(awaitAt >= 0 && flushAt > awaitAt, 'the auto scan settle flushes a queued press');
+  const detectCall = section(restore, 'read = await detectMayhemOffers(', '} finally {');
+  ok(
+    detectCall.includes('forcedManual: true') && /0,\s*\{\s*minMatches: 1/.test(detectCall),
+    'the follow-up path is the forced manual detect (interval 0, forcedManual)'
+  );
+  ok(
+    ocr.includes('let pendingManual = false') && ocr.includes('export function takePendingMayhemManual'),
+    'the pending flag lives beside the single OCR slot it guards'
+  );
+
+  console.log('--- 5. epoch guard stays intact ---');
+  const firstBump = restore.indexOf('mayhemMonitorEpoch += 1');
+  const lastBump = restore.lastIndexOf('mayhemMonitorEpoch += 1');
+  const write = restore.indexOf('mayhemOfferIds = ids');
+  ok(
+    firstBump >= 0 &&
+      firstBump < scanAt &&
+      lastBump > scanAt &&
+      freshGuard > scanAt &&
+      freshGuard < lastBump &&
+      write > lastBump &&
+      restore.split('mayhemMonitorEpoch += 1').length - 1 === 2,
+    'manual press still bumps, awaits, refuses non-fresh, then writes (2 bumps)'
+  );
+
+  console.log('--- 6. overlay renders the hint distinctly from idle text ---');
+  ok(
+    panel.includes('ocrHint?: string') && panel.includes('{ocrHint ||'),
+    'the panel renders the live hint in place of the idle Cannot-verify text'
+  );
+  ok(
+    app.split('ocrHint={state.mayhemOcrHint}').length - 1 === 2,
+    'both panel call sites receive the overlay hint'
+  );
+
+  console.log('--- 7. deferred reader: transient status resolves to an outcome ---');
+  resetMatchCaches();
+  resetMayhemOcrCache();
+  setMayhemOcrRetainOffers(false);
+  const hintGate = deferred<Screen>();
+  const scanned = detectMayhemOffers(augments, 0, {
+    minMatches: 2,
+    readScreen: () => hintGate.promise,
+  });
+  ok(isMayhemOcrInFlight(), 'the deferred reader holds the OCR slot');
+  pushMayhemManualFeedback('Scanning…');
+  ok(
+    (mayhemOcrHintValue() || '').startsWith('Scanning…'),
+    'Scanning… is visible only while the scan is in flight'
+  );
+  hintGate.resolve(UNVERIFIED_SCREEN);
+  await scanned;
+  ok(!isMayhemOcrInFlight(), 'the slot is released when the deferred reader resolves');
+  const settled = mayhemOcrHintValue() || '';
+  ok(
+    settled.startsWith('Could not verify — press PageDown to retry'),
+    `a settled scan shows the explicit outcome (${settled})`
+  );
+  ok(
+    !settled.includes('Scanning…') && !settled.includes('retrying…'),
+    'no stale in-progress wording survives the settle'
+  );
+  pushMayhemManualFeedback('retrying…');
+  ok(
+    (mayhemOcrHintValue() || '').startsWith('Could not verify — press PageDown to retry'),
+    'a retry hint with no work scheduled reads as the outcome, not as progress'
+  );
+  pushMayhemManualFeedback('offers:1');
+  ok((mayhemOcrHintValue() || '').startsWith('offers:1'), 'the next press replaces the outcome');
+  resetMatchCaches();
+  ok(!mayhemOcrHintValue(), 'a match reset clears the hint back to idle');
+
+  console.log('--- 8. production hotkey wiring: queued press runs one forced scan ---');
+  clearPendingMayhemManual();
+  resetMatchCaches();
+  resetMayhemOcrCache();
+  setMayhemOcrRetainOffers(false);
+  let scans = 0;
+  const firstGate = deferred<Screen>();
+  const forcedGate = deferred<Screen>();
+  const reader = (): Promise<Screen> => {
+    scans += 1;
+    return scans === 1 ? firstGate.promise : forcedGate.promise;
+  };
+  setMayhemHotkeyVerifyHarness({ readScreen: reader });
+  const patches0 = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce;
+
+  // The first PageDown runs the real hotkey route (KIWI payload, injected reader)
+  // and holds the single OCR slot — the test never calls detectMayhemOffers.
+  const firstPress = triggerManualMayhemOcrFromHotkey();
+  ok(isMayhemOcrInFlight(), 'the first press holds the single OCR slot');
+  ok(scans === 1, 'the first press captured once');
+
+  // The overlapping press is refused as in-flight, queued and shown its own
+  // outcome by the production route — no pending flag or callback is set here.
+  await triggerManualMayhemOcrFromHotkey();
+  ok(isMayhemOcrInFlight(), 'the refused press left the first capture in the slot');
+  ok(scans === 1, 'the refused press never captured');
+  const pressPatches = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce - patches0;
+  ok(pressPatches > 0, `the presses push visible feedback while the slot is held (${pressPatches})`);
+  const refusedHint = mayhemOcrHintValue() || '';
+  ok(
+    refusedHint.includes('retrying…'),
+    `the refused press shows a retry outcome, not silence (${refusedHint})`
+  );
+
+  // Settling the scan drives the production post-settle flush, which must
+  // consume the queued press and run one forced scan. The test never calls it.
+  firstGate.resolve(UNVERIFIED_SCREEN);
+  await firstPress;
+  await waitFor(() => scans === 2, 'the production flush consumed the queued press');
+  ok(scans === 2, `the queued press ran exactly one forced scan (scan count ${scans})`);
+  forcedGate.resolve(boxedScreen(THREE_TITLES));
+  await waitFor(() => getMayhemLiveOfferIds().length === 3, 'the forced scan committed its roll');
+  const finalIds = getMayhemLiveOfferIds();
+  ok(
+    finalIds.join(',') === 'jeweled_gauntlet,giant_slayer,recursion',
+    `final roll ids come from the forced scan (${finalIds.join(',')})`
+  );
+  const patches = buildOverlayPayload(null, null).mayhemOcrFeedbackNonce - patches0;
+  ok(patches > pressPatches, `the forced press added its own feedback (${pressPatches} -> ${patches})`);
+  ok((mayhemOcrHintValue() || '').startsWith('offers:3'), 'the final hint is the accepted roll');
+  setMayhemHotkeyVerifyHarness(null);
+
+  console.log('--- 9. zero-offer Scanning press keeps the panel and slot alive ---');
+  const scanningHint = 'Scanning… · #9';
+  // Production after G4: a verified match with zero offers and a live press.
+  const verification = 'verified' as const;
+  const zeroOffer = {
+    mayhemFamily: true,
+    moduleOn: true,
+    dismissedRecently: false,
+    unverified: verification === 'unverified',
+    augmentWindow: false,
+    offerCount: 0,
+    ocrHint: scanningHint,
+  };
+  ok(isMayhemManualScanHint(scanningHint), 'a live Scanning hint is recognized as manual progress');
+  ok(
+    isMayhemManualScanHint('Could not verify — press PageDown to retry · #9') &&
+      isMayhemManualScanHint('scan-in-flight, retrying… · #9'),
+    'a settled or queued retry hint is recognized too'
+  );
+  ok(
+    shouldActivateMayhemSlot(zeroOffer),
+    'zero offers plus a Scanning press activates the Mayhem panel'
+  );
+  ok(
+    !shouldActivateMayhemSlot({ ...zeroOffer, mayhemFamily: false }),
+    'the ranked path is unchanged by a manual-scan hint'
+  );
+  // G4 guard: verified + zero offers + live hint must render Scanning chrome,
+  // not the old null path. The legacy unverified path is kept alongside it.
+  const markup = renderToStaticMarkup(
+    React.createElement(OverlayMayhemPanel, {
+      championName: 'Ahri',
+      ranked: [],
+      verification,
+      ocrHint: scanningHint,
+    })
+  );
+  ok(
+    markup.includes('Scanning…') && !markup.includes('Cannot verify'),
+    'zero offers + verified + live Scanning renders chrome (not null/Cannot-verify)'
+  );
+  const unverifiedMarkup = renderToStaticMarkup(
+    React.createElement(OverlayMayhemPanel, {
+      championName: 'Ahri',
+      ranked: [],
+      verification: 'unverified',
+      ocrHint: scanningHint,
+    })
+  );
+  ok(
+    unverifiedMarkup.includes('Scanning…') && !unverifiedMarkup.includes('Cannot verify'),
+    'the unverified Scanning state still renders the live hint'
+  );
+}
+
+void main().then(() => {
+  if (failures > 0) {
+    console.error(`verify:mayhem-manual-feedback FAILED (${failures} check(s))`);
+    process.exit(1);
+  }
+  console.log('verify:mayhem-manual-feedback ok');
+});
```

### Other untracked files - names only

- test-fixtures/mayhem-ocr/labelled/positive-gold-teal-geometry.png - binary fixture, content not embedded.
- BRIEF-*.md, HANDOFF.md, REVIEW_BUNDLE_test17.md - docs, content excluded per brief.

## 6. Fresh verification output (tail + exit code)

### 1. verify_mayhem_manual_feedback.ts
Command: `npx --yes tsx verify_mayhem_manual_feedback.ts`
Exit code: 0
```
ok a settled or queued retry hint is recognized too
ok zero offers plus a Scanning press activates the Mayhem panel
ok the ranked path is unchanged by a manual-scan hint
ok zero offers + verified + live Scanning renders chrome (not null/Cannot-verify)
ok the unverified Scanning state still renders the live hint
verify:mayhem-manual-feedback ok
```

### 2. verify_mayhem_ocr_lines.ts
Command: `npx --yes tsx verify_mayhem_ocr_lines.ts`
Exit code: 0
```
ok teal slot evidence still decodes unchanged beside gold support
ok ps1 -ImagePath emits __OT_LINES__ marker
ok marker carries at least one box
ok every emitted box is normalized to 0..1
verify:mayhem-ocr-lines ok
```

### 3. verify_mayhem_fixtures.ts
Command: `npx --yes tsx verify_mayhem_fixtures.ts`
Exit code: 0
```
ok positive-gold-teal-geometry: gold bodies set the pixel gate
ok positive-gold-teal-geometry: three boxed unfamiliar titles
ok positive-gold-teal-geometry: gold bodies yield body>=8 with clean gaps on the card columns
ok positive-gold-teal-geometry: live PNG classifies accept via all-unknown-card-pixels
verify:mayhem-fixtures ok
```

### 4. verify_mayhem_text_matrix.ts
Command: `npx --yes tsx verify_mayhem_text_matrix.ts`
Exit code: 0
```
PASS gold bodies with leaking gaps still fail closed
PASS same rows without pixel gate stay unverified
PASS scoreboard rows with teal elsewhere still rejected
PASS aligned teal background over card columns stays unverified
PASS headerless four-card roll with aligned teal slots accepts
Summary: 0 FAIL, 20 PASS
```

### 5. verify_mayhem_capture_gating.ts
Command: `npx --yes tsx verify_mayhem_capture_gating.ts`
Exit code: 0
```
ok the first scan really ran
ok a second scan inside minIntervalMs is refused as throttled (throttled)
ok a scan started while another is in flight is refused as in-flight (in-flight)
ok the outer scan still completes normally
verify:mayhem-capture-gating ok
```

### 6. verify_mayhem_monitor.ts
Command: `npx --yes tsx verify_mayhem_monitor.ts`
Exit code: 0
```
ok the shared restore clears the dismissal before the capture await (clear@1945/1982, scan@2792)
ok the shared restore bumps, awaits, bumps again, refuses non-fresh, then writes (bump@2610, scan@2792, guard@4138, bump@5392, write@5422)
ok package.json has a verify:mayhem-offers script
ok verify:release runs verify:mayhem-offers between the monitor and OCR checks
verify:mayhem-monitor ok
```

### 7. verify_mayhem_reroll_refresh.ts
Command: `npx --yes tsx verify_mayhem_reroll_refresh.ts`
Exit code: 0
```
ok an all-unknown frame over an all-placeholder roll never arms the fast poll either
ok a real new roll still replaces the old one
ok the auto tick derives mayhemMatch from isMayhemMode(mode) (7980 chars)
ok the manual hotkey derives its own mayhemMatch from isMayhemMode(mode) (6616 chars)
verify:mayhem-reroll-refresh ok
```

### 8. verify_real_game_regressions.ts
Command: `npx --yes tsx verify_real_game_regressions.ts`
Exit code: 0
```
--- verify:real-game: diagnostics ---
ok main can ask whether the live game is ARAM-family
ok one in-game session read can fill an unknown queue
ok mayhem-likely starts the normal OCR schedule
verify:real-game ok
```

### 9. verify_match_lifecycle.ts
Command: `npx --yes tsx verify_match_lifecycle.ts`
Exit code: 0
```
Match lifecycle: 600 full games, plus the 7:00 / 10:00 outage cases.
Match lifecycle ok.
```

### 10. lint
Command: `npm run lint`
Exit code: 0
```
[baseline-browser-mapping] The data in this module is over two months old.  To ensure accurate Baseline data, please 
update: `npm i baseline-browser-mapping@latest -D`
C:\Users\Az040\Projects\otc-mayhem\src\overlay\OverlayApp.tsx
  1289:3  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
Γ£û 1 problem (0 errors, 1 warning)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

### 11. tsc - app
Command: `npx tsc --noEmit -p tsconfig.app.json`
Exit code: 0
```
```

### 12. tsc - electron
Command: `npx tsc --noEmit -p tsconfig.electron.json`
Exit code: 0
```
```

### 13. build
Command: `npm run build`
Exit code: 0
```
dist/assets/remote-DS-77-xm.js                                     1.02 kB Γöé gzip:   0.56 kB
dist/assets/overlay-Ceo5DJLI.js                                   89.22 kB Γöé gzip:  28.62 kB
dist/assets/main-BDoWfua8.js                                     148.92 kB Γöé gzip:  44.65 kB
dist/assets/snapshot-BO68vEVd.js                                 359.62 kB Γöé gzip:  41.77 kB
dist/assets/pixelPetCanvas-BuKTQgR4.js                           404.73 kB Γöé gzip: 125.18 kB
Γ£ô built in 4.96s
```

### 14. Full suite: npm run verify:release
Command: `npm run verify:release`
Exit code: 1

The chain ran from step 1 through verify:clipper with no new failures (`verify:clipper ok` at log line 2044), then stopped fail-fast at the documented pre-existing `verify:clipper-lifecycle` red: ffmpeg is on PATH at `C:\Users\Az040\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`.

Tail (last 12 non-empty lines):
```
--- verify:clipper: rapid trigger serialization ---
ok rapid clip 1 succeeded and exists
ok rapid clip 2 succeeded and exists
ok rapid clips produced distinct output files
--- verify:clipper: saved clips sort before cap ---
ok newest clip is first (got clip-0209.mp4)
ok newest clip is kept when it sits past the first 200 names
ok display cap stays 24 (got 24)
ok stats every clip before capping (got 210)
ok clips are newest first
ok cache returns the same newest clip
ok cache skips a second directory read (got 1)
```

FAIL lines from the stop:
```
FAIL: status disabled when ffmpeg not found
FAIL: detail explains ffmpeg missing
FAIL: status is disabled before start
FAIL: setClipperActive(false) while disabled does nothing
```

### 15. Known pre-existing reds - independently re-run

- `npx --yes tsx verify_clipper_lifecycle.ts` with ffmpeg on PATH: exit 1, same 4 FAIL lines above. With `WinGet\Links` stripped from PATH: exit 0 (`verify:clipper-lifecycle ok`) - confirms environmental, not caused by this diff.
- `npx --yes tsx verify_purchase_order.ts`: exit 1, 4 FAIL (`FAIL fixture: full inv + finished boots + late game says sell boots`; `sell cue => plan frees a slot (agreement)`; `sell cue => actionable buy decision, never no-slot (no-slot)`; `sell cue => a concrete item is BUY NEXT`).
- `npx --yes tsx verify_app_density.ts`: exit 1, 1 FAIL (`FAIL - verify_app_density: 1 failing invariant(s)`).
- No new reds observed before the fail-fast stop; the three reds above are unchanged from the recorded baseline.

## 7. Concept ledger (G4/G5) and test-lane deviation

G4 (src/overlay/OverlayMayhemPanel.tsx, src/overlay/OverlayApp.tsx):
- No new panel abstractions. The zero-offer verified Scanning chrome reuses the existing `isMayhemManualScanHint` / `shouldActivateMayhemSlot` helpers and the existing reading-branch chrome; only one render guard was added. (Those two helpers are earlier G3 work already present in the uncommitted diff, not introduced by G4.)

G5 (src/logic/stateEngine.ts, electron/match-lifecycle.ts):
- `MIDGAME_CLOCK_SEC = 60` (stateEngine.ts): a trusted in-game clock past 60 s suppresses the 3-failed-read fast flip to not-in-game; the local read failure no longer blanks a live mid-game HUD. Justification: transient feed failures at minutes 7/10 were killing the overlay.
- `midgame` boolean (stateEngine.ts): `state.inGame && gameTime > MIDGAME_CLOCK_SEC && silenceMs > 0`, computed once at the failure seam so the resilience decision stays local and testable. Justification: one condition shared by the flip guard, no new state field.
- `MIDGAME_PROOF_SEC = 300` (match-lifecycle.ts): named constant replacing a bare `>= 300` literal in `shouldEndMatch`, selecting the 180 s midgame silence window. Justification: the same trusted-clock proof concept as G5, now named at the lifecycle boundary.
- No new panel abstractions in G5 (no overlay/window/Mayhem OCR files touched).

Test-lane deviation (verify_mayhem_manual_feedback.ts):
- The deferred-roll runtime sections 7-9 prove the queued-press flush through the *manual hotkey route* (`setMayhemHotkeyVerifyHarness` + the exported `flushPendingMayhemManual` seam). The literal auto-tick flush inside the private `tickMayhemOcr()` is asserted by source-text inspection of `flushPendingMayhemManual()` at that site, not by runtime injection, because `tickMayhemOcr` is module-private. If the reviewer demands runtime proof of the auto-tick path, an implementation seam (an injected reader or an exported tick with a default) is required; that is an impl change outside this docs lane.

## 8. Gate summary

All 13 frozen checks exited 0. Full `verify:release` exited 1 at the pre-existing clipper-lifecycle/ffmpeg red; purchase-order and app-density reproduce their recorded FAIL counts. No new reds and no source/test edits in this lane.

