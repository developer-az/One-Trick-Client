/**
 * Brief F guardrail: a reroll must re-rank the new offers, and an augment the
 * bundle does not know must stay on the roll instead of being dropped.
 *
 * Pure: no Electron, no OCR process, no network. Proves
 *   1. a disjoint 3-card set replaces the roll with no "reroll" text;
 *   2. a disjoint 1-2 card set is accepted as a new roll;
 *   3. an overlapping partial set still retains the previous roll;
 *   4. offers → empty → disjoint offers does not count a pick;
 *   5. ranking follows the current roll and is stable for the same roll;
 *   6. an unknown offered name becomes an `unknown:` row ranked last;
 *   7. the bundle freshness policy (patch / age / missing cache / offline);
 *   8. shop/scoreboard chrome and realistic in-band junk (scoreboard names,
 *      kill callouts, the death screen) never become offers: a placeholder is
 *      only emitted beside a known card or on a match already known to be
 *      Mayhem, so junk can neither latch Mayhem on a classic ARAM match nor
 *      invent a pick;
 *   9. `unknown:` placeholders still display and rank, but never enter the
 *      trust path (`frameIds`);
 *  10. a new augment level clears the empty-burst streak, so two unlucky empty
 *      bursts cannot kill level 7/11/15 discovery;
 *  11. a stale bundle (1 known + 2 placeholders) still arms the pick counter,
 *      while a 0-known junk frame and a 1-known + junk frame still cannot;
 *  12. through the real `mayhem-likely` gate (mode -> `mayhemMatch` -> the OCR
 *      path, pinned as source text so §12 reads the real gate): a patch-day roll
 *      of three unknown titles still displays all three rows, displays nothing
 *      in the trust path, never latches or counts, and never evicts a known 1-2
 *      row roll or arms the fast poll. A shop-shaped 3-row all-unknown roll is
 *      the patch-day reroll itself: it replaces the retired display roll, still
 *      without arming the poll or counting.
 */
import bundle from './src/data/mayhem/bundle.json';
import fs from 'node:fs';
import path from 'node:path';
import {
  isUnknownMayhemAugmentId,
  matchAugmentOffersFromOcr,
  matchAugmentsFromOcr,
  MAYHEM_UNKNOWN_AUGMENT_PREFIX,
  unknownMayhemAugmentLabel,
} from './src/logic/mayhem/match';
import {
  isNewMayhemOfferRoll,
  stabilizeMayhemOffers,
  type MayhemOfferStabilityState,
} from './src/logic/mayhem/offerStability';
import { acceptMayhemOfferFrame } from './src/logic/mayhem/offerAcceptance';
import {
  createMayhemMonitorState,
  mayhemMonitorWantsScan,
  noteMayhemDiscoveryTrigger,
  runMayhemMonitorScan,
  type MayhemMonitorRead,
} from './src/logic/mayhem/monitor';
import { detectMayhemMode, isMayhemMode, type MayhemModeSignals } from './src/logic/mayhem/mode';
import {
  detectMayhemOffers,
  isMayhemOcrRerollPending,
  resetMayhemOcrCache,
  setMayhemOcrRetainOffers,
} from './electron/mayhem-ocr';
import {
  createMayhemPickCounterState,
  observeMayhemPickScan,
  revertMayhemRerollPick,
} from './src/logic/mayhem/pickCount';
import { rankMayhemChoices } from './src/logic/mayhem/rank';
import {
  refreshMayhemBundleIfStale,
  shouldRefreshMayhemBundle,
} from './src/logic/mayhem/remote';
import type { MayhemBundle } from './src/logic/mayhem/types';
import type { Champion } from './src/logic/pykeLogic';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const data = bundle as MayhemBundle;
const kayn: Champion = {
  id: 'Kayn',
  key: '141',
  name: 'Kayn',
  tags: ['Assassin', 'Fighter'],
  damageType: 'Physical',
};

const ROLL_A = ['recursion', 'shrink_engine', 'blunt_force'];
const ROLL_B = ['jeweled_gauntlet', 'giant_slayer', 'apex_inventor'];
const OCR_B = 'Jeweled Gauntlet\nGiant Slayer\nApex Inventor';

function freshState(): MayhemOfferStabilityState {
  return { rerollPending: false };
}

function countRankOrder(ids: string[]): string {
  return ids.join('>');
}

/** A queue-450 Howling Abyss match: real Mayhem sometimes reports it. */
const CLASSIC_450: MayhemModeSignals = {
  gameMode: 'ARAM',
  mapName: 'Map12',
  queueId: 450,
  mapId: 12,
};

/**
 * One OCR frame built through the real matcher + acceptance seam, exactly as
 * mayhem-ocr.ts builds it (the trust path is `frameIds`, never the display ids).
 */
