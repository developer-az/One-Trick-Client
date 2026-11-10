/**
 * Overlay geometry and pure visibility/health decisions.
 * History: clusters were once separate tight HWNDs ("a fullscreen transparent
 * HWND forces DWM to composite the entire game"). The multi-window lifecycle
 * was retired 2026-11-10 (Step 2 single-window remake) after the overlay kept
 * vanishing mid-match inside it; the geometry math remains as the reference
 * for where widgets sit on the display, guarded by verify_overlay_bounds.
 */

export interface OverlayRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface OverlayCluster extends OverlayRect {
    id: string;
    moduleIds: string[];
    stickerIds: string[];
}

export interface OverlayWidget {
    id: string;
    kind: 'module' | 'sticker';
    xNorm: number;
    anchor?: string;
    scale?: number;
}

export interface OverlayLetterbox {
    offsetX: number;
    offsetY: number;
    gameViewW: number;
    gameViewH: number;
}

const MODULE_SIZE: Record<string, { w: number; h: number }> = {
    sums: { w: 236, h: 310 },
    gank: { w: 236, h: 120 },
    vision: { w: 236, h: 120 },
    buy: { w: 236, h: 96 },
    action: { w: 236, h: 120 },
    mayhem: { w: 360, h: 240 },
};

const STICKER_SIZE = { w: 56, h: 56 };
const PAD = 18;
const MAX_SLOTS = 4;

export function overlayScaleFromHud(hudScale: number): number {
    const safe = Number.isFinite(hudScale) ? Math.max(0, Math.min(100, hudScale)) : 20;
    return 0.75 + safe / 200;
}

export function letterboxGame(
    vw: number,
    vh: number,
    gameWidth = 1920,
    gameHeight = 1080
): OverlayLetterbox {
    const displayAspect = Math.max(1, vw) / Math.max(1, vh);
    const refW = gameWidth > 0 ? gameWidth : 1920;
    const refH = gameHeight > 0 ? gameHeight : 1080;
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
    return {
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        gameViewW: Math.round(gameViewW),
        gameViewH: Math.round(gameViewH),
    };
}

/**
 * Where the renderer actually paints a widget (see layoutStyle in
 * src/overlay/hudLayout.ts): x/y is always the unscaled box's top-left corner,
 * and the anchor only picks the transform origin for scale(). Treating 'tr' as
 * "x is the right edge" put the right rail's window to the left of its panels,
 * which then drew clipped at the window's edge.
 */
function placedRect(widget: OverlayWidget & { yNorm: number }, geo: OverlayLetterbox, hudScale: number): OverlayRect {
    const base = widget.kind === 'sticker' ? STICKER_SIZE : MODULE_SIZE[widget.id] || { w: 220, h: 120 };
    const widgetScale = Number.isFinite(widget.scale) ? Math.max(0.4, widget.scale as number) : 1;
    // Over-estimating is safe (a few transparent pixels); under-estimating clips.
    const scale = widgetScale * Math.max(1, overlayScaleFromHud(hudScale));
    const w = Math.round(base.w * scale);
    const h = Math.round(base.h * scale);
    const left = geo.offsetX + widget.xNorm * geo.gameViewW;
    const top = geo.offsetY + widget.yNorm * geo.gameViewH;
    const anchor = widget.anchor || 'tl';
    let x = left;
    let y = top;
    if (anchor === 'tr' || anchor === 'br') x = left + base.w - w;
    if (anchor === 'bl' || anchor === 'br') y = top + base.h - h;
    if (anchor === 'center') {
        x = left + (base.w - w) / 2;
        y = top + (base.h - h) / 2;
    }
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: w,
        height: h,
    };
}

