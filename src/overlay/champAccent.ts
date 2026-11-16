/**
 * Champion accent — one vivid color lifted from the champion's square art.
 *
 * The overlay reads it once per match (in-memory + localStorage cache) and
 * applies it to `--ov-champ` / `--ov-champ-soft` on the overlay root. The pick
 * is deterministic, static pixel work: no filters, no animation, no per-frame
 * cost (R11). Pixel reading uses fetch → blob → createImageBitmap so the
 * canvas is never CORS-tainted.
 */

import { championAssetSources } from '../data/championCatalog';

/** Chrome silver: the disciplined default when no champion is known. */
export const DEFAULT_ACCENT = '#c9ced6';

/** Hue histogram size (30° buckets). */
const HUE_BUCKETS = 12;
/** Skip near-black / near-white / gray pixels. */
const MIN_LIGHTNESS = 0.14;
const MAX_LIGHTNESS = 0.9;
const MIN_SATURATION = 0.28;
/** Keep the accent readable on ink: clamp its lightness into this band. */
const ACCENT_MIN_LIGHTNESS = 0.56;
const ACCENT_MAX_LIGHTNESS = 0.66;
const ACCENT_MIN_SATURATION = 0.5;
const ACCENT_MAX_SATURATION = 0.85;
/** Square art is sampled at this size — 48×48 is plenty for a hue histogram. */
const ACCENT_SAMPLE_PX = 48;
/** Fewer network probes per champion: ddragon first, CDragon fallbacks. */
const MAX_IMAGE_ATTEMPTS = 3;

export interface ChampionAccentSource {
  id?: string | null;
  name?: string | null;
  key?: string | number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hueOf(maxChannel: number, r: number, g: number, b: number, delta: number): number {
  let hue: number;
  if (maxChannel === r) hue = ((g - b) / delta) % 6;
  else if (maxChannel === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const channel = (value: number): string =>
    Math.round(clamp(value + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

interface HueBucket {
  weight: number;
  saturation: number;
  lightness: number;
  cos: number;
  sin: number;
}

/**
 * Vivid dominant color of an RGBA buffer, or DEFAULT_ACCENT when every pixel
 * is black, white, gray, transparent, or too muted to read on ink.
 */
export function pickAccent(pixels: ArrayLike<number>): string {
  if (!pixels || typeof pixels.length !== 'number') return DEFAULT_ACCENT;
  const buckets: HueBucket[] = Array.from({ length: HUE_BUCKETS }, () => ({
    weight: 0,
    saturation: 0,
    lightness: 0,
    cos: 0,
    sin: 0,
  }));
  const length = pixels.length - (pixels.length % 4);
  for (let i = 0; i < length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (lightness <= MIN_LIGHTNESS || lightness >= MAX_LIGHTNESS) continue;
    if (delta === 0) continue;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < MIN_SATURATION) continue;
    const hue = hueOf(max, r, g, b, delta);
    const bucket = buckets[Math.min(HUE_BUCKETS - 1, Math.floor((hue / 360) * HUE_BUCKETS))];
    const weight = saturation * (0.4 + delta);
    const radians = (hue * Math.PI) / 180;
    bucket.weight += weight;
    bucket.saturation += saturation * weight;
    bucket.lightness += lightness * weight;
    bucket.cos += Math.cos(radians) * weight;
    bucket.sin += Math.sin(radians) * weight;
  }

  let best: HueBucket | null = null;
  for (const bucket of buckets) {
    if (bucket.weight > 0 && (!best || bucket.weight > best.weight)) best = bucket;
  }
  if (!best) return DEFAULT_ACCENT;

  const hue = (((Math.atan2(best.sin, best.cos) * 180) / Math.PI) + 360) % 360;
  const saturation = clamp(best.saturation / best.weight, ACCENT_MIN_SATURATION, ACCENT_MAX_SATURATION);
  const lightness = clamp(best.lightness / best.weight, ACCENT_MIN_LIGHTNESS, ACCENT_MAX_LIGHTNESS);
  return hslToHex(hue, saturation, lightness);
}

/** Same accent at a wash alpha, for panel corners and active markers. */
export function accentSoft(hex: string, alpha = 0.14): string {
  const match = /^#([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '');
  if (!match) return `rgba(201, 206, 214, ${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const STORAGE_KEY = 'ot.overlay.champAccent.v1';
const memoryCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/** Stable cache key: numeric key first, then compact id/name. */
export function accentCacheKey(source: ChampionAccentSource): string {
  const key = source?.key != null && String(source.key) !== '' ? String(source.key) : '';
  if (key) return `k${key}`;
  const name = (source?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (name) return `n${name}`;
  const id = (source?.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return id ? `n${id}` : '';
}

function loadStoredAccents(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    // storage is optional (private mode, quota): fall through to cold start
    return {};
  }
}

function readStoredAccent(cacheKey: string): string | null {
  const stored = loadStoredAccents()[cacheKey];
  return typeof stored === 'string' && /^#[0-9a-f]{6}$/i.test(stored) ? stored : null;
}

function writeStoredAccent(cacheKey: string, hex: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = loadStoredAccents();
    all[cacheKey] = hex;
    const keys = Object.keys(all);
    if (keys.length > 64) {
      for (const stale of keys.slice(0, keys.length - 64)) delete all[stale];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage is optional; the in-memory cache still serves this session
  }
}

async function accentFromImageUrl(url: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return null;
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = ACCENT_SAMPLE_PX;
    canvas.height = ACCENT_SAMPLE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, ACCENT_SAMPLE_PX, ACCENT_SAMPLE_PX);
    bitmap.close();
    const accent = pickAccent(ctx.getImageData(0, 0, ACCENT_SAMPLE_PX, ACCENT_SAMPLE_PX).data);
    return accent === DEFAULT_ACCENT ? null : accent;
  } catch {
    // offline / CORS / decode failure: try the next source, then the default
    return null;
  }
}

async function computeAccentFromImages(source: ChampionAccentSource): Promise<string | null> {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return null;
  const urls = championAssetSources(source).slice(0, MAX_IMAGE_ATTEMPTS);
  for (const url of urls) {
    const accent = await accentFromImageUrl(url);
    if (accent) return accent;
  }
  return null;
}

/**
 * Champion accent for this match. Cached in memory and in localStorage, so a
 * replay/second window costs zero network and zero pixel reads.
 */
export function resolveChampionAccent(source: ChampionAccentSource): Promise<string> {
  const cacheKey = accentCacheKey(source);
  if (!cacheKey) return Promise.resolve(DEFAULT_ACCENT);
  const known = memoryCache.get(cacheKey);
  if (known) return Promise.resolve(known);
  const stored = readStoredAccent(cacheKey);
  if (stored) {
    memoryCache.set(cacheKey, stored);
    return Promise.resolve(stored);
  }
  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;
  const job = computeAccentFromImages(source).then((accent) => {
    pending.delete(cacheKey);
    if (accent) {
      memoryCache.set(cacheKey, accent);
      writeStoredAccent(cacheKey, accent);
      return accent;
    }
    memoryCache.set(cacheKey, DEFAULT_ACCENT);
    return DEFAULT_ACCENT;
  });
  pending.set(cacheKey, job);
  return job;
}

/** Test/tool hook: forget every cached accent (memory only). */
export function clearAccentCache(): void {
  memoryCache.clear();
  pending.clear();
}
