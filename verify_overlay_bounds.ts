import { clusterOverlayWindows, letterboxGame, overlayScaleFromHud } from './electron/overlay-bounds';
import { dualRailLayout, compactRightLayout } from './src/overlay/hudLayout';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const display = { x: 0, y: 0, width: 1920, height: 1080 };
assert(overlayScaleFromHud(20) === 0.85, 'hud scale 20 → 0.85');
const box = letterboxGame(1920, 1080, 1920, 1080);
assert(box.offsetX === 0 && box.gameViewW === 1920, 'full-bleed letterbox');

const dual = dualRailLayout();
const dualClusters = clusterOverlayWindows({
  widgets: dual.elements
    .filter((el) => el.id !== 'frames' && el.visible)
    .map((el) => ({
      id: el.id,
      kind: 'module' as const,
      xNorm: el.x,
      yNorm: el.y,
      scale: el.scale,
      anchor: el.anchor,
    })),
  display,
  gameWidth: 1920,
  gameHeight: 1080,
  hudScale: 20,
});

assert(dualClusters.length === 2, `dual-rail should be two slim windows, got ${dualClusters.length}`);
const area = dualClusters.reduce((sum, c) => sum + c.width * c.height, 0);
assert(area < 1920 * 1080 * 0.28, `cluster area ${area} covers too much of the display`);
assert(dualClusters[0].width < 480, 'left rail stays a column');
assert(dualClusters[1].width < 480, 'right rail stays a column');
assert(dualClusters[0].moduleIds.includes('sums'), 'left owns sums');
assert(dualClusters[1].moduleIds.includes('gank'), 'right owns gank');

const compact = compactRightLayout();
const compactClusters = clusterOverlayWindows({
  widgets: compact.elements
    .filter((el) => el.id !== 'frames' && el.visible)
    .map((el) => ({
      id: el.id,
      kind: 'module' as const,
      xNorm: el.x,
      yNorm: el.y,
      scale: el.scale,
      anchor: el.anchor,
    })),
  display,
  hudScale: 20,
});
assert(compactClusters.length === 1, 'compact right is one window');
assert(compactClusters[0].width < 520, 'compact right is not fullscreen');
assert(compactClusters[0].x > 1200, 'compact right sits on the right');

console.log('overlay bounds ok', {
  dual: dualClusters.map((c) => `${c.id} ${c.width}x${c.height} @${c.x},${c.y} [${c.moduleIds.join(',')}]`),
  compact: `${compactClusters[0].width}x${compactClusters[0].height} @${compactClusters[0].x}`,
});
