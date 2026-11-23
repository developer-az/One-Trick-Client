# Master prompt — Opus: skinned game HUD over health/mana + abilities

## Paste this to Opus

> You are Opus, lead engineer and interface designer for **One Trick Client**, an Electron League of Legends companion overlay.
>
> **Mission:** the user's custom HUD skin does not appear over League's bottom-centre native HUD cluster (health bar, mana bar, abilities, summoner spells, items). Right now that area only gets a transparent calibration outline with corner brackets. Make the selected HUD skin actually skin that cluster — ornamental, readable, static, and non-interactive — without hiding the native bars, numbers, cooldowns or icons.
>
> **Repo:** `C:\Users\Az040\Projects\One-Trick-Client`
> **Branch:** `fix/overlay-aram-identity` (test.31 is the latest published build; branch from the current HEAD, which contains this brief).
> **Read first:** `docs/ai/HANDOFF.md`, `docs/ai/OPUS-MASTER-PROMPT.md` (this file), `src/overlay/ChromeGameHud.tsx`, `src/overlay/leagueGeometry.ts`, `src/overlay/hudSkins.ts`, `src/overlay/hudSkinOrnaments.tsx`, `src/overlay/hud-skins.css`, `src/overlay/OverlayApp.tsx` (`ChromeGameHud` call site), `src/index.css` (`.chrome-*`), `verify_layout.ts`, `verify_hud_geometry.ts`, `verify_hud_skins.ts`, `verify_overlay_bounds.ts`.
>
> **Do not** change ranked guardrails, overlay presenter/supervisor behaviour, the Mayhem pick logic from test.31, the `package.json` version, or frozen verify files. Add a new verify file instead.
>
> **Deliver:** implementation, a new `verify_game_hud_skin.ts` wired into `verify:release`, screenshot evidence for all 7 skins at 1920×1080 and at least 1366×768 + 2560×1440, `verify:release` green, a handoff entry, and test build `test.32`. Publish the pre-release without asking (standing rule), with the tag pointing at the commit.

---

## 1. What the user sees now

The bottom-centre area is **not skinned**. It is a native League HUD:

- champion portrait and level
- health bar and mana bar
- Q/W/E/R ability icons with cooldown sweeps
- summoner spell icons
- item slots
- the small level/stat text around them

The app currently draws:

- `src/overlay/ChromeGameHud.tsx`: a **transparent** `.chrome-frame-box` around the ability cluster and the minimap. It is a calibration aid: 1px border, corner brackets, edge ticks, optional dashed guides.
- `src/index.css` (`.chrome-frame-live`, `.chrome-frame-inner`): deliberately “corners-only (no filled rect) keeps the playable area open”.
- `src/overlay/hud-skins.css`: skins apply to `.ov-panel`, `.hud-overlay-panel`, `.hud-rail-card` only. **No rule targets the native HUD cluster.**
- `frames` module: controls the chrome, and is **off by default** (`DEFAULT_HUD_MODULES.frames === false`; `verify_layout.ts` pins that). Most users therefore see nothing at all there.

So selecting Gothic / Blood Moon / Arcane / Ironclad / Warden / Hunter / Vanguard changes the app's side panels but never the health/mana/ability area. That is the bug.

## 2. Required outcome

When the `frames` module is on (keep the default off; do not change `verify_layout.ts` unless product explicitly asks), and the overlay is not in align mode, the bottom-centre cluster gets a **real skin**:

- an ornamental perimeter and/or low-alpha backing in the active skin language,
- champion tint via the existing `--ov-skin-orn` / `--ov-champ` variables,
- the same corner/emblem ornament set used by the side panels (`HudSkinOrnaments`),
- a subtle health/mana surround and an ability plate that visually belong together,
- **no obscuring of the native content**: health/mana values, bar fills, ability icons, cooldowns, summoner spells and items stay fully readable,
- `pointer-events: none`; it never steals a click,
- fully static: no CSS animation, no `backdrop-filter`, no `filter: blur`, no per-frame layout reads,
- works in letterbox and pillarbox, HUD scale 0–100, and does not cover the minimap,
- align mode still shows the existing calibration guides and nudge controls,
- turning `frames` off removes it completely,
- compact panel, right rails, Mayhem augment panel and ranked behaviour are unchanged.

