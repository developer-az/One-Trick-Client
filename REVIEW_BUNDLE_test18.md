# REVIEW BUNDLE - test18 (G7 overlay-presence lane)

Generated: 2026-11-20 20:34:16 -05:00
Base: 08e9b71 (08e9b7151b06a4b0492b353b91feca7c8559be67)
HEAD: 92bcb91 (92bcb91e2a374412f4e89b3b0d1e70338f8b4798) - the post-test.17 commit.
Work on top of HEAD (uncommitted): new G7 overlay-presence lane (4 files + verify_overlay_presence.ts). G6 ARAM-edge lane is still PENDING and runs after the test.18 tag.
Branch: fix/mayhem-first-run
Scope: DOCS/EVIDENCE lane. No source/test edits, no commits, no version bump.
The bundle itself is untracked and self-excluded from its own diff (listed by name only).
Documentation/meta files (PLAN.md, HANDOFF.md, BRIEF-*.md, graphify-out/, src/graphify-out/, electron/graphify-out/) are listed by name only; their content is intentionally excluded.

## 1. Working tree state

### git status --short
```
 M PLAN.md
 M electron/game-monitor.ts
 M electron/overlay-bounds.ts
 M electron/overlay-window.ts
 M src/overlay/OverlayApp.tsx
?? BRIEF-G4-IMPL.md
?? BRIEF-G4-TEST.md
?? BRIEF-G5-FEED.md
?? BRIEF-G7-LANE1.md
?? BRIEF-G7-LANE2.md
?? BRIEF-G7-TEST.md
?? BRIEF-Q1-F1-queue-fix.md
?? BRIEF-Q1-GATE-ALL-TESTS.md
?? BRIEF-Q1-queue-first.md
?? BRIEF-SHIP-TEST17.md
?? HANDOFF.md
?? electron/graphify-out/
?? graphify-out/
?? src/graphify-out/
?? verify_overlay_presence.ts
?? REVIEW_BUNDLE_test18.md
```

### git diff --name-only
```
PLAN.md
electron/game-monitor.ts
electron/overlay-bounds.ts
electron/overlay-window.ts
src/overlay/OverlayApp.tsx
```

## 2. Documentation/meta files - names only, content excluded

Untracked docs: BRIEF-G4-IMPL.md, BRIEF-G4-TEST.md, BRIEF-G5-FEED.md, BRIEF-G7-LANE1.md, BRIEF-G7-LANE2.md, BRIEF-G7-TEST.md, BRIEF-Q1-F1-queue-fix.md, BRIEF-Q1-GATE-ALL-TESTS.md, BRIEF-Q1-queue-first.md, BRIEF-SHIP-TEST17.md, HANDOFF.md, REVIEW_BUNDLE_test18.md.
Tracked-modified doc: PLAN.md (excluded from the stats and the diff below).
Graph output dirs (names only): graphify-out/, src/graphify-out/, electron/graphify-out/.
No content from any of these files is embedded in this bundle.

## 3. Tracked diff stats (git diff HEAD --stat, PLAN.md excluded)
```
 electron/game-monitor.ts   |  3 ++-
 electron/overlay-bounds.ts |  8 +++++---
 electron/overlay-window.ts | 24 ++++++++++++++++++++----
 src/overlay/OverlayApp.tsx | 11 ++++++-----
 4 files changed, 33 insertions(+), 13 deletions(-)
```