function unionRects(rects: OverlayRect[]): OverlayRect | null {
    if (!rects.length) return null;
    let x1 = rects[0].x;
    let y1 = rects[0].y;
    let x2 = rects[0].x + rects[0].width;
    let y2 = rects[0].y + rects[0].height;
    for (let i = 1; i < rects.length; i += 1) {
        const r = rects[i];
        x1 = Math.min(x1, r.x);
        y1 = Math.min(y1, r.y);
        x2 = Math.max(x2, r.x + r.width);
        y2 = Math.max(y2, r.y + r.height);
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function clampToDisplay(rect: OverlayRect, display: OverlayRect): OverlayRect {
    const x = Math.max(display.x, Math.min(display.x + display.width - 8, display.x + rect.x - PAD));
    const y = Math.max(display.y, Math.min(display.y + display.height - 8, display.y + rect.y - PAD));
    const maxW = display.x + display.width - x;
    const maxH = display.y + display.height - y;
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(64, Math.min(maxW, rect.width + PAD * 2)),
        height: Math.max(64, Math.min(maxH, rect.height + PAD * 2)),
    };
}

export function clusterOverlayWindows(opts: {
    widgets: Array<OverlayWidget & { yNorm: number }>;
    display: OverlayRect;
    gameWidth?: number;
    gameHeight?: number;
    hudScale?: number;
}): OverlayCluster[] {
    const display = opts.display;
    const geo = letterboxGame(display.width, display.height, opts.gameWidth, opts.gameHeight);
    const hudScale = opts.hudScale ?? 20;
    const items = opts.widgets.map((widget) => ({
        widget,
        rect: placedRect(widget, geo, hudScale),
    }));
    if (!items.length) return [];

    const center = items.filter((row) => row.widget.xNorm >= 0.32 && row.widget.xNorm <= 0.68);
    const left = items.filter((row) => row.widget.xNorm < 0.32);
    const right = items.filter((row) => row.widget.xNorm > 0.68);
    const groups = [left, center, right].filter((group) => group.length > 0).slice(0, MAX_SLOTS);

    return groups.map((group, index) => {
        const box = unionRects(group.map((row) => row.rect));
        if (!box) {
            return {
                id: `slot-${index}`,
                x: display.x,
                y: display.y,
                width: 64,
                height: 64,
                moduleIds: [],
                stickerIds: [],
            };
        }
        const clamped = clampToDisplay(box, display);
        const id =
            groups.length === 1
                ? 'slot-0'
                : index === 0
                  ? 'slot-left'
                  : index === groups.length - 1
                    ? 'slot-right'
                    : 'slot-center';
        return {
            id,
            ...clamped,
            moduleIds: group.filter((row) => row.widget.kind === 'module').map((row) => row.widget.id),
            stickerIds: group.filter((row) => row.widget.kind === 'sticker').map((row) => row.widget.id),
        };
    });
}

/** How often an overlay page reports that it is still producing frames. */
export const OVERLAY_BEAT_EVERY_MS = 5000;
/** A shown window that has not produced a frame for this long is treated as not drawing. */
export const OVERLAY_PAINT_STALL_MS = 25000;

/**
 * What the OS and the page say about one overlay window. The app's own
 * "visible" flag is not enough: a window can be shown, on top and still not
 * be drawn, and only the page can tell whether frames are being produced.
 */
export interface OverlayWindowHealth {
    visible: boolean;
    minimized: boolean;
    onTop: boolean;
    /** Window bounds match the slot it was placed in. */
    boundsOk: boolean;
    /** How long the window has been shown; null when hidden. */
    msShown: number | null;
    /** Since the page last reported at all; null when it never has. */
    msSinceBeat: number | null;
    /** Since the page last reported a produced frame; null when it never has. */
    msSinceFrame: number | null;
    /** Page Visibility state from the last report; null when unknown. */
    pageVisible: boolean | null;
}

export type OverlayFault =
    | 'minimized'
    | 'not-on-top'
    | 'bounds'
    | 'no-heartbeat'
    | 'no-frames'
    | 'page-hidden';

/** Faults for one window. A hidden window has none: it is hidden on purpose. */
export function overlayWindowFaults(health: OverlayWindowHealth): OverlayFault[] {
    if (!health.visible) return [];
    const faults: OverlayFault[] = [];
    if (health.minimized) faults.push('minimized');
    if (!health.onTop) faults.push('not-on-top');
    if (!health.boundsOk) faults.push('bounds');
    const shownLongEnough = health.msShown !== null && health.msShown >= OVERLAY_PAINT_STALL_MS;
    if (shownLongEnough) {
        const beatStale = health.msSinceBeat === null || health.msSinceBeat >= OVERLAY_PAINT_STALL_MS;
        const frameStale = health.msSinceFrame === null || health.msSinceFrame >= OVERLAY_PAINT_STALL_MS;
        if (beatStale) faults.push('no-heartbeat');
        else if (frameStale) faults.push('no-frames');
    }
    if (health.pageVisible === false) faults.push('page-hidden');
    return faults;
}

/**
 * Whether a locked overlay window should exist on screen.
 * A live match does not override this: an empty transparent HWND over League
 * keeps DWM compositing the game even when the slot has nothing to draw.
 */
export function overlayWindowWanted(opts: {
    userHidden: boolean;
    overlayEnabled: boolean;
    locked: boolean;
    holdToShow: boolean;
    holdDown: boolean;
    emptySlot: boolean;
}): boolean {
    if (opts.userHidden || !opts.overlayEnabled) return false;
    if (!opts.locked) return true;
    if (opts.holdToShow && !opts.holdDown) return false;
    return !opts.emptySlot;
}

export function estimateModuleRect(
    id: string,
    xNorm: number,
    yNorm: number,
    geo: OverlayLetterbox,
    hudScale = 20,
    anchor?: string
): OverlayRect {
    return placedRect({ id, kind: 'module', xNorm, yNorm, anchor }, geo, hudScale);
}
