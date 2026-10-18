/**
 * Simulates League + Windows interaction paths without a live game.
 */
import {
    LIVE_SILENCE_END_MS,
    LIVE_SILENCE_MIDGAME_END_MS,
    OUT_OF_GAME_HOLD_MS,
    shouldEndMatch,
    describeEndMatchReason,
} from '../electron/match-lifecycle';

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
    console.log(JSON.stringify({ hypothesisId, location, message, data }));
}

function assertSim(name: string, ok: boolean): void {
    if (!ok) throw new Error(`SIM FAIL: ${name}`);
}

// --- H5: stale cache then backfill (mirrors match-history.ts after fix) ---
function simulateCacheLoadBeforeFix(): { withEnemies: number; withAllies: number; missingAllies: number } {
    type Cache = Record<string, { enemies: number[]; allies?: number[] }>;
    const cache: Cache = {
        g1: { enemies: [99, 51] },
        g2: { enemies: [99], allies: [222] },
    };
    const games = [{ gameId: 'g1' }, { gameId: 'g2' }, { gameId: 'g3' }];
    let withEnemies = 0;
    let withAllies = 0;
    let missingAllies = 0;
    for (const g of games) {
        const hit = cache[g.gameId];
        let enemies: number[] | undefined;
        let allies: number[] | undefined;
        if (hit) {
            enemies = hit.enemies;
            if (hit.allies?.length) allies = hit.allies;
        }
        if (enemies?.length) withEnemies++;
        if (allies?.length) withAllies++;
        if (enemies?.length && !allies?.length) missingAllies++;
    }
    return { withEnemies, withAllies, missingAllies };
}

const cacheSimBefore = simulateCacheLoadBeforeFix();
log('H5', 'simulate:cache-before', 'stale cache without allies on hit (old behavior)', cacheSimBefore);
assertSim('H5 old cache leaves games with enemies but no allies', cacheSimBefore.missingAllies === 1);

function simulateCacheLoadAfterFix(): { withAllies: number; wouldRefetch: number } {
    type Cache = Record<string, { enemies: number[]; allies?: number[] }>;
    const cache: Cache = { g1: { enemies: [99, 51] } };
    const games = [{ gameId: 'g1' }];
    let wouldRefetch = 0;
    let withAllies = 0;
    for (const g of games) {
        const hit = cache[g.gameId];
        const needsAllyBackfill = !!hit?.enemies?.length && !hit.allies?.length;
        if (hit && !needsAllyBackfill) continue;
        if (needsAllyBackfill) wouldRefetch++;
        cache[g.gameId] = { enemies: hit!.enemies, allies: [222] };
        withAllies++;
    }
    return { withAllies, wouldRefetch };
}
const cacheSimAfter = simulateCacheLoadAfterFix();
log('H5', 'simulate:cache-after', 'backfill triggers refetch', cacheSimAfter);
assertSim('H5 fix refetches when allies missing', cacheSimAfter.wouldRefetch === 1);

// --- H2: overlay match-end at ~6 min (phase + live client) ---
const sixMin = 6 * 60;
const scenarios: Array<{ label: string; input: Parameters<typeof shouldEndMatch>[0]; expectEnd: boolean }> = [
    {
        label: '6min InProgress + 90s live silence (typical hitch)',
        input: {
            phase: 'InProgress',
            liveSilenceMs: 90_000,
            phaseHeldMs: sixMin * 1000,
            liveGameTime: null,
            trustedGameTime: sixMin,
        },
        expectEnd: false,
    },
    {
        label: '6min clock still advancing despite bad phase flap',
        input: {
            phase: 'ChampSelect',
            liveSilenceMs: 5_000,
            phaseHeldMs: 5_000,
            liveGameTime: sixMin + 2,
            trustedGameTime: sixMin,
        },
        expectEnd: false,
    },
    {
        label: '6min null phase + 65s live silence (mid-game — should NOT end yet)',
        input: {
            phase: null,
            liveSilenceMs: LIVE_SILENCE_END_MS + 1000,
            phaseHeldMs: LIVE_SILENCE_END_MS + 1000,
            liveGameTime: null,
            trustedGameTime: sixMin,
        },
        expectEnd: false,
    },
    {
        label: '6min null phase + 3min live silence (mid-game LCU drop)',
        input: {
            phase: null,
            liveSilenceMs: LIVE_SILENCE_MIDGAME_END_MS + 1000,
            phaseHeldMs: LIVE_SILENCE_MIDGAME_END_MS + 1000,
            liveGameTime: null,
            trustedGameTime: sixMin,
        },
        expectEnd: true,
    },
    {
        label: '6min Lobby held 13s + live silent 13s (menu flap)',
        input: {
            phase: 'Lobby',
            liveSilenceMs: OUT_OF_GAME_HOLD_MS + 1000,
            phaseHeldMs: OUT_OF_GAME_HOLD_MS + 1000,
            liveGameTime: null,
            trustedGameTime: sixMin,
        },
        expectEnd: true,
    },
];

for (const s of scenarios) {
    const end = shouldEndMatch(s.input);
    const reason = describeEndMatchReason(s.input);
    log('H2', 'simulate:shouldEndMatch', s.label, { end, reason, ...s.input });
    assertSim(s.label, end === s.expectEnd);
}

// --- H3: hold-to-show (mirrors overlay-window shouldShowWindow) ---
function shouldShowWindowSim(opts: {
    userHidden: boolean;
    overlayEnabled: boolean;
    locked: boolean;
    holdToShow: boolean;
    holdDown: boolean;
    emptySlot: boolean;
}): boolean {
    if (opts.userHidden || !opts.overlayEnabled) return false;
    if (!opts.locked) return true;
    if (opts.holdToShow && !opts.holdDown) return false;
    return !opts.emptySlot;
}

const holdSim = {
    visibleWhileLockedNoTab: shouldShowWindowSim({
        userHidden: false,
        overlayEnabled: true,
        locked: true,
        holdToShow: true,
        holdDown: false,
        emptySlot: false,
    }),
    visibleWhenTabHeld: shouldShowWindowSim({
        userHidden: false,
        overlayEnabled: true,
        locked: true,
        holdToShow: true,
        holdDown: true,
        emptySlot: false,
    }),
};
log('H3', 'simulate:holdToShow', 'overlay hidden when hold-to-show and Tab up', holdSim);
assertSim('H3 hold-to-show hides overlay without Tab', holdSim.visibleWhileLockedNoTab === false);

// --- H1: Windows dashboard X → quit (documented behavior, not Electron runtime) ---
log('H1', 'simulate:window-close', 'dashboard X hides to tray; Quit from tray only', {
    platformWin32QuitsOnDashboardClose: false,
    traySurvives: true,
    overlaySurvives: true,
});

// --- H6: Unflinching icon URLs ---
const STYLE = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles';
const metaUrl = `${STYLE}/Sorcery/Unflinching/Unflinching.png`;
const perkUrl = 'https://ddragon.leagueoflegends.com/cdn/15.1.1/img/perk/8242.png';

async function headOk(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        return res.ok;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const [metaOk, perkOk] = await Promise.all([headOk(metaUrl), headOk(perkUrl)]);
    log('H6', 'simulate:unflinching-icon', 'DDRagon HEAD checks', { metaUrl, metaOk, perkUrl, perkOk });
    assertSim('H6 meta icon exists', metaOk);
    console.log('simulate_windows_league ok');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
