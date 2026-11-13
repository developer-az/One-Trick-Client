/** Summoner chip hierarchy: Flash dominates, "soon" is flagged, progress is bounded. */
import { chipTone, SOON_SECONDS } from './src/logic/summonerChip';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

ok(chipTone({ name: 'Flash', short: 'F', baseCd: 300, remaining: 0, ready: true }).priority === 'primary', 'Flash is primary');
ok(chipTone({ name: 'Ignite', short: 'Ign', baseCd: 180, remaining: 0, ready: true }).priority === 'secondary', 'Ignite is secondary');
ok(chipTone({ name: 'Heal', short: 'H', baseCd: 240, remaining: 10 }).priority === 'secondary', 'Heal is secondary');
ok(chipTone({ short: 'F', baseCd: 300, remaining: 5 }).priority === 'primary', 'short F alone marks Flash primary');

ok(SOON_SECONDS === 15, 'soon window is 15 s');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 15 }).state === 'soon', '15 s remaining is soon');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 16 }).state === 'down', '16 s remaining is down');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 0 }).state === 'ready', '0 s remaining is ready');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 30, ready: true }).state === 'ready', 'ready flag wins over remaining');

ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 150 }).fillPct === 50, 'fill is share of cooldown left (50)');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 900 }).fillPct === 100, 'fill clamps at 100');
ok(chipTone({ name: 'Flash', baseCd: 0, remaining: 20 }).fillPct === 0, 'baseCd 0 gives 0 fill');
ok(chipTone({ name: 'Flash', baseCd: Number.NaN, remaining: 20 }).fillPct === 0, 'NaN baseCd gives 0 fill');
ok(chipTone({ name: 'Flash', baseCd: 300, remaining: 0, ready: true }).fillPct === 0, 'ready has 0 fill');

let threw = false;
try {
    chipTone({});
    chipTone({ remaining: Number.NaN, baseCd: undefined });
} catch {
    threw = true;
}
ok(!threw, 'empty / NaN spells never throw');
