import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Minimatch } from 'minimatch';

const INJECT_SCRIPT = 'scripts/inject-test-keys.ps1';

/**
 * Default exclusions copied from electron-builder 26 fileMatcher.ts so this
 * check evaluates the same pattern list the Windows build uses.
 */
const EXCLUDED_NAMES =
    '.git,.hg,.svn,CVS,RCS,SCCS,' +
    '__pycache__,.DS_Store,thumbs.db,.gitignore,.gitkeep,.gitattributes,.npmignore,' +
    '.idea,.vs,.flowconfig,.jshintrc,.eslintrc,.circleci,' +
    '.yarn-integrity,.yarn-metadata.json,yarn-error.log,yarn.lock,package-lock.json,npm-debug.log,pnpm-lock.yaml,' +
    'appveyor.yml,.travis.yml,circle.yml,.nyc_output,.husky,.github,electron-builder.env';
const EXCLUDED_EXTS = 'iml,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,suo,xproj,cc,d.ts,mk,a,o,obj,forge-meta,pdb';

const nodeRequire = createRequire(path.join(process.cwd(), 'package.json'));

function assert(c: unknown, m: string): void {
    if (!c) {
        console.error('FAIL', m);
        process.exit(1);
    }
}

type ExtraEntry = { from?: string; to?: string; filter?: string | string[] };

interface PackageBuild {
    productName: string;
    appId: string;
    files?: Array<string | ExtraEntry>;
    extraFiles?: ExtraEntry[];
    extraResources?: ExtraEntry[];
    directories?: { output?: string; buildResources?: string };
    win: { signAndEditExecutable: boolean; executableName: string };
}

function assembleAppPatterns(userPatterns: string[], buildResources: string, outDir: string): string[] {
    const patterns = userPatterns.map((pattern) => pattern.replace(/^\.\//, '').replace(/\\/g, '/'));
    const customFirst: string[] = [];
    const onlyIgnore = patterns.length > 0 && patterns.every((pattern) => pattern.startsWith('!'));
    if (patterns.length === 0 || onlyIgnore) customFirst.push('**/*');
    else if (!patterns.includes('package.json')) patterns.push('package.json');
    customFirst.push('!**/node_modules/**');
    if (buildResources && !buildResources.startsWith('.')) customFirst.push(`!${buildResources}{,/**/*}`);
    if (outDir && !outDir.startsWith('.')) customFirst.push(`!${outDir}{,/**/*}`);
    let insertIndex = 0;
    for (let i = patterns.length - 1; i >= 0; i--) {
        if (patterns[i].startsWith('**/')) {
            insertIndex = i + 1;
            break;
        }
    }
    patterns.splice(insertIndex, 0, ...customFirst);
    patterns.push(`!**/*.{${EXCLUDED_EXTS}}`);
    patterns.push('!**/._*');
    patterns.push('!**/electron-builder.{yaml,yml,json,json5,toml,ts}');
    patterns.push(`!**/{${EXCLUDED_NAMES}}`);
    patterns.push('!.yarn{,/**/*}');
    patterns.push('!.editorconfig');
    patterns.push('!.yarnrc.yml');
    return patterns;
}

/** Same include/exclude walk electron-builder uses in minimatchAll. */
function fileIncluded(relPath: string, patterns: string[]): boolean {
    let match = false;
    for (const pattern of patterns) {
        const parsed = new Minimatch(pattern, { dot: true });
        if (match !== parsed.negate) continue;
        match = parsed.match(relPath, false);
    }
    return match;
}

function stringPatterns(entries: Array<string | ExtraEntry> | undefined): string[] {
    if (!entries) return [];
    return entries.filter((entry): entry is string => typeof entry === 'string');
}

function entryCopiesScript(entry: ExtraEntry): boolean {
    const raw = (entry.from ?? '.').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (raw === '' || raw === '.') return true;
    if (raw === INJECT_SCRIPT || raw.endsWith(`/${INJECT_SCRIPT}`)) return true;
    return INJECT_SCRIPT.startsWith(`${raw}/`);
}

function collectInjectionScripts(dir: string): string[] {
    const hits: string[] = [];
    const asar = nodeRequire('@electron/asar') as { listPackage: (archivePath: string) => string[] };
    const walk = (current: string): void => {
        for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, ent.name);
            if (ent.isDirectory()) {
                walk(full);
                continue;
            }
            const rel = full.replace(/\\/g, '/');
            if (ent.name === 'inject-test-keys.ps1' || rel.endsWith('/inject-test-keys.ps1')) hits.push(full);
            if (ent.name.endsWith('.asar')) {
                for (const packed of asar.listPackage(full)) {
                    if (packed.replace(/\\/g, '/').includes('inject-test-keys.ps1')) hits.push(`${full}:${packed}`);
                }
            }
        }
    };
    walk(dir);
    return hits;
}

