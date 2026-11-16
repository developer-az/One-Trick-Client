/**
 * Orbit layout + pin-list math for the client's disk navigation (brief J).
 *
 * Everything here is pure: no React, no DOM, no timers. The component measures
 * its pills once per resize and feeds the measured widths in; the placements
 * come back as offsets from the arc's centre so the shell can place them with
 * `translate(-50%,-50%)`.
 *
 * Angles are degrees in screen space: 0° points right (+x), 90° points down
 * (+y), 180° points left. A ring is a circle of `radius` px around the arc
 * centre; items sit on it ordered by the given angle range. The layout grows
 * the radius and then adds rings until nothing overlaps, so the caller never
 * has to hand-tune a radius per item count. If even the last ring budget
 * cannot fit, a vertical column is returned (still collision-free) and
 * `fallback` says so.
 */

/** Space between two items on the same ring, px. */
export const ORBIT_GAP = 8;
/** Radial distance between two rings, px (>= pill height + gap). */
export const ORBIT_RING_GAP = 46;
/** How many rings the collision solver may open before the column fallback. */
export const ORBIT_MAX_RINGS = 3;
/** Ring radius growth step, px. */
export const ORBIT_RADIUS_STEP = 8;
/** Default pill height (the R9 36px hit target). */
export const ORBIT_ITEM_HEIGHT = 36;

/** Below this viewport width the arc collapses to a segmented bar. */
export const ORBIT_BAR_BELOW = 1100;
/** Below this viewport width the bar becomes icon-only. */
export const ORBIT_ICONS_BELOW = 760;

export type OrbitTier = 'arc' | 'bar' | 'icons';

/** Which shell the disk uses for a window width. */
export function orbitTier(width: number): OrbitTier {
  if (!Number.isFinite(width) || width <= 0) return 'bar';
  if (width < ORBIT_ICONS_BELOW) return 'icons';
  if (width < ORBIT_BAR_BELOW) return 'bar';
  return 'arc';
}

export interface OrbitSize {
  width: number;
  height?: number;
}

export interface OrbitPlacement {
  id: string;
  /** Ring index (0 = innermost). */
  ring: number;
  /** Placement angle in degrees, for debugging/tests. */
  angleDeg: number;
  /** Centre offset from the arc centre, px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrbitLayout {
  placements: OrbitPlacement[];
  /** Radius used by each open ring, px. */
  ringRadii: number[];
  /** Rings actually used (1..ORBIT_MAX_RINGS). */
  rings: number;
  /** True when even the last ring budget could not fit and a column is used. */  fallback: boolean;
  /** Vertical extent of the placements, measured from the topmost edge. */
  height: number;
  /** Horizontal extent (width of the union of all rects). */
  width: number;
}

export interface OrbitOptions {
  gap?: number;
  ringGap?: number;
  maxRings?: number;
  /**
   * Use exactly this many rings (the radius still grows to fit). The disk sets
   * 2 so the rail stays a compact two-row fan instead of one very wide arc.
   */
  fixedRings?: number;
  radiusStep?: number;
  /** Default item height when a size entry only carries a width. */
  itemHeight?: number;
  /** Give each ring a slice of the angle range instead of stacking radially. */
  splitSpan?: boolean;
}

function sizeOf(size: OrbitSize | number | undefined, fallbackHeight: number): { width: number; height: number } {
  const raw = typeof size === 'number' ? { width: size } : size || { width: 96 };
  const width = Number.isFinite(raw.width) && raw.width > 0 ? raw.width : 96;
  const height = Number.isFinite(raw.height) && (raw.height as number) > 0 ? (raw.height as number) : fallbackHeight;
  return { width, height };
}

/** Circle-vs-rect false: two axis-aligned rects overlap with a 0.5px tolerance. */
export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - left > 0.5 && bottom - top > 0.5;
}

export function anyOverlap(rects: Array<{ x: number; y: number; width: number; height: number }>): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) return true;
    }
  }
  return false;
}

/** Split item indexes into `rings` contiguous, width-balanced buckets. */
function balanceRings(widths: number[], rings: number): number[][] {
  const n = widths.length;
  const count = Math.max(1, Math.min(rings, n));
  if (count === 1) return [widths.map((_, i) => i)];
  // Prefix sums + best split points (n <= 9 in practice, so a simple DP over
  // cut positions is exact and instant).
  const prefix = [0];
  for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
  const bucket = (from: number, to: number) => prefix[to] - prefix[from];
  const cuts: number[] = [0];
  const target = prefix[n] / count;
  for (let k = 1; k < count; k++) {
    let best = cuts[cuts.length - 1] + 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let cut = best; cut <= n - (count - k); cut++) {
      const score = Math.abs(bucket(cuts[cuts.length - 1], cut) - target);
      if (score < bestScore) {
        bestScore = score;
        best = cut;
      }
    }
    cuts.push(best);
  }
  cuts.push(n);
  const out: number[][] = [];
  for (let k = 0; k < count; k++) {
    const bucketIndexes: number[] = [];
    for (let i = cuts[k]; i < cuts[k + 1]; i++) bucketIndexes.push(i);
    out.push(bucketIndexes);
  }
  return out;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place one ring's items along the angle range at `radius`. Returns null when
 * the arc is too short for the items (the caller then grows the radius).
 */
