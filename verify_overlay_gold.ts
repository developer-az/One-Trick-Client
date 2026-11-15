/**
 * I1b follow-up: unknown gold must reach the HUD as unknown (null), never as 0,
 * so the buy rail stays quiet instead of claiming "Need <full price>".
 */
import items from './website/public/api/v1/items.json';
import { buildOverlayPayload } from './electron/game-monitor';
import type { LiveClientAllGameData } from './electron/live-client';
import { trackBuildProgress } from './src/logic/buildProgress';
import { catalogPriceLookup } from './src/logic/purchasePlan';
import { buyRailLine, type OverlayState } from './src/overlay/overlayLogic';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

function board(gold: unknown): LiveClientAllGameData {
    return {
        activePlayer: {
            summonerName: 'TestPlayer',
            riotId: 'TestPlayer#NA1',
            level: 6,
            ...(gold === undefined ? {} : { currentGold: gold }),
            championStats: { currentHealth: 1000, maxHealth: 1000, resourceValue: 500, resourceMax: 500 },
        },
        allPlayers: [
            {
                championName: 'Pyke', summonerName: 'TestPlayer', riotId: 'TestPlayer#NA1', team: 'ORDER',
                position: 'UTILITY', level: 6, isDead: false, isBot: false, respawnTimer: 0,
                items: [], scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
                summonerSpells: {},
            },
        ],
        events: { Events: [] },
        gameData: { gameMode: 'CLASSIC', gameTime: 300, mapName: 'Map11', mapNumber: 11 },
    } as unknown as LiveClientAllGameData;
}

const prices = catalogPriceLookup(items as Array<{ id: string; name: string; gold: number; from: string[] }>);
const build = {
    core: [{ id: '3179', name: 'Umbral Glaive' }],
    boots: { id: '3158', name: 'Ionian Boots of Lucidity' },
    situational: [],
};
const rail = (payload: ReturnType<typeof buildOverlayPayload>) =>
    buyRailLine(payload as unknown as OverlayState, trackBuildProgress(payload.localPlayer?.items, build), prices);

const known = buildOverlayPayload(board(640), 'InProgress');
ok(known.localPlayer?.currentGold === 640, 'known gold passes through');
ok(rail(known) !== null, 'known gold: rail speaks');

const zero = buildOverlayPayload(board(0), 'InProgress');
ok(zero.localPlayer?.currentGold === 0, 'a real 0 stays 0');
ok(rail(zero)?.action === 'save', 'real 0 gold: rail still speaks');

for (const [label, value] of [['missing', undefined], ['NaN', Number.NaN], ['string', '640']] as const) {
    const p = buildOverlayPayload(board(value), 'InProgress');
    ok(!!p.localPlayer, `${label} gold: local player still present`);
    ok(p.localPlayer?.currentGold === null, `${label} gold: payload carries null, not 0`);
    ok(rail(p) === null, `${label} gold: buy rail stays quiet`);
}

// Real gold is fractional (seen in a recorded match: 566.546). The rail must not print decimals.
const fractional = buildOverlayPayload(board(566.546), 'InProgress');
const fracLine = rail(fractional);
ok(!!fracLine && !/\d\.\d/.test(fracLine.text) && !/\d\.\d/.test(fracLine.title), `fractional gold: no decimals on the rail (${fracLine?.text})`);
