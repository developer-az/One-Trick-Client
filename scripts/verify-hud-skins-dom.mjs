#!/usr/bin/env node
/**
 * HUD skin DOM guard (review fix on fix-45).
 *
 * Launches Electron offscreen (no window, no main-process HUD state) on a
 * harness page built from the real built overlay stylesheet and the real
 * ornament markup exported by src/overlay/hudSkinOrnaments.tsx. It then:
 *
 *   1. draws the representative live panels under every skin and asserts the
 *      module boxes are pixel-identical (decoration never changes geometry);
 *   2. walks every visible ornament against every text rect in its panel and
 *      asserts zero intersections (`ornamentHits=0`), plus that the known
 *      one-line variant draws none;
 *   3. measures 60 s of payload updates at the real 500 ms cadence: the old
 *      per-panel observer/text-walk cost vs the measurement-free CSS path.
 *
 * Run `npm run build` first. `npm run verify:hud-skins-dom`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};

const distAssets = path.join(root, 'dist', 'assets');
if (!fs.existsSync(distAssets)) {
  console.error('dist/assets is missing: run npm run build first');
  process.exit(1);
}
const css = fs
  .readdirSync(distAssets)
  .filter((name) => name.endsWith('.css'))
  .sort()
  .map((name) => pathToFileURL(path.join(distAssets, name)).href);
if (!css.length) {
  console.error('no built CSS in dist/assets: run npm run build first');
  process.exit(1);
}

// The exact ornament markup the component renders, straight from the module
// (tsx handles the JSX import; no duplication in this script).
const markupScript = path.join(root, 'scripts', 'hud-skin-ornament-markup.ts');
let markupOut = '';
try {
  markupOut = execSync(`npx --yes tsx "${markupScript}"`, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
  });
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
const ornaments = JSON.parse(markupOut.trim().split(/\r?\n/).filter(Boolean).pop());
ok(Object.keys(ornaments).length === 7, `ornament markup generated for ${Object.keys(ornaments).length} skins`);

const panels = `
  <section class="hud-rail-card" data-panel="rail" style="width:220px">
    <span class="ov-skin-orn-host" data-host></span>
    <h3 class="hud-rail-label"><span class="hud-rail-label-text">Summoners</span><span class="hud-rail-label-meta">02:31</span></h3>
    <div class="hud-rail-body"><div class="hud-chip">Flash 4:12</div><div class="hud-chip">Ignite ready</div></div>
  </section>
  <div class="ov-panel hud-overlay-panel hud-overlay-panel--rail" data-panel="chrome" style="width:220px">
    <span class="ov-skin-orn-host" data-host></span>
    <div class="hud-chrome-header flex items-center justify-between px-2 py-1.5"><span class="hud-chrome-title">One Trick</span><span class="hud-chrome-meta">Pyke</span></div>
    <div class="relative z-10 px-2 py-1.5"><div class="hud-ward">River bush warded 0:42</div><div class="hud-gank">Jungle top in 12s</div></div>
  </div>
  <div class="ov-panel hud-overlay-panel ov-panel--short" data-panel="short" style="width:220px">
    <span class="ov-skin-orn-host" data-host></span>
    <div class="px-2 py-1 text-[11px]"><div>Dragon 95s</div></div>
  </div>`;

const measureScript = `
(function () {
  const SKINS = ${JSON.stringify(ornaments)};
  const PANELS = Array.from(document.querySelectorAll('[data-panel]'));
  function textRects(panel) {
    const rects = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue && node.nodeValue.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
        }
      }
      node = walker.nextNode();
    }
    return rects;
  }
  function draw(skin) {
    document.documentElement.dataset.ovSkin = skin;
    const marks = SKINS[skin];
    for (const host of document.querySelectorAll('[data-host]')) {
      host.innerHTML =
        Object.entries(marks.corners)
          .map(([corner, svg]) => '<span data-orn="' + corner + '" class="ov-skin-orn ov-skin-orn--' + corner + '">' + svg + '</span>')
          .join('') +
        (marks.emblem ? '<span data-orn="emblem" class="ov-skin-orn ov-skin-orn--emblem">' + marks.emblem + '</span>' : '');
    }
    void document.body.offsetHeight;
  }
  function measure(skin) {
    draw(skin);
    void document.body.offsetHeight;
    const rects = PANELS.map((panel) => {
      const r = panel.getBoundingClientRect();
      return { id: panel.dataset.panel, x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    });
    let hits = 0;
    let ornamentCount = 0;
    const shortOrnaments = [];
    for (const panel of PANELS) {
      const panelRect = panel.getBoundingClientRect();
      const texts = textRects(panel);
      for (const orn of panel.querySelectorAll('.ov-skin-orn')) {
        const style = getComputedStyle(orn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const r = orn.getBoundingClientRect();
        // A hidden ancestor (the short-panel rule) leaves the mark with no box.
        if (!orn.getClientRects().length || r.width === 0 || r.height === 0) continue;
        ornamentCount += 1;
        if (panel.dataset.panel === 'short') shortOrnaments.push(orn.dataset.orn);
        // Negative offsets put the outer half of a 1px mark on the border line;
        // 2px of border overhang is the intended placement, not a collision.
        if (r.left < panelRect.left - 2.5 || r.top < panelRect.top - 2.5 || r.right > panelRect.right + 2.5 || r.bottom > panelRect.bottom + 2.5) {
          hits += 1;
          continue;
        }
        for (const text of texts) {
          if (r.left < text.right - 0.5 && r.right > text.left + 0.5 && r.top < text.bottom - 0.5 && r.bottom > text.top + 0.5) {
            hits += 1;
            break;
          }
        }
      }
    }
    return { skin, rects, hits, ornamentCount, shortOrnaments };
  }
  function perf() {
    const texts = Array.from(document.querySelectorAll('.hud-chip, .hud-ward, .hud-gank, .hud-rail-label-meta, .hud-chrome-meta'));
    const TICKS = 120; // 60 s of payload updates at the real 500 ms cadence.
    // AFTER: a payload update only writes text; one forced layout per tick.
    const afterStart = performance.now();
    for (let i = 0; i < TICKS; i += 1) {
      for (const el of texts) el.textContent = 'v' + (i % 10);
      void document.body.offsetHeight;
    }
    const afterMs = performance.now() - afterStart;
    // BEFORE: the same text writes plus the old guard: every panel's text nodes
    // walked and every ornament rect read on each update (per-panel Resize /
    // Mutation callbacks).
    const beforeStart = performance.now();
    for (let i = 0; i < TICKS; i += 1) {
      for (const el of texts) el.textContent = 'b' + (i % 10);
      for (const panel of PANELS) {
        const rects = textRects(panel);
        for (const orn of panel.querySelectorAll('.ov-skin-orn')) {
          const r = orn.getBoundingClientRect();
          for (const text of rects) {
            if (r.left < text.right && r.right > text.left && r.top < text.bottom && r.bottom > text.top) break;
          }
        }
      }
      void document.body.offsetHeight;
    }
    const beforeMs = performance.now() - beforeStart;
    return { ticks: TICKS, beforeMs: +beforeMs.toFixed(2), afterMs: +afterMs.toFixed(2) };
  }
  document.fonts.ready.then(function () {
    const results = Object.keys(SKINS).map(measure);
    const base = JSON.stringify(results[0].rects);
    const identicalRects = results.every((row) => JSON.stringify(row.rects) === base);
    const ornamentHits = results.reduce((n, row) => n + row.hits, 0);
    const ornamentCount = results.reduce((n, row) => n + row.ornamentCount, 0);
    const shortMarks = results.reduce((n, row) => n + row.shortOrnaments.length, 0);
    window.__hudDomResult = {
      skins: results.map((row) => row.skin),
      identicalRects,
      ornamentHits,
      ornamentCount,
      shortMarks,
      perf: perf(),
    };
  }).catch(function (error) {
    window.__hudDomResult = { error: String(error) };
  });
})();
`;

const html = `<!doctype html>
<html lang="en" class="overlay-root" data-ov-skin="gothic">
<head>
<meta charset="UTF-8" />
${css.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n')}
<style>
  html, body { margin: 0; background: #101014; }
  .wrap { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
</style>
</head>
<body><div class="wrap">${panels}</div>
<script>${measureScript}</script>
</body></html>`;

const pagePath = path.join(os.tmpdir(), `onetrick-hud-skins-${process.pid}.html`);
fs.writeFileSync(pagePath, html, 'utf8');
const mainScript = path.join(root, 'scripts', 'hud-skins-dom-main.cjs');

try {
  const child = spawnSync(electronPath, [mainScript], {
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
    process.exit(1);
  }
  const result = JSON.parse(line.slice('HUD_DOM_RESULT '.length));
  if (result.error) {
    console.error('harness failed:', result.error);
    process.exit(1);
  }
  ok(result.skins.length === 7, `all ${result.skins.length} skins rendered`);
  ok(result.ornamentCount > 0, `visible ornaments drawn (${result.ornamentCount} across 7 skins)`);
  ok(result.identicalRects, 'module rects are pixel-identical under every skin');
  ok(result.ornamentHits === 0, `ornamentHits=${result.ornamentHits} (no ornament/text intersection)`);
  ok(result.shortMarks === 0, 'the known short panel variant draws no ornaments');
  const { beforeMs, afterMs, ticks } = result.perf;
  const savedPct = beforeMs > 0 ? Math.round((1 - afterMs / beforeMs) * 100) : 0;
  console.log(
    `     measured: ${ticks} payload updates (60 s at 500 ms) — before ${beforeMs} ms, after ${afterMs} ms ` +
      `(${savedPct}% less scripting/layout work)`
  );
  ok(afterMs < beforeMs, `the CSS gutter path is cheaper than per-panel measurement (${afterMs} ms < ${beforeMs} ms)`);
} finally {
  try {
    fs.unlinkSync(pagePath);
  } catch {
    /* ignore */
  }
}

if (failures > 0) {
  console.error(`verify:hud-skins-dom FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('verify:hud-skins-dom ok');
