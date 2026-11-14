import { schemeHoverCues } from './src/logic/mapScheme';
import type { JungleThreat } from './src/logic/jungleLogic';
import type { ObjectiveTimers } from './src/logic/gameState';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const jgBot: JungleThreat = {
  junglerName: 'Elise',
  sideBias: 'bot',
  gankRisk: 'high',
  probability: 78,
  label: 'Hot',
  detail: '',
  squareReason: '',
  clearStyle: 'early-gank',
};

const hold = schemeHoverCues({
  profileId: 'pyke-support',
  gameTimeSec: 6 * 60,
  jungleThreat: jgBot,
  level: 6,
});
ok(hold.some((c) => c.id === 'scheme-hold-lane' || c.id === 'hover-bot-tri'), 'jg bot → hold/ward tri cue');

const dragonTimers: ObjectiveTimers = {
  dragon: { key: 'dragon', killedAt: 500, nextSpawnAt: 560, inSec: 45, stolen: false },
  baron: null,
  herald: null,
};
const drake = schemeHoverCues({
  profileId: 'pyke-support',
  gameTimeSec: 515,
  jungleThreat: null,
  objectiveTimers: dragonTimers,
  level: 8,
});
ok(drake.some((c) => c.id === 'reset-before-dragon'), 'dragon soon → reset cue');

const mid = schemeHoverCues({
  profileId: 'yone-mid',
  gameTimeSec: 5 * 60,
  jungleThreat: { ...jgBot, sideBias: 'mid' },
  level: 6,
});
ok(mid.some((c) => c.id === 'hover-mid-river'), 'mid profile + jg mid → river hold');

if (!process.exitCode) console.log('verify:map-scheme ok');