// Match-history parsing and stats math.
import { enemiesFrom, roleOf, summarize } from './electron/match-history';
import { byChampion, recordAgainst, wilson } from './src/logic/stats';

function assert(c: unknown, m: string): void {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// Wilson 95%: 3/3 is not "100%", 50/100 is about 40%..60%.
const w3 = wilson(3, 3);
assert(near(w3.low, 0.4385) && w3.high === 1, `wilson 3/3 ${JSON.stringify(w3)}`);
const w50 = wilson(50, 100);
assert(near(w50.low, 0.4038) && near(w50.high, 0.5962), `wilson 50/100 ${JSON.stringify(w50)}`);

const part = (id: number, champ: number, team: number, lane: string, role: string, win: boolean) => ({
  participantId: id,
  championId: champ,
  teamId: team,
  stats: { win, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 150, neutralMinionsKilled: 10 },
  timeline: { lane, role },
});
const full = {
  gameId: 7,
  gameCreation: 1,
  gameDuration: 1800,
  queueId: 420,
  participants: [
    part(1, 555, 100, 'BOTTOM', 'DUO_SUPPORT', true),
    part(2, 222, 100, 'BOTTOM', 'DUO_CARRY', true),
    part(6, 99, 200, 'BOTTOM', 'DUO_SUPPORT', false),
    part(7, 51, 200, 'BOTTOM', 'DUO_CARRY', false),
    part(8, 238, 200, 'MIDDLE', 'SOLO', false),
  ],
  participantIdentities: [1, 2, 6, 7, 8].map((n) => ({ participantId: n, player: { puuid: n === 1 ? 'me' : `p${n}` } })),
};
const s = summarize(full, 'me');
assert(s && s.championId === 555 && s.win && s.cs === 160 && s.role === 'Support', `summarize ${JSON.stringify(s)}`);
const e = enemiesFrom(full, 'me');
assert(e.enemies.length === 3 && e.laneOpponent === 99, `enemies ${JSON.stringify(e)}`);
assert(roleOf({ timeline: { lane: 'BOTTOM', role: 'NONE' } }) === null, 'unknown bot role stays unknown');
// The list endpoint carries only you.
assert(summarize({ ...full, participants: [full.participants[0]] }, null)?.championId === 555, 'list endpoint self');

const games = [
  { ...s!, enemies: e.enemies, laneOpponent: e.laneOpponent },
  { ...s!, gameId: 8, win: false, enemies: [99], laneOpponent: 99 },
  { ...s!, gameId: 9, championId: 80, enemies: [51] },
];
const champs = byChampion(games);
assert(champs[0].championId === 555 && champs[0].games === 2 && champs[0].wins === 1, 'byChampion');
assert(near(champs[0].kda, 6), `kda ${champs[0].kda}`);
const vsLux = recordAgainst(games, 99);
assert(vsLux.games === 2 && vsLux.wins === 1, 'record vs Lux');
assert(recordAgainst(games, 51, { championId: 80 }).games === 1, 'record vs Cait on Pantheon');
console.log('verify:stats ok');
