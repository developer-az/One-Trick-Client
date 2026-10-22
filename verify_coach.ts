/**
 * Coach rule-engine verification — pure fixtures, no live game needed.
 *
 * Covers: objective calls (soon / spawning), respawn disadvantage before an
 * objective, danger, numbers advantage, recall gold tiers, fed-enemy warning,
 * level spikes, per-rule cooldowns, and priority arbitration.
 *
 * Run: npm run verify:coach
 */

import {
    applyCoachCooldowns,
    pickCoachCue,
    COACH_CONFIG,
    type CoachContext,
    type CoachEnemy,
} from './src/logic/coach';
import { deriveObjectiveTimers, toGameEvent, type LiveRawEventLike } from './src/logic/gameState';

const ok = (c: boolean, m: string) => {
    if (!c) {
        console.error('FAIL', m);
        process.exitCode = 1;
    } else console.log('ok', m);
};

const ev = (EventID: number, EventName: string, EventTime: number, extra: Record<string, unknown> = {}): LiveRawEventLike => ({
    EventID,
    EventName,
    EventTime,
    ...extra,
});

const enemy = (championName: string, o: Partial<CoachEnemy> = {}): CoachEnemy => ({
    championName,
    level: 8,
    isDead: false,
    kills: 1,
    deaths: 2,
    ...o,
});

const baseCtx = (over: Partial<CoachContext> = {}): CoachContext => ({
    gameTime: 600,
    level: 8,
    isDead: false,
    respawnSec: 0,
    hpPct: 0.8,
    currentGold: 400,
    enemies: [
        enemy('Jinx'),
        enemy('Thresh'),
        enemy('Yasuo'),
        enemy('LeeSin'),
        enemy('Ahri'),
    ],
    timers: { dragon: null, baron: null, herald: null },
    ...over,
});

/* 1. Objective call — dragon respawning inside the lead window. */
const dragonTimer = deriveObjectiveTimers(
    [toGameEvent(ev(1, 'DragonKill', 600, { KillerName: 'Pyke' }))].filter(
        (e): e is NonNullable<typeof e> => !!e
    ),
    630
);
// Dragon killed at t=600 → respawn at t=900. The 45s lead window opens at 855.
const soon = pickCoachCue(baseCtx({ timers: dragonTimer, gameTime: 870 }), new Map());
ok(soon?.cue.id === 'coach-obj-soon', `dragon inside lead window fires obj-soon (got ${soon?.cue.id ?? 'null'})`);
ok(soon?.cue.label === 'Dragon in 0:30', `label carries the countdown (got ${soon?.cue.label})`);
ok(soon?.cue.detail.includes('Dragon up in'), 'detail names the objective and the time');

/* 2. Spawning grace: within 10s it escalates to "spawning now". */
const now = pickCoachCue(baseCtx({ timers: dragonTimer, gameTime: 895 }), new Map());
ok(now?.cue.id === 'coach-obj-now', `inside 10s escalates to obj-now (got ${now?.cue.id ?? 'null'})`);

/* 3. Cooldown: the same rule cannot re-fire immediately. */
const cd = applyCoachCooldowns(new Map(), soon!);
const refire = pickCoachCue(baseCtx({ timers: dragonTimer, gameTime: 885 }), cd);
ok(refire === null, 'the same rule stays silent while on cooldown');

/* 4. Priority: respawn disadvantage before an objective outranks the call. */
const missIt = pickCoachCue(
    baseCtx({ timers: dragonTimer, gameTime: 870, isDead: true, respawnSec: 40, hpPct: 0.2 }),
    new Map()
);
ok(missIt?.cue.id === 'coach-respawn-obj', `respawn disadvantage wins priority (got ${missIt?.cue.id ?? 'null'})`);
ok(!!missIt?.cue.detail.includes('Respawn'), 'detail carries both clocks');

/* 5. Danger: low HP with enemies alive — and it outranks a routine objective call. */
const danger = pickCoachCue(baseCtx({ timers: dragonTimer, gameTime: 875, hpPct: 0.2 }), new Map());
ok(danger?.cue.id === 'coach-danger', `danger outranks obj-soon (got ${danger?.cue.id ?? 'null'})`);
ok(danger?.cue.detail.includes('20% HP'), 'danger cites the HP that triggered it');

