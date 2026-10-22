/**
 * Parametric League HUD geometry.
 *
 * The user's resolution, HUD scale, minimap scale and minimap side vary per
 * player, so no ROI is stored as absolute pixels. Everything is derived from
 * the game's own settings (game.cfg) as NORMALIZED 0-1 coordinates against the
 * client area — the "resolution / HUD scale / minimap side" requirement in
 * docs/plan.md.
 *
 * Layout anchors (League HUD is edge/centre anchored, not aspect-scaled):
 *   - player frame: bottom-centre (HP/mana/abilities/level/items/gold/CS)
 *   - minimap: bottom-right OR bottom-left (user setting; auto-detect + nudge later)
 *   - team scores: top-centre, announcements just under it, kill feed top-right
 *
 * These are baseline estimates. Phase 3 anchor detection + the Phase 4 manual
 * nudge in the calibration UI absorb residual error; never hard-trust them alone.
 */

export interface HudGeometryInput {
    width: number; // client area width in px (game.cfg Width)
    height: number; // client area height in px (game.cfg Height)
    hudScale: number; // 0-100 slider (game.cfg GlobalScale x 100)
    mapScale: number; // 0-100 slider (game.cfg MinimapScale / 0.03)
    minimapSide: 'right' | 'left';
}

export interface Roi {
    id: string;
    x: number; // normalized 0-1 against client width
    y: number; // normalized 0-1 against client height
    w: number; // normalized width
    h: number; // normalized height
    /** Price per pass — drives the change-gated per-ROI polling rates. */
    rate: 'minimap' | 'self' | 'slow' | 'on-change';
}

const BASE = {
    // Baseline px estimates at 1920x1080, GlobalScale 1.0, MinimapScale 1.0.
    minimapSize: 310, // square incl. border at default scales
    minimapInset: 14,
    playerFrameW: 880, // portrait + HP + abilities + items band
    playerFrameH: 190,
    playerFrameBottomInset: 16,
    teamScoreW: 420,
    teamScoreH: 110,
    teamScoreTopInset: 12,
    killFeedW: 420,
    killFeedH: 180,
    killFeedTopInset: 150,
    announcementW: 560,
    announcementH: 130,
    announcementTopInset: 150,
};

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function norm(px: number, span: number): number {
    return span > 0 ? clamp01(px / span) : 0;
}