function readFromOcr(text: string, fuzzyScore = 0.95, mayhemMatch = false): MayhemMonitorRead {
  const matched = matchAugmentsFromOcr(text, data.augments, mayhemMatch);
  const accepted = acceptMayhemOfferFrame({
    text,
    matched,
    minMatches: 2,
    fuzzyScore,
    previousIds: [],
    retain: false,
    stability: freshState(),
  });
  return {
    ids: accepted.ids,
    candidateIds: accepted.candidateIds,
    frameIds: accepted.frameIds,
    frameDisplayCount: accepted.frameIds.length + accepted.placeholderIds.length,
    fresh: true,
    valid: true,
    fuzzyScore,
    blackFrame: false,
    foreground: true,
    owner: true,
    fallback: false,
  };
}

function monitorInput(now: number, level: number, isDead = false) {
  return {
    now,
    level,
    isDead,
    signals: CLASSIC_450,
    liveAugmentIds: [],
    autoOcrAllowed: false,
  };
}

/** Run one bounded discovery burst, as game-monitor does for a queue-450 match. */
async function discoveryScans(
  state: ReturnType<typeof createMayhemMonitorState>,
  reads: MayhemMonitorRead[],
  startAt: number
): Promise<{ state: ReturnType<typeof createMayhemMonitorState>; counted: number; scans: number }> {
  noteMayhemDiscoveryTrigger(
    state,
    { now: startAt, level: 3, isDead: false, signals: CLASSIC_450 },
    { anyAramQueue: true }
  );
  let counted = 0;
  let scans = 0;
  let index = 0;
  for (const read of reads) {
    const result = await runMayhemMonitorScan(
      state,
      monitorInput(startAt + index * 10_000),
      async () => read
    );
    state = result.state;
    counted += result.counted;
    if (result.scanned) scans += 1;
    index += 1;
  }
  return { state, counted, scans };
}

