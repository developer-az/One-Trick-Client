# One Trick

<div align="center">

**Windows League overlay + web HUD studio — authored Pyke / Pantheon / Yone, live catalog for every champion**

[![Version](https://img.shields.io/badge/version-1.2.0-green.svg)](https://github.com/developer-az/One-Trick-Client/releases/tag/v1.2.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-blue)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-39-blue)](https://www.electronjs.org/)

[Download](https://github.com/developer-az/One-Trick-Client/releases) · [HUD Studio](https://developer-az.github.io/One-Trick-Client/studio/) · [Site](https://developer-az.github.io/One-Trick-Client/) · [Issues](https://github.com/developer-az/One-Trick-Client/issues)

</div>

---

## Overview

**One Trick** connects to the League Client, fills enemy picks in champion select, recommends items and runes for your profile, exports loadouts into the client, and keeps a click-through HUD alive while you play.

Authored doctrine: **Pyke Support**, **Pantheon Support**, **Yone Mid**. Every other champion gets a generic profile from the live Data Dragon / Community Dragon catalog API.

---

## Features

### Matchup & loadout

- **Enemy composition analysis** by role
- **Profile builds** — core path first, then boots, then situational (boots are not forced to the front of the checklist)
- **Rune pages** adapted to poke, CC, and lane shape
- **Dominance gauge** for how favorable the setup is
- **Loading-screen plan** — matchup notes stay in champ select; the overlay does not lecture mid-fight
- **Ally context** — ADC / Mid / Jungle when the draft asks

### League Client integration

- Auto-connects when the League Client is running
- Fills enemies as champ select locks in
- **Export runes** and **item sets** with one action
- Clears cleanly after the match for the next lobby

### In-game overlay

- **HUD studio** — pin modules and chrome stickers on a League HUD / minimap map (companion + [web studio](https://developer-az.github.io/One-Trick-Client/studio/)); overlay uses the saved layout
- HUD modules you can toggle: enemy summoners, gank square, vision, next-buy icons, one time-critical action line
- **Gank probability square** — yellow = fog / low-vision risk; red = brief high window from per-jungler pathing
- **Vision** — short location + pink/sweep hint (detail in tooltip)
- **Ability / minimap frames** are off by default — turn on Frames if you want them
- Transparent click-through HUD; **Sync LoL** reads Interface scales from `game.cfg`
- Stays visible mid-match — click-through healed, soft LCU flaps do not tear it down

### Summoner timers

- Tracks enemy bot (ADC + Support) or mid Flash / combat sums from Live Client + kill events
- **PageUp / PageDown** toggle Flash (press again to clear) via a **Windows low-level keyboard hook** so keys work while League has focus
- Numpad **9** / **3** fallbacks
- Mid: PageUp = Mid Flash, PageDown = Ignite / TP / Flash fallback

---

## Install (Windows)

### From a release (recommended)

1. Open the [**latest release**](https://github.com/developer-az/One-Trick-Client/releases)
2. Download **`One.Trick.Setup.*.exe`**
3. Launch with the League Client open (or start League afterward — it reconnects)

### From source

```bash
git clone https://github.com/developer-az/One-Trick-Client.git
cd One-Trick-Client
npm install
npm run dist
```

Builds land in `release/`.

---

## Quick start

1. Start **League of Legends**, then open **One Trick**
2. Lock in — authored Pyke / Pantheon / Yone stay deep; any other champ uses the live catalog
3. Review **items** and **runes**, then **Export**
4. Overlay HUD appears when the match starts (Borderless display mode)

Manual enemy picks still work when LCU is unavailable (Demo mode).

---

## Overlay controls

| Action | Shortcut / control |
|--------|--------------------|
| Toggle primary Flash (ADC or Mid) | **PageUp** or **Numpad 9** |
| Toggle Support Flash / Mid Ignite·TP | **PageDown** or **Numpad 3** |
| Show / hide overlay | **Ctrl+Shift+H** |
| Lock (click-through) / unlock panel | **Ctrl+Shift+U** |
| HUD modules (sums, gank, vision, buy, action, frames) | Companion **HUD** row |
| Align HUD / minimap frames | Unlock → **Align** (enable **Frames** first) |
| Match League scales | **Sync LoL** or HUD / Map sliders |

### Display mode (FPS)

Set League **Video → Display Mode** to **Borderless**. Exclusive Fullscreen forces expensive recomposition under an always-on-top overlay.

### Hotkeys while League has focus

PageUp / PageDown use a system keyboard hook (`uiohook-napi`), not Electron’s accelerator registry alone.

If keys still do nothing: **run One Trick as Administrator** whenever League is elevated — Windows UIPI blocks hooks across that privilege gap.

---

## Usage notes

- **LCU** — Client must be running for champ-select fill and export
- **Live Client** — Overlay and summoner heuristics need an active match
- **Data** — Champions / items / runes from Riot Data Dragon

---

## Development

### Prerequisites

- Node.js 18+
- npm
- Windows (Electron, LCU, overlay, keyboard hook)

### Commands

```bash
npm run dev                 # Web UI only
npm run dev:electron:win    # Desktop + Vite
npm run build               # Web production build
npm run dist                # NSIS + portable → release/
npm run website:dev         # Marketing site
npm run website:build
npm run lint
npm run verify:cues
npm run verify:icons
npm run verify:catalog
npm run verify:layout
npm run catalog:generate      # website/public/api/v1
```

## Release readiness (Windows)

Use this gate before tagging any `v*` release.

### Acceptance criteria

- `npm run dist` succeeds and generates both installer + portable outputs
- App startup works and LCU connect/export works in client
- Overlay + hotkeys work in live match:
  - `PageUp` / `PageDown`
  - `Numpad 9` / `Numpad 3` fallback
- No regressions in supported profiles: **Pyke Support**, **Pantheon Support**, **Yone Mid**

### Mandatory quality gates (must pass before tag)

```bash
npm run lint
npm run verify:cues
npm run verify:icons
npm run verify:catalog
npm run verify:layout
npm run electron:build
npm run build
npx tsc --noEmit
```

> The release workflow now enforces these checks before Windows packaging/publish.

### Pre-release regression checklist

- Installer and portable launch on Windows
- Overlay show/hide, click-through, align mode, and **Sync LoL** all work
- In-game FPS impact checked with overlay **on** and **off**
- Admin/elevation hotkey behavior verified (UIPI edge case)
- Match start/end transitions keep overlay persistence correct
- Packaging metadata still valid (targets/icons/signing flags) and release artifacts exist
- Smoke test on single monitor + multi-monitor + varied Windows DPI/scale setups

### Performance validation

- Run `npx electron scripts/perf-harness.mjs`
- Confirm transition burst and steady-state CPU stay within expected budget
- In live match, tune only high-impact paths:
  - polling cadence
  - overlay update frequency
  - renderer workload while main window is parked

### Layout

```
One-Trick-Client/
├── electron/           # Main process, LCU, live client, overlay, key hook
├── src/
│   ├── components/     # Main window UI
│   ├── catalog/        # Live DDragon/CDragon catalog + generic recs
│   ├── logic/          # Builds, matchups, jungle, vision
│   └── overlay/        # In-game overlay + HUD studio canvas
├── website/            # Landing + /studio + static /api/v1 catalog
└── release/            # electron-builder output
```

### Stack

React 19 · TypeScript 5.9 · Vite 7 · Electron 39 · Tailwind CSS 3.4 · Data Dragon · LCU · Live Client API · uiohook-napi

---

## Contributing

1. Fork and branch
2. Keep TypeScript / ESLint clean
3. Test LCU export, overlay persistence, and PageUp/PageDown on Windows when you touch those paths
4. Open a PR with a short description

---

## License

MIT — see [LICENSE](LICENSE).

---

## Support

- **Issues**: [GitHub Issues](https://github.com/developer-az/One-Trick-Client/issues)
- **Releases**: [GitHub Releases](https://github.com/developer-az/One-Trick-Client/releases)
- **Site**: [developer-az.github.io/One-Trick-Client](https://developer-az.github.io/One-Trick-Client/)
- **Repository**: [developer-az/One-Trick-Client](https://github.com/developer-az/One-Trick-Client)

---

<div align="center">

**Built for one-tricks**

*One Trick is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.*

</div>