/** Build every ROI from the user's own settings. */
export function buildHudGeometry(input: HudGeometryInput): Roi[] {
    const { width, height } = input;
    const hud = Math.max(0.5, Math.min(1.0, input.hudScale / 100));
    const map = Math.max(0.5, Math.min(1.5, input.mapScale / 100));
    const side = input.minimapSide;

    const minimapPx = BASE.minimapSize * map * hud;
    const insetPx = BASE.minimapInset * hud;
    const playerW = BASE.playerFrameW * hud;
    const playerH = BASE.playerFrameH * hud;
    const playerBottom = BASE.playerFrameBottomInset * hud;
    const scoreW = BASE.teamScoreW * hud;
    const scoreH = BASE.teamScoreH * hud;
    const scoreTop = BASE.teamScoreTopInset * hud;
    const feedW = BASE.killFeedW * hud;
    const feedH = BASE.killFeedH * hud;
    const feedTop = BASE.killFeedTopInset * hud;
    const annW = BASE.announcementW * hud;
    const annH = BASE.announcementH * hud;
    const annTop = BASE.announcementTopInset * hud;

    const rois: Roi[] = [];

    // Minimap: bottom-right or bottom-left, square.
    const mmX = side === 'right' ? width - minimapPx - insetPx : insetPx;
    rois.push({
        id: 'minimap',
        x: norm(mmX, width),
        y: norm(height - minimapPx - insetPx, height),
        w: norm(minimapPx, width),
        h: norm(minimapPx, height),
        rate: 'minimap',
    });

    // Player frame: bottom-centre.
    const pfX = (width - playerW) / 2;
    const pfY = height - playerH - playerBottom;
    rois.push({
        id: 'selfPortraitHp',
        x: norm(pfX, width),
        y: norm(pfY, height),
        w: norm(playerW * 0.28, width),
        h: norm(playerH, height),
        rate: 'self',
    });
    rois.push({
        id: 'selfAbilities',
        x: norm(pfX + playerW * 0.28, width),
        y: norm(pfY, height),
        w: norm(playerW * 0.34, width),
        h: norm(playerH * 0.9, height),
        rate: 'self',
    });
    rois.push({
        id: 'selfItemsGold',
        x: norm(pfX + playerW * 0.62, width),
        y: norm(pfY + playerH * 0.15, height),
        w: norm(playerW * 0.38, width),
        h: norm(playerH * 0.85, height),
        rate: 'slow',
    });

    // Team scores (kills/towers/objective timers): top-centre.
    rois.push({
        id: 'teamScoreTop',
        x: norm((width - scoreW) / 2, width),
        y: norm(scoreTop, height),
        w: norm(scoreW, width),
        h: norm(scoreH, height),
        rate: 'slow',
    });

    // Kill feed: top-right (calibration UI nudges if the user's setting differs).
    rois.push({
        id: 'killFeed',
        x: norm(width - feedW - insetPx * 2, width),
        y: norm(feedTop, height),
        w: norm(feedW, width),
        h: norm(feedH, height),
        rate: 'on-change',
    });

    // Announcements: top-centre under scores.
    rois.push({
        id: 'announcement',
        x: norm((width - annW) / 2, width),
        y: norm(annTop, height),
        w: norm(annW, width),
        h: norm(annH, height),
        rate: 'on-change',
    });

    // Chat: opposite bottom corner from the minimap.
    const chatX = side === 'right' ? insetPx : width - feedW - insetPx * 2;
    rois.push({
        id: 'chat',
        x: norm(chatX, width),
        y: norm(height - playerH - 220 * hud, height),
        w: norm(feedW, width),
        h: norm(200 * hud, height),
        rate: 'on-change',
    });

    return rois;
}

/** Per-ROI poll rates in Hz from the plan's gating rules. */
export const ROI_RATES_HZ: Record<Roi['rate'], number> = {
    minimap: 8,
    self: 10,
    slow: 1,
    'on-change': 15, // cheap hash check at 15 fps; parser fires only on change
};

const MATRIX: Array<[number, number, number, number, 'right' | 'left']> = [
    [1920, 1080, 100, 100, 'right'],
    [1920, 1080, 50, 50, 'left'],
    [2560, 1440, 100, 100, 'right'],
    [2560, 1440, 50, 50, 'left'],
    [3840, 2160, 100, 100, 'right'],
    [3440, 1440, 100, 100, 'right'],
    [1920, 1080, 100, 50, 'left'],
];

/**
 * Sanity gate: every ROI must sit inside the client area, and the player frame
 * must never overlap the minimap (centre-anchored vs edge-anchored regions, so
 * overlap = a geometry bug, not a settings quirk).
 */
export function verifyHudGeometry(): boolean {
    let ok = true;
    for (const [width, height, hudScale, mapScale, side] of MATRIX) {
        const rois = buildHudGeometry({ width, height, hudScale, mapScale, minimapSide: side });
        for (const roi of rois) {
            const x2 = roi.x + roi.w;
            const y2 = roi.y + roi.h;
            if (!(roi.x >= 0 && roi.y >= 0 && x2 <= 1 && y2 <= 1)) {
                console.error(
                    `FAIL ${width}x${height} hud=${hudScale} map=${mapScale} side=${side} ` +
                        `roi=${roi.id} out of bounds (${roi.x},${roi.y},${roi.w},${roi.h})`
                );
                ok = false;
            }
        }
        const pf = rois.find((r) => r.id === 'selfPortraitHp');
        const mm = rois.find((r) => r.id === 'minimap');
        if (pf && mm) {
            const overlap =
                pf.x < mm.x + mm.w && pf.x + pf.w > mm.x && pf.y < mm.y + mm.h && pf.y + pf.h > mm.y;
            if (overlap) {
                console.error(`FAIL ${width}x${height} side=${side}: player frame overlaps minimap`);
                ok = false;
            }
        }
    }
    if (ok) console.log(`HUD geometry OK across ${MATRIX.length} settings combos.`);
    return ok;
}

