import {
  compactRightLayout,
  dualRailLayout,
  emptyCanvasLayout,
  layoutToHudModules,
  normalizeHudLayout,
  upsertSticker,
} from './src/overlay/hudLayout';
import { HUD_MODULE_IDS } from './src/overlay/hudModules';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const dual = dualRailLayout();
assert(dual.name === 'Locked dual-rail', 'dual-rail name');
assert(dual.elements.length === HUD_MODULE_IDS.length, 'all modules present');
assert(dual.elements.find((el) => el.id === 'frames')?.visible === false, 'frames off by default');
assert(dual.elements.find((el) => el.id === 'sums')?.x === 0.018, 'sums left rail');

const compact = compactRightLayout();
assert(compact.elements.every((el) => el.id === 'frames' || el.x >= 0.8 || !el.visible), 'compact right');

const empty = emptyCanvasLayout();
assert(empty.elements.every((el) => el.visible === false), 'empty hides modules');

const repaired = normalizeHudLayout({
  name: '  Custom board  ',
  elements: [{ id: 'sums', visible: false, x: 2, y: -1, scale: 9, opacity: 0 }],
  stickers: [
    { id: 's1', kind: 'mark', x: 0.2, y: 0.3, scale: 1, opacity: 1 },
    { id: 'bad', kind: 'nope' },
  ],
});
assert(repaired.name === 'Custom board', 'trim name');
const sums = repaired.elements.find((el) => el.id === 'sums');
assert(sums?.visible === false, 'override visible');
assert(sums && sums.x === 1 && sums.y === 0, 'clamp 0-1');
assert(sums && sums.scale <= 2.5, 'clamp scale');
assert(repaired.stickers.length === 1 && repaired.stickers[0].kind === 'mark', 'drop bad sticker');
assert(repaired.elements.find((el) => el.id === 'action'), 'missing modules filled from preset');

const modules = layoutToHudModules(dual);
assert(modules.sums && modules.action && !modules.frames, 'modules from layout');

const withSticker = upsertSticker(dual, {
  id: 'pin-1',
  kind: 'text',
  label: 'ONE TRICK',
  x: 0.5,
  y: 0.5,
  scale: 1,
  opacity: 1,
});
assert(withSticker.stickers[0].label === 'ONE TRICK', 'sticker pin');

const json = JSON.parse(JSON.stringify(withSticker));
assert(normalizeHudLayout(json).stickers[0].id === 'pin-1', 'round-trip JSON');

console.log('verify:layout ok');
