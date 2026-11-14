import { rankOverlayCues, type DangerFusionContext } from './src/logic/cueRank';
import type { OverlayCue } from './src/overlay/overlayLogic';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

const baseCtx: DangerFusionContext = {
  profileId: 'pyke-support',
  situation: { state: 'even', levelDelta: 0, kills: 0, deaths: 0, assists: 0, minutes: 7, swing: 0, reasons: [] },
  jungleThreat: {
    junglerName: 'Lee Sin',
    sideBias: 'bot',
    gankRisk: 'high',
    probability: 82,
    label: 'Hot',
    detail: '',
    squareReason: '',
    clearStyle: 'early-gank',
  },
  botFlashRemainingSec: 45,
  objectiveTimers: null,
  gameTimeSec: 7 * 60,
  buildProgress: null,
  build: null,
};

const cues: OverlayCue[] = [
  { id: 'roam-cannon', label: 'Roam now', detail: 'generic', urgency: 'warn' },
  { id: 'prey-focus', label: 'Prey Jinx', detail: 'kill adc', urgency: 'spike' },
  { id: 'sum-flash', label: 'Flash 45s', detail: 'punish', urgency: 'spike' },
  { id: 'scheme-hold-lane', label: 'Hold bot tri', detail: 'jg', urgency: 'spike' },
];

const ranked = rankOverlayCues(cues, baseCtx, 'bot');
ok(ranked[0].id === 'prey-focus' || ranked[0].id === 'sum-flash', `pyke weights danger first: ${ranked[0].id}`);
ok((ranked.find((c) => c.id === 'roam-cannon')?.confidence ?? 0) < (ranked[0].confidence ?? 0), 'roam demoted when prey up');

const sellCtx: DangerFusionContext = {
  ...baseCtx,
  buildProgress: {
    ownedIds: new Set(['3865', '3179', '3158', '3877']),
    path: [],
    remaining: [{ id: '3107', name: 'Redemption' }],
    next: { id: '3107', name: 'Redemption' },
    completedCount: 3,
    hasBoots: true,
    hasFinishedBoots: true,
  },
  build: {
    core: [],
    boots: { id: '3158', name: 'Boots' },
    situational: [],
  },
};

const bootCues: OverlayCue[] = [
  { id: 'boot-slot-sell', label: 'Sell boots', detail: '', urgency: 'spike' },
  { id: 'prey-focus', label: 'Prey Jinx', detail: '', urgency: 'spike' },
];
const bootRanked = rankOverlayCues(bootCues, sellCtx, 'bot');
const sellScore = bootRanked.find((c) => c.id === 'boot-slot-sell')?.confidence ?? 0;
ok(sellScore < (bootRanked.find((c) => c.id === 'prey-focus')?.confidence ?? 0), 'immature sell loses to prey');

const immatureCtx: DangerFusionContext = {
  ...sellCtx,
  buildProgress: {
    ...sellCtx.buildProgress!,
    ownedIds: new Set(['3158', '1036']),
    next: { id: '3179', name: 'Umbral' },
  },
};
const immatureSell = rankOverlayCues(
  [{ id: 'boot-slot-sell', label: 'Sell boots', detail: '', urgency: 'spike' }],
  immatureCtx,
  'bot'
);
ok((immatureSell[0].confidence ?? 0) < 40, 'boot sell gated when build immature');

if (!process.exitCode) console.log('verify:cue-rank ok');