async function main(): Promise<void> {
  const ids = new Set(data.augments.map((a) => a.id));
  ok(ROLL_A.every((id) => ids.has(id)), 'roll A ids exist in the bundle');
  ok(ROLL_B.every((id) => ids.has(id)), 'roll B ids exist in the bundle');

  // --- 1. disjoint 3-card roll replaces the previous roll, no reroll text ---
  console.log('--- 1. reroll detected from the offer set ---');
  {
    const text = OCR_B; // no "reroll" anywhere
    ok(!/\breroll\b/i.test(text), 'the OCR text carries no "reroll" word');
    const matched = matchAugmentsFromOcr(text, data.augments);
    ok(countRankOrder(matched) === countRankOrder(ROLL_B), `matcher reads roll B (${matched.join(',')})`);
    const state = freshState();
    const next = stabilizeMayhemOffers(ROLL_A, matched, text, true, state);
    ok(isNewMayhemOfferRoll(ROLL_A, matched), 'roll B is disjoint from roll A');
    ok(countRankOrder(next) === countRankOrder(matched) && next.length === 3, 'disjoint triple replaces the roll');
    ok(!next.some((id) => ROLL_A.includes(id)), 'no stale id from the previous roll survives');
    ok(state.rerollPending === false, 'a complete new roll needs no fast poll');
  }

  // --- 2. a disjoint 1-2 card read is a new roll too ---
  console.log('--- 2. partial reroll read is accepted ---');
  for (const size of [1, 2]) {
    const state = freshState();
    const partial = ROLL_B.slice(0, size);
    const next = stabilizeMayhemOffers(ROLL_A, partial, 'cards animating', true, state);
    ok(countRankOrder(next) === countRankOrder(partial), `disjoint ${size}-card read is accepted`);
    ok(!next.some((id) => ROLL_A.includes(id)), `no roll-A id retained on the ${size}-card read`);
    ok(state.rerollPending === true, `${size}-card reroll arms the fast poll`);
  }

  // --- 3. overlapping partial read of the same roll still retains ---
  console.log('--- 3. partial read of the same roll keeps the triple ---');
  {
    const state = freshState();
    const next = stabilizeMayhemOffers(ROLL_A, [ROLL_A[0]], 'still choosing', true, state);
    ok(countRankOrder(next) === countRankOrder(ROLL_A), 'overlap keeps the previous triple');
    ok(state.rerollPending === false, 'overlap is not a reroll');
  }

  // --- 4. offers → empty → disjoint offers is a reroll, not a pick ---
  console.log('--- 4. a reroll gap does not count a pick ---');
  {
    let counter = createMayhemPickCounterState();
    const scan = (state: typeof counter, offerCount: number) =>
      observeMayhemPickScan(state, {
        offerCount,
        isDead: false,
        foreground: true,
        blackFrame: false,
      });
    counter = scan(counter, 3); // roll A, frame 1
    counter = scan(counter, 3); // roll A, frame 2
    counter = scan(counter, 0); // shop animating
    counter = scan(counter, 0); // still animating → the counter books a pick here
    ok(counter.picksTaken === 1, 'the empty gap books a provisional pick (engine limit)');
    const reverted = revertMayhemRerollPick(counter, ROLL_A, ROLL_B, 1500);
    ok(reverted.reverted, 'a disjoint roll inside the reroll window takes it back');
    ok(reverted.state.picksTaken === 0, 'offers → empty → disjoint offers ends at zero picks');
    const late = revertMayhemRerollPick(counter, ROLL_A, ROLL_B, 60_000);
    ok(!late.reverted && late.state.picksTaken === 1, 'a real next-level roll after the window still counts');
    const overlap = revertMayhemRerollPick(counter, ROLL_A, [ROLL_A[0], ROLL_B[0]], 1500);
    ok(!overlap.reverted && overlap.state.picksTaken === 1, 'an overlapping roll is not a reroll');

    // Patch day: the next shop is three titles the bundle does not know. They
    // are trivially disjoint from a known roll, but a placeholder is a guess,
    // not evidence — it must not take a real pick back (the OCR counter is
    // authoritative when `owned` is empty).
    const placeholderNext = revertMayhemRerollPick(
      counter,
      ROLL_A,
      ['unknown:x', 'unknown:y', 'unknown:z'],
      1500
    );
    ok(
      !placeholderNext.reverted && placeholderNext.state.picksTaken === 1,
      'an all-unknown roll never reverts a pick'
    );
    const placeholderPrevious = revertMayhemRerollPick(
      counter,
      ['unknown:x', 'unknown:y', 'unknown:z'],
      ROLL_B,
      1500
    );
    ok(
      !placeholderPrevious.reverted && placeholderPrevious.state.picksTaken === 1,
      'an all-unknown previous roll never reverts a pick either'
    );
  }

  // --- 5. ranking follows the accepted roll ---
  console.log('--- 5. ranking follows the roll ---');
  {
    const rankedA = rankMayhemChoices(kayn, [], ROLL_A, data);
    const rankedB = rankMayhemChoices(kayn, [], ROLL_B, data);
    ok(rankedA.map((r) => r.augmentId).sort().join(',') === [...ROLL_A].sort().join(','), 'roll A ranks exactly roll A');
    ok(rankedB.map((r) => r.augmentId).sort().join(',') === [...ROLL_B].sort().join(','), 'roll B ranks exactly roll B');
    ok(
      rankedA.map((r) => `${r.augmentId}:${r.score}`).join('|') !==
        rankedB.map((r) => `${r.augmentId}:${r.score}`).join('|'),
      'the new roll produces a different ranking'
    );
    const again = rankMayhemChoices(kayn, [], ROLL_B, data);
    ok(JSON.stringify(again) === JSON.stringify(rankedB), 'the same roll ranks identically twice');
    // Through the real acceptance seam: a reroll's ids are what get ranked.
    const state = freshState();
    const accepted = stabilizeMayhemOffers(ROLL_A, matchAugmentsFromOcr(OCR_B, data.augments), OCR_B, true, state);
    const rankedAfter = rankMayhemChoices(kayn, [], accepted, data);
    ok(rankedAfter.map((r) => r.augmentId).sort().join(',') === [...ROLL_B].sort().join(','), 'the HUD ranks the accepted roll only');
    // The reported bug: a reroll read as two cards must rank the two NEW cards.
    const partialState = freshState();
    const partialAccepted = stabilizeMayhemOffers(ROLL_A, ROLL_B.slice(0, 2), 'cards animating', true, partialState);
    const rankedPartial = rankMayhemChoices(kayn, [], partialAccepted, data);
    ok(
      rankedPartial.map((r) => r.augmentId).sort().join(',') === [...ROLL_B.slice(0, 2)].sort().join(','),
      'a partial reroll ranks the new cards, not the old roll'
    );
  }

  // --- 6. unknown augment keeps its place, ranked last ---
  console.log('--- 6. augment missing from the bundle ---');
  {
    const unknownName = 'Chrono Surge';
    const text = `Jeweled Gauntlet\nGiant Slayer\n${unknownName}`;
    const matched = matchAugmentsFromOcr(text, data.augments);
    const placeholder = `${MAYHEM_UNKNOWN_AUGMENT_PREFIX}chrono surge`;
    ok(matched.length === 3, `the roll keeps all three cards (${matched.join(',')})`);
    ok(matched.includes(placeholder), 'the unknown card becomes a stable unknown: row');
    ok(matched.indexOf(placeholder) === 2, 'it sits after the known cards, in card order');
    ok(!data.augments.some((a) => a.id === placeholder), 'the placeholder is not a fabricated bundle id');

    const ranked = rankMayhemChoices(kayn, [], matched, data);
    ok(ranked.length === 3, 'the panel gets a row for every offered card');
    const last = ranked[ranked.length - 1];
    ok(isUnknownMayhemAugmentId(last.augmentId) && last.augmentId === placeholder, 'the unknown row ranks last');
    ok(last.verdict === 'skip', 'the unknown row is never a pick');
    ok(last.name === unknownMayhemAugmentLabel(placeholder), `the row keeps the OCR title (${last.name})`);

    const knownOnly = rankMayhemChoices(kayn, [], matched.slice(0, 2), data);
    const knownRowsInRoll = ranked.filter((r) => !isUnknownMayhemAugmentId(r.augmentId));
    ok(
      countRankOrder(knownRowsInRoll.map((r) => r.augmentId)) === countRankOrder(knownOnly.map((r) => r.augmentId)),
      'known cards keep their relative order'
    );
  }

  // --- 7. bundle freshness policy ---
  console.log('--- 7. bundle freshness policy ---');
  {
    const now = Date.UTC(2026, 10, 17, 12, 0, 0);
    const meta = { patch: '26.21', syncedAt: new Date(now - 60 * 60 * 1000).toISOString() };

    const patchMoved = shouldRefreshMayhemBundle({ cached: meta, currentPatch: '26.22', nowMs: now });
    ok(patchMoved.refresh && patchMoved.reason === 'patch-mismatch', 'a new game patch forces a refresh');

    const crossScheme = shouldRefreshMayhemBundle({
      cached: { patch: '26.22', syncedAt: meta.syncedAt },
      currentPatch: '16.23.1',
      nowMs: now,
    });
    ok(crossScheme.reason === 'patch-mismatch', 'season-year and client patch schemes compare by minor');
    const samePatchAcrossSchemes = shouldRefreshMayhemBundle({
      cached: { patch: '26.23', syncedAt: meta.syncedAt },
      currentPatch: '16.23.1',
      nowMs: now,
    });
    ok(!samePatchAcrossSchemes.refresh, 'the same minor is the same patch in both schemes');

    const fresh = shouldRefreshMayhemBundle({ cached: meta, currentPatch: '26.21', nowMs: now });
    ok(!fresh.refresh && fresh.reason === 'fresh', 'same patch, synced an hour ago → no refresh');

    const noCache = shouldRefreshMayhemBundle({ cached: null, currentPatch: '26.21', nowMs: now });
    ok(noCache.refresh && noCache.reason === 'missing-cache', 'no cache at all → refresh');

    const old = shouldRefreshMayhemBundle({
      cached: { patch: '26.21', syncedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
      currentPatch: '26.21',
      nowMs: now,
    });
    ok(old.refresh && old.reason === 'stale', 'same patch but older than 24 h → refresh');

    const existing = { marker: 'cached-bundle' };
    let fetches = 0;
    const offline = await refreshMayhemBundleIfStale({
      cached: meta,
      currentPatch: '26.22',
      existing,
      nowMs: now,
      fetchBundle: async () => {
        fetches += 1;
        throw new Error('offline');
      },
    });
    ok(fetches === 1, 'the policy attempted the fetch once');
    ok(!offline.refreshed && offline.bundle === existing, 'a failed fetch keeps the existing bundle');
    ok(!!offline.error, 'the failure is reported, not thrown');

    const replaced = await refreshMayhemBundleIfStale({
      cached: meta,
      currentPatch: '26.22',
      existing,
      nowMs: now,
      fetchBundle: async () => ({ marker: 'fresh-bundle' }),
    });
    ok(replaced.refreshed && replaced.bundle?.marker === 'fresh-bundle', 'a successful refresh replaces the bundle');

    let skipped = 0;
    const notStale = await refreshMayhemBundleIfStale({
      cached: meta,
      currentPatch: '26.21',
      existing,
      nowMs: now,
      fetchBundle: async () => {
        skipped += 1;
        return { marker: 'unused' };
      },
    });
    ok(skipped === 0 && !notStale.refreshed, 'fresh data never hits the network');
  }

  // --- 8. shop chrome cannot look like an offer, latch Mayhem, or count ---
  console.log('--- 8. shop chrome lines are not offers ---');
  {
    // Both lines are title case with real letters, which the old placeholder
    // rule accepted: two of them in one frame read as "two offers", latched a
    // classic ARAM match as Mayhem and (offers → empty → empty) booked a pick.
    const junk = 'RECOMMENDED\nALL FILTERS';
    const junkMatch = matchAugmentOffersFromOcr(junk, data.augments);
    ok(junkMatch.ids.length === 0, `shop chrome is not a placeholder offer (${junkMatch.ids.join(',')})`);
    ok(junkMatch.placeholderIds.length === 0, 'shop chrome produces no placeholder rows');

    // The denylist does not know these: every one is realistic in-band
    // title-case text (scoreboard names, kill callouts, the death screen) that
    // the placeholder rule used to admit. They must draw nothing either.
    for (const junkLine of ['YASUO', 'ASHE', 'Double Kill', 'You Have Been Slain']) {
      const lineMatch = matchAugmentOffersFromOcr(junkLine, data.augments);
      ok(
        lineMatch.ids.length === 0 && lineMatch.placeholderIds.length === 0,
        `${junkLine} is not a placeholder offer (${lineMatch.ids.join(',')})`
      );
    }
    // Every word two letters long ("Ah Ri") is a roster/scoreboard artifact, not
    // a card title. "Ez Real" and "AD Carry" still pass the placeholder rule, so
    // pin both decisions: they may display on a proven Mayhem match, but they are
    // never a known card and never trust-path evidence.
    const ahRi = matchAugmentOffersFromOcr('Ah Ri', data.augments, true);
    ok(
      ahRi.ids.length === 0 && ahRi.placeholderIds.length === 0,
      `"Ah Ri" is not a placeholder offer even on a Mayhem match (${ahRi.ids.join(',')})`
    );
    for (const shortName of ['Ez Real', 'AD Carry']) {
      const alone = matchAugmentOffersFromOcr(shortName, data.augments);
      ok(
        alone.ids.length === 0,
        `"${shortName}" alone draws nothing when Mayhem is not proven (${alone.ids.join(',')})`
      );
      const proven = matchAugmentOffersFromOcr(shortName, data.augments, true);
      ok(
        proven.placeholderIds.length === 1 && proven.knownIds.length === 0,
        `"${shortName}" is a display-only placeholder on a Mayhem match (${proven.ids.join(',')})`
      );
      const besideKnown = matchAugmentOffersFromOcr(`Jeweled Gauntlet\n${shortName}`, data.augments);
      ok(
        besideKnown.knownIds.length === 1 && besideKnown.placeholderIds.length === 1,
        `"${shortName}" beside a known card stays out of the trust path`
      );
    }
    for (const junkFrameText of ['YASUO\nASHE', 'Double Kill\nYou Have Been Slain']) {
      const frameMatch = matchAugmentOffersFromOcr(junkFrameText, data.augments);
      ok(
        frameMatch.ids.length === 0,
        `a junk-only frame draws no rows (${junkFrameText.replace(/\n/g, ' / ')})`
      );
    }

    const junkFrame = readFromOcr(junk, 0.2);
    ok(junkFrame.frameIds.length === 0, 'a junk frame has nothing in the trust path');
    ok(junkFrame.ids.length === 0, 'a junk frame draws nothing');

    const run = await discoveryScans(
      createMayhemMonitorState(),
      [junkFrame, junkFrame, readFromOcr(''), readFromOcr('')],
      20_000_000
    );
    ok(run.scans === 4, `all four junk/empty frames ran as discovery scans (${run.scans})`);
    ok(run.state.discovery.latched === false, 'two junk title-case lines never latch Mayhem');
    ok(run.counted === 0 && run.state.counter.picksTaken === 0, 'a junk frame never invents a pick');

    // A junk-only frame on a classic ARAM map must not even reach displayIds:
    // two display rows are what flipped `mayhemMonitorMode` to mayhem there.
    const realisticJunk = readFromOcr('YASUO\nASHE', 0.3);
    const junkOnly = await discoveryScans(createMayhemMonitorState(), [realisticJunk], 20_500_000);
    ok(
      junkOnly.state.displayIds.length === 0,
      `a scoreboard-only frame leaves displayIds empty (${junkOnly.state.displayIds.join(',')})`
    );
  }

  // --- 9. placeholders display and rank, but stay out of the trust path ---
  console.log('--- 9. placeholders display but never prove an offer ---');
  {
    const rollText = 'Jeweled Gauntlet\nChrono Surge\nThe Timeless';
    // The split matcher is the contract: display ids vs the trust path.
    const splitMatcher = matchAugmentOffersFromOcr as
      | typeof matchAugmentOffersFromOcr
      | undefined;
    if (typeof splitMatcher !== 'function') {
      ok(false, 'the matcher splits known ids from placeholders');
    } else {
      const matched = splitMatcher(rollText, data.augments);
      ok(matched.ids.length === 3, `all three cards are read (${matched.ids.join(',')})`);
      ok(matched.knownIds.join(',') === 'jeweled_gauntlet', 'only the bundled card is a known id');
      ok(matched.placeholderIds.length === 2, 'the two unknown titles are placeholders');

      const accepted = acceptMayhemOfferFrame({
        text: rollText,
        matched: matched.ids,
        minMatches: 2,
        fuzzyScore: 0.95,
        previousIds: [],
        retain: false,
        stability: freshState(),
      });
      ok(accepted.ids.length === 3, 'placeholders still appear as offers on screen');
      ok(accepted.frameIds.join(',') === 'jeweled_gauntlet', 'only the bundle match reaches the trust path');
      ok(accepted.placeholderIds.length === 2, 'the acceptance seam reports placeholders separately');

      const ranked = rankMayhemChoices(kayn, [], accepted.ids, data);
      const last = ranked[ranked.length - 1];
      ok(ranked.length === 3, 'the panel still gets a row for every offered card');
      ok(isUnknownMayhemAugmentId(last.augmentId), 'a placeholder row still ranks last');
      ok(last.verdict === 'skip', 'a placeholder row never wins "Pick n"');
      ok(
        ranked.filter((r) => isUnknownMayhemAugmentId(r.augmentId)).every((r) => r.verdict === 'skip'),
        'no placeholder row is ever a pick'
      );
    }

    // One bundled card plus two placeholders must not reach the latch's two.
    const run = await discoveryScans(
      createMayhemMonitorState(),
      [readFromOcr(rollText)],
      21_000_000
    );
    ok(run.state.displayIds.length === 3, `the three rows are on screen (${run.state.displayIds.join(',')})`);
    ok(run.state.discovery.latched === false, 'one known card plus placeholders does not latch Mayhem');

    // A genuine post-patch roll reads 0 known cards. When the match is already
    // Mayhem the caller says so, and the all-unknown roll still displays — this
    // is what the stricter placeholder gate must not cost us.
    const allUnknown = 'Chrono Surge\nThe Timeless';
    const mayhemFrame = readFromOcr(allUnknown, 0.95, true);
    ok(mayhemFrame.ids.length === 2, `an all-unknown Mayhem roll still displays (${mayhemFrame.ids.join(',')})`);
    ok(mayhemFrame.frameIds.length === 0, 'its trust path is still empty');
    const unprovenFrame = readFromOcr(allUnknown, 0.95, false);
    ok(
      unprovenFrame.ids.length === 0,
      `the same all-unknown frame draws nothing when the match is not proven Mayhem (${unprovenFrame.ids.join(',')})`
    );
  }

  // --- 10. a new level keeps discovery alive after empty bursts ---
  console.log('--- 10. a level hit clears the empty-burst streak ---');
  {
    const state = createMayhemMonitorState();
    const t = 30_000_000;
    const trigger = (now: number, level: number, isDead: boolean): boolean =>
      noteMayhemDiscoveryTrigger(state, { now, level, isDead, signals: CLASSIC_450 }, { anyAramQueue: true });

    ok(trigger(t, 3, false), 'level 3 opens the first burst');
    ok(trigger(t + 91_000, 3, true), 'an empty level-3 burst is followed by a death burst');
    ok(state.discovery.emptyBursts === 1, `the empty burst is counted (${state.discovery.emptyBursts})`);
    // Level 7 arrives after two bursts that read nothing at all (black frame /
    // shop not open yet). Before the fix this set `exhausted` forever.
    ok(trigger(t + 182_000, 7, false), 'level 7 still opens a burst after two empty ones');
    ok(state.discovery.exhausted === false, 'two empty bursts do not end discovery before level 7');
    ok(state.discovery.emptyBursts === 0, 'the new augment level cleared the empty streak');
    ok(
      state.discovery.bursts === 1 && state.discovery.scans === 0,
      `the new level restarts the per-level burst/scan budget (${state.discovery.bursts} burst, ${state.discovery.scans} scans)`
    );
    ok(
      mayhemMonitorWantsScan(state, CLASSIC_450, t + 182_000) === 'discovery',
      'the level-7 burst still wants a discovery scan'
    );
    // The hard caps are still per level: six bursts inside one level, no more.
    ok(state.discovery.bursts < 6, 'the burst cap is not bypassed by the level reset');
  }

  // --- 11. a stale bundle still counts picks ---
  console.log('--- 11. 1 known + 2 placeholders still arms the pick counter ---');
  {
    const MAYHEM: MayhemModeSignals = {
      gameMode: 'KIWI',
      mapName: 'Map12',
      queueId: 2400,
      mapId: 12,
    };
    const scanWith = async (
      start: number,
      reads: MayhemMonitorRead[]
    ): Promise<{ state: ReturnType<typeof createMayhemMonitorState>; counted: number }> => {
      let state = createMayhemMonitorState();
      let counted = 0;
      let now = start;
      for (const read of reads) {
        const result = await runMayhemMonitorScan(
          state,
          {
            now,
            level: 7,
            isDead: false,
            signals: MAYHEM,
            liveAugmentIds: [],
            autoOcrAllowed: true,
          },
          async () => read
        );
        state = result.state;
        counted += result.counted;
        now += 2_000;
      }
      return { state, counted };
    };

    // The OCR sees three cards, the bundle only knows one of them: the frame
    // trust path is a single id, so the pick counter used to see a "partial
    // read" forever and never arm its offer streak.
    const staleRead = readFromOcr('Jeweled Gauntlet\nChrono Surge\nThe Timeless', 0.97, true);
    ok(
      staleRead.frameIds.length === 1 && staleRead.ids.length === 3,
      `stale-bundle frame is 1 known + 2 placeholders (${staleRead.frameIds.join(',')} / ${staleRead.ids.length})`
    );
    const stale = await scanWith(50_000_000, [
      staleRead,
      staleRead,
      readFromOcr('', 0.2),
      readFromOcr('', 0.2),
    ]);
    ok(
      stale.counted === 1 && stale.state.counter.picksTaken === 1,
      `a 1-known roll followed by an empty shop counts the pick (${stale.state.counter.picksTaken})`
    );

    // The concession is bounded: 0 known ids can never arm the streak, even on a
    // Mayhem match where the placeholders still display.
    const junkRead = readFromOcr('YASUO\nASHE', 0.3, true);
    ok(junkRead.ids.length === 2 && junkRead.frameIds.length === 0, 'the junk frame displays 2 rows, 0 known');
    const junk = await scanWith(51_000_000, [
      junkRead,
      junkRead,
      readFromOcr('', 0.2),
      readFromOcr('', 0.2),
    ]);
    ok(junk.counted === 0, 'a 0-known junk frame still never arms the pick counter');

    // The arm gate must read THIS frame's row count, never the retained roll.
    // One known card plus one junk row is a 2-row frame, not a 3-card shop.
    const onePlusJunk = readFromOcr('Jeweled Gauntlet\nYASUO', 0.97, true);
    ok(
      onePlusJunk.frameIds.length === 1 && onePlusJunk.frameDisplayCount === 2,
      `a 1-known + junk frame is 2 rows (${onePlusJunk.frameDisplayCount})`
    );
    const mixed = await scanWith(52_000_000, [
      onePlusJunk,
      onePlusJunk,
      readFromOcr('', 0.2),
      readFromOcr('', 0.2),
    ]);
    ok(mixed.counted === 0, 'a 1-known + junk frame never arms the pick streak');
  }

  // --- 12. the mayhem-likely gate: display is not trust ---
  console.log('--- 12. mayhem-likely displays a post-patch roll and trusts none of it ---');
  {
    // The real gate: game-monitor derives `mayhemMatch` from the match mode, so
    // an unknown-queue Howling Abyss match (`mayhem-likely`) counts as a Mayhem
    // match. Handing `true` straight to the seam is what hid the regression:
    // on patch day every card can be newer than the bundle, so the frame has 0
    // known ids, nothing displays, the mode can never latch, and the panel
    // stayed blank for the whole match.
    const MAYHEM_LIKELY: MayhemModeSignals = {
      gameMode: 'ARAM',
      mapName: 'Map12',
      queueId: null,
      mapId: 12,
    };
    const mode = detectMayhemMode(MAYHEM_LIKELY);
    const mayhemMatch = isMayhemMode(mode);
    ok(
      mode === 'mayhem-likely' && mayhemMatch,
      `an unknown-queue Howling Abyss match is mayhem-likely and a gated Mayhem match (${mode})`
    );
    ok(
      !isMayhemMode('aram') && !isMayhemMode('other'),
      'classic ARAM and other modes stay outside the placeholder gate'
    );

    // Three titles the bundle does not know: exactly the patch-day shop.
    const postPatch = 'Chrono Surge\nThe Timeless\nCelestial Roar';
    const withScreen = (text: string) => async () => ({
      parsed: {
        text,
        target: { pid: 4242, exe: 'League of Legends', foreground: true },
        blackFrame: false,
        language: null,
        noTarget: false,
        fallback: false,
      },
      owner: true,
    });

    // The whole path, no hand-built frame or hand-set flag: mode -> mayhemMatch
    // -> the real matcher/acceptance seam -> the monitor engine.
    resetMayhemOcrCache();
    setMayhemOcrRetainOffers(false);
    const postPatchRead = await detectMayhemOffers(data.augments, 0, {
      minMatches: 2,
      mayhemMatch,
      readScreen: withScreen(postPatch),
    });
    ok(
      postPatchRead.ids.length === 3 && postPatchRead.ids.every((id) => isUnknownMayhemAugmentId(id)),
      `a post-patch roll displays three titled rows (${postPatchRead.ids.join(',')})`
    );
    ok(postPatchRead.frameIds.length === 0, 'none of them is a known id (the trust path stays empty)');
    ok(
      postPatchRead.frameDisplayCount === 3,
      `the frame still reports three rows for the counter's eye (${postPatchRead.frameDisplayCount})`
    );
    ok(postPatchRead.refusal === null, 'the scan really ran (no throttle/in-flight refusal)');
    ok(isMayhemOcrRerollPending() === false, 'a placeholder-only frame does not arm the fast poll');

    const postPatchScan = await runMayhemMonitorScan(
      createMayhemMonitorState(),
      {
        now: 60_000_000,
        level: 7,
        isDead: false,
        signals: MAYHEM_LIKELY,
        liveAugmentIds: [],
        autoOcrAllowed: true,
      },
      async () => postPatchRead
    );
    ok(
      postPatchScan.state.displayIds.length === 3,
      `the panel draws all three placeholders (${postPatchScan.state.displayIds.join(',')})`
    );
    ok(postPatchScan.state.discovery.latched === false, 'placeholders never latch the match as proven Mayhem');
    ok(
      postPatchScan.counted === 0 && postPatchScan.state.counter.picksTaken === 0,
      'placeholders never move the pick counter'
    );

    // A known roll already on the panel is not evicted by a 1–2 row
    // placeholder-only frame: that is a scoreboard / kill-callout guess, so the
    // HUD retains the roll and the stability guard refuses the swap.
    resetMayhemOcrCache();
    setMayhemOcrRetainOffers(false);
    const knownRead = await detectMayhemOffers(data.augments, 0, {
      minMatches: 2,
      mayhemMatch,
      readScreen: withScreen('Jeweled Gauntlet\nGiant Slayer\nRecursion'),
    });
    ok(
      knownRead.ids.length === 3 && knownRead.frameIds.length === 3,
      `a known roll is read normally first (${knownRead.ids.join(',')})`
    );
    setMayhemOcrRetainOffers(true);
    const keptRead = await detectMayhemOffers(data.augments, 0, {
      minMatches: 2,
      mayhemMatch,
      readScreen: withScreen('Reroll 2 left\nChrono Surge\nThe Timeless'),
    });
    ok(
      countRankOrder(keptRead.ids) === countRankOrder(knownRead.ids),
      `the displayed known roll survives a 2-row placeholder-only frame (${keptRead.ids.join(',')})`
    );
    ok(isMayhemOcrRerollPending() === false, 'and that frame does not arm the fast poll');
    ok(keptRead.frameIds.length === 0, 'the placeholder frame adds nothing to the trust path');

    // A THREE-row all-unknown frame is shop-shaped: on patch day that is the
    // reroll itself, so it must replace the retired roll instead of advising on
    // cards the player can no longer pick. It still arms nothing and counts
    // nothing (display ids are not trust).
    resetMayhemOcrCache();
    setMayhemOcrRetainOffers(false);
    const knownBeforeReroll = await detectMayhemOffers(data.augments, 0, {
      minMatches: 2,
      mayhemMatch,
      readScreen: withScreen('Jeweled Gauntlet\nGiant Slayer\nRecursion'),
    });
    setMayhemOcrRetainOffers(true);
    const replacedRead = await detectMayhemOffers(data.augments, 0, {
      minMatches: 2,
      mayhemMatch,
      readScreen: withScreen(`Reroll 2 left\n${postPatch}`),
    });
    ok(
      replacedRead.ids.length === 3 &&
        replacedRead.ids.every((id) => isUnknownMayhemAugmentId(id)) &&
        !replacedRead.ids.some((id) => knownBeforeReroll.ids.includes(id)),
      `a 3-row all-unknown reroll replaces the known display roll (${replacedRead.ids.join(',')})`
    );
    ok(isMayhemOcrRerollPending() === false, 'the 3-row all-unknown reroll does not arm the fast poll');
    ok(replacedRead.frameIds.length === 0, 'and it adds nothing to the trust path');

    const junkState = freshState();
    const junkAccepted = acceptMayhemOfferFrame({
      text: 'EZ REAL\nAD CARRY',
      matched: matchAugmentOffersFromOcr('EZ REAL\nAD CARRY', data.augments, mayhemMatch).ids,
      minMatches: 2,
      fuzzyScore: 0.2,
      previousIds: knownRead.ids,
      retain: true,
      stability: junkState,
    });
    ok(
      countRankOrder(junkAccepted.ids) === countRankOrder(knownRead.ids) && junkState.rerollPending === false,
      'a scoreboard-style placeholder frame likewise cannot evict the known roll or arm the poll'
    );

    // The reroll-text branch itself: an all-unknown frame must not arm the fast
    // poll even with nothing — or only placeholders — previously displayed.
    const emptyState = freshState();
    const firstShown = stabilizeMayhemOffers(
      [],
      ['unknown:x', 'unknown:y'],
      'Reroll 2 left',
      true,
      emptyState
    );
    ok(
      firstShown.length === 2 && emptyState.rerollPending === false,
      'an all-unknown frame with no previous roll still displays and never arms the fast poll'
    );
    const placeholdersOnly = freshState();
    stabilizeMayhemOffers(['unknown:a'], ['unknown:x', 'unknown:y'], 'Reroll 2 left', true, placeholdersOnly);
    ok(
      placeholdersOnly.rerollPending === false,
      'an all-unknown frame over an all-placeholder roll never arms the fast poll either'
    );

    // A real new roll is unaffected: the guard is not a freeze.
    const realState = freshState();
    const realReroll = acceptMayhemOfferFrame({
      text: OCR_B,
      matched: matchAugmentsFromOcr(OCR_B, data.augments),
      minMatches: 2,
      fuzzyScore: 0.95,
      previousIds: knownRead.ids,
      retain: true,
      stability: realState,
    });
    ok(
      countRankOrder(realReroll.ids) === countRankOrder(ROLL_B),
      'a real new roll still replaces the old one'
    );

    // §12 above is only a contract on the gate if it reads the gate. Pin the
    // two production derivations as source text: both must classify through
    // `isMayhemMode(mode)` (so `mayhem-likely` is included), not a positive
    // `mode === 'mayhem'` expression. A revert of either gate fails here.
    const monitorSource = fs.readFileSync(path.join('electron', 'game-monitor.ts'), 'utf8');
    const slice = (start: string, end: string): string => {
      const from = monitorSource.indexOf(start);
      const to = monitorSource.indexOf(end, from);
      return from >= 0 && to > from ? monitorSource.slice(from, to) : '';
    };
    const tick = slice('async function tickMayhemOcr', 'export function clearMayhemOffersForDashboard');
    ok(
      /const\s+mode\s*=\s*currentMayhemMode\(\);/.test(tick) &&
        /const\s+active\s*=\s*isMayhemMode\(mode\);/.test(tick) &&
        /mayhemMatch:\s*active/.test(tick),
      `the auto tick derives mayhemMatch from isMayhemMode(mode) (${tick.length} chars)`
    );
    const manual = slice(
      'export async function triggerManualMayhemOcrFromHotkey',
      '/** Diagnostics for the performance panel. */'
    );
    ok(
      /const\s+mode\s*=\s*currentMayhemMode\(\);/.test(manual) &&
        /const\s+modeMayhem\s*=\s*isMayhemMode\(mode\);/.test(manual) &&
        /mayhemMatch:\s*modeMayhem/.test(manual),
      `the manual hotkey derives its own mayhemMatch from isMayhemMode(mode) (${manual.length} chars)`
    );
  }

  if (failures > 0) {
    console.error(`verify:mayhem-reroll-refresh FAILED (${failures} check(s))`);
    process.exitCode = 1;
  } else {
    console.log('verify:mayhem-reroll-refresh ok');
  }
}

void main();