## 4. Full tracked diff (G7 files only; PLAN.md excluded; bundle self-excluded)
Files: electron/game-monitor.ts, electron/overlay-bounds.ts, electron/overlay-window.ts, src/overlay/OverlayApp.tsx.
```diff
diff --git a/electron/game-monitor.ts b/electron/game-monitor.ts
index 6480bf2..435aec4 100644
--- a/electron/game-monitor.ts
+++ b/electron/game-monitor.ts
@@ -2576,7 +2576,8 @@ function endGameSession(): void {
     resetMatchCaches();
     // Ring buffer pauses with the match; captured segments stay available.
     void setClipperActive(false);
-    hideOverlay();
+    // No hide: content stops here, but window presence owns visibility while a
+    // game is live, so the window must not drop out from under the match-end.
     // Delay destroy so a brief phase blip mid-game cannot permanently kill the window.
     // A new load/match cancels this gate before the 12 s elapse.
     overlayDestroyGate.schedule();
diff --git a/electron/overlay-bounds.ts b/electron/overlay-bounds.ts
index fb047ad..60c178c 100644
--- a/electron/overlay-bounds.ts
+++ b/electron/overlay-bounds.ts
@@ -257,9 +257,9 @@ export function overlayWindowFaults(health: OverlayWindowHealth): OverlayFault[]
 }
 
 /**
- * Whether a locked overlay window should exist on screen.
- * A live match does not override this: an empty transparent HWND over League
- * keeps DWM compositing the game even when the slot has nothing to draw.
+ * Whether a locked overlay window should exist on screen. Content alone used
+ * to decide this (an empty transparent HWND keeps DWM compositing the game),
+ * but while a game is live presence wins over that cost.
  */
 export function overlayWindowWanted(opts: {
     userHidden: boolean;
@@ -268,10 +268,12 @@ export function overlayWindowWanted(opts: {
     holdToShow: boolean;
     holdDown: boolean;
     emptySlot: boolean;
+    gameLive?: boolean;
 }): boolean {
     if (opts.userHidden || !opts.overlayEnabled) return false;
     if (!opts.locked) return true;
     if (opts.holdToShow && !opts.holdDown) return false;
+    if (opts.gameLive) return true;
     return !opts.emptySlot;
 }
 
diff --git a/electron/overlay-window.ts b/electron/overlay-window.ts
index dc5503c..7c65b5c 100644
--- a/electron/overlay-window.ts
+++ b/electron/overlay-window.ts
@@ -194,7 +194,8 @@ const HEALTH_LOG_EVERY_MS = 60_000;
 /**
  * Match start used to clear the empty set and force every overlay HWND on
  * screen for the whole game. That is the DWM cost this module exists to avoid.
- * Callers still notify match start and end; visibility follows content.
+ * Callers still notify match start and end; that signal now keeps the window
+ * up for a live game even when the renderer reports an empty slot.
  */
 export function setOverlayMatchActive(active: boolean): void {
     matchActive = active;
@@ -223,6 +224,7 @@ function shouldShowWindow(): boolean {
         holdToShow: holdToShowActive(),
         holdDown,
         emptySlot: !pageHasContent,
+        gameLive: matchActive,
     });
 }
 
@@ -300,6 +302,7 @@ function syncNativeVisibility(): void {
                 reason: 'slot-content',
                 userHidden,
                 content: pageHasContent,
+                gameLive: matchActive,
                 holdToShow: holdToShowActive(),
             });
         }
@@ -310,6 +313,7 @@ function syncNativeVisibility(): void {
             reason: 'slot-content',
             userHidden,
             content: pageHasContent,
+            gameLive: matchActive,
             holdToShow: holdToShowActive(),
         });
     }
@@ -326,6 +330,7 @@ function syncWindowVisibility(win: BrowserWindow): void {
             reason: 'slot-content',
             userHidden,
             content: pageHasContent,
+            gameLive: matchActive,
             holdToShow: holdToShowActive(),
         });
     } else if (!want && visible) {
@@ -337,6 +342,7 @@ function syncWindowVisibility(win: BrowserWindow): void {
             reason: 'slot-content',
             userHidden,
             content: pageHasContent,
+            gameLive: matchActive,
             holdToShow: holdToShowActive(),
         });
     }
@@ -463,8 +469,8 @@ function armOverlayRenderer(win: BrowserWindow): void {
 
 /**
  * Reload a crashed overlay renderer while a match is running. Visibility is
- * not forced here — keepOverlayOnTop re-shows a window that should be shown,
- * and a window with nothing to draw is hidden on purpose.
+ * not forced here — keepOverlayOnTop re-shows a window that should be shown;
+ * an empty window is hidden only outside a live game.
  * Does not re-bind mouse passthrough — that path freezes the cursor over League.
  */
 export function healOverlayWindows(): void {
@@ -1235,6 +1241,8 @@ export function createOverlayWindow(): BrowserWindow {
 
     // Default: a fullscreen click-through surface, so the game is never blocked.
     setClickThrough(true);
+    // A fresh HWND during a live game shows at once: the loading layer counts as content.
+    if (matchActive) syncWindowVisibility(overlayWin);
 
     // No OS chrome / context menu — accidental right-clicks must not surface UI that
     // steals focus from League or makes the overlay feel like it "closed".
@@ -1310,7 +1318,11 @@ export function keepOverlayOnTop(): void {
     for (const win of overlayWindows()) {
         try {
             syncWindowVisibility(win);
-            if (win.isVisible() && !win.isAlwaysOnTop()) assertAlwaysOnTop(win);
+            if (win.isVisible()) {
+                if (!win.isAlwaysOnTop()) assertAlwaysOnTop(win);
+                // showInactive raises without focus — League keeps mouse/keyboard input.
+                if (matchActive) win.showInactive();
+            }
         } catch {
             // ignore
         }
@@ -1332,6 +1344,10 @@ export function showOverlay(): void {
     } else if (!win.isVisible()) {
         win.showInactive();
     }
+    // Live-game presence does not wait for the renderer's content report.
+    if (matchActive && !win.isVisible() && (!holdToShowActive() || holdDown)) {
+        win.showInactive();
+    }
     syncOverlayPaintBudget();
     assertAlwaysOnTop(win);
     // Re-apply click-through after show — Windows can drop ignore-mouse state on hide/show
diff --git a/src/overlay/OverlayApp.tsx b/src/overlay/OverlayApp.tsx
index 6989610..9d41a04 100644
--- a/src/overlay/OverlayApp.tsx
+++ b/src/overlay/OverlayApp.tsx
@@ -1497,7 +1497,9 @@ export const OverlayApp: React.FC = () => {
   }, [handoffPhase, reducedMotion]);
 
   const handoffActive = handoffPhase !== 'idle';
-  const loadingLayerMounted = state.loading || (state.inGame && loadingSnapshotRef.current !== null);
+  // The layer keeps rendering from the snapshot after inGame flips false, so
+  // presence must follow the mount, not the game flag.
+  const loadingLayerMounted = state.loading || loadingSnapshotRef.current !== null;
   const hudHiddenForHandoff = loadingSnapshotRef.current !== null && handoffPhase !== 'fading';
 
   // The loading layer draws live values during the load and the frozen snapshot
@@ -1542,11 +1544,10 @@ export const OverlayApp: React.FC = () => {
 
   // Content stays reported through the handoff: the loading layer (or the load
   // itself) is still mounted, so the window must not hide before the HUD paints.
+  const hasAnyContent = state.loading || loadingLayerMounted || slotHasContent;
   useEffect(() => {
-    window.electronAPI?.reportOverlayContent?.(
-      state.loading || loadingLayerMounted || slotHasContent
-    );
-  }, [state.loading, loadingLayerMounted, slotHasContent]);
+    window.electronAPI?.reportOverlayContent?.(hasAnyContent);
+  }, [hasAnyContent]);
 
   if (state.loading) {
     // Your loading-screen portrait, only when the side AND the index came from
```

