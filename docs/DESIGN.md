# Design Contract: One Trick

## Brief

- **Project:** One Trick (Electron companion app + transparent in-game overlay in `src/`, marketing site + web HUD studio in `website/`).
- **Feels like:** Gothic Chrome Hearts silver jewelry meets high-precision aerospace / darkroom tactical HUD. Cold metallic silver rules, deep obsidian ink surfaces, razor-thin hairline borders, sharp contrast, zero visual clutter.
- **Signature set piece:**
  - *Website / Studio:* Interactive live HUD Studio stage preview with authentic League of Legends HUD geometry and module pinning.
  - *Electron Client & Overlay:* The instantaneous transparent click-through HUD overlay with zero-delay summoner tracking and the gothic chrome matchup draft board.
- **Audience:** Competitive League of Legends players (one-tricks, ranked climbers) who need instant tactical clarity without screen occlusion, input delay, or in-game FPS drops.
- **Must not:**
  - Never use generic AI tropes: purple/blue gradients, glow borders, glassmorphism (`backdrop-filter: blur` destroys DWM compositing and drops League FPS), floating blobs, or buzzword copy.
  - Never run unthrottled animation loops, heavy live CSS filters (`blur`, `drop-shadow`), or canvas redraws during gameplay or scroll.
  - Never inject heavy 3D runtimes into the in-game overlay.
  - Never fabricate metrics, synthetic win rates, or fake data charts.
- **Product truth:**
  - The in-game overlay must remain 100% click-through and never intercept mouse or keyboard inputs intended for the game.
  - Performance is non-negotiable: <3% average CPU usage, <150 MB RAM, and <1% FPS impact on League of Legends.
  - Champion data and builds for Pyke, Pantheon, and Yone reflect authored matchup doctrine; all other champions derive honestly from the live Data Dragon / Community Dragon API catalog.

---

## Token System

Tokens are defined on `:root` and shared across surfaces.

### Surfaces (Elevation)
| Token | Value | Role |
|---|---|---|
| `--ot-bg` / `--chrome-ink` | `#0a0a0c` | Deepest ground / void |
| `--ot-bg-raised` | `#0d0d10` | App root canvas |
| `--ot-surface` / `--chrome-panel`| `#121216` | Cards, elevated containers |
| `--ot-surface-2` | `#18181d` | Hovered surfaces, secondary panels |
| `--ot-surface-3` | `#212127` | Active controls, inputs |
| `--ov-surface` | `rgba(9, 9, 11, 0.88)` | Overlay panel base (opaque enough for readability, no blur) |

### Borders & Hairlines
| Token | Value | Role |
|---|---|---|
| `--ot-border` | `rgba(214, 219, 228, 0.08)` | Default card border |
| `--ot-border-strong` | `rgba(214, 219, 228, 0.16)` | Focused / active border |
| `--ot-border-bright` | `rgba(214, 219, 228, 0.32)` | Accented border / bracket ticks |
| `--chrome-rule` | `linear-gradient(90deg, transparent, rgba(212,216,222,0.45) 20%, rgba(212,216,222,0.45) 80%, transparent)` | Gothic horizontal divider |

### Typography
| Token | Face | Role |
|---|---|---|
| `--ot-font-display` | `Cinzel, Palatino Linotype, Georgia, serif` | Section headers, champion names, major ranks |
| `--ot-font` | `'Inter Variable', 'Segoe UI Variable', system-ui, sans-serif` | Core UI copy, values, labels |
| `--ot-font-mono` | `ui-monospace, 'IBM Plex Mono', 'Cascadia Mono', monospace` | Timers, cooldowns, stats, hotkeys |

### Brand & Accents
| Token | Value | Role |
|---|---|---|
| `--ot-chrome-silver` | `#d4d8de` | Authored / owned signal, primary high-contrast chrome |
| `--ot-chrome-bright` | `#f2f4f7` | Highlighted text, active selection |
| `--ot-chrome-dim` | `#8a919c` | Secondary labels, disabled states |
| `--ot-blood` | `#b4243a` / `#9b1c2e` | Signature gothic ornament, execute threshold, critical threat |
| `--ot-gold` | `#e8b84a` | Key badges, champion mastery, ranked tier highlights |

### Semantics (Functional Only, Never Decorative)
| Token | Value | Role |
|---|---|---|
| `--ot-teal` | `#35d0ba` | Live connection, spell ready, safe gank window |
| `--ot-red` | `#f0656a` | Danger, enemy Flash spent / cooling down, high threat |
| `--ot-amber` | `#f2b350` | Warning, yellow gank alert, short window |
| `--ot-blue` | `#6aa6f8` | Ally spells, friendly team state |

---

## Motion Budget & Stack

Follows `~/.agents/SKILLS-ROUTING.md`:

1. **Overlay Motion Budget:**
   - **Zero** continuous animations, pulsing effects, or CSS keyframe loops during live gameplay.
   - Panel open/close transitions: `opacity` and subtle `translateY` (max 4px), strictly ≤ 150ms.
   - Respect `prefers-reduced-motion` immediately with zero-duration fallback.
2. **Dashboard / Web Motion Budget:**
   - Native View Transitions API or lightweight CSS transitions for tab switches.
   - If interactive animations are required: use `LazyMotion` (`m` components) or CSS hardware-accelerated transforms (`translate3d`, `opacity`).
   - Scroll reveals: single shared `IntersectionObserver` setting a data-attribute, styling handled via pure CSS `transform`/`opacity`.
   - Never use `backdrop-filter: blur()`. Never scale containers with nested images or text.
   - Smooth scroll: Lenis on web marketing pages only; strictly disabled (`data-lenis-prevent`) inside HUD studio, tables, inputs, and all Electron views.

---

## Product & Performance Invariants

1. **Lightweight First:**
   - In-game overlay CPU budget: `< 3%` CPU average.
   - Overlay memory budget: `< 150 MB` RAM.
   - Framerate impact: `< 1%` drop on League of Legends client.
2. **Input Isolation:**
   - In-game overlay window uses `setIgnoreMouseEvents(true, { forward: true })` whenever the user is interacting with League.
   - Hotkeys (PageUp/PageDown, Numpad 9/3) handled by read-only low-level Windows keyboard hook (`onetrick-keys.exe`), never injecting keystrokes into League.
3. **Data Integrity:**
   - Honest data: Pyke, Pantheon, and Yone loadouts reflect authored doctrine. All other champion guides pull directly from Riot Data Dragon / Community Dragon APIs. No fabricated win rates.

---

## Shipped Implementation & Visual Audit

1. **Art Direction & Self-Hosted Typography:**
   - Bundled `@fontsource/cinzel`, `@fontsource-variable/inter`, and `@fontsource/ibm-plex-mono` directly into website and Electron distributions.
   - Removed all external network links to `fonts.googleapis.com` across all website pages.
2. **AI Trope Elimination (Aura-Farming):**
   - Removed GPU-stuttering `backdrop-blur` from `SiteHeader.tsx`; converted to high-contrast opaque dark ink background (`bg-[#0b0c0e]/96`).
   - Retained gothic hairlines, bracketed corners, and obsidian chrome surfaces without glassmorphism or floating neon elements.
3. **Shared Motion & Zero Debuff:**
   - Single shared `IntersectionObserver` across website reveals; unobserves elements as they enter; 0 React re-renders on scroll.
   - Electron view switching powered by native View Transitions API (150ms cubic-bezier) with static zero-duration `prefers-reduced-motion` fallback.
   - 0 kB shared JS bundle delta.