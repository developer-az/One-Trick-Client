/**
 * Test builds must identify themselves: a label in the window title, a startup line in the log,
 * and a clear message when another One Trick already holds the single-instance lock.
 * (Two test matches were played on the installed app by mistake because nothing told them apart.)
 */
import { readTestBuildLabel, secondInstanceMessage, windowTitleFor } from './electron/build-info-logic';

function ok(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exitCode = 1;
    } else {
        console.log('ok', msg);
    }
}

ok(readTestBuildLabel({ name: 'one-trick', version: '1.7.0' }) === null, 'label: normal package.json -> null');
ok(readTestBuildLabel({ testBuildLabel: '  overlay-fix-3  ' }) === 'overlay-fix-3', 'label: trimmed');
ok(readTestBuildLabel({ testBuildLabel: '' }) === null && readTestBuildLabel({ testBuildLabel: '   ' }) === null, 'label: empty -> null');
ok(readTestBuildLabel({ testBuildLabel: 42 }) === null, 'label: non-string -> null');
ok(readTestBuildLabel(null) === null && readTestBuildLabel(undefined) === null && readTestBuildLabel('x') === null, 'label: bad input -> null');
ok((readTestBuildLabel({ testBuildLabel: 'x'.repeat(200) }) || '').length <= 60, 'label: capped at 60 chars');
ok(!(readTestBuildLabel({ testBuildLabel: 'a\nb' }) || '').includes('\n'), 'label: single line');

ok(windowTitleFor(null) === 'One Trick', 'title: normal build unchanged');
const title = windowTitleFor('overlay-fix-3');
ok(title.startsWith('One Trick') && title.includes('TEST BUILD') && title.includes('overlay-fix-3'), `title: test build is labelled (${title})`);

const msg = secondInstanceMessage('overlay-fix-3');
ok(msg.title.length > 0 && msg.title.length <= 80, 'second instance: has a short title');
ok(/already running/i.test(msg.body), 'second instance: says another One Trick is already running');
ok(/Task Manager/i.test(msg.body) && /OneTrick\.exe/.test(msg.body), 'second instance: says how to close it');
ok(msg.body.includes('overlay-fix-3'), 'second instance: names this test build');
