/**
 * Tight overlay window rects. A fullscreen transparent HWND forces DWM to
 * composite the entire game (~24 FPS). Dual-rail becomes two slim columns.
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

function placedRect(widget: OverlayWidget & { yNorm: number }, geo: OverlayLetterbox, hudScale: number): OverlayRect {
    const scale = overlayScaleFromHud(hudScale) * (Number.isFinite(widget.scale) ? Math.max(0.4, widget.scale as number) : 1);
    const size = widget.kind === 'sticker' ? STICKER_SIZE : MODULE_SIZE[widget.id] || { w: 220, h: 120 };
    const w = Math.round(size.w * scale);
    const h = Math.round(size.h * scale);
    const left = geo.offsetX + widget.xNorm * geo.gameViewW;
    const top = geo.offsetY + widget.yNorm * geo.gameViewH;
    const anchor = widget.anchor || (widget.xNorm >= 0.5 ? 'tr' : 'tl');
    let x = left;
    let y = top;
    if (anchor === 'tr' || anchor === 'br') x = left - w;
    if (anchor === 'bl' || anchor === 'br') y = top - h;
    if (anchor === 'center') {
        x = left - w / 2;
        y = top - h / 2;
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

    const left = items.filter((row) => row.widget.xNorm < 0.5);
    const right = items.filter((row) => row.widget.xNorm >= 0.5);
    const groups = [left, right].filter((group) => group.length > 0).slice(0, MAX_SLOTS);

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
        return {
            id: `slot-${index}`,
            ...clamped,
            moduleIds: group.filter((row) => row.widget.kind === 'module').map((row) => row.widget.id),
            stickerIds: group.filter((row) => row.widget.kind === 'sticker').map((row) => row.widget.id),
        };
    });
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
