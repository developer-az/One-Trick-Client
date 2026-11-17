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

export interface MayhemOcrOutput {
  /** OCR lines with the `__OT_*__` control markers removed. */
  text: string;
  target: MayhemOcrTarget | null;
  blackFrame: boolean;
  /** Language tag the Windows OCR engine actually used, when reported. */
  language: string | null;
  /** The game window was not found at all. */
  noTarget: boolean;
  /**
   * No game window matched, so the full primary screen was captured instead.
   * The read is still usable, but it cannot prove what was on top.
   */
  fallback: boolean;
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

/**
 * Peel the `__OT_*__` control lines off the PowerShell OCR output.
 * The remaining lines are exactly what Windows.Media.Ocr recognized, so the
 * augment matcher never sees diagnostics.
 */
export function parseMayhemOcrOutput(raw: string): MayhemOcrOutput {
  const kept: string[] = [];
  let target: MayhemOcrTarget | null = null;
  let blackFrame = false;
  let language: string | null = null;
  let noTarget = false;
  let fallback = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
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
    else if (name === 'OCR_LANG') language = rest.trim() || null;
    else if (name === 'TARGET') target = parseTarget(rest);
  }

  return { text: kept.join('\n'), target, blackFrame, language, noTarget, fallback };
}
