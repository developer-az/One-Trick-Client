// Overlay settings detection: registry parsers, game.cfg discovery, advice rules.
import { mpoOffFromReg, windowedOptimizationsFromReg } from './electron/environment';
import { installCfgFromProductSettings } from './electron/league-settings';
import { overlaySettingsAdvice } from './src/app/overlayAdvice';

let failed = 0;
const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'ok' : 'FAIL'} ${name}`);
    if (!ok) failed++;
};

const regLine = (v: string): string =>
    `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\Dwm\r\n    OverlayTestMode    REG_DWORD    ${v}\r\n\r\n`;
check('MPO off when OverlayTestMode=0x5', mpoOffFromReg(regLine('0x5')) === true);
check('MPO on when OverlayTestMode=0x0', mpoOffFromReg(regLine('0x0')) === false);
check('MPO on when value is missing', mpoOffFromReg('') === false);

const dx = (s: string): string => `\r\n    DirectXUserGlobalSettings    REG_SZ    ${s}\r\n`;
check('windowed optimizations on', windowedOptimizationsFromReg(dx('SwapEffectUpgradeEnable=1;')) === true);
check('windowed optimizations off', windowedOptimizationsFromReg(dx('VRROptimizeEnable=0;SwapEffectUpgradeEnable=0;')) === false);
check('windowed optimizations unknown when never set', windowedOptimizationsFromReg('') === null);

const cfg = installCfgFromProductSettings('product_install_full_path: "D:/Games/Riot Games/League of Legends"\r\nother: x');
check('game.cfg path from Riot product settings', !!cfg && /League of Legends[\\/]Config[\\/]game\.cfg$/.test(cfg) && cfg.startsWith('D:'));
check('no path when the key is absent', installCfgFromProductSettings('foo: bar') === null);

const ids = (env: Parameters<typeof overlaySettingsAdvice>[0]): string =>
    overlaySettingsAdvice(env).map((a) => a.id).join(',');
check('all good -> no advice', ids({ windowMode: 'borderless', mpoOff: true, windowedGameOptimizations: false }) === '');
check('never-set optimizations are not flagged', ids({ windowMode: 'windowed', mpoOff: true, windowedGameOptimizations: null }) === '');
check('fullscreen + optimizations + MPO all flagged', ids({ windowMode: 'fullscreen', mpoOff: false, windowedGameOptimizations: true }) === 'fullscreen,windowed-optimizations,mpo');
check('unknown mode flagged', ids({ windowMode: null, mpoOff: true, windowedGameOptimizations: false }) === 'unknown-mode');
check('every advice has a fix', overlaySettingsAdvice({ windowMode: 'fullscreen', mpoOff: false, windowedGameOptimizations: true }).every((a) => a.fix.length > 20));

if (failed) {
    console.log(`${failed} failed`);
    process.exit(1);
}
console.log('verify_overlay_environment: all ok');
