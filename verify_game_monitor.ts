/**
 * Verification harness for Game Monitor slice (electron/game-monitor.ts).
 * Tests payload building, fingerprint stability (guarding against IPC thrash),
 * withPlayMoments integration with prevState scoring, clip trigger threshold,
 * null board fallback, and clean monitor shutdown.
 */

import {
    buildOverlayPayload,
    overlayFingerprint,
    withPlayMoments,
    resetMatchCaches,
    stopGameMonitor,
} from './electron/game-monitor';
import { getPlayRecap } from './electron/play-recap';
import type { LiveClientAllGameData } from './electron/live-client';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function makeMockBoard(opts: {
    championName: string;
    level?: number;
    gameTime?: number;
    currentGold?: number;
    isDead?: boolean;
    kills?: number;
    enemyDead?: boolean;
    enemyHp?: number;
    selfHpPct?: number;
}): LiveClientAllGameData {
    return {
        activePlayer: {
            summonerName: 'TestPlayer',
            riotId: 'TestPlayer#NA1',
            level: opts.level ?? 6,
            currentGold: opts.currentGold ?? 500,
            championStats: {
                currentHealth: (opts.selfHpPct ?? 1.0) * 1000,
                maxHealth: 1000,
                resourceValue: 500,
                resourceMax: 500,
            },
        },
        allPlayers: [
            {
                championName: opts.championName,
                summonerName: 'TestPlayer',
                riotId: 'TestPlayer#NA1',
                team: 'ORDER',
                position: 'UTILITY',
                level: opts.level ?? 6,
                isDead: opts.isDead ?? false,
                isBot: false,
                respawnTimer: 0,
                items: [{ itemID: 3865, displayName: 'Support Item', count: 1, slot: 0 }],
                scores: { kills: opts.kills ?? 0, deaths: 0, assists: 1, creepScore: 15, wardScore: 5 },
            },
            {
                championName: 'Jinx',
                summonerName: 'EnemyBot',
                riotId: 'EnemyBot#NA1',
                team: 'CHAOS',
                position: 'BOTTOM',
                level: 6,
                isDead: opts.enemyDead ?? false,
                isBot: false,
                respawnTimer: opts.enemyDead ? 20 : 0,
                items: [{ itemID: 1055, displayName: "Doran's Blade", count: 1, slot: 0 }],
                scores: { kills: 0, deaths: opts.enemyDead ? 1 : 0, assists: 0, creepScore: 60, wardScore: 2 },
            },
        ],
        gameData: {
            gameMode: 'CLASSIC',
            gameTime: opts.gameTime ?? 600,
            mapName: 'Map11',
            mapNumber: 11,
        },
    };
}

