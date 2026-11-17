#!/usr/bin/env node
/**
 * Loading → game handoff guard (Review round 2 on 5e90148).
 *
 * Mounts the REAL `src/overlay/OverlayApp.tsx` in an offscreen Electron page
 * (bundled from source with esbuild, with the production CSS: index/tokens/
 * overlay-theme/hud-skins) and a fake `window.electronAPI` feeding the real
 * overlay-update channel. It drives one load → first in-game frame:
 *
 *   1. the loading card is present, effectively visible and painted on the
 *      loading payload;
 *   2. every sampled frame has visible content measured by EFFECTIVE opacity
 *      (the element's own computed opacity multiplied through every ancestor),
 *      never by the container alone;
 *   3. the loading card, its pet canvas and the loading layer keep the same DOM
 *      nodes through the handoff (no remount into another subtree);
 *   4. a POPULATED production HUD module (the chrome ability frame) becomes
 *      effectively visible while the loading card is still painted, and ends
 *      at opacity 1; the loading layer eventually unmounts;
 *   5. reduced motion disables both opacity transitions and finishes fast.
 *
 * No `npm run build` needed: the page is bundled from source.
 * Run `npm run verify:overlay-handoff` (also invoked by verify:real-game).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(path.join(root, 'package.json'));

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};

/**
 * Bare imports are resolved with Node's own resolver: this machine has a Yarn
 * Plug'n'Play manifest above the home directory, which esbuild would otherwise
 * apply to every bare specifier and refuse ("not listed as a dependency").
 * Handing esbuild absolute paths keeps the bundle identical.
 */
const nodeModulesPlugin = {
  name: 'node-modules',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      try {
        return { path: nodeRequire.resolve(args.path) };
      } catch {
        return null;
      }
    });
  },
};

