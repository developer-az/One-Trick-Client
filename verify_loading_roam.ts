/**
 * verify_loading_roam.ts — the loading card for the whole load, the pet
 * roaming around your loading-screen portrait, and session-isolated history.
 *
 * Everything here is a pure function or a source check, so it runs without
 * Electron or a League client:
 *   - loading-screen geometry (blue top row, red bottom row, on-screen at the
 *     three common client resolutions, ARAM/5v5 identical);
 *   - where the card panel goes beside your portrait (and that it stays on
 *     screen and never overlaps the portrait);
 *   - the roam: 70% of goals near the home card, the bottom third without one,
 *     safe margins, bounded speed, reduced motion standing still;
 *   - the four card content states from payload fixtures;
 *   - sticky champion/stats across a later payload that omits them;
 *   - the production summaries fetcher: a new champ-select session must not
 *     join the previous one's in-flight request (injected LCU transport);
 *   - the 30 s loading-state cost at the production 8 fps cap.
 *
 * Run: npx --yes tsx verify_loading_roam.ts
 */
import fs from 'node:fs';
import {
  LOADING_PANEL_SIZE,
  LOADING_SCREEN,
  cardRect,
  loadingPanelRect,
} from './src/overlay/loadingScreenGeometry';
import {
  PET_ROAM,
  createPetState,
  createRoamState,
  insideHomeEllipse,
  petPoseFromState,
  pickRoamTarget,
  roamAnchor,
  roamSafeArea,
  stepPet,
  stepRoam,
  type RoamRect,
} from './src/app/pixelPetLogic';
import {
  computeLoadingStats,
  loadingCardState,
  mergeLoadingPayload,
  type LoadingStats,
} from './src/overlay/loadingStats';
import {
  loadingSlotFromChampSelect,
  loadingSlotFromGameflowSession,
  queueMetadataFromGameflowSession,
} from './electron/prematch-loading';
import { prematchLoadingPayload } from './electron/game-monitor';
import { getMatchHistorySummaries, type LcuRequest } from './electron/match-history';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

