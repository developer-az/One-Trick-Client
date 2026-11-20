export interface MayhemOcrTarget {
  pid?: number;
  exe?: string;
  className?: string;
  /** Screen-space client rect of the captured window: x,y,w,h. */
  rect?: string;
  /** Captured frame size: WxH. */
  frame?: string;
  black?: boolean;
  foreground?: boolean;
}

export interface MayhemCardSlot {
  /** Slot center x, normalized to the captured bitmap (0..1). */
  x: number;
  /** Body-like samples in this slot's card-sized body patch. */
  body: number;
  /** Rim/inner luminance-contrast samples in this slot. */
  rim: number;
  /**
   * Body-like samples in the gaps between this slot and its neighbours (and
   * past the outer cards), at the same body rows. Zero means the teal patch is
   * bounded by non-teal, i.e. a separate card and not one full-width band.
   * Hand-built reads may omit it, but the parser drops such slots: only an explicit finite gap carries evidence.
   */
  gap?: number;
  /** Mean RGB of the sampled body patch, for logging only; absent in older/hand-built reads. */
  bodyR?: number;
  bodyG?: number;
  bodyB?: number;
}

export interface MayhemOcrOutput {
  /** OCR lines with the `__OT_*__` control markers removed. */
  text: string;
  /** Per-line boxes in fractions of the captured bitmap (0..1), when reported. */
  lines?: Array<{ text: string; rect: { x: number; y: number; w: number; h: number } }>;
  target: MayhemOcrTarget | null;
  blackFrame: boolean;
  /** Language tag the Windows OCR engine actually used, when reported. */
  language: string | null;
  /** The game window was not found at all. */
  noTarget: boolean;
  /**
   * No game window matched, so the primary screen was captured and its offer
   * band cropped out. The read is still usable, but it cannot prove what was
   * on top.
   */
  fallback: boolean;
  /**
   * Windows OCR succeeded and recognized zero lines on a genuine capture.
   * Optional so hand-built reads in the frozen verifies stay valid; the parser
   * always sets it. A genuine empty frame is a real empty scan for the pick
   * counter, unlike a failed/black/fallback or box-less read.
   */
  emptyFrame?: boolean;
  /**
   * Name-independent pixel evidence that an augment choice is on screen.
   * Optional so hand-built reads stay valid; only the PowerShell sampler sets it.
   */
  cardsVisible?: boolean;
  /**
   * Per-slot card-sized pixel evidence, with normalized slot centers. The
   * coarse `cardsVisible` flag cannot prove the teal was on the cards; the
   * pipeline aligns these centers with detected card boxes before trusting it.
   */
  cardSlots?: MayhemCardSlot[];
}

const MARKER = /^__OT_([A-Z0-9_]+)(?:\s+(.*))?__$/;

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const v = value.toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

function parseTarget(rest: string): MayhemOcrTarget {
  const target: MayhemOcrTarget = {};
  for (const pair of rest.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'pid') {
      const pid = Number(value);
      if (Number.isFinite(pid) && pid > 0) target.pid = pid;
    } else if (key === 'exe') target.exe = value;
    else if (key === 'class') target.className = value;
    else if (key === 'rect') target.rect = value;
    else if (key === 'frame') target.frame = value;
    else if (key === 'black') target.black = parseBool(value);
    else if (key === 'fg') target.foreground = parseBool(value);
  }
  return target;
}

/**
 * Target metadata as JSON: `__OT_TARGET__{"pid":4242,"exe":"League of Legends",…}`.
 * The process name contains spaces, which the old space-separated key/value
 * marker could not carry, so the current script emits JSON (the key/value
 * parser stays for logs from older builds).
 */
function targetFromJson(json: string): MayhemOcrTarget | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  const bool = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : typeof value === 'string' ? parseBool(value) : undefined;
  const pidRaw = typeof src.pid === 'number' ? src.pid : Number(src.pid);
  const target: MayhemOcrTarget = {};
  if (Number.isFinite(pidRaw) && pidRaw > 0) target.pid = pidRaw;
  const exe = text(src.exe);
  if (exe) target.exe = exe;
  const className = text(src.className) ?? text(src.class);
  if (className) target.className = className;
  const rect = text(src.rect);
  if (rect) target.rect = rect;
  const frame = text(src.frame);
  if (frame) target.frame = frame;
  const black = bool(src.black);
  if (black !== undefined) target.black = black;
  const foreground = bool(src.foreground) ?? bool(src.fg);
  if (foreground !== undefined) target.foreground = foreground;
  return target;
}

const TARGET_JSON_PREFIX = '__OT_TARGET__';
const LINES_JSON_PREFIX = '__OT_LINES__';
const CARD_SLOTS_JSON_PREFIX = '__OT_CARD_SLOTS__';

type Frame = readonly [number, number, number, number];
const IDENTITY_FRAME: Frame = [0, 0, 1, 1];
const unit = (v: number): number => Math.max(0, Math.min(1, v));

