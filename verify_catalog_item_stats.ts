/**
 * I2.1 acceptance: catalog items carry Data Dragon stats and an anti-heal flag.
 * Part 1 tests the pure mappers on Data Dragon-shaped input; part 2 checks the shipped snapshot.
 */
import { readFileSync } from 'node:fs';
import { antiHealFromDescription, itemStatsFromDDragon } from './src/catalog/buildCatalog';
import type { CatalogItem } from './src/catalog/types';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

// ---- Part 1: mappers ----
const s = itemStatsFromDDragon({
  FlatPhysicalDamageMod: 35,
  FlatCritChanceMod: 0.25,
  FlatHPPoolMod: 450,
  FlatArmorMod: 75,
  FlatSpellBlockMod: 40,
  FlatMagicDamageMod: 90,
  FlatMPPoolMod: 300,
  FlatMovementSpeedMod: 45,
  PercentMovementSpeedMod: 0.04,
  PercentAttackSpeedMod: 0.4,
  PercentLifeStealMod: 0.1,
  FlatHPRegenMod: 0,
  SomeFutureMod: 12,
});
ok(s.ad === 35 && s.crit === 0.25 && s.hp === 450 && s.armor === 75 && s.mr === 40, 'stats: ad/crit/hp/armor/mr mapped');
ok(s.ap === 90 && s.mana === 300 && s.ms === 45 && s.msPct === 0.04 && s.as === 0.4 && s.lifesteal === 0.1, 'stats: ap/mana/ms/msPct/as/lifesteal mapped');
ok(!('hpRegen' in s), 'stats: zero values are left out');
ok(Object.keys(s).length === 11, 'stats: unknown Data Dragon keys are not carried');
ok(JSON.stringify(itemStatsFromDDragon(undefined)) === '{}', 'stats: missing -> {}');
ok(JSON.stringify(itemStatsFromDDragon({ FlatArmorMod: Number.NaN })) === '{}', 'stats: non-finite dropped');

ok(antiHealFromDescription('<passive>Grievous Wounds</passive><br>Dealing physical damage applies <keyword>40% Wounds</keyword> to enemy champions.'), 'anti-heal: Grievous Wounds passive');
ok(antiHealFromDescription('deal magic damage to the attacker and apply <keyword>40% Wounds</keyword> for 3 seconds'), 'anti-heal: "Wounds" keyword alone');
ok(!antiHealFromDescription('<stats><attention>40</attention> Attack Damage</stats> Heals you for 12% of damage dealt.'), 'anti-heal: healing item is not anti-heal');
ok(!antiHealFromDescription(undefined) && !antiHealFromDescription(''), 'anti-heal: missing description -> false');

// ---- Part 2: shipped snapshot ----
const dir = 'website/public/api/v1';
const items = JSON.parse(readFileSync(`${dir}/items.json`, 'utf8')) as CatalogItem[];
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as { patch: string };
const byId = new Map(items.map((i) => [i.id, i]));
const ALLOWED = new Set(['ad', 'ap', 'hp', 'mana', 'armor', 'mr', 'as', 'crit', 'ms', 'msPct', 'lifesteal', 'hpRegen']);

ok(/^\d+\.\d+\.\d+$/.test(manifest.patch), `snapshot: manifest patch present (${manifest.patch})`);
ok(items.length > 200, 'snapshot: has items');
ok(items.every((i) => i.stats && typeof i.stats === 'object' && !Array.isArray(i.stats)), 'snapshot: every item has a stats object');
ok(items.every((i) => typeof i.antiHeal === 'boolean'), 'snapshot: every item has an antiHeal boolean');
ok(
  items.every((i) => Object.entries(i.stats || {}).every(([k, v]) => ALLOWED.has(k) && typeof v === 'number' && Number.isFinite(v) && v !== 0)),
  'snapshot: stats use only the known keys with finite non-zero numbers'
);
ok(
  items.every((i) => typeof i.gold === 'number' && Array.isArray(i.from) && Array.isArray(i.into) && Array.isArray(i.tags)),
  'snapshot: existing fields unchanged in shape'
);

const stat = (id: string, key: string) => (byId.get(id)?.stats as Record<string, number> | undefined)?.[key] ?? 0;
ok(stat('1036', 'ad') > 0, 'snapshot: Long Sword has AD');
ok(stat('1029', 'armor') > 0, 'snapshot: Cloth Armor has armor');
ok(stat('1033', 'mr') > 0, 'snapshot: Null-Magic Mantle has MR');
ok(stat('1028', 'hp') > 0, 'snapshot: Ruby Crystal has health');
ok(stat('1052', 'ap') > 0, 'snapshot: Amplifying Tome has AP');
ok(stat('3075', 'armor') > 0 && stat('3075', 'hp') > 0, 'snapshot: Thornmail has armor and health');

for (const id of ['3033', '3165', '3075', '6609', '3123', '3076', '3916']) {
  ok(byId.get(id)?.antiHeal === true, `snapshot: anti-heal flagged: ${id} ${byId.get(id)?.name}`);
}
for (const id of ['1036', '3179', '3071', '3158', '3153']) {
  ok(byId.get(id)?.antiHeal === false, `snapshot: not anti-heal: ${id} ${byId.get(id)?.name}`);
}
const flagged = items.filter((i) => i.antiHeal && i.purchasable);
ok(flagged.length >= 6 && flagged.length <= 12, `snapshot: anti-heal list is small and specific (${flagged.length})`);
