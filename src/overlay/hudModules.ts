/** Toggleable overlay widgets — new HUD features should land as modules, not more copy. */

export const HUD_MODULE_IDS = ['sums', 'gank', 'vision', 'buy', 'action', 'mayhem', 'frames'] as const;

export type HudModuleId = (typeof HUD_MODULE_IDS)[number];

/** Modules the web HUD Studio stage can render as live pins. */
export const HUD_STUDIO_MODULE_IDS: HudModuleId[] = ['sums', 'gank', 'vision', 'buy', 'action'];

export type HudModules = Record<HudModuleId, boolean>;

export const DEFAULT_HUD_MODULES: HudModules = {
  sums: true,
  gank: true,
  vision: true,
  buy: true,
  action: true,
  mayhem: true,
  frames: false,
};

export const HUD_MODULE_LABELS: Record<HudModuleId, string> = {
  sums: 'Sums',
  gank: 'Gank',
  vision: 'Vision',
  buy: 'Buy',
  action: 'Action',
  mayhem: 'Mayhem (beta)',
  frames: 'Frames',
};

export function normalizeHudModules(value: unknown): HudModules {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const next: HudModules = { ...DEFAULT_HUD_MODULES };
  for (const id of HUD_MODULE_IDS) {
    if (typeof src[id] === 'boolean') next[id] = src[id];
  }
  return next;
}

/** Marker in overlay-settings.json proving the Mayhem defaults migration ran. */
export const MAYHEM_DEFAULTS_MIGRATION_KEY = 'mayhemDefaultsMigrated';

/** Flip only the mayhem element's `visible`; every other element is returned as-is. */
function withMayhemVisible(layout: unknown): unknown {
  if (!layout || typeof layout !== 'object') return layout;
  const raw = layout as { elements?: unknown };
  if (!Array.isArray(raw.elements)) return layout;
  let changed = false;
  const elements = raw.elements.map((el) => {
    if (!el || typeof el !== 'object') return el;
    const row = el as Record<string, unknown>;
    if (row.id !== 'mayhem' || row.visible === true) return el;
    changed = true;
    return { ...row, visible: true };
  });
  return changed ? { ...(layout as Record<string, unknown>), elements } : layout;
}

/**
 * One-time store migration. Builds before the first-run switch shipped Mayhem
 * off, so a persisted `mayhem: false` is that install default rather than a
 * choice. A store without the marker is turned on and stamped; a stamped store
 * is returned untouched, so a user who turned Mayhem off stays off.
 */
export function migrateMayhemDefaults<T extends Record<string, unknown>>(
  settings: T
): { settings: T; migrated: boolean } {
  if (settings[MAYHEM_DEFAULTS_MIGRATION_KEY] === true) return { settings, migrated: false };
  const modules =
    settings.hudModules && typeof settings.hudModules === 'object'
      ? { ...(settings.hudModules as Record<string, unknown>) }
      : {};
  modules.mayhem = true;
  return {
    settings: {
      ...settings,
      hudModules: modules,
      hudLayout: withMayhemVisible(settings.hudLayout),
      [MAYHEM_DEFAULTS_MIGRATION_KEY]: true,
    } as unknown as T,
    migrated: true,
  };
}