/** One macrotask, so a promise chain can reach the injected transport. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const RESOLUTIONS = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
  { w: 2560, h: 1440 },
];

function inside(rect: { x: number; y: number; w: number; h: number }, vw: number, vh: number): boolean {
  return rect.x >= -0.001 && rect.y >= -0.001 && rect.x + rect.w <= vw + 0.001 && rect.y + rect.h <= vh + 0.001;
}

async function main(): Promise<void> {
  console.log('--- verify:loading-roam: loading-screen geometry ---');
  for (const { w, h } of RESOLUTIONS) {
    const blueFirst = cardRect('ORDER', 0, 5, w, h);
    const redLast = cardRect('CHAOS', 4, 5, w, h);
    ok(
      blueFirst.y < redLast.y,
      `${w}x${h}: the blue (ORDER) row is drawn above the red (CHAOS) row`
    );
    ok(
      blueFirst.x === Math.min(...[0, 1, 2, 3, 4].map((i) => cardRect('ORDER', i, 5, w, h).x)),
      `${w}x${h}: index 0 is the left-most portrait of its row`
    );
    ok(
      redLast.x > cardRect('CHAOS', 0, 5, w, h).x,
      `${w}x${h}: a higher index sits further right in the row`
    );
    for (const side of ['ORDER', 'CHAOS'] as const) {
      for (let i = 0; i < 5; i += 1) {
        const rect = cardRect(side, i, 5, w, h);
        ok(inside(rect, w, h), `${w}x${h}: ${side} card ${i} stays inside the viewport`);
      }
    }
    // Aspect is League's portrait card (308:560) whatever the resolution.
    const rect = cardRect('ORDER', 2, 5, w, h);
    ok(
      Math.abs(rect.w / rect.h - LOADING_SCREEN.cardAspect) < 0.001,
      `${w}x${h}: cards keep the 308:560 portrait aspect`
    );
    // A 5v5 row is the same shape as ARAM's (League draws both as two rows of five).
    const aram = cardRect('ORDER', 1, 5, w, h);
    const rift = cardRect('ORDER', 1, 5, w, h);
    ok(aram.x === rift.x && aram.y === rift.y, `${w}x${h}: ARAM and 5v5 share the same card geometry`);
    // Every ratio is tunable from the exported constant.
    ok(
      typeof LOADING_SCREEN.rowHeightRatio === 'number' &&
        typeof LOADING_SCREEN.rowGapRatio === 'number' &&
        typeof LOADING_SCREEN.cardGapRatio === 'number',
      `${w}x${h}: row/gap ratios come from the one exported geometry constant`
    );
  }
  ok(cardRect('ORDER', 0, 5, 1920, 1080).h / 1080 > 0.4, 'a row is about 41% of the viewport height');
  ok(
    (cardRect('CHAOS', 0, 5, 1920, 1080).y -
      (cardRect('ORDER', 0, 5, 1920, 1080).y + cardRect('ORDER', 0, 5, 1920, 1080).h)) /
      1080 >
      0.03,
    'the two rows are separated by about 4% of the viewport height'
  );

  console.log('--- verify:loading-roam: the card sits beside your portrait ---');
  for (const { w, h } of RESOLUTIONS) {
    for (const [side, index] of [
      ['ORDER', 0],
      ['ORDER', 4],
      ['CHAOS', 0],
      ['CHAOS', 4],
    ] as const) {
      const home = cardRect(side, index, 5, w, h);
      const panel = loadingPanelRect(home, w, h, LOADING_PANEL_SIZE);
      ok(
        panel.x >= 0 && panel.y >= 0 && panel.x + LOADING_PANEL_SIZE.w <= w + 0.5 && panel.y + LOADING_PANEL_SIZE.h <= h + 0.5,
        `${w}x${h}: the card panel stays on-screen for ${side} ${index}`
      );
      const overlaps = !(
        panel.x + LOADING_PANEL_SIZE.w <= home.x ||
        panel.x >= home.x + home.w ||
        panel.y + LOADING_PANEL_SIZE.h <= home.y ||
        panel.y >= home.y + home.h
      );
      ok(!overlaps, `${w}x${h}: the card panel never covers your portrait (${side} ${index})`);
    }
  }
  {
    // A left-column portrait has more room on the right; the last column on the left.
    const vw = 1920;
    const vh = 1080;
    const left = loadingPanelRect(cardRect('ORDER', 0, 5, vw, vh), vw, vh, LOADING_PANEL_SIZE);
    const right = loadingPanelRect(cardRect('ORDER', 4, 5, vw, vh), vw, vh, LOADING_PANEL_SIZE);
    ok(left.x > cardRect('ORDER', 0, 5, vw, vh).x, 'a left-card portrait puts the panel on its right');
    ok(right.x < cardRect('ORDER', 4, 5, vw, vh).x, 'a right-card portrait puts the panel on its left');
  }

  console.log('--- verify:loading-roam: 70% of goals near your card ---');
  const home: RoamRect = cardRect('ORDER', 2, 5, 1920, 1080);
  const space = { width: 1920, height: 1080, home };
  {
    let seed = 0x1234abcd;
    let near = 0;
    const targets: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 1000; i += 1) {
      const picked = pickRoamTarget(space, seed);
      seed = picked.seed;
      targets.push(picked.target);
      if (insideHomeEllipse(home, picked.target.x, picked.target.y)) near += 1;
    }
    ok(near >= 700, `at least 70% of 1000 sampled goals are inside the home ellipse (got ${near / 10}%)`);
    const safe = roamSafeArea(1920, 1080);
    ok(
      targets.every((t) => t.x >= safe.minX - 0.001 && t.x <= safe.maxX + 0.001 && t.y >= safe.minY - 0.001 && t.y <= safe.maxY + 0.001),
      'every sampled goal is inside the safe area (top/bottom 6% excluded)'
    );
    ok(
      targets.some((t) => t.x < home.x) && targets.some((t) => t.x > home.x + home.w),
      'goals also reach the sides of the card'
    );
    ok(
      targets.some((t) => t.y > home.y + home.h),
      'goals reach the strip below the card'
    );
    ok(targets.some((t) => t.y < home.y + home.h * 0.4), 'some goals hop onto the card face/top');
  }

  console.log('--- verify:loading-roam: walking, speed and bounds ---');
  {
    const start = createRoamState(0, space, 42);
    let s = start;
    const safe = roamSafeArea(1920, 1080);
    let worstRatio = 0;
    let moved = 0;
    for (let i = 1; i <= 4000; i += 1) {
      const before = s;
      s = stepRoam(s, { now: i * 125, width: 1920, height: 1080, home, reducedMotion: false });
      const dist = Math.hypot(s.x - before.x, s.y - before.y);
      moved += dist;
      const ratio = dist / (PET_ROAM.speedPxPerSec * 0.125);
      if (ratio > worstRatio) worstRatio = ratio;
      ok0(
        s.x >= safe.minX - 0.001 && s.x <= safe.maxX + 0.001 && s.y >= safe.minY - 0.001 && s.y <= safe.maxY + 0.001
      );
    }
    ok(worstRatio <= 1.05, `a 125 ms step never exceeds the walk speed (worst ${worstRatio.toFixed(3)}×)`);
    ok(moved > 1000, `the pet actually walks (${Math.round(moved)} px in 500 s)`);
    ok(s.dir === 1 || s.dir === -1, 'the pet always faces a travel direction');

    const idleStart = createRoamState(0, space, 7);
    ok(!idleStart.moving, 'the pet starts at rest');
    const still = stepRoam(idleStart, { now: 500, width: 1920, height: 1080, home, reducedMotion: false });
    ok(!still.moving && still.x === idleStart.x && still.y === idleStart.y, 'it idles before the first walk');
    let later = still;
    for (let i = 1; i <= 60 && !later.moving; i += 1) {
      later = stepRoam(later, { now: 500 + i * 125, width: 1920, height: 1080, home, reducedMotion: false });
    }
    ok(later.moving, 'after the idle it picks a goal and walks');
    ok(
      PET_ROAM.idleMinMs >= 1500 && PET_ROAM.idleMaxMs <= 4000,
      'idle pauses stay in the 1.5–4 s band'
    );
  }

  console.log('--- verify:loading-roam: without a home card ---');
  {
    const bare = { width: 1600, height: 900, home: null };
    let seed = 99;
    const band = 900 * (1 - PET_ROAM.bandRatio);
    let allInBand = true;
    for (let i = 0; i < 200; i += 1) {
      const picked = pickRoamTarget(bare, seed);
      seed = picked.seed;
      if (picked.target.y < band) allInBand = false;
    }
    ok(allInBand, 'every goal without a home stays in the bottom third');
    const anchor = roamAnchor(bare);
    ok(anchor.y >= band, 'the resting anchor is in the bottom third too');
    let s = createRoamState(0, bare, 5);
    let stayed = true;
    for (let i = 1; i <= 2000; i += 1) {
      s = stepRoam(s, { now: i * 125, width: 1600, height: 900, home: null, reducedMotion: false });
      if (s.y < band) stayed = false;
    }
    ok(stayed, 'the whole wander without a home stays in the bottom third');
  }

  console.log('--- verify:loading-roam: reduced motion stands still ---');
  {
    const s0 = createRoamState(0, space, 3);
    const s1 = stepRoam(s0, { now: 1000, width: 1920, height: 1080, home, reducedMotion: true });
    const anchor = roamAnchor(space);
    ok(s1.x === anchor.x && s1.y === anchor.y, 'reduced motion puts the pet at the home anchor');
    ok(!s1.moving, 'reduced motion never walks');
  }

  console.log('--- verify:loading-roam: card content states ---');
  {
    const ready = computeLoadingStats(
      [{ championId: 64, win: true, kills: 5, deaths: 2, assists: 8, queueId: 420 }],
      64
    );
    ok(loadingCardState('Lee Sin', ready) === 'ready', 'games on the champion → the numbers state');
    ok(loadingCardState('Lee Sin', computeLoadingStats([], 64)) === 'first', 'loaded history with no game → first game');
    ok(loadingCardState('Lee Sin', null) === 'pending', 'a known pick with no stats yet → pending');
    ok(loadingCardState('', null) === 'neutral' && loadingCardState(null, null) === 'neutral', 'no pick and no stats → neutral');
    const card = fs.readFileSync('src/overlay/LoadingCard.tsx', 'utf8');
    ok(card.includes('Reading your recent games'), 'the pending state says what it is doing');
    ok(card.includes('Good luck'), 'the neutral state is a good-luck line, not a fake stat');
    ok(card.includes('First game on this champion'), 'the first-game state survives');
    ok(card.includes('ov-loading-card--placed'), 'the card has an anchored (beside your portrait) placement');
  }

  console.log('--- verify:loading-roam: sticky champion + stats for one load ---');
  {
    const stats: LoadingStats = computeLoadingStats(
      [{ championId: 64, win: true, kills: 5, deaths: 2, assists: 8, queueId: 420 }],
      64
    );
    const first = mergeLoadingPayload(null, {
      loading: true,
      championId: 64,
      championName: 'Lee Sin',
      loadingStats: stats,
    });
    const later = mergeLoadingPayload(first, { loading: true });
    ok(later.loadingStats === stats, 'a later payload that omits loadingStats keeps the card numbers');
    ok(later.championName === 'Lee Sin' && later.championId === 64, 'the champion stays for the load too');
    const partial = mergeLoadingPayload(first, { loading: true, championName: '', loadingStats: null });
    ok(partial.loadingStats === stats && partial.championName === 'Lee Sin', 'an empty champion field does not blank the card');

    const swapped = mergeLoadingPayload(first, { loading: true, championId: 246, championName: 'Qiyana' });
    ok(swapped.loadingStats === null, 'a completed pick swap drops the old champion numbers');
    ok(swapped.championName === 'Qiyana', 'a pick swap shows the new champion');

    const left = mergeLoadingPayload(first, { loading: false });
    ok(left.loadingStats === undefined || left.loadingStats === null, 'leaving the load drops the stats');

    const fresh = mergeLoadingPayload(left, { loading: true, championId: 64 });
    ok(fresh.loadingStats == null, 'the next load starts without the previous numbers');
  }

  console.log('--- verify:loading-roam: loading slot capture ---');
  {
    const session = {
      gameData: {
        teamOne: [
          { championId: 1, summonerId: 10 },
          { championId: 2, summonerId: 11 },
        ],
        teamTwo: [
          { championId: 3, summonerId: 12 },
          { championId: 4, summonerId: 13 },
          { championId: 5, summonerId: 14 },
        ],
        queue: { id: 420 },
        mapId: 11,
      },
    };
    ok(
      loadingSlotFromGameflowSession(session, { summonerId: 11 })?.side === 'ORDER' &&
        loadingSlotFromGameflowSession(session, { summonerId: 11 })?.index === 1,
      'the session names the blue side and the index inside teamOne'
    );
    const red = loadingSlotFromGameflowSession(session, { puuid: 'x' });
    ok(red === null, 'an unmatched identity has no slot');
    const redMatch = loadingSlotFromGameflowSession(
      { gameData: { teamTwo: [{ championId: 3, summonerId: 12 }, { championId: 4, summonerId: 99 }] } },
      { summonerId: 99 }
    );
    ok(redMatch?.side === 'CHAOS' && redMatch.index === 1 && redMatch.teamSize === 2, 'teamTwo is the red/CHAOS row');
    ok(redMatch?.source === 'gameflow-session', 'the session slot is marked as the trustworthy source');
    ok(
      loadingSlotFromGameflowSession(session, null) === null,
      'no local identity means no slot'
    );

    const fallback = loadingSlotFromChampSelect(
      [
        { cellId: 3 },
        { cellId: 0 },
        { cellId: 1 },
        { cellId: 2 },
      ],
      2
    );
    ok(fallback?.index === 2 && fallback.teamSize === 4, 'the champ-select fallback orders myTeam by cellId');
    ok(fallback?.side === null && fallback.source === 'champ-select', 'the fallback has no side, so it is not placed from');

    const meta = queueMetadataFromGameflowSession(session);
    ok(meta.queueId === 420 && meta.mapId === 11, 'queue id + map id come from the same session read');
    ok(
      queueMetadataFromGameflowSession(null).queueId === null,
      'a missing session reports no queue instead of throwing'
    );

    const payload = prematchLoadingPayload('GameStart', { species: 'imp', color: 'teal' });
    ok('loadingStats' in payload && payload.loadingStats === null, 'the loading payload always carries loadingStats (null when unknown)');
    ok('loadingSlot' in payload && payload.loadingSlot === null, 'the loading payload always carries loadingSlot');
    ok('queueId' in payload && 'mapId' in payload, 'the loading payload carries queueId + mapId');
  }

  console.log('--- verify:loading-roam: summaries are session-isolated ---');
  {
    let matchCalls = 0;
    const pendingPages: Array<(value: unknown) => void> = [];
    const request: LcuRequest = (method, endpoint) =>
      new Promise((resolve) => {
        // The matches route also contains "current-summoner": match the
        // summoner lookup by its own prefix, not by substring.
        if (endpoint.startsWith('/lol-summoner/')) {
          resolve({ puuid: 'me' });
          return;
        }
        matchCalls += 1;
        pendingPages.push(resolve);
      });
    const page = (gameId: number) => ({
      games: {
        games: [
          {
            gameId,
            gameCreation: 1_700_000_000_000 + gameId,
            gameDuration: 1800,
            queueId: 420,
            participants: [
              {
                participantId: 1,
                championId: 555,
                teamId: 100,
                stats: { win: true, kills: 3, deaths: 1, assists: 4 },
              },
            ],
            participantIdentities: [],
          },
        ],
      },
    });

    const first = getMatchHistorySummaries({ count: 1, session: 1, request });
    await flush();
    ok(matchCalls === 1, 'the first champ select starts one summaries request');
    const sameSession = getMatchHistorySummaries({ count: 1, session: 1, request });
    ok(sameSession === first, 'the same session joins its own in-flight request');

    // Hot requeue: the cache was reset and a new session started while the
    // first page is still in flight.
    const second = getMatchHistorySummaries({ count: 1, session: 2, request });
    await flush();
    ok(second !== first, 'a new session does not receive the old promise');
    ok(matchCalls === 2, 'a new session starts a fresh request instead of joining the pre-reset one');

    pendingPages[0](page(100));
    pendingPages[1](page(200));
    const [older, newer] = await Promise.all([first, second]);
    ok(older[0]?.gameId === 100, 'the old session gets the page it asked for');
    ok(newer[0]?.gameId === 200, 'the new session gets its own page, never the joined pre-reset result');

    const after = getMatchHistorySummaries({ count: 1, session: 3, request });
    await flush();
    ok(matchCalls === 3, 'a session with nothing in flight starts its own request');
    pendingPages[2](page(300));
    await after;
  }

  console.log('--- verify:loading-roam: 30 s loading-state cost ---');
  {
    const clockStart = performance.now();
    let roam = createRoamState(0, space, 11);
    let anim = createPetState(0, 'loading');
    let paints = 0;
    let lastKey = '';
    const FRAME_MS = 125;
    const frames = 30_000 / FRAME_MS;
    for (let i = 1; i <= frames; i += 1) {
      const now = i * FRAME_MS;
      roam = stepRoam(roam, { now, width: 1920, height: 1080, home, reducedMotion: false });
      anim = stepPet(anim, { stage: 'loading', now, hidden: false, reducedMotion: false, width: 128 });
      const pose = petPoseFromState(anim);
      const key = `${Math.round(roam.x)}|${Math.round(roam.y)}|${roam.dir}|${pose.phase.toFixed(3)}`;
      if (key !== lastKey) {
        lastKey = key;
        paints += 1;
      }
    }
    const cpuMs = performance.now() - clockStart;
    const paintsPerSec = paints / 30;
    console.log(
      `     measured: ${frames} frames / 30 s, ${paints} paints (${paintsPerSec.toFixed(2)} paints/s), ` +
        `${cpuMs.toFixed(2)} ms simulation CPU (${(cpuMs / frames).toFixed(3)} ms/frame)`
    );
    ok(paintsPerSec <= 8.01, `the loading pet stays at or below the 8 fps paint cap (${paintsPerSec.toFixed(2)}/s)`);
    ok(cpuMs < 250, `30 s of loading-state simulation stays cheap (${cpuMs.toFixed(1)} ms)`);

    const pet = fs.readFileSync('src/overlay/OverlayPet.tsx', 'utf8');
    ok(!/requestAnimationFrame/.test(pet), 'the pet is driven by a timer chain, not a continuous rAF');
    ok(/setTimeout\(/.test(pet), 'the pet uses one bounded setTimeout chain');
    ok(pet.includes('visibilitychange'), 'the chain stops while the page is hidden');
    ok(pet.includes('prefers-reduced-motion'), 'reduced motion is honoured');
    ok(pet.includes('translate3d'), 'the pet moves by a transform (small dirty rect, not a full-screen redraw)');
    const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
    const branchStart = app.indexOf('if (state.loading) {');
    const loadingBranch = app.slice(branchStart, app.indexOf('if (!state.inGame', branchStart));
    ok(loadingBranch.includes('<OverlayPet'), 'the loading branch still mounts the pet');
    ok(
      loadingBranch.includes('<LoadingCard') && loadingBranch.includes('stats={null}'),
      'the loading branch renders the card even before its stats arrive (pending state)'
    );
  }

  if (failures) {
    console.error(`verify:loading-roam FAILED (${failures})`);
    process.exit(1);
  }
  console.log('verify:loading-roam ok');
}

/** Bounds assertion that reports once (4000 steps would spam the log). */
let outOfBounds = 0;
function ok0(cond: boolean): void {
  if (!cond) outOfBounds += 1;
}

void main()
  .then(() => {
    if (outOfBounds > 0) {
      console.error(`FAIL ${outOfBounds} walked positions left the safe area`);
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('verify:loading-roam crashed:', error);
    process.exit(2);
  });
