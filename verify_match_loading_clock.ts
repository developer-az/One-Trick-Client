// A stale GameStart label must not blank the live HUD once the match clock runs.
import { isMatchLoading } from './src/logic/matchLoading';

let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
    return;
  }
  console.log('ok', msg);
}

// Real loading screen: still loading.
ok(isMatchLoading({ phase: 'GameStart', gameTime: 0, trustedGameTime: 0 }), 'GameStart, no match yet: loading');
ok(isMatchLoading({ phase: 'GameStart', gameTime: 0, trustedGameTime: 0, matchEngaged: true }), 'GameStart, engaged, frozen clock: loading');
ok(isMatchLoading({ phase: 'GameStart', gameTime: 0.1, trustedGameTime: 0.1, matchEngaged: true }), 'GameStart, engaged, sub-threshold clock: loading');

// Match running while the client still says GameStart: not loading.
ok(!isMatchLoading({ phase: 'GameStart', gameTime: 312, trustedGameTime: 312, matchEngaged: true }), 'GameStart mid-match (trusted clock): live');
ok(!isMatchLoading({ phase: 'GameStart', gameTime: 5, trustedGameTime: 0.5, matchEngaged: true }), 'GameStart with advancing clock: live');
ok(!isMatchLoading({ phase: 'GameStart', gameTime: 2, trustedGameTime: 2, matchEngaged: true }), 'GameStart just after clock start: live');

// Unchanged cases.
ok(!isMatchLoading({ phase: 'InProgress', gameTime: 600, trustedGameTime: 600, matchEngaged: true }), 'InProgress mid-match: live');
ok(isMatchLoading({ phase: 'InProgress', gameTime: 0, trustedGameTime: 0, matchEngaged: true }), 'InProgress frozen clock: loading');
ok(!isMatchLoading({ phase: 'Reconnect', gameTime: 0, trustedGameTime: 0, matchEngaged: true }), 'Reconnect: not loading');
ok(!isMatchLoading({ phase: 'Lobby', gameTime: 0, trustedGameTime: 0 }), 'Lobby, not engaged: not loading');
ok(!isMatchLoading({ phase: null, gameTime: 0, trustedGameTime: 0 }), 'no phase, not engaged: not loading');

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('verify_match_loading_clock: all checks passed');
