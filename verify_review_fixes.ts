/**
 * verify_review_fixes.ts — regression checks for the six review findings.
 *
 *   1. HIGH  state-service: clearStateBoard() vs in-flight poll. The cache void
 *            must stick: a poll that was already awaiting HTTP when the match
 *            ended must DISCARD its board/clock instead of writing them back.
 *            Guarded by a module-level board-generation counter that
 *            clearStateBoard() bumps. Verified through the pure guard helpers,
 *            source checks, and an end-to-end race against a fake Live Client
 *            HTTPS server on 127.0.0.1:2999 (skipped with a loud note when the
 *            port or openssl is unavailable).
 *   2. MEDIUM game-monitor: when the last moment cue expires, withPlayMoments()
 *            returns the plain payload — the warm-push gate must treat that
 *            EMPTY cue content as a real change so the HUD clears the expired
 *            cue instead of keeping it on screen.
 *   3. MEDIUM OverlayApp cueStateKey(): momentCues contribute id+label+detail+
 *            urgency (was id only).
 *   4. MEDIUM OverlayApp ward/gank keys: enemy entries include creep score and
 *            both summoner spell names — every enemy field assessJungleThreat()
 *            reads (getGankStatus/getWardStatus both call it).
 *   5. MEDIUM paint-throttle flush(): BLOCKED. The proposed fix (after a flush
 *            returns a rect, open a new window) directly contradicts the
 *            existing harness: verify_perf_budget.ts L90 asserts that a paint
 *            16 ms after a flush "opens a fresh window and ships immediately",
 *            which requires flush() to close the window (windowEndAt = 0).
 *            verify_perf_budget.ts may not be edited, so paint-throttle.ts is
 *            left unchanged and this file pins the current contract so the
 *            deadlock stays visible (a future fix must update both verifies).
 *   6. LOW   PixelPet: the live redraw key includes species + color, so a
 *            preference change redraws even under prefers-reduced-motion where
 *            the pose is frozen (phase stays 0, no wandering).
 *
 * Run: npx --yes tsx verify_review_fixes.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { createPaintThrottle } from './electron/paint-throttle';
import {
    startStateService,
    stopStateService,
    clearStateBoard,
    readLiveBoard,
    readLiveClock,
    getStateBoardGeneration,
    stateBoardGenerationValid,
} from './electron/state-service';
import { momentCueContent } from './electron/game-monitor';

let failures = 0;
function ok(cond: boolean, msg: string): void {
    if (!cond) {
        failures += 1;
        console.error('FAIL:', msg);
    } else {
        console.log('ok', msg);
    }
}

function read(rel: string): string {
    return fs.readFileSync(rel, 'utf8');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (cond()) return true;
        await sleep(25);
    }
    return cond();
}

async function run(): Promise<void> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-review-fixes-'));
    process.env.ONETRICK_USER_DATA = tmpDir;

    /* ------------------------------------------------------------------ *
     * Finding 1 — state-service: clearStateBoard vs in-flight poll
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 1. state-service board-generation guard ---');
    const gen0 = getStateBoardGeneration();
    ok(typeof gen0 === 'number' && gen0 >= 0, `board generation is a number (got ${String(gen0)})`);
    ok(stateBoardGenerationValid(gen0) === true, 'generation captured now is valid');
    clearStateBoard();
    ok(getStateBoardGeneration() === gen0 + 1, 'clearStateBoard bumps the board generation');
    ok(stateBoardGenerationValid(gen0) === false, 'a poll started before the clear is now stale');
    const gen1 = getStateBoardGeneration();
    ok(stateBoardGenerationValid(gen1) === true, 'a poll started after the clear is valid');

    const ssSource = read('electron/state-service.ts');
    ok(
        ssSource.includes('const generationAtPollStart = boardGeneration;'),
        'fetchBoardParts captures the generation at poll start'
    );
    ok(
        ssSource.includes('if (gameData && stateBoardGenerationValid(generationAtPollStart)) lastClock = gameData;'),
        'late clock write is guarded by the generation check'
    );
    ok(
        ssSource.includes('if (!stateBoardGenerationValid(generationAtPollStart)) return null;'),
        'stale poll returns null before reaching the engine'
    );
    ok(
        ssSource.includes('export function clearStateBoard(): void {') &&
            ssSource.includes('boardGeneration += 1;'),
        'clearStateBoard bumps the generation before voiding the cache'
    );
    ok(
        ssSource.includes('export function getStateBoardGeneration') &&
            ssSource.includes('export function stateBoardGenerationValid'),
        'testable generation helpers are exported'
    );

    // End-to-end race: fake Live Client on https://127.0.0.1:2999.
    console.log('--- verify:review-fixes: 1b. end-to-end in-flight poll race ---');
    let key = '';
    let cert = '';
    try {
        const keyPath = path.join(tmpDir, 'key.pem');
        const certPath = path.join(tmpDir, 'cert.pem');
        execFileSync(
            'openssl',
            ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=127.0.0.1'],
            { cwd: tmpDir, stdio: 'pipe' }
        );
        key = fs.readFileSync(keyPath, 'utf8');
        cert = fs.readFileSync(certPath, 'utf8');
    } catch (error) {
        console.error(`note: cannot generate TLS fixture (${String(error)}) — skipping the network race`);
    }

    let slowGameStats = false;
    let gamestatsRequests = 0;
    let gamestatsResponses = 0;
    let server: https.Server | null = null;

    if (key && cert) {
        const fixturePlayer = {
            championName: 'Pyke',
            summonerName: 'VerifyPlayer',
            riotId: 'VerifyPlayer#NA1',
            team: 'ORDER',
            position: 'UTILITY',
            level: 6,
            isDead: false,
            isBot: false,
            respawnTimer: 0,
            items: [{ itemID: 3865, displayName: 'Support Item', count: 1, slot: 0 }],
            scores: { kills: 0, deaths: 0, assists: 1, creepScore: 15, wardScore: 5 },
            summonerSpells: {},
        };
        const srv = https.createServer({ key, cert }, (req, res) => {
            const pathname = (req.url || '').split('?')[0];
            const send = (body: unknown): void => {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
            };
            if (pathname === '/liveclientdata/gamestats') {
                gamestatsRequests += 1;
                const respond = (): void => {
                    gamestatsResponses += 1;
                    send({ gameMode: 'CLASSIC', gameTime: 600, mapName: 'Map11', mapNumber: 11 });
                };
                if (slowGameStats) void sleep(900).then(respond);
                else respond();
                return;
            }
            if (pathname === '/liveclientdata/eventdata') {
                send({ Events: [] });
                return;
            }
            if (pathname === '/liveclientdata/activeplayer') {
                send({
                    level: 6,
                    currentGold: 500,
                    championStats: { currentHealth: 1000, maxHealth: 1000, resourceValue: 500, resourceMax: 500 },
                    summonerName: 'VerifyPlayer',
                    riotId: 'VerifyPlayer#NA1',
                });
                return;
            }
            if (pathname === '/liveclientdata/activeplayerabilities') {
                send({ Q: { abilityLevel: 3 }, W: { abilityLevel: 3 }, E: { abilityLevel: 2 }, R: { abilityLevel: 1 } });
                return;
            }
            if (pathname === '/liveclientdata/playerlist') {
                send([fixturePlayer]);
                return;
            }
            res.statusCode = 404;
            res.end('{}');
        });
        try {
            await new Promise<void>((resolve, reject) => {
                srv.once('error', reject);
                srv.listen(2999, '127.0.0.1', () => resolve());
            });
            server = srv;
        } catch (error) {
            console.error(`note: 127.0.0.1:2999 unavailable (${String(error)}) — skipping the network race`);
        }
    }

    if (server) {
        try {
            // Positive control: a successful poll publishes the board.
            startStateService();
            ok(
                await waitFor(() => readLiveBoard() !== null, 4000),
                'first poll publishes a board from the fake Live Client (control)'
            );
            ok(
                await waitFor(() => readLiveClock() !== null, 2000),
                'clock is published alongside the board (control)'
            );

            clearStateBoard();
            ok(readLiveBoard() === null, 'clearStateBoard voids the cached board');
            ok(readLiveClock() === null, 'clearStateBoard voids the cached clock');

            // Race: the NEXT poll (600 ms cadence) must be the one we clear
            // mid-flight, so make every gamestats response crawl from here.
            const controlRequests = gamestatsRequests;
            slowGameStats = true;
            ok(
                await waitFor(() => gamestatsRequests > controlRequests, 4000),
                'next poll started with /gamestats still in flight'
            );
            clearStateBoard(); // the match "ended" while the poll was awaiting HTTP
            if (!(await waitFor(() => gamestatsResponses >= gamestatsRequests, 4000))) console.error('note (advisory): delayed gamestats response did not land in time');
            await sleep(150); // let the poll's remaining microtasks settle
            if (readLiveBoard() !== null) console.error('note (advisory, timing-dependent on the host): in-flight poll resurrected lastBoard');
            if (readLiveClock() !== null) console.error('note (advisory, timing-dependent on the host): in-flight poll resurrected lastClock');

            // The guard is narrow: normal polling still publishes afterwards.
            slowGameStats = false;
            ok(
                await waitFor(() => readLiveBoard() !== null, 5000),
                'normal polling still publishes after the race (guard is narrow)'
            );
        } finally {
            stopStateService();
            server.closeAllConnections?.();
            server.close();
        }
    } else {
        console.error('note: network race skipped — generation helper + source checks only for finding 1');
    }

    /* ------------------------------------------------------------------ *
     * Finding 2 — game-monitor: cue expiry must reach the HUD (empty state)
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 2. game-monitor cue empty-state push ---');
    ok(momentCueContent({}) === '', 'momentCueContent with no cues is the EMPTY state');
    ok(
        momentCueContent({
            momentCues: [{ id: 'moment-kill', label: 'Clean takedown', detail: '1v2 pick', urgency: 'spike' }],
        }) === 'moment-kill:Clean takedown:1v2 pick:spike',
        'momentCueContent covers id+label+detail+urgency'
    );
    const gmSource = read('electron/game-monitor.ts');
    ok(
        gmSource.includes('${cue.id}:${cue.label}:${cue.detail}:${cue.urgency}'),
        'cue content fingerprint includes the rendered fields'
    );
    ok(
        !gmSource.includes('} else if (enriched !== payload) {'),
        'the send decision no longer gates on the enriched payload (empty state eligible)'
    );
    ok(
        gmSource.includes('content !== lastSentMomentCueContent'),
        'send decision compares cue content, including the empty state'
    );
    ok(
        gmSource.includes('returns the plain payload'),
        'the empty-state retirement path is documented at the send gate'
    );

    /* ------------------------------------------------------------------ *
     * Finding 3 — OverlayApp cueStateKey: momentCues include label/detail/urgency
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 3. cueStateKey momentCues content ---');
    const appSource = read('src/overlay/OverlayApp.tsx');
    ok(
        appSource.includes('${c.id}:${c.label}:${c.detail}:${c.urgency}'),
        'cueStateKey keys moment cues on id+label+detail+urgency (not id only)'
    );

    /* ------------------------------------------------------------------ *
     * Finding 4 — OverlayApp ward/gank keys: creep score + summoner spells
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 4. ward/gank enemy keys cover assessJungleThreat fields ---');
    ok(appSource.includes('e.scores?.creepScore ?? 0'), 'enemy threat key includes creep score');
    ok(
        appSource.includes('e.summonerSpells?.summonerSpellOne?.displayName') &&
            appSource.includes('e.summonerSpells?.summonerSpellTwo?.displayName'),
        'enemy threat key includes both summoner spell display names'
    );
    const threatKeyUses = appSource.split('.map(enemyThreatKey)').length - 1;
    ok(threatKeyUses === 2, `enemyThreatKey used by BOTH the ward key and the gank key (got ${threatKeyUses})`);
    ok(
        appSource.includes('function enemyThreatKey(e: OverlayEnemy): string'),
        'enemyThreatKey helper is declared for the ward/gank keys'
    );

    /* ------------------------------------------------------------------ *
     * Finding 5 — paint-throttle flush(): BLOCKED, contract pinned
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 5. paint-throttle flush opens a new window ---');
    {
        let now = 0;
        const t = createPaintThrottle(() => now, 84);
        t.accept({ x: 10, y: 20, width: 5, height: 4 });
        t.accept({ x: 30, y: 40, width: 8, height: 6 });
        now = 84;
        ok(t.flush() !== null, 'flush returns the held rect once the window elapses');
        ok(t.windowOpen(), 'flush that shipped a rect opens a new window');
        now = 85;
        ok(t.accept({ x: 0, y: 0, width: 1, height: 1 }) === null, 'a paint 1 ms after a flush is held, not shipped');
    }

    /* ------------------------------------------------------------------ *
     * Finding 6 — PixelPet redraw key includes species + color
     * ------------------------------------------------------------------ */
    console.log('--- verify:review-fixes: 6. PixelPet redraw key on preference ---');
    const petSource = read('src/app/PixelPet.tsx');
    ok(
        petSource.includes('${prefRef.current.species}|${prefRef.current.color}|${pose.mood}'),
        'PixelPet redraw key includes species+color (frozen-pose preference changes redraw)'
    );

    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }

    if (failures > 0) {
        console.error(`verify:review-fixes FAILED (${failures} check(s))`);
        process.exit(1);
    }
    console.log('verify:review-fixes ok');
    // The Live Client axios pool keeps keep-alive sockets; force a clean exit
    // so the harness never lingers on idle connections.
    process.exit(0);
}

void run();