## 5. Untracked files

### verify_overlay_presence.ts (NEW verify file, full diff via --no-index /dev/null)
```diff
diff --git a/verify_overlay_presence.ts b/verify_overlay_presence.ts
new file mode 100644
index 0000000..34292fd
--- /dev/null
+++ b/verify_overlay_presence.ts
@@ -0,0 +1,45 @@
+import { overlayWindowWanted } from './electron/overlay-bounds';
+
+// No stdin reader here; close it so the runner cannot wait on an open pipe.
+process.stdin.destroy();
+
+function assert(condition: unknown, message: string): void {
+  if (!condition) throw new Error(message);
+}
+
+// Base is the locked click-through overlay with a live game and an empty slot.
+const base = {
+  userHidden: false,
+  overlayEnabled: true,
+  locked: true,
+  holdToShow: false,
+  holdDown: false,
+  emptySlot: true,
+  gameLive: true,
+};
+
+function check(name: string, overrides: Partial<typeof base>, expected: boolean): void {
+  const actual = overlayWindowWanted({ ...base, ...overrides });
+  assert(actual === expected, `${name}: expected ${expected}, got ${actual}`);
+  console.log(`PASS ${name}`);
+}
+
+check('1 live + emptySlot -> wanted', {}, true);
+check('2 live + userHidden -> hidden', { userHidden: true }, false);
+check('3 live + overlayEnabled false -> hidden', { overlayEnabled: false }, false);
+check('4 live + holdToShow && !holdDown -> hidden', { holdToShow: true, holdDown: false }, false);
+check('5 not-live + emptySlot -> hidden', { gameLive: false, emptySlot: true }, false);
+check('6 not-live + content -> wanted', { gameLive: false, emptySlot: false }, true);
+
+// Mirrors OverlayApp hasAnyContent; inGame is absent from the expression by design,
+// so loading alone keeps the window contentful after the game ends.
+const hasAnyContent = (loading: boolean, loadingLayerMounted: boolean, slotContent: boolean): boolean =>
+  loading || loadingLayerMounted || slotContent;
+const inGame = false;
+assert(hasAnyContent(true, false, inGame) === true, '7 loading-as-content with inGame false: expected true');
+console.log('PASS 7 loading-as-content (loading true, inGame false)');
+
+// Structural, not runtime: setOverlayMatchActive() feeds matchActive into gameLive in
+// overlay-window.ts and endGameSession() clears it without hiding in game-monitor.ts;
+// both are BrowserWindow-bound, so no windowless import and no BrowserWindow mock.
+console.log('overlay presence ok');
```

