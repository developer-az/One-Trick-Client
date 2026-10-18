import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as summoner from './electron/summoner-tracker';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

const sp = (a: string, b: string) => ({
  summonerSpellOne: { displayName: a },
  summonerSpellTwo: { displayName: b },
});

// --- Flash toggle logic (same path Page Up / Page Down use) ---
summoner.resetSummonerTracker();
summoner.ingestLivePlayers([
  { championName: 'Caitlyn', position: 'BOTTOM', summonerSpells: sp('Flash', 'Heal') },
  { championName: 'Lux', position: 'UTILITY', summonerSpells: sp('Flash', 'Exhaust') },
  { championName: 'Zed', position: 'MIDDLE', summonerSpells: sp('Flash', 'Ignite') },
]);
const flashBot = summoner.toggleSpellUsed('Bot', 'Flash');
ok(flashBot.success && flashBot.active, 'PageUp path: Bot Flash toggles on');
const flashBot2 = summoner.toggleSpellUsed('Bot', 'Flash');
ok(flashBot2.success && !flashBot2.active, 'PageUp path: Bot Flash toggles off');
const flashSup = summoner.toggleSpellUsed('Support', 'Flash');
ok(flashSup.success, 'PageDown path: Support Flash toggles');
ok(summoner.toggleSpellUsed('Support', 'Exhaust').success, 'PageDown lane (Support) second spell toggles');
ok(summoner.toggleSpellUsed('Bot', 'Heal').success, 'PageUp lane (Bot) second spell still independent');

summoner.setSummonerFocus('mid');
summoner.resetSummonerTracker();
summoner.ingestLivePlayers([
  { championName: 'Yone', position: 'MIDDLE', summonerSpells: sp('Flash', 'Ignite') },
]);
ok(summoner.toggleSpellUsed('Mid', 'Flash').success, 'mid focus: PageUp Mid Flash');
ok(summoner.toggleSpellUsed('Mid', 'Ignite').success, 'mid focus: PageDown Ignite');

async function testNativeHelper(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('skip native keyhook (non-Windows)');
    return;
  }
  const exe = path.join(root, 'native', 'bin', 'onetrick-keys.exe');
  ok(fs.existsSync(exe), 'onetrick-keys.exe present');
  if (!fs.existsSync(exe)) return;

  const events: string[] = [];
  const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  proc.stdout.setEncoding('ascii');
  proc.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const t = line.trim();
      if (t === 'P' || t === 'S') events.push(t);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('hook ready timeout')), 5000);
    proc.stdout.on('data', (c: string) => {
      if (c.includes('R')) {
        clearTimeout(t);
        resolve();
      }
    });
  });

  await new Promise((r) => setTimeout(r, 300));
  const inject = path.join(root, 'scripts', 'inject-test-keys.ps1');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${inject}"`, {
    cwd: root,
    stdio: 'pipe',
  });
  await new Promise((r) => setTimeout(r, 600));

  try {
    proc.stdin?.end();
  } catch {
    /* ignore */
  }
  proc.kill();

  ok(events.includes('P'), `native hook saw PageUp (events: ${events.join(',')})`);
  ok(events.includes('S'), `native hook saw PageDown (events: ${events.join(',')})`);
}

void testNativeHelper().then(() => {
  if (!process.exitCode) console.log('verify:global-hotkeys ok');
});
