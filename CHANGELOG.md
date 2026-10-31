# Changelog

## 1.7.0

- New visual pass for the companion app: refined theme, bracketed card markers, tactile button states, and smoother view changes using View Transitions. No added bundle size or overlay cost.
- HUD Studio canvas: the module scale slider now drives the layout and the exported JSON, pins on the right rail stay inside the stage and keep their grab offset while dragging, arrow keys nudge the focused pin, and the stage pans on small screens. It uses the real Summoner's Rift map and the correct Yone keystone icon.
- Website: live client preview in the hero, interactive doctrine card (Pyke, Pantheon, Yone), summoner-timer demo, comparison table, self-hosted fonts (no Google Fonts requests), lighter header without backdrop blur, and readable download buttons.

## 1.6.5

- Performance lists the newest saved clips first. The clip folder is sorted by modification time before the 200-file cap, and the 4 second refresh reads the folder without blocking the app.
- Windows builds now carry the GPL-3.0 notice for the bundled FFmpeg 6.1.1 binary in INSTALL.txt, the about screen, and THIRD_PARTY_NOTICES.txt.
- The key-injection test script stays out of the packaged app. The packaging check fails the build if it is included.
- Pull request commits are rejected when they carry Cursor or Claude attribution trailers.

## 1.6.4

- The Windows build bundles FFmpeg so Auto-clip can save videos without a separate install.
- Performance lists match clips. Empty overlay windows and full event rescans no longer hitch League.