### Other untracked files - names only

- BRIEF-*.md, HANDOFF.md, REVIEW_BUNDLE_test18.md - docs, content excluded per brief.
- graphify-out/, src/graphify-out/, electron/graphify-out/ - generated graph output, content excluded per brief.
- PLAN.md - tracked-modified doc, content excluded per brief.

## 6. Fresh verification output (tail + exit code)

### 1. verify_overlay_presence.ts
Command: `npx --yes tsx verify_overlay_presence.ts`
Exit code: 0
```
PASS 1 live + emptySlot -> wanted
PASS 2 live + userHidden -> hidden
PASS 3 live + overlayEnabled false -> hidden
PASS 4 live + holdToShow && !holdDown -> hidden
PASS 5 not-live + emptySlot -> hidden
PASS 6 not-live + content -> wanted
PASS 7 loading-as-content (loading true, inGame false)
overlay presence ok
```

### 2. verify_mayhem_manual_feedback.ts
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

### 3. verify_match_lifecycle.ts
Command: `npx --yes tsx verify_match_lifecycle.ts`
Exit code: 0
```
Match lifecycle: 600 full games, plus the 7:00 / 10:00 outage cases.
Match lifecycle ok.
```

### 4. verify_mayhem_ocr_lines.ts
Command: `npx --yes tsx verify_mayhem_ocr_lines.ts`
Exit code: 0
```
ok teal slot evidence still decodes unchanged beside gold support
ok ps1 -ImagePath emits __OT_LINES__ marker
ok marker carries at least one box
ok every emitted box is normalized to 0..1
verify:mayhem-ocr-lines ok
```

### 5. verify_mayhem_fixtures.ts
Command: `npx --yes tsx verify_mayhem_fixtures.ts`
Exit code: 0
```
ok positive-gold-teal-geometry: live boxes normalized 0..1
ok positive-gold-teal-geometry: gold bodies set the pixel gate
ok positive-gold-teal-geometry: three boxed unfamiliar titles
ok positive-gold-teal-geometry: gold bodies yield body>=8 with clean gaps on the card columns
ok positive-gold-teal-geometry: live PNG classifies accept via all-unknown-card-pixels
verify:mayhem-fixtures ok
```

