/**
 * verify_loading_card.ts — the pre-match loading card.
 *
 * The card's numbers come from one pure fold over the LCU match history
 * (src/overlay/loadingStats.ts), so they can be pinned without Electron:
 *   - win %, streak, KDA and oldest→newest form from a fixture;
 *   - only games on the current champion count;
 *   - zero games / no history is a first-game state, never a fake stat;
 *   - the form bar is at most 10 segments and the win segments use the
 *     champion accent while losses stay blood;
 *   - the overlay CSS stays static: no backdrop-filter, no blur, no glow, no
 *     animation on the card.
 *
 * Run: npx --yes tsx verify_loading_card.ts
 */
import fs from 'node:fs';
import { FORM_SEGMENTS, computeLoadingStats, type LoadingMatchLike } from './src/overlay/loadingStats';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const game = (
  championId: number,
  win: boolean,
  kills: number,
  deaths: number,
  assists: number
): LoadingMatchLike => ({ championId, win, kills, deaths, assists });

console.log('--- verify:loading-card: stats math ---');
// Newest first, exactly the shape electron/match-history returns.
const fixture: LoadingMatchLike[] = [
  game(555, true, 8, 2, 10),
  game(555, true, 4, 0, 12),
  game(555, false, 2, 6, 5),
  game(555, true, 6, 3, 9),
  game(555, false, 1, 4, 3),
  game(99, false, 0, 10, 0), // another champion: never counted
];
const stats = computeLoadingStats(fixture, 555);
ok(stats.games === 5, `only games on the current champion count (games ${stats.games})`);
ok(stats.winRate === 60, `win % is rounded wins/games (got ${stats.winRate})`);
ok(stats.streak === 'W2', `streak runs from the newest result (got ${stats.streak})`);
ok(stats.kda === 4, `KDA = (kills+assists)/max(1,deaths) (got ${stats.kda})`);
ok(
  stats.form.join('') === 'LWLWW',
  `form is oldest → newest for the 10-segment bar (got ${stats.form.join('')})`
);

const losses = computeLoadingStats(
  [game(1, false, 1, 5, 2), game(1, false, 0, 7, 1), game(1, true, 3, 1, 4)],
  1
);
ok(losses.streak === 'L2', `a loss streak reads L<n> (got ${losses.streak})`);
ok(losses.winRate === 33, `33% is rounded, not floored (got ${losses.winRate})`);

const noDeaths = computeLoadingStats([game(7, true, 2, 0, 3)], 7);
ok(noDeaths.kda === 5, `zero deaths divides by 1, not by 0 (got ${noDeaths.kda})`);

const many = Array.from({ length: 14 }, () => game(3, true, 1, 1, 1));
const capped = computeLoadingStats(many, 3);
ok(capped.games === 14, `every game on the champion counts toward the stats (got ${capped.games})`);
ok(
  capped.form.length === FORM_SEGMENTS && capped.form.every((result) => result === 'W'),
  `form bar keeps the newest ${FORM_SEGMENTS} results (got ${capped.form.length})`
);
ok(capped.streak === 'W14', `streak is not capped by the bar (got ${capped.streak})`);

console.log('--- verify:loading-card: first game / missing data ---');
const first = computeLoadingStats([], 555);
ok(first.games === 0 && first.winRate === 0 && first.streak === null && first.kda === 0, 'zero games is an empty state');
ok(first.form.length === 0, 'zero games draws no form segments');
const unknownChampion = computeLoadingStats(fixture, 12345);
ok(unknownChampion.games === 0, 'a champion with no games in the window is an empty state');
ok(computeLoadingStats(null, 555).games === 0, 'null history never throws');
ok(computeLoadingStats(undefined, 555).games === 0, 'missing history never throws');
ok(computeLoadingStats(fixture, null).games === 0, 'no champion id means no stats');

console.log('--- verify:loading-card: card + CSS stay static ---');
const card = fs.readFileSync('src/overlay/LoadingCard.tsx', 'utf8');
ok(card.includes('ONE TRICK · LOADING'), 'card carries the ONE TRICK · LOADING eyebrow');
ok(card.includes('First game on this champion'), 'card has the first-game empty state');
ok(card.includes('OLDER') && card.includes('LATEST'), 'form bar is labelled OLDER → LATEST');
ok(card.includes('ov-panel') && card.includes('ov-panel-accent'), 'card reuses the shared panel language');
ok(!/animation:|setInterval|requestAnimationFrame/.test(card), 'card is static (no animation or timer)');

const app = fs.readFileSync('src/overlay/OverlayApp.tsx', 'utf8');
ok(/<OverlayPet\b/.test(app), 'loading screen still mounts the pet');
ok(app.includes('<LoadingCard'), 'loading screen mounts the card when stats arrive');
ok(/state\.loadingStats\s*\?\s*\(/.test(app), 'card waits for loadingStats (pet alone until then)');

const css = fs.readFileSync('src/overlay/overlay-theme.css', 'utf8');
ok(!/backdrop-filter\s*:/.test(css), 'overlay CSS uses no backdrop-filter');
ok(!/filter\s*:\s*(blur|drop-shadow)\(/.test(css), 'overlay CSS uses no blur/drop-shadow filter');
ok(!/box-shadow\s*:\s*0\s+0\s+\d+px/.test(css), 'overlay CSS ships no colored glow');
ok(!/animation\s*:/.test(css) && !/@keyframes/.test(css), 'overlay CSS ships no animation');
ok(/\.ov-loading-card\s*\{/.test(css), 'overlay CSS styles the loading card');
ok(/\.ov-form-seg--win\s*\{[^}]*var\(--ov-champ\)/.test(css), 'win segments use the champion accent');
ok(/\.ov-form-seg--loss\s*\{[^}]*var\(--ov-blood\)/.test(css), 'loss segments stay blood');
ok(/\.ov-pet-ground\s*\{/.test(css), 'the pet walks on a hairline ground line');
ok(/\.ov-loading-stat\s*\{[^}]*border-left:\s*1px solid var\(--ov-border\)/.test(css), 'stats are split by vertical hairlines');
ok(/\.ov-loading-champ\s*\{[^}]*\.ov-chrome-text|\.ov-chrome-text\s*\{[^}]*background-clip:\s*text/.test(css), 'the champion name uses chrome text');

const pet = fs.readFileSync('src/overlay/OverlayPet.tsx', 'utf8');
ok(pet.includes('ov-pet-ground'), 'OverlayPet renders the ground line');
ok(pet.includes('PET_FRAME_MS = 125'), 'pet keeps its ~8 fps cap');

if (failures) {
  console.error(`verify:loading-card FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:loading-card ok');
