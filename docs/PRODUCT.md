# Product Specification: One Trick

## Mission
One Trick is an ultra-lightweight, zero-bloat League of Legends companion and HUD studio for Windows. It provides instant matchup advice, one-click loadout export into the League client during champion select, and an unobtrusive, click-through in-game HUD overlay during matches.

## Core Features
1. **Champion Select Loadout & Export:**
   - Detects enemy picks automatically via LCU WebSocket / HTTP API.
   - Provides tailored matchup guidance, core itemization, situational adaptations, and rune trees.
   - Authored deep doctrine for Pyke, Pantheon, and Yone; live catalog integration for all other 165+ champions.
   - One-click export directly into League's rune page and item set APIs.
2. **In-Game Click-Through HUD Overlay:**
   - Enemy summoner spell tracking (Flash, Ignite, TP, Cleanse) triggered via global keyboard hooks (PageUp/PageDown, Numpad 9/3) or kill events.
   - Gank probability indicator based on vision state and jungle tracking.
   - Dynamic item buy guidance & ward tracking.
   - Opaque dark panels with high contrast, readable over any map terrain without blurry CPU/GPU expensive compositing filters.
   - Zero-lag mouse click-through (`setIgnoreMouseEvents`).
3. **Web HUD Studio:**
   - Visual configuration tool allowing players to reposition and toggle overlay modules against Summoner's Rift HUD coordinates.
   - Synchronizes configurations between web studio and local companion app.
4. **Performance Mandate:**
   - Target framerate drop in League: 0% (strictly < 1%).
   - Resource cap: < 3% CPU, < 150 MB RAM.
   - Zero invasive code injection, zero memory scanning, Riot TOS compliant.
