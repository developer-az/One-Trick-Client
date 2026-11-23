import type { LeagueGeometry } from './leagueGeometry';

/**
 * Pure layout for the skin drawn around League's bottom-centre HUD cluster
 * (portrait, health/mana, Q/W/E/R, summoners, items).
 *
 * The skin is a perimeter, never a covering panel: every decorative piece is
 * placed in the padding gutter between the cluster and the surround edge, so no
 * piece intersects the interior of the ability box or the health strip. The
 * native bars, numbers, icons and cooldown sweeps stay unobstructed.
 *
 * Everything scales with `geo.s` (game-view height / 1080) and is computed once
 * per geometry/calibration change: no DOM measurement, no per-frame work.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GameHudSkinRects {
  /** The calibrated ability box, identical to ChromeGameHud's frame. */
  ability: Rect;
  /** The health/mana strip directly above the ability box. */
  health: Rect;
  /** Outer perimeter containing both plus padding, clamped to the game view. */
  surround: Rect;
  /** The minimap box, used to keep the surround clear of it. */
  minimap: Rect;
}

export type GameHudPieceKind =
  | 'health-lip'
  | 'health-cap-l'
  | 'health-cap-r'
  | 'divider'
  | 'plate-l'
  | 'plate-r'
  | 'bottom-lip'
  | 'crest';

export interface GameHudPiece {
  kind: GameHudPieceKind;
  /** Relative to the surround's top-left corner. */
  rect: Rect;
}

type Cal = { dx: number; dy: number; dw: number; dh: number };
const ZERO: Cal = { dx: 0, dy: 0, dw: 0, dh: 0 };

export function gameHudSkinRects(input: {
  geo: LeagueGeometry;
  calibration?: { ability?: Cal; minimap?: Cal };
  pad?: number;
  healthGap?: number;
}): GameHudSkinRects {
  const { geo } = input;
  const cal = input.calibration?.ability ?? ZERO;
  const mapCal = input.calibration?.minimap ?? ZERO;
  const pad = Math.max(4, Math.round(input.pad ?? 10 * geo.s));
  const gap = Math.max(1, Math.round(input.healthGap ?? 3 * geo.s));

  // Same math as ChromeGameHud's ability frame (left is the centre there, with
  // translateX(-50%); here it is the true left edge).
  const width = Math.max(40, geo.abilityW + cal.dw);
  const height = Math.max(24, geo.abilityH + cal.dh);
  const centre = geo.offsetX + geo.gameViewW / 2 + cal.dx;
  const bottom = geo.displayBottomInset + geo.abilityBottomPad + cal.dy;
  const ability: Rect = { left: centre - width / 2, top: geo.vh - bottom - height, width, height };

  const healthW = Math.round(width * 0.92);
  const healthH = Math.max(10, Math.round(20 * geo.s));
  const health: Rect = {
    left: centre - healthW / 2,
    top: ability.top - gap - healthH,
    width: healthW,
    height: healthH,
  };

  const mapW = Math.max(60, geo.mapSize + mapCal.dw);
  const mapH = Math.max(60, geo.mapSize + mapCal.dh);
  const mapRight = geo.displayRightInset + geo.mapPad - mapCal.dx;
  const mapBottom = geo.displayBottomInset + geo.mapPad + mapCal.dy;
  const minimap: Rect = { left: geo.vw - mapRight - mapW, top: geo.vh - mapBottom - mapH, width: mapW, height: mapH };

  const viewL = geo.offsetX;
  const viewR = geo.offsetX + geo.gameViewW;
  const viewT = geo.offsetY;
  const viewB = geo.offsetY + geo.gameViewH;

  let l = Math.max(viewL, ability.left - pad);
  let r = Math.min(viewR, ability.left + width + pad);
  // Never reach into the minimap: stop 2px short of its left edge when the
  // surround's vertical span overlaps it.
  const t = Math.max(viewT, health.top - pad);
  const b = Math.min(viewB, ability.top + height + pad);
  if (b > minimap.top && t < minimap.top + mapH && r > minimap.left - 2) {
    r = Math.max(ability.left + width, minimap.left - 2);
  }
  l = Math.min(l, ability.left);
  const surround: Rect = { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };

  return { ability, health, surround, minimap };
}

/**
 * Decorative pieces, all in the gutter outside the ability box and health strip
 * (a piece may touch an edge but never enters the interior).
 */
export function gameHudSkinPieces(rects: GameHudSkinRects, s: number): GameHudPiece[] {
  const { ability: a, health: h, surround: o } = rects;
  const rel = (x: number, y: number, w: number, hh: number): Rect => ({
    left: Math.round(x - o.left),
    top: Math.round(y - o.top),
    width: Math.max(0, Math.round(w)),
    height: Math.max(0, Math.round(hh)),
  });
  const line = Math.max(1, Math.round(2 * s));
  const capW = Math.max(3, Math.round(6 * s));
  const crestW = Math.max(12, Math.round(28 * s));
  const crestH = Math.max(6, Math.round(12 * s));

  const leftGutter = a.left - o.left;
  const rightGutter = o.left + o.width - (a.left + a.width);
  const topGutter = h.top - o.top;
  const bottomGutter = o.top + o.height - (a.top + a.height);
  const healthGap = a.top - (h.top + h.height);

  const pieces: GameHudPiece[] = [];
  if (topGutter >= line) {
    pieces.push({ kind: 'health-lip', rect: rel(h.left, h.top - line, h.width, line) });
    const crestTop = o.top;
    const crestHeight = Math.min(crestH, topGutter);
    pieces.push({ kind: 'crest', rect: rel(a.left + a.width / 2 - crestW / 2, crestTop, crestW, crestHeight) });
  }
  pieces.push({ kind: 'health-cap-l', rect: rel(h.left - capW, h.top - Math.min(line, topGutter), capW, h.height) });
  pieces.push({ kind: 'health-cap-r', rect: rel(h.left + h.width, h.top - Math.min(line, topGutter), capW, h.height) });
  if (healthGap >= 1) {
    pieces.push({ kind: 'divider', rect: rel(a.left, h.top + h.height, a.width, Math.min(line, healthGap)) });
  }
  if (leftGutter >= 2) pieces.push({ kind: 'plate-l', rect: rel(o.left, a.top, leftGutter, a.height) });
  if (rightGutter >= 2) pieces.push({ kind: 'plate-r', rect: rel(a.left + a.width, a.top, rightGutter, a.height) });
  if (bottomGutter >= 1) {
    pieces.push({ kind: 'bottom-lip', rect: rel(a.left, a.top + a.height, a.width, Math.min(line * 2, bottomGutter)) });
  }
  return pieces;
}
