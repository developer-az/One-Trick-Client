import path from 'path';

/** Vite build output (`index.html`, `overlay.html`, assets). */
export function distDirForAppPath(appPath: string): string {
    return path.join(appPath, 'dist');
}

/** Relative path from compiled `dist-electron/electron/main.js` to `dist/`. */
export function distRelativeFromElectronMain(): string {
    return path.join('..', '..', 'dist');
}
