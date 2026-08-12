# One Trick

<div align="center">

**Windows League companion for Pyke Support, Pantheon Support, and Yone Mid — matchup doctrine, loadout export, and a live in-game overlay**

[![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)](https://github.com/developer-az/One-Trick-Client/releases/tag/v1.0.2)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-blue)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-39-blue)](https://www.electronjs.org/)

[Download v1.0.2](https://github.com/developer-az/One-Trick-Client/releases/tag/v1.0.2) · [Site](https://developer-az.github.io/One-Trick-Client/) · [Issues](https://github.com/developer-az/One-Trick-Client/issues)

</div>

---

## Overview

**One Trick** connects to the League Client, fills enemy picks in champion select, recommends items and runes for your profile, exports loadouts into the client, and keeps a dual-rail chrome overlay alive while you play.

Profiles: **Pyke Support**, **Pantheon Support**, **Yone Mid**.

---

## Features

### Matchup & loadout

- **Enemy composition analysis** by role
- **Profile builds** — core path first, then boots, then situational (boots are not forced to the front of the checklist)
- **Rune pages** adapted to poke, CC, and lane shape
- **Dominance gauge** for how favorable the setup is
- **Loading-screen doctrine** — exact how-to-play lines for the matchup so you can leave the companion UI and focus on macro
- **Ally context** — ADC / Mid / Jungle when the draft asks

### League Client integration

- Auto-connects when the League Client is running
- Fills enemies as champ select locks in
- **Export runes** and **item sets** with one action
- Clears cleanly after the match for the next lobby

### In-game overlay

- Dual-rail HUD: enemy summoners on the left, cues / buy / vision on the right
- **Gank probability square** — yellow = fog / low-vision risk; red = brief high window from per-jungler pathing
- **Purpose-first wards** — what the ward is for, pink count, sweep targets when Oracle / Control Ward is held (pots first early — no pink on the open)
- **Pro-level tips** and roam / cannon windows (no basic filler)
- Transparent chrome around ability bar and minimap; **Sync LoL** reads Interface scales from `game.cfg`
- Stays visible mid-match — click-through healed, soft LCU flaps do not tear it down

### Summoner timers

- Tracks enemy bot (ADC + Support) or mid Flash / combat sums from Live Client + kill events
- **PageUp / PageDown** toggle Flash (press again to clear) via a **Windows low-level keyboard hook** so keys work while League has focus
- Numpad **9** / **3** fallbacks
- Mid: PageUp = Mid Flash, PageDown = Ignite / TP / Flash fallback

---

## Install (Windows)

### From a release (recommended)

1. Open [**v1.0.2**](https://github.com/developer-az/One-Trick-Client/releases/tag/v1.0.2)
2. Download **`One.Trick.Setup.1.0.2.exe`**
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
2. Lock in on a supported profile (Pyke / Pantheon / Yone)
3. Review **items**, **runes**, and **matchup doctrine**
4. Click **Export** to push into the client
5. Overlay appears when the match starts (Borderless display mode)

Manual enemy picks still work when LCU is unavailable (Demo mode).

---

## Overlay controls

| Action | Shortcut / control |
|--------|--------------------|
| Toggle primary Flash (ADC or Mid) | **PageUp** or **Numpad 9** |
| Toggle Support Flash / Mid Ignite·TP | **PageDown** or **Numpad 3** |
| Show / hide overlay | **Ctrl+Shift+H** |
| Lock (click-through) / unlock panel | **Ctrl+Shift+U** |
| Align HUD / minimap frames | Unlock → **Align** → nudge Ability / Map |
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
```

### Layout

```
One-Trick-Client/
├── electron/           # Main process, LCU, live client, overlay, key hook
├── src/
│   ├── components/     # Main window UI
│   ├── logic/          # Builds, matchups, jungle, vision
│   └── overlay/        # In-game overlay React app
├── website/            # Product landing (GitHub Pages)
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
