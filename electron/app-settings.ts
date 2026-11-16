import { userDataDir } from './paths';
import fs from 'fs';
import path from 'path';

/* ------------------------------------------------------------ appearance */

/** Dashboard color theme. Gothic = the default ink-black chrome look. */
export type AppearanceTheme = 'gothic' | 'ember' | 'azure' | 'phantom' | 'ivory';
/** Dashboard accent palette (the "yours" / primary signal color). */
export type AppearanceAccent = 'chrome' | 'gold' | 'blood' | 'teal' | 'royal' | 'champion';
/** Dashboard spacing rhythm. */
export type AppearanceDensity = 'compact' | 'comfortable' | 'spacious';
/** Dashboard layout preset: today's density or a showcase hero. */
export type AppearanceLayout = 'compact' | 'showcase';
/** Ornament bucket derived from the 0–100 intensity. */
export type OrnamentLevel = 'none' | 'light' | 'full';

export interface AppearanceSettings {
    /** Surface / type / line palette. */
    theme: AppearanceTheme;
    /** Primary ("yours") accent color. */
    accent: AppearanceAccent;
    /** Spacing rhythm. */
    density: AppearanceDensity;
    /** Corner radius for cards, inputs and menus, in px (0–24). */
    radius: number;
    /** Frosted-glass translucency + blur level for surfaces, 0–100. 0 = opaque (off). */
    glass: number;
    /** Dashboard font scale multiplier, 0.85–1.2. */
    fontScale: number;
    /** Main champion (Data Dragon id). Empty = follow your most-played champion. */
    mainChampion: string;
    /** Compact (current shell) or showcase (larger champion hero). */
    layoutPreset: AppearanceLayout;
    /** Ornament intensity, 0–100. 0 = plain chrome, 50 = default, 100 = full filigree. */
    ornament: number;
}

export const APPEARANCE_THEMES: AppearanceTheme[] = ['gothic', 'ember', 'azure', 'phantom', 'ivory'];
export const APPEARANCE_ACCENTS: AppearanceAccent[] = ['chrome', 'gold', 'blood', 'teal', 'royal', 'champion'];
export const APPEARANCE_DENSITIES: AppearanceDensity[] = ['compact', 'comfortable', 'spacious'];
export const APPEARANCE_LAYOUTS: AppearanceLayout[] = ['compact', 'showcase'];

export const APPEARANCE_RADIUS_MIN = 0;
export const APPEARANCE_RADIUS_MAX = 24;
export const APPEARANCE_RADIUS_DEFAULT = 6;
export const APPEARANCE_GLASS_MIN = 0;
export const APPEARANCE_GLASS_MAX = 100;
export const APPEARANCE_FONT_MIN = 0.85;
export const APPEARANCE_FONT_MAX = 1.2;
export const APPEARANCE_ORNAMENT_MIN = 0;
export const APPEARANCE_ORNAMENT_MAX = 100;
export const APPEARANCE_ORNAMENT_DEFAULT = 50;
/** Ornament values below this stay "light"; at/above it the full layer renders. */
export const APPEARANCE_ORNAMENT_FULL_AT = 75;
/** Longest main-champion id accepted from disk (Data Dragon ids are short). */
export const MAIN_CHAMPION_MAX_LENGTH = 40;

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
    theme: 'gothic',
    accent: 'chrome',
    density: 'comfortable',
    radius: APPEARANCE_RADIUS_DEFAULT,
    glass: 0,
    fontScale: 1,
    mainChampion: '',
    layoutPreset: 'compact',
    ornament: APPEARANCE_ORNAMENT_DEFAULT,
};

/** Clamp any ornament input onto the integer 0–100 scale (invalid → default). */
export function clampOrnament(value: number): number {
    if (!Number.isFinite(value)) return APPEARANCE_ORNAMENT_DEFAULT;
    return Math.round(Math.min(APPEARANCE_ORNAMENT_MAX, Math.max(APPEARANCE_ORNAMENT_MIN, value)));
}

/**
 * Bucket the intensity so CSS can show/hide ornament layers without animating:
 * 0 = plain current look, 1–74 = light, 75–100 = full filigree + crest.
 */
export function ornamentLevel(value: number): OrnamentLevel {
    const orn = clampOrnament(value);
    if (orn <= 0) return 'none';
    return orn < APPEARANCE_ORNAMENT_FULL_AT ? 'light' : 'full';
}

/** Trim + validate a persisted main-champion id (Data Dragon ids only). */
export function normalizeMainChampion(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const value = raw.trim();
    if (!value || value.length > MAIN_CHAMPION_MAX_LENGTH) return '';
    return /^[A-Za-z0-9]+$/.test(value) ? value : '';
}

/* ----------------------------------------------------- pinned champions */

/** Most pins the orbit rail (and the Profile list) holds. */
export const PINNED_CHAMPIONS_MAX = 6;
/** Longest pinned-champion id accepted from disk (same rule as the main champion). */
export const PINNED_CHAMPION_MAX_LENGTH = MAIN_CHAMPION_MAX_LENGTH;

