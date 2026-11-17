/**
 * Installer guard: One Trick never creates an "OneTrickLink" shortcut and registers no
 * OneTrickLink/otclink protocol. Older installs left one behind, so upgrading in place has to
 * delete it instead of leaving the Start Menu pointing at a dead target.
 *
 * Run: npm run verify:stale-launcher
 */

import fs from 'fs';

const NSH = 'build/installer.nsh';
const PKG = 'package.json';

function assert(cond: unknown, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exit(1);
    }
}

/** Trimmed, non-empty, non-comment lines. */
function lines(source: string): string[] {
    return source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(';'));
}

/**
 * Minimal NSIS macro reader: returns the trimmed, non-comment lines between
 * "!macro <name>" and the next "!macroend". Comment lines are dropped so a
 * commented-out command can never satisfy a check.
 */
function readMacro(source: string, name: string): string[] {
    const all = source.split(/\r?\n/);
    const open = new RegExp(`^\\s*!macro\\s+${name}\\s*$`, 'i');
    const start = all.findIndex((line) => open.test(line));
    if (start === -1) return [];
    const end = all.findIndex((line, index) => index > start && /^\s*!macroend\b/i.test(line));
    if (end === -1) return [];
    return lines(all.slice(start + 1, end).join('\n'));
}

/** Every RMDir/Delete command in the file, with its arguments intact. */
function commands(source: string, verb: RegExp): string[] {
    return lines(source).filter((line) => verb.test(line));
}

/**
 * electron-builder writes our real shortcuts as bare links (no menuCategory is set):
 * "$SMPROGRAMS\One Trick.lnk" and "$DESKTOP\One Trick.lnk". Any cleanup command that names
 * either path — folder form or bare link — would delete the live shortcut.
 */
function touchesRealShortcut(line: string): boolean {
    return /\$SMPROGRAMS\\One Trick/i.test(line) || /\$DESKTOP\\One Trick\.lnk/i.test(line);
}

function selfTestGuards(): void {
    const fixture = [
        '!macro customInstall',
        '  Delete "$DESKTOP\\Inside.lnk"',
        '!macroend',
        'Delete "$DESKTOP\\Outside.lnk"',
    ].join('\n');
    const block = readMacro(fixture, 'customInstall');
    assert(block.length === 1 && block[0].includes('Inside.lnk'), 'macro reader keeps lines inside the block only');
    assert(!block.some((line) => line.includes('Outside.lnk')), 'macro reader stops at !macroend');
    assert(readMacro('!macro customInstall\n  Delete "$DESKTOP\\A.lnk"', 'customInstall').length === 0, 'an unterminated macro yields no lines');

    assert(touchesRealShortcut('Delete "$SMPROGRAMS\\One Trick.lnk"'), 'guard rejects our bare Start Menu link');
    assert(touchesRealShortcut('RMDir /r "$SMPROGRAMS\\One Trick"'), 'guard rejects the real Start Menu folder form');
    assert(touchesRealShortcut('Delete "$DESKTOP\\One Trick.lnk"'), 'guard rejects our real desktop link');
    assert(!touchesRealShortcut('Delete "$SMPROGRAMS\\OneTrickLink.lnk"'), 'guard allows the stale Start Menu root link');
}

