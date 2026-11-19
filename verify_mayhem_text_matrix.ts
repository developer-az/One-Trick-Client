/**
 * Step D0/D1 — failing-first end-to-end text matrix (test only).
 *
 * Drives the pure frame-evidence seam against the frozen Step-B fixtures:
 * no Electron, no PowerShell, no implementation wiring. Before Step C1 four
 * assertions on the text-only matcher FAIL and the positive guard PASSES; the
 * seam now re-points to the geometry-gated pipeline and all five PASS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bundle from './src/data/mayhem/bundle.json';
import { parseMayhemOcrOutput, type MayhemCardSlot } from './src/logic/mayhem/ocrOutput';
import { unknownMayhemAugmentId } from './src/logic/mayhem/match';
import {
  classifyMayhemFrame,
  createMayhemPipelineState,
  type MayhemFrameEvidence,
  type MayhemFrameLine,
} from './src/logic/mayhem/pipeline';
import { acceptMayhemOfferFrame } from './src/logic/mayhem/offerAcceptance';
import { stabilizeMayhemOffers } from './src/logic/mayhem/offerStability';
import {
  createMayhemMonitorState,
  runMayhemMonitorScan,
  type MayhemMonitorRead,
} from './src/logic/mayhem/monitor';
import { revertMayhemRerollPick } from './src/logic/mayhem/pickCount';
import type { MayhemModeSignals } from './src/logic/mayhem/mode';
import type { MayhemBundle } from './src/logic/mayhem/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'test-fixtures', 'mayhem-ocr', 'labelled', 'manifest.json');
const augments = (bundle as MayhemBundle).augments;

interface OcrLine {
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}
interface Fixture {
  id: string;
  label: 'positive' | 'negative';
  synthetic: boolean;
  image: string | null;
  source: string;
  expectedIds: string[];
  expectedCardCount: 0 | 3 | 4;
  notes: string;
  rawOcr?: {
    text: string;
    lines: OcrLine[];
    cardSlots?: MayhemCardSlot[];
    cardsVisible?: boolean;
  };
}
interface Manifest {
  schema: string;
  note: string;
  fixtures: Fixture[];
}

let failures = 0;
let passes = 0;

function assert(name: string, condition: boolean): void {
  if (condition) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`);
  }
}

async function main(): Promise<void> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const fixture = (id: string): Fixture => {
    const found = manifest.fixtures.find((f) => f.id === id);
    if (!found) throw new Error(`missing frozen fixture ${id}`);
    return found;
  };
  const ocrText = (f: Fixture): string => {
    if (!f.rawOcr) throw new Error(`fixture ${f.id} has no frozen rawOcr`);
    // Peel the frozen payload with the parser production uses; the boxes ride
    // in the marker so the adapter never re-derives text or geometry.
    const marker = `__OT_LINES__${JSON.stringify(f.rawOcr.lines)}`;
    return parseMayhemOcrOutput([f.rawOcr.text, marker].join('\n')).text;
  };
  const placeholderRows = (f: Fixture): string[] => {
    if (!f.rawOcr) throw new Error(`fixture ${f.id} has no frozen rawOcr`);
    // Frozen scoreboard rows carry K/D/A stats the matcher rejects; id them
    // through the production helper to drive the stabilizer's 3-row branch.
    return f.rawOcr.lines.map((line) => unknownMayhemAugmentId(line.text));
  };
  // Drive the pixel gate with the fixture's own parsed output (text, boxes,
  // card-slot evidence and the coarse marker), not hand-written stand-ins.
  const parsedFixture = (f: Fixture): ReturnType<typeof parseMayhemOcrOutput> => {
    if (!f.rawOcr) throw new Error(`fixture ${f.id} has no frozen rawOcr`);
    const parts: string[] = [];
    if (f.rawOcr.cardsVisible !== undefined) {
      parts.push(`__OT_CARDS_VISIBLE ${f.rawOcr.cardsVisible ? 1 : 0}__`);
    }
    if (f.rawOcr.cardSlots) {
      // Frozen fixtures predate the explicit-gap contract; the live sampler emits
      // gap:0 for these bounded teal patches, so model that in the marker.
      const slots = f.rawOcr.cardSlots.map((s) => ({ ...s, gap: s.gap ?? 0 }));
      parts.push(`__OT_CARD_SLOTS__${JSON.stringify(slots)}`);
    }
    parts.push(f.rawOcr.text, `__OT_LINES__${JSON.stringify(f.rawOcr.lines)}`);
    return parseMayhemOcrOutput(parts.join('\n'));
  };
  const fromFixture = (f: Fixture, now: number): MayhemFrameEvidence => {
    const parsed = parsedFixture(f);
    return classifyMayhemFrame({
      lines: parsed.lines ?? [],
      augments,
      mode: 'mayhem-likely',
      state: createMayhemPipelineState(),
      now,
      cardsVisible: parsed.cardsVisible,
      cardSlots: parsed.cardSlots,
    });
  };

  // The production seam under test: frozen boxes in, classified evidence out.
  const state = createMayhemPipelineState();
  const frameLines = (f: Fixture): MayhemFrameLine[] => f.rawOcr?.lines ?? [];
  const evidence = (lines: MayhemFrameLine[], now: number): MayhemFrameEvidence =>
    classifyMayhemFrame({ lines, augments, mode: 'mayhem-likely', state, now });
  const readFromEvidence = (ev: MayhemFrameEvidence): MayhemMonitorRead => ({
    ids: ev.ids,
    candidateIds: [],
    frameIds: ev.knownIds,
    frameDisplayCount: ev.cardCount,
    // A frame with no geometry (or only a pending lone card) is not a usable
    // frame: it cannot arm a pick and must not purge a displayed roll.
    fresh: true,
    valid: ev.decision === 'accept',
    fuzzyScore: 0.95,
    blackFrame: false,
    foreground: true,
    owner: true,
    fallback: false,
  });
  // The production mayhem-likely match: unknown-queue Howling Abyss.
  const MAYHEM_LIKELY: MayhemModeSignals = {
    gameMode: 'ARAM',
    mapName: 'Map12',
    queueId: null,
    mapId: 12,
  };
  const now = 60_000_000;

  const junkFx = fixture('negative-one-known-two-junk');
  const junkText = ocrText(junkFx);

  // 1. An unanchored known title beside two scoreboard names must emit nothing.
  const junkEvidence = evidence(frameLines(junkFx), now);
  const junkAccept = acceptMayhemOfferFrame({
    text: junkText,
    matched: junkEvidence.ids,
    minMatches: 2,
    fuzzyScore: 0.95,
    previousIds: [],
    retain: false,
    stability: { rerollPending: false },
  });
  assert(
    'unanchored known title + two scoreboard names emits false ids',
    junkEvidence.ids.length === 0 &&
      junkEvidence.knownIds.length === 0 &&
      junkEvidence.placeholderIds.length === 0 &&
      junkAccept.ids.length === 0 &&
      junkAccept.frameIds.length === 0 &&
      junkAccept.placeholderIds.length === 0
  );

  // 2. Two such frames and two empty scans must neither count a pick nor purge.
  const junkRead = readFromEvidence(evidence(frameLines(junkFx), now));
  const emptyRead = readFromEvidence(evidence([], now));
  let monitor = createMayhemMonitorState();
  const actions: string[] = [];
  for (const [index, read] of [junkRead, junkRead, emptyRead, emptyRead].entries()) {
    const result = await runMayhemMonitorScan(
      monitor,
      {
        now: now + index * 2_000,
        level: 7,
        isDead: false,
        signals: MAYHEM_LIKELY,
        liveAugmentIds: [],
        autoOcrAllowed: true,
      },
      async () => read
    );
    monitor = result.state;
    actions.push(result.hudAction);
  }
  // The live poll's reroll reversal must not rescue a pick the junk frame made.
  const reversal = revertMayhemRerollPick(
    monitor.counter,
    junkRead.frameIds,
    placeholderRows(fixture('negative-scoreboard')),
    1_500
  );
  assert(
    'two junk frames then two empty scans do not count a pick or purge',
    monitor.counter.picksTaken === 0 && actions.every((action) => action !== 'purge') && !reversal.reverted
  );

  // 3. A three-row scoreboard frame must not evict a known roll.
  const positiveFx = fixture('positive-3-en');
  const previous = evidence(frameLines(positiveFx), now).ids;
  const scoreboardFx = fixture('negative-scoreboard');
  const scoreboardText = ocrText(scoreboardFx);
  const scoreboardEvidence = evidence(frameLines(scoreboardFx), now);
  const stability = { rerollPending: false };
  const after = stabilizeMayhemOffers(
    previous,
    scoreboardEvidence.ids,
    scoreboardText,
    true,
    stability
  );
  assert(
    'three-row scoreboard frame does not evict a known roll',
    scoreboardEvidence.placeholderIds.length === 0 &&
      after.length === previous.length &&
      after.every((id, index) => id === previous[index]) &&
      stability.rerollPending === false
  );

  // 4. A real champion-select frame must emit no augment ids on a Mayhem match.
  const championEvidence = evidence(frameLines(fixture('negative-champion-select-real')), now);
  assert(
    'champion-select emits no augment ids',
    championEvidence.ids.length === 0 &&
      championEvidence.knownIds.length === 0 &&
      championEvidence.placeholderIds.length === 0
  );

  // 5. Guard: the labelled positive frame still emits its three known ids.
  const positiveEvidence = evidence(frameLines(positiveFx), now);
  assert(
    'positive three-card fixture emits three known ids',
    positiveEvidence.ids.length === 3 &&
      positiveEvidence.knownIds.length === 3 &&
      positiveEvidence.placeholderIds.length === 0 &&
      positiveFx.expectedIds.every((id) => positiveEvidence.knownIds.includes(id))
  );

  // 6. Three champion names that happen to sit at card geometry are a
  // champion-select read, not an all-unknown roll: no placeholders, ever.
  const championRowEvidence = evidence(frameLines(fixture('negative-champion-row')), now);
  assert(
    'three champion names at card geometry emit no placeholders',
    championRowEvidence.ids.length === 0 &&
      championRowEvidence.knownIds.length === 0 &&
      championRowEvidence.placeholderIds.length === 0 &&
      championRowEvidence.decision === 'unverified'
  );

  // 7. The Maestro headliner deals four cards; a four-card known roll must be
  // accepted whole instead of being capped at three.
  const fourFx = fixture('positive-4-en');
  const fourEvidence = evidence(frameLines(fourFx), now);
  assert(
    'four-card fixture accepts four known ids',
    fourEvidence.ids.length === 4 &&
      fourEvidence.knownIds.length === 4 &&
      fourEvidence.placeholderIds.length === 0 &&
      fourFx.expectedIds.every((id) => fourEvidence.knownIds.includes(id))
  );

  // 8. Two reads of one positioned title are a preview, never authoritative.
  {
    const lone = frameLines(positiveFx).slice(0, 1);
    const s = createMayhemPipelineState();
    const first = classifyMayhemFrame({ lines: lone, augments, mode: 'mayhem-likely', state: s, now: 1000 });
    const second = classifyMayhemFrame({ lines: lone, augments, mode: 'mayhem-likely', state: s, now: 2000 });
    assert(
      'one positioned title twice stays preview',
      first.decision === 'preview' &&
        second.decision === 'preview' &&
        second.ids.length === 0 &&
        second.knownIds.length === 0 &&
        second.placeholderIds.length === 0
    );
  }

  // Three unfamiliar titles at card geometry, with no shop chrome in the OCR
  // text, look like a scoreboard: unverified with no ids. The same rows with
  // explicit shop evidence are a displayable all-unknown roll.
  const nonShopLines: MayhemFrameLine[] = [
    { text: 'Chrono Surge', rect: { x: 0.26, y: 0.38, w: 0.14, h: 0.04 } },
    { text: 'The Timeless', rect: { x: 0.44, y: 0.38, w: 0.12, h: 0.04 } },
    { text: 'Celestial Roar', rect: { x: 0.60, y: 0.38, w: 0.14, h: 0.04 } },
  ];
  {
    const bare = classifyMayhemFrame({
      lines: nonShopLines, augments, mode: 'mayhem-likely', state: createMayhemPipelineState(), now: 3000,
    });
    assert(
      'three positioned non-shop titles stay unverified with no ids',
      bare.cardCount === 3 &&
        bare.decision === 'unverified' &&
        bare.ids.length === 0 &&
        bare.knownIds.length === 0 &&
        bare.placeholderIds.length === 0
    );
  }
  {
    const shopLines: MayhemFrameLine[] = [
      ...nonShopLines,
      { text: 'Reroll 2 left', rect: { x: 0.4, y: 0.10, w: 0.1, h: 0.03 } },
    ];
    const shopped = classifyMayhemFrame({
      lines: shopLines, augments, mode: 'mayhem-likely', state: createMayhemPipelineState(), now: 3000,
    });
    assert(
      'three positioned titles with shop evidence accept',
      shopped.cardCount === 3 &&
        shopped.decision === 'accept' &&
        shopped.ids.length === 3 &&
        shopped.knownIds.length === 0 &&
        shopped.placeholderIds.length === 3 &&
        shopped.ids.every((id) => shopped.placeholderIds.includes(id))
    );
  }

  // 11. With header OCR missing, an all-unknown row is never authoritative —
  // not even after three identical reads. Repetition must not reopen the
  // scoreboard false-positive: no ids, no placeholders, no roll, no pick.
  {
    const s = createMayhemPipelineState();
    const decisions: string[] = [];
    let last: MayhemFrameEvidence | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = classifyMayhemFrame({
        lines: nonShopLines, augments, mode: 'mayhem-likely', state: s, now: 4000 + i * 1000,
      });
      decisions.push(last.decision);
    }
    assert(
      'headerless all-unknown rows never accept, even after three identical reads',
      decisions.every((decision) => decision === 'unverified') &&
        last!.ids.length === 0 &&
        last!.knownIds.length === 0 &&
        last!.placeholderIds.length === 0
    );
  }

  // 12. Champion names at card geometry are refused by the fallback even after
  // three identical reads: the confirmation route must never accept them.
  {
    const s = createMayhemPipelineState();
    const championLines = frameLines(fixture('negative-champion-row'));
    const decisions: string[] = [];
    let last: MayhemFrameEvidence | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = classifyMayhemFrame({
        lines: championLines, augments, mode: 'mayhem-likely', state: s, now: 5000 + i * 1000,
      });
      decisions.push(last.decision);
    }
    assert(
      'positioned champion-name rows never accept even after three frames',
      decisions.every((decision) => decision === 'unverified') &&
        last!.ids.length === 0 &&
        last!.knownIds.length === 0 &&
        last!.placeholderIds.length === 0
    );
  }

  // The name-independent pixel gate: a headerless all-unknown row is a real
  // roll only when the card pixels agree. Geometry and the champion-name
  // rejector are unchanged and still win over a stray teal frame.
  {
    const gated = fromFixture(fixture('positive-headerless-teal'), 7000);
    assert(
      'headerless all-unknown with pixel gate accepts',
      gated.cardCount === 3 && gated.decision === 'accept' &&
        gated.ids.length === 3 && gated.knownIds.length === 0 &&
        gated.placeholderIds.length === 3 &&
        gated.ids.every((id) => gated.placeholderIds.includes(id))
    );
  }
  {
    const ungated = fromFixture(fixture('negative-headerless-no-teal'), 7000);
    assert(
      'same rows without pixel gate stay unverified',
      ungated.cardCount === 3 && ungated.decision === 'unverified' &&
        ungated.ids.length === 0 && ungated.knownIds.length === 0 &&
        ungated.placeholderIds.length === 0
    );
  }
  {
    const scoreboardGated = classifyMayhemFrame({
      lines: frameLines(fixture('negative-scoreboard')), augments, mode: 'mayhem-likely',
      state: createMayhemPipelineState(), now: 7000,
      cardsVisible: true,
      cardSlots: parsedFixture(fixture('positive-headerless-teal')).cardSlots,
    });
    assert(
      'scoreboard rows with teal elsewhere still rejected',
      scoreboardGated.decision === 'unverified' &&
        scoreboardGated.ids.length === 0 && scoreboardGated.knownIds.length === 0 &&
        scoreboardGated.placeholderIds.length === 0
    );
  }
  {
    // Teal is present and the titles sit at card columns, but it is one wide
    // band, not card-sized patches on the detected boxes. The coarse global hit
    // is deliberately true here: trusting it is the false positive this pins.
    const aligned = fromFixture(fixture('negative-aligned-teal'), 7000);
    assert(
      'aligned teal background over card columns stays unverified',
      aligned.cardCount === 3 && aligned.decision === 'unverified' &&
        aligned.ids.length === 0 && aligned.knownIds.length === 0 &&
        aligned.placeholderIds.length === 0
    );
  }
  {
    const fourGated = fromFixture(fixture('positive-4-headerless-teal'), 7000);
    assert(
      'headerless four-card roll with aligned teal slots accepts',
      fourGated.cardCount === 4 && fourGated.decision === 'accept' &&
        fourGated.ids.length === 4 && fourGated.knownIds.length === 0 &&
        fourGated.placeholderIds.length === 4 &&
        fourGated.ids.every((id) => fourGated.placeholderIds.includes(id))
    );
  }
}

void main().then(() => {
  console.log(`Summary: ${failures} FAIL, ${passes} PASS`);
  if (failures > 0) process.exitCode = 1;
});
