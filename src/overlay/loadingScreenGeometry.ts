/**
 * loadingScreenGeometry.ts — where League draws the loading-screen portraits.
 *
 * Pure geometry: no DOM, no React, no League client. The monitor captures the
 * side/index/teamSize tuple (payload `loadingSlot`), this module turns it into
 * CSS pixels, and the overlay uses the same rect for the companion's home and
 * for the card's placement beside it.
 *
 * There are no real loading-screen references in this repository (the client
 * draws it in its own window), so every ratio lives in LOADING_SCREEN and can
 * be tuned from one place after an in-game check.
 */

/** Portrait card rect in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** League's two loading-screen rows: blue/ORDER on top, red/CHAOS below. */
export type LoadingSide = 'ORDER' | 'CHAOS';

/** Which team row and where in it you load in. */
export interface LoadingSlot {
  /** null when only the champ-select fallback knows the order (no side there). */
  side: LoadingSide | null;
  /** Index among your team, as League orders the portraits. */
  index: number;
  teamSize: number;
  /** Where the tuple came from: only the session knows the side. */
  source: 'gameflow-session' | 'champ-select';
}

/** The card panel's fixed footprint (matches `.ov-loading-card`'s width). */
export const LOADING_PANEL_SIZE = { w: 300, h: 210 } as const;

export const LOADING_SCREEN = {
  /** One portrait card's height as a fraction of the viewport height. */
  rowHeightRatio: 0.41,
  /** Gap between the two rows, fraction of viewport height. */
  rowGapRatio: 0.04,
  /** Spacing between the cards of one row, fraction of viewport width. */
  cardGapRatio: 0.01,
  /** League's portrait aspect (308 × 560 px). */
  cardAspect: 308 / 560,
  /** A team row never holds more than five cards. */
  maxPerRow: 5,
  /** Panel placement: gap to the card and the screen margin, fractions of vw. */
  panelGapRatio: 0.008,
  panelMarginRatio: 0.012,
} as const;

function finiteOr(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The rect of one loading-screen portrait. Both rows are centred as a group,
 * the pair of rows is centred vertically, and the tuple is clamped so an
 * unexpected team size can never place a card outside the viewport.
 */
export function cardRect(
  side: LoadingSide | null,
  index: number,
  teamSize: number,
  viewportW: number,
  viewportH: number
): Rect {
  const vw = Math.max(1, finiteOr(viewportW, 1920));
  const vh = Math.max(1, finiteOr(viewportH, 1080));
  const size = Math.max(1, Math.min(LOADING_SCREEN.maxPerRow, Math.round(finiteOr(teamSize, 1))));
  const rowIndex = side === 'CHAOS' ? 1 : 0;

  const h = vh * LOADING_SCREEN.rowHeightRatio;
  const w = h * LOADING_SCREEN.cardAspect;
  const gapX = vw * LOADING_SCREEN.cardGapRatio;
  const gapY = vh * LOADING_SCREEN.rowGapRatio;

  const blockH = h * 2 + gapY;
  const top = Math.max(0, (vh - blockH) / 2);
  const totalW = size * w + (size - 1) * gapX;
  const left = Math.max(0, (vw - totalW) / 2);
  const column = Math.max(0, Math.min(size - 1, Math.round(finiteOr(index, 0))));

  return {
    x: left + column * (w + gapX),
    y: top + rowIndex * (h + gapY),
    w,
    h,
  };
}

/**
 * Where the static card panel goes: beside the user's card, on the side with
 * more free space, and always fully on-screen. Vertical position tracks the
 * card top, clamped into the viewport.
 */
export function loadingPanelRect(
  home: Rect,
  viewportW: number,
  viewportH: number,
  panel: { w: number; h: number } = LOADING_PANEL_SIZE
): { x: number; y: number } {
  const vw = Math.max(1, finiteOr(viewportW, 1920));
  const vh = Math.max(1, finiteOr(viewportH, 1080));
  const margin = vw * LOADING_SCREEN.panelMarginRatio;
  const gap = vw * LOADING_SCREEN.panelGapRatio;
  const freeRight = vw - (home.x + home.w);
  const freeLeft = home.x;
  const need = panel.w + gap + margin;

  let x: number;
  if (freeRight >= need && freeRight >= freeLeft) {
    x = home.x + home.w + gap;
  } else if (freeLeft >= need) {
    x = home.x - gap - panel.w;
  } else if (freeRight >= freeLeft) {
    // Neither side fits the panel plus its margin: hug the screen edge the
    // card leaves most room on, instead of drawing off-screen.
    x = Math.max(margin, vw - margin - panel.w);
  } else {
    x = margin;
  }

  const maxTop = Math.max(margin, vh - margin - panel.h);
  const y = Math.min(Math.max(margin, home.y), maxTop);

  return { x: Math.round(x), y: Math.round(y) };
}
