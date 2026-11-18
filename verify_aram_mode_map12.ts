/**
 * ARAM/Mayhem mode detection — Live Client reports Map12 for Howling Abyss
 * and Map11 for Summoner's Rift. Mayhem is KIWI/MAYHEM only; classic ARAM
 * must never fall through to Mayhem.
 */
import { isAramMap, isAramOrMayhem, isMayhemGame } from './src/logic/mayhem/mode';

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('ok', m);
};

ok(isAramMap('Map12'), 'Map12 is ARAM (Howling Abyss)');
ok(isAramMap('Howling Abyss'), 'Howling Abyss legacy alias is ARAM');
ok(!isAramMap('Map11'), "Map11 is Summoner's Rift, not ARAM");

ok(isMayhemGame('KIWI', 'Map12'), 'KIWI on Map12 is Mayhem');
ok(isMayhemGame('KIWI', 'Howling Abyss'), 'KIWI on Howling Abyss is Mayhem');
ok(!isMayhemGame('ARAM', 'Map12'), 'classic ARAM on Map12 is not Mayhem');
ok(!isMayhemGame('ARAM', 'Howling Abyss'), 'classic ARAM on Howling Abyss is not Mayhem');

ok(!isAramOrMayhem('CLASSIC', "Summoner's Rift"), 'SR classic is not ARAM/Mayhem');
ok(isAramOrMayhem('ARAM', 'Map12'), 'classic ARAM Map12 is ARAM/Mayhem');
ok(isAramOrMayhem('KIWI', 'Map12'), 'Mayhem KIWI Map12 is ARAM/Mayhem');

if (!process.exitCode) console.log('verify:aram-mode ok');
