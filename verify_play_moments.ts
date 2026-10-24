import { snapshotFromState, tickPlayMoments, type PlayMomentSnapshot } from './src/logic/playMoments';
import type { PlayOverlayState } from './src/logic/playMoments';
import { SCORING_CONFIG } from './src/logic/scoring';

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
    hpPct: 1.0,
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
    hpPct: 0,
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
    hpPct: 0.25,
    scores: { ...died.localPlayer!.scores!, kills: 2, deaths: 1 },
  },
  enemies: [{ championName: 'Jinx', level: 6, isDead: true, hpPct: 0, scores: { kills: 0, deaths: 2, assists: 0, creepScore: 80 } }],
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
// The pre-kill state (`died`) needs the victim alive and full HP for the
// "victim HP >60%" rule to be measurable from the fight-start snapshot.
const diedPreFight: PlayOverlayState = {
  ...died,
  localPlayer: { ...died.localPlayer!, isDead: false, hpPct: 0.25 },
  enemies: [{ ...died.enemies![0], isDead: false, hpPct: 1.0 }],
};
const { recap: killRecap } = tickPlayMoments(prev, kill, diedPreFight);
const killEntry = killRecap.find((r) => r.kind === 'brilliant' && r.reasons);
ok(!!killEntry, 'kill recap');
ok(killEntry?.playLabel === 'Brilliant', `low-HP turnaround labelled Brilliant (got ${killEntry?.playLabel})`);
ok(!!killEntry?.score && killEntry.score >= SCORING_CONFIG.thresholds.brilliant, `low-HP score reaches Brilliant threshold (got ${killEntry?.score})`);
ok(!!killEntry?.reasons?.includes('Low-HP turnaround'), 'reasons include Low-HP turnaround');
ok(!!killEntry && killEntry.detail.includes('Jinx'), 'brilliant kill names Jinx instead of a canned line');
ok(!killEntry?.detail.includes('Convert to plate'), 'brilliant kill does not use the old canned tip');

const plainPrev = snapshotFromState(base);
const plainKill: PlayOverlayState = {
  ...base,
  gameTime: 640,
  localPlayer: {
    ...base.localPlayer!,
    scores: { ...base.localPlayer!.scores!, kills: 2 },
  },
  enemies: [{ championName: 'Jinx', level: 6, isDead: true, scores: { kills: 0, deaths: 1, assists: 0, creepScore: 80 } }],
};
const plain = tickPlayMoments(plainPrev, plainKill, base);
const plainEntry = plain.recap.find((r) => r.kind === 'brilliant');
ok(plainEntry?.playLabel === 'Good', `an ordinary kill stays Good (got ${plainEntry?.playLabel})`);
ok(!!plainEntry?.detail.includes('Jinx was 0/1'), `ordinary kill cites her record (got ${plainEntry?.detail})`);
ok(!plainEntry?.label.includes('Flash'), 'missing Flash data is not treated as Flash down');

const fedPrevState: PlayOverlayState = {
  ...base,
  enemies: [{ championName: 'Draven', level: 9, isDead: false, scores: { kills: 6, deaths: 1, assists: 2, creepScore: 90 } }],
};
const fedSnap = snapshotFromState(fedPrevState);
const fedKill: PlayOverlayState = {
  ...fedPrevState,
  gameTime: 800,
  localPlayer: {
    ...fedPrevState.localPlayer!,
    scores: { ...fedPrevState.localPlayer!.scores!, kills: 2 },
  },
  enemies: [{ championName: 'Draven', level: 9, isDead: true, scores: { kills: 6, deaths: 2, assists: 2, creepScore: 90 } }],
};
const fed = tickPlayMoments(fedSnap, fedKill, fedPrevState);
const fedEntry = fed.recap.find((r) => r.kind === 'brilliant');
ok(!!fedEntry?.reasons?.includes('Shutdown on a fed enemy'), 'a 6/1 victim is a shutdown');
ok(!!fedEntry?.detail.includes('Draven was 6/1'), `shutdown names the record (got ${fedEntry?.detail})`);
ok(fedEntry?.detail !== plainEntry?.detail, 'two kills do not share one tip');

const second: PlayOverlayState = {
  ...plainKill,
  gameTime: 648,
  localPlayer: {
    ...plainKill.localPlayer!,
    scores: { ...plainKill.localPlayer!.scores!, kills: 3 },
  },
  enemies: [
    { championName: 'Jinx', level: 6, isDead: true, scores: { kills: 0, deaths: 1, assists: 0, creepScore: 80 } },
    { championName: 'Thresh', level: 6, isDead: true, scores: { kills: 0, deaths: 1, assists: 2, creepScore: 20 } },
  ],
};
const doubled = tickPlayMoments(plain.snapshot, second, plainKill);
const doubleEntry = doubled.recap.find((r) => r.kind === 'brilliant');
ok(!!doubleEntry?.reasons?.includes('2x multi-kill'), `a second kill inside 10s is a multi-kill (got ${doubleEntry?.reasons?.join(', ')})`);
ok(!!doubleEntry?.detail.includes('Thresh'), `the second kill names Thresh (got ${doubleEntry?.detail})`);

const deathFacts = {
  now: {
    ts: 1,
    inGame: true,
    gameTime: 610,
    self: { champion: 'Pyke', level: 6, hpPct: 0, manaPct: null, currentGold: null, cs: 20 },
    players: [
      {
        riotId: 'TestPlayer#NA1',
        champion: 'Pyke',
        team: 'ORDER' as const,
        isSelf: true,
        isDead: true,
        respawnTimer: 12,
        level: 6,
        kills: 1,
        deaths: 1,
        assists: 2,
        cs: 20,
        items: [],
      },
      {
        riotId: 'EnemyBot',
        champion: 'Jinx',
        team: 'CHAOS' as const,
        isSelf: false,
        isDead: false,
        respawnTimer: 0,
        level: 6,
        kills: 1,
        deaths: 0,
        assists: 0,
        cs: 40,
        items: [],
      },
    ],
    minimap: null,
    events: [],
    lastEvent: null,
  },
  events: [
    {
      id: 4,
      name: 'ChampionKill',
      gameTime: 610,
      raw: { KillerName: 'EnemyBot', VictimName: 'TestPlayer', Assisters: ['Supp'] },
    },
  ],
};
const namedDeath = tickPlayMoments(snapshotFromState({ ...base, localPlayer: { ...base.localPlayer!, summonerName: 'TestPlayer' } as PlayOverlayState['localPlayer'] }), died, base, deathFacts);
const named = namedDeath.recap.find((r) => r.kind === 'blunder');
ok(!!named?.detail.includes('Jinx'), `death names the killer (got ${named?.detail})`);
ok(named?.detail !== 'Reset wave / sum timers before re-engage.', 'death is not the canned even-game tip');

if (!process.exitCode) console.log('verify:play-moments ok');
