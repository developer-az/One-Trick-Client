/**
 * Settings outside One Trick that can stop ANY overlay from showing over
 * League: exclusive fullscreen, Windows 11 flip-model upgrades, and MPO. Each
 * problem comes with the exact fix, in the user's words.
 */
export interface OverlaySettingsEnv {
    windowMode: 'fullscreen' | 'windowed' | 'borderless' | null;
    mpoOff: boolean | null;
    windowedGameOptimizations: boolean | null;
}

export interface OverlayAdvice {
    id: 'fullscreen' | 'unknown-mode' | 'windowed-optimizations' | 'mpo';
    problem: string;
    fix: string;
}

export function overlaySettingsAdvice(env: OverlaySettingsEnv): OverlayAdvice[] {
    const out: OverlayAdvice[] = [];
    if (env.windowMode === 'fullscreen') {
        out.push({
            id: 'fullscreen',
            problem: 'League is set to Fullscreen. Windows lets nothing draw over a fullscreen game, so the overlay cannot show.',
            fix: 'In game: Esc → Video → Window Mode → Windowed (at your screen resolution) or Borderless.',
        });
    } else if (env.windowMode === null) {
        out.push({
            id: 'unknown-mode',
            problem: 'One Trick could not find League’s settings file, so it cannot check the display mode.',
            fix: 'Make sure League is not in Fullscreen: Esc → Video → Window Mode → Windowed or Borderless.',
        });
    }
    if (env.windowedGameOptimizations === true) {
        out.push({
            id: 'windowed-optimizations',
            problem: 'Windows “Optimizations for windowed games” is on. It can make Windows stop drawing overlays over League mid-game.',
            fix: 'Settings → System → Display → Graphics → Change default graphics settings → turn Optimizations for windowed games off.',
        });
    }
    if (env.mpoOff === false) {
        out.push({
            id: 'mpo',
            problem: 'Multiplane overlay (MPO) is on. On some graphics drivers it hides overlays over games.',
            fix: 'In PowerShell as administrator: reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm /v OverlayTestMode /t REG_DWORD /d 5 /f — then restart the PC.',
        });
    }
    return out;
}
