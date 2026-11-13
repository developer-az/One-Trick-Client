/**
 * verify_pixel_pet.ts — E4: small canvas sprite pet for the dashboard.
 *
 * The authoring sandbox has no browser, so the visual "look-check" (idle,
 * queue pop, loading, game transition, both window sizes) is replaced by
 * structural checks: the pet is a fixed, bounded, pointer-events-none canvas
 * that only mounts in the dashboard shell, drawn with canvas primitives only
 * (no image assets), with the pure simulation in pixelPetLogic.ts exercised
 * directly for behaviour.
 *
 * Covered:
 *   1. Stage transitions — the pet is visible only during idle / queue /
 *      loading and disappears in game (and draft/post/offline/…).
 *   2. Animation selection — idle → wander → sleep timeline, queue-pop
 *      one-shot reaction ("react once when stage enters queue/ReadyCheck,
 *      then settle"), re-arm on re-entry, bounded walk that stays inside its
 *      allotted area.
 *   3. Palette / species validation — defaults, invalid-value rejection,
 *      round-trips, per-species palettes, sprite map invariants.
 *   4. Hidden / reduced-motion behaviour — timers pause while hidden, the
 *      phase clock freezes under prefers-reduced-motion and wandering stops.
 *   5. Persistence through the E3 settings path (electron/app-settings.ts),
 *      including deep-merge, flush to disk and relaunch survival.
 *   6. Structural checks — canvas primitives only, no overlay / League-client
 *      coupling, fixed bounded area, passive (pointer-events: none).
 *
 * Run: npx --yes tsx verify_pixel_pet.ts
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import {
  PET_SPECIES,
  PET_COLORS,
  PET_DEFAULT_SPECIES,
  PET_DEFAULT_COLOR,
  PET_VISIBLE_STAGES,
  PET_POP_STAGES,
  PET_TIMING,
  COLOR_HEX,
  normalizePet,
  isPetSpecies,
  isPetColor,
  petVisibleForStage,
  paletteFor,
  PET_SPRITES,
  PET_SPECIES_LABELS,
  createPetState,
  stepPet,
  petPoseFromState,
} from './src/app/pixelPetLogic';
import type { LeagueStage, PetMood, PetSettings, PetState } from './src/app/pixelPetLogic';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`ok   - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}
function deepEqual(name: string, actual: unknown, expected: unknown): boolean {
  try {
    assert.deepStrictEqual(actual, expected);
    check(name, true);
    return true;
  } catch (e) {
    check(
      `${name}\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)} (${(e as Error).message})`,
      false
    );
    return false;
  }
}

const ALL_STAGES: LeagueStage[] = ['preview', 'offline', 'connecting', 'idle', 'queue', 'draft', 'loading', 'game', 'post'];
const TICK_MS = 100;

/** Step `count` ticks of TICK_MS from a state, returning the final state. */
function stepFor(
  initial: PetState,
  count: number,
  opts: { stage?: LeagueStage; hidden?: boolean; reducedMotion?: boolean; width?: number } = {}
): PetState {
  let s = initial;
  const stage = opts.stage ?? initial.stage;
  const hidden = opts.hidden ?? false;
  const reducedMotion = opts.reducedMotion ?? false;
  const width = opts.width ?? 140;
  for (let i = 0; i < count; i++) {
    s = stepPet(s, { stage, now: s.lastNow + TICK_MS, hidden, reducedMotion, width });
  }
  return s;
}

function moodsOver(initial: PetState, count: number, opts: Parameters<typeof stepFor>[2] = {}): PetMood[] {
  const out: PetMood[] = [];
  let s = initial;
  const stage = opts.stage ?? initial.stage;
  const hidden = opts.hidden ?? false;
  const reducedMotion = opts.reducedMotion ?? false;
  const width = opts.width ?? 140;
  for (let i = 0; i < count; i++) {
    s = stepPet(s, { stage, now: s.lastNow + TICK_MS, hidden, reducedMotion, width });
    out.push(s.mood);
  }
  return out;
}