// The driver runs inside the page: it defines the fake electron API before
// React mounts, feeds the real overlay-update listener, samples the DOM every
// animation frame and parks the result on window.__hudDomResult.
const entry = `
import './src/index.css';
import './src/app/tokens.css';
import './src/overlay/overlay-theme.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayApp } from './src/overlay/OverlayApp';

const page = window as any;
const reduced = page.__HANDOFF_REDUCED === true;
if (reduced) {
  page.matchMedia = (query: string) => ({
    matches: /reduce/.test(query),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

const reports: boolean[] = [];
let pushUpdate: ((payload: unknown) => void) | null = null;
const noop = () => Promise.resolve({ success: true });

page.electronAPI = {
  onOverlayUpdate: (cb: (payload: unknown) => void) => {
    pushUpdate = cb;
    return () => {
      pushUpdate = null;
    };
  },
  onOverlayMeta: () => () => {},
  getOverlayStatus: () =>
    Promise.resolve({
      success: true,
      clickThrough: true,
      alignMode: false,
      hudScale: 20,
      mapScale: 33,
      chromeColor: '#e8b84a',
      overlayTextScale: 1,
      gameWidth: 1920,
      gameHeight: 1080,
      displayWidth: 1280,
      displayHeight: 800,
      slot: { id: 'slot-center', originX: 0, originY: 0, moduleIds: ['frames', 'mayhem', 'vision', 'buy'], stickerIds: [], mode: 'locked' },
      hudModules: { sums: true, gank: true, vision: true, buy: true, action: true, mayhem: false, frames: true },
      pet: {},
    }),
  getCatalog: () =>
    Promise.resolve({
      success: true,
      catalog: {
        manifest: { patch: '0.0.0', generatedAt: 'harness' },
        champions: [{ id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage'], roles: ['Mid'], damageType: 'Magic' }],
        items: [],
        runes: [],
        recommendations: [],
        profiles: [],
      },
    }),
  reportOverlayContent: (value: boolean) => reports.push(value),
  reportOverlayHeartbeat: () => {},
  toggleOverlay: noop,
  toggleOverlayClickThrough: noop,
  setOverlayAlignMode: noop,
  adjustOverlayCalibration: noop,
  resetOverlayCalibration: noop,
  syncLeagueScales: noop,
};
// No network in the harness: the catalog stub above is the whole catalog.
page.fetch = () => Promise.reject(new Error('offline harness'));

const container = document.createElement('div');
container.id = 'root';
document.body.appendChild(container);
createRoot(container).render(React.createElement(OverlayApp));

const frames = (n = 1) =>
  new Promise<void>((resolve) => {
    let seen = 0;
    const step = () => {
      seen += 1;
      if (seen >= n) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const layerEl = () => document.querySelector('[data-ov-loading-layer]') as HTMLElement | null;
const hudEl = () => document.querySelector('[data-ov-hud-root]') as HTMLElement | null;
const cardEl = () => document.querySelector('[data-ov-loading-layer] .ov-loading-card') as HTMLElement | null;
const petEl = () => document.querySelector('[data-ov-loading-layer] canvas') as HTMLElement | null;
const hudModuleEl = () =>
  document.querySelector('[data-ov-hud-root] .chrome-frame-ability') as HTMLElement | null;

// The only honest visibility measure: the element's own opacity times every
// ancestor's, with hidden/none ancestors collapsing to zero.
const effectiveOpacity = (el: HTMLElement | null): number => {
  if (!el) return 0;
  let value = 1;
  let node: HTMLElement | null = el;
  while (node && node.nodeType === 1) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return 0;
    const own = Number(style.opacity);
    value *= Number.isFinite(own) ? own : 1;
    node = node.parentElement;
  }
  return value;
};
const paintBox = (el: HTMLElement | null) => {
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (!el.getClientRects().length || rect.width <= 0.5 || rect.height <= 0.5) return null;
  return { w: Number(rect.width.toFixed(1)), h: Number(rect.height.toFixed(1)) };
};
const round3 = (value: number) => Number(value.toFixed(3));

const sample = () => {
  const layer = layerEl();
  const hud = hudEl();
  const card = cardEl();
  const module = hudModuleEl();
  return {
    layer: !!layer,
    hud: !!hud,
    layerOpacity: layer ? round3(effectiveOpacity(layer)) : null,
    hudOpacity: hud ? round3(effectiveOpacity(hud)) : null,
    layerTransition: layer ? layer.style.transition || '' : '',
    hudTransition: hud ? hud.style.transition || '' : '',
    cardPresent: !!card,
    cardEffective: card ? round3(effectiveOpacity(card)) : null,
    cardBox: card ? paintBox(card) : null,
    modulePresent: !!module,
    moduleEffective: module ? round3(effectiveOpacity(module)) : null,
    moduleBox: module ? paintBox(module) : null,
  };
};

const pet = { enabled: true };
const loadingSlot = { source: 'gameflow-session', side: 'blue', index: 0, teamSize: 5 };
const loadingPayload = {
  inGame: true,
  loading: true,
  gameflowPhase: 'GameStart',
  gameTime: 0,
  championId: 103,
  championName: 'Ahri',
  loadingStats: { games: 4, winRate: 50, streak: null, kda: 3.1, form: ['W', 'L', 'W', 'W'], scope: 'aram' },
  loadingSlot,
  queueId: 450,
  mapId: 12,
  pet,
  timestamp: Date.now(),
};
const inGamePayload = {
  inGame: true,
  loading: false,
  gameflowPhase: 'InProgress',
  gameTime: 25,
  gameMode: 'ARAM',
  mapName: 'Map12',
  mapId: 12,
  queueId: 450,
  championId: 103,
  localPlayer: {
    championName: 'Ahri',
    level: 3,
    isDead: false,
    items: [],
    position: 'MIDDLE',
    scores: { kills: 0, deaths: 0, assists: 0 },
  },
  enemies: [],
  allies: [],
  pet,
  timestamp: Date.now(),
};

async function run() {
  const result: any = { reduced, samples: [], reported: reports };
  try {
    await frames(6);
    if (!pushUpdate) throw new Error('OverlayApp never subscribed to overlay updates');
    reports.length = 0;
    pushUpdate(loadingPayload);
    await frames(8);
    result.loading = sample();
    const cardNode = cardEl();
    const petNode = petEl();
    const initialLayerNode = layerEl();
    result.cardPresentAtStart = !!cardNode;
    result.petPresentAtStart = !!petNode;
    result.layerPresentAtStart = !!initialLayerNode;

    pushUpdate(inGamePayload);
    const started = performance.now();
    const limit = reduced ? 400 : 900;
    while (performance.now() - started < limit) {
      await frames(1);
      result.samples.push({
        t: Math.round(performance.now() - started),
        ...sample(),
        sameCardNode: cardNode ? cardEl() === cardNode : false,
        samePetNode: petNode ? petEl() === petNode : false,
        sameLayerNode: initialLayerNode ? layerEl() === initialLayerNode : false,
      });
      if (!reduced && result.samples.length > 20 && !layerEl()) break;
    }
    await frames(3);
    result.end = sample();
    result.cardNodesStillConnected = cardNode ? cardNode.isConnected : false;
    result.petNodesStillConnected = petNode ? petNode.isConnected : false;
  } catch (error) {
    result.error = String(error);
  }
  result.reported = [...reports];
  page.__hudDomResult = result;
}

void run();
`;

