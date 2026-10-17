import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export const APP_DISPLAY_NAME = 'One Trick';
export const APP_USER_MODEL_ID = 'com.onetrick.app';

/** Older installs used npm package name or product title for AppData and shortcuts. */
const LEGACY_USER_DATA_DIR_NAMES = ['pyke-dominator', 'Pyke Dominator', 'pyke dominator'];

function migrateLegacyUserData(targetDir: string): void {
    if (fs.existsSync(targetDir)) return;
    const appData = app.getPath('appData');
    for (const legacyName of LEGACY_USER_DATA_DIR_NAMES) {
        const legacyDir = path.join(appData, legacyName);
        if (!fs.existsSync(legacyDir)) continue;
        try {
            fs.cpSync(legacyDir, targetDir, { recursive: true });
            return;
        } catch {
            // Fall through — fresh userData is still usable.
        }
    }
}

/** Must run before any `app.getPath('userData')` or `app.ready`. */
export function configureAppBranding(): void {
    if (process.platform === 'win32') {
        app.setAppUserModelId(APP_USER_MODEL_ID);
    }
    app.setName(APP_DISPLAY_NAME);

    const userDataDir = path.join(app.getPath('appData'), APP_DISPLAY_NAME);
    migrateLegacyUserData(userDataDir);
    app.setPath('userData', userDataDir);
}

configureAppBranding();
