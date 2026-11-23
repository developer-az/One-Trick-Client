# Master prompt — Claude: finish the ARAM Mayhem card reader

## Paste this to Claude

> You are the lead engineer for **One Trick Client**, an Electron League of Legends companion overlay (`C:\Users\Az040\Projects\One-Trick-Client`, branch `fix/overlay-aram-identity`).
>
> **Mission:** the augment reader still refuses some legitimate rolls ("Could not verify — press PageDown to retry"). test.34 and test.35 fixed the two proven causes (this patch's dark indigo card art, and the fixed-row border probe); what remains is unverified surface: Headliner-modified cards, mixed-rarity screens, an upstream data gap, and a HUD skin whose health strip has never been checked in a real game. Close those, with evidence, without regressing anything.
>
> **Do not** change ranked guardrails (`detectMayhemMode` precedence, `resolveProfileId`, `routeHotkey`, `loadingStats`), the overlay presenter/supervisor, the test.31 pick logic (cards-gone purge, pick attribution, items rail), the HUD skin layout maths, or the `package.json` version. **Never edit a frozen `verify_*.ts`** — add a new one. No new dependencies.
>
> **Deliver:** fixes, a new verify file wired into `verify:release`, real-frame evidence for each variant you touch, `verify:release` green, a handoff entry, and test build `test.36`. Publish the pre-release without asking (standing rule), with the tag pointing at the source commit.

---

## 1. Where the reader stands (read this before touching code)

The roll reader is: capture → `electron/scripts/mayhem-ocr.ps1` (Windows.Media.Ocr + pixel probes) → `src/logic/mayhem/ocrOutput.ts` (marker parsing) → `src/logic/mayhem/pipeline.ts` (`classifyMayhemFrame`) → `src/logic/mayhem/monitor.ts` (display/purge/pick) → `src/overlay/OverlayMayhemPanel.tsx`.

What test.34/35 established, and why:

- **The card body is not one colour.** The tier is random per selection (Silver / Gold / Prismatic) and the whole game shares it, so the art changes every screen. Prismatic art on 26.23 samples as dark indigo (`9,18,38` / `8,15,41` / `2,11,28`), which matched no accept window, so `CARDS_VISIBLE` was always 0 and every scan failed.
- **The pixel gate is load-bearing.** `classifyMayhemFrame` needs `cardsVisible === true` plus aligned slot pixels for a partial row (`cards-matched-unknown-pixels`), and `monitor.ts` needs `cardsVisible === false` as positive evidence for the cards-gone purge. When the gate lies, both break.
- **Colour alone cannot be the key.** It is now structure: a dark interior under a glowing top border (`Get-CardSlotEvidence`, ps1 ≈ lines 246-360). The known indigo window counts on its own; any other dark art must additionally be clearly darker than the inter-card gaps. Bright (gold) art proves itself through its own colour window. Indigo is deliberately kept **out** of the gap rule, because this map's background is the same indigo.
- **Layouts:** three columns `[0.33, 0.5, 0.67]` and four (Maestro) `[0.245, 0.415, 0.585, 0.755]` exist in both the ps1 slot set and `pipeline.ts` (`THREE_COLUMNS` / `FOUR_COLUMNS`, `requiredCards = cardCount >= 4 ? 4 : 3`).

Current anchors (line numbers drift; grep the symbol):

| Symbol | File |
|---|---|
| `Test-CardIndigo`, `Test-CardBody`, `Test-CardMean` | `electron/scripts/mayhem-ocr.ps1` |
| `Get-CardSlotEvidence` (body `0.46h`, rim band `0.20-0.36h`, gap `±0.085`) | `electron/scripts/mayhem-ocr.ps1` |
| `Get-CardSlotEvidenceSet`, `CARDS_VISIBLE` | `electron/scripts/mayhem-ocr.ps1` |
| `hasAlignedCardPixels`, patch-day branch, all-unknown branch | `src/logic/mayhem/pipeline.ts` (`CARD_BODY_MIN=8`, `CARD_RIM_MIN=7`, `COLUMN_TOLERANCE=0.03`) |
| `MAYHEM_THREE_CARD_COLUMNS`, `MAYHEM_FOUR_CARD_COLUMNS`, `mayhemCardColumns`, `mayhemCardIndexAtCursor` | `src/logic/mayhem/selection.ts` |
| `parseMayhemOcrOutput`, `__OT_CURSOR__` | `src/logic/mayhem/ocrOutput.ts` |
| `MAYHEM_CARDS_GONE_SCANS_REQUIRED`, `MAYHEM_CARDS_GONE_GRACE_MS`, `mayhemUnverifiedAfterRead` | `src/logic/mayhem/monitor.ts` |
| `MAYHEM_OCR_UNVERIFIED_OUTCOME`, `mayhemOcrHintValue` | `electron/game-monitor.ts` |
| `verify_mayhem_indigo_cards.ts` (rarity matrix), `verify_mayhem_dark_cards.ts`, `verify_mayhem_partial_roll.ts`, `verify_mayhem_pick_selection.ts` | repo root |
| `scripts/mayhem-diagnose.ts` | one-image reader diagnosis |

---

## 2. Open work, in priority order

### 2.1 Stickered and decorated cards (unverified — highest risk)

HEARTSTEEL places a band sticker on some card offerings; Debonair Zed adds gold/hat text to the card. The body probe samples a 3×3 patch at `0.46h` and the border band at `0.20-0.36h`; a sticker can land on either and turn a card into "no card".

- Get one real capture of a HEARTSTEEL screen with a sticker and one Debonair Zed screen.
- A sticker is a bright ink mark inside the card body. If it lands in the 3×3 patch, the patch mean goes warm/bright and the dark-body path fails. Make the body probe **robust to a minority of bright pixels**: e.g. decide on the patch median, or ignore the brightest sample, rather than the mean. Keep the gap rule strict.
- Pin it with a new verify case (stickered body ⇒ `body>=8`, `gap=0`) and a negative (no card ⇒ `body=0`).

### 2.2 Mixed rarity within one screen (Command Line)

Hacked Reroll upgrades one offering a tier, so one screen shows two tiers of art at once.

- Confirm the per-slot evidence is independent (it is sampled per column), then verify a mixed screen: gold slot + indigo slot + silver slot in one row ⇒ at least 2 aligned slots, `gap=0` each.
- The reroll re-renders the row. Check `verify:mayhem-reroll-refresh` still holds: the frame after a reroll must replace the offer, not stack a second roll.

### 2.3 Extra selection screens (K/DA, Superfans, Pentakill)

These grant an extra selection that can arrive while a roll is already displayed.

- Two rolls back to back must not merge, double-count, or leave a stale panel.
- Pentakill's own screen (HEAVY / POWER / THRASH / DOOM) is a three-choice screen with its own art; make sure it is either read or cleanly ignored, and that picking from it does not corrupt the pick counter.
- `verify:mayhem-pick-selection` covers the normal path; add the back-to-back case if it is not covered.

### 2.4 Upstream data gap: "Flashy"

`npm run sync:mayhem` gives bundle 26.23 with 225 augments. A live card reads "Flashy" (`Your Flash has 3 charges. After 120 seconds, regain all charges.`), and upstream has no such row — the nearest is a placeholder `Flash 2`. It was also temporarily disabled by Riot in 26.1.

- Do **not** guess a rename. Either leave it on the placeholder path (current behaviour, correct) or add an explicit, documented alias table with a comment naming the source. If you add one, prove the roll still names the other two cards correctly.

### 2.5 HUD skin: unverified in a real game (from test.33)

The skin draws a perimeter around the native health/mana + ability cluster (`src/overlay/gameHudSkin.ts`, `ChromeGameHud.tsx`, `game-hud-skin.css`). The health strip position is **derived** (92% of the ability width, `20*s` tall, `3*s` above), not measured from a real match.

- In a real game with Frames on, check that the health lip sits above the health bar and the side plates straddle the ability cluster at HUD scale 20 and 60.
- If it is off, prefer moving the derived rect or the `ability` calibration over adding a new calibration target.
- Optional and not done: a game-HUD preview card in HUD Skin settings (`HudSkinPreview`). Do it only after the reader work is green.

---

## 3. Evidence first (mandatory)

Do not tune pixels from a phone photo. A photo of a monitor loses the exact RGB the predicate sees.

```powershell
# 1. a real screenshot of the failing screen (PrintScreen)
npx --yes tsx scripts/mayhem-diagnose.ts "C:\path\shot.png"
```

It prints the capture markers, the parsed evidence (`cardsVisible`, `cardSlots` with `body`/`rim`/`gap`/mean RGB, `cursor`), the classifier `decision`/`reasons`, and one `VERDICT` line. That line names the gate that rejected the frame:

- `REJECTED: black frame` / `no League window targeted` / `fallback capture` → capture problem, not a predicate.
- `REJECTED by classifier: no-card-geometry` → no title row was found (OCR text, not pixels).
- `REJECTED by classifier: too-few-cards` / `lone-card-ignored` → geometry/pipeline.
- `REJECTED by classifier: cards-matched-unknown-pixels` never appears; it is the accept path. If a partial row is rejected while `cardsVisible=1`, the slot alignment is failing.

If the OCR text is the problem, print `parsed.lines` and compare against `src/data/mayhem/bundle.json` names before changing any pixel rule.

---

## 4. Rules for the pixel gate

- Colour windows are a shortcut, structure is the contract: **dark interior + bright border above it + darker than the gaps**.
- Never let a card satisfy both "body" and "gap" with the same evidence; the gap rule is the boundary proof and must stay stricter than the body rule.
- A single screen-wide constant (one body row, one rim row) is a bug waiting for the next card size. Prefer scanning a band.
- Windows PowerShell 5.1 must run the script: no `??`, no ternary `? :`, no `-AsHashtable`, keep `GetPixel` sampling bounded (a scan runs once per PageDown, so tens of samples are fine, loops over whole images are not).
- Log enough to diagnose without the screen: the slot's mean RGB is already emitted; keep it.

## 5. Tests

Add `verify_mayhem_card_variants.ts` (do not edit frozen verifies) covering:

1. Predicate table on the real logged RGBs for every rarity (silver / gold / prismatic) — accept the bodies, reject background, HUD fill, title ink, pure black.
2. The shipped `Get-CardSlotEvidence` on synthetic bitmaps, modelled on `verify_mayhem_indigo_cards.ts` (extract the ps1 functions by regex, build bitmaps in PowerShell):
   - three-column prismatic / silver / gold ⇒ `body>=8`, `gap=0`;
   - four-column Maestro ⇒ four aligned slots;
   - mixed rarity row ⇒ each slot independent;
   - stickered body (a bright mark inside the patch) ⇒ still `body>=8`;
   - negatives: uniform dark band ⇒ `body=0`; borderless plates ⇒ `body=0`; bright cave background with no cards ⇒ nothing visible.
3. Source guards: indigo never reaches the gap rule; `cardsVisible` still needs two card-like slots; the rim band is not a single fixed row.

Wire it as `verify:mayhem-card-variants` next to `verify:mayhem-indigo-cards` and add it to the `verify:release` chain after it.

## 6. Verification commands

```powershell
npm run verify:mayhem
npm run verify:mayhem-dark-cards
npm run verify:mayhem-indigo-cards
npm run verify:mayhem-card-variants      # new
npm run verify:mayhem-partial-roll
npm run verify:mayhem-pick-selection
npm run verify:mayhem-reroll-refresh
npm run verify:mayhem-text-matrix
npm run verify:mayhem-fixtures
npm run verify:game-hud-skin             # if you touch the HUD skin
npm run verify:release
```

`npm run lint` is the first step of `verify:release`; a regex with two literal spaces fails `no-regex-spaces` (use `{2}`).

## 7. Release (standing rule: publish without asking)

```powershell
npm run verify:release
powershell -ExecutionPolicy Bypass -File scripts/package-test-build.ps1 `
  -Label mayhem-card-variants-36 -Tag test-mayhem-card-variants-36 `
  -Version 1.7.1-test.36 -NoPublish
git push origin fix/overlay-aram-identity
gh release create test-mayhem-card-variants-36 --prerelease `
  --target <FULL 40-char commit sha> `
  --title "Test build test-mayhem-card-variants-36" `
  --notes-file "$env:TEMP\opencode\otc-test36-notes.md" `
  "release/One.Trick.1.7.1-test.36.zip"
```

- `--target` **must be the full 40-character SHA**; a short SHA returns `HTTP 422 target_commitish is invalid`.
- The tag must end up on the source commit: verify with `git rev-list -n1 <tag>` == `git rev-parse HEAD`.
- Never edit `package.json`'s `version`; the packaging script stamps `extraMetadata`.
- Two releases with the same tag will not both exist: cut a new version number instead of re-uploading the previous zip.

## 8. Constraints

- Ranked guardrails, presenter/supervisor, Mayhem pick logic (test.31), HUD skin maths: **do not change**.
- Frozen verifies: do not edit; add new ones.
- No new dependencies. No `backdrop-filter`, animation or per-frame layout reads in overlay CSS.
- Readability/perf: the reader runs once per manual scan; do not make it scan the whole image per slot.

## 9. Report back

```
WHAT CHANGED
- files...
EVIDENCE
- which screenshot, which VERDICT line, before -> after (body/rim/gap numbers)
OPEN
- what still needs a real capture
GATES
- verify:release exit 0; new verify N checks
RELEASE
- https://github.com/.../releases/tag/...
- tag -> <full sha>
```

If a choice is ambiguous (how much tolerance, whether to alias a name), pick the option that **cannot invent an augment**, and say so in the handoff.
