/**
 * Ranked / Summoner's Rift guardrails — Mayhem and ARAM-only paths must stay isolated.
 */
import { ingestChampionCatalog } from './src/data/championCatalog';
import { SNAPSHOT_BUNDLE } from './src/catalog/snapshot';
import { resolveProfileId } from './src/overlay/overlayLogic';
import { isAramOrMayhem, isMayhemGame } from './src/logic/mayhem/mode';
import { isMayhemAugmentHudVisible } from './src/logic/mayhem/visibility';
import { DEFAULT_HUD_MODULES } from './src/overlay/hudModules';

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

ok(!isMayhemGame('CLASSIC', 'Summoners Rift'), 'ranked SR is not Mayhem');
ok(!isMayhemGame('RANKED', 'Summoners Rift'), 'RANKED mode string is not Mayhem');
ok(isMayhemGame('KIWI', 'Howling Abyss'), 'KIWI ARAM Mayhem detected');
ok(!isAramOrMayhem('CLASSIC', 'Summoners Rift'), 'SR classic is not ARAM');
ok(isAramOrMayhem('ARAM', 'Howling Abyss'), 'classic ARAM map detected');

const yoneMid = resolveProfileId({
  inGame: true,
  gameMode: 'CLASSIC',
  mapName: 'Summoners Rift',
  gameTime: 600,
  localPlayer: {
    championName: 'Yone',
    position: 'MIDDLE',
    level: 8,
    items: [],
  },
});
ok(yoneMid === 'yone-mid', `ranked Yone mid profile (${yoneMid})`);

ok(!isMayhemAugmentHudVisible([], false), 'no augment HUD while playing SR');
ok(DEFAULT_HUD_MODULES.mayhem === false, 'Mayhem overlay module off by default (opt-in beta)');

if (!process.exitCode) console.log('verify:ranked ok');
