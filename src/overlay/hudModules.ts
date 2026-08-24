/** Toggleable overlay widgets — new HUD features should land as modules, not more copy. */

export const HUD_MODULE_IDS = ['sums', 'gank', 'vision', 'buy', 'action', 'frames'] as const;

export type HudModuleId = (typeof HUD_MODULE_IDS)[number];

export type HudModules = Record<HudModuleId, boolean>;

export const DEFAULT_HUD_MODULES: HudModules = {
  sums: true,
  gank: true,
  vision: true,
  buy: true,
  action: true,
  frames: false,
};

export const HUD_MODULE_LABELS: Record<HudModuleId, string> = {
  sums: 'Sums',
  gank: 'Gank',
  vision: 'Vision',
  buy: 'Buy',
  action: 'Action',
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
