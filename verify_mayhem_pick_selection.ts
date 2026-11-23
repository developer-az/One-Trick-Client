/**
 * The post-selection path: the cards vanish, the HUD must come down, the pick
 * must count, and the clicked card must be attributable from the cursor.
 *
 * Also proves the passive item-gold read (Blitz/Porofessor method): every
 * player's held items and their shop prices come from the Live Client, so the
 * lead is a pure sum with consumables excluded.
 */

import fs from 'node:fs';
import {
  createMayhemMonitorState,
  runMayhemMonitorScan,
  MAYHEM_CARDS_GONE_GRACE_MS,
  MAYHEM_CARDS_GONE_SCANS_REQUIRED,
  type MayhemMonitorRead,
} from './src/logic/mayhem/monitor';
import { mayhemCardIndexAtCursor, pickedMayhemAugment } from './src/logic/mayhem/selection';
import { parseMayhemOcrOutput } from './src/logic/mayhem/ocrOutput';
import type { MayhemModeSignals } from './src/logic/mayhem/mode';
import {
  formatGoldLead,
  formatItemGold,
  itemGoldOf,
  teamItemGoldLead,
} from './src/logic/goldDiff';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const MAYHEM: MayhemModeSignals = {
  gameMode: 'KIWI',
  mapName: 'Map12',
  queueId: 2400,
  mapId: 12,
};
const ROLL = ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'];

function scanInput(now: number) {
  return {
    now,
    level: 7,
    isDead: false,
    signals: MAYHEM,
    liveAugmentIds: [],
    autoOcrAllowed: true,
  };
}

function offerRead(cursor?: { x: number; y: number }): MayhemMonitorRead {
  return {
    ids: ROLL,
    candidateIds: [],
    frameIds: ROLL,
    frameDisplayCount: 3,
    fresh: true,
    valid: true,
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: true,
    owner: true,
    cardsVisible: true,
    cursor,
  };
}

function goneRead(
  cursor?: { x: number; y: number },
  extra: Partial<MayhemMonitorRead> = {}
): MayhemMonitorRead {
  return {
    ids: [],
    candidateIds: [],
    frameIds: [],
    frameDisplayCount: 0,
    fresh: true,
    // Post-selection the screen has HUD/callout text, so the pipeline cannot
    // verify a roll. The pixel gate is the positive evidence that cards are gone.
    valid: false,
    fuzzyScore: 0.4,
    blackFrame: false,
    foreground: true,
    owner: true,
    cardsVisible: false,
    cursor,
    ...extra,
  };
}