let bundle;
try {
  bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'handoff-entry.tsx', loader: 'tsx' },
    bundle: true,
    write: false,
    outfile: 'handoff-bundle.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"/"' },
    plugins: [nodeModulesPlugin],
    logLevel: 'silent',
  });
} catch (error) {
  console.error('could not bundle OverlayApp:', String(error));
  process.exit(1);
}
const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text || '';
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '';
if (!js || !css) {
  console.error('the harness bundle is missing its JS or production CSS');
  process.exit(1);
}

const pageHtml = (reduced) => `<!doctype html>
<html lang="en" class="overlay-root"><head><meta charset="UTF-8" />
<style>${css}</style>
<style>html, body { margin: 0; background: #101014; }</style></head>
<body><script>window.__HANDOFF_REDUCED = ${reduced ? 'true' : 'false'};</script>
<script>${js}</script></body></html>`;

const host = path.join(root, 'scripts', 'hud-skins-dom-main.cjs');

function runPage(reduced) {
  const pagePath = path.join(os.tmpdir(), `onetrick-handoff-${reduced ? 'reduced' : 'normal'}-${process.pid}.html`);
  fs.writeFileSync(pagePath, pageHtml(reduced), 'utf8');
  try {
    const child = spawnSync(electronPath, [host], {
      cwd: root,
      env: { ...process.env, HUD_DOM_PAGE: pagePath },
      encoding: 'utf8',
      timeout: 90000,
    });
    const output = `${child.stdout || ''}\n${child.stderr || ''}`;
    const line = output.split(/\r?\n/).find((row) => row.startsWith('HUD_DOM_RESULT '));
    if (!line) {
      console.error('no HUD_DOM_RESULT from Electron offscreen renderer');
      console.error(output.slice(-2000));
      return null;
    }
    return JSON.parse(line.slice('HUD_DOM_RESULT '.length));
  } finally {
    try {
      fs.unlinkSync(pagePath);
    } catch {
      /* ignore */
    }
  }
}

