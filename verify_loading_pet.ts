import { isMatchLoading } from './src/logic/matchLoading';

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('ok', msg);
}

ok(isMatchLoading({ phase: 'GameStart', gameTime: 0, trustedGameTime: 0 }), 'GameStart is loading');
ok(!isMatchLoading({ phase: 'InProgress', gameTime: 5, trustedGameTime: 0.5, matchEngaged: true }), 'advancing clock ends loading');
ok(isMatchLoading({ phase: 'InProgress', gameTime: 0, trustedGameTime: 0, matchEngaged: true }), 'frozen clock in progress is loading');
ok(!isMatchLoading({ phase: 'InProgress', gameTime: 2, trustedGameTime: 0.5, matchEngaged: true }), 'clock advancing ends loading');
ok(!isMatchLoading({ phase: 'Reconnect', gameTime: 0, trustedGameTime: 0, matchEngaged: true }), 'Reconnect is not loading');

console.log('verify:loading-pet ok');