import os from 'os';
import path from 'path';
import { app } from 'electron';
import { distDirForAppPath } from './path-logic';

/** Application root (package.json), packaged or dev. */
export function appRoot(): string {
    return app.getAppPath();
}

export function distDir(): string {
    return distDirForAppPath(appRoot());
}

export function publicDir(): string {
    return app.isPackaged ? distDir() : path.join(appRoot(), 'public');
}

export function buildIconCandidates(): string[] {
    const pub = publicDir();
    const build = path.join(appRoot(), 'build');
    return [
        path.join(pub, 'icon.ico'),
        path.join(pub, 'icon.png'),
        path.join(build, 'icon.ico'),
        path.join(build, 'icon.png'),
    ];
}

export function nativeKeyHookPath(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'onetrick-keys.exe');
    }
    return path.join(appRoot(), 'native', 'bin', 'onetrick-keys.exe');
}

/** Application user data directory, with graceful fallback for test harnesses outside Electron. */
export function userDataDir(): string {
    try {
        if (typeof app?.getPath === 'function') return app.getPath('userData');
    } catch {
        // Fallback for tests / non-Electron environments
    }
    return process.env.ONETRICK_USER_DATA || path.join(os.tmpdir(), 'onetrick-userdata');
}

export { distDirForAppPath } from './path-logic';
