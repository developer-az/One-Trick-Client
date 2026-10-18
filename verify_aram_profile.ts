import { ingestChampionCatalog } from './src/data/championCatalog';
import { resolveProfileId } from './src/overlay/overlayLogic';
import { profileFromChampionName } from './src/logic/profiles';
import { buildRecommendation } from './src/catalog/buildCatalog';
import { SNAPSHOT_BUNDLE } from './src/catalog/snapshot';

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

const samiraId = resolveProfileId({
  inGame: true,
  gameMode: 'KIWI',
  mapName: 'Howling Abyss',
  gameTime: 120,
  localPlayer: {
    championName: 'Samira',
    position: 'UTILITY',
    level: 3,
    items: [],
  },
});
ok(samiraId === 'generic:Samira:Bot', 'Samira Mayhem ignores UTILITY → Bot profile');

const fromUtility = profileFromChampionName('Samira', 'Support');
ok(fromUtility?.id === 'generic:Samira:Bot', 'Samira UTILITY/Support live role maps to Bot');

const samiraChamp = SNAPSHOT_BUNDLE.champions.find((c) => c.id === 'Samira')!;
const rec = buildRecommendation({
  champion: samiraChamp,
  role: 'Bot',
  items: SNAPSHOT_BUNDLE.items,
});
ok(rec.boots === '3047', `Samira boots are Plated Steelcaps, got ${rec.boots}`);
ok(rec.core[0] === '6676', `Samira first core is Collector, got ${rec.core.join(',')}`);
ok(!rec.core.includes('3032'), 'Samira core excludes Yun Tal Wildarrows');
ok(!rec.core.includes('3006'), 'Samira core list does not include boots id');

if (!process.exitCode) console.log('verify:aram-profile ok');