async function main(): Promise<void> {
  console.log('--- cursor names the clicked card ---');
  {
    ok(mayhemCardIndexAtCursor({ x: 0.33, y: 0.5 }, 3) === 0, 'left card maps to index 0');
    ok(mayhemCardIndexAtCursor({ x: 0.5, y: 0.5 }, 3) === 1, 'centre card maps to index 1');
    ok(mayhemCardIndexAtCursor({ x: 0.67, y: 0.5 }, 3) === 2, 'right card maps to index 2');
    ok(mayhemCardIndexAtCursor({ x: 0.245, y: 0.5 }, 4) === 0, 'four-card left card maps to index 0');
    ok(mayhemCardIndexAtCursor({ x: 0.755, y: 0.5 }, 4) === 3, 'four-card right card maps to index 3');
    ok(
      mayhemCardIndexAtCursor({ x: 0.415, y: 0.5 }, 3) === null,
      'a click in the gap between two cards names no card'
    );
    ok(
      mayhemCardIndexAtCursor({ x: 0.5, y: 0.99 }, 3) === null,
      'a click below the cards (reroll/hide row) names no card'
    );
    ok(mayhemCardIndexAtCursor(null, 3) === null, 'no cursor means no attribution');

    const picked = pickedMayhemAugment(ROLL, { x: 0.5, y: 0.6 });
    ok(picked?.id === 'giant_slayer' && picked.index === 1, 'the centre click maps to the centre roll id');
    ok(pickedMayhemAugment(['a', 'b'], { x: 0.5, y: 0.6 }) === null, 'a partial roll is never attributed');
  }

  console.log('--- two cards-gone frames retire the HUD and count the pick ---');
  {
    const first = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      scanInput(1_000_000),
      async () => offerRead()
    );
    const second = await runMayhemMonitorScan(
      first.state,
      scanInput(1_001_100),
      async () => offerRead()
    );
    ok(second.hudAction === 'show', 'the accepted roll opens the HUD');

    const oneGone = await runMayhemMonitorScan(
      second.state,
      scanInput(1_002_200),
      async () => goneRead({ x: 0.5, y: 0.6 })
    );
    ok(oneGone.counted === 0, 'one cards-gone frame does not count a pick');
    ok(oneGone.hudAction !== 'purge', 'one cards-gone frame inside the grace window keeps the panel');

    const twoGone = await runMayhemMonitorScan(
      oneGone.state,
      scanInput(1_003_400),
      async () => goneRead({ x: 0.5, y: 0.6 })
    );
    ok(twoGone.counted === 1, 'two cards-gone frames count exactly one pick');
    ok(twoGone.hudAction === 'purge', 'two cards-gone frames purge the retained roll');
    ok(
      twoGone.state.displayIds.length === 3,
      'the engine keeps the display ids; the caller purges after attribution'
    );
    ok(
      twoGone.state.cardsGoneScans >= MAYHEM_CARDS_GONE_SCANS_REQUIRED &&
        MAYHEM_CARDS_GONE_GRACE_MS > 0,
      'the required streak and grace are wired into the decision'
    );
  }

  console.log('--- cards still on screen never look gone ---');
  {
    const first = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      scanInput(2_000_000),
      async () => offerRead()
    );
    // A failed OCR read while the cards are visibly still there: the pixel gate
    // says cards, so the HUD must not age out and no pick may be counted.
    const miss: MayhemMonitorRead = {
      ...goneRead(undefined, { cardsVisible: true }),
    };
    const missOne = await runMayhemMonitorScan(
      first.state,
      scanInput(2_002_000),
      async () => miss
    );
    const missTwo = await runMayhemMonitorScan(
      missOne.state,
      scanInput(2_004_000),
      async () => miss
    );
    ok(missOne.counted === 0 && missTwo.counted === 0, 'a cards-visible miss never counts a pick');
    ok(missTwo.hudAction === 'show', 'a cards-visible miss keeps the panel up');
    ok(missTwo.state.cardsGoneScans === 0, 'cards-visible frames reset the gone streak');
  }

  console.log('--- fallback and background frames stay out of the post-selection path ---');
  {
    const first = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      scanInput(3_000_000),
      async () => offerRead()
    );
    const fallback = await runMayhemMonitorScan(
      first.state,
      scanInput(3_003_000),
      async () => goneRead(undefined, { fallback: true })
    );
    ok(fallback.counted === 0, 'a fallback cards-gone frame never counts a pick');
    const foreign = await runMayhemMonitorScan(
      fallback.state,
      scanInput(3_006_000),
      async () => goneRead(undefined, { owner: false })
    );
    ok(foreign.counted === 0, 'a foreign-window cards-gone frame never counts a pick');
  }

  console.log('--- OCR cursor marker ---');
  {
    const parsed = parseMayhemOcrOutput(
      '__OT_CURSOR__ {"x":0.25,"y":0.6}\n__OT_CARDS_VISIBLE 1__\nhello'
    );
    ok(parsed.cursor?.x === 0.25 && parsed.cursor?.y === 0.6, 'the cursor marker is parsed');
    ok(parsed.cardsVisible === true, 'the visibility marker still parses beside it');
    ok(parsed.text.trim() === 'hello', 'the cursor marker never leaks into OCR text');
    ok(
      parseMayhemOcrOutput('__OT_CURSOR__ {"x":2,"y":0.6}').cursor === undefined,
      'an out-of-band cursor is refused'
    );
    ok(
      parseMayhemOcrOutput('__OT_CURSOR__ {"x":0.5,"y":0.5}\n__OT_CURSOR__ {"x":0.6,"y":0.5}')
        .cursor === undefined,
      'two cursor markers are ambiguous and report nothing'
    );
  }

  console.log('--- capture script reports the cursor in the offer band ---');
  {
    const ps1 = fs.readFileSync('electron/scripts/mayhem-ocr.ps1', 'utf8');
    ok(ps1.includes('GetCursorPos'), 'the capture script can read the OS cursor');
    ok(ps1.includes('function Get-CursorInBand'), 'the cursor is normalized to the offer band');
    ok(ps1.includes('__OT_CURSOR__'), 'the cursor marker is emitted');
    const targetBlock = ps1.slice(ps1.indexOf('if ($target) {'));
    ok(
      targetBlock.includes('__OT_CURSOR__'),
      'the cursor is only emitted for a real game-window capture, never the fallback'
    );
  }

  console.log('--- passive item gold ---');
  {
    ok(
      itemGoldOf([
        { itemID: 1001, price: 300, count: 1 },
        { itemID: 2003, price: 50, consumable: true },
        { itemID: 3340, price: 0 },
        { itemID: 3031, price: 3400, count: 1 },
      ]) === 3700,
      'item gold sums shop prices, excludes consumables and trinkets'
    );
    const lead = teamItemGoldLead({
      local: 1000,
      allies: [{ itemGold: 2000 }],
      enemies: [{ itemGold: 2500 }, { itemGold: 1000 }],
    });
    ok(
      lead?.mine === 3000 && lead?.theirs === 3500 && lead?.diff === -500 && lead?.complete === true,
      'team item gold compares you + allies with all five enemies'
    );
    ok(
      teamItemGoldLead({ local: 1000, allies: [{}], enemies: [{ itemGold: 1000 }] })?.complete ===
        false,
      'a missing player row marks the total as incomplete'
    );
    ok(teamItemGoldLead({ local: 0, enemies: [] }) === null, 'no enemy rows means no gold line');
    ok(formatItemGold(850) === '850' && formatItemGold(8200) === '8.2k', 'gold is abbreviated for the rail');
    ok(formatGoldLead(1200) === '+1.2k' && formatGoldLead(-850) === '-850', 'the lead keeps its sign');
    ok(formatGoldLead(0) === 'even', 'an even game reads as even');
  }

  if (failures > 0) {
    console.error(`${failures} failure(s)`);
    process.exitCode = 1;
  } else {
    console.log('verify:mayhem-pick-selection ok');
  }
}

void main();