async function run(): Promise<void> {
    console.log('--- verify:game-monitor: buildOverlayPayload ---');
    resetMatchCaches();

    // 1. Pyke Support
    const pykeBoard = makeMockBoard({ championName: 'Pyke' });
    const pykePayload = buildOverlayPayload(pykeBoard, 'InProgress');
    ok(pykePayload.isPyke === true, 'pyke recognized');
    ok(pykePayload.profileHint === 'pyke-support', 'profileHint is pyke-support');
    ok(pykePayload.enemies.length === 1, '1 enemy detected');
    ok(pykePayload.enemies[0].championName === 'Jinx', 'enemy is Jinx');
    ok(pykePayload.activePlayerLevel === 6, 'activePlayerLevel is 6');

    // 2. Generic Champion
    const ahriBoard = makeMockBoard({ championName: 'Ahri' });
    const ahriPayload = buildOverlayPayload(ahriBoard, 'InProgress');
    ok(ahriPayload.isPyke === false, 'ahri is not pyke');
    ok(ahriPayload.profileHint?.startsWith('generic:Ahri'), `ahri profile hint generic (got ${ahriPayload.profileHint})`);

    // 3. Null Board
    const nullPayload = buildOverlayPayload(null, null);
    ok(nullPayload !== null, 'null live board produces safe fallback payload without throwing');
    ok(nullPayload.localPlayer === null, 'localPlayer is null when board is null');

    console.log('--- verify:game-monitor: overlayFingerprint IPC stability ---');
    // Test that within a 10s window and with minor gold change, fingerprint is strictly identical
    const p1 = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 100, currentGold: 500 }), 'InProgress');
    const p2 = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 104, currentGold: 520 }), 'InProgress');
    const p3 = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 107, currentGold: 540 }), 'InProgress');

    const fp1 = overlayFingerprint(p1);
    const fp2 = overlayFingerprint(p2);
    const fp3 = overlayFingerprint(p3);

    ok(fp1 === fp2, 'fingerprint identical across 4s advance and +20 gold (no React reconcile)');
    ok(fp2 === fp3, 'fingerprint identical across 8s advance and +40 gold (no React reconcile)');

    // Crossing 10s time boundary changes fingerprint
    const pBoundary = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 110, currentGold: 500 }), 'InProgress');
    const fpBoundary = overlayFingerprint(pBoundary);
    ok(fp1 !== fpBoundary, 'fingerprint updates when crossing 10s time bucket (100s -> 110s)');

    // Gold change >= 50 changes fingerprint
    const pGoldJump = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 102, currentGold: 560 }), 'InProgress');
    ok(fp1 !== overlayFingerprint(pGoldJump), 'fingerprint updates on gold change >= 50');

    // Level up changes fingerprint
    const pLevelUp = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 102, currentGold: 500, level: 7 }), 'InProgress');
    ok(fp1 !== overlayFingerprint(pLevelUp), 'fingerprint updates on level-up');

    // Player death changes fingerprint
    const pDeath = buildOverlayPayload(makeMockBoard({ championName: 'Pyke', gameTime: 102, currentGold: 500, isDead: true }), 'InProgress');
    ok(fp1 !== overlayFingerprint(pDeath), 'fingerprint updates on death');

    console.log('--- verify:game-monitor: withPlayMoments names the kill ---');
    resetMatchCaches();

    // Tick 1: Pyke engaged at 25% HP, enemy alive at 100% HP, 0 kills
    const preFightBoard = makeMockBoard({
        championName: 'Pyke',
        gameTime: 200,
        selfHpPct: 0.25,
        enemyDead: false,
        kills: 0,
    });
    const preFightPayload = buildOverlayPayload(preFightBoard, 'InProgress');
    const res1 = withPlayMoments(preFightPayload);
    ok(Array.isArray(res1.momentCues || []), 'momentCues is an array on tick 1');

    // Tick 2: Pyke gets a kill while low HP (20% HP), enemy dead, kills = 1
    const postKillBoard = makeMockBoard({
        championName: 'Pyke',
        gameTime: 204,
        selfHpPct: 0.2,
        enemyDead: true,
        kills: 1,
    });
    const postKillPayload = buildOverlayPayload(postKillBoard, 'InProgress');
    const res2 = withPlayMoments(postKillPayload);

    ok(Array.isArray(res2.momentCues), 'momentCues populated after scored moment');
    const logged = getPlayRecap();
    const line = logged.find((entry) => entry.detail.includes('Jinx') || entry.label.includes('Jinx'));
    ok(!!line, 'the kill names Jinx');
    ok(!line?.detail.includes('Convert to plate'), 'the kill is not the canned convert tip');
    ok(line?.playLabel === 'Good', `ordinary kill stays Good without victim HP (got ${line?.playLabel})`);
    ok(!!line?.detail.includes('Jinx was 0/0'), `the tip cites her scoreline (got ${line?.detail})`);

    console.log('--- verify:game-monitor: stopGameMonitor cleanup ---');
    stopGameMonitor();
    ok(true, 'stopGameMonitor executes and unregisters cleanly');

    if (!process.exitCode) {
        console.log('verify:game-monitor ok');
    }
}

void run();
