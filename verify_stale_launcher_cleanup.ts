/**
 * Installer guard: One Trick never creates an "OneTrickLink" shortcut and registers no
 * OneTrickLink/otclink protocol. Older installs left one behind, so every installer run has to
 * delete it instead of leaving the Start Menu pointing at a dead target.
 *
 * Run: npm run verify:stale-launcher
 */

import { deepStrictEqual } from 'node:assert';
import fs from 'node:fs';

const NSH = 'build/installer.nsh';
const PKG = 'package.json';
const RELEASE_WORKFLOW = '.github/workflows/release.yml';

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
 * Every conditional form NSIS offers that could make the cleanup run "sometimes": LogicLib
 * ${If}/${Unless}/... blocks, the !-preprocessor, and the runtime branch instructions. A guard
 * written in any of them is rejected, not just ${if} ${isUpdated}.
 */
const CONDITIONALS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
    { kind: 'LogicLib ${...}', pattern: /\$\{(?:if|ifnot|unless|else|elseif|endif|endunless|isupdated)\b/i },
    { kind: '!-preprocessor', pattern: /^\s*!(?:if|ifdef|ifndef|else|endif|undef)\b/i },
    { kind: 'runtime branch', pattern: /^\s*(?:IfFileExists|IfErrors|StrCmpS?|IntCmp|Goto|Return|Abort)\b/i },
];

/** Conditional lines in a source. Comment lines are ignored: a commented-out guard is not a guard. */
function conditionals(source: string): Array<{ kind: string; line: string }> {
    const found: Array<{ kind: string; line: string }> = [];
    for (const line of lines(source)) {
        const match = CONDITIONALS.find(({ pattern }) => pattern.test(line));
        if (match) found.push({ kind: match.kind, line });
    }
    return found;
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
    assert(touchesRealShortcut('RMDir /r "$DESKTOP\\One Trick"'), 'guard rejects the real desktop folder form');
    assert(!touchesRealShortcut('Delete "$SMPROGRAMS\\OneTrickLink.lnk"'), 'guard allows the stale Start Menu root link');
    assert(!touchesRealShortcut('Delete "$DESKTOP\\OneTrickLink.lnk"'), 'guard allows the stale desktop link');
    assert(!touchesRealShortcut('RMDir "$DESKTOP\\OneTrick"'), 'guard allows the stale desktop folder name');

    /* Negative self-tests: a guarded macro body must be rejected in every spelling. */
    const unlessGuard = [
        '!macro customInstall',
        '  ${Unless} ${FileExists} "$DESKTOP\\OneTrickLink.lnk"',
        '  Delete "$DESKTOP\\OneTrickLink.lnk"',
        '  ${EndUnless}',
        '!macroend',
    ].join('\n');
    assert(conditionals(unlessGuard).length > 0, 'conditional scan rejects a ${Unless} ... ${EndUnless} guard');
    assert(conditionals('!macro customInstall\n  !ifdef SOMETHING\n  Delete "$DESKTOP\\x.lnk"\n  !endif\n!macroend').length > 0, 'conditional scan rejects !ifdef');
    assert(conditionals('!macro customInstall\n  IfFileExists "$DESKTOP\\x.lnk" 0 +2\n  Delete "$DESKTOP\\x.lnk"\n!macroend').length > 0, 'conditional scan rejects IfFileExists');
    assert(conditionals('!macro customInstall\n  StrCmp $0 "" 0 +2\n  Delete "$DESKTOP\\x.lnk"\n!macroend').length > 0, 'conditional scan rejects StrCmp');
    assert(conditionals('!macro customInstall\n  ; ${Unless} in a comment is not a guard\n  Delete "$DESKTOP\\x.lnk"\n!macroend').length === 0, 'conditional scan ignores pure-comment lines');
}

