/* eslint-disable react-refresh/only-export-components --
 * This module is the skin ornament set: static SVG data, its serializer (the
 * verifier measures the exact markup) and the one ornaments component. Fast
 * refresh falls back to a full reload for it, which is fine for a constant
 * decoration module. */
import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { HudSkin } from './hudSkins';

/**
 * Static inline SVG ornament sets, one per HUD skin. Every mark is drawn in a
 * 24×24 viewBox with 1px `currentColor` strokes (the color is the champion
 * accent or chrome, set by `--ov-skin-orn`), rendered once per panel corner —
 * no images, no filters, no animation (R5/R11). Each rendered SVG stays far
 * below the 2 KB budget; `ornamentSvgSource()` is the same markup the
 * component draws, so `verify:hud-skins` can measure it.
 */

export const ORNAMENT_CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
export type OrnamentCorner = (typeof ORNAMENT_CORNERS)[number];

/** Corners a skin marks; gothic keeps the shipped top-left + bottom-right pair. */
const SKIN_CORNERS: Partial<Record<HudSkin, readonly OrnamentCorner[]>> = {
  gothic: ['tl', 'br'],
};

type OrnamentShape =
  | { k: 'path'; d: string; width?: number; opacity?: number; fill?: boolean }
  | { k: 'circle'; cx: number; cy: number; r: number; opacity?: number; fill?: boolean };

/** Corner mark per skin (top-left orientation; the other corners rotate it). */
const CORNER_MARKS: Record<HudSkin, OrnamentShape[]> = {
  gothic: [{ k: 'path', d: 'M1 11V1h10' }],
  bloodmoon: [
    { k: 'path', d: 'M1 23V7l6-6h16' },
    { k: 'path', d: 'M5 23V10l5-5h14', opacity: 0.55 },
    { k: 'path', d: 'M1 7 7 1', width: 1.5 },
  ],
  arcane: [
    { k: 'circle', cx: 6, cy: 6, r: 4.5 },
    { k: 'path', d: 'M6 0v2.2M6 9.8V12M0 6h2.2M9.8 6H12' },
    { k: 'path', d: 'M2.4 2.4 4 4M9.6 2.4 8 4' },
    { k: 'path', d: 'M1 23V14', opacity: 0.6 },
  ],
  ironclad: [
    { k: 'path', d: 'M1 9V1h8', width: 1.5 },
    { k: 'circle', cx: 5, cy: 5, r: 3.4 },
    { k: 'circle', cx: 5, cy: 5, r: 1.4, fill: true },
  ],
  warden: [
    { k: 'path', d: 'M2 22C7 20 10 16 11 10 6 11 3 15 2 22Z' },
    { k: 'path', d: 'M11 10c1-5 4-8 9-9-1 6-4 9-9 9Z' },
    { k: 'path', d: 'M12 10c3 0 6 2 8 5', opacity: 0.6 },
  ],
  hunter: [
    { k: 'circle', cx: 6, cy: 6, r: 2.6 },
    { k: 'path', d: 'M6 0v3.2M6 8.8V12M0 6h3.2M8.8 6H12' },
    { k: 'path', d: 'M1 23v-5', opacity: 0.5 },
  ],
  vanguard: [
    { k: 'path', d: 'M1 23V8l7-7h15' },
    { k: 'path', d: 'M4 23V10l6-6h14', opacity: 0.5 },
  ],
};

/** Header emblem for skins that carry one (vanguard's shield crest). */
const HEADER_EMBLEMS: Partial<Record<HudSkin, OrnamentShape[]>> = {
  vanguard: [
    { k: 'path', d: 'M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3Z' },
    { k: 'path', d: 'M12 6v11', opacity: 0.6 },
  ],
};

const ROTATION: Record<OrnamentCorner, number> = { tl: 0, tr: 90, br: 180, bl: 270 };

function shapeMarkup(shape: OrnamentShape): string {
  const fill = shape.fill ? 'currentColor' : 'none';
  const opacity = shape.opacity != null ? ` opacity="${shape.opacity}"` : '';
  if (shape.k === 'circle') {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}" stroke="currentColor" stroke-width="1"${opacity}/>`;
  }
  const width = shape.width ?? 1;
  return `<path d="${shape.d}" fill="${fill}" stroke="currentColor" stroke-width="${width}"${opacity}/>`;
}

function groupMarkup(shapes: OrnamentShape[]): string {
  return shapes.map(shapeMarkup).join('');
}

/**
 * The exact markup one corner SVG renders (static, trusted constant). The
 * verifier measures this per skin against the 2 KB ornament budget.
 */
