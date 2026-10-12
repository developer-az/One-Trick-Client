import fs from 'fs';
import path from 'path';

export interface LeagueHudScales {
  hudScale: number; // 0–100 (Interface › HUD Scale)
  mapScale: number; // 0–100 (mapped from MinimapScale)
  width: number;
  height: number;
  globalScale: number;
  minimapScale: number;
  source: string;
}

const CANDIDATE_CFG = [
  path.join('C:', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  path.join('D:', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  path.join('E:', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  path.join(process.env.LOCALAPPDATA || '', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  path.join(process.env.USERPROFILE || '', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
];

/** Remember which path worked so match-start sync isn't a multi-drive scan. */
let cachedCfgPath: string | null = null;

function parseCfg(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * League stores the Interface › Minimap Scale slider as MinimapScale =
 * slider × 0.03 (0–100 → 0.0–3.0; the default 33 is 1.0). A slider of 61
 * is saved as 1.83.
 */
export function minimapScaleToSlider(minimapScale: number): number {
  return Math.max(0, Math.min(100, Math.round(minimapScale / 0.03)));
}

/** Slider 0–100 → League MinimapScale (0.0–3.0). */
export function sliderToMinimapScale(slider: number): number {
  const s = Number.isFinite(slider) ? Math.max(0, Math.min(100, slider)) : 33;
  return s * 0.03;
}

function scalesFromVals(vals: Record<string, string>, source: string): LeagueHudScales | null {
  const globalScale = Number.parseFloat(vals.GlobalScale ?? '0.2');
  const minimapScale = Number.parseFloat(vals.MinimapScale ?? '1');
  const width = Number.parseInt(vals.Width || '1920', 10);
  const height = Number.parseInt(vals.Height || '1080', 10);
  if (!Number.isFinite(globalScale) || !Number.isFinite(minimapScale)) return null;
  return {
    hudScale: Math.max(0, Math.min(100, Math.round(globalScale * 100))),
    mapScale: minimapScaleToSlider(minimapScale),
    width: Number.isFinite(width) ? width : 1920,
    height: Number.isFinite(height) ? height : 1080,
    globalScale,
    minimapScale,
    source,
  };
}

export function readLeagueHudScales(): LeagueHudScales | null {
  const tryPath = (cfgPath: string): LeagueHudScales | null => {
    try {
      if (!fs.existsSync(cfgPath)) return null;
      const vals = parseCfg(fs.readFileSync(cfgPath, 'utf8'));
      const scales = scalesFromVals(vals, cfgPath);
      if (scales) cachedCfgPath = cfgPath;
      return scales;
    } catch {
      return null;
    }
  };

  if (cachedCfgPath) {
    const hit = tryPath(cachedCfgPath);
    if (hit) return hit;
    cachedCfgPath = null;
  }

  for (const cfgPath of CANDIDATE_CFG) {
    const hit = tryPath(cfgPath);
    if (hit) return hit;
  }
  return null;
}
