// Riot API (Phase 3): routing, key format, rate limits, no-key fallback; with
// --live, checks the personal key against Riot without any account data.
// The key is never printed.
import fs from 'fs';
import path from 'path';
import { RateLimiter, getRiotStatus, isRiotKey, matchSummaryFor, routeForRegion } from './electron/riot-api';

let failed = 0;
const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'ok' : 'FAIL'} ${name}`);
    if (!ok) failed++;
};

check('NA routes to na1 + americas', routeForRegion('NA')?.platform === 'na1' && routeForRegion('na')?.regional === 'americas');
check('EUW / KR / OCE routes', routeForRegion('EUW')?.regional === 'europe' && routeForRegion('KR')?.platform === 'kr' && routeForRegion('OCE')?.regional === 'sea');
check('unknown region -> null', routeForRegion('XX') === null && routeForRegion(null) === null);
// Built from parts so source scanners never see a key-shaped literal.
const shapeValidKey = ['RGAPI', '0123abcd', '0123', '4567', '89ab', '0123456789ab'].join('-');
check('key format', isRiotKey(shapeValidKey) && !isRiotKey('RGAPI-short') && !isRiotKey(''));

const rl = new RateLimiter([[20, 1_000], [100, 120_000]]);
for (let i = 0; i < 20; i++) rl.take(1000 + i);
check('21st call in a second waits', rl.waitMs(1020) > 0 && rl.waitMs(2001) === 0);
const rl2 = new RateLimiter([[20, 1_000], [100, 120_000]]);
for (let i = 0; i < 100; i++) rl2.take(i * 1_100);
check('101st call in two minutes waits for the window', rl2.waitMs(110_100) > 0 && rl2.waitMs(240_000) === 0);

const MATCH = {
    metadata: { matchId: 'NA1_1' },
    info: {
        queueId: 2400,
        gameDuration: 1260,
        gameEndTimestamp: 1_700_000_000_000,
        participants: [
            { puuid: 'other', championName: 'Ornn', kills: 0, deaths: 9, assists: 1, win: false },
            { puuid: 'me', championName: 'Pyke', kills: 12, deaths: 3, assists: 20, win: true, totalMinionsKilled: 40, neutralMinionsKilled: 2 },
        ],
    },
};
const mine = matchSummaryFor(MATCH, 'me');
check('match summary picks my line', mine?.champion === 'Pyke' && mine.kills === 12 && mine.win && mine.cs === 42);
check('match summary: queue label and minutes', mine?.queue === 'ARAM Mayhem' && mine.durationMin === 21);
check('match summary: not in the match -> null', matchSummaryFor(MATCH, 'nobody') === null && matchSummaryFor({}, 'me') === null);
check('summary keeps no other players', !JSON.stringify(mine).includes('Ornn'));

async function main(): Promise<void> {
    // Outside Electron there is no safeStorage, so no stored key can load: the no-key fallback.
    const s = await getRiotStatus({ puuid: null, gameName: null, tagLine: null, region: 'NA' });
    check('no key -> says it uses the League client', s.state === 'no-key' && /League client/.test(s.message));

    if (!process.argv.includes('--live')) return;
    const file = path.join(process.env.APPDATA || '', 'One Trick', 'riot-api-key.txt');
    const key = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (!isRiotKey(key)) {
        console.log('live: no key in riot-api-key.txt (already imported by the app?) - skipped');
        return;
    }
    const get = (url: string): Promise<number> =>
        fetch(url, { headers: { 'X-Riot-Token': key }, signal: AbortSignal.timeout(10_000) }).then((r) => r.status);
    const rotation = await get('https://na1.api.riotgames.com/lol/platform/v3/champion-rotations');
    check(`live: key accepted on na1 (HTTP ${rotation})`, rotation === 200);
    const account = await get('https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/OneTrickNoSuchUser/zzzzz');
    check(`live: account-v1 reachable, unknown ID is 404 not 401/403 (HTTP ${account})`, account === 404);
}

main().then(() => {
    if (failed) {
        console.log(`${failed} failed`);
        process.exit(1);
    }
    console.log('verify_riot_api: all ok');
});
