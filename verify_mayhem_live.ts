/**
 * Brief H — Mayhem in a real game.
 *
 * Covers everything that can be proven outside a live match: mode detection by
 * queue, packaged OCR script resolution, the fuzzy matcher on OCR noise, the
 * pick counter hysteresis, HUD visibility thresholds, marker parsing, capture
 * masking and (on Windows) OCR of harder fixtures.
 *
 * NOT covered here (needs the user's in-game test): queue id 2400, the
 * `League of Legends` process name + `RiotWindowClass`, and client-area capture.
 * The app writes `mode-detect …` and `ocr-target pid=… exe=… class=… rect=…
 * frame=… black=…` to overlay.log so that test can be read back.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bundle from './src/data/mayhem/bundle.json';
import {
  detectMayhemMode,
  isAramOrMayhem,
  isMayhemGame,
  type MayhemModeSignals,
} from './src/logic/mayhem/mode';
import {
  MAYHEM_AUTO_MIN_LINES,
  bestAugmentMatchConfidence,
  countOcrContentLines,
  effectiveAutoMinMatches,
  matchAugmentsFromOcr,
} from './src/logic/mayhem/match';
import type { MayhemAugment, MayhemBundle } from './src/logic/mayhem/types';
import {
  createMayhemPickCounterState,
  observeMayhemPickScan,
  readLiveAugmentIds,
  type MayhemPickCounterState,
} from './src/logic/mayhem/pickCount';
import { resolveMayhemPicksTaken } from './src/logic/mayhem/pickPhase';
import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';
import {
  formatMaskRects,
  maskRectInCapture,
  mayhemPanelMaskRect,
  parseMaskRects,
} from './src/logic/mayhem/captureMask';
import {
  mayhemOcrScriptCandidates,
  resolveOcrScriptPath,
  toUnpackedAsarPath,
} from './src/logic/mayhem/ocrScriptPath';
import { mayhemOcrScriptPath, runMayhemOcrOnImageFile } from './src/logic/mayhem/ocrRunner';
import { parseMayhemOcrOutput } from './src/logic/mayhem/ocrOutput';
import { formatOverlayLogLine } from './electron/overlay-log';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const data = bundle as MayhemBundle;
const augments = data.augments as MayhemAugment[];

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

console.log('--- mode detection table ---');
const MODE_TABLE: Array<{ signals: MayhemModeSignals; expect: string }> = [
  { signals: { gameMode: 'KIWI', mapName: 'Map12', queueId: 2400, mapId: 12 }, expect: 'mayhem' },
  { signals: { gameMode: 'ARAM', mapName: 'Map12', queueId: 450, mapId: 12 }, expect: 'aram' },
  { signals: { gameMode: 'ARAM', mapName: 'Map12', queueId: 2400, mapId: 12 }, expect: 'mayhem' },
  { signals: { gameMode: 'ARAM', mapName: 'Map12', queueId: null, mapId: 12 }, expect: 'aram' },
  { signals: { gameMode: 'CLASSIC', mapName: 'Map11', queueId: 420, mapId: 11 }, expect: 'other' },
];
for (const row of MODE_TABLE) {
  const got = detectMayhemMode(row.signals);
  ok(
    got === row.expect,
    `${row.signals.gameMode}/${row.signals.mapName}/q${row.signals.queueId} → ${got} (want ${row.expect})`
  );
}

ok(
  !isMayhemGame('ARAM', 'Howling Abyss', { queueId: 450, mapId: 12 }),
  'classic ARAM 450 on Howling Abyss is not Mayhem'
);
ok(
  !isMayhemGame('ARAM', 'Map12', { queueId: 450, mapId: 12, augmentOffersDetected: true }),
  'classic ARAM 450 stays ARAM even when augment offers were OCRed'
);
ok(
  isMayhemGame('ARAM', 'Map12', { queueId: null, mapId: 12, augmentOffersDetected: true }),
  'unknown queue + ARAM map + offers → Mayhem'
);
ok(isMayhemGame('KIWI', 'Map12', { queueId: 2400 }), 'KIWI + Mayhem queue');
ok(!isAramOrMayhem('CLASSIC', 'Map11', { queueId: 420 }), 'classic SR is not ARAM');
ok(isAramOrMayhem('ARAM', 'Map12', { queueId: 450 }), 'ARAM 450 keeps the ARAM overlay');

console.log('--- packaged path resolution ---');
const fakeApp = path.join('C:', 'fake', 'resources', 'app.asar');
const scriptInAsar = path.join(fakeApp, 'electron', 'scripts', 'mayhem-ocr.ps1');
const unpacked = path.join('C:', 'fake', 'resources', 'app.asar.unpacked', 'electron', 'scripts', 'mayhem-ocr.ps1');
ok(toUnpackedAsarPath(scriptInAsar) === unpacked, 'app.asar path maps to app.asar.unpacked');
ok(toUnpackedAsarPath(unpacked) === unpacked, 'already-unpacked path is left alone');
const unpackedExists = (candidate: string): boolean => candidate === unpacked;
ok(
  resolveOcrScriptPath([scriptInAsar], unpackedExists) === unpacked,
  'electron/mayhem-ocr resolver picks app.asar.unpacked when it exists'
);
ok(
  resolveOcrScriptPath([scriptInAsar], () => true) === unpacked,
  'unpacked copy wins even when fs.existsSync also answers true for the asar path'
);
ok(
  mayhemOcrScriptPath(fakeApp, unpackedExists) === unpacked,
  'src/logic/mayhem/ocrRunner resolver picks app.asar.unpacked when it exists'
);
const fakeDirname = path.join(fakeApp, 'dist-electron', 'electron');
const candidates = mayhemOcrScriptCandidates(fakeApp, fakeDirname);
ok(candidates.some((candidate) => candidate.includes('app.asar')), 'candidate list is built from the app root');
ok(
  resolveOcrScriptPath(candidates, unpackedExists) === unpacked,
  'the real candidate list resolves to the unpacked script'
);
ok(
  resolveOcrScriptPath([path.join(root, 'missing.ps1')], () => false) === path.join(root, 'missing.ps1'),
  'missing everywhere → first candidate is returned'
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  build?: { asarUnpack?: string[] | string; files?: string[] };
  scripts?: Record<string, string>;
};
const asarUnpack = Array.isArray(pkg.build?.asarUnpack)
  ? pkg.build?.asarUnpack
  : typeof pkg.build?.asarUnpack === 'string'
    ? [pkg.build?.asarUnpack]
    : [];
ok(
  asarUnpack.some((pattern) => typeof pattern === 'string' && /electron\/scripts/.test(pattern)),
  'electron-builder asarUnpack ships electron/scripts outside app.asar'
);
ok(
  !!pkg.scripts?.['verify:mayhem-live'],
  'package.json exposes verify:mayhem-live'
);

console.log('--- fuzzy matcher on OCR noise ---');
const noisy = 'JeweIed GauntIet\nGiant S1ayer\nApex lnventor';
const noisyIds = matchAugmentsFromOcr(noisy, augments);
ok(noisyIds.includes('jeweled_gauntlet'), 'JeweIed GauntIet → jeweled_gauntlet');
ok(noisyIds.includes('giant_slayer'), 'Giant S1ayer → giant_slayer');
ok(noisyIds.includes('apex_inventor'), 'Apex lnventor → apex_inventor');

const confusion = 'Recursi0n\nShr1nk Eng1ne\nBlunt F0rce';
const confusionIds = matchAugmentsFromOcr(confusion, augments);
ok(confusionIds.includes('recursion'), 'Recursi0n → recursion');
ok(confusionIds.includes('shrink_engine'), 'Shr1nk Eng1ne → shrink_engine');
ok(confusionIds.includes('blunt_force'), 'Blunt F0rce → blunt_force');

const accentIds = matchAugmentsFromOcr('Jeweléd  Gauntlet!\nGIANT-SLAYER', augments);
ok(accentIds.includes('jeweled_gauntlet'), 'diacritics + punctuation are folded');
ok(accentIds.includes('giant_slayer'), 'case + hyphen are folded');

const unrelated = 'Victory\nDefeat\nSummoners Rift\nEnd of Game';
const unrelatedIds = matchAugmentsFromOcr(unrelated, augments);
ok(unrelatedIds.length === 0, 'unrelated UI text matches no augment');
ok(
  bestAugmentMatchConfidence(unrelated, augments) < 0.9,
  'unrelated UI text stays below the single-offer confidence'
);
ok(
  bestAugmentMatchConfidence('Jeweled Gauntlet', augments) >= 0.99,
  'a clean card title scores ~1'
);
ok(countOcrContentLines('Jeweled Gauntlet\nGiant Slayer\nApex Inventor') === 3, 'three content lines counted');
ok(MAYHEM_AUTO_MIN_LINES === 3, 'auto-mode relax needs three OCR lines');

console.log('--- auto minMatches relax ---');
ok(
  effectiveAutoMinMatches({ configured: 2, fuzzyScore: 0.92, contentLines: 3 }) === 1,
  'high fuzzy score + three lines relaxes minMatches to 1'
);
ok(
  effectiveAutoMinMatches({ configured: 2, fuzzyScore: 0.92, contentLines: 2 }) === 2,
  'two lines are not enough to relax'
);
ok(
  effectiveAutoMinMatches({ configured: 2, fuzzyScore: 0.5, contentLines: 3 }) === 2,
  'low fuzzy score keeps minMatches at 2'
);
ok(
  effectiveAutoMinMatches({ configured: 2, fuzzyScore: 0.92, contentLines: 3 }) === 1 &&
    matchAugmentsFromOcr('Jeweled Gauntlet', augments).length === 1,
  'one clean offer can pass auto mode'
);

console.log('--- pick counting hysteresis ---');
const scan = (
  state: MayhemPickCounterState,
  offerCount: number,
  extra: Partial<Parameters<typeof observeMayhemPickScan>[1]> = {}
): MayhemPickCounterState =>
  observeMayhemPickScan(state, {
    offerCount,
    isDead: false,
    foreground: true,
    blackFrame: false,
    ...extra,
  });

let counter = createMayhemPickCounterState();
counter = scan(counter, 3);
counter = scan(counter, 3);
ok(counter.picksTaken === 0, 'offers on screen are not a pick');
counter = scan(counter, 0);
ok(counter.picksTaken === 0, 'one empty scan after offers is not a pick');
counter = scan(counter, 0);
ok(counter.picksTaken === 1, 'two empty scans after two offer scans count one pick');

ok(resolveMayhemPicksTaken(5, [], 0) === 0, 'level 5 with no offers/owned does not count a pick');
ok(resolveMayhemPicksTaken(9, ['a'], 0) === 1, 'owned augment ids still count');

let black = createMayhemPickCounterState();
black = scan(black, 3);
black = scan(black, 3);
black = scan(black, 0, { blackFrame: true });
black = scan(black, 0, { blackFrame: true });
ok(black.picksTaken === 0, 'black frames never count a pick');

let dead = createMayhemPickCounterState();
dead = scan(dead, 3);
dead = scan(dead, 3);
dead = scan(dead, 0, { isDead: true });
dead = scan(dead, 0, { isDead: true });
ok(dead.picksTaken === 0, 'death-screen frames never count a pick');

let missed = createMayhemPickCounterState();
missed = scan(missed, 3);
missed = scan(missed, 3);
missed = scan(missed, 0);
missed = scan(missed, 3);
missed = scan(missed, 0);
ok(missed.picksTaken === 0, 'a single OCR-miss frame does not count a pick');

let background = createMayhemPickCounterState();
background = scan(background, 3);
background = scan(background, 3);
background = scan(background, 0, { foreground: false });
background = scan(background, 0, { foreground: false });
ok(background.picksTaken === 0, 'background-window scans never count a pick');

let authoritative = createMayhemPickCounterState();
authoritative = scan(authoritative, 0, { liveAugmentIds: ['a', 'b'] });
ok(authoritative.picksTaken === 2, 'Live Client augment ids are ground truth');

ok(
  readLiveAugmentIds({ augments: ['a', { id: 'b' }, { augmentId: 'c' }] }).join(',') === 'a,b,c',
  'live augment rows accept ids and objects'
);
ok(readLiveAugmentIds({}).length === 0, 'missing live augments read as empty');

console.log('--- visibility thresholds ---');
ok(!isMayhemAugmentHudVisible([], false), 'no offers → hidden');
ok(!isMayhemAugmentHudVisible(['twin_fire'], false), 'one offer alone stays hidden');
ok(isMayhemAugmentHudVisible(['twin_fire', 'recursion'], false), 'two offers → visible');
ok(isMayhemAugmentHudVisible(['twin_fire'], true), 'manual scan may show one offer');
ok(
  isMayhemAugmentHudVisible(['twin_fire'], false, { consecutiveScans: 2, fuzzyScore: 0.95 }),
  'one offer seen twice at high confidence → visible'
);
ok(
  !isMayhemAugmentHudVisible(['twin_fire'], false, { consecutiveScans: 2, fuzzyScore: 0.7 }),
  'one offer at low confidence stays hidden'
);
ok(
  !isMayhemAugmentHudVisible(matchAugmentsFromOcr('Victory\nDefeat', augments), false, {
    consecutiveScans: 3,
    fuzzyScore: 0.4,
  }),
  'unrelated UI text never opens the augment HUD'
);

console.log('--- OCR output markers ---');
const raw = [
  '__OT_TARGET pid=4242 exe=League of Legends class=RiotWindowClass rect=100,50,1600,900 frame=1360x765 black=false fg=true__',
  '__OT_OCR_LANG en-US__',
  '__OT_BLACK_FRAME__',
  'Jeweled Gauntlet',
  'Giant Slayer',
].join('\r\n');
const parsed = parseMayhemOcrOutput(raw);
ok(parsed.text.trim() === 'Jeweled Gauntlet\nGiant Slayer', 'markers are stripped from OCR text');
ok(parsed.target?.pid === 4242, 'target pid parsed');
ok(parsed.target?.className === 'RiotWindowClass', 'target window class parsed');
ok(parsed.target?.frame === '1360x765', 'capture frame parsed');
ok(parsed.target?.foreground === true, 'foreground flag parsed');
ok(parsed.blackFrame === true, 'black frame marker parsed');
ok(parsed.language === 'en-US', 'OCR language parsed');
ok(parseMayhemOcrOutput('__OT_NO_TARGET__\ntext').noTarget === true, 'no-target marker parsed');

// The target marker is JSON now: the process name is "League of Legends" and
// the old space-separated marker truncated it at the first space.
const jsonRaw = [
  '__OT_TARGET__{"pid":4242,"exe":"League of Legends","class":"RiotWindowClass","rect":"100,50,1600,900","frame":"1360x765","black":false,"fg":true}',
  'Jeweled Gauntlet',
].join('\r\n');
const jsonParsed = parseMayhemOcrOutput(jsonRaw);
ok(jsonParsed.text.trim() === 'Jeweled Gauntlet', 'JSON target marker is stripped from OCR text');
ok(jsonParsed.target?.exe === 'League of Legends', 'JSON target keeps the full exe name (League of Legends)');
ok(jsonParsed.target?.pid === 4242, 'JSON target pid parsed');
ok(jsonParsed.target?.className === 'RiotWindowClass', 'JSON target class parsed');
ok(jsonParsed.target?.rect === '100,50,1600,900', 'JSON target rect parsed');
ok(jsonParsed.target?.frame === '1360x765', 'JSON target frame parsed');
ok(jsonParsed.target?.black === false && jsonParsed.target?.foreground === true, 'JSON target flags parsed');
ok(
  fs
    .readFileSync(path.join(root, 'electron', 'scripts', 'mayhem-ocr.ps1'), 'utf8')
    .includes('__OT_TARGET__'),
  'the PowerShell capture script emits the JSON target marker'
);

console.log('--- capture masking ---');
const mask = mayhemPanelMaskRect({ x: 0, y: 0, width: 2560, height: 1440 }, 1);
ok(mask.width === 380 && mask.height === 220, 'mask uses the panel footprint');
ok(mask.x + mask.width === Math.round(2560 * 0.982), 'mask is anchored to the right rail');
ok(mask.x > 1280, 'mask sits on the right half, away from centred cards');
ok(formatMaskRects([mask]) === `${mask.x},${mask.y},380,220`, 'mask rects serialize for PowerShell');
ok(parseMaskRects(formatMaskRects([mask]))[0]?.width === 380, 'mask rects parse back');
const capture = { x: 204, y: 259, width: 2150, height: 892 };
const local = maskRectInCapture(mask, capture);
ok(!!local && local.x + local.width <= capture.width, 'mask is clipped into the capture rect');
ok(maskRectInCapture({ x: 0, y: 0, width: 10, height: 10 }, capture) === null, 'rects outside the crop are dropped');

console.log('--- main/renderer wiring (classic ARAM cannot activate Mayhem) ---');
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');
const monitorSource = read(path.join('electron', 'game-monitor.ts'));
const overlayAppSource = read(path.join('src', 'overlay', 'OverlayApp.tsx'));
const aramOverlaySource = read(path.join('src', 'logic', 'aramOverlay.ts'));
const overlayLogicSource = read(path.join('src', 'overlay', 'overlayLogic.ts'));
ok(/detectMayhemMode\(/.test(monitorSource), 'game-monitor classifies through detectMayhemMode');
ok(/queueId: matchQueueId/.test(monitorSource), 'game-monitor passes the captured queue id');
ok(/mode-detect/.test(monitorSource), 'game-monitor logs mode-detect to overlay.log');
ok(
  /isMayhemGame\(state\.gameMode, state\.mapName, \{[\s\S]{0,240}queueId: state\.queueId/.test(overlayAppSource),
  'OverlayApp passes queueId into the Mayhem check'
);
ok(/queueId: state\.queueId/.test(aramOverlaySource), 'aramOverlay passes queueId into the Mayhem check');
ok(
  /isAramOrMayhem\(state\.gameMode, state\.mapName, \{[\s\S]{0,160}queueId: state\.queueId/.test(
    overlayLogicSource
  ),
  'overlayLogic passes queueId into the ARAM check'
);

console.log('--- overlay.log line shapes (C3 evidence surface) ---');
const modeLine = formatOverlayLogLine(Date.now(), 'mode-detect', {
  gameMode: 'ARAM',
  mapName: 'Map12',
  queueId: 450,
  mapId: 12,
  result: 'aram',
});
ok(
  / mode-detect gameMode=ARAM mapName=Map12 queueId=450 mapId=12 result=aram$/.test(modeLine),
  'mode-detect line carries gameMode/mapName/queueId/mapId/result'
);
const targetLine = formatOverlayLogLine(Date.now(), 'ocr-target', {
  pid: 4242,
  exe: 'League of Legends',
  class: 'RiotWindowClass',
  rect: '100,50,1600,900',
  frame: '1360x765',
  black: false,
});
ok(
  / ocr-target pid=4242 exe=League of Legends class=RiotWindowClass rect=100,50,1600,900 frame=1360x765 black=false$/.test(
    targetLine
  ),
  'ocr-target line carries pid/exe/class/rect/frame/black'
);

console.log('--- harder fixture OCR ---');
async function runOcrFixtures(): Promise<void> {
  const fixtureDir = path.join(root, 'scripts', 'fixtures', 'mayhem');
  const busy = [
    {
      file: 'busy-1280x720.png',
      expect: ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'],
    },
    {
      file: 'busy-2560x1440.png',
      expect: ['recursion', 'shrink_engine', 'blunt_force'],
    },
  ];
  for (const fx of busy) {
    const file = path.join(fixtureDir, fx.file);
    ok(fs.existsSync(file), `fixture ${fx.file} exists`);
    if (!fs.existsSync(file)) continue;
  }
  if (process.platform !== 'win32') {
    console.log('skip OCR fixtures (non-Windows): Windows.Media.Ocr is required');
    return;
  }
  for (const fx of busy) {
    const file = path.join(fixtureDir, fx.file);
    if (!fs.existsSync(file)) continue;
    const text = await runMayhemOcrOnImageFile(file, root);
    const ids = matchAugmentsFromOcr(text, augments);
    const hits = fx.expect.filter((id) => ids.includes(id));
    console.log(`${fx.file} snippet:`, text.replace(/\s+/g, ' ').slice(0, 120));
    console.log(`${fx.file} ids:`, ids.join(', '));
    ok(text.trim().length > 8, `${fx.file}: OCR produced text`);
    ok(hits.length >= 2, `${fx.file}: ≥2 correct offers (${hits.join(', ')})`);
  }
  const unrelatedFile = path.join(fixtureDir, 'unrelated-ui-1280x720.png');
  if (fs.existsSync(unrelatedFile)) {
    const text = await runMayhemOcrOnImageFile(unrelatedFile, root);
    const ids = matchAugmentsFromOcr(text, augments);
    console.log('unrelated-ui snippet:', text.replace(/\s+/g, ' ').slice(0, 120));
    ok(ids.length === 0, 'unrelated UI fixture yields no augment offers');
  }
}

void runOcrFixtures().then(() => {
  if (!process.exitCode) console.log('verify:mayhem-live ok');
});