function parseFrame(value: unknown): Frame | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
  return nums.some((n) => !Number.isFinite(n)) ? null : (nums as unknown as Frame);
}

/**
 * Boxes arrive normalized to the captured bitmap. A `frame` in the marker maps
 * that bitmap back to the full game frame; a bare array (older scripts, file
 * fixtures) is already full-frame and keeps the identity mapping.
 */
function linesFromJson(json: string): { lines: NonNullable<MayhemOcrOutput['lines']>; frame: Frame } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  let items: unknown;
  let frame: Frame = IDENTITY_FRAME;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    items = obj.lines;
    frame = parseFrame(obj.frame) ?? IDENTITY_FRAME;
  } else {
    return null;
  }
  if (!Array.isArray(items)) return null;
  const lines: NonNullable<MayhemOcrOutput['lines']> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const src = item as Record<string, unknown>;
    if (typeof src.text !== 'string') continue;
    if (!src.rect || typeof src.rect !== 'object') continue;
    const r = src.rect as Record<string, unknown>;
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const x = num(r.x), y = num(r.y), w = num(r.w), h = num(r.h);
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    lines.push({
      text: src.text,
      rect: {
        x: unit(frame[0] + x * frame[2]),
        y: unit(frame[1] + y * frame[3]),
        w: unit(w * frame[2]),
        h: unit(h * frame[3]),
      },
    });
  }
  return { lines, frame };
}

function cardSlotsFromJson(json: string): MayhemCardSlot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const slots: MayhemCardSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const src = item as Record<string, unknown>;
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const x = num(src.x), body = num(src.body), rim = num(src.rim), gap = num(src.gap);
    if (x === undefined || body === undefined || rim === undefined || gap === undefined) continue;
    const slot: MayhemCardSlot = { x: unit(x), body, rim, gap };
    const r = num(src.bodyR), g = num(src.bodyG), b = num(src.bodyB);
    if (r !== undefined) slot.bodyR = r;
    if (g !== undefined) slot.bodyG = g;
    if (b !== undefined) slot.bodyB = b;
    slots.push(slot);
  }
  return slots;
}

/**
 * Peel the `__OT_*__` control lines off the PowerShell OCR output.
 * The remaining lines are exactly what Windows.Media.Ocr recognized, so the
 * augment matcher never sees diagnostics.
 */
export function parseMayhemOcrOutput(raw: string): MayhemOcrOutput {
  const kept: string[] = [];
  let lines: MayhemOcrOutput['lines'] = [];
  let target: MayhemOcrTarget | null = null;
  let blackFrame = false;
  let language: string | null = null;
  let noTarget = false;
  let fallback = false;
  let emptyFrame = false;
  const visibilityMarkers: string[] = [];
  const slotPayloads: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(LINES_JSON_PREFIX)) {
      const parsedLines = linesFromJson(trimmed.slice(LINES_JSON_PREFIX.length).trim());
      if (parsedLines) lines = parsedLines.lines;
      continue;
    }
    if (trimmed.startsWith(CARD_SLOTS_JSON_PREFIX)) {
      slotPayloads.push(trimmed.slice(CARD_SLOTS_JSON_PREFIX.length).trim());
      continue;
    }
    if (trimmed.startsWith(TARGET_JSON_PREFIX)) {
      const parsedTarget = targetFromJson(trimmed.slice(TARGET_JSON_PREFIX.length).trim());
      if (parsedTarget) target = parsedTarget;
      continue;
    }
    const marker = MARKER.exec(trimmed);
    if (!marker) {
      kept.push(line);
      continue;
    }
    const name = marker[1];
    const rest = marker[2] || '';
    if (name === 'BLACK_FRAME') blackFrame = true;
    else if (name === 'NO_TARGET') noTarget = true;
    else if (name === 'FALLBACK') fallback = true;
    else if (name === 'EMPTY_FRAME') emptyFrame = true;
    else if (name === 'CARDS_VISIBLE') {
      const value = parseBool(rest);
      visibilityMarkers.push(value === undefined ? '?' : value ? '1' : '0');
    }
    else if (name === 'OCR_LANG') language = rest.trim() || null;
    else if (name === 'TARGET') target = parseTarget(rest);
  }

  // A marker-shaped OCR line is indistinguishable from a control line. If any
  // visibility marker disagrees — or is malformed — there is no trustworthy
  // answer, so fail closed instead of letting the last one win.
  const distinct = new Set(visibilityMarkers);
  const cardsVisible =
    visibilityMarkers.length === 0 || distinct.size !== 1 || distinct.has('?')
      ? undefined
      : distinct.has('1');
  // Slot markers arrive in the same untrusted stream as OCR text. A duplicate
  // (including a marker-shaped OCR line) cannot be told apart from the real
  // payload, so any second marker voids the evidence rather than overriding it.
  const cardSlots = slotPayloads.length === 1 ? cardSlotsFromJson(slotPayloads[0]) : undefined;

  return {
    text: kept.join('\n'), lines, target, blackFrame, language, noTarget, fallback,
    emptyFrame, cardsVisible, cardSlots,
  };
}
