/**
 * Verification harness for Riot ID identity (gameName#tagLine + puuid).
 *
 * Covers the formatter used by the dashboard status line, the null-safe
 * /current-summoner mapping (including the empty-object login payload), and the
 * LCU socket's last-known identity: a login screen keeps the previous account,
 * while a different puuid replaces it.
 */

import { mapCurrentSummoner } from './electron/lcu-connector';
import { LcuSocket } from './electron/lcu-socket';
import { formatRiotId } from './src/app/status';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

console.log('--- verify:riot-identity: formatter ---');
ok(formatRiotId('Ice', 'NA1') === 'Ice#NA1', 'tag present renders gameName#tagLine');
ok(formatRiotId('Ice', null) === 'Ice', 'tag absent renders the plain name');
ok(formatRiotId('Ice', '') === 'Ice', 'empty tag is treated as absent');
ok(formatRiotId(null, null, 'OldName') === 'OldName', 'no Riot ID falls back to summonerName');
ok(formatRiotId('', '', null) === null, 'empty identity renders nothing');
ok(formatRiotId('  Ice ', ' NA1 ') === 'Ice#NA1', 'formatter trims both halves');

console.log('--- verify:riot-identity: summoner mapping ---');
ok(mapCurrentSummoner(null) === null, '404 (null) maps to null');
ok(mapCurrentSummoner({}) === null, 'empty-object login payload maps to null');
ok(mapCurrentSummoner(undefined) === null, 'undefined payload maps to null');

const full = mapCurrentSummoner({
    summonerId: 42,
    accountId: 7,
    displayName: 'OldName',
    gameName: 'Ice',
    tagLine: 'NA1',
    puuid: 'puuid-a',
    summonerLevel: 30,
});
ok(full?.summonerId === 42, 'summonerId survives the mapping');
ok(full?.accountId === 7, 'accountId survives the mapping');
ok(full?.displayName === 'OldName', 'displayName stays as the legacy fallback');
ok(full?.gameName === 'Ice', 'gameName read from the summoner payload');
ok(full?.tagLine === 'NA1', 'tagLine read from the summoner payload');
ok(full?.puuid === 'puuid-a', 'puuid read from the summoner payload');
ok(full?.summonerLevel === 30, 'summonerLevel survives the mapping');

const partial = mapCurrentSummoner({ gameName: 'Ice', tagLine: 'NA1' });
ok(partial?.gameName === 'Ice' && partial?.puuid === undefined, 'partial payload stays null-safe (no throw, no invented puuid)');
const junk = mapCurrentSummoner({ summonerId: 'nope', gameName: '   ', tagLine: 42, puuid: null });
ok(junk === null, 'junk-only payload maps to null instead of throwing');

console.log('--- verify:riot-identity: lcu summary ---');
const socket = new LcuSocket();
ok(socket.summary().gameName === null, 'a fresh socket has no Riot ID');

socket.applySummoner({ summonerId: 1, displayName: 'OldName' });
ok(socket.summary().summonerName === 'OldName', 'legacy displayName still fills summonerName');

socket.applySummoner({ summonerId: 1, displayName: 'OldName', gameName: 'Ice', tagLine: 'NA1', puuid: 'puuid-a' });
let summary = socket.summary();
ok(summary.gameName === 'Ice', 'summary carries gameName');
ok(summary.tagLine === 'NA1', 'summary carries tagLine');
ok(summary.puuid === 'puuid-a', 'summary carries puuid');
ok(summary.summonerName === 'Ice', 'summonerName prefers gameName');

socket.applySummoner(null);
summary = socket.summary();
ok(summary.gameName === 'Ice' && summary.tagLine === 'NA1' && summary.puuid === 'puuid-a', 'a null summoner (login) keeps the last-known Riot ID');
ok(summary.summonerName === 'Ice', 'login keeps the last-known summonerName');

socket.applySummoner({});
summary = socket.summary();
ok(summary.puuid === 'puuid-a', 'the empty login object does not blank the identity');

socket.applySummoner({ gameName: 'Smurf', tagLine: 'EUW', puuid: 'puuid-b' });
summary = socket.summary();
ok(summary.gameName === 'Smurf', 'an account switch replaces gameName');
ok(summary.tagLine === 'EUW', 'an account switch replaces tagLine');
ok(summary.puuid === 'puuid-b', 'an account switch replaces puuid');
ok(summary.summonerName === 'Smurf', 'an account switch replaces summonerName');

socket.applySummoner({ gameName: 'Smurf', tagLine: 'EUW2', puuid: 'puuid-b' });
ok(socket.summary().tagLine === 'EUW2', 'same puuid updates the Riot ID in place');

if (process.exitCode) {
    console.error('verify:riot-identity FAILED');
} else {
    console.log('verify:riot-identity ok');
}
