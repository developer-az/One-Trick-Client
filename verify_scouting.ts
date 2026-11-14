import { parseChampSelectScoutingSession } from './electron/scouting';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('ok', msg);
}

const fixture = {
  myTeam: [
    { summonerId: 1, championId: 555, team: 100, puuid: 'a' },
    { summonerId: 2, championId: 222, team: 100, puuid: 'b' },
  ],
  theirTeam: [
    { summonerId: 3, championId: 99, team: 200, puuid: 'c' },
    { summonerId: 4, championId: 51, team: 200, puuid: 'd' },
  ],
};

const parsed = parseChampSelectScoutingSession(fixture);
ok(parsed.length === 4, 'parses 10-player-ish session rows');
ok(parsed.every((p) => p.summonerId > 0 && p.championId > 0), 'ids normalized');
ok(parseChampSelectScoutingSession(null).length === 0, 'null session is empty');

console.log('verify:scouting ok');