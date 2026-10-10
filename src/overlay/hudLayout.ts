import { HUD_MODULE_IDS, type HudModuleId, type HudModules } from './hudModules';

export type HudAnchor = 'tl' | 'tr' | 'bl' | 'br' | 'center';

export type HudStickerKind = 'mark' | 'text' | 'champ' | 'item';

export interface HudElement {
  id: string;
  visible: boolean;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  anchor?: HudAnchor;
}

export interface HudSticker {
  id: string;
  kind: HudStickerKind;
  label?: string;
  championId?: string;
  itemId?: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface HudLayout {
  name: string;
  elements: HudElement[];
  stickers: HudSticker[];
}

export const HUD_LAYOUT_MODULE_IDS: HudModuleId[] = [...HUD_MODULE_IDS];

export const HUD_LAYOUT_STORAGE_KEY = 'onetrick.hudLayout';

const ANCHORS: HudAnchor[] = ['tl', 'tr', 'bl', 'br', 'center'];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.4, Math.min(2.5, value));
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.15, Math.min(1, value));
}

function moduleElement(id: HudModuleId, partial: Partial<HudElement>): HudElement {
  return {
    id,
    visible: partial.visible ?? id !== 'frames',
    x: clamp01(partial.x ?? 0.02),
    y: clamp01(partial.y ?? 0.08),
    scale: clampScale(partial.scale ?? 1),
    opacity: clampOpacity(partial.opacity ?? 1),
    anchor: partial.anchor && ANCHORS.includes(partial.anchor) ? partial.anchor : 'tl',
  };
}

/** Current 1.1.0 dual rails — sums left, kit right. */
export function dualRailLayout(): HudLayout {
  return {
    name: 'Locked dual-rail',
    elements: [
      moduleElement('sums', { x: 0.018, y: 0.078, visible: true, anchor: 'tl' }),
      moduleElement('gank', { x: 0.835, y: 0.078, visible: true, anchor: 'tr' }),
      moduleElement('vision', { x: 0.835, y: 0.26, visible: true, anchor: 'tr' }),
      moduleElement('buy', { x: 0.835, y: 0.42, visible: true, anchor: 'tr' }),
      moduleElement('action', { x: 0.835, y: 0.54, visible: true, anchor: 'tr' }),
      moduleElement('frames', { x: 0.5, y: 0.82, visible: false, anchor: 'center' }),
    ],
    stickers: [],
  };
}

export function compactRightLayout(): HudLayout {
  return {
    name: 'Compact right',
    elements: [
      moduleElement('sums', { x: 0.835, y: 0.06, visible: true, anchor: 'tr' }),
      moduleElement('gank', { x: 0.835, y: 0.28, visible: true, anchor: 'tr' }),
      moduleElement('vision', { x: 0.835, y: 0.42, visible: true, anchor: 'tr' }),
      moduleElement('buy', { x: 0.835, y: 0.56, visible: true, anchor: 'tr' }),
      moduleElement('action', { x: 0.835, y: 0.68, visible: true, anchor: 'tr' }),
      moduleElement('frames', { x: 0.5, y: 0.82, visible: false, anchor: 'center' }),
    ],
    stickers: [],
  };
}

export function emptyCanvasLayout(): HudLayout {
  return {
    name: 'Empty canvas',
    elements: HUD_LAYOUT_MODULE_IDS.map((id) =>
      moduleElement(id, { x: 0.4, y: 0.35, visible: false, anchor: 'tl' })
    ),
    stickers: [],
  };
}

export const HUD_LAYOUT_PRESETS: HudLayout[] = [
  dualRailLayout(),
  compactRightLayout(),
  emptyCanvasLayout(),
];

function normalizeSticker(value: unknown): HudSticker | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const kind = raw.kind;
  if (kind !== 'mark' && kind !== 'text' && kind !== 'champ' && kind !== 'item') return null;
  return {
    id: raw.id,
    kind,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 32) : undefined,
    championId: typeof raw.championId === 'string' ? raw.championId : undefined,
    itemId: typeof raw.itemId === 'string' ? raw.itemId : undefined,
    x: clamp01(Number(raw.x)),
    y: clamp01(Number(raw.y)),
    scale: clampScale(Number(raw.scale) || 1),
    opacity: clampOpacity(Number(raw.opacity) || 1),
  };
}

