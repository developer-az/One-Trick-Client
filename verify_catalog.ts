import { ingestChampionCatalog } from './src/data/championCatalog';
import { buildRecommendation, DEAD_ITEM_IDS } from './src/catalog/buildCatalog';
import type { CatalogBundle, CatalogItem, CatalogChampion } from './src/catalog/types';
import { genericProfileId, getProfile, isAuthoredProfileId, profileFromChampionName } from './src/logic/profiles';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const fixtureChamps: CatalogChampion[] = [
  { id: 'Pyke', key: '555', name: 'Pyke', tags: ['Support', 'Assassin'], roles: ['Support'], damageType: 'Physical' },
  { id: 'Pantheon', key: '80', name: 'Pantheon', tags: ['Fighter'], roles: ['Support', 'Top'], damageType: 'Physical' },
  { id: 'Yone', key: '777', name: 'Yone', tags: ['Assassin', 'Fighter'], roles: ['Mid'], damageType: 'Physical' },
  { id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage', 'Assassin'], roles: ['Mid'], damageType: 'Magic' },
  { id: 'KSante', key: '897', name: "K'Sante", tags: ['Tank', 'Fighter'], roles: ['Top'], damageType: 'Physical' },
  { id: 'Mel', key: '800', name: 'Mel', tags: ['Mage'], roles: ['Mid'], damageType: 'Magic' },
];

ingestChampionCatalog(fixtureChamps);

assert(profileFromChampionName('Pyke')?.id === 'pyke-support', 'Pyke stays authored');
assert(profileFromChampionName('Pantheon')?.id === 'pantheon-support', 'Pantheon stays authored');
assert(profileFromChampionName('Yone')?.id === 'yone-mid', 'Yone stays authored');
assert(isAuthoredProfileId('pyke-support'), 'authored id');

const ahri = profileFromChampionName('Ahri', 'Mid');
assert(ahri && ahri.id === 'generic:Ahri:Mid', `Ahri generic, got ${ahri?.id}`);
assert(ahri.championId === 'Ahri', 'Ahri champion id');
assert(getProfile(genericProfileId('KSante', 'Top')).id === 'generic:KSante:Top', 'KSante generic');
assert(getProfile('generic:Mel:Mid').shortLabel === 'Mel' || getProfile('generic:Mel:Mid').championId === 'Mel', 'Mel generic');

const rec = buildRecommendation({
  champion: fixtureChamps[3],
  role: 'Mid',
  items: [
    { id: '1056', name: "Doran's Ring", tags: ['Lane'], gold: 400, purchasable: true, from: [], into: [], maps: { '11': true } },
    { id: '3020', name: "Sorcerer's Shoes", tags: ['Boots'], gold: 1100, purchasable: true, from: [], into: [], maps: { '11': true } },
    { id: '6655', name: "Luden's Companion", tags: ['SpellDamage', 'Mana', 'AbilityHaste'], gold: 2850, purchasable: true, from: [], into: [], maps: { '11': true } },
    { id: '3156', name: 'Maw of Malmortius', tags: ['Damage', 'SpellBlock', 'LifeSteal'], gold: 3100, purchasable: true, from: [], into: [], maps: { '11': true } },
  ],
});
assert(rec.boots === '3020', `Ahri boots ${rec.boots}`);
assert(rec.starter.includes('1056'), 'Ahri starter');
assert(rec.core[0] === '6655' && !rec.core.includes('3156'), `Ahri core should be AP, got ${rec.core}`);
assert(DEAD_ITEM_IDS.includes('3867'), 'quest mid-step stays in dead list');

const apiDir = join(process.cwd(), 'website/public/api/v1');
if (existsSync(join(apiDir, 'champions.json'))) {
  const champions = JSON.parse(readFileSync(join(apiDir, 'champions.json'), 'utf8')) as CatalogChampion[];
  const profiles = JSON.parse(readFileSync(join(apiDir, 'profiles.json'), 'utf8')) as CatalogBundle['profiles'];
  ingestChampionCatalog(champions);
  assert(champions.length >= 140, `full roster expected, got ${champions.length}`);
  for (const champ of champions) {
    const profile = profileFromChampionName(champ.id, champ.roles[0] || 'Mid');
    assert(profile, `${champ.id} must resolve to a profile`);
  }
  const authored = new Set(profiles.authored.map((row) => row.championId));
  assert(authored.has('Pyke') && authored.has('Pantheon') && authored.has('Yone'), 'authored trio in API');
  assert(profileFromChampionName('Pyke')?.id === 'pyke-support', 'API Pyke still authored');

  // Generic builds must follow the champion's class: no crit on mages or tanks,
  // no ability power on marksmen, and not one build for everybody.
  const apiItems = JSON.parse(readFileSync(join(apiDir, 'items.json'), 'utf8')) as CatalogItem[];
  const tagsOf = (id: string) => apiItems.find((i) => i.id === id)?.tags || [];
  const cores = new Set<string>();
  for (const champ of champions) {
    for (const role of champ.roles) {
      const r = buildRecommendation({ champion: champ, role, items: apiItems });
      cores.add(r.core.join(','));
      const tags = r.core.flatMap(tagsOf);
      if (champ.tags[0] === 'Mage' || champ.tags[0] === 'Tank') {
        assert(!tags.includes('CriticalStrike'), `${champ.id} ${role} core has crit: ${r.core}`);
      }
      if (champ.tags[0] === 'Marksman' && champ.damageType === 'Physical') {
        assert(!tags.includes('SpellDamage'), `${champ.id} ${role} core has AP: ${r.core}`);
      }
      assert(new Set(r.core.map((id) => apiItems.find((i) => i.id === id)?.name)).size === r.core.length, `${champ.id} duplicate core item`);
    }
  }
  assert(cores.size >= 8, `generic builds collapse to ${cores.size} cores`);
  console.log(`catalog api: ${champions.length} champions resolve`);
}

console.log('verify:catalog ok');