function main(): void {
    const source = fs.readFileSync(NSH, 'utf8');
    const install = readMacro(source, 'customInstall');
    assert(install.length > 0, `!macro customInstall ... !macroend found in ${NSH}`);

    selfTestGuards();

    /* 0. No guard of any kind. Every command here is a no-op when its target is absent, so the
     *    cleanup has to run on every installer run. An isUpdated guard was dead code: that flag
     *    is only passed by electron-updater, which this app does not ship, so a newer installer
     *    over an old install would never clean anything. Whole-file scan: it covers both the
     *    customInstall slice and the raw file around it, so a runtime skip cannot hide in
     *    customUnInstall or between macros either. */
    const guards = conditionals(source);
    assert(
        guards.length === 0,
        `installer must never conditionally guard the stale-launcher cleanup (${guards[0]?.kind}: ${guards[0]?.line})`
    );

    /* 1. Exactly one customInstall macro: readMacro reads the first definition only, so a second
     *    one could smuggle a guarded duplicate past every check below. */
    const macroCount = (source.match(/!macro\s+customInstall\b/gi) ?? []).length;
    assert(macroCount === 1, `installer must define exactly one !macro customInstall (found ${macroCount})`);

    const indexOf = (predicate: (line: string) => boolean, what: string): number => {
        const found = install.findIndex(predicate);
        assert(found !== -1, `customInstall must contain ${what}`);
        return found;
    };

    /* 2. Exact-set pin: these are the only Delete commands allowed to target a One* name on the
     *    desktop or in the Start Menu. Anything extra or different — a wildcard like
     *    "$DESKTOP\One*.lnk" that would also eat the live "$DESKTOP\One Trick.lnk", or a spaced
     *    "One Trick" target — needs a provenance note in the installer.nsh comment before it may
     *    be added here. The filter is deliberately wider than /OneTrick/: a wildcard target never
     *    spells "OneTrick" but still resolves to our real shortcut. */
    const oneTrickDeletes = install.filter(
        (line) => /^Delete\b/i.test(line) && /\$(?:DESKTOP|SMPROGRAMS)\\[^"]*One/i.test(line)
    );
    const expectedDeletes = [
        'Delete "$DESKTOP\\OneTrickLink.lnk"',
        'Delete "$DESKTOP\\OneTrickLink.lnk.lnk"',
        'Delete "$SMPROGRAMS\\OneTrick\\OneTrickLink.lnk"',
        'Delete "$SMPROGRAMS\\OneTrickLink.lnk"',
    ];
    try {
        deepStrictEqual(oneTrickDeletes, expectedDeletes);
    } catch {
        assert(
            false,
            `customInstall must delete exactly these OneTrick links, in order: ${expectedDeletes.join(' | ')}`
            + ` — found: ${oneTrickDeletes.length > 0 ? oneTrickDeletes.join(' | ') : 'none'}.`
            + ' Any extra or differing OneTrick delete needs provenance in the installer.nsh comment.'
        );
    }

    /* 3. Each required cleanup command, located once so its scope and order can be pinned. */
    const deleteIndexes = expectedDeletes.map((expected) => indexOf((line) => line === expected, expected));
    const rmdirIndex = indexOf((line) => /^RMDir\s+"\$SMPROGRAMS\\OneTrick"$/i.test(line), 'a non-recursive RMDir "$SMPROGRAMS\\OneTrick"');

    /* 4. That group goes away only when empty: plain RMDir, never RMDir /r. Whole-file scope: a
     *    recursive delete added in customUnInstall or any other macro is just as destructive. */
    const recursiveRmdirs = commands(source, /\bRMDir\b/i).filter((line) => /\/r\b/i.test(line) && /\$SMPROGRAMS\\OneTrick\b/i.test(line));
    assert(recursiveRmdirs.length === 0, `the "OneTrick" Start Menu group must never be deleted recursively: ${recursiveRmdirs[0]}`);

    /* 5. Every stale link is deleted before the empty-group RMDir, or that RMDir silently no-ops. */
    for (const index of deleteIndexes) {
        assert(index < rmdirIndex, 'every stale OneTrick link is deleted before RMDir "$SMPROGRAMS\\OneTrick"');
    }

    /* 6. Legacy protocol registrations, both spellings, user hive only, after the shortcut cleanup. */
    for (const key of ['OneTrickLink', 'otclink']) {
        const call = `reg delete "HKCU\\Software\\Classes\\${key}" /f`;
        const matches = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line) && line.includes(call));
        assert(matches.length === 1, `customInstall must contain one nsExec::ExecToLog with: ${call}`);
        assert(matches[0].includes('|'), `the reg delete for ${key} must pipe away its exit code`);
        const regIndex = indexOf((line) => line === matches[0], `the nsExec::ExecToLog with: ${call}`);
        assert(regIndex > rmdirIndex, `the ${key} reg delete must follow the shortcut cleanup`);
    }

    /* 7. Every ExecToLog result is popped on the very next line — exact stack pairing, not
     *    "a Pop exists somewhere": ExecToLog A; ExecToLog B; Pop $0; Pop $0 must not pass. */
    const execCount = install.filter((line) => /^nsExec::ExecToLog\b/i.test(line)).length;
    const popCount = install.filter((line) => /^Pop\s+\$0$/i.test(line)).length;
    install.forEach((line, index) => {
        if (/^nsExec::ExecToLog\b/i.test(line)) {
            assert(
                /^Pop\s+\$0$/i.test(install[index + 1] ?? ''),
                `nsExec::ExecToLog at install line ${index} must be followed immediately by Pop $0: ${line}`
            );
        }
    });
    assert(execCount === popCount, `stray Pop $0 in customInstall (${execCount} ExecToLog, ${popCount} Pop)`);

    /* 8. Never touch our real shortcuts. Scoped to customInstall: the unrelated Pyke Dominator
     *    cleanup has no "One Trick" paths, and keeping the check on this block makes any failure
     *    message about the One Trick cleanup precise. */
    for (const line of install.filter((line) => /\b(RMDir|Delete)\b/i.test(line))) {
        assert(!touchesRealShortcut(line), `customInstall must not touch our real shortcut: ${line}`);
    }

    /* 9. Registry cleanup stays in HKCU and never names the real app. Whole-file scope: a reg
     *    delete added anywhere in the installer is still our responsibility. */
    const regDeletes = commands(source, /\breg\s+delete\b/i);
    for (const line of regDeletes) {
        assert(!/One Trick/i.test(line), `registry cleanup must not touch the real app name: ${line}`);
        assert(!/HKLM|HKEY_LOCAL_MACHINE/i.test(line), `registry cleanup must stay in HKCU: ${line}`);
        assert(/OneTrickLink|otclink/i.test(line), `unexpected registry cleanup target: ${line}`);
    }
    assert(regDeletes.length === 2, `installer must touch exactly the two stale protocol keys (found ${regDeletes.length})`);

    /* 10. The guard must actually run in release builds: the macro has to be included by
     *     electron-builder and the verifier has to run in CI. Both strings alone are not enough,
     *     because dropping build.nsis.include ships an installer without the cleanup. */
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8')) as {
        scripts?: Record<string, string>;
        build?: { nsis?: { include?: string } };
    };
    assert(typeof pkg.scripts?.['verify:stale-launcher'] === 'string', 'package.json has a verify:stale-launcher script');
    assert((pkg.scripts?.['verify:release'] ?? '').includes('verify:stale-launcher'), 'verify:release runs verify:stale-launcher');
    assert(pkg.build?.nsis?.include === 'build/installer.nsh', 'package.json build.nsis.include is build/installer.nsh');
    const release = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');
    assert(
        /^\s*run:\s*npm run verify:stale-launcher\s*$/m.test(release),
        `${RELEASE_WORKFLOW} must run "npm run verify:stale-launcher" as its own step`
    );

    const deletes = install.filter((line) => /^Delete\b/i.test(line)).length;
    const rmdirs = install.filter((line) => /^RMDir\b/i.test(line)).length;
    console.log(
        `verify:stale-launcher ok — customInstall: ${deletes} Delete, ${rmdirs} RMDir,`
        + ` ${execCount} nsExec::ExecToLog, ${popCount} Pop $0, ${oneTrickDeletes.length} OneTrick delete`
        + ` | whole file: ${commands(source, /\bRMDir\b/i).length} RMDir, ${regDeletes.length} reg delete,`
        + ` ${guards.length} conditionals`
    );
}

main();
