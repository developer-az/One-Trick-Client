/**
 * Pure helpers for identifying test builds. No Electron import: verify_build_info.ts
 * imports this module directly with tsx.
 */

/** Read `testBuildLabel` from a parsed package.json, sanitized for display. */
export function readTestBuildLabel(pkg: unknown): string | null {
    if (typeof pkg !== 'object' || pkg === null) return null;
    const raw = (pkg as { testBuildLabel?: unknown }).testBuildLabel;
    if (typeof raw !== 'string') return null;
    const label = raw.trim().replace(/[\r\n]+/g, ' ').slice(0, 60).trim();
    return label.length > 0 ? label : null;
}

/** Main window title: unchanged for normal builds, labelled for test builds. */
export function windowTitleFor(label: string | null): string {
    return label === null ? 'One Trick' : `One Trick · TEST BUILD ${label}`;
}

/** Explanation shown when this test build loses the single-instance lock. */
export function secondInstanceMessage(label: string): { title: string; body: string } {
    return {
        title: 'Another One Trick is already running',
        body:
            'Another One Trick is already running (probably the installed version). ' +
            `This test build (${label}) cannot start until it is closed.\n\n` +
            'To close it: open Task Manager > Details, end every OneTrick.exe, ' +
            'then start this one again.',
    };
}