async function selfTestArtifactScan(): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-pack-guard-'));
    try {
        const loose = path.join(root, 'loose');
        fs.mkdirSync(loose);
        fs.writeFileSync(path.join(loose, 'inject-test-keys.ps1'), 'test');
        assert(collectInjectionScripts(loose).length === 1, 'loose inject-test-keys.ps1 must fail the packaging scan');

        const src = path.join(root, 'src');
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(src, 'inject-test-keys.ps1'), 'test');
        const asar = nodeRequire('@electron/asar') as {
            createPackage: (source: string, dest: string) => Promise<void>;
        };
        const packed = path.join(root, 'packed');
        fs.mkdirSync(packed);
        await asar.createPackage(src, path.join(packed, 'app.asar'));
        const packedHits = collectInjectionScripts(packed);
        assert(
            packedHits.some((hit) => hit.includes('inject-test-keys.ps1')),
            'inject-test-keys.ps1 inside app.asar must fail the packaging scan'
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function main(): Promise<void> {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
        name: string;
        version: string;
        build: PackageBuild;
    };

    assert(pkg.name === 'one-trick', `package name ${pkg.name}`);
    assert(pkg.version === '1.6.5', `package version ${pkg.version}`);
    assert(pkg.build.productName === 'One Trick', `productName ${pkg.build.productName}`);
    assert(pkg.build.appId === 'com.onetrick.app', `appId ${pkg.build.appId}`);
    assert(pkg.build.win.executableName === 'OneTrick', `executableName ${pkg.build.win.executableName}`);
    assert(pkg.build.win.signAndEditExecutable === true, 'win.signAndEditExecutable must embed icon.ico');
    assert(fs.existsSync('build/icon.ico'), 'build/icon.ico');
    assert(fs.statSync('build/icon.ico').size > 1000, 'build/icon.ico looks too small');
    assert(fs.existsSync('build/installer.nsh'), 'build/installer.nsh');
    assert(fs.existsSync(INJECT_SCRIPT), 'scripts/inject-test-keys.ps1 stays in the repo for tests');

    const files = pkg.build.files;
    assert(Array.isArray(files) && files.length > 0, 'build.files must be set so electron-builder does not pack **/*');
    const userPatterns = stringPatterns(files);
    assert(
        userPatterns.includes(`!${INJECT_SCRIPT}`),
        'build.files must negate scripts/inject-test-keys.ps1'
    );
    for (const entry of files) {
        if (typeof entry !== 'string') {
            assert(!entryCopiesScript(entry), `build.files entry copies ${INJECT_SCRIPT}`);
        }
    }
    for (const group of [pkg.build.extraFiles, pkg.build.extraResources]) {
        for (const entry of group ?? []) {
            assert(!entryCopiesScript(entry), `extra file entry copies ${INJECT_SCRIPT}: ${entry.from ?? '.'}`);
        }
    }

    const patterns = assembleAppPatterns(
        userPatterns,
        pkg.build.directories?.buildResources ?? 'build',
        pkg.build.directories?.output ?? 'release'
    );
    assert(!fileIncluded(INJECT_SCRIPT, patterns), `${INJECT_SCRIPT} is included by electron-builder files`);
    assert(
        fileIncluded('electron/scripts/mayhem-ocr.ps1', patterns),
        'electron/scripts must stay in the package'
    );
    assert(fileIncluded(INJECT_SCRIPT, assembleAppPatterns(['**/*'], 'build', 'release')), 'packaging guard detects a permissive files list');
    const negationFirst = assembleAppPatterns([`!${INJECT_SCRIPT}`, '**/*'], 'build', 'release');
    assert(
        fileIncluded(INJECT_SCRIPT, negationFirst),
        'a **/* pattern after the negation must still be reported as inclusion'
    );

    const shipped = pkg.build.extraFiles ?? [];
    const shippedTo = new Set(shipped.map((entry) => entry.to));
    for (const required of ['INSTALL.txt', 'THIRD_PARTY_NOTICES.txt', 'licenses/GPL-3.0.txt']) {
        assert(shippedTo.has(required), `extraFiles must ship ${required}`);
    }
    for (const entry of shipped) {
        assert(entry.from && fs.existsSync(entry.from), `extraFiles source missing: ${entry.from}`);
    }
    const notices = fs.readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8');
    assert(notices.includes('GPL-3.0'), 'THIRD_PARTY_NOTICES must name GPL-3.0');
    assert(notices.includes('e38092ef93'), 'THIRD_PARTY_NOTICES must point at the FFmpeg source commit');
    assert(notices.includes('libx264'), 'THIRD_PARTY_NOTICES must name the GPL library that makes this a GPL build');
    assert(/source offer/i.test(notices), 'THIRD_PARTY_NOTICES must include the GPL source offer');
    const install = fs.readFileSync('packaging/INSTALL.txt', 'utf8');
    assert(install.includes('GPL-3.0') && install.includes('THIRD_PARTY_NOTICES.txt'), 'INSTALL.txt must carry the FFmpeg notice');
    const about = fs.readFileSync('website/src/pages/AboutPage.tsx', 'utf8');
    assert(about.includes('GPL-3.0'), 'about screen must carry the FFmpeg GPL notice');
    const shell = fs.readFileSync('src/app/App.tsx', 'utf8');
    assert(shell.includes('GPL-3.0'), 'desktop shell must carry the FFmpeg GPL notice');

    await selfTestArtifactScan();

    const releaseDir = pkg.build.directories?.output ?? 'release';
    if (fs.existsSync(releaseDir)) {
        const hits = collectInjectionScripts(releaseDir);
        assert(hits.length === 0, `inject-test-keys.ps1 was packaged:\n${hits.join('\n')}`);
        console.log(`verify:packaging scanned ${releaseDir}`);
    } else {
        console.log('verify:packaging pattern check only (no release directory yet)');
    }

    console.log('verify:packaging ok');
}

void main();