export function ornamentSvgSource(skin: HudSkin, corner: OrnamentCorner = 'tl'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g transform="rotate(${ROTATION[corner]} 12 12)">${groupMarkup(
    CORNER_MARKS[skin]
  )}</g></svg>`;
}

/** Markup of a skin's header emblem, or '' when the skin has none. */
export function ornamentEmblemSource(skin: HudSkin): string {
  const shapes = HEADER_EMBLEMS[skin];
  if (!shapes) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${groupMarkup(
    shapes
  )}</svg>`;
}

export interface HudSkinChromeValue {
  /** Resolved concrete skin (Auto already mapped by class). */
  skin: HudSkin;
  /** Ornament toggle; false draws no corner marks at all. */
  ornaments: boolean;
}

const HudSkinChromeContext = createContext<HudSkinChromeValue>({ skin: 'gothic', ornaments: true });

export const HudSkinChromeProvider: React.FC<{
  value: HudSkinChromeValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <HudSkinChromeContext.Provider value={value}>{children}</HudSkinChromeContext.Provider>
);

export function useHudSkinChrome(): HudSkinChromeValue {
  return useContext(HudSkinChromeContext);
}

/**
 * Panels shorter than this draw no corner marks at all: a 22px mark cannot
 * fit a one-line plate (e.g. the "Dragon 95s" timer row) without touching the
 * text. Taller panels still check each corner against the panel's text rects
 * (see HudSkinOrnaments) so an ornament never covers a glyph.
 */
export const ORNAMENT_MIN_PANEL_HEIGHT = 34;

/** Text rects inside a panel (text nodes only, so padding is not counted). */
function textRectsIn(panel: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  if (typeof document === 'undefined') return rects;
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue || '';
    if (value.trim()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
      }
    }
    node = walker.nextNode();
  }
  return rects;
}

/** One static corner mark: an absolutely positioned span around an inline SVG. */
export const HudSkinOrnaments: React.FC<HudSkinChromeValue> = ({ skin, ornaments }) => {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const corners = SKIN_CORNERS[skin] ?? ORNAMENT_CORNERS;
  const emblem = ornamentEmblemSource(skin);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const panel = host?.parentElement;
    if (!ornaments || !host || !panel) return;
    let live = true;
    let frame = 0;
    let pendingFrame = 0;
    const measure = () => {
      if (!live) return;
      const spans = Array.from(host.querySelectorAll<HTMLElement>('.ov-skin-orn'));
      const hide = (span: HTMLElement) => {
        span.dataset.hidden = 'true';
      };
      if (panel.clientHeight < ORNAMENT_MIN_PANEL_HEIGHT) {
        spans.forEach(hide);
        return;
      }
      const textRects = textRectsIn(panel);
      for (const span of spans) {
        const rect = span.getBoundingClientRect();
        const covered =
          !!rect.width &&
          !!rect.height &&
          textRects.some(
            (text) =>
              rect.left < text.right - 0.5 &&
              rect.right > text.left + 0.5 &&
              rect.top < text.bottom - 0.5 &&
              rect.bottom > text.top + 0.5
          );
        if (covered) span.dataset.hidden = 'true';
        else delete span.dataset.hidden;
      }
    };
    /** Coalesce content/layout churn into one re-test per frame. */
    const schedule = () => {
      if (pendingFrame) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        measure();
      });
    };
    // The collision attribute is written straight to the marks (no state), so
    // a data payload never re-renders a panel because of an ornament.
    measure();
    // Panels settle their content one frame later; fonts can swap too.
    frame = window.requestAnimationFrame(measure);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(panel);
    // A row that appears after mount (e.g. the buy row) keeps the panel height
    // but adds text, so watch the subtree for structural changes as well.
    const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mutationObserver?.observe(panel, { childList: true, subtree: true });
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [skin, ornaments]);

  if (!ornaments) return null;
  return (
    <span ref={hostRef} className="ov-skin-orn-host" aria-hidden>
      {corners.map((corner) => (
        <span
          key={corner}
          data-orn={corner}
          className={`ov-skin-orn ov-skin-orn--${corner}`}
          dangerouslySetInnerHTML={{ __html: ornamentSvgSource(skin, corner) }}
        />
      ))}
      {emblem ? (
        <span
          data-orn="emblem"
          className="ov-skin-orn ov-skin-orn--emblem"
          dangerouslySetInnerHTML={{ __html: emblem }}
        />
      ) : null}
    </span>
  );
};

