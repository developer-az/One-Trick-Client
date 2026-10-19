/**
 * One-trick guidance guardrails.
 *
 * The guidance is derived, not sourced — so the test is about honesty and
 * shape: every champion gets a plan, plans are specific to the kit, and no
 * plan claims a statistic the app cannot back up.
 */
import { ingestChampionCatalog } from './src/data/championCatalog';
import { SNAPSHOT_BUNDLE } from './src/catalog/snapshot';
import { oneTrickPlan } from './src/logic/oneTrick';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

ingestChampionCatalog(
  SNAPSHOT_BUNDLE.champions.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    tags: c.tags,
    damageType: c.damageType,
  }))
);

const champ = (id: string, tags: string[]) => ({ id, key: '0', name: id, tags, damageType: 'Physical' as const });

const zed = oneTrickPlan(champ('Zed', ['Assassin', 'Fighter']), 'Mid');
const lux = oneTrickPlan(champ('Lux', ['Mage', 'Support']), 'Mid');
const jinx = oneTrickPlan(champ('Jinx', ['Marksman']), 'Bot');
const janna = oneTrickPlan(champ('Janna', ['Support', 'Mage']), 'Support');
const malphite = oneTrickPlan(champ('Malphite', ['Tank', 'Mage']), 'Top');

ok(zed.archetype === 'assassin', `Zed classified as assassin (${zed.archetype})`);
ok(jinx.archetype === 'marksman', `Jinx classified as marksman (${jinx.archetype})`);
ok(malphite.archetype === 'tank', `Malphite classified as tank (${malphite.archetype})`);
ok(lux.archetype === 'control mage', `Lux classified as mage (${lux.archetype})`);
ok(janna.archetype === 'enchanter', `Janna classified as enchanter (${janna.archetype})`);

ok(zed.winCondition !== jinx.winCondition, 'assassin and marksman win conditions differ');
ok(malphite.habits.length <= 4, 'habits stay short enough to read');
ok(janna.leaks.length === 3, 'three leaks per plan');

// Role discipline is prepended, so jungle leads with the route habit.
const junglerZed = oneTrickPlan(champ('Zed', ['Assassin']), 'Jungle');
ok(junglerZed.habits[0].toLowerCase().includes('clear'), 'jungle plan leads with the clear habit');

// Honesty: no fabricated percentage or win-rate claims.
const allPlans = [zed, lux, jinx, janna, malphite, junglerZed];
const text = allPlans.flatMap((p) => [p.winCondition, ...p.habits, ...p.leaks, p.enemyAnswer]).join(' ');
ok(!/\d+(\.\d+)?\s*%/.test(text), 'no percentage/win-rate claims in guidance');
ok(!/win\s*rate/i.test(text), 'no win-rate wording in guidance');

// Every champion in the catalog must produce a plan (generic profiles rely on it).
let missing = 0;
for (const c of SNAPSHOT_BUNDLE.champions) {
  const plan = oneTrickPlan({ id: c.id, key: c.key, name: c.name, tags: c.tags, damageType: c.damageType }, 'Mid');
  if (!plan.winCondition || !plan.habits.length) missing += 1;
}
ok(missing === 0, `every catalog champion gets a plan (${missing} missing)`);

if (!process.exitCode) console.log('verify:one-trick ok');