function main(): void {
    const source = fs.readFileSync(NSH, 'utf8');
    const install = readMacro(source, 'customInstall');
    assert(install.length > 0, `!macro customInstall ... !macroend found in ${NSH}`);
    const block = install.join('\n');

    selfTestGuards();

    /* 0. The cleanup only runs on upgrade: nothing can be stale on a fresh install. */
    assert(/\$\{if\}\s+\$\{isUpdated\}/i.test(block), 'customInstall must guard the stale-launcher cleanup with ${if} ${isUpdated}');
    assert(/\$\{endif\}/i.test(block), 'the ${if} ${isUpdated} guard must be closed with ${endif}');

    /* 1. Desktop shortcuts the app never made. */
    for (const line of [
        'Delete "$DESKTOP\\OneTrickLink.lnk"',
        'Delete "$DESKTOP\\OneTrickLink.lnk.lnk"',
    ]) {
        assert(block.includes(line), `customInstall must contain: ${line}`);
    }

    /* 2. The stale link inside the old "OneTrick" Start Menu group, and in the Start Menu root. */
    assert(
        block.includes('Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"'),
        'customInstall must delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"'
    );
    assert(
        block.includes('Delete "$SMPROGRAMS\\OneTrickLink.lnk"'),
        'customInstall must delete "$SMPROGRAMS\\OneTrickLink.lnk"'
    );

    /* 3. That group goes away only when empty: plain RMDir, never RMDir /r. */
    assert(
        install.some((line) => /^RMDir\s+"\$SMPROGRAMS\\OneTrick"$/i.test(line)),
        'customInstall must run a non-recursive RMDir "$SMPROGRAMS\\OneTrick"'
    );
    assert(
        !commands(source, /\bRMDir\b/i).some((line) => /\/r\b/i.test(line) && /\$SMPROGRAMS\\OneTrick\b/i.test(line)),
        'the "OneTrick" Start Menu group must never be deleted recursively'
    );

    /* 4. The delete must come before the RMDir, or the empty-group removal silently no-ops. */
    const linkIndex = install.findIndex((line) => line === 'Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"');
    const rmdirIndex = install.findIndex((line) => /^RMDir\s+"\$SMPROGRAMS\\OneTrick"$/i.test(line));
    assert(linkIndex !== -1 && rmdirIndex !== -1 && linkIndex < rmdirIndex, 'the stale OneTrick link is deleted before RMDir "$SMPROGRAMS\\OneTrick"');

    /* 5. Never touch our real shortcuts, created under the "One Trick" name. */
    for (const line of commands(source, /\b(RMDir|Delete)\b/i)) {
        assert(!touchesRealShortcut(line), `installer cleanup must not touch our real shortcut: ${line}`);
    }

    /* 6. Legacy protocol registrations, both spellings, user hive only. */
    for (const key of ['OneTrickLink', 'otclink']) {
        const call = `reg delete "HKCU\\Software\\Classes\\${key}" /f`;
        const matches = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line) && line.includes(call));
        assert(matches.length === 1, `customInstall must contain one nsExec::ExecToLog with: ${call}`);
        assert(matches[0].includes('|'), `the reg delete for ${key} must pipe away its exit code`);
    }

    /* 7. Every ExecToLog result is popped: exact stack pairing, not "a Pop exists somewhere". */
    const execLines = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line));
    const popLines = install.filter((line) => /^Pop\s+\$0$/i.test(line));
    assert(
        execLines.length === popLines.length,
        `every nsExec::ExecToLog must be followed by a Pop $0 (${execLines.length} ExecToLog, ${popLines.length} Pop)`
    );

    const regDeletes = commands(source, /\breg\s+delete\b/i);
    for (const line of regDeletes) {
        assert(!/One Trick/i.test(line), `registry cleanup must not touch the real app name: ${line}`);
        assert(!/HKLM|HKEY_LOCAL_MACHINE/i.test(line), `registry cleanup must stay in HKCU: ${line}`);
        assert(/OneTrickLink|otclink/i.test(line), `unexpected registry cleanup target: ${line}`);
    }
    assert(regDeletes.length === 2, `installer must touch exactly the two stale protocol keys (found ${regDeletes.length})`);

    /* 8. The guard must actually run in release builds. */
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8')) as { scripts?: Record<string, string> };
    assert(typeof pkg.scripts?.['verify:stale-launcher'] === 'string', 'package.json has a verify:stale-launcher script');
    assert((pkg.scripts?.['verify:release'] ?? '').includes('verify:stale-launcher'), 'verify:release runs verify:stale-launcher');

    console.log(`verify:stale-launcher ok (${install.length} customInstall commands scanned)`);
}

main();