/**
 * Validate a persisted pin list: Data Dragon ids only, trimmed, de-duplicated
 * and capped at PINNED_CHAMPIONS_MAX, order preserved. Old settings files have
 * no `pinnedChampions`; those migrate from the previously chosen main champion
 * so a user who had a main keeps exactly one pin instead of losing it.
 */
export function normalizePinnedChampions(raw: unknown, mainChampion?: unknown): string[] {
    const source = Array.isArray(raw) ? raw : [];
    const out: string[] = [];
    for (const entry of source) {
        if (typeof entry !== 'string') continue;
        const value = entry.trim();
        if (!value || value.length > PINNED_CHAMPION_MAX_LENGTH) continue;
        if (!/^[A-Za-z0-9]+$/.test(value)) continue;
        if (out.includes(value)) continue;
        out.push(value);
        if (out.length >= PINNED_CHAMPIONS_MAX) break;
    }
    // Seed the migration only when the field is absent (an explicitly empty
    // list means the user unpinned everything and must stay empty).
    if (!Array.isArray(raw)) {
        const seed = normalizeMainChampion(mainChampion);
        if (seed) out.push(seed);
    }
    return out;
}

/* ---------------------------------------------------------------- pet */

/** Dashboard pixel pet species. */
export type PetSpecies = 'imp' | 'pup' | 'wyrm' | 'blob';
/** Dashboard pixel pet body color. */
export type PetColor = 'teal' | 'gold' | 'blood' | 'royal' | 'chrome';

export interface PetSettings {
    species: PetSpecies;
    color: PetColor;
}

export const PET_SPECIES: PetSpecies[] = ['imp', 'pup', 'wyrm', 'blob'];
export const PET_COLORS: PetColor[] = ['teal', 'gold', 'blood', 'royal', 'chrome'];
export const PET_DEFAULT_SPECIES: PetSpecies = 'imp';
export const PET_DEFAULT_COLOR: PetColor = 'teal';

export const PET_DEFAULTS: PetSettings = {
    species: PET_DEFAULT_SPECIES,
    color: PET_DEFAULT_COLOR,
};

/**
 * Validate a persisted/loaded pet choice; unknown species/color fall back to
 * defaults so a hand-edited settings file can never crash the renderer.
 */
export function normalizePet(raw: unknown): PetSettings {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const species = src.species as PetSpecies;
    const color = src.color as PetColor;
    return {
        species: PET_SPECIES.includes(species) ? species : PET_DEFAULT_SPECIES,
        color: PET_COLORS.includes(color) ? color : PET_DEFAULT_COLOR,
    };
}

/**
 * Map an appearance choice onto DOM attributes + CSS custom properties. The
 * renderer applies these to the app root (html element); the dashboard reads
 * them from tokens.css / theme.css. Persisted settings only carry enum ids and
 * numbers — never raw colors or arbitrary CSS.
 */
export function appearanceToCss(app: AppearanceSettings): {
    attributes: Record<string, string>;
    vars: Record<string, string>;
} {
    return {
        attributes: {
            'data-ot-theme': app.theme,
            'data-ot-accent': app.accent,
            'data-ot-density': app.density,
            'data-ot-layout': app.layoutPreset === 'showcase' ? 'showcase' : 'compact',
            'data-ot-ornament': ornamentLevel(app.ornament),
        },
        vars: {
            '--ot-radius-set': `${app.radius}px`,
            '--ot-glass': `${app.glass}`,
            '--ot-font-scale': `${app.fontScale}`,
            '--ot-ornament': `${clampOrnament(app.ornament) / 100}`,
        },
    };
}

function normalizeAppearance(raw: unknown): AppearanceSettings {
    const out = { ...APPEARANCE_DEFAULTS };
    const src =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
    const theme = src.theme as AppearanceTheme;
    if (APPEARANCE_THEMES.includes(theme)) out.theme = theme;
    const accent = src.accent as AppearanceAccent;
    if (APPEARANCE_ACCENTS.includes(accent)) out.accent = accent;
    const density = src.density as AppearanceDensity;
    if (APPEARANCE_DENSITIES.includes(density)) out.density = density;
    const layoutPreset = src.layoutPreset as AppearanceLayout;
    if (APPEARANCE_LAYOUTS.includes(layoutPreset)) out.layoutPreset = layoutPreset;
    out.mainChampion = normalizeMainChampion(src.mainChampion);

    const radius = Number(src.radius);
    if (Number.isFinite(radius)) {
        out.radius = Math.round(Math.min(APPEARANCE_RADIUS_MAX, Math.max(APPEARANCE_RADIUS_MIN, radius)));
    }
    const glass = Number(src.glass);
    if (Number.isFinite(glass)) {
        out.glass = Math.round(Math.min(APPEARANCE_GLASS_MAX, Math.max(APPEARANCE_GLASS_MIN, glass)));
    }
    const fontScale = Number(src.fontScale);
    if (Number.isFinite(fontScale)) {
        out.fontScale = Math.round(Math.min(APPEARANCE_FONT_MAX, Math.max(APPEARANCE_FONT_MIN, fontScale)) * 100) / 100;
    }
    const ornament = Number(src.ornament);
    if (src.ornament !== undefined && src.ornament !== null && Number.isFinite(ornament)) {
        out.ornament = clampOrnament(ornament);
    }
    return out;
}

