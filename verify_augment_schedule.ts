import { planMayhemOcr, xpProgressToNextLevel } from './src/logic/mayhem/augmentSchedule';
import { computeMayhemPickPhase, inferMayhemPicksTakenFromLevel } from './src/logic/mayhem/pickPhase';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const now = Date.now();
const hitL3 = planMayhemOcr({
  level: 7,
  previousLevel: 6,
  gameTime: 120,
  nowMs: now,
  burstUntilMs: 0,
});
ok(hitL3.cadence === 'burst', 'reaching level 7 triggers burst');

const xpHigh = planMayhemOcr({
  level: 6,
  previousLevel: 6,
  championStats: { experience: 80, experienceToNextLevel: 100 },
  gameTime: 400,
  nowMs: now,
  burstUntilMs: 0,
});
ok(xpHigh.cadence === 'burst', 'high xp before L7 triggers burst');

ok(xpProgressToNextLevel({ experience: 50, experienceToNextLevel: 100 }) === 0.5, 'xp progress');

const deadL7 = computeMayhemPickPhase({
  level: 7,
  gameTime: 500,
  isDead: true,
  wasDead: false,
  ownedAugmentCount: 1,
});
ok(deadL7.pickWindowOpen, 'L7 dead opens augment window');

const aliveL7 = computeMayhemPickPhase({
  level: 7,
  gameTime: 500,
  isDead: false,
  wasDead: false,
  ownedAugmentCount: 1,
});
ok(aliveL7.waitingForDeath, 'L7 alive waits for death');
ok(!aliveL7.pickWindowOpen, 'L7 alive does not open augment window');

const aliveL3Late = computeMayhemPickPhase({
  level: 3,
  gameTime: 500,
  isDead: false,
  wasDead: false,
  ownedAugmentCount: 0,
});
ok(!aliveL3Late.pickWindowOpen, 'L3 alive mid-game does not keep augment overlay open');
ok(aliveL3Late.waitingForDeath, 'L3 alive still needs death for first pick');
ok(inferMayhemPicksTakenFromLevel(5, 0) === 1, 'L5 infers first augment taken');
ok(inferMayhemPicksTakenFromLevel(8, 2) === 2, 'stored owned wins over level infer');

const spawnL1 = computeMayhemPickPhase({ level: 1, gameTime: 5, isDead: false, wasDead: false, ownedAugmentCount: 0 });
ok(spawnL1.pickWindowOpen && spawnL1.ocrBurst, 'first augment on spawn at level 1 opens the window alive');
const spawnL3 = computeMayhemPickPhase({ level: 3, gameTime: 5, isDead: false, wasDead: false, ownedAugmentCount: 0 });
ok(spawnL3.pickWindowOpen, 'first augment on spawn at level 3 opens the window alive');
if (!process.exitCode) console.log('verify:augment-schedule ok');