function placeRing(
  ids: string[],
  sizes: Array<{ width: number; height: number }>,
  radius: number,
  startDeg: number,
  endDeg: number,
  gap: number,
  ring: number
): OrbitPlacement[] | null {
  if (!ids.length) return [];
  const spanRad = ((endDeg - startDeg) * Math.PI) / 180;
  const arcLen = Math.abs(spanRad) * radius;
  const used = sizes.reduce((sum, s) => sum + s.width, 0) + gap * Math.max(0, ids.length - 1);
  if (used > arcLen) return null;
  const direction = spanRad >= 0 ? 1 : -1;
  const startRad = (startDeg * Math.PI) / 180;
  let cursor = (arcLen - used) / 2;
  const out: OrbitPlacement[] = [];
  for (let i = 0; i < ids.length; i++) {
    const size = sizes[i];
    const along = cursor + size.width / 2;
    const angleRad = startRad + (direction * along) / radius;
    const angleDeg = (angleRad * 180) / Math.PI;
    out.push({
      id: ids[i],
      ring,
      angleDeg,
      x: Math.cos(angleRad) * radius,
      y: Math.sin(angleRad) * radius,
      width: size.width,
      height: size.height,
    });
    cursor += size.width + gap;
  }
  return out;
}

function toRects(placements: OrbitPlacement[]): Rect[] {
  return placements.map((p) => ({
    x: p.x - p.width / 2,
    y: p.y - p.height / 2,
    width: p.width,
    height: p.height,
  }));
}

function extent(placements: OrbitPlacement[]): { width: number; height: number } {
  if (!placements.length) return { width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of placements) {
    minX = Math.min(minX, p.x - p.width / 2);
    maxX = Math.max(maxX, p.x + p.width / 2);
    minY = Math.min(minY, p.y - p.height / 2);
    maxY = Math.max(maxY, p.y + p.height / 2);
  }
  return { width: maxX - minX, height: maxY - minY };
}

/**
 * Lay `items` out on one arc. `itemSizes` is the measured width (number) or a
 * `{ width, height }` per item, in the same order as `items`.
 *
 * The solver tries one ring, then two, then three; for each ring count it
 * grows the radius in ORBIT_RADIUS_STEP steps until every rect is free of the
 * others. `splitSpan` gives each ring its own slice of the angle range, which
 * keeps rings from stacking radially when the arc is already tight.
 */
export function orbitLayout<T extends { id: string }>(
  items: readonly T[],
  radius: number,
  startDeg: number,
  endDeg: number,
  itemSizes: ReadonlyArray<OrbitSize | number | undefined>,
  options: OrbitOptions = {}
): OrbitLayout {
  const gap = options.gap ?? ORBIT_GAP;
  const ringGap = options.ringGap ?? ORBIT_RING_GAP;
  const maxRings = Math.max(1, options.maxRings ?? ORBIT_MAX_RINGS);
  const step = Math.max(1, options.radiusStep ?? ORBIT_RADIUS_STEP);
  const fallbackHeight = options.itemHeight ?? ORBIT_ITEM_HEIGHT;
  const base = Math.max(24, Number.isFinite(radius) && radius > 0 ? radius : 120);

  const sizes = items.map((_, i) => sizeOf(itemSizes[i], fallbackHeight));
  const ids = items.map((it) => it.id);
  const widths = sizes.map((s) => s.width);

  const build = (ringCount: number, baseRadius: number): { placements: OrbitPlacement[]; ringRadii: number[] } | null => {
    const buckets = balanceRings(widths, ringCount);
    const placements: OrbitPlacement[] = [];
    const ringRadii: number[] = [];
    const span = endDeg - startDeg;
    for (let r = 0; r < buckets.length; r++) {
      const ringRadius = baseRadius + r * ringGap;
      const ringStart = options.splitSpan ? startDeg + (span * r) / buckets.length : startDeg;
      const ringEnd = options.splitSpan ? startDeg + (span * (r + 1)) / buckets.length : endDeg;
      const bucket = buckets[r];
      const placed = placeRing(
        bucket.map((i) => ids[i]),
        bucket.map((i) => sizes[i]),
        ringRadius,
        ringStart,
        ringEnd,
        gap,
        r
      );
      if (!placed) return null;
      ringRadii.push(ringRadius);
      placements.push(...placed);
    }
    if (anyOverlap(toRects(placements))) return null;
    return { placements, ringRadii };
  };

  const maxRadius = base * 4;
  const ringCounts: number[] = [];
  if (options.fixedRings) {
    const fixed = Math.max(1, Math.min(maxRings, options.fixedRings));
    ringCounts.push(fixed);
    if (fixed < maxRings) ringCounts.push(maxRings);
  } else {
    for (let k = 1; k <= maxRings; k++) ringCounts.push(k);
  }
  for (const ringCount of ringCounts) {
    for (let r = base; r <= maxRadius; r += step) {
      const attempt = build(ringCount, r);
      if (!attempt) continue;
      const box = extent(attempt.placements);
      return {
        placements: attempt.placements,
        ringRadii: attempt.ringRadii,
        rings: ringCount,
        fallback: false,
        width: box.width,
        height: box.height,
      };
    }
  }

  // Last resort: a single vertical column. Non-overlapping by construction.
  const columnRadius = base;
  const placements: OrbitPlacement[] = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    placements.push({
      id: ids[i],
      ring: 0,
      angleDeg: 90,
      x: 0,
      y: cursor + sizes[i].height / 2,
      width: sizes[i].width,
      height: sizes[i].height,
    });
    cursor += sizes[i].height + gap;
  }
  const box = extent(placements);
  return {
    placements,
    ringRadii: [columnRadius],
    rings: 1,
    fallback: true,
    width: box.width,
    height: box.height,
  };
}

