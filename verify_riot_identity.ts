/**
 * Riot identity regression checks (Brief 3).
 *
 * Covers the pure identity mapping (platformId -> routing region, summoner
 * fields), the persisted puuid store (save/load via ONETRICK_USER_DATA,
 * rename keeps its record, account switch moves the active pointer without
 * losing the other record), and the display rules (formatRiotId fallback,
 * statusFor rename and login-screen empty payload).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Isolate the identity file before anything reads the user data dir.
const testDir = path.join(os.tmpdir(), `ot-riot-identity-${Date.now()}`);
process.env.ONETRICK_USER_DATA = testDir;

import {
    activeIdentity,
    formatRiotId,
    identityFromSummoner,
    loadIdentityStore,
    regionFromPlatformId,
    saveIdentityStore,
    statusFor,
    upsertIdentity,
    type RiotIdentity,
    type RiotIdentityStore,
} from './electron/riot-identity';
import { extractPlatformId } from './electron/lcu-connector';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function run(): void {
    console.log('--- verify:riot-identity: platformId -> region ---');
    ok(regionFromPlatformId('EUW1') === 'euw', 'EUW1 maps to euw');
    ok(regionFromPlatformId('na1') === 'na', 'na1 maps to na');
    ok(regionFromPlatformId('KR') === 'kr', 'KR maps to kr');
    ok(regionFromPlatformId('EUW') === 'euw', 'region-locale EUW maps to euw');
    ok(regionFromPlatformId('BR1') === 'br', 'BR1 maps to br');
    ok(regionFromPlatformId('EUN') === 'eun', 'region-locale EUN maps to eun');
    ok(regionFromPlatformId('XX9') === null, 'unknown platform id maps to null');
    ok(regionFromPlatformId(null) === null, 'missing platform id maps to null');

    console.log('--- verify:riot-identity: platformId payload shapes ---');
    ok(extractPlatformId('EUW1') === 'EUW1', 'bare string platformId is kept');
    ok(extractPlatformId({ platformId: 'KR' }) === 'KR', 'login-session platformId is read');
    ok(extractPlatformId({ region: 'NA' }) === 'NA', 'region-locale region is used as a fallback');
    ok(extractPlatformId({}) === null, 'empty payload has no platformId');
    ok(extractPlatformId(null) === null, 'null payload has no platformId');

    console.log('--- verify:riot-identity: summoner mapping ---');
    const faker = identityFromSummoner(
        { gameName: 'Faker', tagLine: 'KR1', puuid: 'puuid-faker' },
        'KR'
    );
    ok(faker?.puuid === 'puuid-faker', 'summoner maps puuid');
    ok(faker?.gameName === 'Faker' && faker?.tagLine === 'KR1', 'summoner maps gameName + tagLine');
    ok(faker?.platformId === 'KR' && faker?.region === 'kr', 'summoner record carries platformId + region');
    ok(identityFromSummoner({}, 'EUW1') === null, 'empty login payload is not an identity');
    ok(identityFromSummoner(null) === null, 'null payload is not an identity');
    ok(
        identityFromSummoner({ gameName: 'Faker', tagLine: 'KR1' }) === null,
        'names without puuid not identity'
    );
    ok(
        identityFromSummoner({ displayName: 'OldName', puuid: 'p-old' }, 'NA1')?.gameName === 'OldName',
        'legacy displayName is used when gameName is missing'
    );

    console.log('--- verify:riot-identity: save -> load roundtrip ---');
    const store: RiotIdentityStore = {
        activePuuid: faker!.puuid,
        recordsByPuuid: { [faker!.puuid]: faker! },
    };
    saveIdentityStore(store);
    ok(fs.existsSync(path.join(testDir, 'riot-identity.json')), 'identity file is written under ONETRICK_USER_DATA');
    const loaded = loadIdentityStore();
    ok(loaded.activePuuid === 'puuid-faker', 'load restores activePuuid');
    ok(
        loaded.recordsByPuuid['puuid-faker']?.gameName === 'Faker' &&
            loaded.recordsByPuuid['puuid-faker']?.tagLine === 'KR1',
        'load restores the Riot ID halves'
    );
    ok(
        loaded.recordsByPuuid['puuid-faker']?.platformId === 'KR' &&
            loaded.recordsByPuuid['puuid-faker']?.region === 'kr',
        'load restores platformId + region'
    );

    console.log('--- verify:riot-identity: upsert / rename / switch ---');
    const alt = identityFromSummoner(
        { gameName: 'AltAccount', tagLine: 'EUW', puuid: 'puuid-alt' },
        'EUW1'
    )!;
    let next = upsertIdentity(store, alt);
    ok(next.activePuuid === 'puuid-alt', 'a different puuid becomes the active account');
    ok(Object.keys(next.recordsByPuuid).length === 2, 'a switch keeps the previous record');
    ok(next.recordsByPuuid['puuid-faker']?.gameName === 'Faker', 'the inactive record is untouched');

    next = upsertIdentity(next, { ...faker!, gameName: 'Faker2' });
    ok(next.activePuuid === 'puuid-faker', 'switching back restores the original active puuid');
    ok(Object.keys(next.recordsByPuuid).length === 2, 'switching back does not duplicate records');
    ok(next.recordsByPuuid['puuid-faker']?.gameName === 'Faker2', 'rename rewrites the same puuid record');
    ok(next.recordsByPuuid['puuid-faker']?.region === 'kr', 'rename keeps the stored region');

    const partialRename: RiotIdentity = {
        puuid: 'puuid-faker',
        gameName: 'Faker3',
        tagLine: 'KR1',
        platformId: null,
        region: null,
        updatedAt: 1,
    };
    const renamed = upsertIdentity(next, partialRename);
    ok(renamed.recordsByPuuid['puuid-faker']?.platformId === 'KR', 'a partial rename keeps the stored platformId');
    ok(renamed.recordsByPuuid['puuid-faker']?.region === 'kr', 'a partial rename keeps the stored region');

    console.log('--- verify:riot-identity: format + statusFor ---');
    ok(formatRiotId({ gameName: 'Faker', tagLine: 'KR1' }, 'Fallback') === 'Faker#KR1', 'both halves format as name#tag');
    ok(formatRiotId({ gameName: 'Faker', tagLine: null }, 'Faker') === 'Faker', 'a missing tagLine falls back');
    ok(formatRiotId(null, 'Fallback') === 'Fallback', 'no identity falls back to the summoner name');
    ok(formatRiotId(undefined, null) === null, 'no identity and no fallback is null');

    const stored: RiotIdentity = {
        puuid: 'puuid-faker',
        gameName: 'Hide on bush',
        tagLine: 'KR1',
        platformId: 'KR',
        region: 'kr',
        updatedAt: 1,
    };

    const renamedStatus = statusFor(
        { summonerName: 'Hide on bush', gameName: 'Faker', tagLine: 'KR1', puuid: 'puuid-faker' },
        stored
    );
    ok(renamedStatus.source === 'live', 'live rename is reported as live');
    ok(renamedStatus.label === 'Faker#KR1', 'live rename shows the new Riot ID');
    ok(renamedStatus.puuid === 'puuid-faker', 'live rename keeps the puuid');
    ok(
        renamedStatus.platformId === 'KR' && renamedStatus.region === 'kr',
        'live rename inherits the stored region'
    );

    const loginStatus = statusFor({ summonerName: null }, stored);
    ok(loginStatus.source === 'stored', 'empty login payload falls back to the stored identity');
    ok(loginStatus.label === 'Hide on bush#KR1', 'empty login payload shows the last Riot ID');
    ok(loginStatus.region === 'kr', 'empty login payload keeps the region');

    const switchedStatus = statusFor(
        { gameName: 'AltAccount', tagLine: 'EUW', puuid: 'puuid-alt', platformId: 'EUW1' },
        stored
    );
    ok(switchedStatus.source === 'live', 'account switch is reported as live');
    ok(switchedStatus.label === 'AltAccount#EUW', 'account switch shows the new Riot ID');
    ok(switchedStatus.region === 'euw', 'account switch uses the new platformId region');

    const emptyStatus = statusFor({}, null);
    ok(emptyStatus.source === 'none', 'no live and no stored identity has no source');
    ok(emptyStatus.label === null && emptyStatus.puuid === null, 'no live and no stored identity is empty');
    ok(statusFor({ summonerName: 'LegacyName' }, null).label === 'LegacyName', 'legacy summonerName is the final fallback');

    const persisted = loadIdentityStore();
    ok(activeIdentity(persisted)?.puuid === 'puuid-faker', 'loadIdentityStore returns the saved active record');

    // A truncated / hand-edited file whose activePuuid has no record must
    // normalize to "no active identity" instead of a dangling pointer.
    const danglingPath = path.join(testDir, 'riot-identity-dangling.json');
    fs.writeFileSync(
        danglingPath,
        JSON.stringify({
            activePuuid: 'puuid-missing',
            recordsByPuuid: {
                'puuid-faker': { puuid: 'puuid-faker', gameName: 'Faker', tagLine: 'KR1' },
            },
        }),
        'utf8'
    );
    const dangling = loadIdentityStore(danglingPath);
    ok(dangling.activePuuid === null, 'an activePuuid with no record normalizes to null');
    ok(activeIdentity(dangling) === null, 'an activePuuid with no record has no active identity');
    ok(
        dangling.recordsByPuuid['puuid-faker']?.gameName === 'Faker',
        'other records survive the missing-active normalization'
    );

    if (!process.exitCode) console.log('verify:riot-identity ok');
}

try {
    run();
} finally {
    try {
        fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}
