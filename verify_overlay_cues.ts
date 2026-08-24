import {
  buildInGameCues,
  isCoachCueId,
  type OverlayState,
} from './src/overlay/overlayLogic';
import type { MatchupAnalysis } from './src/logic/pykeLogic';

const analysis: MatchupAnalysis = {
  title: 'Crush the lane',
  description: 'A long quoted essay that must never appear on the overlay.',
  winCondition: 'Win bot then roam.',
  aggressionLevel: 'HIGH',
  primaryTargets: ['Jinx'],
  majorThreats: [],
  tips: [
    'This is a rotating pro tip that must not leak into the live HUD as a coach line.',
    'Another long tip about wave management that belongs in champ select only.',
  ],
  loadingDoctrine: ['Hold for level 2', 'Do not all-in until E is up', 'Crash the third wave'],
  preyFocus: 'Kill Jinx first whenever Flash is down.',
};

const state: OverlayState = {
  inGame: true,
  gameTime: 125,
  localPlayer: {
    championName: 'Pyke',
    level: 3,
    isDead: false,
    items: [],
    currentGold: 500,
  },
  enemies: [
    { championName: 'Naafiri', level: 6, position: 'JUNGLE' },
    { championName: 'Jinx', level: 3, position: 'BOTTOM' },
    { championName: 'Nautilus', level: 3, position: 'UTILITY' },
  ],
  enemyBotSummoners: [
    {
      role: 'Bot',
      championName: 'Jinx',
      spells: [
        { name: 'Flash', short: 'Flash', baseCd: 300, remaining: 40, ready: false },
        { name: 'Heal', short: 'Heal', baseCd: 240, remaining: 0, ready: true },
      ],
    },
  ],
};

const cues = buildInGameCues(state, { analysis, profileId: 'pyke-support' });
const coach = cues.filter((c) => isCoachCueId(c.id) || c.id.startsWith('pro-tip') || c.id === 'matchup-doctrine');
const long = cues.filter((c) => c.label.length > 18);
const withDetail = cues.filter((c) => (c.detail || '').trim().length > 0);

let failed = false;
if (coach.length > 0) {
  console.error('Coach cues leaked onto HUD:', coach.map((c) => c.id));
  failed = true;
}
if (long.length > 0) {
  console.error('Cue labels longer than 18 chars:', long.map((c) => c.label));
  failed = true;
}
if (withDetail.length > 0) {
  console.error('Cue details should be empty on HUD:', withDetail.map((c) => c.id));
  failed = true;
}

console.log(`Overlay cues (${cues.length}):`, cues.map((c) => `${c.id}:${c.label}`).join(', ') || '(none)');
if (failed) {
  process.exit(1);
}
console.log('Overlay cue policy ok.');
