#!/usr/bin/env node
// Passive recorder for League's Live Client Data API. Read-only GETs, no host
// other than 127.0.0.1, no game input. Anonymizes player names before writing.
import https from 'node:https';
import { createGzip } from 'node:zlib';
import { createWriteStream, mkdirSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function parseArgs(argv) {
  const o = { interval: 2000, maxMinutes: 90, port: 2999, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--interval') o.interval = Math.max(100, Number(next()) || 2000);
    else if (a === '--max-minutes') o.maxMinutes = Math.max(0, Number(next()) || 90);
    else if (a === '--port') o.port = Number(next()) || 2999;
    else if (a === '--out-dir') o.outDir = next();
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/perf/record-live-client.mjs [--interval ms] [--max-minutes n] [--port n] [--out-dir dir]');
      process.exit(0);
    }
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = args.outDir ? path.resolve(args.outDir) : path.join(repoRoot, 'recordings');
const deadline = Date.now() + args.maxMinutes * 60000;
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const names = new Map();

let stopping = false, stopPromise = null;
let gzip = null, outPath = '', pipePromise = null, bytes = 0;
let snapshots = 0, eventCount = 0, lastGameTime = 0;
let lastLevel = null, lastAbilitiesAt = 0, lastSuccessAt = 0, statusTimer = null;

function getJson(endpoint, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: '127.0.0.1', port: args.port, path: `/liveclientdata/${endpoint}`,
      agent, rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function identity(p) {
  return p && (p.riotId || p.summonerName || p.riotIdGameName) || '';
}

function buildNameMap(g) {
  const active = g.activePlayer || {};
  const players = Array.isArray(g.allPlayers) ? g.allPlayers : [];
  let activeKey = identity(active);
  if (!players.some((p) => activeKey && identity(p) === activeKey)) activeKey = identity(players[0]);
  let next = 2;
  const add = (value, replacement, force = false) => {
    if (typeof value === 'string' && value && (force || !names.has(value))) names.set(value, replacement);
  };
  for (const p of players) {
    const self = !!(activeKey && identity(p) === activeKey);
    const replacement = self ? 'Self' : `Player${next++}`;
    for (const key of ['riotId', 'summonerName', 'riotIdGameName']) add(p[key], replacement, self);
    add(p.riotIdTagLine, 'ANON');
  }
  for (const key of ['riotId', 'summonerName', 'riotIdGameName']) add(active[key], 'Self', true);
  add(active.riotIdTagLine, 'ANON');
}

function anonymize(value) {
  if (typeof value === 'string') return names.has(value) ? names.get(value) : value;
  if (Array.isArray(value)) return value.map(anonymize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = anonymize(value[key]);
    return out;
  }
  return value;
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function timestampName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(value, fallback) {
  return String(value || fallback).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function openOutput(g) {
  mkdirSync(outDir, { recursive: true });
  const mode = safeName(g.gameData && g.gameData.gameMode, 'UNKNOWN');
  const champion = safeName(g.activePlayer?.championName || (g.allPlayers || []).find((x) => identity(x) === identity(g.activePlayer))?.championName, 'Unknown');
  outPath = path.join(outDir, `${timestampName()}-${mode}-${champion}.jsonl.gz`);
  gzip = createGzip({ level: 6 });
  gzip.on('data', (chunk) => { bytes += chunk.length; });
  pipePromise = pipeline(gzip, createWriteStream(outPath));
  pipePromise.catch((e) => console.error('[record] output error:', e.message));
}

function writeLine(value) {
  if (gzip) gzip.write(`${JSON.stringify(value)}\n`);
}

async function handleSnapshot(raw, t) {
  if (!gzip) openOutput(raw);
  buildNameMap(raw);
  const data = anonymize(raw);
  const gameTime = typeof data.gameData?.gameTime === 'number' ? data.gameData.gameTime : 0;
  writeLine({ t, gameTime, data });
  snapshots++;
  lastGameTime = gameTime;
  eventCount = Array.isArray(data.events?.Events) ? data.events.Events.length : 0;

  const level = data.activePlayer?.level;
  if (lastLevel === null || level !== lastLevel || Date.now() - lastAbilitiesAt >= 30000) {
    try {
      const abilities = await getJson('activeplayerabilities', 5000);
      if (!stopping) writeLine({ t: Date.now(), gameTime, abilities: anonymize(abilities) });
      lastLevel = level;
      lastAbilitiesAt = Date.now();
    } catch { /* retry on the next snapshot */ }
  }
}

function reportStatus() {
  if (!gzip) return;
  console.log(`recording  ${fmtTime(lastGameTime)}  ${snapshots} snapshots  ${eventCount} events  ${Math.round(bytes / 1024)} KB`);
}

function stop(reason) {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
    if (gzip) {
      try { gzip.end(); await pipePromise; }
      catch (e) { console.error('[record] finalize failed:', e.message); }
    }
    agent.destroy();
    if (snapshots > 0 && outPath) {
      console.log(`SAVED ${outPath}  (${snapshots} snapshots, ${fmtTime(lastGameTime)} of game, ${Math.round(bytes / 1024)} KB)`);
    } else {
      if (outPath) { try { unlinkSync(outPath); } catch { /* ignore */ } }
      console.log('nothing recorded (no match seen)');
    }
  })();
  return stopPromise;
}

async function waitForMatch() {
  console.log('waiting for a match…');
  let dots = false, lastDotAt = Date.now();
  while (!stopping) {
    if (Date.now() >= deadline) { await stop('max time'); return; }
    const started = Date.now();
    try {
      const gs = await getJson('gamestats', 2000);
      if (gs && typeof gs.gameTime === 'number') {
        if (dots) process.stdout.write('\n');
        return;
      }
    } catch { /* keep waiting */ }
    if (Date.now() - lastDotAt >= 30000) {
      process.stdout.write('.');
      dots = true;
      lastDotAt = Date.now();
    }
    await delay(Math.max(0, 5000 - (Date.now() - started)));
  }
}

async function recordLoop() {
  lastSuccessAt = Date.now();
  statusTimer = setInterval(reportStatus, 30000);
  while (!stopping) {
    if (Date.now() >= deadline) { await stop('max time'); return; }
    const started = Date.now();
    try {
      const data = await getJson('allgamedata', 5000);
      lastSuccessAt = Date.now();
      if (!stopping) await handleSnapshot(data, Date.now());
    } catch {
      if (Date.now() - lastSuccessAt >= 20000) { await stop('game closed'); return; }
    }
    if (Date.now() >= deadline) { await stop('max time'); return; }
    await delay(Math.max(0, args.interval - (Date.now() - started)));
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(sig); });
try {
  await waitForMatch();
  if (!stopping) await recordLoop();
} catch (e) {
  console.error('[record] unexpected error:', e.message);
  process.exitCode = 1;
} finally {
  await stop('done');
}
