// Summoner timer tracker: lane assignment, no replay of old kills, haste.
import * as t from './electron/summoner-tracker';
const sp = (a: string, b: string) => ({ summonerSpellOne: { displayName: a }, summonerSpellTwo: { displayName: b } });
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
t.resetSummonerTracker();
// Normal-draft style: no positions. Two "mid hint" champs + bot pair.
t.ingestLivePlayers([
  { championName: 'Lux', position: '', summonerSpells: sp('Flash', 'Ignite') },
  { championName: 'Caitlyn', position: '', summonerSpells: sp('Flash', 'Heal'), itemIds: [3158] },
  { championName: 'Zed', position: '', summonerSpells: sp('Flash', 'Ignite') },
  { championName: 'Graves', position: '', summonerSpells: sp('Flash', 'Smite') },
  { championName: 'Garen', position: '', summonerSpells: sp('Flash', 'Teleport') },
]);
const lanes = t.serializeSummoners(Date.now(), 'bot').concat(t.serializeSummoners(Date.now(), 'mid'));
const by = Object.fromEntries(lanes.map((l) => [l.role, l.championName]));
ok(by.Bot === 'Caitlyn' && by.Support === 'Lux' && by.Mid === 'Zed', `roles ${JSON.stringify(by)}`);
// Old kill (game time 300) seen first at game time 1500: no live timer.
t.ingestLiveEvents([{ EventID: 1, EventName: 'ChampionKill', EventTime: 300, VictimName: 'Caitlyn', KillerName: 'x' }], new Map(), 1500);
ok(t.serializeSummoners(Date.now(), 'bot').find((l) => l.role === 'Bot')!.spells.every((s) => s.ready), 'old kill not replayed');
// Fresh kill 20s ago: Heal timer = 240*100/110 - 20 ≈ 198s (Ionian boots).
t.ingestLiveEvents([{ EventID: 2, EventName: 'ChampionKill', EventTime: 1480, VictimName: 'Caitlyn', KillerName: 'x' }], new Map(), 1500);
const heal = t.serializeSummoners(Date.now(), 'bot').find((l) => l.role === 'Bot')!.spells.find((s) => s.name === 'Heal')!;
ok(Math.abs(heal.remaining - 199) <= 1, `heal remaining ${heal.remaining}`);
// No cross-lane toggle.
ok(!t.toggleSpellUsed('Mid', 'Heal').success, 'Mid Heal does not fall back to Bot');
t.resetSummonerTracker();
t.ingestChampSelectTeam([
  { championName: 'Caitlyn', assignedPosition: 'BOTTOM', spell1Id: 4, spell2Id: 7 },
]);
const map = new Map<string, string>([['Caitlyn', 'Caitlyn']]);
t.ingestLiveEvents(
  [{ EventID: 50, EventName: 'ChampionKill', EventTime: 100, VictimName: 'Caitlyn', KillerName: 'x' }],
  map,
  120
);
const botAfter1 = t.serializeSummoners(Date.now(), 'bot').find((l) => l.role === 'Bot')!;
const flash1 = botAfter1.spells.find((s) => s.name === 'Flash')!;
ok(flash1.remaining > 0, 'first death starts Flash CD');
t.ingestLiveEvents(
  [{ EventID: 51, EventName: 'ChampionKill', EventTime: 110, VictimName: 'Caitlyn', KillerName: 'y' }],
  map,
  130
);
const flash2 = t.serializeSummoners(Date.now(), 'bot').find((l) => l.role === 'Bot')!.spells.find((s) => s.name === 'Flash')!;
ok(flash2.remaining > 0 && flash2.remaining <= flash1.remaining, 'second death does not restart Flash');