If the user wants the **bars themselves** replaced (custom-rendered health/mana values), that is a separate task. This task is a **skin around** the native cluster, not a reimplementation of League's HUD.

## 3. Root-cause map

| File | What it does now | Why it misses the area |
|---|---|---|
| `src/overlay/ChromeGameHud.tsx` | Renders transparent `.chrome-frame-ability` / `.chrome-frame-map` boxes from `computeLeagueGeometry` | Calibration frame only; no skin content, no fill, no ornaments, no health strip |
| `src/index.css` `.chrome-frame-live` | 1px border + faint inner gradient | Explicitly designed to leave the area open |
| `src/overlay/hud-skins.css` | 7 skin blocks, ornaments, panel paint | Selectors are `.ov-panel` / `.hud-overlay-panel` / `.hud-rail-card`; none target `.chrome-frame-ability` |
| `src/overlay/hudSkins.ts` | Registry, `auto` mapping, settings, `hudSkinVars` | Pure settings; no geometry |
| `src/overlay/leagueGeometry.ts` | `abilityW/H`, `abilityBottomPad`, minimap, letterbox | Already has the ability cluster box; no health strip / skin rects |
| `src/overlay/OverlayApp.tsx` | `showFrames = alignMode || (hudModules.frames && !compactPanel)`; renders `ChromeGameHud` | Only gate; no skin layer |
| `src/overlay/HudStudioCanvas.tsx` | Studio previews panels via `HudSkinPreview` | No game-HUD preview |

## 4. Implementation shape (recommended)

### 4.1 Pure layout module

Add `src/overlay/gameHudSkin.ts`:

```ts
export interface GameHudSkinRects {
  ability: { left: number; top: number; width: number; height: number };
  health: { left: number; top: number; width: number; height: number };
  surround: { left: number; top: number; width: number; height: number };
}

export function gameHudSkinRects(input: {
  geo: LeagueGeometry;
  calibration?: FrameCalibration;
  pad?: number;      // default ~10 * geo.s
  healthGap?: number; // default ~3 * geo.s
}): GameHudSkinRects;
```

Rules:

- `ability` must reproduce `ChromeGameHud`'s current math exactly:
  - `left = geo.offsetX + geo.gameViewW / 2 + cal.dx`
  - `top = geo.vh - (geo.displayBottomInset + geo.abilityBottomPad + cal.dy) - height` (or bottom-anchored CSS)
  - `width = geo.abilityW + cal.dw`
  - `height = geo.abilityH + cal.dh`
- `health` sits immediately above the ability box, roughly `0.86–1.0 × ability.width`, `18–24 × geo.s` tall, with a small gap. Tune against a 1920×1080 screenshot.
- `surround` contains both plus `pad`, clamped inside the game viewport.
- Everything scales with `geo.s`; no hard-coded 1080p pixels.

### 4.2 Component

Extend `ChromeGameHud.tsx` (preferred) or add `GameHudSkin.tsx` next to it:

- read the skin via `useHudSkinChrome()`; do not add a new context,
- when `showGuides` (align mode): render only the existing dashed guides/labels,
- when live (`enabled && !showGuides`): render the skin pieces:
  - health surround (top lip + side caps),
  - ability plate (top/bottom rails + side plates),
  - `HudSkinOrnaments` for corners/emblem,
  - optional skin-specific emblem or crest,
- keep `pointer-events: none` and `aria-hidden`,
- no new timers, no `ResizeObserver` per frame, no measuring text.

The simplest safe composition is a **perimeter**, not a filled panel:

```
health bar area
┌──────────────────────────────┐  top lip
│  native health / mana bars   │  (transparent)
├──────────────────────────────┤
│  native Q W E R / D F / items│  (transparent)
└──────────────────────────────┘  bottom lip
   side plate              side plate
```

If a backing is used, it must be a translucent plate **behind** the cluster (not over it) and low alpha (≤ 0.35), with a readability screenshot check.

### 4.3 CSS

Add a `.game-hud-skin` block to `src/overlay/hud-skins.css` (or a new `game-hud-skin.css` imported next to it). Reuse:

