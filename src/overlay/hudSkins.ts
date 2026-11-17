/**
 * HUD skins — a library of named, static panel decorations plus "Auto" that
 * picks one from the champion's primary Data Dragon tag.
 *
 * Pure data + normalization only (no React, no DOM): the overlay applies the
 * resolved skin as `data-ov-skin` on its root, the skin CSS block under
 * `src/overlay/hud-skins.css` draws the frame, and `hudSkinOrnaments.tsx`
 * draws the corner marks. Skins are decoration: they never change layout,
 * content or data (R11 — static, no animation, no blur).
 */

/** Concrete skins. `gothic` is the shipped look (ink panels, chrome brackets). */
export const HUD_SKIN_IDS = [
  'gothic',
  'bloodmoon',
  'arcane',
  'ironclad',
  'warden',
  'hunter',
  'vanguard',
] as const;

export type HudSkin = (typeof HUD_SKIN_IDS)[number];

/** What the user picks in settings: a skin, or Auto by champion class. */
export const HUD_SKIN_CHOICES = ['auto', ...HUD_SKIN_IDS] as const;

export type HudSkinChoice = (typeof HUD_SKIN_CHOICES)[number];

/** The user's HUD skin tweaks, persisted with the overlay settings. */
export interface HudSkinSettings {
  hudSkin: HudSkinChoice;
  hudSkinOrnaments: boolean;
  /** Panel surface alpha as a percent, clamped to 80–100 (R5 floor). */
  hudSkinOpacity: number;
  /** Ornament size as a percent, clamped to 75–150. */
  hudSkinScale: number;
  /** Ornaments follow --ov-champ; off keeps chrome silver. */
  hudSkinUseChampColor: boolean;
}

export const HUD_SKIN_OPACITY_MIN = 80;
export const HUD_SKIN_OPACITY_MAX = 100;
export const HUD_SKIN_SCALE_MIN = 75;
export const HUD_SKIN_SCALE_MAX = 150;

export const DEFAULT_HUD_SKIN_SETTINGS: HudSkinSettings = {
  hudSkin: 'gothic',
  hudSkinOrnaments: true,
  hudSkinOpacity: 92,
  hudSkinScale: 100,
  hudSkinUseChampColor: true,
};

export const HUD_SKIN_LABELS: Record<HudSkinChoice, string> = {
  auto: 'Auto',
  gothic: 'Gothic',
  bloodmoon: 'Blood Moon',
  arcane: 'Arcane',
  ironclad: 'Ironclad',
  warden: 'Warden',
  hunter: 'Hunter',
  vanguard: 'Vanguard',
};

/** One line per skin for the settings cards. */
export const HUD_SKIN_HINTS: Record<HudSkinChoice, string> = {
  auto: 'Follows the champion’s class: assassin, mage, tank, support, marksman, fighter.',
  gothic: 'Ink panels with chrome corner brackets — the shipped look.',
  bloodmoon: 'Sharp chamfered corners, thin blood hairlines, blade-tip marks.',
  arcane: 'Rune-ring corners over a double inner hairline.',
  ironclad: 'Heavier riveted frame with a stepped header plate.',
  warden: 'Soft rounded frame with leaf filigree sprigs.',
  hunter: 'Crosshair corners and range ticks along the header.',
  vanguard: 'Bevelled corners under a shield-crest header emblem.',
};

/** Champion class a skin is themed for (for the settings cards). */
export const HUD_SKIN_CLASS: Record<HudSkin, string> = {
  gothic: 'Default',
  bloodmoon: 'Assassin',
  arcane: 'Mage',
  ironclad: 'Tank',
  warden: 'Support',
  hunter: 'Marksman',
  vanguard: 'Fighter',
};

/**
 * Data Dragon primary tag → skin. DDragon tags arrive already in the catalog
 * (`champion.tags`), primary first; unknown tags fall back to gothic.
 */
export const HUD_SKIN_TAG_MAP: Record<string, HudSkin> = {
  Assassin: 'bloodmoon',
  Mage: 'arcane',
  Tank: 'ironclad',
  Support: 'warden',
  Marksman: 'hunter',
  Fighter: 'vanguard',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isSkinChoice(value: unknown): value is HudSkinChoice {
  return typeof value === 'string' && (HUD_SKIN_CHOICES as readonly string[]).includes(value);
}

/** Defaults + clamping; unknown input never escapes. */
export function normalizeHudSkinSettings(value: unknown): HudSkinSettings {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const choice = src.hudSkin ?? src.skin;
  return {
    hudSkin: isSkinChoice(choice) ? choice : DEFAULT_HUD_SKIN_SETTINGS.hudSkin,
    hudSkinOrnaments:
      typeof src.hudSkinOrnaments === 'boolean'
        ? src.hudSkinOrnaments
        : DEFAULT_HUD_SKIN_SETTINGS.hudSkinOrnaments,
    hudSkinOpacity: clampInt(
      src.hudSkinOpacity,
      HUD_SKIN_OPACITY_MIN,
      HUD_SKIN_OPACITY_MAX,
      DEFAULT_HUD_SKIN_SETTINGS.hudSkinOpacity
    ),
    hudSkinScale: clampInt(
      src.hudSkinScale,
      HUD_SKIN_SCALE_MIN,
      HUD_SKIN_SCALE_MAX,
      DEFAULT_HUD_SKIN_SETTINGS.hudSkinScale
    ),
    hudSkinUseChampColor:
      typeof src.hudSkinUseChampColor === 'boolean'
        ? src.hudSkinUseChampColor
        : DEFAULT_HUD_SKIN_SETTINGS.hudSkinUseChampColor,
  };
}

/**
 * The concrete skin to draw. `auto` maps the champion's primary tag
 * (first DDragon tag) through HUD_SKIN_TAG_MAP; no tag or an unknown tag is
 * gothic. An explicit pick always wins.
 */
export function resolveHudSkin(choice: HudSkinChoice, tags?: readonly string[] | null): HudSkin {
  if (choice !== 'auto') return choice;
  const primary = tags && tags.length ? String(tags[0] || '') : '';
  return HUD_SKIN_TAG_MAP[primary] || 'gothic';
}

/**
 * CSS custom properties the overlay root (and the studio preview) sets from
 * the tweaks. Per-skin geometry (radius, border width, clip) comes from the
 * `[data-ov-skin]` CSS block so switching skins never runs JS layout work.
 */
export function hudSkinVars(settings: HudSkinSettings): Record<string, string> {
  const safe = normalizeHudSkinSettings(settings);
  return {
    '--ov-skin-panel-alpha': String(safe.hudSkinOpacity / 100),
    '--ov-skin-orn-scale': String(safe.hudSkinScale / 100),
    '--ov-skin-orn': safe.hudSkinUseChampColor ? 'var(--ov-champ)' : 'var(--chrome-silver, #d4d8de)',
  };
}