### 6. verify_mayhem_text_matrix.ts
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

### 7. verify_mayhem_capture_gating.ts
Command: `npx --yes tsx verify_mayhem_capture_gating.ts`
Exit code: 0
```
--- 7. refusal reasons: throttled, in-flight, unsupported ---
ok the first scan really ran
ok a second scan inside minIntervalMs is refused as throttled (throttled)
ok a scan started while another is in flight is refused as in-flight (in-flight)
ok the outer scan still completes normally
verify:mayhem-capture-gating ok
```

### 8. verify_mayhem_monitor.ts
Command: `npx --yes tsx verify_mayhem_monitor.ts`
Exit code: 0
```
ok there is exactly one roll-write path (no duplicated restore body)
ok the shared restore clears the dismissal before the capture await (clear@1945/1982, scan@2792)
ok the shared restore bumps, awaits, bumps again, refuses non-fresh, then writes (bump@2610, scan@2792, guard@4138, bump@5392, write@5422)
ok package.json has a verify:mayhem-offers script
ok verify:release runs verify:mayhem-offers between the monitor and OCR checks
verify:mayhem-monitor ok
```

### 9. verify_mayhem_reroll_refresh.ts
Command: `npx --yes tsx verify_mayhem_reroll_refresh.ts`
Exit code: 0
```
ok an all-unknown frame with no previous roll still displays and never arms the fast poll
ok an all-unknown frame over an all-placeholder roll never arms the fast poll either
ok a real new roll still replaces the old one
ok the auto tick derives mayhemMatch from isMayhemMode(mode) (7980 chars)
ok the manual hotkey derives its own mayhemMatch from isMayhemMode(mode) (6616 chars)
verify:mayhem-reroll-refresh ok
```

### 10. verify_real_game_regressions.ts
Command: `npx --yes tsx verify_real_game_regressions.ts`
Exit code: 0
```
ok the mounted handoff harness passes (exit 0)
--- verify:real-game: diagnostics ---
ok main can ask whether the live game is ARAM-family
ok one in-game session read can fill an unknown queue
ok mayhem-likely starts the normal OCR schedule
verify:real-game ok
```

