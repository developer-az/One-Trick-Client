import { snapshotFromState, tickPlayMoments, type PlayMomentSnapshot } from './src/logic/playMoments';
import type { PlayOverlayState } from './src/logic/playMoments';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const base: PlayOverlayState = {
  inGame: true,
  gameTime: 600,
  localPlayer: {
    championName: 'Pyke',
    level: 6,
    isDead: false,
    items: [],
    currentGold: 400,
    scores: { kills: 1, deaths: 0, assists: 2, creepScore: 20, wardScore: 3 },
  },
  enemies: [{ championName: 'Jinx', level: 6, isDead: false, scores: { kills: 0, deaths: 1, assists: 0, creepScore: 80 } }],
  enemyBotSummoners: [
    {
      role: 'Bot',
      championName: 'Jinx',
      spells: [
        { name: 'Flash', short: 'Flash', baseCd: 300, remaining: 0, ready: true },
        { name: 'Heal', short: 'Heal', baseCd: 240, remaining: 0, ready: true },
      ],
    },
  ],
};

let prev: PlayMomentSnapshot | null = snapshotFromState(base);
const died: PlayOverlayState = {
  ...base,
  gameTime: 610,
  localPlayer: {
    ...base.localPlayer!,
    isDead: true,
    scores: { ...base.localPlayer!.scores!, deaths: 1 },
  },
};
const { cues: deathCues, recap: deathRecap } = tickPlayMoments(prev, died);
ok(deathCues.some((c) => c.id === 'moment-you-died'), 'death cue');
ok(deathRecap.some((r) => r.kind === 'blunder'), 'death recap');

prev = snapshotFromState(died);
const kill: PlayOverlayState = {
  ...died,
  gameTime: 620,
  localPlayer: {
    ...died.localPlayer!,
    isDead: false,
    scores: { ...died.localPlayer!.scores!, kills: 2, deaths: 1 },
  },
  enemies: [{ championName: 'Jinx', level: 6, isDead: true, scores: { kills: 0, deaths: 2, assists: 0, creepScore: 80 } }],
  enemyBotSummoners: [
    {
      role: 'Bot',
      championName: 'Jinx',
      spells: [
        { name: 'Flash', short: 'Flash', baseCd: 300, remaining: 0, ready: true },
        { name: 'Heal', short: 'Heal', baseCd: 240, remaining: 0, ready: true },
      ],
    },
  ],
};
const { recap: killRecap } = tickPlayMoments(prev, kill);
ok(killRecap.some((r) => r.kind === 'brilliant'), 'kill recap');

if (!process.exitCode) console.log('verify:play-moments ok');
