import { lossMatchupInsights, championLossProfile } from './src/logic/lossInsights';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const pyke = 555;
const thresh = 412;
const lux = 99;

const games = [
  { championId: pyke, win: false, kills: 1, deaths: 8, assists: 2, cs: 40, durationSec: 1800, enemies: [thresh, lux] },
  { championId: pyke, win: false, kills: 2, deaths: 7, assists: 4, cs: 35, durationSec: 1900, enemies: [thresh] },
  { championId: pyke, win: true, kills: 5, deaths: 2, assists: 10, cs: 50, durationSec: 2000, enemies: [lux] },
  { championId: pyke, win: false, kills: 0, deaths: 9, assists: 1, cs: 30, durationSec: 1700, enemies: [thresh, lux] },
];

const insights = lossMatchupInsights(games, pyke);
ok(insights.length >= 1, 'surfaces loss enemies');
ok(insights[0].enemyChampionId === thresh, 'thresh tops loss share');
ok(insights[0].avgDeathsWhenLoss > insights[0].avgDeathsWhenWin, 'death gap on thresh');

const profile = championLossProfile(games, pyke);
ok(!!profile && profile.losses === 3, 'loss profile counts');
ok(profile!.avgKdaLoss < profile!.avgKdaWin, 'worse kda on losses');

if (!process.exitCode) console.log('verify:loss-insights ok');
