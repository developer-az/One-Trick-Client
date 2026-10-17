import fs from 'fs';
import path from 'path';
import { distDirForAppPath, distRelativeFromElectronMain } from './electron/path-logic';

function assert(c: unknown, m: string): void {
    if (!c) {
        console.error('FAIL', m);
        process.exit(1);
    }
}

const root = path.resolve('.');
const dist = distDirForAppPath(root);
assert(dist === path.join(root, 'dist'), `dist dir ${dist}`);

const mainJs = path.join(root, 'dist-electron', 'electron', 'main.js');
assert(fs.existsSync(mainJs), `compiled main at ${mainJs}`);

const rel = path.relative(path.dirname(mainJs), dist);
assert(rel === distRelativeFromElectronMain(), `main.js → dist relative path is ${rel}`);

const indexHtml = path.join(dist, 'index.html');
const overlayHtml = path.join(dist, 'overlay.html');
if (fs.existsSync(indexHtml)) {
    assert(fs.existsSync(overlayHtml), `missing ${overlayHtml}`);
}

console.log('verify:electron-paths ok');