export function normalizeHudLayout(value: unknown): HudLayout {
  const fallback = dualRailLayout();
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const incoming = Array.isArray(raw.elements) ? raw.elements : [];
  const byId = new Map<string, Partial<HudElement>>();
  for (const row of incoming) {
    if (!row || typeof row !== 'object') continue;
    const el = row as Record<string, unknown>;
    if (typeof el.id !== 'string') continue;
    byId.set(el.id, {
      id: el.id,
      visible: typeof el.visible === 'boolean' ? el.visible : undefined,
      x: typeof el.x === 'number' ? el.x : undefined,
      y: typeof el.y === 'number' ? el.y : undefined,
      scale: typeof el.scale === 'number' ? el.scale : undefined,
      opacity: typeof el.opacity === 'number' ? el.opacity : undefined,
      anchor: typeof el.anchor === 'string' && ANCHORS.includes(el.anchor as HudAnchor)
        ? (el.anchor as HudAnchor)
        : undefined,
    });
  }

  const elements = fallback.elements.map((base) => {
    const override = byId.get(base.id);
    return override ? moduleElement(base.id as HudModuleId, { ...base, ...override }) : base;
  });

  const stickers = Array.isArray(raw.stickers)
    ? raw.stickers.map(normalizeSticker).filter((row): row is HudSticker => !!row).slice(0, 24)
    : [];

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 48) : fallback.name,
    elements,
    stickers,
  };
}

export function layoutToHudModules(layout: HudLayout): HudModules {
  const next: HudModules = {
    sums: true,
    gank: true,
    vision: true,
    buy: true,
    action: true,
    frames: false,
  };
  for (const id of HUD_MODULE_IDS) {
    const el = layout.elements.find((row) => row.id === id);
    if (el) next[id] = el.visible;
  }
  return next;
}

export function applyModulesToLayout(layout: HudLayout, modules: HudModules): HudLayout {
  return {
    ...layout,
    elements: layout.elements.map((el) =>
      HUD_MODULE_IDS.includes(el.id as HudModuleId)
        ? { ...el, visible: modules[el.id as HudModuleId] }
        : el
    ),
  };
}

export function layoutElement(layout: HudLayout, id: string): HudElement | undefined {
  return layout.elements.find((el) => el.id === id);
}

export function upsertLayoutElement(layout: HudLayout, next: HudElement): HudLayout {
  const exists = layout.elements.some((el) => el.id === next.id);
  return {
    ...layout,
    elements: exists
      ? layout.elements.map((el) => (el.id === next.id ? next : el))
      : [...layout.elements, next],
  };
}

export function upsertSticker(layout: HudLayout, sticker: HudSticker): HudLayout {
  const exists = layout.stickers.some((row) => row.id === sticker.id);
  return {
    ...layout,
    stickers: exists
      ? layout.stickers.map((row) => (row.id === sticker.id ? sticker : row))
      : [...layout.stickers, sticker],
  };
}

export function removeSticker(layout: HudLayout, id: string): HudLayout {
  return { ...layout, stickers: layout.stickers.filter((row) => row.id !== id) };
}

export function loadStoredHudLayout(): HudLayout {
  try {
    if (typeof localStorage === 'undefined') return dualRailLayout();
    const raw = localStorage.getItem(HUD_LAYOUT_STORAGE_KEY);
    if (!raw) return dualRailLayout();
    return normalizeHudLayout(JSON.parse(raw));
  } catch {
    return dualRailLayout();
  }
}

export function storeHudLayout(layout: HudLayout): void {
  try {
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeHudLayout(layout)));
  } catch {
    /* ignore */
  }
}

export function layoutStyle(
  el: Pick<HudElement, 'x' | 'y' | 'scale' | 'opacity' | 'anchor'>,
  geo: { offsetX: number; offsetY: number; gameViewW: number; gameViewH: number }
): {
  position: 'absolute';
  left: number;
  top: number;
  transform: string;
  transformOrigin: string;
  opacity: number;
} {
  const origin =
    el.anchor === 'tr'
      ? 'top right'
      : el.anchor === 'bl'
        ? 'bottom left'
        : el.anchor === 'br'
          ? 'bottom right'
          : el.anchor === 'center'
            ? 'center'
            : 'top left';
  return {
    position: 'absolute',
    left: geo.offsetX + el.x * geo.gameViewW,
    top: geo.offsetY + el.y * geo.gameViewH,
    transform: `scale(${el.scale})`,
    transformOrigin: origin,
    opacity: el.opacity,
  };
}
