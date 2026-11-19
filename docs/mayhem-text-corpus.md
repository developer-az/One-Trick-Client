# ARAM Mayhem text corpus (fixture provenance)

Status for Step B: this document records **what is publicly verified** about the
selection screens and **what is still a hypothesis** used only to shape test
fixtures. Nothing here is a claim about a live player's screen until real-game
validation (an explicit open item) is done.

## Public sources

1. League Wiki — *ARAM: Mayhem*, "Selection screens & rerolling":
   https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem
2. Riot Support — *League of Legends — ARAM: Mayhem Game Mode*:
   https://support.riotgames.com/en-us/league-of-legends/events/league-of-legends-aram-mayhem-game-mode
3. Riot Games dev blog — *Dev: Bringing Mayhem to ARAM*:
   https://www.leagueoflegends.com/en-us/news/dev/dev-bringing-mayhem-to-aram/
4. Hexgate — *ARAM Mayhem Overlay: 4 Apps That Rank Augments Live (2026)*:
   https://hexgate.app/blog/aram-mayhem-overlay/
5. arammayhem.com — data / API docs (also the attribution in `src/data/mayhem/bundle.json`):
   https://arammayhem.com/data/
6. CommunityDragon — public game assets (used by overlays for icons/fonts):
   https://communitydragon.org/
7. League Wiki — *ARAM: Mayhem/Augments* (name + tier list):
   https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments

## Verified from those sources

- A normal selection screen offers **three** augments; one reroll per card.
  Augment selection happens at the start and at levels 7, 11 and 15. Tiers are
  Silver / Gold / Prismatic and are shared by all players on that screen. [1, 2, 3]
- The **Maestro** augment makes a screen contain **four** offerings instead of
  three. [1] This is why the fixture set includes a 4-card positive.
- Augments can only be chosen while the champion is dead / at the shop. [1, 2]
- Riot's APIs do not expose the offered augments; overlays that rank cards read
  them from the player's own screen with **Windows' built-in text recognition**.
  Hexgate's own article shows augment-pick, champion-select and after-death
  screenshots. [4]
- The augment names in `src/data/mayhem/bundle.json` come from arammayhem.com
  and the bundle records patch 26.22 (metadata in that file). [5]
- Public game assets (icons, fonts) are served by CommunityDragon. [6]

## Verified locally (this repository, Step A/B)

- `mayhem-ocr.ps1 -ImagePath <file>` emits `__OT_LINES__` with one normalized
  box per OCR line; `parseMayhemOcrOutput` decodes it without changing the text
  projection.
- The real public champion-select screenshot
  `https://hexgate.app/screenshots/aram-mayhem-champ-select.webp` OCRs cleanly:
  `PICK YOUR CHAMPION`, `HEX GATE`, `ARAM MAYHEM`, `AVAILABLE CHAMPS`, champion
  names (`Yasuo` … `Varus`), `CHAMP SELECT`, `VARUS`, `YASUO`. Exact text and
  boxes are frozen in `test-fixtures/mayhem-ocr/labelled/manifest.json`;
  **the image itself is not committed**.
- The public augment screenshots tried in this environment (Hexgate
  `aram-mayhem-augments.webp` and the guides-factory set) OCR to **zero** lines
  with Windows OCR (dark/stylised art). They are not usable positive fixtures.
  The wiki screenshot is 403 from this host.

## Hypotheses — do not treat as verified

- The exact on-screen header text of an augment selection screen (e.g. whether
  it reads `CHOOSE AN AUGMENT`, `PICK ONE`, or nothing at all) is **not**
  confirmed by any source above. No production anchor may depend on it.
- The card-column x fractions `0.33 / 0.50 / 0.67` and name-row `y ≈ 0.40`
  used by the synthetic fixtures are a **working model**, not a measured value
  from a real capture. So are the 4-card spacing `0.245/0.415/0.585/0.755`,
  the `0.12` tolerance and the `x ≥ 0.12` separation mentioned in the plan.
- Whether augment titles are rendered in English on non-English clients is
  **unverified**; the OCR engine is forced to `en-US` locally for that reason.
- Localized spellings, byte-level variants (NBSP, zero-width marks, NFD), and
  scoreboard/death-recap line shapes are **hypotheses** until a real capture is
  labelled. The frozen scoreboard/junk rows are title-case approximations.

## Fixture provenance

- All eight PNG fixtures in `test-fixtures/mayhem-ocr/labelled/` are
  **synthetic**: drawn locally with `System.Drawing` by
  `scripts/make_mayhem_fixtures.ps1`, using augment titles and champion names
  from `src/data/mayhem/bundle.json`. They are **not real gameplay captures**
  and must not be described as such. They exist to freeze text/geometry and
  scale/offset behaviour independently of the matcher.
- The one **non-synthetic** entry (`negative-champion-select-real`) has
  `image: null` and frozen `rawOcr` only; its `source` URL is cited above.
- Real-game validation remains open: no labelled real augment-screen capture
  exists yet, so any acceptance gate derived from these fixtures is provisional.
