import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { nativeKeyHookPath } from './paths';

/** Dev builds: copy onetrick-keys.exe from an installed One Trick if local build is missing. */
export function ensureKeyhookBinary(): boolean {
    if (process.platform !== 'win32') return false;
    const target = nativeKeyHookPath();
    if (fs.existsSync(target)) return true;

    const local = process.env.LOCALAPPDATA || '';
    const sources = [
        path.join(local, 'Programs', 'One Trick', 'resources', 'onetrick-keys.exe'),
        path.join(local, 'Programs', 'one-trick', 'resources', 'onetrick-keys.exe'),
        path.join(app.getAppPath(), 'native', 'bin', 'onetrick-keys.exe'),
    ];

    for (const src of sources) {
        try {
            if (!src || src === target || !fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(src, target);
            return true;
        } catch {
            // try next source
        }
    }
    return false;
}
