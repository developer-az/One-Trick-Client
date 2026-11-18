/**
 * Renderer Mayhem gate regression checks (Brief 2b).
 *
 * The augment roll panel may only paint when all of these hold:
 *  - the live board is Mayhem (ranked / classic ARAM never),
 *  - the opt-in HUD module is enabled,
 *  - OCR sees the augment window and it has not been dismissed,
 *  - there is at least one offer to rank,
 *  - this overlay window owns a Mayhem slot.
 *
 * Both mounts (full rail and compact panel) read the same pure predicate, so
 * the checks below evaluate it through each mount's slot rules.
 */
import {
  shouldShowMayhemPanel,
  type MayhemPanelGateInput,
} from './src/overlay/overlayLogic';
import { DEFAULT_HUD_MODULES, normalizeHudModules } from './src/overlay/hudModules';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

interface SlotMock {
  id: string;
  mode: 'locked' | 'compact' | 'align';
  moduleIds: string[];
}

/** Mirrors slotHasModule / mayhemOnThisWindow in OverlayApp.tsx. */
function windowHasMayhemSlot(slot: SlotMock | null): boolean {
  if (!slot) return false;
  const lockedSlot = slot.mode === 'locked';
  if (!lockedSlot) return true;
  const slotHasModule = (id: string): boolean => slot.moduleIds.includes(id);
  return (
    slotHasModule('mayhem') ||
    slotHasModule('vision') ||
    slot.id === 'slot-center' ||
    slot.id === 'slot-0'
  );
}

const base: MayhemPanelGateInput = {
  inMayhem: true,
  moduleEnabled: true,
  augmentWindow: true,
  dismissedRecently: false,
  offerCount: 3,
  windowHasMayhemSlot: true,
};

/** Full rail mount: locked windows only paint the slot they own. */
function railMount(slot: SlotMock, overrides: Partial<MayhemPanelGateInput> = {}): boolean {
  return shouldShowMayhemPanel({
    ...base,
    ...overrides,
    windowHasMayhemSlot: windowHasMayhemSlot(slot),
  });
}

/** Compact panel mount: no slot split, but the same predicate and toggles. */
function compactMount(slot: SlotMock, overrides: Partial<MayhemPanelGateInput> = {}): boolean {
  return shouldShowMayhemPanel({
    ...base,
    ...overrides,
    windowHasMayhemSlot: windowHasMayhemSlot(slot),
  });
}

function run(): void {
  console.log('--- verify:overlay-mayhem-gate: predicate ---');
  ok(shouldShowMayhemPanel(base) === true, 'Mayhem + module + cards + offers + slot shows the panel');
  ok(
    shouldShowMayhemPanel({ ...base, inMayhem: false }) === false,
    'classic ARAM / ranked board never shows the roll (inMayhem flag off)'
  );
  ok(
    shouldShowMayhemPanel({ ...base, moduleEnabled: false }) === false,
    'module toggle off hides the panel'
  );
  ok(
    shouldShowMayhemPanel({ ...base, augmentWindow: false }) === false,
    'no augment cards on screen hides the panel'
  );
  ok(
    shouldShowMayhemPanel({ ...base, dismissedRecently: true }) === false,
    'Page Up dismiss window hides the panel'
  );
  ok(shouldShowMayhemPanel({ ...base, dismissedRecently: false }) === true, 'dismiss window expiry brings it back');
  ok(shouldShowMayhemPanel({ ...base, offerCount: 0 }) === false, 'zero offers hides the panel');
  ok(shouldShowMayhemPanel({ ...base, offerCount: 1 }) === true, 'one offer still shows (OCR settling)');
  ok(shouldShowMayhemPanel({ ...base, offerCount: 2 }) === true, 'two offers still show (no 3-roll requirement)');
  ok(shouldShowMayhemPanel({ ...base, windowHasMayhemSlot: false }) === false, 'window without a Mayhem slot hides the panel');

  console.log('--- verify:overlay-mayhem-gate: full rail mount ---');
  const center: SlotMock = { id: 'slot-center', mode: 'locked', moduleIds: [] };
  const first: SlotMock = { id: 'slot-0', mode: 'locked', moduleIds: [] };
  const mayhemSlot: SlotMock = { id: 'slot-1', mode: 'locked', moduleIds: ['mayhem'] };
  const visionSlot: SlotMock = { id: 'slot-2', mode: 'locked', moduleIds: ['vision'] };
  const sumsSlot: SlotMock = { id: 'slot-3', mode: 'locked', moduleIds: ['sums', 'gank'] };
  ok(railMount(center) === true, 'slot-center shows the panel (legacy center window)');
  ok(railMount(first) === true, 'slot-0 shows the panel (legacy center window)');
  ok(railMount(mayhemSlot) === true, 'locked slot with the mayhem module shows the panel');
  ok(railMount(visionSlot) === true, 'locked slot with vision shows the panel (legacy mayhem slot)');
  ok(railMount(sumsSlot) === false, 'locked slot without mayhem/vision does not double-paint the panel');
  ok(railMount(center, { moduleEnabled: false }) === false, 'rail mount still respects the module toggle');
  ok(railMount(center, { augmentWindow: false }) === false, 'rail mount still respects the augment window');
  ok(railMount(center, { dismissedRecently: true }) === false, 'rail mount still respects the dismiss window');
  ok(railMount(center, { offerCount: 0 }) === false, 'rail mount still needs offers');
  ok(railMount(center, { inMayhem: false }) === false, 'rail mount never leaks outside Mayhem');

  console.log('--- verify:overlay-mayhem-gate: compact mount ---');
  const compact: SlotMock = { id: 'slot-1', mode: 'compact', moduleIds: [] };
  ok(compactMount(compact) === true, 'compact panel shows the panel without a slot module list');
  ok(compactMount(compact, { moduleEnabled: false }) === false, 'compact panel respects the module toggle');
  ok(compactMount(compact, { augmentWindow: false }) === false, 'compact panel respects the augment window');
  ok(compactMount(compact, { dismissedRecently: true }) === false, 'compact panel respects the dismiss window');
  ok(compactMount(compact, { offerCount: 0 }) === false, 'compact panel needs an offer');
  ok(compactMount(compact, { inMayhem: false }) === false, 'compact panel never leaks outside Mayhem');

  console.log('--- verify:overlay-mayhem-gate: module default ---');
  ok(DEFAULT_HUD_MODULES.mayhem === false, 'Mayhem overlay module stays off by default (opt-in beta)');
  ok(normalizeHudModules({}).mayhem === false, 'an empty persisted module blob keeps Mayhem off');
  ok(normalizeHudModules({ mayhem: true }).mayhem === true, 'a user can still opt in explicitly');

  if (!process.exitCode) console.log('verify:overlay-mayhem-gate ok');
}

run();
