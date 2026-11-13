# UI Master Prompt — One Trick frontend design brief

Reusable design brief for every UI task in this repo (dashboard views, overlay
HUD, HUD studio, marketing site). Give this whole file to the implementer (or
paste it into an agent chat) together with a one-line scope such as:

```
Scope: apply the UI master prompt to <view or component>. No new packages.
```

Precedence: `src/app/tokens.css` is the single source of truth for values.
Where this document, `docs/DESIGN.md`, or `tailwind.config.js` legacy keys
disagree with `tokens.css`, follow `tokens.css`.

---

## Pre-flight checklist (made before writing this brief)

Every item below maps to a rule section. Every rule has an actionable rule and
at least one example.

| # | Requested section | Rule(s) |
|---|-------------------|---------|
| 1 | Premium, dense "gothic glass" look | R1 |
| 2 | Token names and roles | R2 |
| 3 | Type scale | R3 |
| 4 | Spacing and card density | R4 |
| 5 | Borders, glass and blur limits | R5 |
| 6 | Motion and reduced-motion behavior | R6 |
| 7 | Anti-"airy" rules | R7 |
| 8 | Responsive rules | R8 |
| 9 | Accessibility rules | R9 |
| 10 | Semantic color meanings preserved | R10 |
| 11 | Game-performance constraint preserved | R11 |
| 12 | Applying to existing views without new packages | R12 |

---

## R1. Aesthetic target: premium, dense gothic glass

**Rule.** One Trick looks like gothic chrome jewelry over a darkroom tactical
HUD: ink-black surfaces, chrome silver for "yours", blood-red signature marks,
Cinzel display type over Inter UI type, razor-thin hairlines, bracketed card
corners, and dense information. Premium comes from precision and contrast —
crisp 1px lines, tabular numbers, perfect alignment — never from whitespace,
glow, gradients, or glassmorphism blur. "Glass" here means layered ink
translucency (alpha over ink), never `backdrop-filter`.

**Do.**

```tsx
<Card className="ot-card-pad">
  <h2 className="ot-card-heading">Win condition</h2>
  <p className="ot-muted text-sm mt-1">Snowball mid, hold Flash for the 14:00 fight.</p>
</Card>
```

**Don't.**

```tsx
<div className="rounded-3xl bg-gradient-to-br from-purple-900/40 backdrop-blur-xl p-12 shadow-2xl">
  <h2 className="text-4xl font-light tracking-widest">Win condition</h2>
</div>
```

The "don't" fails R1 (gradient + blur), R4 (p-12), R7 (4xl display, airy), and
R11 (backdrop blur).

---

## R2. Token names and roles

**Rule.** Consume tokens via `var(--ot-*)` (dashboard/website) or the
`--ov-*` family (in-game overlay, `src/overlay/overlay-theme.css`). Never
redefine a token in a component stylesheet, never hard-code a hex value that
exists as a token, and never use the legacy Tailwind color keys
(`pyke-green`, `gold`, `chrome-silver`, …) in new markup.

| Token | Role | Never use for |
|-------|------|---------------|
| `--ot-bg` | Deepest ground: window root, scroll gutters | Cards |
| `--ot-bg-raised` | App canvas behind pages (`.ot-main`) | Text |
| `--ot-surface` | Cards and panels | Page background |
| `--ot-surface-2` | Hovered surfaces, secondary panels, toasts, `kbd` | Large fills |
| `--ot-surface-3` | Active controls, inputs, scrollbar thumb | Cards |
| `--ot-border` | Default 1px hairline (cards, dividers) | Emphasis |
| `--ot-border-strong` | Interactive borders (buttons, inputs, items) | Decorative lines |
| `--ot-border-bright` | Emphasis: brackets, selected borders | Body structure |
| `--ot-text` | Primary copy and values | Dimmed captions (use `--ot-text-2`/`-3`), or essential data on `--ot-surface-3` without a contrast check |
| `--ot-text-2` | Secondary copy (`.ot-muted`) | Headings |
| `--ot-text-3` | Captions, faint metadata (`.ot-faint`) | Anything essential below 12px |
| `--ot-gold` / `--ot-gold-soft` | "Yours": authored, owned, best, selection wash | Enemy or generic highlight |
| `--ot-chrome` | Chrome bevel gradient: primary button, active switch | Backgrounds, text |
| `--ot-blood` / `--ot-blood-soft` | Signature ornament, execute threshold, critical threat | Body text, decoration on every card |
| `--ot-radius` / `-sm` / `-lg` | 6px cards & inputs / 5px chips / 10px toasts & menus | > 10px anywhere |
| `--ot-font` | UI copy, labels, values | Display headings |
| `--ot-font-display` | Cinzel: page titles, card headings, big numbers | Body copy |
| `--ot-font-mono` | Timers, hotkeys, code-like values (pair with `.ot-num`) | Prose |
| `--ov-text-scale` | Overlay-only text scale knob (1 = default) | Dashboard |

