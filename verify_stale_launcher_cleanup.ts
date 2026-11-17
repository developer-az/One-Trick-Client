/**
 * Installer guard: One Trick never creates an "OneTrickLink" shortcut and registers no
 * OneTrickLink/otclink protocol. Older installs left one behind, so upgrading in place has to
 * delete it instead of leaving the Start Menu pointing at a dead target.
 *
 * Run: npm run verify:stale-launcher
 */

import fs from 'fs';

const NSH = 'build/installer.nsh';

function assert(cond: unknown, msg: string): void {
    if (!cond) {
        console.error('FAIL', msg);
        process.exit(1);
    }
}

/**
 * Minimal NSIS macro reader: returns the trimmed, non-comment lines between
 * "!macro <name>" and the next "!macroend". Comment lines are dropped so a
 * commented-out command can never satisfy a check.
 */
function readMacro(source: string, name: string): string[] {
    const lines = source.split(/\r?\n/);
    const open = new RegExp(`^\\s*!macro\\s+${name}\\s*$`, 'i');
    const start = lines.findIndex((line) => open.test(line));
    if (start === -1) return [];
    const end = lines.findIndex((line, index) => index > start && /^\s*!macroend\b/i.test(line));
    if (end === -1) return [];
    return lines
        .slice(start + 1, end)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(';'));
}

/** Every RMDir/Delete command in the file, with its arguments intact. */
function commands(source: string, verb: RegExp): string[] {
    return source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(';') && verb.test(line));
}

function selfTestMacroReader(): void {
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
}

function main(): void {
    const source = fs.readFileSync(NSH, 'utf8');
    const install = readMacro(source, 'customInstall');
    assert(install.length > 0, `!macro customInstall ... !macroend found in ${NSH}`);
    const block = install.join('\n');

    selfTestMacroReader();

    /* 1. Desktop shortcuts the app never made. */
    for (const line of [
        'Delete "$DESKTOP\\OneTrickLink.lnk"',
        'Delete "$DESKTOP\\OneTrickLink.lnk.lnk"',
        'Delete "$DESKTOP\\One Trick Link.lnk"',
    ]) {
        assert(block.includes(line), `customInstall must contain: ${line}`);
    }

    /* 2. The stale link inside the old "OneTrick" Start Menu group. */
    assert(
        block.includes('Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"'),
        'customInstall must delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"'
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

    /* 4. Never touch our real shortcuts, created under the "One Trick" name. */
    for (const line of commands(source, /\b(RMDir|Delete)\b/i)) {
        assert(!/\$SMPROGRAMS\\One Trick(?:\\.|")/i.test(line), `installer cleanup must not touch the real Start Menu group: ${line}`);
        assert(!/\$DESKTOP\\One Trick\.lnk/i.test(line), `installer cleanup must not touch our real desktop shortcut: ${line}`);
    }

    /* 5. Legacy protocol registrations, both spellings, user hive only. */
    for (const key of ['OneTrickLink', 'otclink']) {
        const call = `reg delete "HKCU\\Software\\Classes\\${key}" /f`;
        const lines = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line) && line.includes(call));
        assert(lines.length === 1, `customInstall must contain one nsExec::ExecToLog with: ${call}`);
        assert(lines[0].includes('|'), `the reg delete for ${key} must pipe away its exit code`);
        assert(/^nsExec::ExecToLog\b/i.test(lines[0]) && install.includes('Pop $0'), 'nsExec result is popped, not left on the stack');
    }

    const regDeletes = commands(source, /\breg\s+delete\b/i);
    for (const line of regDeletes) {
        assert(!/One Trick/i.test(line), `registry cleanup must not touch the real app name: ${line}`);
        assert(!/HKLM|HKEY_LOCAL_MACHINE/i.test(line), `registry cleanup must stay in HKCU: ${line}`);
        assert(/OneTrickLink|otclink/i.test(line), `unexpected registry cleanup target: ${line}`);
    }
    assert(regDeletes.length === 2, `installer must touch exactly the two stale protocol keys (found ${regDeletes.length})`);

    console.log(`verify:stale-launcher ok (${install.length} customInstall commands scanned)`);
}

main();
