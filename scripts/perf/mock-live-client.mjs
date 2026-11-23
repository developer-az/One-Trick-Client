#!/usr/bin/env node
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const o = { port: 2999, startTime: 300, speed: 1, duration: 0, out: './perf-mock-report.json', cert: '', key: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--port') o.port = Number(next());
    else if (a === '--start-time') o.startTime = Number(next());
    else if (a === '--speed') o.speed = Number(next());
    else if (a === '--duration') o.duration = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--cert') o.cert = next();
    else if (a === '--key') o.key = next();
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const t0 = Date.now();
const startedAt = new Date(t0).toISOString();
const stats = new Map();
let inFlight = 0, maxConcurrent = 0, totalRequests = 0, done = false;

const round = (n) => Math.round(n * 100) / 100;
const routePath = (u) => new URL(u, 'https://127.0.0.1').pathname.replace(/\/+$/, '');
const gameSeconds = () => args.startTime + ((Date.now() - t0) / 1000) * args.speed;

function record(p) {
  let s = stats.get(p);
  if (!s) stats.set(p, (s = { count: 0, timestamps: [] }));
  s.count++;
  s.timestamps.push(Date.now());
  totalRequests++;
}

function loadTls() {
  if (args.cert && args.key) return { cert: fs.readFileSync(args.cert), key: fs.readFileSync(args.key) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-live-client-'));
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'crt.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-days', '2', '-keyout', key, '-out', crt], { stdio: 'ignore' });
  } catch (e) {
    console.error('mock-live-client: cannot generate TLS cert; openssl is required (or pass --cert/--key).', e.message);
    process.exit(1);
  }
  return { cert: fs.readFileSync(crt), key: fs.readFileSync(key) };
}

const server = https.createServer(loadTls(), (req, res) => {
  inFlight++;
  if (inFlight > maxConcurrent) maxConcurrent = inFlight;
  const p = routePath(req.url);
  record(p);
  let status = 200, body;
  try {
    body = handle(p, new URL(req.url, 'https://127.0.0.1'));
  } catch (e) {
    status = 404;
    body = { error: String(e && e.message || e) };
  }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body), () => { inFlight--; });
});
server.on('clientError', (_e, sock) => { try { sock.destroy(); } catch { /* ignore */ } });