export interface AppSettings {
    /**
     * GPU compositing for One Trick's own windows. Off by default: the overlay
     * and dashboard are mostly static, so software rendering costs a little CPU
     * and keeps the GPU queue entirely for League.
     */
    gpuAcceleration: boolean;
    /** Hide the dashboard to the tray while a match runs (a hidden window never paints). */
    hideDashboardInGame: boolean;
    /** Master switch for the in-game overlay. */
    overlayEnabled: boolean;
    /**
     * Show the overlay only while Tab is held, so nothing covers League the
     * rest of the time. Off by default: the overlay is meant to stay up.
     */
    overlayHoldToShow: boolean;
    /** Keep the overlay out of screenshots, recordings and streams (like Discord/Cluely overlays). */
    overlayHideFromCapture: boolean;
    /** Send runes and the item set to the client as soon as you lock in. */
    autoImport: boolean;
    /** Also set summoner spells on lock-in (keeps Flash on the key you use). */
    autoSpells: boolean;
    /**
     * Record the match and save a clip on Great / Brilliant plays.
     * Off by default: a desktop capture costs frames even at 12fps.
     */
    autoClip: boolean;
    /** Dashboard appearance (theme/accent/density/radius/glass/type scale). */
    appearance: AppearanceSettings;
    /**
     * Champions pinned on the orbit rail, in display order (Data Dragon ids,
     * max PINNED_CHAMPIONS_MAX). Clicking one makes it the main champion.
     */
    pinnedChampions: string[];
    /** Dashboard pixel pet (species + color). */
    pet: PetSettings;
}

const DEFAULTS: AppSettings = {
    gpuAcceleration: false,
    hideDashboardInGame: true,
    overlayEnabled: true,
    overlayHoldToShow: false,
    overlayHideFromCapture: true,
    autoImport: true,
    autoSpells: false,
    autoClip: false,
    appearance: APPEARANCE_DEFAULTS,
    pinnedChampions: [],
    pet: PET_DEFAULTS,
};

let current: AppSettings | null = null;
/** GPU mode is fixed for the life of the process; a change needs a relaunch. */
let gpuAtLaunch: boolean | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function settingsFile(): string {
    return path.join(userDataDir(), 'app-settings.json');
}

function normalize(raw: unknown): AppSettings {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
        if (key === 'appearance' || key === 'pet') continue; // handled below
        if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
    }
    // Old settings files (or a partially-written one) have no `appearance`;
    // missing or invalid values fall back to safe defaults (migration).
    out.appearance = normalizeAppearance(src.appearance);
    // Pins migrate from the old single main champion when absent.
    out.pinnedChampions = normalizePinnedChampions(src.pinnedChampions, out.appearance.mainChampion);
    out.pet = normalizePet(src.pet);
    return out;
}

/** Synchronous on purpose: read once at startup, before the app is ready. */
export function loadAppSettings(): AppSettings {
    if (current) return current;
    try {
        current = normalize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
    } catch {
        current = { ...DEFAULTS };
    }
    if (gpuAtLaunch === null) gpuAtLaunch = current.gpuAcceleration;
    return current;
}

export function getAppSettings(): AppSettings {
    return { ...loadAppSettings() };
}

export function gpuAccelerationAtLaunch(): boolean {
    loadAppSettings();
    if (process.env.PYKE_GPU === '1') return true;
    return !!gpuAtLaunch;
}

export function updateAppSettings(patch: unknown): { settings: AppSettings; restartRequired: boolean } {
    const base = loadAppSettings();
    const patchObj = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {};
    // Deep-merge `appearance` so a single-field patch (e.g. only `theme`) does
    // not reset the other appearance choices back to defaults. Same for the pet.
    const merged: Record<string, unknown> = { ...base, ...patchObj };
    if (patchObj.appearance && typeof patchObj.appearance === 'object') {
        merged.appearance = { ...base.appearance, ...(patchObj.appearance as Record<string, unknown>) };
    }
    if (patchObj.pet && typeof patchObj.pet === 'object') {
        merged.pet = { ...base.pet, ...(patchObj.pet as Record<string, unknown>) };
    }
    const next = normalize(merged);
    current = next;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
        writeTimer = null;
        fs.promises
            .writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
            .catch((error) => console.warn('[settings] save failed:', error));
    }, 150);
    return { settings: { ...next }, restartRequired: next.gpuAcceleration !== gpuAtLaunch };
}

export function flushAppSettings(): void {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
        try {
            fs.writeFileSync(settingsFile(), JSON.stringify(current || DEFAULTS, null, 2), 'utf8');
        } catch (error) {
            console.warn('[settings] flush failed:', error);
        }
    }
}
