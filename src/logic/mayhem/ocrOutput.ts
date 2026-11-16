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

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const marker = MARKER.exec(trimmed);
    if (!marker) {
      kept.push(line);
      continue;
    }
    const name = marker[1];
    const rest = marker[2] || '';
    if (name === 'BLACK_FRAME') blackFrame = true;
    else if (name === 'NO_TARGET') noTarget = true;
    else if (name === 'OCR_LANG') language = rest.trim() || null;
    else if (name === 'TARGET') target = parseTarget(rest);
  }

  return { text: kept.join('\n'), target, blackFrame, language, noTarget };
}
