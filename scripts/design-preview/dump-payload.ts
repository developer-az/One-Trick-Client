// Builds real overlay payloads from the recorded mock board so the HUD can be
// rendered outside Electron for design review. Usage: npx tsx scripts/design-preview/dump-payload.ts <out.json>
import fs from 'node:fs';
import { buildOverlayPayload, stopGameMonitor } from '../../electron/game-monitor';
import type { LiveClientAllGameData } from '../../electron/live-client';

const fixture = JSON.parse(fs.readFileSync('test-fixtures/live-client/mock-board-900s.json', 'utf8')) as { allgamedata: LiveClientAllGameData };
const board = fixture.allgamedata;
const out: Record<string, unknown> = {};
out.base = buildOverlayPayload(board, 'InProgress');
const late = JSON.parse(JSON.stringify(board)) as LiveClientAllGameData;
if (late.gameData) late.gameData.gameTime = 1500;
out.late = buildOverlayPayload(late, 'InProgress');
fs.writeFileSync(process.argv[2] || 'payloads.json', JSON.stringify(out, null, 1));
console.log('keys', Object.keys(out), 'champion', (board.allPlayers || []).slice(0, 2).map((p) => p.championName));
stopGameMonitor();
process.exit(0);
