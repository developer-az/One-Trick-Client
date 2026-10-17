import { assessJungleThreat, resetJungleThreatClock } from './src/logic/jungleLogic';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

resetJungleThreatClock();
const at7 = assessJungleThreat(
  7 * 60,
  [
    {
      championName: 'Lee Sin',
      level: 6,
      position: 'JUNGLE',
      scores: { creepScore: 8 },
      summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } },
    },
  ],
  'bot'
);
ok(at7?.gankRisk === 'high' || at7?.gankRisk === 'medium', `7m lee sin threat ${at7?.gankRisk}`);

const jgDown = assessJungleThreat(
  600,
  [
    {
      championName: 'Graves',
      level: 6,
      position: 'JUNGLE',
      isDead: true,
      scores: { creepScore: 40 },
      summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } },
    },
  ],
  'bot'
);
ok(jgDown?.label === 'Jg down', 'jg dead lowers threat');

resetJungleThreatClock();
const topFocus = assessJungleThreat(
  150,
  [
    {
      championName: 'Elise',
      level: 3,
      position: 'JUNGLE',
      scores: { creepScore: 12 },
      summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } },
    },
  ],
  'top'
);
ok(!!topFocus && topFocus.sideBias !== 'unknown', 'top focus lane scuttle read');

const twoSmite = assessJungleThreat(
  300,
  [
    {
      championName: 'Senna',
      level: 3,
      position: 'UTILITY',
      summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } },
    },
    {
      championName: 'Maokai',
      level: 3,
      position: 'JUNGLE',
      summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } },
    },
  ],
  'bot'
);
ok(twoSmite?.junglerName === 'Maokai', `prefer jungle tag over supp smite (${twoSmite?.junglerName})`);

if (!process.exitCode) console.log('verify:jungle ok');
