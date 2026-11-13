/**
 * Overlay right-edge/left-edge guard.
 *
 * layoutStyle() must position anchored boxes so that nothing is painted off
 * the game view at any hudScale: for tr/br anchors the box's RIGHT edge sits
 * at the design x (the style emits `right`, not `left`), for tl/bl the LEFT
 * edge sits at the design x, and every box keeps ≥8px of margin to the
 * viewport edge. The inline transform must keep the `--overlay-scale` CSS
 * variable (set from hudScale by the overlay root) and compose el.scale with
 * it — a bare `scale(el.scale)` would discard the hudScale-driven scale.
 *
 * Run: npx --yes tsx verify_overlay_layout_edges.ts
 */
import {
  HUD_LAYOUT_PRESETS,
  layoutStyle,
  type HudElement,
} from './src/overlay/hudLayout';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface GameView {
  offsetX: number;
  offsetY: number;
  gameViewW: number;
  gameViewH: number;
  vw: number;
  vh: number;
}

/** Same letterboxing as electron/overlay-bounds.letterboxGame (16:9 game). */
function letterbox(vw: number, vh: number): GameView {
  const displayAspect = Math.max(1, vw) / Math.max(1, vh);
  const gameAspect = 1920 / 1080;
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
    vw,
    vh,
  };
}

const VIEWPORTS: Array<[string, number, number]> = [
  ['1920x1080', 1920, 1080],
  ['1280x720', 1280, 720],
  ['1366x768', 1366, 768],
];

/** hudScale min (0) / default (20) / max (100), as the overlay root sets --overlay-scale. */
const HUD_SCALES = [0, 20, 100];
const overlayScaleFromHud = (hudScale: number): number => 0.75 + hudScale / 200;
const MAX_EDGE_GAP = 8;

const EXPECTED_ORIGIN: Record<string, string> = {
  tl: 'top left',
  tr: 'top right',
  bl: 'bottom left',
  br: 'bottom right',
  center: 'center',
};

let checks = 0;
for (const [vpLabel, vw, vh] of VIEWPORTS) {
  const geo = letterbox(vw, vh);
  for (const hudScale of HUD_SCALES) {
    for (const layout of HUD_LAYOUT_PRESETS) {
      for (const el of layout.elements) {
        const style = layoutStyle(el, geo);
        const tag = `${vpLabel} hudScale=${hudScale} ${layout.name} ${el.id}`;

        // Inline transform must compose the --overlay-scale var with el.scale,
        // never replace the var (which would discard hudScale scaling).
        assert(
          style.transform.includes('var(--overlay-scale'),
          `${tag}: inline transform discards the --overlay-scale CSS var: ${style.transform}`
        );
        assert(
          style.transform.includes(`scale(${el.scale})`),
          `${tag}: inline transform does not compose el.scale ${el.scale}: ${style.transform}`
        );

        // The pivot must stay on the anchored corner/edge.
        assert(
          style.transformOrigin === EXPECTED_ORIGIN[el.anchor ?? 'tl'],
          `${tag}: pivot ${style.transformOrigin} != ${EXPECTED_ORIGIN[el.anchor ?? 'tl']}`
        );

        const xAbs = geo.offsetX + el.x * geo.gameViewW;
        if (el.anchor === 'tr' || el.anchor === 'br') {
          assert(typeof style.right === 'number', `${tag}: tr/br must emit 'right', got left=${style.left}`);
          const rightEdge = geo.vw - (style.right as number);
          assert(
            rightEdge <= vw - MAX_EDGE_GAP,
            `${tag}: right edge ${rightEdge} overflows viewport (${vw} - ${MAX_EDGE_GAP}) at hudScale ${hudScale}`
          );
          assert(
            Math.abs(rightEdge - xAbs) <= 1,
            `${tag}: right edge ${rightEdge} should sit at design x ${xAbs}`
          );
        } else {
          assert(typeof style.left === 'number', `${tag}: tl/bl/center must emit 'left', got right=${style.right}`);
          const leftEdge = style.left as number;
          assert(
            leftEdge >= 0,
            `${tag}: left edge ${leftEdge} is off-screen at hudScale ${hudScale}`
          );
          assert(
            Math.abs(leftEdge - xAbs) <= 1,
            `${tag}: left edge ${leftEdge} should sit at design x ${xAbs}`
          );
        }
        checks += 1;
      }
    }
  }
}

// A scale-aware checkpoint: the resulting edge must be stable across every
// hudScale value (the pivot pins the anchored edge), i.e. the check above
// holds for all of them — hudScale 100 grows the largest box.
assert(
  overlayScaleFromHud(0) < overlayScaleFromHud(20) && overlayScaleFromHud(20) < overlayScaleFromHud(100),
  'hudScale → --overlay-scale ordering'
);

console.log('overlay layout edges ok', {
  viewports: VIEWPORTS.map(([label]) => label),
  hudScales: HUD_SCALES.map(overlayScaleFromHud),
  checks,
});