function checkNormal(result) {
  if (!result || result.error) {
    ok(false, `overlay page mounted and drove a handoff (${result?.error || 'no result'})`);
    return;
  }
  ok(!!result.loading && result.cardPresentAtStart, 'the loading card is on screen during the load');
  ok(!!result.petPresentAtStart, 'the loading pet canvas is on screen during the load');
  ok(
    result.loading.cardEffective > 0.99 && !!result.loading.cardBox,
    `the loading card is effectively visible and painted (${result.loading.cardEffective}, ${JSON.stringify(result.loading.cardBox)})`
  );
  ok(result.loading.hud === false, 'the HUD is not drawn during the load');
  const samples = result.samples || [];
  ok(samples.length >= 5, `the handoff was sampled frame by frame (${samples.length} frames)`);
  const crossfade = samples.filter((s) => (s.cardEffective || 0) > 0.2 && (s.moduleEffective || 0) > 0.2);
  ok(crossfade.length > 0, 'a populated HUD module and the loading card are both effectively visible during the handoff');
  const gaps = samples.filter(
    (s) => Math.max(s.cardEffective || 0, s.moduleEffective || 0) <= 0.05
  );
  ok(gaps.length === 0, `effective content is visible at every handoff frame (gaps=${gaps.length})`);
  const cardRemounts = samples.filter((s) => s.layer && !s.sameCardNode);
  ok(cardRemounts.length === 0, `the loading card is never remounted during the handoff (remounts=${cardRemounts.length})`);
  const petRemounts = samples.filter((s) => s.layer && !s.samePetNode);
  ok(petRemounts.length === 0, `the pet canvas node is retained across loading → handoff (remounts=${petRemounts.length})`);
  const layerReplaced = samples.filter((s) => s.layer && !s.sameLayerNode);
  ok(layerReplaced.length === 0, 'the loading layer keeps one DOM node until it unmounts');
  const moduleWithoutBox = samples.filter((s) => s.modulePresent && !s.moduleBox);
  ok(moduleWithoutBox.length === 0, `the populated HUD module paints a real box every frame (missing=${moduleWithoutBox.length})`);
  ok(result.end && !result.end.layer, 'the loading layer unmounts after the fade');
  ok(result.end && !result.end.cardPresent, 'the loading card is gone once the handoff finishes');
  ok(
    result.end && result.end.modulePresent && result.end.moduleEffective >= 0.99 && !!result.end.moduleBox,
    `the populated HUD module ends effectively visible at opacity 1 (${result.end?.moduleEffective})`
  );
  ok(!result.cardNodesStillConnected && !result.petNodesStillConnected, 'the loading card/pet are unmounted once the handoff finishes');
  ok((result.reported || []).length > 0 && (result.reported || []).every(Boolean), 'content stays reported through the whole handoff');
  ok(samples.some((s) => /200ms/.test(s.hudTransition || '')), 'the HUD fades in over 200 ms');
  ok(samples.some((s) => /250ms/.test(s.layerTransition || '')), 'the loading layer fades out over 250 ms');
}

function checkReduced(result) {
  if (!result || result.error) {
    ok(false, `the reduced-motion page mounted (${result?.error || 'no result'})`);
    return;
  }
  const samples = result.samples || [];
  const done = samples.find((s) => !s.layer && s.moduleEffective >= 0.99);
  ok(!!done && done.t <= 200, `reduced motion finishes the handoff fast (${done ? done.t : 'never'} ms)`);
  const transitions = samples.filter((s) => s.layer && s.hud && (s.hudTransition || s.layerTransition));
  ok(transitions.length === 0, 'reduced motion disables both opacity transitions');
  const gaps = samples.filter((s) => Math.max(s.cardEffective || 0, s.moduleEffective || 0) <= 0.05);
  ok(gaps.length === 0, `effective content is visible at every reduced-motion frame (gaps=${gaps.length})`);
  ok(
    result.end && !result.end.layer && result.end.moduleEffective >= 0.99,
    `reduced motion still lands on the HUD at opacity 1 (${result.end?.moduleEffective})`
  );
}

console.log('--- verify:overlay-handoff: normal fade ---');
checkNormal(runPage(false));
console.log('--- verify:overlay-handoff: reduced motion ---');
checkReduced(runPage(true));

if (failures > 0) {
  console.error(`verify:overlay-handoff FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('verify:overlay-handoff ok');
