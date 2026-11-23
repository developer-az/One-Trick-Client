import { recentFormFromMatchHistory } from './electron/scouting';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('ok', msg);
}

/** LCU match history: identity lives in participantIdentities[].player.puuid. */
const identityOnly = {
  games: {
    games: [
      {
        json: {
          participantIdentities: [
            { participantId: 1, player: { puuid: 'someone-else' } },
            { participantId: 3, player: { puuid: 'target-puuid' } },
          ],
          participants: [
            { participantId: 1, stats: { win: true } },
            { participantId: 3, stats: { win: true } },
          ],
        },
      },
      {
        json: {
          participantIdentities: [
            { participantId: 2, player: { puuid: 'target-puuid' } },
            { participantId: 4, player: { puuid: 'someone-else' } },
          ],
          participants: [
            { participantId: 2, stats: { win: false } },
            { participantId: 4, stats: { win: true } },
          ],
        },
      },
      {
        json: {
          participantIdentities: [{ participantId: 5, player: { puuid: 'someone-else' } }],
          participants: [{ participantId: 5, stats: { win: true } }],
        },
      },
    ],
  },
};

const viaIdentity = recentFormFromMatchHistory(identityOnly, 'target-puuid');
ok(viaIdentity.games === 2, 'identity-mapped player counted in both games');
ok(viaIdentity.wins === 1, 'wins come from the linked participant, not another row');
ok(viaIdentity.wins !== 2, 'another participant win is not attributed to the player');

/** Older/other payloads may carry puuid directly on the participant. */
const directPuuid = {
  games: {
    games: [
      {
        json: {
          participants: [
            { participantId: 1, puuid: 'other', stats: { win: true } },
            { participantId: 9, puuid: 'direct-puuid', stats: { win: true } },
          ],
        },
      },
    ],
  },
};
const viaDirect = recentFormFromMatchHistory(directPuuid, 'direct-puuid');
ok(viaDirect.games === 1 && viaDirect.wins === 1, 'direct participant puuid fallback works');

/** Identity wins when both shapes are present. */
const bothShapes = {
  games: {
    games: [
      {
        json: {
          participantIdentities: [{ participantId: 7, player: { puuid: 'both-puuid' } }],
          participants: [
            { participantId: 7, puuid: 'wrong-direct', stats: { win: false } },
            { participantId: 8, puuid: 'both-puuid', stats: { win: true } },
          ],
        },
      },
    ],
  },
};
const viaBoth = recentFormFromMatchHistory(bothShapes, 'both-puuid');
ok(viaBoth.games === 1 && viaBoth.wins === 0, 'participantId identity takes precedence over a stray direct puuid');

ok(
  recentFormFromMatchHistory(null, 'target-puuid').games === 0,
  'missing history is an empty form'
);

console.log('verify:scouting-identity ok');
