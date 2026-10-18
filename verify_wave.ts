import { nextCannon, shouldShowCannonCue, CANNON_CUE_MAX_GAME_SEC } from './src/logic/waveLogic';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

// Mid game: should not treat cannon as "now" for overlay cues
ok(!shouldShowCannonCue(10 * 60), 'no cannon cue at 10:00');
ok(!shouldShowCannonCue(CANNON_CUE_MAX_GAME_SEC + 30), 'no cannon cue after laning cap');

const early = nextCannon(120);
ok(!!early?.isActionWindow || early === null, 'early cannon window sane');

if (!process.exitCode) console.log('verify:wave ok');
