import {
  shouldRunOverlayClock,
  shouldRunMayhemDismissTick,
} from './src/overlay/overlayLogic';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

// --- shouldRunOverlayClock: hidden page must never tick ---------------------
const clockBase = {
  inGame: true,
  gameTime: 125,
  locked: false,
  moduleIds: [] as readonly string[],
  pageVisible: true,
};

ok(shouldRunOverlayClock(clockBase), 'clock ticks when visible, in game, clock running, unlocked');
ok(
  shouldRunOverlayClock({ ...clockBase, gameTime: 1 }),
  'clock ticks at gameTime 1'
);
ok(
  shouldRunOverlayClock({ ...clockBase, locked: true, moduleIds: ['sums'] }),
  'clock ticks when locked but sums module is shown'
);
ok(
  shouldRunOverlayClock({ ...clockBase, locked: true, moduleIds: ['clock', 'sums', 'kda'] }),
  "clock ticks when locked with 'sums' among several modules"
);

ok(
  !shouldRunOverlayClock({ ...clockBase, pageVisible: false }),
  'clock does not tick when page hidden'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, inGame: false }),
  'clock does not tick outside a game'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, gameTime: 0 }),
  'clock does not tick at gameTime 0'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, gameTime: null }),
  'clock does not tick when gameTime is null'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, gameTime: undefined }),
  'clock does not tick when gameTime is undefined'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, locked: true, moduleIds: [] }),
  'clock does not tick when locked without sums'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, locked: true, moduleIds: ['clock', 'kda'] }),
  "clock does not tick when locked without 'sums' among several modules"
);
ok(
  !shouldRunOverlayClock({
    ...clockBase,
    locked: true,
    moduleIds: ['sums'],
    pageVisible: false,
  }),
  'clock does not tick when hidden even with sums locked'
);
ok(
  !shouldRunOverlayClock({ ...clockBase, pageVisible: false, inGame: false, gameTime: 0 }),
  'clock does not tick when every gate is closed'
);

// --- shouldRunMayhemDismissTick: hidden page must never tick ----------------
const mayhemBase = {
  inMayhem: true,
  dismissedAt: 1700000000000,
  pageVisible: true,
};

ok(shouldRunMayhemDismissTick(mayhemBase), 'mayhem dismiss tick runs when visible in mayhem with a dismissal');
ok(
  shouldRunMayhemDismissTick({ ...mayhemBase, dismissedAt: 0 }),
  'mayhem dismiss tick runs when dismissedAt is 0 (0 counts as set)'
);
ok(
  !shouldRunMayhemDismissTick({ ...mayhemBase, pageVisible: false }),
  'mayhem dismiss tick does not run when page hidden'
);
ok(
  !shouldRunMayhemDismissTick({ ...mayhemBase, inMayhem: false }),
  'mayhem dismiss tick does not run outside mayhem'
);
ok(
  !shouldRunMayhemDismissTick({ ...mayhemBase, dismissedAt: null }),
  'mayhem dismiss tick does not run when dismissedAt is null'
);
ok(
  !shouldRunMayhemDismissTick({ ...mayhemBase, dismissedAt: undefined }),
  'mayhem dismiss tick does not run when dismissedAt is undefined'
);
ok(
  !shouldRunMayhemDismissTick({
    ...mayhemBase,
    pageVisible: false,
    inMayhem: false,
    dismissedAt: null,
  }),
  'mayhem dismiss tick does not run when every gate is closed'
);

if (!process.exitCode) console.log('verify:overlay-clock ok');