- `--ov-skin-orn`
- `--ov-skin-orn-scale`
- `--ov-skin-panel-alpha`
- `--ov-skin-radius`
- `--ov-skin-border-width`
- `--ov-skin-clip`
- `--chrome-frame-color`

Do **not** add `animation`, `transition`, `backdrop-filter`, `filter: blur`, `box-shadow` with large blur radii, or JS layout reads. `verify_hud_skins.ts` audits this file for static-only declarations.

### 4.4 Settings / preview

- Update the Frames module hint to “Game HUD + minimap frame/skin” so users know what it does.
- Add a small game-HUD preview to the skin settings card (`HudSkinPreview` area) so users can see the skin without a match. This is desirable but optional if time is tight.
- Do not change the `frames` default. `verify_layout.ts:18` pins it off.

## 5. Design spec per skin

Keep the existing voice: ink panels, chrome hairlines, static SVG marks, no gradients that read as glassmorphism.

| Skin | Health/mana surround | Ability plate | Signature |
|---|---|---|---|
| Gothic | ink-black side caps, chrome hairline | 1px chrome frame, top-left + bottom-right brackets | small chrome crest at top centre |
| Blood Moon | chamfered black plates, blood-red hairline | sharp chamfered corners, blade tips | thin red inner rule |
| Arcane | rune-ring corner marks, double hairline | violet/teal tint from champion | rune ring at each end |
| Ironclad | riveted top rail, stepped side plates | heavy 2px inner line | rivet dots along the top |
| Warden | rounded leaf-ended plates | soft rounded frame | leaf filigree sprigs |
| Hunter | crosshair corners, range ticks | flat matte plate | tick marks along the bottom lip |
| Vanguard | shield-crest header | bevelled corners | crest centred on the health lip |

All seven must be visibly distinct at a glance, but none may use a different layout box. Skins are decoration only.

## 6. Geometry and alignment

- Use `computeLeagueGeometry` (`src/overlay/leagueGeometry.ts`) for the ability box, letterbox offsets, HUD scale, and minimap.
- Reuse the existing `ability` calibration (`FrameCalibration`: `dx/dy/dw/dh`) so align mode nudges the skin with the frame. Do **not** add a third calibration target unless the health strip cannot be derived; if you do, update `OverlayCalibration`, `DEFAULT_CALIBRATION`, load/save, `adjustOverlayCalibration`, `main.ts`, `types.d.ts`, and the `NudgeGroup` UI in `OverlayApp.tsx`.
- Test 1366×768, 1920×1080, 2560×1440, 3440×1440; HUD scale 0, 20, 40, 60, 80, 100; map scale 0, 33, 100.
- The skin must not overlap the minimap at any scale.
- In align mode, the dashed guides and “Ability HUD / Minimap” labels remain; the skin may hide or drop to a faint guide.

## 7. Readability and performance gates

**Readability** — screenshot every skin with a synthetic League-like background:

- health and mana bar fills and text readable,
- ability icons and cooldown sweeps unobstructed,
- summoner spell and item icons unobstructed,
- no opaque pixel over the centre of the cluster,
- contrast of the skin's hairlines against the game background is visible but not distracting.

**Performance** — remember the native presenter renders this page offscreen:

- static paint only; no animation, no per-frame `getBoundingClientRect`, no `ResizeObserver` inside the skin,
- no `backdrop-filter` (it forces a readback and is banned by the skin rules),
- no large blurred shadows,
- memory/CPU no measurable change vs test.31 (use the existing perf checks if available).

## 8. Tests

Add `verify_game_hud_skin.ts` (new file; frozen verifies stay untouched):

1. **Geometry**
   - ability rect matches `ChromeGameHud`'s current math for a fixture calibration,
   - health rect is directly above and no wider than the ability rect,
   - surround contains both, padded, and clamps inside `offsetX..offsetX+gameViewW`,
   - 7 HUD scales × 4 resolutions, no negative/overflow rects,
   - no minimap overlap.
2. **Component source**
   - `ChromeGameHud` renders the skin only when `!showGuides`,
   - `pointer-events: none`,
   - `HudSkinOrnaments` is used,
   - no `ResizeObserver` / `getBoundingClientRect` in the skin path.
