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
 * either path — folder form or bare link — would delete the live shortcut. The desktop half is
 * deliberately delimiter-free so a reintroduced "$DESKTOP\One Trick Link.lnk" is caught too.
 */
function touchesRealShortcut(line: string): boolean {
    return /\$SMPROGRAMS\\One Trick/i.test(line) || /\$DESKTOP\\One Trick(?:\b|")/i.test(line);
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
    assert(touchesRealShortcut('Delete "$DESKTOP\\One Trick Link.lnk"'), 'guard rejects the spaced "One Trick Link" desktop name');
    assert(!touchesRealShortcut('Delete "$SMPROGRAMS\\OneTrickLink.lnk"'), 'guard allows the stale Start Menu root link');
    assert(!touchesRealShortcut('Delete "$DESKTOP\\OneTrickLink.lnk"'), 'guard allows the stale desktop link');
}

function main(): void {
    const source = fs.readFileSync(NSH, 'utf8');
    const install = readMacro(source, 'customInstall');
    assert(install.length > 0, `!macro customInstall ... !macroend found in ${NSH}`);

    selfTestGuards();

    /* 0. No flag guard. Every command here is a no-op when its target is absent, so the cleanup
     *    has to run on every installer run. An isUpdated guard was dead code: that flag is only
     *    passed by electron-updater, which this app does not ship, so a newer installer run over
     *    an old install would never clean anything. Conditionals are therefore rejected outright. */
    for (const line of install) {
        assert(
            !/\$\{(?:if|else|elseif|endif|isUpdated)\b/i.test(line),
            `customInstall must not conditionally guard the stale-launcher cleanup: ${line}`
        );
    }

    const indexOf = (predicate: (line: string) => boolean, what: string): number => {
        const found = install.findIndex(predicate);
        assert(found !== -1, `customInstall must contain ${what}`);
        return found;
    };

    /* 1. Each required cleanup command, located once so its scope and order can be pinned. */
    const deleteIndexes = [
        indexOf((line) => line === 'Delete "$DESKTOP\\OneTrickLink.lnk"', 'Delete "$DESKTOP\\OneTrickLink.lnk"'),
        indexOf((line) => line === 'Delete "$DESKTOP\\OneTrickLink.lnk.lnk"', 'Delete "$DESKTOP\\OneTrickLink.lnk.lnk"'),
        indexOf((line) => line === 'Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"', 'Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"'),
        indexOf((line) => line === 'Delete "$SMPROGRAMS\\OneTrickLink.lnk"', 'Delete "$SMPROGRAMS\\OneTrickLink.lnk"'),
    ];
    const rmdirIndex = indexOf((line) => /^RMDir\s+"\$SMPROGRAMS\\OneTrick"$/i.test(line), 'a non-recursive RMDir "$SMPROGRAMS\\OneTrick"');

    /* 2. That group goes away only when empty: plain RMDir, never RMDir /r. */
    assert(
        !install.some((line) => /\/r\b/i.test(line) && /\$SMPROGRAMS\\OneTrick\b/i.test(line)),
        'the "OneTrick" Start Menu group must never be deleted recursively'
    );

    /* 3. Every stale link is deleted before the empty-group RMDir, or that RMDir silently no-ops. */
    for (const index of deleteIndexes) {
        assert(index < rmdirIndex, 'every stale OneTrick link is deleted before RMDir "$SMPROGRAMS\\OneTrick"');
    }

    /* 4. Legacy protocol registrations, both spellings, user hive only, after the shortcut cleanup. */
    for (const key of ['OneTrickLink', 'otclink']) {
        const call = `reg delete "HKCU\\Software\\Classes\\${key}" /f`;
        const matches = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line) && line.includes(call));
        assert(matches.length === 1, `customInstall must contain one nsExec::ExecToLog with: ${call}`);
        assert(matches[0].includes('|'), `the reg delete for ${key} must pipe away its exit code`);
        const regIndex = indexOf((line) => line === matches[0], `the nsExec::ExecToLog with: ${call}`);
        assert(regIndex > rmdirIndex, `the ${key} reg delete must follow the shortcut cleanup`);
    }

    /* 5. Every ExecToLog result is popped: exact stack pairing, not "a Pop exists somewhere". */
    const execLines = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line));
    const popLines = install.filter((line) => /^Pop\s+\$0$/i.test(line));
    assert(
        execLines.length === popLines.length,
        `every nsExec::ExecToLog must be followed by a Pop $0 (${execLines.length} ExecToLog, ${popLines.length} Pop)`
    );

    /* 6. Never touch our real shortcuts. Scoped to customInstall: the unrelated Pyke Dominator
     *    cleanup above has no "One Trick" paths, and keeping the check on this block makes any
     *    failure message about the One Trick cleanup precise. */
    for (const line of install.filter((line) => /\b(RMDir|Delete)\b/i.test(line))) {
        assert(!touchesRealShortcut(line), `customInstall must not touch our real shortcut: ${line}`);
    }

    /* 7. Registry cleanup stays in HKCU and never names the real app. Whole-file scope: a reg
     *    delete added anywhere in the installer is still our responsibility. */
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