Overlay-only: `--ov-surface` (panel backing, see R5), `--ov-border`,
`--ov-text`, `--ov-text-2`, `--ov-gold` (authored highlight inside the HUD),
`--ov-blood`, `--ov-teal`, `--ov-red`, `--ov-amber`, `--ov-fs` (scaled type).

**Example (do / don't).**

```tsx
<span className="ot-muted ot-num">{gold}</span>          {/* do: token + tabular */}
<span style={{ color: '#a4a9b3' }}>{gold}</span>          {/* don't: hard-coded hex */}
<span className="text-gold">{gold}</span>                {/* don't: legacy Tailwind key */}
```

---

## R3. Type scale

**Rule.** Use exactly these steps. Sizes are the rendered sizes already used
by `src/app/theme.css`; new markup maps to them instead of inventing sizes.

| Step | Size / line | Weight | Face | Use | Existing class |
|------|-------------|--------|------|-----|----------------|
| Stat | 30px / 1.1 (-0.02em) | 650 | display | Hero numbers, grades | `.ot-stat-big` |
| Title | 26px / 1.15 (-0.015em) | 650 | display | Page titles (one per view) | `.ot-page-title` |
| H | 18px / 1.3 (-0.01em) | 600 | display | Card headings | `.ot-card-heading` |
| H-sm | 15px / 1.4 | 500 | body | Row titles, setting names | `text-[15px] font-medium` |
| Body | 14px / 1.5 | 450 | body | Prose, sub copy | `.ot-page-sub`, `.ot-muted text-sm` |
| Label | 13px / 1.4 | 600 | body | Buttons, values, rows | `.ot-btn`, `.ot-spell` |
| Eyebrow | 13px / 1.2 (+0.06em, uppercase) | 600 | body | Section labels in `--ot-text-3` | `.ot-card-title` |
| Small | 12px / 1.3 | 600 | body | Table headers, kbd, captions | `.ot-kbd`, `text-xs` |
| Micro | 11px / 1.25 | 500–700 | body/mono | Timestamps, meta only | `text-[11px]` |

Hard limits: nothing below 11px in the dashboard (overlay micro sizes scale
through `--ov-fs` and never go below 7px for 2–3 character tags only); at most
one display-family heading level per card region; numbers are `display` only
when they are the headline metric (`.ot-stat-big`), otherwise body face with
`.ot-num` (tabular-nums); timers and hotkeys use `--ot-font-mono` or
`.ot-num`. Prose measure caps at `max-w-xl` / `max-w-2xl` (~60–72ch).

**Example (do / don't).**

```tsx
<div className="ot-stat-big ot-num">{dominance.grade}</div>   {/* do: 30px display number */}
<div className="ot-card-title mb-2">Win condition</div>       {/* do: 13px uppercase eyebrow */}
<h2 className="text-3xl font-extrabold">Win condition</h2>   {/* don't: 30px body-face heading */}
```

---

## R4. Spacing and card density

**Rule.** A 4px base unit with 2px half-steps for chrome. Allowed values:
`2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 48` px. Density is the
default: prefer two or more content columns and 8–10px row padding over tall
single columns with big paddings.

| Region | Value | Existing class / rule |
|--------|-------|----------------------|
| Page | `28px 32px 48px`, `max-width: 1180px`, centered | `.ot-page` |
| Page header → first card | 22px | `.ot-page-header` (`margin-bottom: 22px`) |
| Card padding | `18px 20px` | `.ot-card-pad` |
| Hero card inner | ≤ 24px vertical | `.ot-hero` + `py-2` block |
| Card → card | 20px (`gap-5` / `mb-5`) | grid utilities |
| Two-column grid gutter | 20–24px (`gap-5` / `gap-6`) | `grid gap-5 md:grid-cols-2` |
| Setting / list row | `py-2`–`py-3.5` with 1px divider | `.ot-spell` 30px row, `SettingRow` |
| Control cluster | 6–10px (`gap-2` … `gap-2.5`) | `.ot-segment` 2px, chips 6px |
| Empty state | `py-12 px-6` max, one heading + one action | `EmptyState` in `src/app/ui.tsx` |

Card anatomy is fixed: eyebrow (`.ot-card-title`) or heading
(`.ot-card-heading`) → content rows → optional divider. Every card shows at
least one content row; never ship a card that is only whitespace and a title.

**Example (do / don't).**

```tsx
<div className="grid gap-5 sm:grid-cols-3 mb-5">…</div>        {/* do: 20px gutters, dense grid */}
<div className="grid gap-12 p-10 max-w-4xl">…</div>            {/* don't: airy gutters + padding */}
```

---

## R5. Borders, glass and blur limits

**Rule.**

- Hairlines are 1px only: `--ot-border` for structure, `--ot-border-strong`
  for interactive elements, `--ot-border-bright` for emphasis. The only 2px
  lines allowed are the keyboard-hint bottom border (`.ot-kbd`) and the focus
  ring (`box-shadow: 0 0 0 2px rgba(212, 216, 222, 0.25)`).
- Signature ornament: bracketed card corners (the 10px L-marks implemented by
  `.ot-card::before/::after` and `.hud-overlay-panel::before/::after`) and
  thin static gradient rules (`.ot-titlebar` border-image). Ornament is thin,
  static, and silver — never neon.
- Glass = alpha ink over ink. Dashboard surfaces stay fully opaque; "depth"
  comes from the surface ladder plus `-soft` washes at alpha ≤ 0.15. Overlay
  panels use `--ov-surface` / `rgba(8, 8, 11, 0.92)` with an **alpha floor of
  0.80** so text reads over any map area; tag backings may go to 0.96. The
  only translucent-into-game surface class is the HUD panel family, and it
  must stay ≥ 0.80 opaque.
- Blur budget: **zero**. `backdrop-filter` is banned everywhere (`src/`,
  `electron/`, `website/`). `filter: blur()`, `drop-shadow()`, and `text-shadow`
  glows are banned. The only `filter` allowed is static hover brightness on
  chrome (e.g. `filter: brightness(1.08)` on `.ot-btn-primary:hover`).
- Shadow budget: elevation shadows only, black, ≤ 2 layers, ≤ 40px spread
  (`0 16px 36px rgba(0,0,0,0.45)` toasts, `0 18px 40px rgba(0,0,0,0.5)`
  menus, `0 4px 14px rgba(0,0,0,0.45)` overlay panels). One colored glow is
  permitted for a critical "pick/alarm" state only: ≤ 10px blur, alpha ≤ 0.4
  (see `.hud-buy-next .hud-buy-icon.is-next`).

**Example (do / don't).**

```css
/* do: opaque card, hairline, bracket corners from .ot-card */
.ot-card { border: 1px solid var(--ot-border); background: var(--ot-surface); }
/* do: overlay glass = alpha, no blur */
.hud-overlay-panel { background: rgba(8, 8, 11, 0.92); }
/* don't */
.glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(18px); border-radius: 24px; }
```

---

## R6. Motion and reduced-motion behavior

**Rule.** Motion is feedback, never ambience.

| Allowed | Budget | Existing example |
|---------|--------|------------------|
| Hover/press transitions (`background`, `color`, `border-color`, `opacity`, `transform`) | 120–150ms ease | `.ot-nav`, `.ot-btn` (0.12s), `.ot-switch` (0.15s) |
| Toast entrance (`opacity` + `translateY(6px → 0)`) | 180ms ease-out, once | `ot-toast-in` |
| View switch | 150ms `cubic-bezier(0.2, 0, 0, 1)` | `::view-transition-old/new(root)` |
| Overlay panel open/close (`opacity`, `translateY ≤ 4px`) | ≤ 150ms | `docs/DESIGN.md` motion budget |

Banned: infinite or looping animation of any kind, scroll-driven animation,
animating `width/height/top/left/margin/filter/box-shadow`, stagger reveals
inside Electron views, spring overshoot > 4px, any transition > 200ms in the
app or overlay, and any animation in the overlay while a match is live beyond
the panel open/close above. The one-shot `fadeIn`/`slideIn` entrances in
`src/index.css` (web/studio layer) are grandfathered, already disabled under
`prefers-reduced-motion`, and hidden in the overlay — do not use them in new
Electron views or the HUD.

Every animated rule must have a zero-duration fallback:

```css
.ot-toast { animation: ot-toast-in 0.18s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .ot-toast { animation: none; }
  .ot-switch, .ot-switch::after, .ot-nav, .ot-btn { transition: none; }
}
```

JS-driven motion (timers, canvas, view transitions) gates on
`window.matchMedia('(prefers-reduced-motion: reduce)').matches` and renders
its static end state when true. View transitions already do this via the
`animation: none !important` override in `theme.css`.

**Example (don't).**

```css
@keyframes pulse { 50% { opacity: 0.6; } }
.ot-live-dot { animation: pulse 1.2s infinite; } /* banned: loop + opacity ambience */
```

---

## R7. Anti-"airy" rules

**Rule.** Whitespace is not a design goal; clarity per square inch is. Each
ban below is numeric so it can be checked in review.

1. **No oversized padding.** Card padding ≤ 20px (`ot-card-pad`), page padding
   ≤ 32px sides / 48px bottom, empty states ≤ `py-12 px-6`. Do
   `padding: 18px 20px`; don't `padding: 48px`.
2. **No oversized gaps.** Related cards are 20px apart; sections 24px apart
   max. Do `grid gap-5`; don't `space-y-16`.
3. **No fake rhythm.** Never use `min-height`, empty spacers, or `<br/>` to
   create space. Don't `<div className="h-24" />`.
4. **No display type > 30px**, no `text-4xl` and up, no `font-light` display
   headings. Do `.ot-page-title` (26px); don't `text-5xl font-thin`.
5. **No dead cards.** Every card has a heading and ≥ 1 data row; empty states
   are one line + one action ("No clips saved yet." pattern in
   `PerformanceView`), never a big illustration.
6. **No marketing layout in the app.** Content is left-aligned inside the
   sidebar shell; heroes carry a status pill, a title, and one CTA (HomeView
   pattern), and no hero exceeds one third of the viewport height.
7. **No decorative gradients or blobs.** Gradients allowed: `--ot-chrome`
   bevel, the single static blood wash on `.ot-main` (alpha 0.07), and
   hairline rules. No background gradients behind text.
8. **No emoji or stock illustration.** Ornament vocabulary is exactly:
   hairlines, bracket corners, Cinzel, chrome silver, blood marks, existing
   SVG icons from `src/app/icons.tsx`.
9. **No naked metrics.** Every number carries a label; never show a bare
   percentage or a fabricated metric (never show a win rate — see R10).
10. **No light theme, no white cards, no pastel.** The ink ladder is the only
    ground.

**Example (do / don't).**

```tsx
<Card><CardHeader title="Budget" /><p className="ot-muted text-sm">Under budget right now.</p></Card>  {/* do */}
<Card className="min-h-[320px] flex items-center justify-center"><p className="text-5xl">…</p></Card>  {/* don't */}
```

---

## R8. Responsive rules

**Rule.**

- App shell: `grid-template-columns: 224px 1fr`, `height: 100vh`, page
  content `max-width: 1180px` centered in `1fr`. Content grids collapse with
  the existing Tailwind breakpoints: `sm:grid-cols-2/3` (≥ 640px),
  `md:grid-cols-2` (≥ 768px), `lg:grid-cols-2/5` (≥ 1024px); below `sm` all
  grids stack to one column. Copy the pattern already in `PerformanceView`
  (`grid gap-5 sm:grid-cols-3`, `grid gap-5 lg:grid-cols-2`).
- Overflow discipline: every flex/grid child that can shrink carries
  `min-width: 0`; long names `truncate`; right-hand values and buttons
  `shrink-0` (see `PerformanceView` clip rows). No horizontal scrolling at
  any window size; long tables scroll inside their card (`max-h-56
  overflow-y-auto`).
- Narrow widths reduce gutters before they reduce content: page sides fall
  to 16px (`px-4` on the `.ot-page` child or a media rule in `theme.css`),
  never below 12px.
- Overlay: HUD geometry is fixed by `src/overlay/hudLayout.ts`; type scales
  only through `--ov-fs` / `--ov-text-scale` so layout coordinates stay
  stable. Rows are flex with `min-width: 0`, the right-hand price/label
  column is `flex-shrink: 0`, and panels keep safe right padding. Verify
  layouts at 1080p and 1440p and at 100% / 125% / 150% Windows scaling —
  `hudLayout` coordinates are physical pixels; text may never be clipped at
  the right edge.

**Example (do / don't).**

```tsx
<div className="grid gap-5 lg:grid-cols-5">…</div>                    {/* do: collapses < lg */}
<span className="min-w-0 truncate">{clip.name}</span>                {/* do: overflow-safe */}
<span className="shrink-0">{formatClipSize(clip.bytes)}</span>
<div className="w-[1180px]"><span>{name}</span></div>                 {/* don't: fixed width, no shrink */}
```

---

## R9. Accessibility rules

**Rule.**

- Contrast: primary text `--ot-text` on its surface ≥ 7:1; secondary
  `--ot-text-2` ≥ 4.5:1; `--ot-text-3` only for non-essential meta at ≥ 12px.
  Never essential data as `--ot-text-3` on `--ot-surface-3`.
- Focus: any new interactive class joins the existing focus rule
  (`.ot-btn:focus-visible, .ot-nav:focus-visible, .ot-input:focus-visible,
  .ot-switch:focus-visible, .ot-chip-btn:focus-visible { box-shadow: 0 0 0 2px
  rgba(212, 216, 222, 0.25); }`). Never `outline: none` without a visible
  replacement.
- Semantics: real `<button>`, `<table>` with `<th scope>`, `<dl>/<dt>/<dd>`
  for key-value rows (see `PerformanceView`), headings in order
  (`h1` page → `h2` card). Switches keep `role="switch"` +
  `aria-checked`; ornamental art and splashes keep `aria-hidden` and
  `alt=""`; meaningful icons/champion art get the entity name as `alt`.
- Never state-by-color alone: every `--ot-*` semantic color ships with a
  text label, dot, or icon (`Pill` + `.ot-dot`, `.ot-badge-*` with text,
  `.ot-spell.is-ready/.is-down` with labels).
- Keyboard: every action tab-reachable; comboboxes keep their listbox
  keyboard handling and `.is-active` highlight; `.ot-kbd` hints are
  supplementary, never the only affordance.
- Targets: primary controls ≥ 30px tall (`.ot-btn`, `.ot-spell`); `.ot-btn-sm`
  (~26px) only inside dense rows.
- Motion and text scale: honor `prefers-reduced-motion` (R6) and
  `--ov-text-scale` (every overlay panel reads it).
- Text over art: splash art sits behind content (`.ot-splash`, opacity 0.35
  with a mask); keep copy over the card surface or on an ink scrim ≥ 0.6
  alpha — never raw text on the splash.

**Example (do / don't).**

```tsx
<span className="ot-badge ot-badge-teal">Ready</span>       {/* do: color + word */}
<span className="block w-2 h-2 rounded-full bg-teal" />     {/* don't: color-only state */}
<button className="ot-btn" />                               {/* do: focus-visible rule applies */}
<button style={{ outline: 'none' }} />                      {/* don't */}
```

---

## R10. Semantic color meanings (fixed, never decorative)

**Rule.** These meanings are identical in the dashboard, overlay, and website.
Changing one requires changing the token meaning everywhere — never re-map a
semantic color to make a screen look nicer.

| Color | Means | Example use | Never |
|-------|-------|-------------|-------|
| `--ot-teal` / `--ov-teal` | live, good, ready | `.ot-spell.is-ready`, connected dot | Decoration, "yours" |
| `--ot-red` / `--ov-red` | enemy, danger, down | `.ot-spell.is-down`, danger callout | Ally, ornament |
| `--ot-blue` / `--ov-blue` | ally | ally summoner ring, friendly state | Enemy, links |
| `--ot-amber` / `--ov-amber` | caution, short window | `.ot-callout-warn`, short-timer chips | Generic highlight |
| `--ot-blood` / `--ov-blood` | signature ornament, execute threshold, critical threat | titlebar rule, spike cue | Body text, routine UI |
| `--ot-gold` / `--ov-gold` | "yours": authored, owned, best | authored badge, selection ring | Enemy or neutral data |

Data integrity rides with color: never fabricate metrics or show win rates
(`verify_no_winrate_claims` enforces this in code and copy), and never shade a
number green/red to imply a verdict the data does not support.

**Example (do / don't).**

```tsx
<Badge tone="teal">Ready</Badge>        {/* do: ready state */}
<Badge tone="teal">New</Badge>          {/* don't: teal used decoratively */}
<span style={{ color: '#b4243a' }}>Buy</span>  {/* don't: blood for routine copy */}
```

---

## R11. Game-performance constraint (non-negotiable)

**Rule.** The overlay runs beside League of Legends. Budgets:
**< 3% average CPU, < 150 MB RAM, < 1% FPS impact**, and the overlay stays
100% click-through (`setIgnoreMouseEvents`, no input capture ever). Any UI
change that costs frames is wrong regardless of how it looks.

Forbidden in `src/`, `electron/`, `website/` UI code:

- `backdrop-filter`, `filter: blur()/drop-shadow()`, animated `filter`;
- continuous/looping animation, scroll listeners that style, per-frame JS,
  canvas redraw loops (a canvas element redraws only on state change);
- layout-thrash patterns: animating geometry properties, un-sized images,
  `box-shadow` stacks, `will-change` on many elements;
- heavy runtimes (3D, shaders, chart engines) in the overlay window.

Rendering discipline: state-driven repaints only (the paint throttle and
dirty-rect path already exist — do not bypass them), `contain: layout paint`
on overlay panels, images with fixed dimensions, and no new work per HUD tick.

**Example (do / don't).**

```css
/* do: static panel, compositor-friendly, repaint-isolated */
.hud-overlay-panel { background: rgba(8, 8, 11, 0.92); contain: layout paint; }
/* don't: GPU blur + loop while League renders */
.hud-overlay-panel { backdrop-filter: blur(12px); animation: float 3s infinite; }
```

Gates that must stay green after any UI change: `npm run verify:perf-budget`,
`npm run verify:layout`, `npm run verify:overlay-layout-edges`,
`npm run verify:overlay-bounds`, `npm run verify:hud-geometry`.

---

## R12. Applying this brief to existing views (no new packages)

**Tooling policy.** The repo already has everything: Tailwind 3 utilities,
`src/app/tokens.css`, `src/app/theme.css` (`.ot-*` system), `src/app/ui.tsx`
primitives (`Card`, `CardHeader`, `Pill`, `Badge`, `Switch`, `SettingRow`,
`Portrait`, `Item`, `EmptyState`), `src/app/icons.tsx` SVGs, self-hosted
`@fontsource` faces, and `src/overlay/overlay-theme.css` (`--ov-*`). **No new
dependencies, no CSS-in-JS, no icon/chart/animation packages, no new fonts.**
If a style is needed twice, add a class to `theme.css` (or
`overlay-theme.css` for the HUD); if once, use a Tailwind utility; never
redefine tokens outside `tokens.css` / `overlay-theme.css`.

**Change recipe (per view or component).**

1. **Token audit** — replace hard-coded hex/rgba and legacy Tailwind color
   keys with `var(--ot-*)` / `var(--ov-*)`.
2. **Density pass** — map gaps to the R4 scale (`gap-5` grids, 20px card
   stack, 18/20 card padding, 8–10px rows).
3. **Type pass** — map every `text-*` class to an R3 step; headings to
   `ot-page-title` / `ot-card-heading` / `ot-card-title`.
4. **Border & ornament pass** — hairlines per R5, bracket corners on cards
   (free with `.ot-card`), no new glows.
5. **Motion pass** — transitions 120–150ms on the allowed properties only,
   each with a `prefers-reduced-motion` fallback; nothing looping.
6. **A11y pass** — R9 contrast, focus-visible, semantics, label-paired state.
7. **Gates** — run the R11 verifies plus `npm run lint` and
   `npx tsc -p tsconfig.app.json --noEmit`.

**Per-view application map.**

| View | Files | Apply this brief by |
|------|-------|---------------------|
| Home | `src/app/views/HomeView.tsx`, `OneTrickCard.tsx` | Keep the `ot-hero` pattern (status `Pill` + `ot-page-title` + one CTA over the scrimmed `.ot-splash`); stat blocks use `.ot-stat-big` + `.ot-num`; card stack 20px; CTA is `ot-btn-primary` (chrome bevel) with a plain `ot-btn` secondary |
| Draft | `src/app/views/DraftView.tsx` | Two-up `grid gap-5 md:grid-cols-2` grids; `ot-card-heading text-xl` stays 20px (upper bound of H step); grade column `.ot-stat-big ot-num`; numbered lists `ot-num ot-faint w-4` index column; `ot-card-title` eyebrows at `mb-2` |
| Loadout | `src/app/views/LoadoutView.tsx` | Dense `grid gap-5 lg:grid-cols-5` item grids with `.ot-item` squares and 8px row padding; rune rows use `.ot-rune` / `.ot-rune-keystone`; keystone name is `ot-card-heading`, everything else `text-[15px] font-medium`; dividers `--ot-border` |
| Overlay | `src/app/views/OverlayView.tsx` (settings), `src/overlay/*` (HUD) | Settings: `SettingRow` + `Switch`, `grid gap-x-8 md:grid-cols-2`, values `ot-muted ot-num`. HUD: `--ov-*` tokens only, `.hud-overlay-panel` at alpha ≥ 0.80 with bracket corners, sectioned left rail (Summoners / Cooldowns / Objectives) with hairline dividers, rows `min-width: 0` + `flex-shrink: 0` value column, zero motion and zero blur (R6/R11), type via `--ov-fs` |
| Performance | `src/app/views/PerformanceView.tsx` | `grid gap-5 sm:grid-cols-3` stat cards; budget warnings `ot-callout ot-callout-warn`; dense tables (`text-sm`, `py-1.5` rows, `ot-faint text-xs uppercase tracking-wide` headers, `ot-num` for numbers); empty states are one line + optional action |

---

## Definition of done (any UI task under this brief)

1. Every touched screen passes the R7 anti-airy checks and the R9 a11y
   checklist by inspection.
2. `grep -rn "backdrop-filter\|blur(" src website/src` and
   `grep -rn "@keyframes\|drop-shadow" src` show **no new hits** beyond the
   grandfathered baseline: `ot-toast-in` and `filter: brightness(1.08)` in
   `src/app/theme.css`; `fadeIn`/`slideIn` one-shots and the small
   `drop-shadow` glows on `.hud-corner`/`.hud-panel-mark` in `src/index.css`
   (web/studio layer — disabled under reduced motion and hidden inside the
   overlay). Any other `filter`, `blur(`, `backdrop-filter`, or new keyframes
   fail review under R5/R6/R11.
3. R11 gates green: `npm run verify:perf-budget`, `npm run verify:layout`,
   `npm run verify:overlay-layout-edges`, `npm run verify:overlay-bounds`.
4. `npm run lint` and `npx tsc -p tsconfig.app.json --noEmit` clean.
5. Layout sanity at 1080p/1440p and 125%/150% scaling (headless render or
   structural review where no display is available).

---

## Appendix: current-view conformance snapshot (2026-11)

Structural review of the shipped screens against this brief (source-level;
no browser is available in the authoring sandbox, so this is a code/structure
review, not a screenshot review):

| Screen | Verdict | Notes |
|--------|---------|-------|
| Home | Conforms | `ot-hero` + pill/title/CTA, `gap-6` hero row, `mb-5` stack; splash already masked (0.35) per R9 |
| Draft | Conforms | `gap-5`/`gap-6` two-up grids, `ot-stat-big` grade, eyebrow labels; `text-xl` heading is at the H-sm ceiling (allowed) |
| Loadout | Conforms | `gap-5` dense 5-col grid, `.ot-item`/`.ot-rune` chrome, tabular numbers |
| Overlay | Conforms | HUD panels `rgba(8,8,11,0.92)` ≥ 0.80 floor, `contain: layout paint`, no blur/keyframes, `--ov-fs` type scaling, `min-width: 0` rows |
| Performance | Conforms | `gap-5 sm:grid-cols-3`, dense `py-1.5` tables, `ot-callout-warn`, one-line empty states |

Known token nits to keep in mind when editing (do not "fix" in passing):
`docs/DESIGN.md` and `tailwind.config.js` still carry legacy names/values
(`--ot-chrome-silver`, `--ot-gold: #e8b84a`, `pyke-*` keys) that predate
`tokens.css`; `tokens.css` wins per the precedence rule at the top.