/** Top offset that put the arc's centre back at `centerY` for a used radius. */
export function orbitArcTop(centerY: number, layout: OrbitLayout): number {
  const radius = layout.ringRadii[0] ?? 0;
  return centerY - radius;
}

/* ------------------------------------------------------- pinned champions */

/** Most champions the rail holds (mirrors electron/app-settings). */
export const PIN_LIMIT = 6;
/** Longest Data Dragon id accepted (mirrors electron/app-settings). */
export const PIN_MAX_LENGTH = 40;

/**
 * Validate a pin list: Data Dragon ids only, trimmed, de-duplicated, capped,
 * order preserved. `seed` fills an empty list from the previous main champion
 * (settings migration).
 */
export function normalizePins(raw: unknown, seed?: string | null): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const value = entry.trim();
    if (!value || value.length > PIN_MAX_LENGTH) continue;
    if (!/^[A-Za-z0-9]+$/.test(value)) continue;
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= PIN_LIMIT) break;
  }
  // Seed the migration only when the list is absent (an explicitly empty list
  // means the user unpinned everything).
  if (!Array.isArray(raw)) {
    const fallback = typeof seed === 'string' ? seed.trim() : '';
    if (fallback && fallback.length <= PIN_MAX_LENGTH && /^[A-Za-z0-9]+$/.test(fallback)) out.push(fallback);
  }
  return out;
}

/** Append a pin; a full list, a duplicate or an invalid id leaves it as is. */
export function addPin(list: readonly string[], id: string): string[] {
  const current = normalizePins(list);
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value || !/^[A-Za-z0-9]+$/.test(value) || value.length > PIN_MAX_LENGTH) return current;
  if (current.includes(value) || current.length >= PIN_LIMIT) return current;
  return [...current, value];
}

/** Drop a pin. */
export function removePin(list: readonly string[], id: string): string[] {
  return normalizePins(list).filter((p) => p !== id);
}

/** Toggle a pin (used by the Profile list + the "+" slot). */
export function togglePin(list: readonly string[], id: string): string[] {
  const current = normalizePins(list);
  return current.includes(id) ? removePin(current, id) : addPin(current, id);
}

/** Move a pin to a new index, clamped into range (drag + Alt+Arrow reorder). */
export function movePin(list: readonly string[], from: number, to: number): string[] {
  const current = normalizePins(list);
  if (!current.length) return current;
  const start = Math.max(0, Math.min(current.length - 1, Math.trunc(from)));
  const end = Math.max(0, Math.min(current.length - 1, Math.trunc(to)));
  if (start === end) return current;
  const next = [...current];
  const [moved] = next.splice(start, 1);
  next.splice(end, 0, moved);
  return next;
}

/** Minimal champion shape a pin needs; catalog rows and stubs both fit. */
export interface PinChampion {
  id?: string | null;
  name?: string | null;
  key?: string | number | null;
}

/** Resolve pin ids to champion rows, keeping the id for a missing entry. */
export function resolvePins(
  pins: readonly string[],
  champions: ReadonlyArray<PinChampion>
): PinChampion[] {
  return pins.map((id) => champions.find((c) => c.id === id) || { id, name: id, key: '' });
}

export interface PinActions {
  onPick: (id: string) => void;
  onUnpin: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}

/** Pin callbacks for the shell (pick = make active, unpin, reorder). */
export function pinHandlers(args: {
  pins: readonly string[];
  setPins: (next: string[]) => void;
  setActive: (id: string) => void;
}): PinActions {
  return {
    onPick: (id: string) => args.setActive(id),
    onUnpin: (id: string) => args.setPins(removePin(args.pins, id)),
    onReorder: (from: number, to: number) => args.setPins(movePin(args.pins, from, to)),
  };
}

/** The pin a click should make active: the clicked id when it is pinned. */
export function activePin(list: readonly string[], id: string, fallback: string): string {
  return list.includes(id) ? id : fallback;
}