async function main(): Promise<void> {
  console.log('\n— 1. stage transitions: dashboard-only, gone in game —');
  for (const stage of ALL_STAGES) {
    const visible = stage === 'idle' || stage === 'queue' || stage === 'loading';
    check(`petVisibleForStage('${stage}') === ${visible}`, petVisibleForStage(stage) === visible);
  }
  deepEqual(
    'PET_VISIBLE_STAGES is exactly {idle, queue, loading}',
    [...PET_VISIBLE_STAGES].sort(),
    ['idle', 'loading', 'queue']
  );
  const gameStep = stepPet(createPetState(0, 'idle'), { stage: 'game', now: 100, hidden: false, reducedMotion: false, width: 140 });
  check('stepping into game hides the pet', gameStep.mood === 'hidden' && petPoseFromState(gameStep).mood === 'hidden');
  check('draft hides the pet', stepPet(createPetState(0, 'queue'), { stage: 'draft', now: 100, hidden: false, reducedMotion: false, width: 140 }).mood === 'hidden');
  // ReadyCheck arrives as stage 'queue' (leagueStatus folds Matchmaking/ReadyCheck together).
  const statusSrc = fs.readFileSync('src/app/status.ts', 'utf8');
  check('status.ts folds ReadyCheck into the queue stage', /QUEUE_PHASES\s*=\s*new Set\(\[[^\]]*'ReadyCheck'/.test(statusSrc));
  check("pet reacts to the queue stage (Matchmaking + ReadyCheck)", PET_POP_STAGES.has('queue') && PET_POP_STAGES.size === 1);

  console.log('\n— 2. animation selection: idle → wander → sleep —');
  const idle0 = createPetState(0, 'idle');
  const idleMoods = moodsOver(idle0, 400, { stage: 'idle' }); // 40s
  check('starts idle', idleMoods[0] === 'idle');
  check('wanders (walk) at least twice in 40s', idleMoods.filter((m) => m === 'walk').length >= 2);
  check('sleeps after a long idle stretch', idleMoods[idleMoods.length - 1] === 'sleep');
  const sleeper = stepFor(idle0, 400, { stage: 'idle' });
  const stillAsleep = stepFor(sleeper, 60, { stage: 'idle' });
  check('sleep persists until a stage change', stillAsleep.mood === 'sleep');
  const woken = stepFor(sleeper, 1, { stage: 'queue' });
  check('entering queue wakes the pet (stage change resets)', woken.mood === 'pop');

  console.log('\n— 2b. bounded walk: stays inside its allotted area —');
  let walker = createPetState(0, 'idle');
  let sawWalk = false;
  for (let i = 0; i < 400 && !sawWalk; i++) {
    walker = stepPet(walker, { stage: 'idle', now: walker.lastNow + TICK_MS, hidden: false, reducedMotion: false, width: 20 });
    if (walker.mood === 'walk') sawWalk = true;
  }
  check('idle pet starts walking', sawWalk && walker.mood === 'walk');
  const dirs = new Set<number>();
  let bounded = true;
  for (let i = 0; i < 300; i++) {
    walker = stepPet(walker, { stage: 'idle', now: walker.lastNow + TICK_MS, hidden: false, reducedMotion: false, width: 20 });
    dirs.add(walker.dir);
    if (!(walker.x >= 0 && walker.x <= 1 && Number.isFinite(walker.x))) bounded = false;
  }
  check('x stays inside [0, 1] while walking', bounded);
  check('walk turns around at both edges', dirs.has(1) && dirs.has(-1));
  const zeroWidth = stepPet(createPetState(0, 'idle'), { stage: 'idle', now: 3200, hidden: false, reducedMotion: false, width: 0 });
  check('zero-width area does not produce NaN positions', Number.isFinite(zeroWidth.x) && Number.isFinite(zeroWidth.phase));

  console.log('\n— 2c. queue-pop reaction: once, then settle —');
  const pop0 = createPetState(0, 'queue');
  const after1 = stepFor(pop0, 1, { stage: 'queue' });
  check('queue entry pops immediately', after1.mood === 'pop' && after1.popArmed === false);
  check('pop pose reports progress', petPoseFromState(after1).mood === 'pop' && petPoseFromState(after1).popProgress > 0);
  const afterPopMs = stepFor(pop0, Math.ceil(PET_TIMING.popMs / TICK_MS), { stage: 'queue' });
  check(`pop settles to a calm mood after ${PET_TIMING.popMs}ms`, afterPopMs.mood !== 'pop' && afterPopMs.mood !== 'hidden');
  const settleMoods = moodsOver(pop0, 220, { stage: 'queue' }); // 22s in queue
  let popTransitions = 0;
  for (let i = 0; i < settleMoods.length; i++) {
    if (settleMoods[i] === 'pop' && (i === 0 || settleMoods[i - 1] !== 'pop')) popTransitions++;
  }
  check('pop fires exactly once per queue entry', popTransitions === 1);
  check('after the pop the pet settles (no re-pop while still queued)', settleMoods.slice(Math.ceil(PET_TIMING.popMs / TICK_MS)).every((m) => m !== 'pop'));
  check('queue stay ends in idle/walk calm', ['idle', 'walk', 'sleep'].includes(settleMoods[settleMoods.length - 1]));

  console.log('\n— 2d. re-entry re-arms the reaction —');
  let requeued = stepFor(pop0, Math.ceil(PET_TIMING.popMs / TICK_MS) + 1, { stage: 'queue' }); // settled
  check('settled pet is not popping', requeued.mood !== 'pop');
  requeued = stepPet(requeued, { stage: 'game', now: requeued.lastNow + 1, hidden: false, reducedMotion: false, width: 140 });
  check('leaving to game hides the pet', requeued.mood === 'hidden');
  requeued = stepFor(requeued, 1, { stage: 'queue' });
  check('a fresh queue entry pops again', requeued.mood === 'pop' && requeued.popArmed === false);

  console.log('\n— 3. palette / species validation —');
  deepEqual('normalizePet(undefined) → defaults', normalizePet(undefined), { species: 'imp', color: 'teal' });
  deepEqual('normalizePet({}) → defaults', normalizePet({}), { species: 'imp', color: 'teal' });
  deepEqual('normalizePet({species:"pup"}) keeps color default', normalizePet({ species: 'pup' }), { species: 'pup', color: 'teal' });
  deepEqual('invalid species + color → defaults', normalizePet({ species: 'dragon', color: 'pink' }), { species: 'imp', color: 'teal' });
  deepEqual('valid choice round-trips', normalizePet({ species: 'wyrm', color: 'blood' }), { species: 'wyrm', color: 'blood' });
  check('default species is a real species', isPetSpecies(PET_DEFAULT_SPECIES) && PET_SPECIES.includes(PET_DEFAULT_SPECIES));
  check('default color is a real color', isPetColor(PET_DEFAULT_COLOR) && PET_COLORS.includes(PET_DEFAULT_COLOR));
  check('species list is non-empty and all valid', PET_SPECIES.length >= 3 && PET_SPECIES.every(isPetSpecies));
  check('color list is non-empty and all valid', PET_COLORS.length >= 4 && PET_COLORS.every(isPetColor));
  check('species labels cover every species', PET_SPECIES.every((s) => typeof PET_SPECIES_LABELS[s] === 'string' && PET_SPECIES_LABELS[s].length > 0));
  for (const c of PET_COLORS) {
    check(`color ${c} is a hex color`, /^#[0-9a-f]{6}$/i.test(COLOR_HEX[c]));
  }
  const palettes = PET_SPECIES.map((s) => paletteFor(s, 'teal'));
  for (const p of palettes) {
    for (const k of ['body', 'belly', 'outline', 'accent', 'eye'] as const) {
      check(`palette.${k} is a hex color`, /^#[0-9a-f]{6}$/i.test(p[k]));
    }
  }
  const distinctPairs = palettes.flatMap((a, i) => palettes.slice(i + 1).map((b) => a !== b));
  check('each species has a distinct palette', distinctPairs.length > 0 && distinctPairs.every(Boolean));
  check(
    'body color follows the chosen color',
    PET_SPECIES.every((s) => PET_COLORS.every((c) => paletteFor(s, c).body === COLOR_HEX[c]))
  );

  console.log('\n— 3b. sprite maps are clean pixel grids —');
  const CHARS = new Set(['.', 'o', 'B', 'b', 'a', 'e']);
  for (const species of PET_SPECIES) {
    const map = PET_SPRITES[species];
    check(`${species}: sprite map exists`, Array.isArray(map) && map.length > 0);
    if (!Array.isArray(map) || map.length === 0) continue;
    const width = map[0].length;
    check(`${species}: rows are equal length (${width})`, map.every((row) => row.length === width));
    check(`${species}: fits 16×14`, width <= 16 && map.length <= 14);
    check(`${species}: only palette-key chars`, map.every((row) => [...row].every((ch) => CHARS.has(ch))));
    const flat = map.join('');
    check(`${species}: has body pixels`, flat.includes('B'));
    check(`${species}: has outline pixels`, flat.includes('o'));
    check(`${species}: has eye pixels`, flat.includes('e'));
  }

  console.log('\n— 4. hidden + reduced-motion behaviour —');
  const h0 = stepFor(createPetState(0, 'idle'), 10, { stage: 'idle' }); // 1s awake
  const hPoseBefore = petPoseFromState(h0);
  const hFrozen = stepFor(h0, 100, { stage: 'idle', hidden: true }); // 10s hidden
  deepEqual('hidden: pose is frozen (mood/x/dir/phase/pop)', petPoseFromState(hFrozen), hPoseBefore);
  check('hidden: awake timer pauses', hFrozen.awakeMs === h0.awakeMs && hFrozen.wanderMs === h0.wanderMs);
  const hResumed = stepFor(hFrozen, 50, { stage: 'idle' }); // 5s visible again
  check('hidden: only visible time counts (awakeMs + exactly 5000ms)', hResumed.awakeMs === h0.awakeMs + 5000);
  const midPop = stepFor(createPetState(0, 'queue'), 5, { stage: 'queue' });
  check('mid-pop is genuinely in progress', midPop.mood === 'pop' && midPop.popLeftMs < PET_TIMING.popMs);
  const midPopFrozen = stepFor(midPop, 30, { stage: 'queue', hidden: true });
  check('hidden: pop timer pauses mid-reaction', midPopFrozen.mood === 'pop' && midPopFrozen.popLeftMs === midPop.popLeftMs);

  const rmIdle = createPetState(0, 'idle');
  const rmMoods = moodsOver(rmIdle, 400, { stage: 'idle', reducedMotion: true });
  check('reduced motion: never wanders', !rmMoods.includes('walk'));
  check('reduced motion: still sleeps after a long idle', rmMoods[rmMoods.length - 1] === 'sleep');
  let rmPhaseFrozen = true;
  let rm = createPetState(0, 'idle');
  for (let i = 0; i < 400; i++) {
    rm = stepPet(rm, { stage: 'idle', now: rm.lastNow + TICK_MS, hidden: false, reducedMotion: true, width: 140 });
    if (rm.phase !== 0) rmPhaseFrozen = false;
  }
  check('reduced motion: phase clock stays at 0', rmPhaseFrozen && rm.phase === 0);
  check('reduced motion: pet stays put', rm.x === createPetState(0, 'idle').x);
  const rmQueue = stepFor(createPetState(0, 'queue'), Math.ceil(PET_TIMING.popMs / TICK_MS), { stage: 'queue', reducedMotion: true });
  check('reduced motion: queue pop still fires once', rmQueue.mood !== 'pop' && petPoseFromState(stepFor(createPetState(0, 'queue'), 1, { stage: 'queue', reducedMotion: true })).mood === 'pop');
  check('reduced motion: pop settles to idle, not wander', rmQueue.mood === 'idle' && rmQueue.phase === 0);

  console.log('\n— 5. persistence through the E3 settings path —');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-pet-'));
  process.env.ONETRICK_USER_DATA = dir;
  fs.writeFileSync(path.join(dir, 'app-settings.json'), JSON.stringify({ overlayEnabled: false, pet: { species: 'wyrm', color: 'gold' } }));
  const electron = await import('./electron/app-settings');
  const loaded = electron.loadAppSettings();
  deepEqual('electron: pet survives a settings file', loaded.pet, { species: 'wyrm', color: 'gold' });
  electron.updateAppSettings({ pet: { species: 'pup' } });
  deepEqual('electron: single-field pet patch deep-merges', electron.getAppSettings().pet, { species: 'pup', color: 'gold' });
  electron.updateAppSettings({ pet: { color: 'blood' } });
  deepEqual('electron: second patch keeps species', electron.getAppSettings().pet, { species: 'pup', color: 'blood' });
  electron.updateAppSettings({ pet: { species: 'nope', color: 'rainbow' } });
  deepEqual('electron: invalid pet values fall back to defaults', electron.getAppSettings().pet, { species: 'imp', color: 'teal' });
  electron.updateAppSettings({ pet: { species: 'blob', color: 'royal' } });
  const finalPet: PetSettings = { species: 'blob', color: 'royal' };
  electron.flushAppSettings();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'app-settings.json'), 'utf8'));
  deepEqual('electron: persisted pet matches memory', onDisk.pet, finalPet);
  check('electron: unrelated boolean kept', onDisk.overlayEnabled === false);
  deepEqual(
    'electron: species/color enums match the renderer logic',
    { species: electron.PET_SPECIES, colors: electron.PET_COLORS },
    { species: [...PET_SPECIES], colors: [...PET_COLORS] }
  );
  const tmpScript = `.tmp-relaunch-${process.pid}.ts`;
  fs.writeFileSync(tmpScript, `(async () => { const { getAppSettings } = await import('./electron/app-settings'); console.log(JSON.stringify(getAppSettings().pet)); })().catch((e) => { console.error('CHILD_ERR', e); process.exit(2); });`);
  const child = spawnSync('npx --yes tsx ' + tmpScript, {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env, ONETRICK_USER_DATA: dir },
    encoding: 'utf8',
  });
  try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  check('relaunch child exited cleanly', child.status === 0);
  if (child.status !== 0) console.error('  stderr:', child.stderr?.slice(0, 600));
  const childLine = (child.stdout || '').trim().split('\n').pop() || '';
  let relaunched: PetSettings | null = null;
  try {
    relaunched = JSON.parse(childLine);
  } catch {
    /* handled below */
  }
  deepEqual('relaunch: pet re-read from disk', relaunched, finalPet);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('\n— 6. structural: canvas primitives, no overlay / League coupling —');
  const pixelPet = fs.readFileSync('src/app/PixelPet.tsx', 'utf8');
  check('PixelPet renders a <canvas>', pixelPet.includes('<canvas'));
  check('PixelPet draws with canvas primitives only', !/new Image\(|<img\b|background-image|url\(\s*['"]?\.?\//.test(pixelPet));
  check('PixelPet never touches the League client', !pixelPet.includes('electronAPI') && !/import\s+[\s\S]*?overlay/.test(pixelPet));
  check('PixelPet hides itself off the allowed stages', pixelPet.includes('petVisibleForStage'));
  check('PixelPet returns null when not visible (disappears in game)', /return null/.test(pixelPet) && pixelPet.includes('visible'));
  check('PixelPet handles window/document hidden', /document\.hidden|visibilitychange|hasFocus|addEventListener\(['"]blur/.test(pixelPet));
  check('PixelPet honors prefers-reduced-motion', /prefers-reduced-motion|matchMedia|reduced/.test(pixelPet));
  check('PixelPet canvas has a fixed bounded size', /\bwidth\b[\s\S]{0,40}128/.test(pixelPet) && /\bheight\b[\s\S]{0,40}72/.test(pixelPet));

  const logic = fs.readFileSync('src/app/pixelPetLogic.ts', 'utf8');
  check('pixelPetLogic is framework-free (no react import)', !/from\s+['"]react['"]/.test(logic));
  for (const fn of ['createPetState', 'stepPet', 'petPoseFromState', 'petVisibleForStage', 'normalizePet', 'paletteFor']) {
    check(`pixelPetLogic exports ${fn}`, new RegExp(`export (function|const) ${fn}\\b`).test(logic));
  }

  const appSrc = fs.readFileSync('src/app/App.tsx', 'utf8');
  check('App mounts <PixelPet', /import\s*\{[^}]*PixelPet[^}]*\}\s*from\s*['"]\.\/PixelPet['"]/.test(appSrc) && appSrc.includes('<PixelPet'));
  check('App passes the live league stage to the pet', /<PixelPet[^>]*stage=/.test(appSrc));
  check('App persists pet choices through settings update', /update\(\{\s*pet\s*:/.test(appSrc));
  check('App settings UI offers species + color', appSrc.includes('Pet companion') && appSrc.includes('pet.species') && appSrc.includes('pet.color'));

  const css = fs.readFileSync('src/app/theme.css', 'utf8');
  check('theme.css defines a fixed pet area', /\.ot-pet-area\s*\{[^}]*position:\s*fixed/.test(css));
  check('pet area is passive (pointer-events: none)', /\.ot-pet-area\s*\{[^}]*pointer-events:\s*none/.test(css));
  check('pet area is a bounded corner allotment', /\.ot-pet-area\s*\{[^}]*width:\s*128px[^}]*height:\s*72px/.test(css));

  const types = fs.readFileSync('src/types.d.ts', 'utf8');
  check('types.d.ts declares PetSettings', /interface PetSettings\s*\{/.test(types));
  check('types.d.ts wires pet into AppSettings', /pet\s*:\s*PetSettings/.test(types));

  const electronSrc = fs.readFileSync('electron/app-settings.ts', 'utf8');
  check('electron/app-settings.ts exports normalizePet', /export function normalizePet/.test(electronSrc));
  check('electron defaults include pet', /pet:\s*PET_DEFAULTS/.test(electronSrc));

  const overlayFiles = fs.readdirSync('src/overlay').filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  for (const f of overlayFiles) {
    const src = fs.readFileSync(`src/overlay/${f}`, 'utf8');
    check(`overlay/${f} never mounts the pet`, !src.includes('PixelPet') && !src.includes('pixelPetLogic'));
  }

  console.log(`\nverify_pixel_pet: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('verify_pixel_pet crashed:', e);
  process.exit(2);
});
