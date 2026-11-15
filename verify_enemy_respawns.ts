/**
 * Verification harness for enemy respawn countdowns.
 * Covers the pure overlay logic (selection, countdown math, ordering, cap),
 * the formatter, and the Game Monitor payload/fingerprint wiring.
 */
import {
    buildOverlayPayload,
    overlayFingerprint,
    resetMatchCaches,
    stopGameMonitor,
} from './electron/game-monitor';
import { enemyRespawns, formatRespawn, type OverlayEnemy } from './src/overlay/overlayLogic';
import type { LiveClientAllGameData } from './electron/live-client';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

const enemy = (over: Partial<OverlayEnemy> & { championName: string }): OverlayEnemy => ({ ...over });

// --- enemyRespawns: selection ----------------------------------------------
const mixed: OverlayEnemy[] = [
    enemy({ championName: 'Jinx', isDead: true, respawnTimer: 20, position: 'BOTTOM' }),
    enemy({ championName: 'Lux', isDead: false, respawnTimer: 12 }),
    enemy({ championName: 'Zed', isDead: true, respawnTimer: 0 }),
    enemy({ championName: 'Garen', isDead: true, respawnTimer: 30 }),
];

const now = 1_000_000;
const picked = enemyRespawns(mixed, now, now);
ok(picked.length === 2, `only dead enemies with a live timer (got ${picked.length})`);
ok(
    picked.every((r) => r.championName === 'Jinx' || r.championName === 'Garen'),
    'live enemies and zero-timer enemies are excluded'
);

// --- enemyRespawns: countdown math (payload 3000ms old) ---------------------
const aging = enemyRespawns(
    [enemy({ championName: 'Jinx', isDead: true, respawnTimer: 20 })],
    now - 3000,
    now
);
ok(aging.length === 1 && aging[0].remainingSec === 17, `3000ms-old payload counts down 20 -> 17 (got ${aging[0]?.remainingSec})`);

// Missing / non-finite payload timestamp means no elapsed time.
const noStamp = enemyRespawns(
    [enemy({ championName: 'Jinx', isDead: true, respawnTimer: 20 })],
    undefined,
    now
);
ok(noStamp[0]?.remainingSec === 20, 'missing timestamp treats elapsed as 0');
const nanStamp = enemyRespawns(
    [enemy({ championName: 'Jinx', isDead: true, respawnTimer: 20 })],
    Number.NaN,
    now
);
ok(nanStamp[0]?.remainingSec === 20, 'non-finite timestamp treats elapsed as 0');

// --- enemyRespawns: expired rows are dropped --------------------------------
const expired = enemyRespawns(
    [enemy({ championName: 'Jinx', isDead: true, respawnTimer: 3 })],
    now - 10_000,
    now
);
ok(expired.length === 0, 'expired respawns are dropped');

// --- enemyRespawns: sort + cap ----------------------------------------------
const sortable = enemyRespawns(
    [
        enemy({ championName: 'Zed', isDead: true, respawnTimer: 20 }),
        enemy({ championName: 'Ahri', isDead: true, respawnTimer: 20 }),
        enemy({ championName: 'Jinx', isDead: true, respawnTimer: 5 }),
    ],
    now,
    now
);
ok(
    sortable.map((r) => r.remainingSec).join(',') === '5,20,20',
    `sorted ascending by remaining (got ${sortable.map((r) => r.remainingSec).join(',')})`
);
ok(
    sortable[1].championName === 'Ahri' && sortable[2].championName === 'Zed',
    'ties break by championName'
);

const many: OverlayEnemy[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) =>
    enemy({ championName: name, isDead: true, respawnTimer: 30 + i })
);
const capped = enemyRespawns(many, now, now);
ok(capped.length === 5, `caps at 5 rows (got ${capped.length})`);

// --- enemyRespawns: malformed input never throws ----------------------------
let threw = false;
try {
    ok(enemyRespawns(undefined, undefined, now).length === 0, 'undefined enemies yields []');
    ok(enemyRespawns([], now, now).length === 0, 'empty enemies yields []');
    const junk = enemyRespawns(
        [{ isDead: true, respawnTimer: 10 } as OverlayEnemy],
        undefined,
        now
    );
    ok(junk.length === 1, 'missing championName still yields a row');
} catch {
    threw = true;
}
ok(!threw, 'malformed fields never throw');

// --- formatRespawn ----------------------------------------------------------
ok(formatRespawn(7) === '0:07', `formatRespawn 7 -> 0:07 (got ${formatRespawn(7)})`);
ok(formatRespawn(42) === '0:42', `formatRespawn 42 -> 0:42 (got ${formatRespawn(42)})`);
ok(formatRespawn(65) === '1:05', `formatRespawn 65 -> 1:05 (got ${formatRespawn(65)})`);
ok(formatRespawn(0) === '0:00', `formatRespawn 0 -> 0:00 (got ${formatRespawn(0)})`);
ok(formatRespawn(-4) === '0:00', `formatRespawn negative -> 0:00 (got ${formatRespawn(-4)})`);

// --- Game Monitor payload ---------------------------------------------------
function makeBoard(opts: {
    respawnTimer?: number;
    enemyDead?: boolean;
} = {}): LiveClientAllGameData {
    return {
        activePlayer: {
            summonerName: 'TestPlayer',
            riotId: 'TestPlayer#NA1',
            level: 6,
            currentGold: 500,
            championStats: {
                currentHealth: 1000,
                maxHealth: 1000,
                resourceValue: 500,
                resourceMax: 500,
            },
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
                isDead: opts.enemyDead ?? false,
                isBot: false,
                respawnTimer: opts.respawnTimer ?? 0,
                items: [{ itemID: 1055, displayName: "Doran's Blade", count: 1, slot: 0 }],
                scores: { kills: 0, deaths: 1, assists: 0, creepScore: 60, wardScore: 2 },
            },
        ],
        gameData: { gameMode: 'CLASSIC', gameTime: 600, mapName: 'Map11', mapNumber: 11 },
    };
}

console.log('--- verify:enemy-respawns: payload ---');
resetMatchCaches();
const deadPayload = buildOverlayPayload(
    makeBoard({ respawnTimer: 25.2, enemyDead: true }),
    'InProgress'
);
const deadEnemy = deadPayload.enemies.find((e) => e.championName === 'Jinx');
ok(deadEnemy?.respawnTimer === 26, `respawnTimer rounds up 25.2 -> 26 (got ${deadEnemy?.respawnTimer})`);

const livePayload = buildOverlayPayload(makeBoard({ enemyDead: false }), 'InProgress');
const liveEnemy = livePayload.enemies.find((e) => e.championName === 'Jinx');
ok(liveEnemy?.respawnTimer === 0, `live enemy respawnTimer 0 (got ${liveEnemy?.respawnTimer})`);

const fp25 = overlayFingerprint(
    buildOverlayPayload(makeBoard({ respawnTimer: 25, enemyDead: true }), 'InProgress')
);
const fp5 = overlayFingerprint(
    buildOverlayPayload(makeBoard({ respawnTimer: 5, enemyDead: true }), 'InProgress')
);
ok(fp25 !== fp5, 'fingerprint differs across respawn buckets (25 vs 5)');

stopGameMonitor();

if (!process.exitCode) {
    console.log('verify:enemy-respawns ok');
}
