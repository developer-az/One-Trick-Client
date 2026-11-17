#!/usr/bin/env node
/**
 * Loading → game handoff guard (Review fixes on 1b6173e).
 *
 * Mounts the REAL `src/overlay/OverlayApp.tsx` in an offscreen Electron page
 * (bundled from source with esbuild, a fake `window.electronAPI` feeding the
 * real overlay-update channel) and drives one load → first in-game frame:
 *
 *   1. the loading card is present and opaque on the loading payload;
 *   2. every sampled frame of the handoff has visible content: either the
 *      loading layer or the HUD is above half opacity — never both hidden;
 *   3. the loading layer and the loading card/pet keep the same DOM nodes
 *      through the handoff (no remount into another subtree);
 *   4. the handoff eventually unmounts the loading layer and lands the HUD at
 *      opacity 1 while `reportOverlayContent(true)` stayed true throughout;
 *   5. reduced motion disables both opacity transitions and finishes fast.
 *
 * No build is required: the page is bundled from source and needs no CSS.
 * Run `npm run verify:real-game` (it invokes this) or `node scripts/verify-overlay-handoff.mjs`.
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
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};

const cssStub = {
  name: 'css-stub',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
  },
};

// The driver runs inside the page: it defines the fake electron API before
// React mounts, feeds the real overlay-update listener, samples the DOM every
// animation frame and parks the result on window.__hudDomResult.
const entry = `
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
const opacityOf = (el: HTMLElement | null) => (el ? Number(getComputedStyle(el).opacity) : null);
const sample = () => ({
  layer: !!layerEl(),
  hud: !!hudEl(),
  layerOpacity: opacityOf(layerEl()),
  hudOpacity: opacityOf(hudEl()),
  layerTransition: layerEl() ? layerEl()!.style.transition || '' : '',
  hudTransition: hudEl() ? hudEl()!.style.transition || '' : '',
});

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
  localPlayer: { championName: 'Ahri', level: 3, isDead: false, items: [], position: 'MIDDLE', scores: { kills: 0, deaths: 0, assists: 0 } },
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
    await frames(6);
    result.loading = sample();
    result.cardPresent = !!document.querySelector('.ov-loading-card');
    const cardNode = document.querySelector('.ov-loading-card');
    const initialLayerNode = layerEl();
    result.layerPresentAtStart = !!initialLayerNode;

    pushUpdate(inGamePayload);
    const started = performance.now();
    const limit = reduced ? 400 : 900;
    while (performance.now() - started < limit) {
      await frames(1);
      result.samples.push({
        t: Math.round(performance.now() - started),
        ...sample(),
        sameCardNode: cardNode ? cardNode.isConnected : false,
        sameLayerNode: initialLayerNode ? layerEl() === initialLayerNode : false,
      });
      if (!reduced && result.samples.length > 20 && !layerEl()) break;
    }
    await frames(3);
    result.end = sample();
    result.cardNodesStillConnected = cardNode ? cardNode.isConnected : false;
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
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"/"' },
    plugins: [nodeModulesPlugin, cssStub],
    logLevel: 'silent',
  });
} catch (error) {
  console.error('could not bundle OverlayApp:', String(error));
  process.exit(1);
}
const code = bundle.outputFiles[0].text;
const pageHtml = (reduced) => `<!doctype html>
<html lang="en" class="overlay-root"><head><meta charset="UTF-8" />
<style>html, body { margin: 0; background: #101014; }</style></head>
<body><script>window.__HANDOFF_REDUCED = ${reduced ? 'true' : 'false'};</script>
<script>${code}</script></body></html>`;

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
  ok(!!result.loading && result.cardPresent, 'the loading card is on screen during the load');
  ok(result.loading.layerOpacity === 1 && result.loading.hud === false, 'the loading layer is opaque and the HUD is not drawn yet');
  const samples = result.samples || [];
  ok(samples.length >= 5, `the handoff was sampled frame by frame (${samples.length} frames)`);
  const crossfade = samples.filter((s) => s.layer && s.hud);
  ok(crossfade.length > 0, 'the loading layer and the HUD overlap during the handoff');
  const visibleGaps = samples.filter(
    (s) => !(s.layer && (s.layerOpacity ?? 0) > 0.5) && !(s.hud && (s.hudOpacity ?? 0) > 0.5)
  );
  ok(visibleGaps.length === 0, `content is visible at every handoff frame (gaps=${visibleGaps.length})`);
  const remounted = samples.filter((s) => s.layer && !s.sameCardNode);
  ok(remounted.length === 0, `the loading card is never remounted during the handoff (remounts=${remounted.length})`);
  const layerReplaced = samples.filter((s) => s.layer && !s.sameLayerNode);
  ok(layerReplaced.length === 0, 'the loading layer keeps one DOM node until it unmounts');
  ok(result.end && !result.end.layer, 'the loading layer unmounts after the fade');
  ok(result.end && result.end.hudOpacity === 1, 'the HUD ends at opacity 1');
  ok(!result.cardNodesStillConnected, 'the loading card is gone once the handoff finishes');
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
  const done = samples.find((s) => !s.layer && s.hud && s.hudOpacity === 1);
  ok(!!done && done.t <= 200, `reduced motion finishes the handoff fast (${done ? done.t : 'never'} ms)`);
  const transitions = samples.filter((s) => s.layer && s.hud && (s.hudTransition || s.layerTransition));
  ok(transitions.length === 0, 'reduced motion disables both opacity transitions');
  ok(result.end && !result.end.layer && result.end.hudOpacity === 1, 'reduced motion still lands on the HUD at opacity 1');
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
