export interface LeagueGeometry {
  abilityW: number;
  abilityH: number;
  abilityBottomPad: number;
  mapSize: number;
  mapPad: number;
  displayBottomInset: number;
  displayRightInset: number;
  offsetX: number;
  offsetY: number;
  gameViewW: number;
  gameViewH: number;
  safeHud: number;
  safeMap: number;
  g: number;
  m: number;
  vh: number;
  vw: number;
  s: number;
  refH: number;
  refW: number;
}

/**
 * Letterbox the configured game res into the overlay display and size
 * League's bottom HUD cluster + minimap. Shared by the live overlay and studio.
 */
export function computeLeagueGeometry(opts: {
  vw: number;
  vh: number;
  hudScale?: number;
  mapScale?: number;
  gameWidth?: number;
  gameHeight?: number;
}): LeagueGeometry {
  const vw = Math.max(1, opts.vw);
  const vh = Math.max(1, opts.vh);
  const safeHud = Number.isFinite(opts.hudScale) ? Math.max(0, Math.min(100, opts.hudScale as number)) : 20;
  const safeMap = Number.isFinite(opts.mapScale) ? Math.max(0, Math.min(100, opts.mapScale as number)) : 33;
  const refH = opts.gameHeight && opts.gameHeight > 0 ? opts.gameHeight : 1080;
  const refW = opts.gameWidth && opts.gameWidth > 0 ? opts.gameWidth : 1920;

  const displayAspect = vw / vh;
  const gameAspect = refW / Math.max(1, refH);
  let gameViewW: number;
  let gameViewH: number;
  let offsetX: number;
  let offsetY: number;
  if (displayAspect > gameAspect) {
    gameViewH = vh;
    gameViewW = vh * gameAspect;
    offsetX = (vw - gameViewW) / 2;
    offsetY = 0;
  } else {
    gameViewW = vw;
    gameViewH = vw / gameAspect;
    offsetX = 0;
    offsetY = (vh - gameViewH) / 2;
  }

  const s = gameViewH / 1080;
  const g = safeHud / 100;
  const m = 0.5 + (safeMap / 100) * 1.5;
  const mapNorm = (m - 0.5) / 1.5;

  const abilityW = Math.round((540 + 460 * g) * s);
  const abilityH = Math.round((88 + 62 * g) * s);
  const abilityBottomPad = Math.round((3 + 4 * g) * s);
  const mapSize = Math.round((140 + 220 * mapNorm) * s);
  const mapPad = Math.round((2 + 6 * mapNorm) * s);
  const displayBottomInset = Math.max(0, Math.round(vh - offsetY - gameViewH));
  const displayRightInset = Math.max(0, Math.round(vw - offsetX - gameViewW));

  return {
    abilityW,
    abilityH,
    abilityBottomPad,
    mapSize,
    mapPad,
    displayBottomInset,
    displayRightInset,
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
    gameViewW: Math.round(gameViewW),
    gameViewH: Math.round(gameViewH),
    safeHud,
    safeMap,
    g,
    m,
    vh,
    vw,
    s,
    refH,
    refW,
  };
}