function writeReport(reason) {
  if (done) return;
  done = true;
  clearInterval(summaryTimer);
  const endpoints = {};
  for (const [p, s] of stats) {
    const diffs = [];
    for (let i = 1; i < s.timestamps.length; i++) diffs.push(s.timestamps[i] - s.timestamps[i - 1]);
    diffs.sort((a, b) => a - b);
    const mean = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    endpoints[p] = {
      count: s.count,
      meanIntervalMs: round(mean),
      p50IntervalMs: diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0,
      minIntervalMs: diffs.length ? diffs[0] : 0,
      maxIntervalMs: diffs.length ? diffs[diffs.length - 1] : 0,
    };
  }
  const report = { startedAt, durationSec: round((Date.now() - t0) / 1000), endpoints, maxConcurrent, totalRequests };
  try {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`[mock] ${reason}; wrote ${args.out}`);
  } catch (e) {
    console.error('[mock] failed to write report:', e.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

const summaryTimer = setInterval(() => {
  const parts = [...stats.entries()].map(([p, s]) => `${p.replace(/^\/liveclientdata\//, '')}=${s.count}`);
  console.log(`[mock] t=${gameSeconds().toFixed(1)}s reqs=${totalRequests} inflight=${inFlight} maxConcurrent=${maxConcurrent} ${parts.join(' ')}`);
}, 10000);
summaryTimer.unref?.();
process.on('SIGINT', () => writeReport('SIGINT'));
process.on('SIGTERM', () => writeReport('SIGTERM'));
if (args.duration > 0) setTimeout(() => writeReport('duration reached'), args.duration * 1000).unref();

server.listen(args.port, '127.0.0.1', () => {
  console.log(`[mock] Live Client mock listening on https://127.0.0.1:${args.port}/liveclientdata (start=${args.startTime}s speed=${args.speed}x)`);
});

// ---- deterministic game state ----
const ROSTER = [
  ['Pyke', 'ORDER', 'UTILITY', 'PykeDiff', 'NA1', 'Ignite', 'Flash', 'Electrocute'],
  ['Garen', 'ORDER', 'TOP', 'GarenGod', 'NA1', 'Flash', 'Teleport', 'Conqueror'],
  ['Ahri', 'ORDER', 'MIDDLE', 'AhriNine', 'NA1', 'Flash', 'Ignite', 'Electrocute'],
  ['Jinx', 'ORDER', 'BOTTOM', 'JinxCarry', 'NA1', 'Flash', 'Heal', 'LethalTempo'],
  ['LeeSin', 'ORDER', 'JUNGLE', 'LeeSinX', 'NA1', 'Flash', 'Smite', 'Conqueror'],
  ['Darius', 'CHAOS', 'TOP', 'DariusBleed', 'EUW', 'Flash', 'Ghost', 'Conqueror'],
  ['Lux', 'CHAOS', 'MIDDLE', 'LuxLaser', 'EUW', 'Flash', 'Barrier', 'ArcaneComet'],
  ['Caitlyn', 'CHAOS', 'BOTTOM', 'CaitTrap', 'EUW', 'Flash', 'Heal', 'FleetFootwork'],
  ['Thresh', 'CHAOS', 'UTILITY', 'ThreshHook', 'EUW', 'Flash', 'Ignite', 'Aftershock'],
  ['Vi', 'CHAOS', 'JUNGLE', 'ViPunch', 'EUW', 'Flash', 'Smite', 'Conqueror'],
];
const ITEMS = {
  3858: { displayName: 'Relic Shield', price: 400 },
  1001: { displayName: 'Boots', price: 300 },
  1036: { displayName: 'Long Sword', price: 350 },
  3176: { displayName: "Caulfield's Warhammer", price: 1050 },
  2003: { displayName: 'Health Potion', price: 50 },
  3074: { displayName: 'Ravenous Hydra', price: 3300 },
  6692: { displayName: 'Eclipse', price: 2900 },
  3158: { displayName: 'Ionian Boots of Lucidity', price: 950 },
};
const SELF_ITEMS = [[0, 3858], [0, 2003], [300, 1001], [640, 3176], [860, 6692]];
const OTHER_ITEMS = [[0, 1036], [0, 2003], [420, 1001], [780, 3074]];
const nameOf = (i) => ROSTER[i][3];
const levelAt = (t) => Math.min(18, 1 + Math.floor(t / 75));

function itemsFor(i, t) {
  const tl = i === 0 ? SELF_ITEMS : OTHER_ITEMS, out = [], seen = new Set();
  for (const [at, id] of tl) {
    if (at > t || seen.has(id)) continue;
    seen.add(id);
    const meta = ITEMS[id] || { displayName: `Item ${id}`, price: 0 };
    out.push({
      itemID: id, displayName: meta.displayName, count: 1, slot: out.length, price: meta.price,
      canUse: true, consumable: id === 2003, rawDisplayName: `generated_item_${id}`,
    });
  }
  return out;
}

function tally(t) {
  const kills = Array(10).fill(0), deaths = Array(10).fill(0), assists = Array(10).fill(0);
  for (let k = 1; 60 * k <= t; k++) {
    const killer = (k - 1) % 10, victim = (k + 3) % 10;
    kills[killer]++; deaths[victim]++;
    if (k % 3 === 0) assists[(k + 6) % 10]++;
  }
  if (t >= 90) { kills[1]++; deaths[4]++; }
  return { kills, deaths, assists };
}

function deadInfo(i, t) {
  for (let k = Math.floor(t / 60); k >= 1; k--) {
    const at = 60 * k;
    if ((k + 3) % 10 === i && t - at < 8) return { isDead: true, respawnTimer: Math.ceil(8 - (t - at)) };
  }
  return { isDead: false, respawnTimer: 0 };
}

const spellObj = (name) => ({ displayName: name, rawDisplayName: `Generated_${name}`, id: name });
function player(i, t, tn) {
  const r = ROSTER[i], lvl = levelAt(t), dead = deadInfo(i, t);
  return {
    championName: r[0], rawChampionName: `game_character_displayname_${r[0]}`,
    riotId: `${r[3]}#${r[4]}`, riotIdGameName: r[3], riotIdTagLine: r[4], summonerName: r[3],
    team: r[1], position: r[2], level: lvl, isDead: dead.isDead, respawnTimer: dead.respawnTimer, isBot: false,
    items: itemsFor(i, t),
    scores: {
      kills: tn.kills[i], deaths: tn.deaths[i], assists: tn.assists[i],
      creepScore: Math.floor(t / 60) * (3 + (i % 5)) + i * 2, wardScore: Math.floor(t / 120) * (i === 0 ? 2 : 1),
    },
    summonerSpells: { summonerSpellOne: spellObj(r[5]), summonerSpellTwo: spellObj(r[6]) },
    runes: {
      keystone: { displayName: r[7], id: 8000 + i },
      mainRunes: { displayName: r[1] === 'ORDER' ? 'Precision' : 'Domination', id: 8000 },
      subRunes: { displayName: r[1] === 'ORDER' ? 'Sorcery' : 'Resolve', id: 8200 },
    },
  };
}

const ABILITY_NAMES = [
  ['Passive', 'Gift of the Drowned Ones'], ['Q', 'Bone Skewer'], ['W', 'Ghostwater Dive'],
  ['E', 'Phantom Undertow'], ['R', 'Death from Below'],
];
function abilities(t) {
  const lv = levelAt(t), out = {};
  ABILITY_NAMES.forEach(([key, label], n) => {
    const lvl = n === 0 ? Math.min(1, Math.floor(lv / 2)) : Math.max(0, Math.min(5, Math.floor((lv - n) / 3) + 1));
    out[key] = { abilityLevel: lvl, displayName: label, id: `Pyke${key}`, rawDescription: `Generated ${label} description.` };
  });
  return out;
}
function fullRunes() {
  return {
    generalRunes: [{ displayName: 'Electrocute', id: 8112 }],
    keystone: { displayName: 'Electrocute', id: 8112 },
    mainRunes: { displayName: 'Domination', id: 8100 },
    subRunes: { displayName: 'Sorcery', id: 8200 },
    statRunes: [{ id: 5008 }, { id: 5008 }, { id: 5002 }],
  };
}
function activePlayer(t) {
  const p = player(0, t, tally(t)), lv = p.level;
  const maxHealth = 500 + lv * 90, maxResource = 300 + lv * 40;
  const hp = p.isDead ? 0 : maxHealth - Math.floor((t * 7) % (maxHealth * 0.4));
  return {
    riotId: p.riotId, summonerName: p.summonerName, level: lv,
    currentGold: Math.floor(500 + Math.min(t, 3600) * 6),
    championStats: {
      currentHealth: hp, maxHealth, resourceValue: p.isDead ? 0 : maxResource - Math.floor((t * 3) % (maxResource * 0.5)),
      resourceMax: maxResource, resourceType: 'MANA', armor: 30 + lv * 3, magicResist: 30 + lv * 1.5,
      attackDamage: 60 + lv * 4, abilityPower: 0, moveSpeed: 340, critChance: 0, attackSpeed: 0.65,
    },
    abilities: abilities(t), fullRunes: fullRunes(),
  };
}

function eventsUpTo(t) {
  const ev = [];
  const add = (time, name, extra = {}) => { if (time <= t) ev.push({ EventTime: time, EventName: name, ...extra }); };
  add(0, 'GameStart');
  add(65, 'MinionsSpawning');
  add(90, 'FirstBlood', { KillerName: nameOf(1), VictimName: nameOf(4), Assisters: [] });
  for (let k = 1; 60 * k <= t; k++) {
    add(60 * k, 'ChampionKill', {
      KillerName: nameOf((k - 1) % 10), VictimName: nameOf((k + 3) % 10),
      Assisters: k % 3 === 0 ? [nameOf((k + 6) % 10)] : [],
    });
  }
  add(360, 'DragonKill', { KillerName: nameOf(4), DragonType: 'Fire', Stolen: false });
  add(840, 'HeraldKill', { KillerName: nameOf(4), Stolen: false });
  add(900, 'TurretKilled', { KillerName: nameOf(3), TurretKilled: 'Turret_Order_T1', Team: 'CHAOS' });
  ev.sort((a, b) => a.EventTime - b.EventTime);
  return ev.map((e, i) => ({ EventID: i + 1, ...e }));
}

const gameData = (t) => ({ gameMode: 'CLASSIC', gameTime: t, mapName: 'Map11', mapNumber: 11, mapTerrain: 'Default' });

function handle(p, url) {
  const t = gameSeconds(), tn = tally(t), players = ROSTER.map((_, i) => player(i, t, tn));
  const sub = p.replace(/^\/liveclientdata\/?/, '');
  const pick = () => {
    const q = (url.searchParams.get('riotId') || '').toLowerCase();
    if (!q) return players[0];
    return players.find((x) => x.riotId.toLowerCase() === q || x.riotIdGameName.toLowerCase() === q || x.summonerName.toLowerCase() === q) || players[0];
  };
  switch (sub) {
    case 'allgamedata': return { activePlayer: activePlayer(t), allPlayers: players, events: { Events: eventsUpTo(t) }, gameData: gameData(t) };
    case 'activeplayer': return activePlayer(t);
    case 'activeplayername': return players[0].riotIdGameName;
    case 'activeplayerabilities': return abilities(t);
    case 'activeplayerrunes': return fullRunes();
    case 'playerlist': return players;
    case 'playerscores': return pick().scores;
    case 'playersummonerspells': return pick().summonerSpells;
    case 'playermainrunes': {
      const r = pick().runes;
      return { mainRunes: r.mainRunes, subRunes: r.subRunes, keystone: r.keystone };
    }
    case 'playeritems': return pick().items;
    case 'eventdata': return { Events: eventsUpTo(t) };
    case 'gamestats': return gameData(t);
    default: throw new Error(`unknown endpoint ${p}`);
  }
}