/* 6. Danger requires enemies actually alive. */
const safeDanger = pickCoachCue(
    baseCtx({
        hpPct: 0.2,
        enemies: baseCtx().enemies.map((e) => ({ ...e, isDead: true })),
    }),
    new Map()
);
ok(safeDanger === null || safeDanger.cue.id !== 'coach-danger', 'no danger call when all enemies are dead');

/* 7. Numbers advantage: 2+ dead, no objective timer racing. */
const numbers = pickCoachCue(
    baseCtx({ enemies: [enemy('Jinx', { isDead: true }), enemy('Thresh', { isDead: true })] }),
    new Map()
);
ok(numbers?.cue.id === 'coach-numbers', `2 dead enemies → numbers call (got ${numbers?.cue.id ?? 'null'})`);
ok(numbers?.cue.detail.includes('Jinx'), 'numbers names the kills');

/* 8. Numbers suppressed while an objective timer is racing (objective call covers it). */
const suppressed = pickCoachCue(
    baseCtx({
        timers: dragonTimer,
        gameTime: 870,
        enemies: [enemy('Jinx', { isDead: true }), enemy('Thresh', { isDead: true })],
    }),
    new Map()
);
ok(suppressed?.cue.id !== 'coach-numbers', 'numbers defers to the objective call');

/* 9. Recall: gold tier crossing nudges a reset. */
const recall = pickCoachCue(baseCtx({ currentGold: 1700 }), new Map());
ok(recall?.cue.id === 'coach-recall', `gold above the tier fires a recall nudge (got ${recall?.cue.id ?? 'null'})`);
const poorRecall = pickCoachCue(baseCtx({ currentGold: 300 }), new Map());
ok(poorRecall?.cue.id !== 'coach-recall', 'no recall nudge under the first gold tier');

/* 10. Fed enemy warning. */
const fed = pickCoachCue(
    baseCtx({ enemies: [enemy('Draven', { kills: 7, deaths: 1 }), ...baseCtx().enemies.slice(1)] }),
    new Map()
);
ok(fed?.cue.id === 'coach-fed', `fed enemy fires (got ${fed?.cue.id ?? 'null'})`);
ok(!!fed?.cue.label.includes('Draven'), 'fed cue names the champion');

/* 11. Level spikes: 11 and 16 fire, other levels do not. */
const spike11 = pickCoachCue(baseCtx({ level: 11 }), new Map());
ok(spike11?.cue.id === 'coach-spike', `level 11 fires a spike tip (got ${spike11?.cue.id ?? 'null'})`);
const spike16 = pickCoachCue(baseCtx({ level: 16 }), new Map());
ok(spike16?.cue.id === 'coach-spike', 'level 16 fires a spike tip');
const noSpike = pickCoachCue(baseCtx({ level: 9 }), new Map());
ok(noSpike?.cue.id !== 'coach-spike', 'level 9 is not a spike');

/* 12. Cooldown map updates are immutable. */
const before = new Map<string, number>();
const after = applyCoachCooldowns(before, { cue: spike11!.cue, firedAt: 600 });
ok(before.size === 0, 'applyCoachCooldowns does not mutate the input map');
ok(after.get('coach-spike') === 600, 'the fired rule is recorded');

/* 13. Every emitted cue stays HUD-sized (labels short, one line). */
for (const pick of [soon, now, danger, numbers, recall, fed].filter(
    (p): p is NonNullable<typeof p> => !!p
)) {
    ok(pick.cue.label.length <= 24, `label is HUD-short: "${pick.cue.label}"`);
    ok(!pick.cue.detail.includes('\n'), 'detail is a single line');
}

/* 14. Objective lead window comes from config, so tuning is one place. */
ok(COACH_CONFIG.objectiveLeadSec === 45, 'objective lead window is 45s by default');

if (!process.exitCode) console.log('verify:coach ok');
