/**
 * Gating regression checks for the Mayhem overlay path (Brief 2a).
 *
 * 1. The overlay fingerprint must see the map — a board that only changes
 *    mapName (Map11 -> Map12) is a different game and must re-render.
 * 2. A KIWI / Map12 Live Client board must come through as Mayhem with the
 *    map name intact (ARAM on Howling Abyss is not Mayhem).
 * 3. Live poll cadence matrix (in-game / late game / hidden / search / boot).
 * 4. Offer retention hysteresis: one empty OCR frame keeps the roll, a second
 *    consecutive one clears it, and closing the pick window clears it.
 * 5. The persisted roll is written through, so a cleared OCR result cannot be
 *    resurrected by the previously stored ids.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Isolate mayhem-state writes before the first user-data read. The imports below
// are hoisted, so this assignment runs after their module bodies load; those
// bodies must not touch the user data dir (mayhem-state reads it per call), and
// the write-through check below asserts the file really lands in testDir.
const testDir = path.join(os.tmpdir(), `ot-mayhem-gating-${Date.now()}`);
process.env.ONETRICK_USER_DATA = testDir;

import {
    buildOverlayPayload,
    commitMayhemOffers,
    nextLiveCadence,
    overlayFingerprint,
    resetMatchCaches,
} from './electron/game-monitor';
import {
    getMayhemRollIds,
    mergedMayhemOfferIds,
    setMayhemRollIds,
} from './electron/mayhem-state';
import type { LiveClientAllGameData } from './electron/live-client';
import { isMayhemGame } from './src/logic/mayhem/mode';
import {
    MAYHEM_OFFER_MISS_LIMIT,
    stabilizeMayhemOffers,
    type MayhemOfferStabilityState,
} from './src/logic/mayhem/offerStability';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function makeBoard(opts: {
    gameMode?: string;
    mapName?: string;
    gameTime?: number;
}): LiveClientAllGameData {
    return {
        activePlayer: {
            summonerName: 'TestPlayer',
            riotId: 'TestPlayer#NA1',
            level: 6,
            currentGold: 500,
            championStats: { currentHealth: 1000, maxHealth: 1000 },
        },
        allPlayers: [
            {
                championName: 'Pyke',
                summonerName: 'TestPlayer',
                riotId: 'TestPlayer#NA1',
                team: 'ORDER',
                position: 'UTILITY',
                level: 6,
                isDead: false,
                isBot: false,
                respawnTimer: 0,
                items: [{ itemID: 3865, displayName: 'Support Item', count: 1, slot: 0 }],
                scores: { kills: 0, deaths: 0, assists: 1, creepScore: 15, wardScore: 5 },
            },
            {
                championName: 'Jinx',
                summonerName: 'EnemyBot',
                riotId: 'EnemyBot#NA1',
                team: 'CHAOS',
                position: 'BOTTOM',
                level: 6,
                isDead: false,
                isBot: false,
                respawnTimer: 0,
                items: [{ itemID: 1055, displayName: "Doran's Blade", count: 1, slot: 0 }],
                scores: { kills: 0, deaths: 0, assists: 0, creepScore: 60, wardScore: 2 },
            },
        ],
        gameData: {
            gameMode: opts.gameMode ?? 'CLASSIC',
            gameTime: opts.gameTime ?? 600,
            mapName: opts.mapName ?? 'Map11',
            mapNumber: 11,
        },
    };
}

function sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

function run(): void {
    console.log('--- verify:mayhem-gating: fingerprint sees the map ---');
    resetMatchCaches();
    const rift = buildOverlayPayload(makeBoard({ gameMode: 'CLASSIC', mapName: 'Map11' }), 'InProgress');
    const kiwi = buildOverlayPayload(makeBoard({ gameMode: 'KIWI', mapName: 'Map12' }), 'InProgress');
    const fpRift = overlayFingerprint(rift);
    // Same payload, only the map differs: the HUD must re-render on a map swap.
    const fpOnlyMap12 = overlayFingerprint({ ...rift, mapName: 'Map12' });
    const fpOnlyMode = overlayFingerprint({ ...rift, gameMode: 'KIWI' });
    ok(fpRift !== fpOnlyMap12, 'fingerprint differs when only mapName changes (Map11 -> Map12)');
    ok(fpRift !== fpOnlyMode, 'fingerprint differs when only the mayhem mode flag changes');
    ok(fpRift === overlayFingerprint({ ...rift }), 'fingerprint stable for an identical payload');
    ok(fpRift.includes('Map11'), 'fingerprint carries the map name (Map11)');
    ok(fpOnlyMap12.includes('Map12'), 'fingerprint carries the map name (Map12)');

    console.log('--- verify:mayhem-gating: KIWI / Map12 payload ---');
    ok(kiwi.mapName === 'Map12', `payload keeps mapName Map12 (got ${String(kiwi.mapName)})`);
    ok(kiwi.gameMode === 'KIWI', `payload keeps gameMode KIWI (got ${String(kiwi.gameMode)})`);
    ok(isMayhemGame(kiwi.gameMode, kiwi.mapName) === true, 'payload KIWI/Map12 is Mayhem');
    ok(isMayhemGame(rift.gameMode, rift.mapName) === false, 'CLASSIC/Map11 is not Mayhem');
    ok(
        isMayhemGame('ARAM', 'Map12') === false,
        'classic ARAM on Map12 is not Mayhem (mode decides)'
    );

    console.log('--- verify:mayhem-gating: offer retention hysteresis ---');
    ok(MAYHEM_OFFER_MISS_LIMIT === 2, 'retention gives up after 2 consecutive misses');
    const state: MayhemOfferStabilityState = { rerollPending: false };
    const roll = ['a', 'b', 'c'];
    // mayhem-ocr hands the previous roll straight back on an empty OCR frame.
    const retained = stabilizeMayhemOffers(roll, roll, 'no cards on screen', true, state);
    ok(sameIds(retained, roll), 'first empty frame retains the roll');
    ok((state.missCount ?? 0) === 1, 'first empty frame counts one miss');
    const cleared = stabilizeMayhemOffers(retained, retained, 'no cards on screen', true, state);
    ok(cleared.length === 0, 'second consecutive empty frame clears the roll');
    const closed = stabilizeMayhemOffers(roll, [], 'window closed', false, state);
    ok(closed.length === 0, 'picking window close clears the roll');
    ok((state.missCount ?? 0) === 0, 'window close resets the miss counter');
    const fresh = stabilizeMayhemOffers([], ['n1', 'n2', 'n3'], 'Choose an augment', true, state);
    ok(sameIds(fresh, ['n1', 'n2', 'n3']), 'a fresh triple is accepted after a clear');
    ok((state.missCount ?? 0) === 0, 'a fresh triple clears the miss counter');

    console.log('--- verify:mayhem-gating: roll write-through ---');
    const rollFile = path.join(testDir, 'mayhem-owned.json');
    setMayhemRollIds(['a', 'b', 'c']);
    ok(fs.existsSync(rollFile), `persisted roll is written under ONETRICK_USER_DATA (${rollFile})`);
    ok(sameIds(mergedMayhemOfferIds([]), ['a', 'b', 'c']), 'persisted roll survives a cached empty OCR read');
    // Both the auto tick and the PageDown scan go through commitMayhemOffers;
    // an `if (ids.length)` guard there would leave the stored roll behind and
    // make this line fail.
    commitMayhemOffers([]);
    ok(getMayhemRollIds().length === 0, 'an empty OCR commit persists an empty roll');
    ok(mergedMayhemOfferIds([]).length === 0, 'cleared offers write through and cannot be resurrected');
    commitMayhemOffers(['n1', 'n2']);
    ok(sameIds(getMayhemRollIds(), ['n1', 'n2']), 'a non-empty OCR commit persists the new roll');

    console.log('--- verify:mayhem-gating: live cadence matrix ---');
    const base = {
        state: 'connected' as const,
        phase: 'InProgress' as string | null,
        inGame: true,
        lateGame: false,
        hudHidden: false,
        hasLockfile: true,
    };
    ok(nextLiveCadence(base) === 2500, 'in-game polls every 2500ms');
    ok(nextLiveCadence({ ...base, lateGame: true }) === 4200, 'late game polls every 4200ms');
    ok(
        nextLiveCadence({ ...base, lateGame: true, hudHidden: true }) === 8000,
        'hidden overlay polls every 8000ms (wins over late game)'
    );
    ok(
        nextLiveCadence({ ...base, inGame: false }) === 2500,
        'InProgress phase alone keeps the in-game cadence'
    );
    ok(
        nextLiveCadence({ ...base, inGame: false, phase: null, state: 'searching' }) === 5000,
        'searching client probes every 5000ms'
    );
    ok(
        nextLiveCadence({
            ...base,
            inGame: false,
            phase: null,
            state: 'connecting',
            hasLockfile: true,
        }) === 5000,
        'client booting with a lockfile probes every 5000ms'
    );
    ok(
        nextLiveCadence({
            ...base,
            inGame: false,
            phase: null,
            state: 'connecting',
            hasLockfile: false,
        }) === null,
        'client booting without a lockfile parks the sampler'
    );
    ok(
        nextLiveCadence({ ...base, inGame: false, phase: null, state: 'connected' }) === null,
        'connected client idles on phase events (parks the sampler)'
    );

    if (!process.exitCode) console.log('verify:mayhem-gating ok');
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
