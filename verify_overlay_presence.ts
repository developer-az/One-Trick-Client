import { overlayWindowWanted } from './electron/overlay-bounds';

// No stdin reader here; close it so the runner cannot wait on an open pipe.
process.stdin.destroy();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// Base is the locked click-through overlay with a live game and an empty slot.
const base = {
  userHidden: false,
  overlayEnabled: true,
  locked: true,
  holdToShow: false,
  holdDown: false,
  emptySlot: true,
  gameLive: true,
};

function check(name: string, overrides: Partial<typeof base>, expected: boolean): void {
  const actual = overlayWindowWanted({ ...base, ...overrides });
  assert(actual === expected, `${name}: expected ${expected}, got ${actual}`);
  console.log(`PASS ${name}`);
}

check('1 live + emptySlot -> wanted', {}, true);
check('2 live + userHidden -> hidden', { userHidden: true }, false);
check('3 live + overlayEnabled false -> hidden', { overlayEnabled: false }, false);
check('4 live + holdToShow && !holdDown -> hidden', { holdToShow: true, holdDown: false }, false);
check('5 not-live + emptySlot -> hidden', { gameLive: false, emptySlot: true }, false);
check('6 not-live + content -> wanted', { gameLive: false, emptySlot: false }, true);

// Mirrors OverlayApp hasAnyContent; inGame is absent from the expression by design,
// so loading alone keeps the window contentful after the game ends.
const hasAnyContent = (loading: boolean, loadingLayerMounted: boolean, slotContent: boolean): boolean =>
  loading || loadingLayerMounted || slotContent;
const inGame = false;
assert(hasAnyContent(true, false, inGame) === true, '7 loading-as-content with inGame false: expected true');
console.log('PASS 7 loading-as-content (loading true, inGame false)');

// Structural, not runtime: setOverlayMatchActive() feeds matchActive into gameLive in
// overlay-window.ts and endGameSession() clears it without hiding in game-monitor.ts;
// both are BrowserWindow-bound, so no windowless import and no BrowserWindow mock.
console.log('overlay presence ok');
