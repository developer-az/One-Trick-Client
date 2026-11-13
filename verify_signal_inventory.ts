/**
 * Signal inventory — every Live Client field the app reads is either carried
 * into GameState or explicitly ignored.
 *
 * Fixture: test-fixtures/live-client/mock-board-900s.json (synthetic mock until
 * the recorded-match fixture replaces it).
 *
 * Run: npm run verify:signal-inventory
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    buildGameState,
    diffNewEvents,
    type GameState,
} from './src/logic/gameState';
import { mergeLiveBoard } from './src/logic/stateEngine';

const failures = new Set<string>();

const ok = (cond: boolean, msg: string, row?: string): void => {
    if (!cond) {
        if (row) failures.add(row);
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
};

type Row = { field: string; use?: string; ignored?: string };

const INVENTORY: Row[] = [
    // activePlayer — every leaf under the object fetched by the app.
    { field: 'activePlayer.riotId', ignored: 'identity only; used for self matching, not a GameState value' },
    { field: 'activePlayer.summonerName', ignored: 'identity only; PlayerSnapshot stores riotId' },
    { field: 'activePlayer.level', use: 'self.level' },
    { field: 'activePlayer.currentGold', use: 'self.currentGold' },
    { field: 'activePlayer.championStats.currentHealth', use: 'self.stats.currentHealth' },
    { field: 'activePlayer.championStats.maxHealth', use: 'self.stats.maxHealth' },
    { field: 'activePlayer.championStats.resourceValue', ignored: 'folded into derived self.manaPct; T2 stats has no raw mana field' },
    { field: 'activePlayer.championStats.resourceMax', ignored: 'folded into derived self.manaPct; T2 stats has no raw mana field' },
    { field: 'activePlayer.championStats.resourceType', ignored: 'resource kind is not surfaced downstream' },
    { field: 'activePlayer.championStats.armor', use: 'self.stats.armor' },
    { field: 'activePlayer.championStats.magicResist', use: 'self.stats.magicResist' },
    { field: 'activePlayer.championStats.attackDamage', use: 'self.stats.attackDamage' },
    { field: 'activePlayer.championStats.abilityPower', use: 'self.stats.abilityPower' },
    { field: 'activePlayer.championStats.moveSpeed', use: 'self.stats.moveSpeed' },
    { field: 'activePlayer.championStats.critChance', use: 'self.stats.critChance' },
    { field: 'activePlayer.championStats.attackSpeed', use: 'self.stats.attackSpeed' },
    { field: 'activePlayer.abilities.Passive.abilityLevel', ignored: 'passive rank is not a Q/W/E/R skill point' },
    { field: 'activePlayer.abilities.Passive.displayName', ignored: 'cosmetic label only' },
    { field: 'activePlayer.abilities.Passive.id', ignored: 'cosmetic identifier only' },
    { field: 'activePlayer.abilities.Passive.rawDescription', ignored: 'raw tooltip text, not carried' },
    { field: 'activePlayer.abilities.Q.abilityLevel', use: 'self.abilityRanks.Q' },
    { field: 'activePlayer.abilities.Q.displayName', ignored: 'cosmetic label only' },
    { field: 'activePlayer.abilities.Q.id', ignored: 'cosmetic identifier only' },
    { field: 'activePlayer.abilities.Q.rawDescription', ignored: 'raw tooltip text, not carried' },
    { field: 'activePlayer.abilities.W.abilityLevel', use: 'self.abilityRanks.W' },
    { field: 'activePlayer.abilities.W.displayName', ignored: 'cosmetic label only' },
    { field: 'activePlayer.abilities.W.id', ignored: 'cosmetic identifier only' },
    { field: 'activePlayer.abilities.W.rawDescription', ignored: 'raw tooltip text, not carried' },
    { field: 'activePlayer.abilities.E.abilityLevel', use: 'self.abilityRanks.E' },
    { field: 'activePlayer.abilities.E.displayName', ignored: 'cosmetic label only' },
    { field: 'activePlayer.abilities.E.id', ignored: 'cosmetic identifier only' },
    { field: 'activePlayer.abilities.E.rawDescription', ignored: 'raw tooltip text, not carried' },
    { field: 'activePlayer.abilities.R.abilityLevel', use: 'self.abilityRanks.R' },
    { field: 'activePlayer.abilities.R.displayName', ignored: 'cosmetic label only' },
    { field: 'activePlayer.abilities.R.id', ignored: 'cosmetic identifier only' },
    { field: 'activePlayer.abilities.R.rawDescription', ignored: 'raw tooltip text, not carried' },
    { field: 'activePlayer.fullRunes.generalRunes[].displayName', ignored: 'cosmetic rune label only' },
    { field: 'activePlayer.fullRunes.generalRunes[].id', ignored: 'cosmetic rune id only' },
    { field: 'activePlayer.fullRunes.keystone.displayName', ignored: 'self runes are not carried; allPlayers[].runes supplies PlayerSnapshot.keystone' },
    { field: 'activePlayer.fullRunes.keystone.id', ignored: 'cosmetic rune id only' },
    { field: 'activePlayer.fullRunes.mainRunes.displayName', ignored: 'cosmetic rune label only' },
    { field: 'activePlayer.fullRunes.mainRunes.id', ignored: 'cosmetic rune id only' },
    { field: 'activePlayer.fullRunes.subRunes.displayName', ignored: 'cosmetic rune label only' },
    { field: 'activePlayer.fullRunes.subRunes.id', ignored: 'cosmetic rune id only' },
    { field: 'activePlayer.fullRunes.statRunes[].id', ignored: 'cosmetic stat-rune id only' },

    // allPlayers[] — identity, position, combat/score state, items, spells, runes.
    { field: 'allPlayers[].riotId', use: 'players[].riotId' },
    { field: 'allPlayers[].rawChampionName', ignored: 'raw asset name, cosmetic only' },
    { field: 'allPlayers[].championName', use: 'players[].champion' },
    { field: 'allPlayers[].team', use: 'players[].team' },
    { field: 'allPlayers[].position', use: 'players[].position' },
    { field: 'allPlayers[].level', use: 'players[].level' },
    { field: 'allPlayers[].isDead', use: 'players[].isDead' },
    { field: 'allPlayers[].respawnTimer', use: 'players[].respawnTimer' },
    { field: 'allPlayers[].isBot', use: 'players[].isBot' },
    { field: 'allPlayers[].summonerName', ignored: 'identity fallback only; PlayerSnapshot stores riotId' },
    { field: 'allPlayers[].items[].itemID', use: 'players[].items[]' },
    { field: 'allPlayers[].items[].displayName', ignored: 'cosmetic label only' },
    { field: 'allPlayers[].items[].count', use: 'players[].itemSlots[].count' },
    { field: 'allPlayers[].items[].slot', use: 'players[].itemSlots[].slot' },
    { field: 'allPlayers[].items[].price', use: 'players[].itemSlots[].price' },
    { field: 'allPlayers[].items[].canUse', ignored: 'interaction flag, not carried' },
    { field: 'allPlayers[].items[].consumable', ignored: 'consumable flag, not carried' },
    { field: 'allPlayers[].items[].rawDisplayName', ignored: 'raw asset name, cosmetic only' },
    { field: 'allPlayers[].scores.kills', use: 'players[].kills' },
    { field: 'allPlayers[].scores.deaths', use: 'players[].deaths' },
    { field: 'allPlayers[].scores.assists', use: 'players[].assists' },
    { field: 'allPlayers[].scores.creepScore', use: 'players[].cs' },
    { field: 'allPlayers[].scores.wardScore', use: 'players[].wardScore' },
    { field: 'allPlayers[].summonerSpells.summonerSpellOne.displayName', use: 'players[].summonerSpells[0]' },
    { field: 'allPlayers[].summonerSpells.summonerSpellOne.rawDisplayName', ignored: 'raw asset name, cosmetic only' },
    { field: 'allPlayers[].summonerSpells.summonerSpellOne.id', ignored: 'cosmetic identifier only' },
    { field: 'allPlayers[].summonerSpells.summonerSpellTwo.displayName', use: 'players[].summonerSpells[1]' },
    { field: 'allPlayers[].summonerSpells.summonerSpellTwo.rawDisplayName', ignored: 'raw asset name, cosmetic only' },
    { field: 'allPlayers[].summonerSpells.summonerSpellTwo.id', ignored: 'cosmetic identifier only' },
    { field: 'allPlayers[].runes.keystone.displayName', use: 'players[].keystone' },
    { field: 'allPlayers[].runes.keystone.id', ignored: 'cosmetic rune id only' },
    { field: 'allPlayers[].runes.mainRunes.displayName', ignored: 'cosmetic rune label only' },
    { field: 'allPlayers[].runes.mainRunes.id', ignored: 'cosmetic rune id only' },
    { field: 'allPlayers[].runes.subRunes.displayName', ignored: 'cosmetic rune label only' },
    { field: 'allPlayers[].runes.subRunes.id', ignored: 'cosmetic rune id only' },

    // gameData / events — the clock, match identity and normalised event rows.
    { field: 'gameData.gameMode', use: 'mode.gameMode' },
    { field: 'gameData.gameTime', use: 'gameTime' },
    { field: 'gameData.mapName', use: 'mode.mapName' },
    { field: 'gameData.mapNumber', use: 'mode.mapNumber' },
    { field: 'gameData.mapTerrain', ignored: 'map skin/terrain, cosmetic only' },
    { field: 'events[].EventID', use: 'events[].id' },
    { field: 'events[].EventName', use: 'events[].name' },
    { field: 'events[].EventTime', use: 'events[].gameTime' },
];

const fixturePath = path.join('test-fixtures', 'live-client', 'mock-board-900s.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    source: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Live Client JSON
    allgamedata: any;
    abilities: Record<string, { abilityLevel?: number }>;
};
const boardData = fixture.allgamedata;

function leaves(value: unknown, prefix: string): string[] {
    if (Array.isArray(value)) {
        if (!value.length) return [prefix];
        return leaves(value[0], `${prefix}[]`);
    }
    if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
            leaves(child, prefix ? `${prefix}.${key}` : key)
        );
    }
    return [prefix];
}

const firstPlayer = boardData.allPlayers[0];
const coveragePaths = [
    ...leaves(boardData.activePlayer, 'activePlayer'),
    ...leaves(
        {
            items: firstPlayer.items,
            scores: firstPlayer.scores,
            summonerSpells: firstPlayer.summonerSpells,
            runes: firstPlayer.runes,
        },
        'allPlayers[]'
    ),
    ...leaves(boardData.gameData, 'gameData'),
    ...leaves(boardData.events.Events[0], 'events[]'),
];

const inventoryFields = new Set(INVENTORY.map((row) => row.field));
const unaccounted = [...new Set(coveragePaths)].filter((field) => !inventoryFields.has(field));
ok(
    unaccounted.length === 0,
    unaccounted.length
        ? `coverage: unaccounted fixture paths: ${unaccounted.join(', ')}`
        : `coverage: all ${new Set(coveragePaths).size} fixture leaf paths are in INVENTORY`
);

const board = mergeLiveBoard({
    events: boardData.events,
    activePlayer: boardData.activePlayer,
    players: boardData.allPlayers,
    gameData: boardData.gameData,
    abilities: fixture.abilities,
});
ok(!!board, 'mergeLiveBoard builds a board from the fixture');

function collect(value: unknown, segments: string[]): unknown[] {
    if (!segments.length) return [value];
    const [head, ...rest] = segments;
    const match = head.match(/^(.*)\[(\d*)\]$/);
    if (match) {
        const key = match[1];
        const container = key ? (value as Record<string, unknown> | undefined)?.[key] : value;
        if (!Array.isArray(container)) return [];
        if (match[2] === '') return container.flatMap((entry) => collect(entry, rest));
        return collect(container[Number(match[2])], rest);
    }
    return collect((value as Record<string, unknown> | undefined)?.[head], rest);
}

const valuesAt = (root: unknown, dotPath: string): unknown[] => collect(root, dotPath.split('.'));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const preview = (value: unknown): string => {
    const text = JSON.stringify(value);
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
};

if (board) {
    const events = diffNewEvents(-1, board.events?.Events).events;
    const state: GameState = buildGameState({ board, events, ts: 0 });

    // The fixture keeps the raw allgamedata nesting (`events.Events[]`); the
    // inventory uses the logical `events[]` path. Flatten it for comparison.
    const fixtureSignals = { ...boardData, events: boardData.events?.Events ?? [] };

    for (const row of INVENTORY) {
        if (!row.use) continue;
        const fixtureValues = valuesAt(fixtureSignals, row.field);
        const stateValues = valuesAt(state, row.use);
        ok(
            same(fixtureValues, stateValues),
            `fidelity: ${row.field} -> ${row.use} (fixture ${preview(fixtureValues)}, state ${preview(stateValues)})`,
            row.field
        );
    }

    for (const row of INVENTORY) {
        if (!row.use) continue;
        const stateValues = valuesAt(state, row.use);
        ok(
            stateValues.length > 0 && stateValues.every((value) => value !== undefined),
            `no silent drop: ${row.field} -> ${row.use} has a GameState value`,
            row.field
        );
    }
}

if (failures.size) {
    console.error(`FAILING ROWS (${failures.size}): ${[...failures].join(', ')}`);
} else {
    console.log('verify:signal-inventory ok');
}
