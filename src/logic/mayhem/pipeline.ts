/**
 * Frame evidence for the augment shop, independent of Electron and OCR text.
 *
 * Geometry is the primary rejector: known titles on a scoreboard or a champion
 * select screen carry no evidence unless they sit in the shop's name row at the
 * three/four card columns. Matching and hysteresis only run on rows that pass
 * that gate, so a stray known title can never latch a roll or count a pick.
 *
 * Pure: all state is passed in and returned, nothing is read from disk or the
 * live game. C2 wires the OCR boxes into `classifyMayhemFrame`.
 */

import { CHAMPION_POSITIONS } from '../championPositions';
import { isLiveMayhemAugment } from './bundleSanitize';
import { fuzzyNameScore, normalizeName, unknownMayhemAugmentId } from './match';
import type { MayhemCardSlot } from './ocrOutput';
import type { MayhemAugment, MayhemRarity } from './types';

/** One OCR line with its box normalized to the captured bitmap (0..1). */
export interface MayhemFrameLine {
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** 'classic' suppresses placeholders; the other two are Mayhem matches. */
export type MayhemFrameMatchMode = 'mayhem' | 'mayhem-likely' | 'classic';

export type MayhemFrameDecision = 'accept' | 'preview' | 'unverified';

/** State threaded across frames: a pending lone card and the ignore window. */
export interface MayhemPipelineState {
  pending: { id: string; centerY: number; firstSeenAt: number } | null;
  ignoreLoneUntil: number;
}

export function createMayhemPipelineState(): MayhemPipelineState {
  return { pending: null, ignoreLoneUntil: 0 };
}

export interface MayhemFrameEvidence {
  /** Display ids: only populated when `decision === 'accept'`. */
  ids: string[];
  /** Bundle ids on an accepted frame (the trust path). */
  knownIds: string[];
  /** `unknown:` rows on an accepted frame (display only): all-unknown, or the one unmatched card. */
  placeholderIds: string[];
  decision: MayhemFrameDecision;
  /** Geometry-accepted card rows on this frame, whatever the decision. */
  cardCount: number;
  /** Short codes explaining the decision, for the capture log. */
  reasons: string[];
}

export interface MayhemFrameInput {
  lines: MayhemFrameLine[];
  augments: MayhemAugment[];
  mode: MayhemFrameMatchMode;
  state: MayhemPipelineState;
  now: number;
  /** Coarse pixel flag; required alongside aligned per-slot evidence, never alone. */
  cardsVisible?: boolean;
  /** Per-slot pixel evidence, aligned against detected card boxes before use. */
  cardSlots?: MayhemCardSlot[];
}

const THREE_COLUMNS = [0.33, 0.5, 0.67];
const FOUR_COLUMNS = [0.245, 0.415, 0.585, 0.755];
const COLUMN_TOLERANCE = 0.03;
const CARD_BODY_MIN = 8;
const CARD_RIM_MIN = 7;
const NAME_ROW_MIN_Y = 0.37;
const NAME_ROW_MAX_Y = 0.44;
const MIN_CENTER_GAP = 0.12;
const MIN_MATCH_NAME_LENGTH = 4;
const MIN_FUZZY_SIMILARITY = 0.82;
/** Two reads of one card may drift this much in Y and still be the same row. */
const LONE_CARD_Y_DRIFT = 0.02;
/** A lone card that never gets a second read stops being considered for a while. */
const LONE_CARD_TIMEOUT_MS = 10_000;
const LONE_CARD_IGNORE_MS = 60_000;
/** Maestro headliner deals a fourth card; accept up to four on a full row. */
const MAX_CARDS = 4;

/** Shop chrome that proves an all-unknown row is an offer, not a scoreboard. */
const SHOP_EVIDENCE = /\b(silver|gold|prismatic|reroll|augment|choose\s+an\s+augment|select\s+an\s+augment)\b/i;

function hasShopEvidence(lines: MayhemFrameLine[]): boolean {
  return SHOP_EVIDENCE.test(lines.map((line) => line.text).join('\n'));
}

/**
 * Fallback-only champion denylist: a full shop row whose titles are ALL known
 * champion names is a champion-select/scoreboard read, not an all-unknown roll.
 * Geometry stays the primary gate; this only stops placeholders when the row
 * happens to match the card columns. The catalog covers the bundle's combo
 * championIds except the one combo-only champion listed here.
 */
const CHAMPION_NAMES: ReadonlySet<string> = (() => {
    const set = new Set<string>();
    const add = (value: string): void => {
        const norm = normalizeName(value);
        if (!norm) return;
        set.add(norm);
        set.add(norm.replace(/ /g, ''));
    };
    for (const id of Object.keys(CHAMPION_POSITIONS)) add(id);
    add('Zaahen');
    return set;
})();

function areAllChampionNames(rows: GeometryRow[]): boolean {
    return rows.length > 0 && rows.every((row) => {
        const name = normalizeName(row.text);
        return CHAMPION_NAMES.has(name) || CHAMPION_NAMES.has(name.replace(/ /g, ''));
    });
}

interface GeometryRow {
  text: string;
  centerX: number;
  centerY: number;
  height: number;
  top: number;
  bottom: number;
}

/** Keep the widest, highest-confidence name on boxes that overlap heavily. */
function collapseOverlaps(lines: MayhemFrameLine[]): MayhemFrameLine[] {
  const kept: MayhemFrameLine[] = [];
  for (const line of lines) {
    const r = line.rect;
    if (![r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) continue;
    if (r.w <= 0 || r.h <= 0 || line.text.trim().length < MIN_MATCH_NAME_LENGTH) continue;
    const overlaps = kept.some((other) => {
      const o = other.rect;
      const xOverlap = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
      const yOverlap = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
      if (xOverlap <= 0 || yOverlap <= 0) return false;
      const area = xOverlap * yOverlap;
      const smaller = Math.min(r.w * r.h, o.w * o.h);
      return smaller > 0 && area / smaller > 0.5;
    });
    if (!overlaps) kept.push(line);
  }
  return kept;
}

/**
 * A scoreboard stacks several rows at one x. Fuse vertically adjacent boxes at
 * the same column so they count as one row, never as a spread of card columns.
 */
function fuseAlignedRows(lines: MayhemFrameLine[]): GeometryRow[] {
  const rows: GeometryRow[] = [];
  for (const line of lines) {
    const r = line.rect;
    const row: GeometryRow = {
      text: line.text.trim(),
      centerX: r.x + r.w / 2,
      centerY: r.y + r.h / 2,
      height: r.h,
      top: r.y,
      bottom: r.y + r.h,
    };
    const neighbor = rows.findIndex(
      (prev) =>
        Math.abs(prev.centerX - row.centerX) <= COLUMN_TOLERANCE &&
        row.top - prev.bottom <= 1.5 * Math.max(prev.height, row.height)
    );
    if (neighbor >= 0) {
      const prev = rows[neighbor];
      rows[neighbor] = {
        text: `${prev.text} ${row.text}`.trim(),
        centerX: (prev.centerX + row.centerX) / 2,
        centerY: (prev.centerY + row.centerY) / 2,
        height: Math.max(prev.height, row.height),
        top: Math.min(prev.top, row.top),
        bottom: Math.max(prev.bottom, row.bottom),
      };
    } else {
      rows.push(row);
    }
  }
  return rows;
}

/** Rows in the shop's name row that snap to a 3- or 4-card column layout. */
function cardGeometry(lines: MayhemFrameLine[]): GeometryRow[] {
  const nameRows = fuseAlignedRows(collapseOverlaps(lines)).filter(
    (row) => row.centerY >= NAME_ROW_MIN_Y && row.centerY <= NAME_ROW_MAX_Y
  );
  const layouts: Array<{ columns: readonly number[]; rows: GeometryRow[] }> = [
    { columns: THREE_COLUMNS, rows: [] },
    { columns: FOUR_COLUMNS, rows: [] },
  ];
  for (const row of nameRows) {
    for (const layout of layouts) {
      const distance = Math.min(...layout.columns.map((x) => Math.abs(x - row.centerX)));
      if (distance <= COLUMN_TOLERANCE) layout.rows.push(row);
    }
  }
  const best = layouts.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
  const rows = [...best.rows].sort((a, b) => a.centerX - b.centerX);
  // Consecutive cards must be visibly apart; a doubled read of one card is not
  // three offers even if two boxes landed near two columns.
  const spaced: GeometryRow[] = [];
  for (const row of rows) {
    if (spaced.length && row.centerX - spaced[spaced.length - 1].centerX < MIN_CENTER_GAP) continue;
    spaced.push(row);
  }
  return spaced;
}

/**
 * Teal away from the cards proves nothing. Only a slot whose center lands on a
 * detected card-box column, whose own body/rim patch is card-like AND whose gaps
 * to the neighbouring columns are non-teal counts: a full-width teal band lights
 * every body patch but has no card boundaries, so it cannot prove separate cards.
 * Two such slots are needed before a headerless all-unknown row is a roll.
 */
function hasAlignedCardPixels(rows: GeometryRow[], slots: MayhemCardSlot[] | undefined): boolean {
  if (!slots || slots.length === 0) return false;
  return slots.filter((slot) =>
    (slot.body >= CARD_BODY_MIN || slot.rim >= CARD_RIM_MIN) &&
    slot.gap === 0 &&
    rows.some((row) => Math.abs(row.centerX - slot.x) <= COLUMN_TOLERANCE)
  ).length >= 2;
}

interface MatchCandidate {
  aug: MayhemAugment;
  score: number;
}

/** The bundle's rarity is the consensus signal when two names read identically. */
const RARITY_CONSENSUS: Record<MayhemRarity, number> = { silver: 1, gold: 2, prismatic: 3 };

function preferCandidate(next: MatchCandidate, best: MatchCandidate): boolean {
  if (next.score !== best.score) return next.score > best.score;
  if (isLiveMayhemAugment(next.aug) !== isLiveMayhemAugment(best.aug)) {
    return isLiveMayhemAugment(next.aug);
  }
  if (RARITY_CONSENSUS[next.aug.rarity] !== RARITY_CONSENSUS[best.aug.rarity]) {
    return RARITY_CONSENSUS[next.aug.rarity] > RARITY_CONSENSUS[best.aug.rarity];
  }
  if (next.aug.pickRateRank !== best.aug.pickRateRank) {
    return next.aug.pickRateRank < best.aug.pickRateRank;
  }
  return next.aug.id.localeCompare(best.aug.id) < 0;
}

function matchRow(text: string, augments: MayhemAugment[]): MatchCandidate | null {
  const name = normalizeName(text);
  if (name.length < MIN_MATCH_NAME_LENGTH) return null;
  let best: MatchCandidate | null = null;
  for (const aug of augments) {
    const score = fuzzyNameScore(name, aug.name);
    if (score < MIN_FUZZY_SIMILARITY) continue;
    const candidate = { aug, score };
    if (!best || preferCandidate(candidate, best)) best = candidate;
  }
  return best;
}

/**
 * Classify one OCR frame from its boxes.
 *
 * `ids`/`knownIds`/`placeholderIds` are empty unless the frame is `accept`ed:
 * a preview (one card awaiting a second read) or an unverified frame must never
 * look like a roll to the monitor, picker or eviction guard.
 */
export function classifyMayhemFrame(input: MayhemFrameInput): MayhemFrameEvidence {
  const { augments, mode, state, now } = input;
  const rows = cardGeometry(input.lines);
  const cardCount = rows.length;
  // Authoritative acceptance is a full roll, never a stray/settled lone card:
  // three zones, or all four when the frame carries a four-card row.
  const requiredCards = cardCount >= 4 ? 4 : 3;

  if (cardCount < 3) {
    // No roll-shaped frame: never accept, pick or evict from it. A single card
    // is the only case with a confirmation state of its own.
    if (cardCount !== 1) {
      state.pending = null;
      return {
        ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
        reasons: cardCount === 0 ? ['no-card-geometry'] : ['too-few-cards'],
      };
    }
    if (now < state.ignoreLoneUntil) {
      state.pending = null;
      return {
        ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
        reasons: ['lone-card-ignored'],
      };
    }
    const hit = matchRow(rows[0].text, augments);
    if (!hit) {
      state.pending = null;
      return {
        ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
        reasons: ['lone-card-unmatched'],
      };
    }
    const id = hit.aug.id;
    const centerY = rows[0].centerY;
    const pending = state.pending;
    if (pending && pending.id === id && Math.abs(pending.centerY - centerY) <= LONE_CARD_Y_DRIFT) {
      // Two reads of one positioned title never carry a full roll: preview only.
      state.pending = null;
      return {
        ids: [], knownIds: [], placeholderIds: [], decision: 'preview', cardCount,
        reasons: ['lone-card-confirmed'],
      };
    }
    if (pending && (pending.id !== id || now - pending.firstSeenAt > LONE_CARD_TIMEOUT_MS)) {
      state.ignoreLoneUntil = now + LONE_CARD_IGNORE_MS;
    }
    state.pending = { id, centerY, firstSeenAt: now };
    return {
      ids: [], knownIds: [], placeholderIds: [], decision: 'preview', cardCount,
      reasons: ['lone-card-pending'],
    };
  }

  state.pending = null;
  const knownIds: string[] = [];
  /** Left-to-right display order: a known id, or null for an unmatched card. */
  const rowHits: Array<string | null> = [];
  const unmatchedRows: GeometryRow[] = [];
  for (const row of rows.slice(0, MAX_CARDS)) {
    const hit = matchRow(row.text, augments);
    if (hit && !knownIds.includes(hit.aug.id)) {
      knownIds.push(hit.aug.id);
      rowHits.push(hit.aug.id);
    } else if (!hit) {
      rowHits.push(null);
      unmatchedRows.push(row);
    }
  }
  if (knownIds.length >= requiredCards) {
    return {
      ids: knownIds, knownIds, placeholderIds: [], decision: 'accept', cardCount,
      reasons: ['cards-matched'],
    };
  }
  // A full card row with all but one title known is a roll: one card is newer
  // than the bundle (patch day) or one title misread. A single known title
  // beside junk stays rejected below. The unmatched card shows as a
  // display-only placeholder; only the known ids are trusted for picks. A
  // champion name in the unmatched slot means a scoreboard/champion-select
  // read, never a roll.
  if (
    knownIds.length >= 2 &&
    knownIds.length === requiredCards - 1 &&
    unmatchedRows.length === 1 &&
    !areAllChampionNames(unmatchedRows)
  ) {
    const placeholderIds = unmatchedRows.map((row) => unknownMayhemAugmentId(row.text));
    let placeholderIndex = 0;
    const ids = rowHits.map((id) => id ?? placeholderIds[placeholderIndex++]);
    return {
      ids, knownIds, placeholderIds, decision: 'accept', cardCount,
      reasons: ['cards-matched-one-unknown'],
    };
  }
  // A partial read beside known cards is an unanchored title, not a roll:
  // emitting it is what let scoreboard chrome become a phantom pick.
  if (knownIds.length > 0) {
    return {
      ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
      reasons: ['partial-known-row'],
    };
  }
  // No known card on a full shop row means a patch newer than the bundle. A row
  // of recognizable champion names is a fallback rejector (champion select),
  // not a placeholder roll — this is the secondary check, never the primary gate.
  if (areAllChampionNames(rows)) {
    return {
      ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
      reasons: ['all-champion-names'],
    };
  }
  // Only a known Mayhem match may show unknown rows as display-only placeholders.
  if (mode === 'classic') {
    return {
      ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
      reasons: ['all-unknown-classic'],
    };
  }
  const placeholderIds = rows
    .map((row) => unknownMayhemAugmentId(row.text))
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, MAX_CARDS);
  if (placeholderIds.length < requiredCards) {
    return {
      ids: [], knownIds: [], placeholderIds: [], decision: 'preview', cardCount,
      reasons: ['all-unknown-incomplete'],
    };
  }
  // Shop chrome in the OCR text proves an all-unknown row is a roll immediately.
  if (hasShopEvidence(input.lines)) {
    return {
      ids: placeholderIds, knownIds: [], placeholderIds, decision: 'accept', cardCount,
      reasons: ['all-unknown-roll'],
    };
  }
  // A header we cannot read is no longer the only confirmation: bounded, card-
  // sized pixel evidence aligned with the detected boxes proves dark-teal cards
  // are on screen, independent of their unfamiliar names. The coarse flag must
  // agree, but alone it cannot accept a row: a full-width teal panel sets it too.
  // Geometry and the champion-name rejector above have already passed; repetition
  // never counts.
  if (input.cardsVisible === true && hasAlignedCardPixels(rows, input.cardSlots)) {
    return {
      ids: placeholderIds, knownIds: [], placeholderIds, decision: 'accept', cardCount,
      reasons: ['all-unknown-card-pixels'],
    };
  }
  // Without shop evidence or a pixel gate an all-unknown row looks like a
  // scoreboard of unfamiliar names, however many identical reads repeat it. It
  // is never authoritative: no ids, no pick, no arm, no eviction. The persistent
  // unverified panel is the honest signal until a shop header, a pixel read or
  // PageDown can confirm the roll.
  return {
    ids: [], knownIds: [], placeholderIds: [], decision: 'unverified', cardCount,
    reasons: ['all-unknown-no-shop-evidence'],
  };
}