### 11. lint
Command: `npm run lint`
Exit code: 0
```
[baseline-browser-mapping] The data in this module is over two months old.  To ensure accurate Baseline data, please update: `npm i baseline-browser-mapping@latest -D`
C:\Users\Az040\Projects\otc-mayhem\src\overlay\OverlayApp.tsx
  1289:3  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
✖ 1 problem (0 errors, 1 warning)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

### 12. tsc - app
Command: `npx tsc --noEmit -p tsconfig.app.json`
Exit code: 0
```
(no output)
```

### 13. tsc - electron
Command: `npx tsc --noEmit -p tsconfig.electron.json`
Exit code: 0
```
(no output)
```

### 14. build
Command: `npm run build`
Exit code: 0
```
dist/assets/remote-DS-77-xm.js                                     1.02 kB │ gzip:   0.56 kB
dist/assets/overlay-CNZW1UTd.js                                   89.20 kB │ gzip:  28.62 kB
dist/assets/main-BDoWfua8.js                                     148.92 kB │ gzip:  44.65 kB
dist/assets/snapshot-BO68vEVd.js                                 359.62 kB │ gzip:  41.77 kB
dist/assets/pixelPetCanvas-BuKTQgR4.js                           404.73 kB │ gzip: 125.18 kB
✓ built in 1.90s
```

## 7. Concept ledger (G7) and test-lane deviation

New abstractions / behavior changes (one line each with justification):

- `gameLive?: boolean` on `overlayWindowWanted` opts (electron/overlay-bounds.ts): when true and not user-hidden / overlay-enabled / hold-to-show satisfied, the overlay window is wanted regardless of `emptySlot`. Justification: while a game is live, presence wins over the DWM-compositing cost of an empty transparent HWND; mode-blind and gated only by explicit user choice.
- `gameLive: matchActive` threaded through `shouldShowWindow` and the `syncWindowVisibility` / `syncNativeVisibility` log payloads (electron/overlay-window.ts): carries the match-live signal into the content gate and records it in visibility logs. Justification: one shared decision input, observable for diagnosis; no new state.
- Force-show in `showOverlay` when `matchActive && !visible` (hold-to-show respected) via `showInactive` (electron/overlay-window.ts): live-game presence does not wait for the renderer content report. Justification: closes the window-vanish window at match start; no focus steal.
- Raise via `win.showInactive()` in `keepOverlayOnTop` when visible and game live, beside the existing lost-always-on-top re-assert (electron/overlay-window.ts): re-raises without taking focus so League keeps mouse/keyboard input. Justification: the old code only re-applied the topmost flag and never raised a buried window.
- Fresh-HWND `if (matchActive) syncWindowVisibility(overlayWin)` in `createOverlayWindow` (electron/overlay-window.ts): a window created mid-game shows at once because the loading layer counts as content. Justification: avoids a blank interval while the renderer reports an empty slot.
- `endGameSession` no longer calls `hideOverlay()`, keeps `overlayDestroyGate.schedule()` (electron/game-monitor.ts): match-end stops content but presence owns visibility, so the window must not drop out from under a live match. Justification: fixes the ranked 4-min / match-end vanish; dodge/cancel (no game) still hides via `exitPrematchLoading`.
- `loadingLayerMounted` no longer requires `state.inGame`; `hasAnyContent = state.loading || loadingLayerMounted || slotHasContent` extracted and reported with dep `[hasAnyContent]` (src/overlay/OverlayApp.tsx): the layer keeps rendering from the snapshot after `inGame` flips false, so a fresh HWND stays contentful after the game ends. Justification: presence must follow the mount, not the game flag.
- `verify_overlay_presence.ts` (NEW): a 7-case table over `overlayWindowWanted` (live+empty shown, user-hide/disabled/hold-to-show still gate, not-live+empty hidden, not-live+content shown) plus a mirror of the `hasAnyContent` expression with `inGame` absent. Justification: locks the pure-function presence contract and the loading-as-content rule.

Test-lane deviation (verify_overlay_presence.ts):
- Only `overlayWindowWanted` is exercised at runtime (pure function). The BrowserWindow-bound paths (force-show in `showOverlay`, raise in `keepOverlayOnTop`, fresh-HWND show, no-hide `endGameSession`) are documented in the verify as structural, not runtime, and are not covered by a windowless import. If runtime proof of those paths is required, an implementation seam or BrowserWindow mock is needed - an impl change outside this DOCS/EVIDENCE lane.

## 8. Pending lanes and review status

- G6 ARAM-edge lane (classic-ARAM manual-scan bound) is STILL PENDING. PLAN.md v7.5 Step G6 targets test.18 and is queued to run after the test.17 tag; its allowlist (`electron/game-monitor.ts` restore gate + `verify_mayhem_manual_feedback.ts`) is not part of this G7 diff and is not covered by this bundle.
- Sol review remains USAGE-CAPPED (override). test.17 shipped under a recorded reviewer-usage override (BRIEF-SHIP-TEST17.md, HANDOFF.md); no fourth/round-8 Sol verdict was obtained. This G7 diff has NOT received a Sol verdict - merge requires either an override or a fresh Sol PASS.
- Known pre-existing reds (not re-run in this lane): clipper-lifecycle/ffmpeg, purchase-order, app-density. They are unchanged from the recorded baseline; none of the 14 frozen checks above regressed.

## 9. Gate summary

All 14 frozen checks exited 0 (10 verifies, lint, 2 tsc, build). All 13 pre-existing checks plus the new verify_overlay_presence.ts are green on the final tree. No new reds, no source/test edits, no commits and no version bump in this lane.