3. **CSS**
   - every skin id has a `.game-hud-skin[data-ov-skin='…']` block or inherits a documented default,
   - no `animation`, `transition`, `backdrop-filter`, `filter: blur`,
   - only paint variables / non-layout properties.
4. **Preview / wiring**
   - `OverlayApp` still renders `ChromeGameHud` under the same `showFrames` gate,
   - `frames` default stays off.

Wire it into `package.json`:

```json
"verify:game-hud-skin": "npx --yes tsx verify_game_hud_skin.ts"
```

and into the `verify:release` chain (after `verify:hud-skins` or near the overlay checks).

Run at minimum:

```powershell
npm run verify:layout
npm run verify:hud-geometry
npm run verify:hud-skins
npm run verify:overlay-bounds
npm run verify:overlay-handoff
npm run verify:ranked
npm run verify:mayhem-pick-selection
npm run verify:game-hud-skin
npm run verify:release
```

## 9. Acceptance criteria

- [ ] Frames on → the bottom-centre cluster is visibly skinned in the selected skin.
- [ ] Frames off → nothing is drawn there.
- [ ] Align mode → guides/nudges still work; skin is hidden or faint.
- [ ] Native health/mana bars, numbers, abilities, cooldowns, summoner spells and items remain readable.
- [ ] No click is captured; `pointer-events: none`.
- [ ] All 7 skins, Auto mapping, ornament toggle, champion tint and opacity/scale settings work.
- [ ] 1366×768 / 1920×1080 / 2560×1440 / 3440×1440 and HUD scale 0–100.
- [ ] No minimap overlap; no letterbox bleed.
- [ ] No animation / blur / backdrop-filter / per-frame layout read.
- [ ] `npm run verify:release` exits 0.
- [ ] Screenshots attached to the handoff.
- [ ] Test build `test.32` published, tag points at the commit.

## 10. Build and release (standing rule: publish test builds without asking)

```powershell
# verify first
npm run verify:release

# package
powershell -ExecutionPolicy Bypass -File scripts/package-test-build.ps1 `
  -Label game-hud-skin-32 `
  -Tag test-game-hud-skin-32 `
  -Version 1.7.1-test.32 `
  -NoPublish

# publish
gh release create test-game-hud-skin-32 `
  --prerelease `
  --target fix/overlay-aram-identity `
  --title "Test build test-game-hud-skin-32" `
  --notes-file "C:\Users\Az040\AppData\Local\Temp\opencode\otc-test32-notes.md" `
  "release/One.Trick.1.7.1-test.32.zip"

# make the tag point at the source commit, not the stale remote branch
git push origin fix/overlay-aram-identity
git tag -f test-game-hud-skin-32 <commit>
git push origin refs/tags/test-game-hud-skin-32 --force
```

Do not edit `package.json`’s `version`; the packaging script stamps `extraMetadata`.

## 11. Constraints / non-negotiables

- **Ranked guardrails:** do not change `detectMayhemMode` precedence, `resolveProfileId` non-ARAM path, `routeHotkey` non-ARAM branch, or `loadingStats` ranked scoping.
- **Overlay stability:** do not change the presenter `state` line, pipe-close-before-kill, or supervisor backoff/fallback.
- **Mayhem test.31:** do not regress the cards-gone purge, pick attribution, items rail coexistence, or item-gold line.
- **Frozen tests:** add a new verify file; do not edit existing `verify_*.ts` files.
- **No new dependencies** unless there is no alternative; justify in the handoff.
- **Static only:** no animation, blur, backdrop-filter, or per-frame layout reads.
- **Readability first:** when a design choice would obscure a native value, choose the less covering option.

## 12. Report back in this format

```
WHAT CHANGED
- files...
WHY IT WAS MISSING
- ...
SCREENSHOTS
- gothic 1920x1080, bloodmoon, arcane, ...
- 1366x768, 2560x1440, 3440x1440
GATES
- verify:release exit 0
- verify:game-hud-skin N checks
RISKS
- ...
RELEASE
- https://github.com/.../releases/tag/test-game-hud-skin-32
- tag -> <commit>
```

If a design decision is ambiguous (e.g. how much backing over the bars), pick the **least obscuring** option and note it for the user.
